// The window's microphone and speaker (core/audio.js says which and in what words): pw-record and pw-play on Linux,
// herdr-audio on macOS, built here from mac-audio.swift with the Mac's swiftc into <app home>/data/chat-audio/<hash>/
// (once per change of the helper; a few seconds the first time). Used by record.ts (dictation) and voice.ts (calls).
//   bun audio.ts warm      builds it now if this is a Mac and it isn't built yet (the chat starts this, so the first
//                          dictation doesn't wait)

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { audioKind, audioWords, micArgs, speakerArgs, buildArgs, PLIST, HELPER } from "./core/audio.js";

const SRC = join(import.meta.dir, "mac-audio.swift");
const DATA = join(import.meta.dir, "..", "..", "data", "chat-audio");

export type Audio = { kind: "pipewire" | "mac"; mic: (rate: number) => string[]; speaker: (rate: number) => string[];
  /** On a Mac: asks for the microphone (macOS's prompt the first time); exits 3 when it isn't allowed. */
  access: string[] | null };

/** This machine's mic and speaker commands, building herdr-audio first on a Mac; throws the words when it can't. */
export async function audio(): Promise<Audio> {
  const kind = audioKind(process.platform, (t: string) => Boolean(Bun.which(t))) as Audio["kind"] | null;
  if (!kind) throw new Error(audioWords("mic", "pipewire"));
  const helper = kind === "mac" ? await built() : HELPER;
  return { kind, mic: (rate) => micArgs(kind, rate, helper), speaker: (rate) => speakerArgs(kind, rate, helper),
    access: kind === "mac" ? [helper, "access"] : null };
}

/** The words for a mac helper that ended on its own: its exit code and stderr; null when it was fine or killed. */
export function ended(what: "mic" | "speaker", code: number | null, stderr: string): string | null {
  if (code === null || code === 0 || code >= 128) return null;
  return audioWords(what, code, stderr.replace(/^herdr-audio:\s*/, ""));
}

/** herdr-audio's path, built when missing (one build at a time: a second caller waits for the first). */
async function built(): Promise<string> {
  const src = readFileSync(SRC);
  const hash = createHash("sha256").update(src).update(PLIST).update(process.arch).digest("hex").slice(0, 16);
  const dir = join(DATA, hash), exe = join(dir, HELPER), lock = `${dir}.building`;
  try { mkdirSync(DATA, { recursive: true }); } catch (e: any) { throw new Error(audioWords("mic", "build", String(e?.message ?? e))); }
  // every retry waits a moment, and it gives up after about three minutes
  for (let tries = 0; !existsSync(exe); tries++) {
    if (tries > 0) await Bun.sleep(100);
    if (tries > 1800) throw new Error(audioWords("mic", "build", "it took too long"));
    try {
      mkdirSync(lock); // ours to build
    } catch (e: any) {
      if (e?.code !== "EEXIST") throw new Error(audioWords("mic", "build", String(e?.message ?? e)));
      // another build is on: wait for it (a stale one, over two minutes old, is taken over)
      try { if (Date.now() - statSync(lock).mtimeMs > 120_000) rmSync(lock, { recursive: true, force: true }); } catch {}
      continue;
    }
    try {
      if (!Bun.which("swiftc")) throw new Error(audioWords("mic", "tools"));
      const plist = join(lock, "Info.plist"), out = join(lock, HELPER);
      writeFileSync(plist, PLIST);
      const p = Bun.spawn(buildArgs(SRC, plist, out), { stdout: "ignore", stderr: "pipe" });
      const err = await new Response(p.stderr).text();
      if ((await p.exited) !== 0) {
        // swiftc without the command line tools behind it (the stub that offers to install them)
        if (/xcode-select|developer tools|no developer/i.test(err)) throw new Error(audioWords("mic", "tools"));
        throw new Error(audioWords("mic", "build", err.split("\n").find((l) => /error/.test(l)) ?? err));
      }
      rmSync(plist);
      rmSync(dir, { recursive: true, force: true });
      renameSync(lock, dir);
      // older builds go (another hash: an earlier mac-audio.swift)
      for (const f of readdirSync(DATA)) if (f !== hash && !f.endsWith(".building")) rmSync(join(DATA, f), { recursive: true, force: true });
    } finally {
      rmSync(lock, { recursive: true, force: true });
    }
  }
  return exe;
}

if (import.meta.main && process.argv[2] === "warm") {
  if (process.platform === "darwin" && !Bun.which("pw-record")) await audio().catch(() => {});
}
