// A voice call with an agent's chat: an ElevenLabs voice agent talks with the person and reads,
// opens and changes Shepherdr for them through its tools (core/voice.js: look, open, send, act),
// which this machine's Shepherdr service answers (POST /api/voice/tool, service/voice-tools.ts:
// the reach of the person's web app); without the service, only this chat (send, look at it).
// SHEP-105: the call is with Shepherdr itself, not this chat: the service says what it hears (POST
// /api/voice/hear: the chats it sent to, the one on screen, needs anywhere), once the person and the
// voice are quiet. Without the service, the chat feeds it its own agent's replies and status. Started by
// the chat mod (a mod has no audio or sockets); one process per call, nothing recorded or kept.
//   bun voice.ts <call folder> <agent address> <agent name>
// The call folder links it to the chat:
//   state.json  written here: { phase, doing, muted, error, since } (phase: connecting, listening,
//               thinking, working (doing: what, in plain words), speaking, ended)
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
import { API, opening, replyLine, statusLine, whereLine, apiError, ensureAgent, agentFile, navWords, toolWords, turnGate, hangUpGuard, closeWords, chimePcm, HUNG_UP, REFUSED } from "./core/voice.js";
import { screenWords } from "./core/screen.js";
import { SECRETS, keyFor, envFile, shepPaths } from "./key.ts";
import { audio, callAudio, ended as audioEnded, type Audio, type CallSound } from "./audio.ts";

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
// the call's id for the service (its folder's name), tools running now, and whether the service hears for it
const callId = dir.replace(/\/$/, "").split("/").pop() ?? "";
let busy = 0;
// SHEP-113: what a tool is doing (plain words), and whether the person's ask is still unanswered (updates wait)
let doing = "";
const turn = turnGate();
// SHEP-173: hang_up ends the call only right after the person's yes (core/voice.js hangUpGuard)
const guard = hangUpGuard();
let hangingUp = 0;
let hears = false;
// the last thing the voice said (the sidebar's call card shows it)
let said = "";

function state() {
  const speaking = Date.now() < playEnd + 250;
  const shown = ended ? "ended" : phase === "connecting" ? "connecting" : speaking ? "speaking"
    : phase === "thinking" && Date.now() - thinkingAt < 20000 ? "thinking" : phase === "working" && Date.now() - thinkingAt < 35000 ? "working" : "listening";
  // Who is talking, for the chat's wave: the agent while its voice plays, else the person
  // while the microphone hears them (a moment's hold, so it doesn't flicker).
  const talking = ended ? null : speaking ? "agent" : !muted && Date.now() - heardAt < 400 ? "you" : null;
  const s = JSON.stringify({ phase: shown, doing: shown === "working" ? doing : "", who: talking, muted, error, since, pid: process.pid, said });
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
  sound?.stop(); asking?.kill();
  if (hears) void serviceCall("DELETE", `/api/voice/hear?call=${encodeURIComponent(callId)}`);
  state();
  // SHEP-173: the end chime, at the system's volume, whatever ended it; then this helper goes
  const chimed = chime();
  setTimeout(() => process.exit(0), chimed ? 900 : 100);
}

