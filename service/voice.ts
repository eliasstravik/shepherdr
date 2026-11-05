// A voice call from the web (2.1's call: the page streams its microphone here as 16 kHz PCM and plays what comes
// back), as the window's call (mods/chat/voice.ts) with the phone's microphone and speaker: the same ElevenLabs voice
// agent (core/voice.js), the same key and agent id (<app home>/secrets), its tools answered here (voice-tools.ts:
// look, open, send, act, with the reach of the person's web app), and the called agent's replies and status said as
// [Update]s. The page tells where it is (what it shows) as it moves; an open comes back to it as a nav message.
// Nothing is recorded or kept; a key is never sent to the page or logged.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Hub } from "./hub.ts";
import { HOME } from "./paths.ts";
import * as V from "../core/voice.js";
import { secretBin } from "./secrets.ts";
import { voiceTool, lookHere, shown, type Ack, type Nav, type VoiceIO, type Where } from "./voice-tools.ts";

const { API, opening, replyLine, statusLine, whereLine, envLines, apiError, voiceKey, ensureAgent, agentFile } = V as any;
const APP = process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app");
const SECRETS = join(APP, "secrets");

const envFile = (file: string): Record<string, string> => { try { return envLines(readFileSync(file, "utf8")); } catch { return {}; } };

/** The ElevenLabs key (core/voice.js voiceKey): the old file here, the vault here, or the machine that keeps the
 *  secrets, read over herdr-core's link into memory only. */
