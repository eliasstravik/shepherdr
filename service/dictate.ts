// Dictation from the web: the phone or browser records, the service writes it down with whisper.cpp, as the window's
// dictation does (mods/chat/dictate.js: the same whisper and model, data/whisper/ggml-base.bin, the same flags and
// clean-up). The audio is turned into 16 kHz wav with ffmpeg first; nothing is kept.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOME } from "./paths.ts";

const APP = process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app");
const MODEL = join(APP, "data", "whisper", "ggml-base.bin");
const WHISPER = [join(HOME, ".local", "bin", "whisper-cli"), join(HOME, ".local", "bin", "whisper-cpp-cpu"), "/usr/bin/whisper-cli", "/usr/local/bin/whisper-cli", "/opt/homebrew/bin/whisper-cli"].find(existsSync) ?? null;

// as the window's: no [BLANK_AUDIO], (music) and the like, one line
export const clean = (text: string) => text.split("\n").map((l) => l.replace(/\[[^\]]*\]|\([^)]*\)/g, "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

async function run(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

export async function dictate(audio: Blob): Promise<string> {
  if (!WHISPER || !existsSync(MODEL)) throw new Error("Dictation needs whisper.cpp and its model on the Shepherdr machine (shepherdr whisper).");
  if (audio.size > 20 * 1024 * 1024) throw new Error("That recording is too long.");
  const dir = mkdtempSync(join(tmpdir(), "shepherdr-dictate-"));
  try {
    await Bun.write(join(dir, "in"), audio);
    const f = await run(["ffmpeg", "-loglevel", "error", "-i", join(dir, "in"), "-ar", "16000", "-ac", "1", join(dir, "in.wav")]);
    if (f.code !== 0) throw new Error("That recording couldn't be read.");
    const r = await run([WHISPER, "-m", MODEL, "-f", join(dir, "in.wav"), "-l", "auto", "-nt", "-np", "-t", "8"]);
    if (r.code !== 0) throw new Error("whisper.cpp couldn't write it down.");
    return clean(r.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
