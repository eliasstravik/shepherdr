// Dictation's writer (mods/chat dictate.js): sends record.ts's recording to ElevenLabs speech to text (Scribe,
// core/voice.js transcribe) with the call's key (key.ts) and prints one JSON line: { text } or { error } in plain words.
//   bun transcribe.ts <recording.wav>
// The key stays in memory: never printed or logged.
import { transcribe } from "./core/voice.js";
import { keyFor } from "./key.ts";

const [file] = process.argv.slice(2);
if (!file) { console.error("usage: bun transcribe.ts <recording.wav>"); process.exit(2); }
try {
  const f = Bun.file(file);
  const audio = (await f.exists()) ? new Blob([await f.arrayBuffer()], { type: "audio/wav" }) : new Blob([]);
  console.log(JSON.stringify({ text: await transcribe(audio, keyFor, fetch, "dictation.wav") }));
} catch (e: any) {
  console.log(JSON.stringify({ error: String(e?.message ?? e) }));
}
