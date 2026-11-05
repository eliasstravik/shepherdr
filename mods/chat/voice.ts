// A voice call with an agent's chat: an ElevenLabs voice agent talks with the person and reads,
// opens and changes Shepherdr for them through its tools (core/voice.js: look, open, send, act),
// which this machine's Shepherdr service answers (POST /api/voice/tool, service/voice-tools.ts:
// the reach of the person's web app); without the service, only this chat (send, look at it).
// The chat feeds it the called agent's replies and status, which it tells the person. Started by
// the chat mod (a mod has no audio or sockets); one process per call, nothing recorded or kept.
//   bun voice.ts <call folder> <agent address> <agent name>
// The call folder links it to the chat:
//   state.json  written here: { phase, muted, error, since } (phase: connecting, listening,
//               thinking, speaking, ended)
//   alive       touched by the chat every few seconds; stale for 20 s ends the call
//   in/*.json   from the chat: { type: "mute", on } | { type: "hangup" } |
//               { type: "reply", text } | { type: "status", status, asking? }
//   recent.txt  the chat's last messages and the agent's status (looking at it without the service)
//   where.json  from the chat: what the window shows ({ place, task, tab }), for the agent's "here"
//   nav/*.json  written here: what the voice agent asked to show (open), done by the chat
//   navved/*.json  from the chat, by the nav's name: { ok, why } once it tried it (open counts only then)
// and beside it <call folder>.level: how loud the call is now, 0..1 (the agent while it speaks,
// else the person), for the chat's wave.
// Secrets: ELEVENLABS_API_KEY (the person's) from <app home>/secrets/elevenlabs.env, else as kept
// in Settings › Secrets for Everywhere (the vault), on the machine that keeps the secrets: read
// from there over herdr-core's link into memory only (core/voice.js voiceKey). The voice agent
// made for this ("Herdr chat") is kept as ELEVENLABS_AGENT_ID in secrets/elevenlabs-agent.env,
// with a tag of the key. The key is never printed, logged or written here.

import { readFileSync, writeFileSync, readdirSync, rmSync, statSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { API, opening, replyLine, statusLine, whereLine, apiError, ensureAgent, agentFile, navWords } from "./core/voice.js";
import { SECRETS, keyFor, envFile } from "./key.ts";

const [dir, addr, name] = process.argv.slice(2);
if (!dir || !addr) { console.error("usage: bun voice.ts <call folder> <agent address> <agent name>"); process.exit(2); }
const who = name || "the coding agent";


let ended = false;
let ws: WebSocket | null = null;
let muted = false;
let phase = "connecting";
let since = Date.now();
let error: string | null = null;
let thinkingAt = 0;
let heardAt = 0;

function state() {
  const speaking = player && Date.now() < playEnd + 250;
  const shown = ended ? "ended" : phase === "connecting" ? "connecting" : speaking ? "speaking" : phase === "thinking" && Date.now() - thinkingAt < 20000 ? "thinking" : "listening";
  // Who is talking, for the chat's wave: the agent while its voice plays, else the person
  // while the microphone hears them (a moment's hold, so it doesn't flicker).
  const talking = ended ? null : speaking ? "agent" : !muted && Date.now() - heardAt < 400 ? "you" : null;
  const s = JSON.stringify({ phase: shown, who: talking, muted, error, since, pid: process.pid });
  if (s === lastState) return;
  lastState = s;
  try { writeFileSync(join(dir, "state.json.tmp"), s); renameSync(join(dir, "state.json.tmp"), join(dir, "state.json")); } catch {}
}
let lastState = "";

function end(why: string | null = null) {
  if (ended) return;
  if (why) error = why;
  ended = true;
  try { ws?.close(); } catch {}
  mic?.kill(); player?.kill();
  state();
  setTimeout(() => process.exit(0), 100);
}
process.on("SIGTERM", () => end());
process.on("SIGINT", () => end());

// ---- secrets: key.ts ----------------------------------------------------------------------

async function api(path: string, key: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "xi-api-key": key, "content-type": "application/json", ...(init.headers ?? {}) } });
  if (!r.ok) {
    throw new Error(apiError(r.status, await r.text().catch(() => "")));
  }
  return r.status === 204 ? null : r.json();
}

