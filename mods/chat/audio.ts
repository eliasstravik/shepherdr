// The machine's microphone and speaker for dictation (record.ts) and voice calls (voice.ts), as raw
// 16-bit mono at a given rate: pw-record and pw-play when they're on the PATH (Linux); on macOS
// mic.swift and speaker.swift, built once with swiftc into the caller's data folder (named by their
// source's hash, so an update rebuilds them); else, for the microphone only, ffmpeg.

import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

export const mac = process.platform === "darwin";

// <name>.swift built for this version of it, or null without the command line tools (swiftc then
// only offers to install them) or when it doesn't build.
function swift(name: string, dir: string): string | null {
  if (!mac || Bun.spawnSync(["xcode-select", "-p"], { stdout: "ignore", stderr: "ignore" }).exitCode !== 0) return null;
  const src = join(import.meta.dir, `${name}.swift`);
  const bin = join(dir, `${name}-${Bun.hash(readFileSync(src)).toString(36)}`);
  if (existsSync(bin)) return bin;
  const tmp = `${bin}.${process.pid}`;
  if (Bun.spawnSync(["swiftc", "-O", src, "-o", tmp], { stdout: "ignore", stderr: "ignore" }).exitCode !== 0) return null;
  renameSync(tmp, bin);
  return bin;
}

/** The default microphone on stdout until killed, or null when there's no way to record. */
export function recorder(rate: number, dir: string): string[] | null {
  if (Bun.which("pw-record")) return ["pw-record", "--rate", String(rate), "--channels", "1", "--format", "s16", "--raw", "-"];
  if (!mac) return null;
  const mic = swift("mic", dir);
  if (mic) return [mic, String(rate)];
  // ffmpeg's avfoundation input keeps only part of the sound on recent macOS: the last resort.
  // The window's PATH can be short: Homebrew's folders too.
  const ffmpeg = Bun.which("ffmpeg") ?? ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((p) => existsSync(p));
  return ffmpeg ? [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "avfoundation", "-i", ":default", "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"] : null;
}

/** Plays stdin on the default output as it comes (killing it stops the sound at once), or null when there's no way. */
export function player(rate: number, dir: string): string[] | null {
  if (Bun.which("pw-play")) return ["pw-play", "--rate", String(rate), "--channels", "1", "--format", "s16", "--raw", "-"];
  const speaker = swift("speaker", dir);
  return speaker ? [speaker, String(rate)] : null;
}
