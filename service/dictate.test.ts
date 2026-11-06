// Dictation writes a recording down with ElevenLabs speech to text (Scribe), with the key a voice call uses (voiceKey:
// from the machine that keeps the secrets). The ElevenLabs call is a stand-in here: what it is sent, and each failure's words.
import { describe, expect, test } from "bun:test";
import { dictate, fileName, keyCache, liveToken } from "./dictate.ts";
import * as V from "../core/voice.js";

const { voiceKey, KEY_SCRIPT, STT_MODEL } = V as any;
const KEY = "sk_test_0123456789abcdef0123456789abcdef";
const hub = { call: async () => { throw new Error("not used"); } } as any;
const audio = (n = 1000, type = "audio/webm;codecs=opus") => new Blob([new Uint8Array(n).fill(7)], { type });

// the key as a call finds it: this machine asks "mini", which keeps the secrets, over herdr-core's link
const fromMain = (answer: string | null) => {
  const asked: string[] = [];
  const key = () => voiceKey({ oldFile: () => "", where: async () => ({ here: false, set: true, name: "mini" }), vault: () => null,
    ask: async (on: string, script: string) => { asked.push(on); expect(script).toBe(KEY_SCRIPT); return answer; } });
  return { key, asked };
};
const elevenlabs = (status: number, body: unknown) => {
  const sent: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { sent.push({ url, init }); return new Response(typeof body === "string" ? body : JSON.stringify(body), { status }); }) as any;
  return { f, sent };
};

describe("dictation with ElevenLabs", () => {
  test("sends the audio to Scribe with the main machine's key; the words come back", async () => {
    const { key, asked } = fromMain(JSON.stringify({ key: KEY, agent: "" }));
    const el = elevenlabs(200, { language_code: "swe", text: "  Hej,  kan du fixa\nknappen? " });
    expect(await dictate(hub, audio(), el.f, key)).toBe("Hej, kan du fixa knappen?");
    expect(asked).toEqual(["mini"]);
    expect(el.sent.length).toBe(1);
    const { url, init } = el.sent[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
    expect(init.redirect).toBe("error");
    const form = init.body as FormData;
    expect(STT_MODEL).toBe("scribe_v2");
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("tag_audio_events")).toBe("false");
    expect(form.has("language_code")).toBe(false); // found from the audio: English or Swedish
    const file = form.get("file") as File;
    expect(file.size).toBe(1000);
    expect(file.name).toBe("dictation.webm");
    expect(new Uint8Array(await file.arrayBuffer())[0]).toBe(7);
  });

  test("no key on the main machine: where to add it, and ElevenLabs isn't asked", async () => {
    const { key } = fromMain(JSON.stringify({ key: "", agent: "" }));
    const el = elevenlabs(200, { text: "x" });
    await expect(dictate(hub, audio(), el.f, key)).rejects.toThrow("Dictation needs an ElevenLabs key in Settings › Secrets.");
    expect(el.sent.length).toBe(0);
  });

  test("no key on this machine when it keeps the secrets: the same words", async () => {
    const key = () => voiceKey({ oldFile: () => "", where: async () => ({ here: true }), vault: () => null, ask: async () => null });
    await expect(dictate(hub, audio(), elevenlabs(200, {}).f, key)).rejects.toThrow("Dictation needs an ElevenLabs key in Settings › Secrets.");
  });

  test("the main machine can't be reached: says so", async () => {
    const { key } = fromMain(null);
    await expect(dictate(hub, audio(), elevenlabs(200, {}).f, key)).rejects.toThrow("Can't reach mini, which keeps your secrets, for the ElevenLabs key");
  });

  test("ElevenLabs refuses: its short reason, never the key", async () => {
    const { key } = fromMain(JSON.stringify({ key: KEY }));
    const el = elevenlabs(401, { detail: { status: "invalid_api_key", message: `Invalid API key ${KEY}` } });
    const err = await dictate(hub, audio(), el.f, key).then(() => new Error("no error"), (e: Error) => e);
    expect(err.message).toBe("ElevenLabs said: Invalid API key …");
    const quota = elevenlabs(429, { detail: { status: "quota_exceeded", message: "This request exceeds your quota." } });
    await expect(dictate(hub, audio(), quota.f, key)).rejects.toThrow("ElevenLabs said: This request exceeds your quota.");
    await expect(dictate(hub, audio(), elevenlabs(500, "oops").f, key)).rejects.toThrow("ElevenLabs said 500.");
  });

  test("ElevenLabs can't be reached: says so", async () => {
    const { key } = fromMain(JSON.stringify({ key: KEY }));
    const down = (async () => { throw new TypeError("fetch failed"); }) as any;
    await expect(dictate(hub, audio(), down, key)).rejects.toThrow("Can't reach ElevenLabs.");
  });

  test("nothing recorded or too long: said before any key is looked up", async () => {
    const key = () => { throw new Error("looked up"); };
    await expect(dictate(hub, audio(0), elevenlabs(200, {}).f, key as any)).rejects.toThrow("Nothing was recorded.");
    await expect(dictate(hub, audio(21 * 1024 * 1024), elevenlabs(200, {}).f, key as any)).rejects.toThrow("That recording is too long.");
  });

  test("silence: no words, no error", async () => {
    const { key } = fromMain(JSON.stringify({ key: KEY }));
    expect(await dictate(hub, audio(), elevenlabs(200, { text: "" }).f, key)).toBe("");
  });

  test("the upload's name follows the browser's format", () => {
    expect(fileName("audio/webm;codecs=opus")).toBe("dictation.webm");
    expect(fileName("audio/mp4")).toBe("dictation.m4a");
    expect(fileName("audio/ogg")).toBe("dictation.ogg");
    expect(fileName("audio/wav")).toBe("dictation.wav");
  });
});

