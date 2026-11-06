// The window's mic and speaker (core/audio.js, mods/chat/audio.ts): which tool, its arguments and the words people see.
// Dictation's recorder (mods/chat/record.ts) runs for real against a fake pw-record, and without one.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audioKind, audioWords, micArgs, speakerArgs, buildArgs, PLIST, HELPER, DENIED, NO_DEVICE } from "./audio.js";
import { ended } from "../mods/chat/audio.ts";

test("Linux keeps PipeWire; a Mac gets its own helper", () => {
  expect(audioKind("linux", (t) => t === "pw-record")).toBe("pipewire");
  expect(audioKind("darwin", () => false)).toBe("mac");
  expect(audioKind("linux", () => false)).toBe(null);
  expect(micArgs("pipewire", 16000)).toEqual(["pw-record", "--rate", "16000", "--channels", "1", "--format", "s16", "--raw", "-"]);
  expect(speakerArgs("pipewire", 22050)).toEqual(["pw-play", "--rate", "22050", "--channels", "1", "--format", "s16", "--raw", "-"]);
  expect(micArgs("mac", 16000, "/x/herdr-audio")).toEqual(["/x/herdr-audio", "record", "16000"]);
  expect(speakerArgs("mac", 44100, "/x/herdr-audio")).toEqual(["/x/herdr-audio", "play", "44100"]);
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
});

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
