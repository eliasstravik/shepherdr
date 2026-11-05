// Dictation into the message box: record.ts records the default microphone (pw-record) and
// reports its level, transcribe.ts has ElevenLabs write it down (Scribe, with the voice call's key:
// Settings › Secrets, read from the machine that keeps them into memory only). The text goes into
// the box to edit; nothing is sent by itself or kept.

import { exec, appHome, readTextFile } from "herdr";

const DIR = () => `${appHome()}/data/chat-dictation`;

export class Dictation {
  constructor(key) {
    this.key = key.replace(/[^\w.-]/g, "_");
    this.state = "idle"; // idle | recording | writing
    this.error = null;
    this.run = null;
  }

  get file() { return `${DIR()}/${this.key}.wav`; }

  get levelFile() { return `${DIR()}/${this.key}.level`; }

  // Starts recording; resolves when it has started (or failed to).
  async start() {
    if (this.state !== "idle") return;
    this.error = null;
    this.state = "recording";
    this.started = Date.now();
    // record.ts runs until told how to end (SIGINT keeps the audio, SIGTERM drops it); its pid
    // goes beside the file.
    this.run = exec("sh", ["-c", 'mkdir -p "$(dirname "$1")" && rm -f "$1" "$2" && { bun "$3" "$1" "$2" </dev/null >/dev/null 2>&1 & echo $! > "$1.pid"; wait; }',
      "x", this.file, this.levelFile, `${appHome()}/mods/chat/record.ts`]).catch(() => null);
  }

  // How loud the microphone is now, 0..1 (record.ts writes it ten times a second).
  async level() {
    const v = Number((await readTextFile(this.levelFile).catch(() => null)) ?? 0);
    return Number.isFinite(v) ? v : 0;
  }

  // Stops recording and writes it down. Resolves with the text ("" when nothing was heard).
  async stop() {
    if (this.state !== "recording") return "";
    this.state = "writing";
    try {
      await exec("sh", ["-c", 'p=$(cat "$1.pid" 2>/dev/null) && kill -INT "$p" 2>/dev/null; rm -f "$1.pid"; true', "x", this.file]);
      await this.run;
      const r = await exec("sh", ["-c", 'bun "$1" "$2" </dev/null 2>/dev/null', "x", `${appHome()}/mods/chat/transcribe.ts`, this.file]);
      let said = null;
      try { said = JSON.parse(r.stdout.trim().split("\n").pop()); } catch {}
      if (typeof said?.text === "string") return said.text;
      throw new Error(typeof said?.error === "string" && said.error ? said.error : "Couldn't write that down. Try again.");
    } catch (e) {
      this.error = String(e?.message ?? e);
      return "";
    } finally {
      this.state = "idle";
      exec("rm", ["-f", this.file, this.levelFile]);
    }
  }

  // Throws the recording away (Cancel, a call starting, or the chat closing).
  cancel() {
    if (this.state === "recording") exec("sh", ["-c", 'p=$(cat "$1.pid" 2>/dev/null) && kill -TERM "$p" 2>/dev/null; rm -f "$1.pid" "$1" "$2"; true', "x", this.file, this.levelFile]);
    this.state = "idle";
  }
}
