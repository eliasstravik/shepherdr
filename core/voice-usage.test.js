// SHEP-128: the ElevenLabs plan read (core/voice.js usageRead, readUsage), with made-up answers; its words are the
// plan rows' (core/machines.js).
import { expect, test } from "bun:test";
import { usageRead, readUsage, USAGE_NO_ACCESS, API, USAGE_PATH } from "./voice.js";
import { planRows, windowWords, whyWords, cliTitle } from "./machines.js";

const AT = 1_700_000_000_000;
const SUB = { tier: "creator", character_count: 25_000, character_limit: 100_000, next_character_count_reset_unix: 1_700_500_000, status: "active" };

test("a subscription reads as a Credits window, its plan and its counts", () => {
  const r = usageRead(200, JSON.stringify(SUB), AT);
  expect(r).toEqual({ state: "ok", at: AT, plan: "creator", account: "25,000 of 100,000 credits used", windows: [{ name: "Credits", used: 25, resets_at: 1_700_500_000_000 }] });
  const [row] = planRows({ limits: { elevenlabs: r } }, AT);
  expect(row.name).toBe("ElevenLabs");
  expect(cliTitle(row)).toBe("ElevenLabs · Creator");
  expect(row.pct).toBe(75);
  expect(windowWords(r.windows[0], AT).words).toBe("75% left · 25% used");
});

test("a tier with underscores reads as words; no limit or reset time is no guess", () => {
  const r = usageRead(200, JSON.stringify({ tier: "growing_business", character_count: 12, character_limit: 0 }), AT);
  expect(r.plan).toBe("growing business");
  expect(r.windows).toEqual([]);
  expect(r.account).toBe("12 credits used");
  expect(usageRead(200, JSON.stringify({ tier: "free", character_count: 1, character_limit: 10 }), AT).windows[0].resets_at).toBeUndefined();
});

test("a key without User → Read gets the plain hint, never an error", () => {
  const body = JSON.stringify({ detail: { status: "missing_permissions", message: "The API key you used is missing the permission user_read to execute this operation." } });
  const r = usageRead(401, body, AT);
  expect(r).toEqual({ state: "no-access", why: USAGE_NO_ACCESS, at: AT });
  expect(whyWords(r)).toBe(USAGE_NO_ACCESS);
  expect(USAGE_NO_ACCESS).toContain("User → Read");
});

test("other failures say what ElevenLabs said, keys hidden", () => {
  const r = usageRead(401, JSON.stringify({ detail: { status: "invalid_api_key", message: "Invalid API key: sk_" + "a".repeat(40) } }), AT);
  expect(r.state).toBe("unknown");
  expect(r.why).toBe("ElevenLabs said: Invalid API key: …");
  expect(usageRead(200, "{}", AT).state).toBe("unknown");
});

test("readUsage: one GET with the key; no key hides it; the key is never in the read", async () => {
  const calls = [];
  const key = "sk_fake_" + "k".repeat(24);
  const fetchFn = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(SUB)); };
  const r = await readUsage(async () => ({ key }), fetchFn, () => AT);
  expect(calls.length).toBe(1);
  expect(calls[0].url).toBe(`${API}${USAGE_PATH}`);
  expect(calls[0].init.headers["xi-api-key"]).toBe(key);
  expect(JSON.stringify(r)).not.toContain(key);
  expect(r.state).toBe("ok");
  expect(await readUsage(async () => ({ error: "no key", why: "none" }), fetchFn)).toBeNull();
  expect(calls.length).toBe(1);
  expect((await readUsage(async () => ({ error: "Can't reach mini", why: "unreachable" }), fetchFn, () => AT)).state).toBe("unknown");
  expect((await readUsage(async () => ({ key }), async () => { throw new Error("down"); }, () => AT)).why).toBe("Can't reach ElevenLabs from this machine.");
});
