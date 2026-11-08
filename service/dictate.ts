// Dictation from the web: the phone or browser records, the service has ElevenLabs write it down (Scribe, core/voice.js
// transcribe) with the same key as a voice call (voice.ts keyFor: here, or read from the machine that keeps the secrets
// into memory only), as the window's dictation does (mods/chat/transcribe.ts). Nothing is kept; the key is never logged.
// SHEP-63: the words are written live while the person speaks (core/voice.js liveWords): the page asks here for a
// single-use token as it starts recording (liveToken), and only uploads the recording (dictate) if that fails. The key
// is kept in this process's memory for a while (cachedKey), so neither waits on the machine that keeps the secrets.
import type { Hub } from "./hub.ts";
import * as V from "../core/voice.js";
import { keyFor } from "./voice.ts";

const { transcribe, liveTokenRequest, sttError, dictateKeyError } = V as any;

type Key = { key: string; agent?: string } | { error: string; why: string };

/** a name for the upload from its type (ElevenLabs reads the audio itself; the name only helps) */
export const fileName = (type: string) => `dictation.${/mp4|m4a|aac/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : /wav/.test(type) ? "wav" : /mpeg|mp3/.test(type) ? "mp3" : "webm"}`;

/** How long a found key is kept in memory: a key changed in Settings › Secrets is used after at most this long (and at
 *  once if ElevenLabs refuses the old one). */
export const KEY_KEEP = 10 * 60_000;

/** The key, found once and then kept in memory only (never on disk or in a log) for KEY_KEEP; a failed lookup isn't
 *  kept. forget() drops it (ElevenLabs said 401). */
export function keyCache(find: () => Promise<Key>, keep = KEY_KEEP, now = () => Date.now()) {
  let kept: { at: number; key: Promise<Key> } | null = null;
  const get = () => {
    if (kept && now() - kept.at < keep) return kept.key;
    const mine = { at: now(), key: find().catch((e) => ({ error: String(e?.message ?? e), why: "unreachable" }) as Key) };
    kept = mine;
    mine.key.then((k) => { if ("error" in k && kept === mine) kept = null; });
    return mine.key;
  };
  return { get, forget: () => { kept = null; } };
}

let cache: ReturnType<typeof keyCache> | null = null;
export const cachedKey = (hub: Pick<Hub, "call">) => (cache ??= keyCache(() => keyFor(hub)));
/** a refused key: found again next time */
export const refused = (e: unknown) => { if (/\b401\b|invalid.*key|unauthori/i.test(String((e as Error)?.message ?? e))) cache?.forget(); };

export async function dictate(hub: Pick<Hub, "call">, audio: Blob, fetchFn: typeof fetch = fetch, key = () => cachedKey(hub).get()): Promise<string> {
  try { return await transcribe(audio, key, fetchFn, fileName(audio.type)); } catch (e) { refused(e); throw e; }
}

/** A single-use token for one live dictation from the page (it expires in minutes and opens one session only). */
export async function liveToken(hub: Pick<Hub, "call">, fetchFn: typeof fetch = fetch, key = () => cachedKey(hub).get()): Promise<string> {
  const k = await key();
  if ("error" in k) throw new Error(dictateKeyError(k));
  const { url, init } = liveTokenRequest(k.key);
  let r: Response;
  try { r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(10000) }); }
  catch { throw new Error("Can't reach ElevenLabs. Check this machine's internet, then try again."); }
  const body = await r.text().catch(() => "");
  if (!r.ok) { const e = new Error(sttError(r.status, body)); if (r.status === 401) cache?.forget(); throw e; }
  let token = "";
  try { token = JSON.parse(body)?.token; } catch {}
  if (typeof token !== "string" || !/^[\w.-]{8,400}$/.test(token)) throw new Error("ElevenLabs gave no token.");
  return token;
}
