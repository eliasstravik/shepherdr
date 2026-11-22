// @ts-nocheck: fake snapshots, subscriptions and a fake push service
// SHEP-246: the glance feed for the phone's and watch's own app (Shepherdr Wake): the doc, its calm stream, quiet web push
// on a device whose app shows its own alerts, and POST /api/open's go to that device's page.
import { afterAll, afterEach, beforeAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "glance-"));
process.env.SHEPHERDR_DATA = dir;
const { Push, alertsOf } = await import("./push.ts");
const { GlanceFeed, glanceOf, buttonChoices, openUrlOk, CALM_MS, NATIVE_GRACE_MS } = await import("./glance.ts");
const { Live } = await import("./live.ts");
const { gate } = await import("./auth.ts");

const NOW = new Date(2026, 10, 17, 15, 0, 0).getTime();
const PHONE = "nPhone1CNTRL", MAC = "nMac1CNTRL";

let hits: string[] = [];
const realFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = (async (url: string) => { hits.push(String(url).split("/").pop()!); return new Response(null, { status: 201 }); }) as any; });
// the service's data folder is read once per test process: removed only when the process ends (other files' tests use it)
afterAll(() => { globalThis.fetch = realFetch; });
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => { hits = []; });
afterEach(() => setSystemTime());

const q = (over: any = {}) => ({ id: "q1", kind: "Question", title: "Rerun CI on main?", choices: [{ label: "Yes" }, { label: "No" }, { label: "Later" }], ...over });
const snapOf = (over: any = {}) => ({
  places: [{ id: "sp1", name: "Home", chat: "sp1", machine: "Mac mini" }],
  tasks: [
    { id: "HERD-5", name: "Watch voice: fix lag", status: "need", place: "sp1", at: NOW - 9000, sub: "Waits for you", report: { progress: 8 }, left: "5h" },
    { id: "HERD-4", name: "Fix login", status: "ready", place: "sp1", at: NOW - 8000 },
    { id: "HERD-3", name: "Tidy the docs", status: "work", place: "sp1", at: NOW - 7000, sub: "Designing the per-hop timing logs" },
    { id: "HERD-2", name: "Done today", status: "done", place: "sp1", doneAt: NOW - 3600_000 },
    { id: "HERD-1", name: "Done yesterday", status: "done", place: "sp1", doneAt: NOW - 24 * 3600_000 },
  ],
  needs: [{ id: "q1", chat: "HERD-5/worker", place: "sp1", task: "HERD-5", at: NOW - 5000, question: q() }],
  alerts: [],
  ...over,
});
const doc = (snap: any, now = NOW) => glanceOf(snap, alertsOf(snap), now);

/* ---------- the doc ---------- */

test("the Tasks panel's order: needs first, then ready, working, done today; never a done task from yesterday", () => {
  const g = doc(snapOf());
  expect(g.items.map((i) => [i.kind, i.key])).toEqual([["needs", "need:HERD-5/worker:q1"], ["ready", "ready:HERD-4"], ["working", "task:HERD-3"], ["done", "task:HERD-2"]]);
  expect(g.counts).toEqual({ needs: 1, working: 1, ready: 1, done: 1 });
  expect(g.format).toBe(1);
  const need = g.items[0];
  expect(need).toMatchObject({ type: "need", tag: "HERD-5", task: "HERD-5", title: "Watch voice: fix… · Needs you", body: "Rerun CI on main?", space: "Home", machine: "Mac mini", progress: 8, left: "5h", alert: true, at: NOW - 5000 });
  expect(need.url).toBe("./?place=sp1&task=HERD-5&focus=q1");
  expect(g.items[1]).toMatchObject({ accept: { task: "HERD-4" }, title: "Fix login · Ready for review", url: "./?place=sp1&task=HERD-4", alert: true });
  expect(g.items[2]).toMatchObject({ alert: false, title: "HERD-3 · Working", line: "Designing the per-hop timing logs" });
});

