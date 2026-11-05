import { describe, expect, test } from "bun:test";
import { missing } from "./dictate.ts";

describe("dictation's tools", () => {
  test("all there: nothing to say", () => {
    expect(missing({ ffmpeg: "/usr/bin/ffmpeg", whisper: "/usr/bin/whisper-cli", model: true })).toBeNull();
  });
  test("says what the serving machine lacks, in plain words", () => {
    expect(missing({ ffmpeg: null, whisper: "/w", model: true })).toBe("The machine serving Shepherdr needs ffmpeg for dictation.");
    expect(missing({ ffmpeg: null, whisper: null, model: false })).toBe("The machine serving Shepherdr needs whisper.cpp, its model (shepherdr whisper) and ffmpeg for dictation.");
  });
});
