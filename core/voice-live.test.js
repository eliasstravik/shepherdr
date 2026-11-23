// SHEP-63: live dictation's shared words: the realtime socket's address and messages, the words as they come, and the
// browser's microphone down to 16 kHz PCM.
import { describe, expect, test } from "bun:test";
import { liveUrl, liveChunk, liveWords, liveTokenRequest, base64, to16k, tidyText, vocabulary, LIVE_TAIL, LIVE_RATE } from "./voice.js";

describe("live dictation", () => {
  test("the socket: realtime Scribe, 16 kHz PCM, commits only at Done, the language from the audio", () => {
    const u = new URL(liveUrl("tok/1"));
    expect(u.origin + u.pathname).toBe("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
    expect(u.searchParams.get("model_id")).toBe("scribe_v2_realtime");
    expect(u.searchParams.get("audio_format")).toBe("pcm_16000");
    expect(u.searchParams.get("commit_strategy")).toBe("manual");
    expect(u.searchParams.get("token")).toBe("tok/1");
    expect(u.searchParams.has("language_code")).toBe(false);
    expect(new URL(liveUrl()).searchParams.has("token")).toBe(false);
    // SHEP-334: written, not word for word, and biased towards the person's words
    expect(u.searchParams.get("no_verbatim")).toBe("true");
    expect(new URL(liveUrl("t", ["root"])).searchParams.getAll("keyterms")).toEqual(expect.arrayContaining(["Shepherdr", "herdr-core", "root"]));
    expect(liveTokenRequest("k").url).toBe("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe");
  });

  test("a chunk, and Done's tail is long enough to commit (ElevenLabs closes a commit under 0.3 s)", () => {
    expect(JSON.parse(liveChunk("AAA=", true))).toEqual({ message_type: "input_audio_chunk", audio_base_64: "AAA=", sample_rate: 16000, commit: true });
    expect(LIVE_TAIL.length / 2 / LIVE_RATE).toBeGreaterThanOrEqual(0.3);
  });

  test("the words: every committed piece in order; done at the first one after Done", () => {
    const w = liveWords();
    expect(w.hear(JSON.stringify({ message_type: "session_started" }))).toBe(null);
    expect(w.hear(JSON.stringify({ message_type: "partial_transcript", text: "Good" }))).toBe(null);
    expect(w.hear(JSON.stringify({ message_type: "committed_transcript", text: "Good morning. I want" }))).toBe(null);
    w.done();
    expect(w.hear(JSON.stringify({ message_type: "committed_transcript_with_timestamps", text: "x" }))).toBe(null);
    expect(w.hear(JSON.stringify({ message_type: "committed_transcript", text: " a dark mode.  " }))).toBe("words");
    expect(w.text()).toBe("Good morning. I want a dark mode.");
    expect(w.hear(JSON.stringify({ message_type: "committed_transcript", text: "late" }))).toBe(null);
  });

  test("what to show while you speak: the kept words and the ones still being heard (SHEP-314)", () => {
    const w = liveWords();
    expect(w.shown()).toEqual({ said: "", partial: "" });
    w.hear(JSON.stringify({ message_type: "partial_transcript", text: "Good  mor" }));
    expect(w.shown()).toEqual({ said: "", partial: "Good mor" });
    w.hear(JSON.stringify({ message_type: "committed_transcript", text: "Good morning." }));
    expect(w.shown()).toEqual({ said: "Good morning.", partial: "" });
    w.hear(JSON.stringify({ message_type: "partial_transcript", text: "I want" }));
    expect(w.shown()).toEqual({ said: "Good morning.", partial: "I want" });
    expect(w.text()).toBe("Good morning.");
  });

  test("silence: no words, still done", () => {
    const w = liveWords();
    w.done();
    expect(w.hear({ message_type: "committed_transcript", text: "" })).toBe("words");
    expect(w.text()).toBe("");
  });

  test("an error ends it: the recording is uploaded instead", () => {
    for (const t of ["auth_error", "quota_exceeded", "commit_throttled", "input_error", "error"]) {
      const w = liveWords();
      expect(w.hear(JSON.stringify({ message_type: t, error: "no" }))).toBe("failed");
    }
    expect(liveWords().hear("not json")).toBe(null);
  });

  test("base64 of PCM bytes", () => {
    expect(base64(new Uint8Array([1, 2, 3, 255]))).toBe(Buffer.from([1, 2, 3, 255]).toString("base64"));
    const big = new Uint8Array(100000).map((_, i) => i % 256);
    expect(base64(big)).toBe(Buffer.from(big).toString("base64"));
  });

  test("48 kHz floats down to 16 kHz 16-bit, piece by piece, none lost", () => {
    const down = to16k(48000);
    let samples = 0;
    // 1 s in 128-sample pieces (an audio worklet's), a steady half-loud signal
    for (let i = 0; i < 48000; i += 128) {
      const out = down(new Float32Array(Math.min(128, 48000 - i)).fill(0.5));
      const pcm = new Int16Array(out.buffer, out.byteOffset, out.length / 2);
      for (const v of pcm) expect(v).toBe(16384);
      samples += pcm.length;
    }
    expect(samples).toBe(16000);
    // 44.1 kHz: within a sample of 16000 a second
    const d2 = to16k(44100);
    let n = 0;
    for (let i = 0; i < 44100; i += 128) n += d2(new Float32Array(Math.min(128, 44100 - i))).length / 2;
    expect(Math.abs(n - 16000)).toBeLessThanOrEqual(1);
  });
});

// SHEP-334: "it shouldn't write out word for word": on Done, clean written text of what was meant
describe("dictation's clean-up", () => {
  test("fillers and stutters go", () => {
    expect(tidyText("so um I think the the button uh is too small")).toBe("So I think the button is too small.");
    expect(tidyText("You know, it works.")).toBe("It works.");
    expect(tidyText("Hmm, erm, ship it")).toBe("Ship it.");
  });
  test("a spoken correction keeps only the final wording", () => {
    expect(tidyText("Tell the task on Tuesday. No, wait, on Wednesday")).toBe("Tell the task on Wednesday.");
    expect(tidyText("Send it to Anna, sorry, Bob, then merge")).toBe("Send it to Bob, then merge.");
    expect(tidyText("Ship it on Friday, or rather Monday.")).toBe("Ship it on Monday.");
    expect(tidyText("Fix the tests. Add a cancel button. Scratch that. Add a close button")).toBe("Fix the tests. Add a close button.");
  });
  test("capitals and a stop where they belong; names kept as written", () => {
    expect(tidyText("check herdr-core. then the Shepherdr repo")).toBe("Check herdr-core. Then the Shepherdr repo.");
    expect(tidyText("Is it done?")).toBe("Is it done?");
  });
  test("nothing added, reworded or summarised: meaningful words stay", () => {
    expect(tidyText("Sorry, I'm late. It works")).toBe("Sorry, I'm late. It works.");
    expect(tidyText("I had had enough, that that was it")).toBe("I had had enough, that that was it.");
    expect(tidyText("Do you know, what it is")).toBe("Do you know, what it is.");
    const long = "We should keep the old layout for desktop and change only the phone one";
    expect(tidyText(long)).toBe(`${long}.`);
  });
  test("nothing but fillers: nothing", () => {
    expect(tidyText("um")).toBe("");
    expect(tidyText("  ")).toBe("");
  });
  test("the person's words: Shepherdr's first, at most 50, none ElevenLabs refuses", () => {
    const v = vocabulary(["root", "ROOT", "a{b}", "x".repeat(21), ...Array.from({ length: 80 }, (_, i) => `w${i}`)]);
    expect(v[0]).toBe("Shepherdr");
    expect(v).toContain("root");
    expect(v.filter((w) => w.toLowerCase() === "root").length).toBe(1);
    expect(v.some((w) => /[{}]/.test(w) || w.length > 20)).toBe(false);
    expect(v.length).toBe(50);
  });
});