test("a 3-choice question gives 3 buttons; a plan, a menu, a merge, a pick of several give none", () => {
  expect(doc(snapOf()).items[0].answer).toEqual({ chat: "HERD-5/worker", question: "q1", choices: [{ i: 0, label: "Yes" }, { i: 1, label: "No" }, { i: 2, label: "Later" }] });
  for (const over of [{ kind: "Plan" }, { id: "menu:1" }, { title: "Merge it now?" }, { multi: true }, { parts: [{}, {}] }])
    expect(doc(snapOf({ needs: [{ id: "q1", chat: "HERD-5/worker", place: "sp1", task: "HERD-5", question: q(over) }] })).items[0].answer).toBeUndefined();
  // a note-needed and a grant-for-good choice are never a button
  expect(buttonChoices(q({ choices: [{ label: "Yes" }, { label: "Yes, always" }, { label: "No, with a note" }, { label: "Skip" }], always: 1, noteRequiredFor: 2 })).map((c) => c.i)).toEqual([0, 3]);
  // a card that takes free words: Reply answers it as Other
  expect(doc(snapOf({ needs: [{ id: "q1", chat: "HERD-5/worker", place: "sp1", task: "HERD-5", question: q({ other: true }) }] })).items[0].answer.other).toBe(true);
});

test("an agent's own alert from a chat takes Reply; titles fit a watch line, bodies two", () => {
  const long = "x".repeat(300);
  const g = doc(snapOf({ needs: [], alerts: [{ id: "a1", at: NOW - 100, title: `HERD-3 · ${long}`, body: long, chat: "HERD-3/worker", place: "sp1", notify: true }] }));
  const a = g.items.find((i) => i.type === "alert");
  expect(a.reply).toEqual({ chat: "HERD-3/worker" });
  for (const i of g.items) { expect(i.title.length).toBeLessThanOrEqual(30); expect(i.body.length).toBeLessThanOrEqual(80); }
});

test("only what the app shows: no alert from a finished terminal, a done task, days ago, or a machine back under its memory limit", () => {
  const al = (over: any) => ({ id: "a" + Math.random(), at: NOW - 60_000, title: "x · Look", body: "now", chat: "HERD-3/worker", notify: true, ...over });
  const shown = (alerts: any[], over: any = {}) => doc(snapOf({ needs: [], alerts, ...over })).items.filter((i) => i.type === "alert").length;
  expect(shown([al({})])).toBe(1);
  // a finished helper's (ELIA-45's sign-in test)
  expect(shown([al({ ended: true, chat: "HERD-3/helper" })])).toBe(0);
  // a done task's agent
  expect(shown([al({ chat: "HERD-2/worker" })])).toBe(0);
  // 3.4 days old: a moment long gone, as in the app (a toast, once)
  expect(shown([al({ at: NOW - 3.4 * 86400_000 })])).toBe(0);
  // not for the person (an Assistant's, its space's Notify off)
  expect(shown([al({ notify: false })])).toBe(0);
  // SHEP-255: one of no task (a helper's, the memory guard's) is Chat's and notifications', never Needs you's
  expect(shown([al({ chat: "vm-signin" })])).toBe(0);
  expect(shown([al({ chat: undefined, memory: true })], { machines: [{ machine: "box", here: true, stats: { health: { memory: 91 } } }] })).toBe(0);
  // a task's helper (herdr.task): on its task
  expect(shown([al({ chat: "shep-3-review", task: "HERD-3" })])).toBe(1);
});

test("only tasks need you: a task's card lists, with a task's alert; an Assistant's card, alert and message are Chat's", () => {
  const notifyOff = [{ name: "Notify", level: "sp1", rows: [{ key: "notify", value: "Off" }] }];
  const snap = snapOf({ settings: notifyOff, tasks: [{ id: "HERD-3", name: "Tidy the docs", status: "work", place: "sp1", at: NOW - 7000 }, { id: "HERD-6", name: "Logo", status: "work", place: "sp1", at: NOW - 7000 }],
    needs: [{ id: "q8", chat: "HERD-6/worker", place: "sp1", task: "HERD-6", at: NOW - 100, question: q({ id: "q8" }) }, { id: "q9", chat: "sp1", place: "sp1", at: NOW - 100, question: q({ id: "q9" }) }],
    places: [{ id: "sp1", name: "Home", chat: "sp1" }, { id: "sp2", name: "Shop", chat: "sp2" }], last: { sp2: NOW - 50 }, read: {},
    alerts: [{ id: "a1", at: NOW - 100, title: "HERD-3 · Look", body: "now", chat: "HERD-3/worker", notify: true }, { id: "a2", at: NOW - 100, title: "Home Assistant · Look", body: "now", chat: "sp1", notify: true }] });
  const g = doc(snap);
  const need = g.items.find((i) => i.key === "need:HERD-6/worker:q8");
  expect(need).toMatchObject({ kind: "needs", type: "need", task: "HERD-6" });
  expect(need.answer.choices.length).toBe(3);
  // SHEP-255: the Assistant's question and alert are not here; SHEP-253: its new message is Chat's (unread)
  expect(g.items.filter((i) => i.kind === "needs").map((i) => i.key).sort()).toEqual(["alert:a1", "need:HERD-6/worker:q8"]);
  expect(g.counts.needs).toBe(2);
  expect(g.unread).toBe(1);
});

