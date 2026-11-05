// Dictation's recorder (mods/chat dictate.js): records the default microphone (audio.ts: pw-record on
// Linux, on macOS mic.swift, else ffmpeg) and keeps the audio until it is told how to end, writing the
// mic's level as it goes. No recorder, or a microphone that gives nothing: a plain message on stderr.
//   bun record.ts <out.wav> <level file>
// SIGINT: write <out.wav> (16 kHz mono 16-bit) and exit. SIGTERM: throw it away and exit.
// The level file holds one number, 0..1, updated ten times a second.

import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mac, recorder } from "./audio.ts";

const [out, levelFile] = process.argv.slice(2);
if (!out || !levelFile) { console.error("usage: bun record.ts <out.wav> <level file>"); process.exit(2); }
const RATE = 16000;
const chunks: Uint8Array[] = [];
let bytes = 0, peak = 0, wrote = 0;

const argv = recorder(RATE, dirname(out));
if (!argv) {
  console.error(mac ? "Dictation needs Xcode's command line tools (xcode-select --install) or ffmpeg (brew install ffmpeg) to record"
    : "Dictation needs pw-record (PipeWire) to record: install pipewire");
  process.exit(1);
}
const mic = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore" });

function wav(): Buffer {
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + bytes, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(bytes, 40);
  return Buffer.concat([head, ...chunks.map((c) => Buffer.from(c))]);
}

process.on("SIGINT", () => { mic.kill(); writeFileSync(out, wav()); process.exit(0); });
process.on("SIGTERM", () => { mic.kill(); process.exit(0); });

for await (const part of mic.stdout as ReadableStream<Uint8Array>) {
  chunks.push(part);
  bytes += part.length;
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
// The recorder ended by itself (it is only killed on a signal, which exits first).
if (!bytes) {
  console.error(mac ? "The microphone gave nothing: allow Herdr in System Settings › Privacy & Security › Microphone" : "The microphone gave nothing: check pw-record and the default input");
  process.exit(1);
}
