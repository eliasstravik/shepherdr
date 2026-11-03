// Dictation into the message box, all on this computer: record.ts records the default
// microphone (pw-record) and reports its level, whisper.cpp writes it down. The text goes into the box to edit;
// nothing is sent by itself.
//   whisper-cli or whisper-cpp-cpu (whisper.cpp wrappers in ~/.local/bin, else whisper-cli on the PATH),
//   model: data/whisper/ggml-base.bin (multilingual, about a second for a short message).

import { exec, appHome, home, readTextFile } from "herdr";

const DIR = () => `${appHome()}/data/chat-dictation`;
const MODEL = () => `${appHome()}/data/whisper/ggml-base.bin`;

// The first whisper.cpp that runs here, or null.
let found;
export function whisper() {
  found ??= exec("sh", ["-c", 'for w in "$@"; do w=$(command -v "$w") && "$w" --help >/dev/null 2>&1 && { echo "$w"; exit 0; }; done; true', "x",
    `${home()}/.local/bin/whisper-cli`, `${home()}/.local/bin/whisper-cpp-cpu`, "/usr/bin/whisper-cli", "whisper-cli", "whisper-cpp"])
    .then((r) => r.stdout.trim() || null).catch(() => null);
  return found;
}

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
    const w = await whisper();
    if (!w) { this.error = "Dictation needs whisper.cpp on this computer. Install it, then try again."; return; }
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
      const w = await whisper();
      const r = await exec(w, ["-m", MODEL(), "-f", this.file, "-l", "auto", "-nt", "-np", "-t", "8"]);
      if (r.code !== 0) throw new Error(r.stderr);
      return clean(r.stdout);
    } catch (e) {
      this.error = trouble(String(e?.message ?? e));
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

// What went wrong, in plain words with what to do (whisper.cpp's own words aren't for the person).
// Only its "error:" lines count: it logs loading the model on every run.
function trouble(said) {
  const errors = said.split("\n").filter((l) => /^error:/i.test(l.trim())).join("\n");
  if (/model|context/i.test(errors)) return "Dictation's speech model is missing. Ask the Assistant to set up dictation again.";
  if (/audio|input file/i.test(errors)) return "Nothing was recorded. Check the microphone, then try again.";
  return "Couldn't write that down. Try again.";
}

// whisper's text without its markers for silence and noise ("[BLANK_AUDIO]", "(music)").
function clean(text) {
  return text.split("\n").map((l) => l.replace(/\[[^\]]*\]|\([^)]*\)/g, "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}