const listed = (g: any) => Object.fromEntries(["needs", "working", "ready", "done"].map((k) => [k, g.items.filter((i) => i.kind === k).length]));

test("SHEP-248: Needs you's count is what it lists; SHEP-253: an Assistant's unread message is no task, so only the task's question counts", () => {
  // as on the phone: the Assistant of vm-demo's space has a new message, HERD-53 asks a question
  const snap = snapOf({
    places: [{ id: "vm-demo:sp1", name: "Home", chat: "p:vm-demo:sp1", machine: "vm-demo" }],
    tasks: [{ id: "HERD-53", name: "Watch voice", status: "need", place: "vm-demo:sp1", at: NOW - 9000 }],
    needs: [{ id: "q1", chat: "HERD-53/worker", place: "vm-demo:sp1", task: "HERD-53", at: NOW - 5000, question: q() }],
    last: { "p:vm-demo:sp1": NOW - 50 }, read: {},
  });
  const g = doc(snap);
  expect(g.items.filter((i) => i.kind === "needs").map((i) => i.tag).sort()).toEqual(["HERD-53"]);
  expect(g.counts.needs).toBe(1);
  expect(g.groups.find((x) => x.kind === "needs").count).toBe(1);
  expect(g.unread).toBe(1);
});

test("counts and groups always match the list, section by section, in the Tasks panel's order and names", () => {
  const snaps = [snapOf(), snapOf({ needs: [] }), snapOf({ places: [{ id: "sp1", name: "Home", chat: "sp1" }], last: { sp1: NOW - 50 }, read: {}, alerts: [{ id: "a1", at: NOW - 100, title: "x · Look", body: "now", chat: "HERD-3/worker", notify: true }] })];
  for (const snap of snaps) {
    const g = doc(snap);
    expect(g.counts).toEqual(listed(g));
    expect(g.groups).toEqual([
      { kind: "needs", label: "Needs you", count: g.counts.needs },
      { kind: "ready", label: "Ready", count: g.counts.ready },
      { kind: "working", label: "Working", count: g.counts.working },
      { kind: "done", label: "Done", count: g.counts.done },
    ]);
    expect(g.order).toEqual(["needs", "ready", "working", "done"]);
    // the items follow that order
    const kinds = g.items.map((i) => i.kind);
    expect(kinds).toEqual(g.order.flatMap((o) => kinds.filter((k) => k === o)));
  }
});

test("v and urgent stay put while nothing changes; a status line moves v only; a new alert moves both", () => {
  const a = doc(snapOf()), b = doc(snapOf(), NOW + 5000);
  expect(b.v).toBe(a.v);
  // an Assistant's message with no time of its own never takes "now" (else v moved on every snapshot)
  const msg = snapOf({ places: [{ id: "sp1", name: "Home", chat: "sp1" }], last: { sp1: NOW - 50 }, read: {} });
  expect(doc(msg, NOW).v).toBe(doc(msg, NOW + 9000).v);
  const s = snapOf(); s.tasks[2].sub = "Writing the tests";
  const c = doc(s);
  expect(c.v).not.toBe(a.v);
  expect(c.urgent).toBe(a.urgent);
  const d = doc(snapOf({ needs: [] }));
  expect(d.urgent).not.toBe(a.urgent);
});

test("stays small: 40 items at most", () => {
  const tasks = Array.from({ length: 80 }, (_, i) => ({ id: `HERD-${100 + i}`, name: `Task ${i} `.repeat(20), status: "work", place: "sp1", at: NOW - i, sub: "y".repeat(500) }));
  const g = doc(snapOf({ tasks, needs: [] }));
  expect(g.items.length).toBe(40);
  expect(g.counts.working).toBe(80);
  expect(JSON.stringify(g).length).toBeLessThan(25_000);
});

