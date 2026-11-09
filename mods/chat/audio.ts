// The window's microphone and speaker (core/audio.js says which and in what words): pw-record and pw-play on Linux,
// herdr-audio on macOS, built here from mac-audio.swift with the Mac's swiftc into <app home>/data/chat-audio/<hash>/
// (once per change of the helper; a few seconds the first time). Used by record.ts (dictation) and voice.ts (calls:
// callAudio, echo-free on a Mac, else or as its fallback the mic and speaker apart).
//   bun audio.ts warm      builds it now if this is a Mac and it isn't built yet (the chat starts this, so the first
//                          dictation doesn't wait)

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { audioKind, audioWords, micArgs, speakerArgs, callArgs, buildArgs, PLIST, HELPER } from "./core/audio.js";

const SRC = join(import.meta.dir, "mac-audio.swift");
const DATA = join(import.meta.dir, "..", "..", "data", "chat-audio");

export type Audio = { kind: "pipewire" | "mac"; mic: (rate: number) => string[]; speaker: (rate: number) => string[];
  /** On a Mac: asks for the microphone (macOS's prompt the first time); exits 3 when it isn't allowed. */
  access: string[] | null;
  /** On a Mac: a call's mic and speaker in one, echo-free (core/audio.js callArgs); null elsewhere. */
  call: ((inRate: number, outRate: number) => string[]) | null };

/** This machine's mic and speaker commands, building herdr-audio first on a Mac; throws the words when it can't. */
export async function audio(): Promise<Audio> {
  const kind = audioKind(process.platform, (t: string) => Boolean(Bun.which(t))) as Audio["kind"] | null;
  if (!kind) throw new Error(audioWords("mic", "pipewire"));
  const helper = kind === "mac" ? await built() : HELPER;
  return { kind, mic: (rate) => micArgs(kind, rate, helper), speaker: (rate) => speakerArgs(kind, rate, helper),
    access: kind === "mac" ? [helper, "access"] : null,
    call: kind === "mac" ? (i, o) => callArgs(kind, i, o, helper)! : null };
}

/** The words for a mac helper that ended on its own: its exit code and stderr; null when it was fine or killed. */
export function ended(what: "mic" | "speaker", code: number | null, stderr: string): string | null {
  if (code === null || code === 0 || code >= 128) return null;
  return audioWords(what, code, stderr.replace(/^herdr-audio:\s*/, ""));
}

// ---- a call's sound -------------------------------------------------------------------------
// On a Mac, one herdr-audio call: the mic stays open while the agent speaks (Apple's echo cancellation), so the person
// can talk over it; a talked-over agent's queued voice is dropped with SIGUSR1. If that can't run (no voice processing,
// it never sends a sound, or it ends in any way), the call goes on quietly the old way: the mic and the speaker apart,
// the caller hushing the mic while the agent speaks (echoFree() says which). Elsewhere: apart from the start.

type Proc = ReturnType<typeof Bun.spawn>;
export type CallSound = {
  /** The mic stays open while the agent speaks (no need to hush it). */
  echoFree: () => boolean;
  play: (pcm: Uint8Array) => void;
  /** Talked over: what's queued to play goes. */
  drop: () => void;
  stop: () => void;
};

/** heard: the mic's raw 16-bit mono at inRate, as it comes; failed: the words when the mic or speaker can't go on. */
export function callAudio(tools: Audio, inRate: number, outRate: number,
  on: { heard: (pcm: Uint8Array) => void; failed: (why: string) => void; fellBack?: (why: string) => void },
  firstSoundMs = 8000): CallSound {
  const mac = tools.kind === "mac";
  let stopped = false;
  let both: Proc | null = null, mic: Proc | null = null, player: Proc | null = null;
  const errText = (p: Proc) => new Response(p.stderr as ReadableStream).text().catch(() => "");

  function apart(why: string) {
    if (stopped) return;
    on.fellBack?.(why);
    let m: Proc;
    try { m = Bun.spawn(tools.mic(inRate), { stdout: "pipe", stderr: mac ? "pipe" : "ignore" }); }
    catch (e: any) { return on.failed(audioWords("mic", "", String(e?.message ?? e))); }
    mic = m;
    void (async () => {
      try { for await (const part of m.stdout as unknown as AsyncIterable<Uint8Array>) { if (stopped) break; on.heard(part); } } catch {}
      // a mic that stopped by itself (not allowed, unplugged) ends the call with why
      if (stopped || !mac) return;
      const why = ended("mic", await m.exited, await errText(m));
      if (why) on.failed(why);
    })();
  }

  function startPlayer() {
    const p = Bun.spawn(tools.speaker(outRate), { stdin: "pipe", stdout: "ignore", stderr: mac ? "pipe" : "ignore" });
    player = p;
    // a speaker that can't play ends the call with why (one killed for talking over isn't that)
    if (mac) void p.exited.then(async (code) => {
      const why = ended("speaker", code, await errText(p));
      if (why && player === p && !stopped) on.failed(why);
    });
  }

  if (tools.call) {
    try {
      const b = both = Bun.spawn(tools.call(inRate, outRate), { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      let heard = false;
      // about 1.4 s to start; nothing at all for much longer: stuck, so apart instead
      const stuck = setTimeout(() => { if (!heard) b.kill(); }, firstSoundMs);
      void (async () => {
        try { for await (const part of b.stdout as unknown as AsyncIterable<Uint8Array>) { if (stopped || both !== b) break; heard = true; on.heard(part); } } catch {}
      })();
      // it ended (on its own or stuck): apart from now on, its reason only for the log (a moment's wait at most)
      void b.exited.then(async (code) => {
        clearTimeout(stuck);
        if (stopped || both !== b) return;
        both = null;
        const err = await Promise.race([errText(b), Bun.sleep(300).then(() => "")]);
        apart(err.trim().replace(/^herdr-audio:\s*/, "") || (heard ? `ended (${code})` : `no sound (${code})`));
      });
    } catch (e: any) { both = null; apart(String(e?.message ?? e)); }
  } else apart("");

  return {
    echoFree: () => both !== null,
    play(pcm) {
      if (stopped) return;
      if (!both && !player) startPlayer();
      const p = both ?? player;
      try { (p!.stdin as any).write(pcm); (p!.stdin as any).flush?.(); } catch {}
    },
    drop() {
      if (both) { try { both.kill("SIGUSR1"); } catch {} return; }
      player?.kill();
      player = null;
    },
    stop() {
      stopped = true;
      both?.kill(); mic?.kill(); player?.kill();
    },
  };
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
