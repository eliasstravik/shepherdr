// A voice call from the web (2.1's call: the page streams its microphone here as 16 kHz PCM and plays what comes
// back), as the window's call (mods/chat/voice.ts) with the phone's microphone and speaker: the same ElevenLabs voice
// agent (core/voice.js), the same key and agent id (<app home>/secrets), its tools answered here (voice-tools.ts:
// look, open, send, act, with the reach of the person's web app). SHEP-105: the call is with Shepherdr itself, not a
// chat: it hears the chats it sent to and the one on screen, and what needs the person anywhere (voice-hear.ts), as
// [Update]s held until the person and the voice are quiet. The page tells where it is (what it shows) as it moves; an
// open comes back to it as a nav message.
// Nothing is recorded or kept; a key is never sent to the page or logged.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Hub } from "./hub.ts";
import { HOME, appHome, where, writable } from "./paths.ts";
import * as V from "../core/voice.js";
import { secretBin } from "./secrets.ts";
import { voiceTool, lookHere, shown, type Ack, type Nav, type VoiceIO, type Where } from "./voice-tools.ts";
import { hearing, type HearIO } from "./voice-hear.ts";
export type { ChatView } from "./voice-hear.ts";

const { API, opening, whereLine, envLines, apiError, voiceKey, ensureAgent, agentFile, toolWords, turnGate, hangUpGuard, closeWords, HUNG_UP, REFUSED } = V as any;
const secretsDir = () => join(appHome(), "secrets");

const envFile = (file: string): Record<string, string> => { try { return envLines(readFileSync(file, "utf8")); } catch { return {}; } };

/** The ElevenLabs key (core/voice.js voiceKey): the old file here, the vault here, or the machine that keeps the
 *  secrets, read over herdr-core's link into memory only. */