/* ---------- the stream ---------- */

async function reader(res: Response) {
  const r = res.body!.getReader(), dec = new TextDecoder();
  let text = "";
  const pump = (async () => { for (;;) { const { value, done } = await r.read(); if (done) return; text += dec.decode(value); } })();
  return { text: () => text, frames: () => text.split("\n\n").filter((f) => f.startsWith("event: glance")).map((f) => JSON.parse(f.split("\ndata: ")[1])), cancel: () => r.cancel(), pump };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test("a stream: retry and the doc now, one frame per change, none for an unchanged doc, a ping comment", async () => {
  let now = NOW;
  const f = new GlanceFeed(() => now, 0);
  f.set(doc(snapOf()));
  const res = f.stream(null, false);
  expect(res.headers.get("content-type")).toStartWith("text/event-stream");
  const s = await reader(res);
  await tick();
  expect(s.text()).toStartWith("retry: 5000\n\nevent: glance\ndata: {");
  expect(s.frames().length).toBe(1);
  f.set(doc(snapOf(), NOW + 1000)); await tick();
  expect(s.frames().length).toBe(1);
  // what notifies goes at once
  f.set(doc(snapOf({ needs: [] }))); await tick();
  expect(s.frames().length).toBe(2);
  expect(s.frames()[1].counts.needs).toBe(1); // HERD-5's row still says Needs you, without its card
  f.ping(); await tick();
  expect(s.text()).toEndWith(": ping\n\n");
  await s.cancel();
  expect(f.size).toBe(0);
});

test("calm: a status line or progress goes at most once a minute, the latest then", async () => {
  let now = NOW;
  const f = new GlanceFeed(() => now, 0);
  const s = await reader(f.stream(null, false));
  f.set(doc(snapOf())); await tick();
  expect(s.frames().length).toBe(1);
  const lines = (sub: string) => { const x = snapOf(); x.tasks[2].sub = sub; return doc(x); };
  for (const sub of ["one", "two", "three"]) { now += 1000; f.set(lines(sub)); }
  await tick();
  expect(s.frames().length).toBe(1);
  // an urgent change meanwhile goes at once, with the newest lines
  now += 1000;
  const x = snapOf({ needs: [] }); x.tasks[2].sub = "four";
  f.set(doc(x)); await tick();
  expect(s.frames().length).toBe(2);
  expect(s.frames()[1].items.find((i) => i.key === "task:HERD-3").line).toBe("four");
  await s.cancel();
});

test("calm: the held change goes when the minute is up", async () => {
  let now = NOW;
  const f = new GlanceFeed(() => now, 0);
  const s = await reader(f.stream(null, false));
  f.set(doc(snapOf())); await tick();
  // a minute minus 20 ms has gone since: the held change goes 20 ms later
  now += CALM_MS - 20;
  const x = snapOf(); x.tasks[2].sub = "later";
  f.set(doc(x)); await tick();
  expect(s.frames().length).toBe(1);
  await new Promise((r) => setTimeout(r, 40));
  expect(s.frames().length).toBe(2);
  expect(s.frames()[1].items.find((i) => i.key === "task:HERD-3").line).toBe("later");
  await s.cancel();
});

/* ---------- quiet web push ---------- */

async function fakeSub(n: number) {
  const k = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const p256dh = Buffer.from(new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey))).toString("base64url");
  return { endpoint: `https://push.example.test/dev${n}`, keys: { p256dh, auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url") } };
}

test("device D's web push waits while D has a native stream, and 2 minutes after it closed; then it comes back", async () => {
  let now = NOW;
  const f = new GlanceFeed(() => now, 0);
  const p = new Push(() => "https://example.test", join(dir, `push-${Math.random()}.json`));
  p.quiet = (n) => f.quiet(n);
  const phone = await fakeSub(1), mac = await fakeSub(2), old = await fakeSub(3);
  p.subscribe(phone, "Android", undefined, PHONE);
  p.subscribe(mac, "Mac", undefined, MAC);
  // one from before SHEP-246: its page's socket tells which device it is on
  p.subscribe(old, "Android");
  p.nodeOf(old.endpoint, PHONE);
  const alert = { title: "HERD-5 · Needs you", body: "x", topic: "needs" };
  // a plain (not native) stream quiets nothing
  const plain = await reader(f.stream(PHONE, false));
  await p.send(alert);
  expect(hits.sort()).toEqual(["dev1", "dev2", "dev3"]);
  await plain.cancel();
  hits = [];
  const s = await reader(f.stream(PHONE, true));
  await p.send(alert);
  expect(hits).toEqual(["dev2"]);
  await s.cancel();
  hits = [];
  now += NATIVE_GRACE_MS - 1000;
  await p.send(alert);
  expect(hits).toEqual(["dev2"]);
  hits = [];
  now += 2000;
  await p.send(alert);
  expect(hits.sort()).toEqual(["dev1", "dev2", "dev3"]);
});

test("a page's socket fills in its subscription's device", () => {
  const l = new Live({ on() {} } as any, { on() {} } as any, () => null, "0");
  const told: string[][] = [];
  l.onPushDevice = (e, d) => told.push([e, d]);
  const ws = { readyState: 1, data: { who: "x", from: PHONE }, send() {}, getBufferedAmount: () => 0 };
  (l as any).pages.add(ws);
  l.message(ws, JSON.stringify({ type: "watch", chats: [], push: "https://push.example.test/dev9", visible: true }));
  expect(told).toEqual([["https://push.example.test/dev9", PHONE]]);
});

/* ---------- POST /api/open ---------- */

function page(from: string, seen: number, visible = true) {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, data: { who: "x", seen, visible, from }, send: (t: string) => sent.push(JSON.parse(t)), getBufferedAmount: () => 0 } as any };
}

