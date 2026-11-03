// A voice call with an agent's chat: an ElevenLabs voice agent talks with the person and passes
// on only what is meant for the coding agent (send_to_agent → hc send); the chat feeds it the
// coding agent's replies and status, which it tells the person. Started by the chat mod (a mod
// has no audio or sockets); one process per call, nothing recorded or kept.
//   bun voice.ts <call folder> <agent address> <agent name>
// The call folder links it to the chat:
//   state.json  written here: { phase, muted, error, since } (phase: connecting, listening,
//               thinking, speaking, ended)
//   alive       touched by the chat every few seconds; stale for 20 s ends the call
//   in/*.json   from the chat: { type: "mute", on } | { type: "hangup" } |
//               { type: "reply", text } | { type: "status", status, asking? }
//   recent.txt  the chat's last messages and the agent's status, for read_chat
// and beside it <call folder>.level: how loud the call is now, 0..1 (the agent while it speaks,
// else the person), for the chat's wave.
// Secrets: ELEVENLABS_API_KEY (the person's) from <app home>/secrets/elevenlabs.env, else as kept
// in Settings › Secrets for Everywhere (the vault). The voice
// agent made for this ("Herdr chat") is kept as ELEVENLABS_AGENT_ID in
// secrets/elevenlabs-agent.env. Neither is ever printed or logged.

import { readFileSync, writeFileSync, readdirSync, rmSync, statSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const [dir, addr, name] = process.argv.slice(2);
if (!dir || !addr) { console.error("usage: bun voice.ts <call folder> <agent address> <agent name>"); process.exit(2); }
const HOME = process.env.HERDR_APP_HOME || join(process.env.HOME ?? "", ".config/herdr-app");
const SECRETS = join(HOME, "secrets");
const API = "https://api.elevenlabs.io/v1";
const who = name || "the coding agent";

const PROMPT = `You are the voice of a chat with a coding agent (${who}) in the Herdr app. The person talks to you hands-free while the coding agent works in a terminal.
- Talk with the person naturally and briefly. Answer small talk, questions about what is going on, and clarifications yourself.
- Only when the person wants the coding agent to do or know something, call send_to_agent with their request in their own words (tidy it, keep every detail). Never send greetings, chit-chat, thanks, or anything the person says to you about the call. If unsure whether something is meant for the agent, ask the person.
- After sending, say in a few words that you passed it on.
- Messages that start with [Update] come from Herdr, not the person: never send them to the coding agent. Tell the person what they say, briefly: summarize a reply in one or two sentences in plain speech (no code, no paths read out letter by letter), and say plainly when the agent needs them.
- To answer "what is it doing?" or "what did it say?", call read_chat first. Never make up what the agent said or did.`;

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

// ---- secrets ------------------------------------------------------------------------------

// A key kept in Settings › Secrets for Everywhere (~/.herdr/vault.json, owner-only), else "".
function vaultKey(name: string): string {
  try {
    const v = JSON.parse(readFileSync(join(process.env.HOME ?? "", ".herdr", "vault.json"), "utf8"));
    const e = (Array.isArray(v?.secrets) ? v.secrets : []).find((x: any) => x?.name === name && x?.scope === "everywhere");
    return typeof e?.value === "string" ? e.value : "";
  } catch { return ""; }
}

function envFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { return out; }
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

async function api(path: string, key: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "xi-api-key": key, "content-type": "application/json", ...(init.headers ?? {}) } });
  if (!r.ok) {
    const body = (await r.text().catch(() => "")).slice(0, 300).replace(/[A-Za-z0-9_-]{32,}/g, "…");
    throw new Error(`ElevenLabs said ${r.status}${body ? `: ${body}` : ""}`);
  }
  return r.json();
}