/** The end chime through the speaker (audio.ts), when this machine has one: true when it plays. */
function chime() {
  if (!tools) return false;
  try {
    const p = Bun.spawn(tools.speaker(16000), { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    const pcm = chimePcm(16000) as Int16Array;
    p.stdin.write(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    p.stdin.end();
    return true;
  } catch { return false; }
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
// shows; what it asks to show goes to the chat (nav/). Its token is the local callers' (token in the service's folder).

const DATA = process.env.SHEPHERDR_DATA || shepPaths().service;
const TOKEN = join(DATA, "token");

/** The service's address, only when Shepherdr's own service answers there (service.json's port and id, as the window's
 *  lib/local.js): never the token to another app on its port. */
async function service(): Promise<string | null> {
  try {
    const f = JSON.parse(readFileSync(join(DATA, "service.json"), "utf8"));
    const base = `http://127.0.0.1:${f.port}`;
    const h = await (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) })).json();
    return typeof f.id === "string" && f.id && h?.id === f.id ? base : null;
  } catch { return null; }
}

function where() { try { return JSON.parse(readFileSync(join(dir, "where.json"), "utf8")); } catch { return {}; } }

/** The service's JSON answer to a call of this machine's, or null when it can't be asked. */
async function serviceCall(method: string, path: string, body?: unknown, ms = 25000): Promise<any> {
  let token = "";
  try { token = readFileSync(TOKEN, "utf8").trim(); } catch { return null; }
  const base = await service();
  if (!base) return null;
  try {
    const r = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(ms),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** A tool's answer from the service: { result, nav?, error? }, or null when the service can't be asked. */
async function serviceTool(tool: string, params: unknown): Promise<{ result: string; nav?: any; then?: unknown; shows?: string; error?: boolean } | null> {
  const a = await serviceCall("POST", "/api/voice/tool", { addr, call: callId, tool, params, where: where() });
  return typeof a?.result === "string" ? a : null;
}

/** SHEP-105: what the call hears, from the service, said once the person and the voice are both quiet. */
let hearing = false;
async function hear() {
  if (hearing || ended || ws?.readyState !== WebSocket.OPEN) return;
  hearing = true;
  try {
    const now = Date.now();
    const quiet = !turn.holding(now) && now - heardAt > 1200 && now > playEnd + 1200;
    const a = await serviceCall("POST", "/api/voice/hear", { call: callId, addr, where: where(), quiet }, 5000);
    if (!a || !Array.isArray(a.lines)) return;
    hears = true;
    for (const line of a.lines) if (line && typeof line.text === "string") send(line);
  } finally { hearing = false; }
}

// ElevenLabs' answer (none for a 204), or throws its error in words without anything like a key.
// ---- audio --------------------------------------------------------------------------------

// the call's mic and speaker (audio.ts callAudio): on a Mac echo-free, so the mic stays open while the agent speaks
let sound: CallSound | null = null;
let outRate = 16000;
let inRate = 16000;
let playEnd = 0;
// pw-record and pw-play, or the Mac's own (audio.ts), found before the call connects
let tools: Audio | null = null;
// macOS's microphone prompt, while it shows (a hang-up meanwhile ends it)
let asking: ReturnType<typeof Bun.spawn> | null = null;

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
  if (!sound) return;
  const now = Date.now();
  const from = Math.max(playEnd, now + 120);
  const piece = Math.round(outRate * 2 * 0.1);
  for (let i = 0; i < pcm.length; i += piece) heard.push({ at: from + (i / 2 / outRate) * 1000, level: loud(pcm.subarray(i, i + piece)) });
  if (heard.length > 3000) heard = heard.slice(-3000);
  playEnd = from + (pcm.length / 2 / outRate) * 1000;
  sound.play(pcm);
  state();
}
// Talked over: what it was going to say is dropped.
function hush() {
  sound?.drop();
  playEnd = 0;
  heard = [];
  state();
}

function startSound() {
  const chunk = Math.round(inRate * 2 * 0.1); // 100 ms
  let buf = new Uint8Array(0);
  sound = callAudio(tools!, inRate, outRate, {
    failed: (why) => end(why),
    // (quietly: the call goes on the old way, only a line for whoever reads the log)
    fellBack: (why) => { if (why) console.error(`voice: no echo cancellation, the mic hushes while the agent speaks (${why})`); },
    heard(part) {
      if (ended) return;
      const next = new Uint8Array(buf.length + part.length);
      next.set(buf); next.set(part, buf.length);
      buf = next;
      while (buf.length >= chunk) {
        let piece = buf.slice(0, chunk);
        buf = buf.slice(chunk);
        // Without echo cancellation, the agent's own voice comes back through the mic: while it plays (and a moment
        // after) the mic means nothing and the voice agent hears silence instead. With it (a Mac's call), the person
        // can talk over the agent. Muted sends silence too.
        const hushed = !sound?.echoFree() && Date.now() < playEnd + 350;
        // Loud enough to be speech (RMS above ~2% of full scale): the person is talking.
        const pcm = new Int16Array(piece.buffer, piece.byteOffset, piece.length >> 1);
        let sum = 0;
        for (let i = 0; i < pcm.length; i += 4) sum += pcm[i] * pcm[i];
        if (Math.sqrt(sum / Math.max(1, pcm.length >> 2)) > 650 && !hushed) heardAt = Date.now();
        micLevel = loud(piece);
        if (muted || hushed) piece = new Uint8Array(chunk);
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ user_audio_chunk: Buffer.from(piece).toString("base64") }));
      }
    },
  });
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
async function localTool(name: string, p: any): Promise<{ result: string; nav?: any; then?: unknown; shows?: string; error?: boolean }> {
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

/** What the voice agent asked to show, done by the chat that started this call: its { ok, why } (a screen action's
 *  { did, ask, screen } too), or null when it didn't answer in time (the chat reads nav/ about once a second). */
async function showHere(nav: unknown): Promise<{ ok: boolean; why?: string; did?: string; ask?: string; screen?: string } | null> {
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
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    return { ok: a?.ok === true, why: str(a?.why), did: str(a?.did), ask: str(a?.ask), screen: str(a?.screen) };
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
    // the service hears this chat with the rest (hear()); without it, the chat's own agent only
    if (m.type === "reply" && typeof m.text === "string" && !hears) send(replyLine(who, m.text));
    if (m.type === "status" && m.status !== lastStatus && !hears) {
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
  // The mic and speaker first: on a Mac, macOS asks for the microphone now (the first time), before the voice agent
  // starts talking; not allowed, or nothing to record or play with, ends the call with why.
  try { tools = await audio(); } catch (err: any) { return end(String(err?.message ?? err)); }
  if (tools.access) {
    const p = asking = Bun.spawn(tools.access, { stdout: "ignore", stderr: "pipe" });
    const why = audioEnded("mic", await p.exited, await new Response(p.stderr).text().catch(() => ""));
    asking = null;
    if (why) return end(why);
  }
  if (ended) return;
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
    ws!.send(JSON.stringify(opening(here)));
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
      try { startSound(); } catch (err: any) { end(`The microphone didn't start: ${err?.message ?? err}`); }
    }
    else if (m.type === "user_transcript") { turn.seen("user_transcript"); guard.seen("user_transcript"); phase = "thinking"; thinkingAt = Date.now(); state(); }
    else if (m.type === "agent_response") {
      turn.seen("agent_response");
      guard.seen("agent_response", m.agent_response_event?.agent_response);
      // a word before a tool ("On it."): still working on it
      if (!busy) phase = "listening";
      const text = m.agent_response_event?.agent_response;
      if (typeof text === "string" && text.trim()) said = text.trim().slice(0, 300);
      state();
    }
    else if (m.type === "audio" && typeof m.audio_event?.audio_base_64 === "string") {
      const pcm = Buffer.from(m.audio_event.audio_base_64, "base64");
      if (pcm.length % 2 === 0) play(new Uint8Array(pcm));
    }
    else if (m.type === "interruption") hush();
    else if (m.type === "client_tool_call") {
      const c = m.client_tool_call ?? {};
      guard.seen("client_tool_call", String(c.tool_name ?? ""));
      if (c.tool_name === "hang_up") {
        const may = guard.may();
        send({ type: "client_tool_result", tool_call_id: c.tool_call_id, result: may ? HUNG_UP : REFUSED, is_error: !may });
        // its "Bye." plays out, then the call ends with no note
        if (may && !hangingUp) {
          hangingUp = Date.now();
          const t = setInterval(() => {
            const now = Date.now();
            if ((now - hangingUp > 1500 && now > playEnd + 600) || now - hangingUp > 10000) { clearInterval(t); end(); }
          }, 250);
        }
        return;
      }
      doing = toolWords(String(c.tool_name ?? ""), c.parameters ?? {});
      turn.seen("client_tool_call");
      phase = "working"; thinkingAt = Date.now(); state();
      busy++;
      try { await tool(c); } finally {
        busy--;
        turn.seen("client_tool_result");
        // its answer next
        if (!busy) { phase = "thinking"; thinkingAt = Date.now(); state(); }
      }
    }
  };
  async function tool(c: any) {
    const name = String(c.tool_name ?? ""), params = c.parameters ?? {};
    let a = await serviceTool(name, params);
    if (!a) a = await localTool(name, params);
    // an open: this window's chat shows it, and says so (navved/), before the agent may say it's on screen
    // (the screen tool's answer is the screen itself; a space then its panel: the second once the first shows)
    if (a.nav?.kind === "screen") a = { ...a, ...screenWords(await showHere(a.nav), a.nav.do) };
    else if (a.nav) {
      let ack = await showHere(a.nav);
      if (ack?.ok && a.then) ack = await showHere(a.then);
      a = { ...a, ...navWords(a.shows ?? "it", ack) };
    }
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "client_tool_result", tool_call_id: c.tool_call_id, result: a.result, is_error: !!a.error }));
  }
  // an error is followed by its close, which says why
  ws.onerror = () => {};
  ws.onclose = (e) => {
    if (ended) return;
    // SHEP-173: the person said yes and it hung up: no note; else it ended by itself (a limit, the line): the window
    // says why in plain words, with Call again. Its last words play out first.
    const why = hangingUp ? null : `Call ended: ${closeWords(e.code, e.reason)}.`;
    setTimeout(() => end(why), Math.max(0, Math.min(10000, playEnd - Date.now() + 300)));
  };
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

let hearAt = 0;
// The chat's commands, and the call's end once the chat stops showing.
setInterval(() => {
  if (ended) return;
  inbox();
  if (ws?.readyState === WebSocket.OPEN) void moved();
  if (Date.now() - hearAt > 1000) { hearAt = Date.now(); void hear(); }
  try { if (Date.now() - statSync(join(dir, "alive")).mtimeMs > 20000) end(); } catch { if (Date.now() - since > 20000) end(); }
  state();
}, 150);

main().catch((err) => end(String(err?.message ?? err)));