export function keyFor(hub: Pick<Hub, "call">) {
  return voiceKey({
    oldFile: () => envFile(join(secretsDir(), "elevenlabs.env")).ELEVENLABS_API_KEY || "",
    where: async () => {
      const p = Bun.spawn([secretBin(), "where", "--json"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
      const out = await new Response(p.stdout).text();
      return (await p.exited) === 0 ? JSON.parse(out) : null;
    },
    vault: () => { try { return readFileSync(where().vault, "utf8"); } catch { return null; } },
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
export function agentId(key: string, made = "", dir = secretsDir(), call = api) {
  const file = join(dir, "elevenlabs-agent.env");
  const tag = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return ensureAgent({
    saved: envFile(file), tag, made,
    api: (path: string, init?: RequestInit) => call(path, key, init),
    save: (id: string, spec: string) => { writable(file); mkdirSync(dir, { recursive: true, mode: 0o700 }); writeFileSync(file, agentFile(id, tag, spec), { mode: 0o600 }); },
  }) as Promise<string>;
}

type Page = { send(x: string | Uint8Array): void; close(): void };

/** SHEP-102: how long a call holds when its page's socket drops (a phone that locks, a lift, a tunnel): the voice
 *  agent's conversation stays open, and the page comes back to it (resume) with all it was told. */
export const HOLD_MS = 60_000;
/** the calls on now, by their id (the page's to come back with; only for the same person) */
const calls = new Map<string, { who: string; call: ReturnType<typeof voiceCall> }>();
/** how many calls are on now (an update waits for none before the service starts again: SHEP-173) */
export const callsOn = () => calls.size;
/** a call a page comes back to, if it is still holding, for that person */
export function callToResume(id: string, who: string) {
  const c = calls.get(id);
  return c && c.who === who ? c.call : null;
}
/** the words the voice agent gets when the page is back: say so, and say again what was cut */
export const backLine = (secs: number) => ({ type: "user_message",
  text: `[Update] The person's phone lost the call's connection for about ${Math.max(1, Math.round(secs))} s and is back now: they heard nothing of what you said meanwhile. Say you're back in a few words, then repeat briefly anything they missed.` });
/** how long the person and the voice must both be quiet before the call says its updates (ms) */
export const QUIET_MS = 1200;
/** loud enough to be speech: RMS of 16-bit samples above ~2% of full scale */
const SPEECH = 650;
/** whether a piece of 16-bit PCM is someone talking */
export function talking(pcm: Uint8Array) {
  const b = pcm.byteOffset % 2 ? pcm.slice() : pcm;
  const s = new Int16Array(b.buffer, b.byteOffset, b.length >> 1);
  let sum = 0;
  for (let i = 0; i < s.length; i += 4) sum += s[i] * s[i];
  return Math.sqrt(sum / Math.max(1, s.length >> 2)) > SPEECH;
}
export type CallDeps = {
  io: VoiceIO;
  /** what the call hears: chats it sent to or the one on screen, and needs anywhere (voice-hear.ts) */
  hear: HearIO;
  /** the call's start: where it is (the page tells what it shows as it moves) */
  where: Where;
  /** the voice agent's socket address (default: a signed ElevenLabs one for the person's key; a test's fake) */
  dial?: () => Promise<string>;
  /** how long an open waits for the page to say it shows it (ms) */
  navWait?: number;
  /** how long the call holds for its page to come back (ms) */
  holdMs?: number;
  /** who called (a page comes back only as them) */
  who?: string;
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
  return { device: s(m.device, 20), place: s(m.place), task: s(m.task), tab: s(m.tab, 40), artifact: s(m.artifact), settings: m.settings === true, ...(typeof m.full === "boolean" ? { full: m.full } : {}) };
}

/** One call: the page's audio to the voice agent and back. message(): a frame from the page; end(): the page went. */
export function voiceCall(hub: Hub, deps: CallDeps, first: Page) {
  const { io } = deps;
  // the page on the call now; none while its socket is down and the call holds for it (SHEP-102)
  let page: Page | null = first, gone = 0, hold: ReturnType<typeof setTimeout> | null = null;
  const id = crypto.randomUUID();
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
  const hear = hearing(deps.hear);
  // when the person last talked, until when the voice is talking, and whether it still owes the person an answer
  // (SHEP-113: their ask comes first): updates wait for a quiet moment after it
  let heardAt = 0, speakUntil = 0, busy = 0;
  const turn = turnGate();
  // SHEP-173: hang_up ends the call only right after the person's yes; once it may, the call closes after its last words
  const guard = hangUpGuard();
  let hangingUp = 0;
  const tell = (m: object) => { try { page?.send(JSON.stringify(m)); } catch {} };
  const toVoice = (m: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
  const here = () => { const s = io.snap(); return s ? lookHere(s, where) : ""; };
  let doing = "";
  let said = "", saying: ReturnType<typeof setTimeout> | null = null;
  const end = (why: string | null = null) => {
    if (ended) return;
    ended = true;
    calls.delete(id);
    if (hold) clearTimeout(hold);
    clearInterval(watch);
    if (saying) clearTimeout(saying);
    if (closing) clearInterval(closing);
    hear.stop();
    for (const done of [...waiting.values()]) done({ ok: false, why: "the call ended" });
    if (why) tell({ type: "error", message: why });
    try { ws?.close(); } catch {}
    try { page?.close(); } catch {}
    page = null;
  };
  // the agent hung up (the person's yes): its "Bye." plays out, then the call ends with no error (the page chimes)
  let closing: ReturnType<typeof setInterval> | null = null;
  const hangUp = () => {
    if (closing || ended) return;
    hangingUp = Date.now();
    closing = setInterval(() => {
      const t = Date.now();
      if ((t - hangingUp > 1500 && t > speakUntil + 600) || t - hangingUp > 10000) { tell({ type: "ended" }); end(); }
    }, 250);
  };
  calls.set(id, { who: deps.who ?? "", call: null as any });
  tell({ type: "call", id });
  // what the call hears (the chats it follows, needs anywhere), said once nobody is talking
  hear.onScreen(where);
  const watch = setInterval(() => {
    if (ended) return;
    hear.onScreen(where);
    hear.tick();
    const t = Date.now();
    if (ws?.readyState === WebSocket.OPEN && !turn.holding(t) && t - heardAt > QUIET_MS && t > speakUntil + QUIET_MS) for (const line of hear.take()) toVoice(line);
  }, 1000);

  (async () => {
    const signed_url = await (deps.dial ?? (() => dialElevenLabs(hub)))();
    if (ended) return;
    ws = new WebSocket(signed_url);
    ws.onopen = () => { said = here(); toVoice(opening(said)); };
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
      else if (m.type === "user_transcript") { turn.seen("user_transcript"); guard.seen("user_transcript"); tell({ type: "state", state: "thinking" }); }
      else if (m.type === "agent_response") {
        turn.seen("agent_response");
        guard.seen("agent_response", m.agent_response_event?.agent_response);
        // a word before a tool ("On it."): the call is still working on it
        tell(busy ? { type: "state", state: "working", doing } : { type: "state", state: "listening" });
        // what it said, for the call card (SHEP-105: the last thing the voice said)
        const text = m.agent_response_event?.agent_response;
        if (typeof text === "string" && text.trim()) tell({ type: "said", text: text.trim().slice(0, 300) });
      }
      else if (m.type === "audio" && typeof m.audio_event?.audio_base_64 === "string") {
        const pcm = Buffer.from(m.audio_event.audio_base_64, "base64");
        speakUntil = Math.max(speakUntil, Date.now()) + (pcm.length / 2 / 16000) * 1000;
        if (pcm.length % 2 === 0) try { page?.send(new Uint8Array(pcm)); } catch {}
      }
      else if (m.type === "interruption") { speakUntil = 0; tell({ type: "interrupt" }); }
      else if (m.type === "client_tool_call") {
        const c = m.client_tool_call ?? {};
        guard.seen("client_tool_call", String(c.tool_name ?? ""));
        if (c.tool_name === "hang_up") {
          const may = guard.may();
          toVoice({ type: "client_tool_result", tool_call_id: c.tool_call_id, result: may ? HUNG_UP : REFUSED, is_error: !may });
          if (may) hangUp();
          return;
        }
        // SHEP-113: the call shows what it is doing, in plain words ("Working: checking tasks")
        doing = toolWords(String(c.tool_name ?? ""), c.parameters ?? {});
        turn.seen("client_tool_call");
        tell({ type: "state", state: "working", doing });
        busy++;
        const asked = Date.now();
        try {
          const a = await shown(await voiceTool(String(c.tool_name ?? ""), c.parameters ?? {}, where, io), show);
          if (a.sent) hear.sentTo(a.sent, asked);
          toVoice({ type: "client_tool_result", tool_call_id: c.tool_call_id, result: a.result, is_error: !!a.error });
        } finally {
          busy--;
          turn.seen("client_tool_result");
          // its answer next
          if (!busy && !ended) tell({ type: "state", state: "thinking" });
        }
      }
    };
    // an error is followed by its close, which says why
    ws.onerror = () => {};
    ws.onclose = (e) => {
      if (ended) return;
      // the person said yes and the agent hung up: its last words play out, no note
      if (hangingUp) { tell({ type: "ended" }); return end(); }
      // SHEP-173: else it ended on its own (a limit, a long silence, the line): its last words play out, then the page
      // says why in plain words ("Call ended: ...") with Call again
      tell({ type: "ended", why: closeWords(e.code, e.reason) });
      end();
    };
  })().catch((err) => end(String(err?.message ?? err)));

  const call = {
    id,
    /** the page's socket closed without an end: the call holds for it (a locked phone's dropped socket comes back) */
    detach(from: Page) {
      if (ended || page !== from) return;
      page = null;
      gone = Date.now();
      hold = setTimeout(() => end(), deps.holdMs ?? HOLD_MS);
    },
    /** the page came back (its socket again, with the call's id): it gets the call where it is, the agent says so */
    attach(to: Page) {
      if (ended) return false;
      if (hold) { clearTimeout(hold); hold = null; }
      const old = page;
      page = to;
      if (old && old !== to) try { old.close(); } catch {}
      tell({ type: "resumed", id });
      if (gone) { toVoice(backLine((Date.now() - gone) / 1000)); gone = 0; }
      return true;
    },
    /** the page's microphone: 16 kHz PCM (the page cancels its own speaker's echo, so the person can talk over it);
     *  or, as text, where the page is now ({ type: "where", place, task, tab, artifact, settings, device }), or what
     *  it did with an open or a screen action ({ type: "navved", id, ok, why?, where?, did?, ask?, screen? }) */
    message(data: string | Buffer | ArrayBuffer) {
      if (ended) return;
      if (typeof data === "string") {
        let m: any = null;
        try { m = JSON.parse(data); } catch {}
        if (m?.type === "navved" && typeof m.id === "number") {
          if (m.where && typeof m.where === "object") where = { ...where, ...pageWhere(m.where) };
          // a screen action's answer says what it did, what to ask first, and the screen now (core/screen.js)
          const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
          waiting.get(m.id)?.({ ok: m.ok === true, why: typeof m.why === "string" ? m.why.slice(0, 300) : null, did: str(m.did, 300), ask: str(m.ask, 300), screen: str(m.screen, 4000) });
          return;
        }
        // the person ended the call (End, or the lock screen's hang up): no holding for the page
        if (m?.type === "end") return end();
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
      if (talking(pcm)) heardAt = Date.now();
      ws.send(JSON.stringify({ user_audio_chunk: pcm.toString("base64") }));
    },
    end: () => end(),
  };
  calls.get(id)!.call = call;
  return call;
}