// The "Herdr chat" voice agent, up to this spec (core/voice.js ensureAgent: made, or PATCHed when its tools or prompt
// changed). (made: the one the machine that keeps the key made with it.) Only the id, a tag of the key and the spec are
// kept here.
async function agentId(key: string, made = "") {
  const file = join(SECRETS, "elevenlabs-agent.env");
  const tag = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return ensureAgent({
    saved: envFile(file), tag, made,
    api: (path: string, init?: RequestInit) => api(path, key, init),
    save: (id: string, spec: string) => { mkdirSync(SECRETS, { recursive: true, mode: 0o700 }); writeFileSync(file, agentFile(id, tag, spec), { mode: 0o600 }); },
  }) as Promise<string>;
}

// ---- the service: the tools ---------------------------------------------------------------
// This machine's Shepherdr service answers the tools as for the web app, told this call's agent and what the window
// shows; what it asks to show goes to the chat (nav/). Its token is the local callers' (~/.herdr/shepherdr/token).

const SERVICE = `http://127.0.0.1:${process.env.SHEPHERDR_PORT || 7788}`;
const TOKEN = join(process.env.SHEPHERDR_DATA || join(process.env.HOME ?? "", ".herdr", "shepherdr"), "token");

function where() { try { return JSON.parse(readFileSync(join(dir, "where.json"), "utf8")); } catch { return {}; } }

/** A tool's answer from the service: { result, nav?, error? }, or null when the service can't be asked. */
async function serviceTool(tool: string, params: unknown): Promise<{ result: string; nav?: unknown; shows?: string; error?: boolean } | null> {
  let token = "";
  try { token = readFileSync(TOKEN, "utf8").trim(); } catch { return null; }
  try {
    const r = await fetch(`${SERVICE}/api/voice/tool`, { method: "POST", signal: AbortSignal.timeout(25000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ addr, tool, params, where: where() }) });
    if (!r.ok) return null;
    const a = await r.json();
    return typeof a?.result === "string" ? a : null;
  } catch { return null; }
}

// ElevenLabs' answer (none for a 204), or throws its error in words without anything like a key.
// ---- audio --------------------------------------------------------------------------------

let mic: ReturnType<typeof Bun.spawn> | null = null;
let player: ReturnType<typeof Bun.spawn> | null = null;
let outRate = 16000;
let inRate = 16000;
let playEnd = 0;

function startPlayer() {
  player = Bun.spawn(["pw-play", "--rate", String(outRate), "--channels", "1", "--format", "s16", "--raw", "-"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
}
// Loudness of 16-bit samples, scaled so speech fills most of 0..1.
function loud(pcm: Uint8Array) {
  const s = new Int16Array(pcm.slice(0, pcm.length & ~1).buffer);
  let sum = 0;
  for (let i = 0; i < s.length; i += 2) sum += s[i] * s[i];
  return Math.min(1, (Math.sqrt(sum / Math.max(1, s.length >> 1)) / 32768) * 8);
}
// The agent's voice as it will be heard: 100 ms pieces with when they play and how loud.
let heard: { at: number; level: number }[] = [];
let micLevel = 0;

function play(pcm: Uint8Array) {
  if (!player) startPlayer();
  const now = Date.now();
  const from = Math.max(playEnd, now + 120);
  const piece = Math.round(outRate * 2 * 0.1);
  for (let i = 0; i < pcm.length; i += piece) heard.push({ at: from + (i / 2 / outRate) * 1000, level: loud(pcm.subarray(i, i + piece)) });
  if (heard.length > 3000) heard = heard.slice(-3000);
  playEnd = from + (pcm.length / 2 / outRate) * 1000;
  try { (player!.stdin as any).write(pcm); (player!.stdin as any).flush?.(); } catch {}
  state();
}
// Talked over: what it was going to say is dropped.
function hush() {
  player?.kill();
  player = null;
  playEnd = 0;
  heard = [];
  state();
}

async function startMic() {
  mic = Bun.spawn(["pw-record", "--rate", String(inRate), "--channels", "1", "--format", "s16", "--raw", "-"], { stdout: "pipe", stderr: "ignore" });
  const chunk = Math.round(inRate * 2 * 0.1); // 100 ms
  let buf = new Uint8Array(0);
  for await (const part of mic.stdout as ReadableStream<Uint8Array>) {
    if (ended) break;
    const next = new Uint8Array(buf.length + part.length);
    next.set(buf); next.set(part, buf.length);
    buf = next;
    while (buf.length >= chunk) {
      let piece = buf.slice(0, chunk);
      buf = buf.slice(chunk);
      // Loud enough to be speech (RMS above ~2% of full scale): the person is talking.
      const pcm = new Int16Array(piece.buffer, piece.byteOffset, piece.length >> 1);
      let sum = 0;
      for (let i = 0; i < pcm.length; i += 4) sum += pcm[i] * pcm[i];
      if (Math.sqrt(sum / Math.max(1, pcm.length >> 2)) > 650 && Date.now() >= playEnd + 350) heardAt = Date.now();
      micLevel = loud(piece);
      // No echo cancellation here: while its own voice plays (and a moment after), the voice
      // agent hears silence instead of hearing itself. Muted sends silence too.
      if (muted || Date.now() < playEnd + 350) piece = new Uint8Array(chunk);
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ user_audio_chunk: Buffer.from(piece).toString("base64") }));
    }
  }
}

