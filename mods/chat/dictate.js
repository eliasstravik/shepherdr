// Dictation into the message box: record.ts records the default microphone (audio.ts: pw-record, or the Mac's own) and
// reports its level, transcribe.ts has ElevenLabs write it down (Scribe, with the voice call's key:
// Settings › Secrets, read from the machine that keeps them into memory only). The text goes into
// the box to edit; nothing is sent by itself or kept.
// SHEP-63: record.ts also streams the audio to ElevenLabs' realtime speech to text while you speak, so on Done the
// words come a moment later (its <file>.txt); only when they can't does transcribe.ts upload the recording. Cancel
// works while it writes too: each recording has its own files, so a dropped one can't touch the next.

import { exec, appHome, readTextFile } from "herdr";

const DIR = () => `${appHome()}/data/chat-dictation`;

// bun where the window's PATH may lack it (a Mac app opened from the Dock gets only the system's folders); after the
// PATH it has, so a machine that finds bun already finds the same one.
export const BUN_PATH = 'PATH="$PATH:$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"; export PATH; ';

// On a Mac the mic is herdr-audio, built once (audio.ts): built now in the background, so the first dictation or call
// doesn't wait for it. Nothing on Linux.
let warmed = false;
export function warmAudio() {
  if (warmed) return;
  warmed = true;
  exec("sh", ["-c", `${BUN_PATH}[ "$(uname)" = Darwin ] && { bun "$1" warm </dev/null >/dev/null 2>&1 & }; true`, "x", `${appHome()}/mods/chat/audio.ts`]).catch(() => {});
}

export class Dictation {
  constructor(key) {
    this.key = key.replace(/[^\w.-]/g, "_");
    this.state = "idle"; // idle | recording | writing
    this.error = null;
    this.run = null;
    this.n = 0; // this recording's number: a cancelled one's late answer is dropped
    this.took = null; // the last Done to words: { how: "live" | "upload", ms }
  }

  get file() { return `${DIR()}/${this.key}-${this.n}.wav`; }

  get levelFile() { return `${DIR()}/${this.key}-${this.n}.level`; }

  // Starts recording; resolves when it has started (or failed to).
  async start() {
    if (this.state !== "idle") return;
    this.error = null;
    this.state = "recording";
    this.n = Date.now();
    this.started = Date.now();
    this.doneAt = 0;
    // record.ts runs until told how to end (SIGINT keeps the audio, SIGTERM drops it); its pid
    // goes beside the file.
    this.run = exec("sh", ["-c", BUN_PATH + 'mkdir -p "$(dirname "$1")" && rm -f "$1" "$2" "$1.txt" && { bun "$3" "$1" "$2" </dev/null >/dev/null 2>&1 & echo $! > "$1.pid"; wait; }',
      "x", this.file, this.levelFile, `${appHome()}/mods/chat/record.ts`]).catch(() => null);
  }

  // How loud the microphone is now, 0..1 (record.ts writes it ten times a second). When the mic can't work (record.ts
  // wrote "!" and why: not allowed on a Mac, no microphone), the recording stops and the box says why.
  async level() {
    const s = (await readTextFile(this.levelFile).catch(() => null)) ?? "0";
    if (s.startsWith("!") && this.state === "recording") {
      this.cancel();
      this.error = s.slice(1).trim() || "The microphone didn't start.";
      return 0;
    }
    const v = Number(s);
    return Number.isFinite(v) ? v : 0;
  }

  // Stops recording and writes it down. Resolves with the text ("" when nothing was heard or it was cancelled).
  async stop() {
    if (this.state !== "recording") return "";
    this.state = "writing";
    this.doneAt = Date.now();
    const n = this.n, file = this.file, levelFile = this.levelFile, run = this.run;
    const mine = () => this.n === n && this.state === "writing";
    try {
      await exec("sh", ["-c", 'p=$(cat "$1.pid" 2>/dev/null) && kill -INT "$p" 2>/dev/null; rm -f "$1.pid"; true', "x", file]);
      await run;
      if (!mine()) return "";
      // the live words (record.ts), else the recording uploaded
      let said = null;
      try { said = JSON.parse((await readTextFile(`${file}.txt`).catch(() => null)) ?? ""); } catch {}
      let how = "live";
      if (typeof said?.text !== "string") {
        how = "upload";
        const r = await exec("sh", ["-c", BUN_PATH + 'bun "$1" "$2" </dev/null 2>/dev/null', "x", `${appHome()}/mods/chat/transcribe.ts`, file]);
        try { said = JSON.parse(r.stdout.trim().split("\n").pop()); } catch { said = null; }
      }
      if (!mine()) return "";
      this.took = { how, ms: Date.now() - this.doneAt };
      if (typeof said?.text === "string") return said.text;
      throw new Error(typeof said?.error === "string" && said.error ? said.error : "Couldn't write that down. Try again.");
    } catch (e) {
      if (mine()) this.error = String(e?.message ?? e);
      return "";
    } finally {
      if (this.n === n) this.state = "idle";
      exec("rm", ["-f", file, levelFile, `${file}.txt`]);
    }
  }

  // Throws the recording away (Cancel, a call starting, or the chat closing), also while it's being written down.
  cancel() {
    if (this.state === "recording") exec("sh", ["-c", 'p=$(cat "$1.pid" 2>/dev/null) && kill -TERM "$p" 2>/dev/null; rm -f "$1.pid" "$1" "$2"; true', "x", this.file, this.levelFile]);
    if (this.state !== "idle") this.n += 1;
    this.state = "idle";
  }
}