// SHEP-63: the words are written live (a single-use token for the page), and the key is found once per service process
describe("live dictation and the kept key", () => {
  test("the key is looked up once, kept in memory, and found again after a while", async () => {
    let looked = 0, now = 0;
    const c = keyCache(async () => { looked++; return { key: KEY }; }, 1000, () => now);
    expect(await c.get()).toEqual({ key: KEY });
    expect(await c.get()).toEqual({ key: KEY });
    expect(looked).toBe(1);
    now = 1500;
    await c.get();
    expect(looked).toBe(2);
    c.forget();
    await c.get();
    expect(looked).toBe(3);
  });

  test("a failed lookup isn't kept: the next one asks again", async () => {
    let looked = 0;
    const c = keyCache(async () => (++looked === 1 ? { error: "unreachable", why: "unreachable" } : { key: KEY }));
    expect("error" in await c.get()).toBe(true);
    await Bun.sleep(0);
    expect(await c.get()).toEqual({ key: KEY });
    expect(looked).toBe(2);
  });

  test("a token for the page: asked with the key, which never comes back", async () => {
    const el = elevenlabs(200, { token: "sutkn_abc123def456" });
    const token = await liveToken(hub, el.f, async () => ({ key: KEY }));
    expect(token).toBe("sutkn_abc123def456");
    expect(el.sent[0].url).toBe("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe");
    expect((el.sent[0].init.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
  });

  test("no key or ElevenLabs refuses: dictation's own words (the page then uploads the recording)", async () => {
    await expect(liveToken(hub, elevenlabs(200, {}).f, async () => ({ error: "x", why: "none" }))).rejects.toThrow("Dictation needs an ElevenLabs key");
    await expect(liveToken(hub, elevenlabs(401, { detail: { message: `bad ${KEY}` } }).f, async () => ({ key: KEY }))).rejects.toThrow("ElevenLabs said: bad …");
    await expect(liveToken(hub, elevenlabs(200, { token: "" }).f, async () => ({ key: KEY }))).rejects.toThrow("ElevenLabs gave no token.");
  });
});
