// Dictation from the web: the phone or browser records, the service has ElevenLabs write it down (Scribe, core/voice.js
// transcribe) with the same key as a voice call (voice.ts keyFor: here, or read from the machine that keeps the secrets
// into memory only), as the window's dictation does (mods/chat/transcribe.ts). Nothing is kept; the key is never logged.
import type { Hub } from "./hub.ts";
import * as V from "../core/voice.js";
import { keyFor } from "./voice.ts";

const { transcribe } = V as any;

/** a name for the upload from its type (ElevenLabs reads the audio itself; the name only helps) */
export const fileName = (type: string) => `dictation.${/mp4|m4a|aac/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : /wav/.test(type) ? "wav" : /mpeg|mp3/.test(type) ? "mp3" : "webm"}`;

export function dictate(hub: Pick<Hub, "call">, audio: Blob, fetchFn: typeof fetch = fetch, key = () => keyFor(hub)): Promise<string> {
  return transcribe(audio, key, fetchFn, fileName(audio.type));
}
