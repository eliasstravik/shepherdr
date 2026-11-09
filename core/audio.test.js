// The window's mic and speaker (core/audio.js, mods/chat/audio.ts): which tool, its arguments and the words people see.
// Dictation's recorder (mods/chat/record.ts) runs for real against a fake pw-record, and without one.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audioKind, audioWords, micArgs, speakerArgs, callArgs, buildArgs, PLIST, HELPER, DENIED, NO_DEVICE, NO_VOICE_PROCESSING } from "./audio.js";
import { ended, callAudio } from "../mods/chat/audio.ts";

test("Linux keeps PipeWire; a Mac gets its own helper", () => {
  expect(audioKind("linux", (t) => t === "pw-record")).toBe("pipewire");
  expect(audioKind("darwin", () => false)).toBe("mac");
  expect(audioKind("linux", () => false)).toBe(null);
  expect(micArgs("pipewire", 16000)).toEqual(["pw-record", "--rate", "16000", "--channels", "1", "--format", "s16", "--raw", "-"]);
  expect(speakerArgs("pipewire", 22050)).toEqual(["pw-play", "--rate", "22050", "--channels", "1", "--format", "s16", "--raw", "-"]);
  expect(micArgs("mac", 16000, "/x/herdr-audio")).toEqual(["/x/herdr-audio", "record", "16000"]);
  expect(speakerArgs("mac", 44100, "/x/herdr-audio")).toEqual(["/x/herdr-audio", "play", "44100"]);
  // a call's echo-free mic and speaker in one: only on a Mac
  expect(callArgs("mac", 16000, 22050, "/x/herdr-audio")).toEqual(["/x/herdr-audio", "call", "16000", "22050"]);
  expect(callArgs("pipewire", 16000, 22050)).toBe(null);
});

test("a denied microphone says where to allow it", () => {
  const w = audioWords("mic", DENIED);
  expect(w).toContain("Privacy & Security › Microphone");
  expect(w).toContain(HELPER);
  expect(ended("mic", DENIED, "herdr-audio: the microphone isn't allowed\n")).toBe(w);
  expect(ended("mic", NO_DEVICE, "herdr-audio: no microphone")).toContain("No microphone found");
  expect(ended("speaker", NO_DEVICE, "herdr-audio: no speaker")).toContain("No speaker found");
  expect(audioWords("mic", "tools")).toContain("xcode-select --install");
  expect(ended("mic", 5, "herdr-audio: the microphone didn't start: busy")).toBe("The microphone stopped (the microphone didn't start: busy).");
});

test("killed or fine is no error", () => {
  expect(ended("mic", 0, "")).toBe(null);
  expect(ended("speaker", null, "")).toBe(null);
  expect(ended("speaker", 143, "")).toBe(null); // SIGTERM through the helper's parent
});

test("the helper carries its own microphone words", () => {
  expect(PLIST).toContain("<key>NSMicrophoneUsageDescription</key>");
  expect(buildArgs("a.swift", "p.plist", "out")).toEqual(["swiftc", "-O", "-swift-version", "5", "-o", "out", "a.swift",
    "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", "p.plist"]);
  // the Swift source knows the same exit codes
  const swift = readFileSync(join(import.meta.dir, "..", "mods", "chat", "mac-audio.swift"), "utf8");
  expect(swift).toContain(`fail(${DENIED}, "the microphone isn't allowed")`);
  expect(swift).toContain(`fail(${NO_DEVICE}, "no microphone")`);
  expect(swift).toContain(`fail(${NO_VOICE_PROCESSING}, "no voice processing")`);
  // SIGUSR1 is ignored before anything else runs, and the permission parent passes it on
  expect(swift.indexOf("signal(SIGUSR1, SIG_IGN)")).toBeLessThan(swift.indexOf("\nownResponsibility()"));
  expect(swift).toContain("[SIGTERM, SIGINT, SIGHUP, SIGUSR1]");
  // the player is connected before voice processing goes on (else engine.start fails -10875)
  const c = swift.slice(swift.indexOf("func call("));
  expect(c.indexOf("engine.connect(node")).toBeLessThan(c.indexOf("setVoiceProcessingEnabled(true)"));
});

// A call's sound (mods/chat/audio.ts callAudio) for real, against fake helpers: the Mac's echo-free call, and its
// quiet fallback to the mic and speaker apart.
function fakes(callScript) {
  const d = mkdtempSync(join(tmpdir(), "call-"));
  const sh = (n, body) => { writeFileSync(join(d, n), `#!/bin/sh\n${body}\n`); chmodSync(join(d, n), 0o755); return join(d, n); };
  // the apart mic sends 1s, the call's mic 2s: who the sound came from
  const mic = sh("record", "while :; do printf '\\001\\001\\001\\001'; sleep 0.05; done");
  const speaker = sh("play", `cat > "${d}/played"`);
  const call = callScript === null ? null : sh("call", callScript.replaceAll("$D", d));
  const tools = { kind: "mac", mic: () => [mic], speaker: () => [speaker], access: null, call: call && (() => [call]) };
  const got = { bytes: [], failed: [], fellBack: [] };
  const on = { heard: (p) => got.bytes.push(...p.subarray(0, 4)), failed: (w) => got.failed.push(w), fellBack: (w) => got.fellBack.push(w) };
  return { d, tools, got, on };
}
const until = async (f, ms = 4000) => { for (let i = 0; i < ms / 50 && !f(); i++) await Bun.sleep(50); return f(); };
const CALL = "exec 3<&0\ntrap 'echo drop >> \"$D/usr1\"' USR1\ncat <&3 > \"$D/played-call\" &\nwhile :; do printf '\\002\\002\\002\\002'; sleep 0.05; done";