// ---- the chat -----------------------------------------------------------------------------

async function sendToAgent(text: string) {
  const env = { ...process.env };
  // Sent as the person's own message, not tagged as from another terminal.
  delete env.HC_TERMINAL_ID; delete env.HC_TERMINAL_SOCKET; delete env.HC_SCOPE;
  const p = Bun.spawn(["hc", "send", addr, text], { env, stdout: "pipe", stderr: "pipe" });
  const code = await p.exited;
  if (code !== 0) throw new Error((await new Response(p.stderr).text()).trim() || "It didn't go through.");
  return `Sent to ${who}.`;
}

function readChat() {
  try { return readFileSync(join(dir, "recent.txt"), "utf8").slice(-12000) || "Nothing yet."; } catch { return "Nothing yet."; }
}

const NO_SERVICE = "Shepherdr's service isn't running on this machine, so on this call I can only read and write this chat.";
/** Without the service: this chat only (send here, look at it). */
async function localTool(name: string, p: any): Promise<{ result: string; nav?: unknown; error?: boolean }> {
  const here = !p?.to || /^(here|this|this chat)$/i.test(String(p.to).trim());
  try {
    if ((name === "send" && here) || name === "send_to_agent") {
      const text = String(p?.text ?? "").trim();
      if (!text || text.length > 16000) throw new Error("Nothing to send.");
      return { result: await sendToAgent(text) };
    }
    if ((name === "look" && p?.what === "chat" && (!p.id || /^(here|this)$/i.test(String(p.id).trim()))) || name === "read_chat") return { result: readChat() };
  } catch (err: any) { return { result: String(err?.message ?? err).slice(0, 500), error: true }; }
  return { result: NO_SERVICE, error: true };
}

// The window moved during the call: told (in words, from the service) once it settles.
let saidWhere = "", whereAt = 0;
async function moved() {
  const now = JSON.stringify(where());
  if (now === saidWhere || Date.now() - whereAt < 1500) return;
  whereAt = Date.now();
  saidWhere = now;
  const a = await serviceTool("look", { what: "here" });
  if (a && !a.error) send(whereLine(a.result));
}

/** What the voice agent asked to show, done by the chat that started this call: its { ok, why }, or null when it
 *  didn't answer in time (the chat reads nav/ about once a second). */
