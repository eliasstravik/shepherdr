// Dictation's recorder (mods/chat dictate.js): records the default microphone (audio.ts: pw-record on Linux, the
// Mac's own herdr-audio on macOS) and keeps the audio until it is told how to end, writing the mic's level as it goes.
//   bun record.ts <out.wav> <level file>
// SIGINT: write <out.wav> (16 kHz mono 16-bit) and exit. SIGTERM: throw it away and exit.
// The level file holds one number, 0..1, updated ten times a second; or "!" and the words when the mic can't work
// (not allowed on a Mac, none there, no recorder), and this ends.
// SHEP-63: the words are also written while you speak: the audio streams to ElevenLabs' realtime speech to text (the
// key from key.ts, in memory only), and on SIGINT the last words are asked for and written to <out.wav>.txt as
// { text } (a moment later, however long it was). No .txt: the live words didn't come, so transcribe.ts uploads the wav.

import { writeFileSync } from "node:fs";
import { liveUrl, liveChunk, liveWords, LIVE_TAIL, LIVE_WAIT } from "./core/voice.js";
import { keyFor } from "./key.ts";
import { audio, ended } from "./audio.ts";

const [out, levelFile] = process.argv.slice(2);
if (!out || !levelFile) { console.error("usage: bun record.ts <out.wav> <level file>"); process.exit(2); }
const RATE = 16000;
const chunks: Uint8Array[] = [];
let bytes = 0, peak = 0, wrote = 0;
const cant = (words: string) => { try { writeFileSync(levelFile, `!${words}`); } catch {} process.exit(1); };
const tools = await audio().catch((e) => cant(String(e?.message ?? e)));
const mic = Bun.spawn(tools!.mic(RATE), { stdout: "pipe", stderr: tools!.kind === "mac" ? "pipe" : "ignore" });

function wav(): Buffer {
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + bytes, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(bytes, 40);
  return Buffer.concat([head, ...chunks.map((c) => Buffer.from(c))]);
}

// The live words: a socket opened as soon as the key is found; audio kept until then, sent about every 100 ms.
const words = liveWords();
let ws: WebSocket | null = null, broken = false, landed: ((t: string | null) => void) | null = null;
let queue: string[] = [], held: Uint8Array[] = [], heldBytes = 0;
const fail = () => { broken = true; queue = []; landed?.(null); landed = null; try { ws?.close(); } catch {} };
const send = (m: string) => { if (broken) return; if (ws?.readyState === WebSocket.OPEN) ws.send(m); else queue.push(m); };
// (whole samples only: an odd byte waits for the next piece)
const flush = () => {
  if (heldBytes < 2) return;
  const buf = Buffer.concat(held.map((c) => Buffer.from(c)));
  const n = buf.length & ~1;
  send(liveChunk(buf.subarray(0, n).toString("base64")));
  held = n < buf.length ? [buf.subarray(n)] : [];
  heldBytes = buf.length - n;
};
(async () => {
  const k = await keyFor().catch(() => null);
  if (!k || "error" in k || broken) return fail();
  ws = new WebSocket(liveUrl(), { headers: { "xi-api-key": k.key } } as any);
  ws.onopen = () => { for (const m of queue) ws!.send(m); queue = []; };
  ws.onmessage = (e) => {
    const r = words.hear(String(e.data));
    if (r === "failed") fail();
    else if (r === "words") { landed?.(words.text()); landed = null; }
  };
  ws.onerror = () => fail();
  ws.onclose = () => fail();
})();
/** Done's last words: all the text, or null (they can't come: the wav is uploaded instead). */
const finish = () => new Promise<string | null>((res) => {
  if (broken) return res(null);
  const t = setTimeout(() => { landed = null; fail(); res(null); }, LIVE_WAIT);
  landed = (text) => { clearTimeout(t); res(text); };
  flush();
  words.done();
  send(liveChunk(Buffer.from(LIVE_TAIL).toString("base64"), true));
});

let ending = false;
process.on("SIGINT", async () => {
  if (ending) return;
  ending = true;
  mic.kill();
  writeFileSync(out, wav());
  try { writeFileSync(levelFile, "0"); } catch {}
  const text = await finish();
  if (text !== null) writeFileSync(`${out}.txt`, JSON.stringify({ text }));
  process.exit(0);
});
process.on("SIGTERM", () => { mic.kill(); process.exit(0); });

for await (const part of mic.stdout as ReadableStream<Uint8Array>) {
  if (ending) break;
  chunks.push(part);
  bytes += part.length;
  held.push(part);
  heldBytes += part.length;
  if (heldBytes >= 3200) flush();
  // Loudness of what just came in (RMS, scaled so speech fills most of 0..1).
  const pcm = new Int16Array(part.slice(0, part.length & ~1).buffer);
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 2) sum += pcm[i] * pcm[i];
  const rms = Math.sqrt(sum / Math.max(1, pcm.length >> 1)) / 32768;
  peak = Math.max(peak, Math.min(1, rms * 8));
  if (Date.now() - wrote >= 100) {
    try { writeFileSync(levelFile, peak.toFixed(3)); } catch {}
    wrote = Date.now();
    peak = 0;
  }
}
// The mic ended by itself (on a Mac: not allowed, or no microphone): say why, unless Done or Cancel ended it.
if (!ending) {
  const code = await mic.exited;
  const why = tools!.kind === "mac" ? ended("mic", code, await new Response(mic.stderr as ReadableStream).text().catch(() => "")) : null;
  if (why && !ending) cant(why);
}