test("a Mac's call keeps the mic open and drops queued speech on SIGUSR1", async () => {
  const { d, tools, got, on } = fakes(CALL);
  const s = callAudio(tools, 16000, 16000, on);
  expect(await until(() => got.bytes.includes(2))).toBe(true);
  expect(s.echoFree()).toBe(true);
  s.play(new Uint8Array([7, 7, 7, 7]));
  expect(await until(() => existsSync(join(d, "played-call")) && readFileSync(join(d, "played-call")).length === 4)).toBe(true);
  s.drop();
  expect(await until(() => existsSync(join(d, "usr1")))).toBe(true);
  // still the same call, still echo-free: SIGUSR1 didn't end it
  await Bun.sleep(200);
  expect(s.echoFree()).toBe(true);
  expect(got.fellBack).toEqual([]);
  expect(got.bytes.includes(1)).toBe(false);
  s.stop();
  rmSync(d, { recursive: true, force: true });
}, 15000);

test("no voice processing: the call records and plays apart, quietly", async () => {
  const { d, tools, got, on } = fakes(`echo 'herdr-audio: no voice processing' >&2; exit ${NO_VOICE_PROCESSING}`);
  const s = callAudio(tools, 16000, 16000, on);
  expect(await until(() => got.bytes.includes(1))).toBe(true);
  expect(s.echoFree()).toBe(false);
  expect(got.fellBack).toEqual(["no voice processing"]);
  expect(got.failed).toEqual([]);
  s.play(new Uint8Array([7, 7]));
  expect(await until(() => existsSync(join(d, "played")) && readFileSync(join(d, "played")).length === 2)).toBe(true);
  s.stop();
  rmSync(d, { recursive: true, force: true });
}, 15000);

test("a call that fails any other way, or never sounds, falls back too", async () => {
  for (const script of ["exit 5", "sleep 30"]) {
    const { d, tools, got, on } = fakes(script);
    const s = callAudio(tools, 16000, 16000, on, 400);
    expect(await until(() => got.bytes.includes(1))).toBe(true);
    expect(s.echoFree()).toBe(false);
    expect(got.failed).toEqual([]);
    s.stop();
    rmSync(d, { recursive: true, force: true });
  }
}, 15000);

test("a call that ends mid-way goes on apart", async () => {
  const { d, tools, got, on } = fakes("printf '\\002\\002\\002\\002'; sleep 0.3; exit 1");
  const s = callAudio(tools, 16000, 16000, on);
  expect(await until(() => got.bytes.includes(1))).toBe(true);
  expect(got.bytes[0]).toBe(2);
  expect(s.echoFree()).toBe(false);
  s.stop();
  rmSync(d, { recursive: true, force: true });
}, 15000);

test("without a call helper (PipeWire), apart from the start", async () => {
  const { d, tools, got, on } = fakes(null);
  const s = callAudio(tools, 16000, 16000, on);
  expect(s.echoFree()).toBe(false);
  expect(await until(() => got.bytes.includes(1))).toBe(true);
  expect(got.fellBack).toEqual([""]);
  s.stop();
  rmSync(d, { recursive: true, force: true });
}, 15000);

// record.ts for real: a fake pw-record (zeros), the key unreachable (no live words), SIGINT keeps the wav.
const RECORD = join(import.meta.dir, "..", "mods", "chat", "record.ts");
const run = (path, home) => {
  const t = mkdtempSync(join(tmpdir(), "rec-"));
  const p = Bun.spawn([process.execPath, RECORD, join(t, "a.wav"), join(t, "a.level")],
    { env: { PATH: path, HOME: home ?? t, HERDR_APP_HOME: t }, stdout: "ignore", stderr: "ignore" });
  return { t, p };
};

test("Linux dictation still records with pw-record", async () => {
  const bin = mkdtempSync(join(tmpdir(), "pw-"));
  writeFileSync(join(bin, "pw-record"), "#!/bin/sh\nwhile :; do head -c 3200 /dev/zero; sleep 0.1; done\n");
  chmodSync(join(bin, "pw-record"), 0o755);
  const { t, p } = run(`${bin}:/usr/bin:/bin`);
  for (let i = 0; i < 50 && !existsSync(join(t, "a.level")); i++) await Bun.sleep(100);
  await Bun.sleep(400);
  p.kill("SIGINT");
  await p.exited;
  const wav = readFileSync(join(t, "a.wav"));
  expect(wav.subarray(0, 4).toString()).toBe("RIFF");
  expect(wav.length).toBeGreaterThan(44 + 3200);
  rmSync(t, { recursive: true, force: true }); rmSync(bin, { recursive: true, force: true });
}, 15000);

test("no recorder at all says so in the level file", async () => {
  if (process.platform === "darwin") return;
  const { t, p } = run("/nonexistent");
  await p.exited;
  expect(readFileSync(join(t, "a.level"), "utf8")).toBe(`!${audioWords("mic", "pipewire")}`);
  rmSync(t, { recursive: true, force: true });
}, 15000);