export function keyFor(hub: Pick<Hub, "call">) {
  return voiceKey({
    oldFile: () => envFile(join(SECRETS, "elevenlabs.env")).ELEVENLABS_API_KEY || "",
    where: async () => {
      const p = Bun.spawn([secretBin(), "where", "--json"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
      const out = await new Response(p.stdout).text();
      return (await p.exited) === 0 ? JSON.parse(out) : null;
    },
    vault: () => { try { return readFileSync(join(HOME, ".herdr", "vault.json"), "utf8"); } catch { return null; } },
    machines: async () => ((await hub.call<{ machines: any[] }>("machine.list", {})).machines ?? [])
      .filter((m) => !m.temporary && m.state === "connected" && m.name).map((m) => String(m.name)),
    ask: async (on: string, script: string) => {
      const r = await hub.call<{ code: number; stdout: string }>("machine.exec", { on, argv: ["python3", "-c", script], timeout: 15 }, 20_000);
      return r.code === 0 ? Buffer.from(r.stdout ?? "", "base64").toString("utf8") : null;
    },
  }) as Promise<{ key: string; agent?: string } | { error: string; why: string }>;
}

export async function api(path: string, key: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "xi-api-key": key, "content-type": "application/json", ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(apiError(r.status, await r.text().catch(() => "")));
  return r.status === 204 ? null : r.json();
}

/** The "Herdr chat" voice agent, up to this spec (core/voice.js ensureAgent); only its id, a tag of the key and the
 *  spec are kept here, never the key. */
export function agentId(key: string, made = "", dir = SECRETS, call = api) {
  const file = join(dir, "elevenlabs-agent.env");
  const tag = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return ensureAgent({
    saved: envFile(file), tag, made,
    api: (path: string, init?: RequestInit) => call(path, key, init),
    save: (id: string, spec: string) => { mkdirSync(dir, { recursive: true, mode: 0o700 }); writeFileSync(file, agentFile(id, tag, spec), { mode: 0o600 }); },
  }) as Promise<string>;
}

type Page = { send(x: string | Uint8Array): void; close(): void };
/** What the call reads of its own chat: the agent's last reply and its status (for the [Update]s). */
export type ChatView = { lastReply(): { id: string; text: string } | null; status(): string | null; asking(): string | null };
export type CallDeps = {
  view: ChatView;
  io: VoiceIO;
  /** keeps the call's chat read while the call is on (its replies are told even with no page on it); the stop */
  follow(): () => void;
  /** the call's start: where it is (the page tells what it shows as it moves) */
  where: Where;
  /** the voice agent's socket address (default: a signed ElevenLabs one for the person's key; a test's fake) */
  dial?: () => Promise<string>;
  /** how long an open waits for the page to say it shows it (ms) */
  navWait?: number;
};

/** The voice agent's socket: a signed address for the "Herdr chat" agent of the person's key. */
async function dialElevenLabs(hub: Hub) {
  const k = await keyFor(hub);
  if ("error" in k) throw new Error(k.error);
  const id = await agentId(k.key, k.agent);
  const { signed_url } = await api(`/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(id)}`, k.key) as { signed_url: string };
  const url = new URL(signed_url);
  if (url.protocol !== "wss:" || !url.hostname.endsWith("elevenlabs.io")) throw new Error("ElevenLabs gave an unexpected address.");
  return signed_url;
}

/** The page's "where" message, checked: what it shows now. */
export function pageWhere(m: any): Partial<Where> {
  const s = (v: unknown, n = 200) => (typeof v === "string" && v.length <= n ? v : null);
  return { device: s(m.device, 20), place: s(m.place), task: s(m.task), tab: s(m.tab, 40), artifact: s(m.artifact), settings: m.settings === true };
}

/** One call: the page's audio to the voice agent and back. message(): a frame from the page; end(): the page went. */
export function voiceCall(hub: Hub, who: string, deps: CallDeps, page: Page) {
  const { view, io } = deps;
  // an open goes to this very page (the socket that started the call: that phone, that browser tab) and counts only
  // once the page says it shows it ({ type: "navved", id, ok, why, where })
  let navs = 0;
  const waiting = new Map<number, (a: Ack | null) => void>();
  const show = (nav: Nav) => new Promise<Ack | null>((res) => {
    if (ended) return res({ ok: false, why: "the call ended" });
    const id = ++navs;
    const t = setTimeout(() => { waiting.delete(id); res(null); }, deps.navWait ?? 5000);
    waiting.set(id, (a) => { clearTimeout(t); waiting.delete(id); res(a); });
    tell({ type: "nav", id, nav });
  });
  let where = deps.where;
  let ws: WebSocket | null = null, ended = false;
  let lastStatus = view.status(), lastReply = view.lastReply()?.id ?? null;
  const unfollow = deps.follow();
  const tell = (m: object) => { try { page.send(JSON.stringify(m)); } catch {} };
  const toVoice = (m: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
  const here = () => { const s = io.snap(); return s ? lookHere(s, where) : ""; };
  let said = "", saying: ReturnType<typeof setTimeout> | null = null;
  const end = (why: string | null = null) => {
    if (ended) return;
    ended = true;
    clearInterval(watch);
    if (saying) clearTimeout(saying);
    unfollow();
    for (const done of [...waiting.values()]) done({ ok: false, why: "the call ended" });
    if (why) tell({ type: "error", message: why });
    try { ws?.close(); } catch {}
    try { page.close(); } catch {}
  };
  // the called agent's replies and status, as the window's chat feeds its call
  const watch = setInterval(() => {
    if (ended) return;
    const st = view.status();
    if (st !== lastStatus) { lastStatus = st; const line = statusLine(who, st, view.asking()); if (line) toVoice(line); }
    const r = view.lastReply();
    if (r && r.id !== lastReply) { lastReply = r.id; toVoice(replyLine(who, r.text)); }
  }, 1000);

  (async () => {
    const signed_url = await (deps.dial ?? (() => dialElevenLabs(hub)))();
    if (ended) return;
    ws = new WebSocket(signed_url);
    ws.onopen = () => { said = here(); toVoice(opening(who, said)); };
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
        const a = await shown(await voiceTool(String(c.tool_name ?? ""), c.parameters ?? {}, where, io), show);
        toVoice({ type: "client_tool_result", tool_call_id: c.tool_call_id, result: a.result, is_error: !!a.error });
      }
    };
    ws.onerror = () => end("The voice connection failed.");
    ws.onclose = (e) => end(ended ? null : e.code === 1000 ? null : `The call was closed (${e.code}${e.reason ? `: ${e.reason}` : ""}).`);
  })().catch((err) => end(String(err?.message ?? err)));

  return {
    /** the page's microphone: 16 kHz PCM (the page cancels its own speaker's echo, so the person can talk over it);
     *  or, as text, where the page is now ({ type: "where", place, task, tab, artifact, settings, device }), or what
     *  it did with an open ({ type: "navved", id, ok, why?, where? }) */
    message(data: string | Buffer | ArrayBuffer) {
      if (ended) return;
      if (typeof data === "string") {
        let m: any = null;
        try { m = JSON.parse(data); } catch {}
        if (m?.type === "navved" && typeof m.id === "number") {
          if (m.where && typeof m.where === "object") where = { ...where, ...pageWhere(m.where) };
          waiting.get(m.id)?.({ ok: m.ok === true, why: typeof m.why === "string" ? m.why.slice(0, 300) : null });
          return;
        }
        if (m?.type !== "where") return;
        where = { ...where, ...pageWhere(m) };
        // told once it settles (a tap through a few screens is one note)
        if (saying) clearTimeout(saying);
        saying = setTimeout(() => { saying = null; const now = here(); if (now && now !== said && ws?.readyState === WebSocket.OPEN) { said = now; toVoice(whereLine(now)); } }, 1500);
        return;
      }
      if (ws?.readyState !== WebSocket.OPEN) return;
      const pcm = Buffer.from(data as ArrayBuffer);
      if (pcm.length > 256 * 1024 || pcm.length % 2) return;
      ws.send(JSON.stringify({ user_audio_chunk: pcm.toString("base64") }));
    },
    end: () => end(),
  };
}
