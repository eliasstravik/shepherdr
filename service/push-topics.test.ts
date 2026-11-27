// @ts-nocheck: fake subscriptions and a fake push service
// Each device chooses what it is told about (Settings › Notify › Alerts on this device): the server sends an alert only
// to the devices that chose its topic and don't mute its space, never to one whose app is on screen; a device turned
// off gets nothing more; a test goes to that one device only.
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { Push, alertsOf, wants } from "./push.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "push-topics-"));

// a real P-256 key per fake device, so each alert really encrypts
async function fakeSub(n: number) {
  const k = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const p256dh = Buffer.from(new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey))).toString("base64url");
  return { endpoint: `https://push.example.test/dev${n}`, keys: { p256dh, auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url") } };
}

let hits: string[] = [];
let answer = 201;
const realFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = (async (url: string) => { hits.push(String(url).split("/").pop()!); return new Response(null, { status: answer }); }) as any; });
afterAll(() => { globalThis.fetch = realFetch; rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { hits = []; answer = 201; });

const file = () => join(dir, `push-${Math.random()}.json`);

test("a new device hears what needs you and a ready task; one from before keeps what it had", async () => {
  const p = new Push(() => "https://example.test", file());
  const a = await fakeSub(1);
  p.subscribe(a, "phone");
  expect(p.state(a.endpoint)).toEqual({ on: true, topics: ["needs", "ready"], muted: [], devices: 1 });
  expect(wants({}, { topic: "ready" })).toBe(true); // no topics kept: an old subscription's needs + ready
  expect(wants({}, { topic: "done" })).toBe(false);
});

test("alerts go by each device's topics and muted spaces, never to one on screen", async () => {
  const p = new Push(() => "https://example.test", file());
  const [a, b, c] = [await fakeSub(1), await fakeSub(2), await fakeSub(3)];
  p.subscribe(a); p.subscribe(b); p.subscribe(c);
  p.choose(b.endpoint, { topics: ["needs", "ready", "done"], muted: ["sp2"] });
  p.choose(c.endpoint, { topics: ["ready"] });
  p.choose(a.endpoint, { topics: ["needs"] });

  await p.send({ title: "x", topic: "needs", place: "sp1" });
  expect(hits.sort()).toEqual(["dev1", "dev2"]);
  hits = [];
  await p.send({ title: "x", topic: "ready", place: "sp1" });
  expect(hits.sort()).toEqual(["dev2", "dev3"]);
  hits = [];
  // dev2 mutes sp2
  await p.send({ title: "x", topic: "ready", place: "sp2" });
  expect(hits).toEqual(["dev3"]);
  hits = [];
  // dev1's app is on screen
  p.visible = new Set([a.endpoint]);
  await p.send({ title: "x", topic: "needs", place: "sp1" });
  expect(hits).toEqual(["dev2"]);
});

test("a resolution waits for that device's original push and skips devices getting its replacement", async () => {
  const p = new Push(() => "https://example.test", file());
  const [a, b] = [await fakeSub(1), await fakeSub(2)];
  p.subscribe(a); p.subscribe(b);
  p.choose(a.endpoint, { topics: ["needs"] });
  const calls: string[] = [];
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  p.deliver = async ({ endpoint }) => {
    calls.push(endpoint);
    if (endpoint === a.endpoint && calls.filter((device) => device === a.endpoint).length === 1) {
      started.resolve();
      await release.promise;
    }
    return 201;
  };
  const first = p.send({ topic: "needs" });
  await started.promise;
  const cleared = p.send({ topic: "needs", resolved: true, replacedBy: [{ topic: "ready" }] });
  try {
    await Promise.resolve();
    expect(calls.filter((device) => device === a.endpoint)).toHaveLength(1);
  } finally {
    release.resolve();
    await Promise.all([first, cleared]);
  }
  expect(calls.filter((device) => device === a.endpoint)).toHaveLength(2);
  expect(calls.filter((device) => device === b.endpoint)).toHaveLength(1);
});

test("turned off: it gets nothing more; on again it keeps its choice; one choice for all", async () => {
  const f = file();
  const p = new Push(() => "https://example.test", f);
  const [a, b] = [await fakeSub(1), await fakeSub(2)];
  p.subscribe(a); p.subscribe(b);
  p.choose(a.endpoint, { topics: ["needs", "assistant"] });
  p.subscribe(a); // the page gives back a subscription the server lost or already has: its choice stays
  expect(p.state(a.endpoint).topics).toEqual(["needs", "assistant"]);
  // 3.1's "autopilot" topic is gone: a choice that still names it (a page not reloaded, a kept subscription) loads without it
  p.choose(a.endpoint, { topics: ["needs", "autopilot", "done"], muted: ["sp9"] }, true);
  expect(p.state(b.endpoint)).toEqual({ on: true, topics: ["needs", "done"], muted: ["sp9"], devices: 2 });
  p.unsubscribe(a.endpoint);
  expect(p.state(a.endpoint).on).toBe(false);
  await p.send({ title: "x", topic: "needs" });
  expect(hits).toEqual(["dev2"]);
  // kept on disk
  expect(JSON.parse(readFileSync(f, "utf8")).map((s) => s.endpoint)).toEqual([b.endpoint]);
});

test("a test goes to that device only, on screen or not, and says what the push service said", async () => {
  const p = new Push(() => "https://example.test", file());
  const [a, b] = [await fakeSub(1), await fakeSub(2)];
  p.subscribe(a); p.subscribe(b);
  p.visible = new Set([a.endpoint]);
  expect(await p.test(a.endpoint)).toEqual({ ok: true, said: "Sent. It should show in a few seconds." });
  expect(hits).toEqual(["dev1"]);
  answer = 410;
  expect((await p.test(a.endpoint)).ok).toBe(false);
  expect(p.state(a.endpoint).on).toBe(false); // gone at the push service: dropped
  expect(await p.test("https://push.example.test/nobody")).toEqual({ ok: false, said: "Alerts are off for this device." });
});

test("each alert carries its topic and space", () => {
  const snap = {
    places: [
      { id: "sp1", name: "tt-repo", chat: "p:sp1" },
      { id: "sp2", name: "shop", chat: "p:sp2", pilot: { on: true, inflight: true } },
      { id: "sp3", name: "quiet", chat: "p:sp3" },
    ],
    tasks: [
      { id: "HERD-4", name: "Fix login", status: "ready", place: "sp1" },
      { id: "HERD-3", name: "Old one", status: "done", place: "sp1" },
    ],
    needs: [{ id: "q1", chat: "HERD-5/worker", place: "sp1", task: "HERD-5" }],
    last: { "p:sp1": 7, "p:sp2": 3, "p:sp3": 2 },
    read: { "p:sp1": 6, "p:sp2": 2, "p:sp3": 2 },
    settings: [],
  };
  const a = [...alertsOf(snap).entries()].map(([k, v]) => [k, v.topic, v.place, v.title]);
  expect(a).toEqual([
    ["need:HERD-5/worker:q1", "needs", "sp1", "HERD-5 · Needs you"],
    ["ready:HERD-4", "ready", "sp1", "Fix login · Ready for review"],
    ["done:HERD-3", "done", "sp1", "Old one · Done"],
    ["msg:p:sp1:7", "assistant", "sp1", "#tt-repo · New message"],
    // 3.2 has no Autopilot: a space's chat message is a New message, whatever an old snapshot says of a pilot
    ["msg:p:sp2:3", "assistant", "sp2", "#shop · New message"],
  ]);
  // an Assistant's question is its Needs you alert, not a new message too
  const asks = { ...snap, needs: [{ id: "q2", chat: "p:sp1", place: "sp1", question: { kind: "Question", title: "Rerun CI?" } }] };
  expect([...alertsOf(asks).keys()].filter((k) => k.includes("p:sp1"))).toEqual(["need:p:sp1:q2"]);
  const after = { ...snap, places: [{ id: "sp2", name: "shop", chat: "p:sp2" }], needs: [], tasks: [] };
  expect([...alertsOf(after).values()].map((x) => x.topic)).toEqual(["assistant"]);
});