test("open: only the asking device's page on screen gets go; none yet, its first page within 15 s", () => {
  setSystemTime(NOW);
  const l = new Live({ on() {} } as any, { on() {} } as any, () => null, "0");
  const phone = page(PHONE, NOW - 5000), mac = page(MAC, NOW);
  (l as any).pages.add(phone.ws); (l as any).pages.add(mac.ws);
  expect(l.go(PHONE, "./#accept=HERD-4")).toBe(true);
  expect(phone.sent).toEqual([{ type: "go", url: "./#accept=HERD-4" }]);
  expect(mac.sent).toEqual([]);
  const l2 = new Live({ on() {} } as any, { on() {} } as any, () => null, "0");
  const later = page(PHONE, NOW, false);
  (l2 as any).pages.add(later.ws);
  expect(l2.go(PHONE, "./?place=sp1&task=HERD-5&focus=q1")).toBe(false);
  l2.message(later.ws, JSON.stringify({ type: "watch", chats: [], visible: true }));
  expect(later.sent).toEqual([{ type: "go", url: "./?place=sp1&task=HERD-5&focus=q1" }]);
});

test("open: only a Shepherdr alert link", () => {
  for (const ok of ["./?place=sp1", "./?place=sp1&task=HERD-5&focus=q1", "./#accept=HERD-4", "./#accept=m3%3AHERD-4"]) expect(openUrlOk(ok)).toBe(true);
  for (const bad of ["https://evil.test/", "/?place=sp1", "./?task=HERD-5", "./?place=sp1&next=https://x", "javascript:alert(1)", "./#accept=", "./#settings", 5, null])
    expect(openUrlOk(bad)).toBe(false);
});

/* ---------- the gate ---------- */

test("the glance feed is checked as a write: origin and x-shepherdr from the tailnet", () => {
  const g = { owner: "me@example.test", dns: "box.tailnet.example", port: 7788, token: "t" };
  const req = (h: Record<string, string>) => new Request("http://127.0.0.1:7788/api/glance?stream=1&native=1", { headers: { host: g.dns, "tailscale-user-login": g.owner, ...h } });
  expect(gate(req({}), g, false, true, true)).toMatchObject({ ok: false, why: "wrong origin" });
  expect(gate(req({ origin: `https://${g.dns}` }), g, false, true, true)).toMatchObject({ ok: false, why: "missing x-shepherdr" });
  expect(gate(req({ origin: `https://${g.dns}`, "x-shepherdr": "1" }), g, false, true, true)).toMatchObject({ ok: true, via: "tailnet" });
  expect(gate(req({ origin: `https://${g.dns}`, "x-shepherdr": "1", "tailscale-user-login": "other@example.test" }), g, false, true, true)).toMatchObject({ ok: false });
});