async function showHere(nav: unknown): Promise<{ ok: boolean; why?: string } | null> {
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`;
  try {
    mkdirSync(join(dir, "nav"), { recursive: true });
    writeFileSync(join(dir, "nav", `${name}.tmp`), JSON.stringify(nav));
    renameSync(join(dir, "nav", `${name}.tmp`), join(dir, "nav", name));
  } catch { return { ok: false, why: "the window couldn't be told" }; }
  const ack = join(dir, "navved", name);
  for (let i = 0; i < 40 && !ended; i++) {
    await Bun.sleep(150);
    let a: any = null;
    try { a = JSON.parse(readFileSync(ack, "utf8")); } catch { continue; }
    try { rmSync(ack); } catch {}
    return { ok: a?.ok === true, why: typeof a?.why === "string" ? a.why : undefined };
  }
  try { rmSync(join(dir, "nav", name)); } catch {}
  return null;
}

function send(line: object) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(line));
}

let lastStatus: string | null = null;
function inbox() {
  const box = join(dir, "in");
  let files: string[] = [];
  try { files = readdirSync(box).filter((f) => f.endsWith(".json")).sort(); } catch { return; }
  for (const f of files) {
    let m: any = null;
    try { m = JSON.parse(readFileSync(join(box, f), "utf8")); } catch {}
    try { rmSync(join(box, f)); } catch {}
    if (!m) continue;
    if (m.type === "hangup") return end();
    if (m.type === "mute") { muted = Boolean(m.on); state(); }
    if (m.type === "reply" && typeof m.text === "string") send(replyLine(who, m.text));
    if (m.type === "status" && m.status !== lastStatus) {
      lastStatus = m.status;
      const line = statusLine(who, m.status, m.asking);
      if (line) send(line);
    }
  }
}

// ---- the call -----------------------------------------------------------------------------

async function main() {
  mkdirSync(join(dir, "in"), { recursive: true });
  state();
  const k = await keyFor();
  if ("error" in k) return end(k.error);
  const key = k.key;
  const id = await agentId(key, k.agent);
  const { signed_url } = await api(`/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(id)}`, key) as { signed_url: string };
  const url = new URL(signed_url);
  if (url.protocol !== "wss:" || !url.hostname.endsWith("elevenlabs.io")) throw new Error("ElevenLabs gave an unexpected address.");
  if (ended) return;
  ws = new WebSocket(signed_url);
  const here = (await serviceTool("look", { what: "here" }))?.result ?? "";
  saidWhere = JSON.stringify(where());
  ws.onopen = () => {
    ws!.send(JSON.stringify(opening(who, here)));
  };
  ws.onmessage = async (e) => {
    if (ended) return;
    let m: any;
    try { m = JSON.parse(String(e.data)); } catch { return; }
    if (m.type === "ping") ws!.send(JSON.stringify({ type: "pong", event_id: m.ping_event?.event_id }));
    else if (m.type === "conversation_initiation_metadata") {
      const meta = m.conversation_initiation_metadata_event ?? {};
      outRate = Number(/pcm_(\d+)/.exec(meta.agent_output_audio_format ?? "")?.[1] ?? 16000);
      inRate = Number(/pcm_(\d+)/.exec(meta.user_input_audio_format ?? "")?.[1] ?? 16000);
      phase = "listening";
      state();
      startMic().catch((err) => end(`The microphone didn't start: ${err?.message ?? err}`));
    }
    else if (m.type === "user_transcript") { phase = "thinking"; thinkingAt = Date.now(); state(); }
    else if (m.type === "agent_response") { phase = "listening"; state(); }
    else if (m.type === "audio" && typeof m.audio_event?.audio_base_64 === "string") {
      const pcm = Buffer.from(m.audio_event.audio_base_64, "base64");
      if (pcm.length % 2 === 0) play(new Uint8Array(pcm));
    }
    else if (m.type === "interruption") hush();
    else if (m.type === "client_tool_call") {
      const c = m.client_tool_call ?? {};
      phase = "thinking"; thinkingAt = Date.now(); state();
      const name = String(c.tool_name ?? ""), params = c.parameters ?? {};
      let a = await serviceTool(name, params);
      if (!a) a = await localTool(name, params);
      // an open: this window's chat shows it, and says so (navved/), before the agent may say it's on screen
      if (a.nav) a = { ...a, ...navWords(a.shows ?? "it", await showHere(a.nav)) };
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "client_tool_result", tool_call_id: c.tool_call_id, result: a.result, is_error: !!a.error }));
    }
  };
  ws.onerror = () => end("The voice connection failed.");
  ws.onclose = (e) => end(ended ? null : e.code === 1000 ? null : `The call was closed (${e.code}${e.reason ? `: ${e.reason}` : ""}).`);
}

// The level the chat's wave shows, ten times a second, beside the call folder (so writing it
// doesn't wake the chat's watch on the folder): the agent's voice while it plays, else the mic.
setInterval(() => {
  if (ended) return;
  const now = Date.now();
  let level = 0;
  if (now < playEnd + 100) {
    while (heard.length > 1 && heard[1].at <= now) heard.shift();
    level = heard[0] && heard[0].at <= now ? heard[0].level : 0;
  } else if (!muted) level = micLevel;
  try { writeFileSync(`${dir.replace(/\/$/, "")}.level`, level.toFixed(3)); } catch {}
}, 100);

// The chat's commands, and the call's end once the chat stops showing.
setInterval(() => {
  if (ended) return;
  inbox();
  if (ws?.readyState === WebSocket.OPEN) void moved();
  try { if (Date.now() - statSync(join(dir, "alive")).mtimeMs > 20000) end(); } catch { if (Date.now() - since > 20000) end(); }
  state();
}, 150);

main().catch((err) => end(String(err?.message ?? err)));
