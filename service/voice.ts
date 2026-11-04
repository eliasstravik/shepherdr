// A voice call from the web (2.1's call: the page streams its microphone here as 16 kHz PCM and plays what comes
// back), as the window's call (mods/chat/voice.ts) with the phone's microphone and speaker: the same ElevenLabs voice
// agent (core/voice.js), the same key and agent id (<app home>/secrets), send_to_agent as the person's own message
// (hc send), read_chat from the chat as the service reads it, and the agent's replies and status said as [Update]s.
// Nothing is recorded or kept; a key is never sent to the page or logged.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Hub } from "./hub.ts";
import { HOME } from "./paths.ts";
import * as V from "../core/voice.js";
import { refusal } from "../core/send.js";

const { API, agentSpec, opening, replyLine, statusLine, envLines, apiError } = V as any;
const APP = process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app");
const SECRETS = join(APP, "secrets");

const envFile = (file: string): Record<string, string> => { try { return envLines(readFileSync(file, "utf8")); } catch { return {}; } };
// a key kept in Settings › Secrets for Everywhere (~/.herdr/vault.json), else ""
function vaultKey(name: string) {
  try {
    const v = JSON.parse(readFileSync(join(HOME, ".herdr", "vault.json"), "utf8"));
    const e = (Array.isArray(v?.secrets) ? v.secrets : []).find((x: any) => x?.name === name && x?.scope === "everywhere");
    return typeof e?.value === "string" ? e.value : "";
  } catch { return ""; }
}

async function api(path: string, key: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "xi-api-key": key, "content-type": "application/json", ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(apiError(r.status, await r.text().catch(() => "")));
  return r.json();
}

/** The "Herdr chat" voice agent, the window's (made once with the key, its id kept beside it). */
async function agentId(key: string) {
  const file = join(SECRETS, "elevenlabs-agent.env");
  const saved = envFile(file);
  const tag = createHash("sha256").update(key).digest("hex").slice(0, 16);
  if (saved.ELEVENLABS_AGENT_ID && (!saved.ELEVENLABS_KEY_TAG || saved.ELEVENLABS_KEY_TAG === tag)) return saved.ELEVENLABS_AGENT_ID;
  const r = await api("/convai/agents/create", key, { method: "POST", body: JSON.stringify(agentSpec()) }) as { agent_id?: string };
  if (typeof r.agent_id !== "string" || !/^[\w-]{1,200}$/.test(r.agent_id)) throw new Error("ElevenLabs didn't make the voice agent.");
  mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
  writeFileSync(file, `# The "Herdr chat" voice agent, made by the chat mod with ELEVENLABS_API_KEY.\nELEVENLABS_AGENT_ID=${r.agent_id}\nELEVENLABS_KEY_TAG=${tag}\n`, { mode: 0o600 });
  return r.agent_id;
}

type Page = { send(x: string | Uint8Array): void; close(): void };
/** What the call reads of the chat: the agent's last messages and its status. */
export type ChatView = { lastReply(): { id: string; text: string } | null; recent(): string; status(): string | null; asking(): string | null };