// The dedicated "Herdr chat" voice agent: made once with the person's key, its id kept in secrets.
async function agentId(key: string) {
  const file = join(SECRETS, "elevenlabs-agent.env");
  const saved = envFile(file);
  const tag = createHash("sha256").update(key).digest("hex").slice(0, 16);
  if (saved.ELEVENLABS_AGENT_ID && (!saved.ELEVENLABS_KEY_TAG || saved.ELEVENLABS_KEY_TAG === tag)) return saved.ELEVENLABS_AGENT_ID;
  const tool = (n: string, description: string, props: Record<string, { type: string; description: string }>, required: string[]) =>
    ({ type: "client", name: n, description, expects_response: true, response_timeout_secs: 20, parameters: { type: "object", properties: props, required } });
  const r = await api("/convai/agents/create", key, { method: "POST", body: JSON.stringify({
    name: "Herdr chat",
    conversation_config: {
      agent: {
        first_message: "Hi, I'm listening.",
        language: "en",
        prompt: { prompt: PROMPT, tools: [
          tool("send_to_agent", "Pass the person's request to the coding agent as a chat message. Only for what is meant for the coding agent.", { text: { type: "string", description: "The request, in the person's words" } }, ["text"]),
          tool("read_chat", "Read the coding agent's status and its last messages.", {}, []),
        ] },
      },
      asr: { user_input_audio_format: "pcm_16000" },
      tts: { agent_output_audio_format: "pcm_16000" },
    },
    platform_settings: {
      auth: { enable_auth: true },
      overrides: { conversation_config_override: { agent: { prompt: { prompt: true }, first_message: true } } },
      privacy: { record_voice: false, retention_days: 0 },
    },
  }) }) as { agent_id?: string };
  if (typeof r.agent_id !== "string" || !/^[\w-]{1,200}$/.test(r.agent_id)) throw new Error("ElevenLabs didn't make the voice agent.");
  mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
  writeFileSync(file, `# The "Herdr chat" voice agent, made by the chat mod with ELEVENLABS_API_KEY.\nELEVENLABS_AGENT_ID=${r.agent_id}\nELEVENLABS_KEY_TAG=${tag}\n`, { mode: 0o600 });
  return r.agent_id;
}

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
  return "Sent to the coding agent.";
}

function readChat() {
  try { return readFileSync(join(dir, "recent.txt"), "utf8").slice(-12000) || "Nothing yet."; } catch { return "Nothing yet."; }
}

function say(kind: "context" | "speak", text: string) {
  if (ws?.readyState !== WebSocket.OPEN) return;
  if (kind === "context") ws.send(JSON.stringify({ type: "contextual_update", text }));
  else ws.send(JSON.stringify({ type: "user_message", text }));
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
    if (m.type === "reply" && typeof m.text === "string") say("speak", `[Update] ${who} replied in the chat: """${m.text.slice(0, 3000)}""" Tell the person what it says, briefly.`);
    if (m.type === "status" && m.status !== lastStatus) {
      lastStatus = m.status;
      if (m.status === "working") say("context", `[Update] ${who} is working now.`);
      else if (m.status === "blocked") say("speak", `[Update] ${who} needs the person${m.asking ? `: ${String(m.asking).slice(0, 600)}` : " to answer something in the terminal"}. Tell them, briefly.`);
      else if (m.status === "idle" || m.status === "done") say("context", `[Update] ${who} finished and is waiting.`);
    }
  }
}

// ---- the call -----------------------------------------------------------------------------

async function main() {
  mkdirSync(join(dir, "in"), { recursive: true });
  state();
  const key = envFile(join(SECRETS, "elevenlabs.env")).ELEVENLABS_API_KEY || vaultKey("ELEVENLABS_API_KEY");
  if (!key) return end("No ElevenLabs key. Add ELEVENLABS_API_KEY in Settings › Secrets.");
  const id = await agentId(key);
  const { signed_url } = await api(`/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(id)}`, key) as { signed_url: string };
  const url = new URL(signed_url);
  if (url.protocol !== "wss:" || !url.hostname.endsWith("elevenlabs.io")) throw new Error("ElevenLabs gave an unexpected address.");
  if (ended) return;
  ws = new WebSocket(signed_url);
  ws.onopen = () => {
    ws!.send(JSON.stringify({ type: "conversation_initiation_client_data",
      conversation_config_override: { agent: { prompt: { prompt: PROMPT }, first_message: `You're on a call about ${who}. Go ahead.` } } }));
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
      let result = "", isError = false;
      try {
        if (c.tool_name === "send_to_agent") {
          const text = String(c.parameters?.text ?? "").trim();
          if (!text || text.length > 16000) throw new Error("Nothing to send.");
          result = await sendToAgent(text);
        } else if (c.tool_name === "read_chat") result = readChat();
        else throw new Error("No such tool.");
      } catch (err: any) { result = String(err?.message ?? err).slice(0, 500); isError = true; }
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "client_tool_result", tool_call_id: c.tool_call_id, result, is_error: isError }));
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
  try { if (Date.now() - statSync(join(dir, "alive")).mtimeMs > 20000) end(); } catch { if (Date.now() - since > 20000) end(); }
  state();
}, 150);

main().catch((err) => end(String(err?.message ?? err)));