/** One call: the page's audio to the voice agent and back. message(): a frame from the page; end(): the page went. */
export function voiceCall(hub: Hub, addr: string, who: string, view: ChatView, page: Page) {
  let ws: WebSocket | null = null, ended = false;
  let lastStatus = view.status(), lastReply = view.lastReply()?.id ?? null;
  const tell = (m: object) => { try { page.send(JSON.stringify(m)); } catch {} };
  const toVoice = (m: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
  const end = (why: string | null = null) => {
    if (ended) return;
    ended = true;
    clearInterval(watch);
    if (why) tell({ type: "error", message: why });
    try { ws?.close(); } catch {}
    try { page.close(); } catch {}
  };
  // the coding agent's replies and status, as the window's chat feeds its call
  const watch = setInterval(() => {
    if (ended) return;
    const st = view.status();
    if (st !== lastStatus) { lastStatus = st; const line = statusLine(who, st, view.asking()); if (line) toVoice(line); }
    const r = view.lastReply();
    if (r && r.id !== lastReply) { lastReply = r.id; toVoice(replyLine(who, r.text)); }
  }, 1000);

  async function sendToAgent(text: string) {
    // the person's own message, not tagged as from another terminal (Hub.send), on any machine
    const r = await hub.send(addr, text);
    if (r.code !== 0) throw new Error(refusal(r).message);
    return "Sent to the coding agent.";
  }

  (async () => {
    const key = envFile(join(SECRETS, "elevenlabs.env")).ELEVENLABS_API_KEY || vaultKey("ELEVENLABS_API_KEY");
    if (!key) return end("No ElevenLabs key. Add ELEVENLABS_API_KEY in Settings › Secrets.");
    const id = await agentId(key);
    const { signed_url } = await api(`/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(id)}`, key) as { signed_url: string };
    const url = new URL(signed_url);
    if (url.protocol !== "wss:" || !url.hostname.endsWith("elevenlabs.io")) throw new Error("ElevenLabs gave an unexpected address.");
    if (ended) return;
    ws = new WebSocket(signed_url);
    ws.onopen = () => toVoice(opening(who));
    ws.onmessage = async (e) => {
      if (ended) return;
      let m: any;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.type === "ping") toVoice({ type: "pong", event_id: m.ping_event?.event_id });
      else if (m.type === "conversation_initiation_metadata") {
        const meta = m.conversation_initiation_metadata_event ?? {};
        // the page plays and records at 16 kHz, as the agent is made
        if (!/pcm_16000/.test(meta.agent_output_audio_format ?? "pcm_16000")) return end("The voice agent speaks in a format the page can't play.");
        tell({ type: "state", state: "listening" });
      }
      else if (m.type === "user_transcript") tell({ type: "state", state: "thinking" });
      else if (m.type === "agent_response") tell({ type: "state", state: "listening" });
      else if (m.type === "audio" && typeof m.audio_event?.audio_base_64 === "string") {
        const pcm = Buffer.from(m.audio_event.audio_base_64, "base64");
        if (pcm.length % 2 === 0) page.send(new Uint8Array(pcm));
      }
      else if (m.type === "interruption") tell({ type: "interrupt" });
      else if (m.type === "client_tool_call") {
        const c = m.client_tool_call ?? {};
        tell({ type: "state", state: "thinking" });
        let result = "", isError = false;
        try {
          if (c.tool_name === "send_to_agent") {
            const text = String(c.parameters?.text ?? "").trim();
            if (!text || text.length > 16000) throw new Error("Nothing to send.");
            result = await sendToAgent(text);
          } else if (c.tool_name === "read_chat") result = view.recent() || "Nothing yet.";
          else throw new Error("No such tool.");
        } catch (err: any) { result = String(err?.message ?? err).slice(0, 500); isError = true; }
        toVoice({ type: "client_tool_result", tool_call_id: c.tool_call_id, result, is_error: isError });
      }
    };
    ws.onerror = () => end("The voice connection failed.");
    ws.onclose = (e) => end(ended ? null : e.code === 1000 ? null : `The call was closed (${e.code}${e.reason ? `: ${e.reason}` : ""}).`);
  })().catch((err) => end(String(err?.message ?? err)));

  return {
    /** the page's microphone: 16 kHz PCM (the page cancels its own speaker's echo, so the person can talk over it) */
    message(data: string | Buffer | ArrayBuffer) {
      if (typeof data === "string" || ended || ws?.readyState !== WebSocket.OPEN) return;
      const pcm = Buffer.from(data as ArrayBuffer);
      if (pcm.length > 256 * 1024 || pcm.length % 2) return;
      ws.send(JSON.stringify({ user_audio_chunk: pcm.toString("base64") }));
    },
    end: () => end(),
  };
}
