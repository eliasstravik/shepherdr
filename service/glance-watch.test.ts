// @ts-nocheck: fake snapshots and a fake chat reader
// SHEP-447: what the watch needs beyond the list: spaces to send a new task to, a Ready task's review, checks and proof,
// unread chats' newest words, events worth a buzz that are no task, the plan's use, and a chat's pages for its own app.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "glance-watch-"));
process.env.SHEPHERDR_DATA = dir;
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
const { alertsOf } = await import("./push.ts");
const { GlanceFeed, glanceOf, CHAT_TEXT, MAX_SPACES } = await import("./glance.ts");
const { chatPage, lineOf, pageOf } = await import("./native-chat.ts");

const NOW = new Date(2026, 10, 24, 15, 0, 0).getTime();
const MIN = 60_000;
const snapOf = (over: any = {}) => ({
  places: [
    { id: "sp1", name: "home", chat: "p:sp1", machine: "mini", home: true, changedAt: NOW - 50 * MIN },
    { id: "sp2", name: "shop", chat: "p:sp2", machine: "mini", changedAt: NOW - 5 * MIN - 1234 },
    { id: "sp3", name: "old", chat: "p:sp3", machine: "vm", archived: true, changedAt: NOW },
    { id: "sp4", name: "blog", chat: "p:sp4", machine: "vm" },
  ],
  machines: [{ id: "m:mini", machine: "mini", name: "Mac mini", status: "idle", here: true }, { id: "m:vm", machine: "vm", name: "Dev VM", status: "idle" }],
  tasks: [
    { id: "SHOP-1", name: "Fix login", status: "ready", place: "sp2", at: NOW - 9 * MIN, summary: "Login works again", review: "passed", pr: { number: 3, url: "u", checks: "passed" }, proof: "fix-login-1", artifacts: ["fix-login-1", "notes-2"] },
    { id: "SHOP-2", name: "Make it blue", status: "ready", place: "sp2", at: NOW - 8 * MIN, review: "changes", pr: { number: 4, url: "u", checks: "failed" } },
    { id: "SHOP-3", name: "Plain one", status: "ready", place: "sp4", at: NOW - 7 * MIN },
    { id: "SHOP-4", name: "Running checks", status: "ready", place: "sp4", at: NOW - 6 * MIN, pr: { number: 5, url: "u", checks: "running" } },
    { id: "BLOG-1", name: "Write a post", status: "work", place: "sp4", at: NOW - 2 * MIN },
  ],
  artifacts: [{ id: "fix-login-1", proof: true }, { id: "notes-2" }],
  needs: [],
  alerts: [],
  ...over,
});
const doc = (snap: any, last = () => null, now = NOW) => glanceOf(snap, alertsOf(snap), now, last);

test("spaces: last used first (its Assistant or its newest task), to the minute; archived ones left out; each with its chat", () => {
  const g = doc(snapOf());
  expect(g.spaces).toEqual([
    { id: "sp4", name: "blog", machine: "vm", chat: "p:sp4", used: NOW - 2 * MIN },
    { id: "sp2", name: "shop", machine: "mini", chat: "p:sp2", used: NOW - 6 * MIN },
    { id: "sp1", name: "home", machine: "mini", chat: "p:sp1", used: NOW - 50 * MIN, home: true },
  ]);
  const many = snapOf({ places: Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, name: `s${i}`, chat: `p:s${i}`, machine: "mini" })), tasks: [] });
  expect(doc(many).spaces.length).toBe(MAX_SPACES);
});

test("a Ready item says its review, checks and proof count; nothing red only when review didn't ask for changes and checks aren't red", () => {
  const ready = Object.fromEntries(doc(snapOf()).items.filter((i) => i.kind === "ready").map((i) => [i.task, [i.review, i.checks, i.proofs]]));
  expect(ready).toEqual({ "SHOP-1": ["passed", "green", 1], "SHOP-2": ["changes", "red", 0], "SHOP-3": ["none", "none", 0], "SHOP-4": ["none", "running", 0] });
  // only Ready items carry them
  expect(doc(snapOf()).items.find((i) => i.kind === "working").review).toBeUndefined();
});

test("unread chats: the Assistant's newest words, first lines only, with the chat to open; none from the person's own", () => {
  const long = "Done: **the shop** builds again.\n\n" + "More words here. ".repeat(40);
  const s = snapOf({ last: { "p:sp2": 7, "p:sp4": 3 }, read: { "p:sp2": 6, "p:sp4": 2 } });
  const said = { "p:sp2": { who: "agent", text: long }, "p:sp4": { who: "you", text: "hi" } };
  const g = doc(s, (k) => said[k]);
  expect(g.unread).toBe(2);
  expect(g.chats[0]).toMatchObject({ chat: "p:sp2", place: "sp2", space: "shop", machine: "mini" });
  expect(g.chats[0].text.startsWith("Done: the shop builds again.\n\nMore words")).toBe(true);
  expect(g.chats[0].text.length).toBeLessThanOrEqual(CHAT_TEXT);
  expect(g.chats[0].text.endsWith("…")).toBe(true);
  expect(g.chats[1]).toEqual({ chat: "p:sp4", place: "sp4", space: "blog", machine: "vm" });
  // read: gone
  expect(doc(snapOf({ last: { "p:sp2": 7 }, read: { "p:sp2": 7 } }), (k) => said[k]).chats).toEqual([]);
});

test("events: a schedule whose run failed, a machine out of reach or short of memory; the memory guard's alert stands for its machine once", () => {
  const s = snapOf({
    automations: { sp2: [{ id: "a1", name: "Nightly deps", place: "sp2", failed: "start", error: "Couldn't start: no space left", runs: [{ at: NOW - MIN, error: "x" }], on: true, next: [] },
      { id: "a2", name: "Fine", place: "sp2", on: true, next: [] }],
      sp1: [{ id: "a1", name: "Nightly deps", place: "sp2", failed: "start", error: "Couldn't start: no space left", on: true, next: [] }] },
    warnings: [{ id: "m:vm:down", kind: "machine", text: "Can't reach Dev VM · last seen 14:02" }, { id: "m:mini:memory", kind: "machine", text: "Mac mini: memory nearly full" },
      { id: "m:mini:disk", kind: "machine", text: "Mac mini: disk nearly full" }, { id: "u:Claude:Weekly", kind: "usage", text: "You've used 80%" }],
  });
  expect(doc(s).events).toEqual([
    { key: "schedule::a1:start", kind: "schedule", title: "Schedule failed · Nightly deps", body: "Couldn't start: no space left", at: NOW - MIN, place: "sp2", machine: null, alert: true, url: "./?place=sp2" },
    { key: "machine:vm:down", kind: "machine", title: "Can't reach Dev VM", body: "Can't reach Dev VM · last seen 14:02", machine: "vm", alert: true },
    { key: "machine:mini:memory", kind: "machine", title: "Mac mini: memory nearly full", body: "Mac mini: memory nearly full", machine: "mini", alert: true },
  ]);
  // the memory guard's own alert while it stands takes the warning's place
  const guard = { id: "mem1", at: NOW - MIN, title: "Memory at 93% · 2 agents stopped", body: "Stopped the newest agents to free memory.", notify: true, memory: true };
  const g = doc({ ...s, alerts: [guard] });
  expect(g.events.filter((e) => e.kind === "machine").map((e) => e.key)).toEqual(["alert:mem1", "machine:vm:down"]);
  // nothing failing: none
  expect(doc(snapOf()).events).toEqual([]);
});

test("an event notifies: urgent moves with a new one; a frame goes at once", () => {
  const f = new GlanceFeed(() => NOW, 0);
  const calm = doc(snapOf());
  f.set(calm);
  const down = doc(snapOf({ warnings: [{ id: "m:vm:down", kind: "machine", text: "Can't reach Dev VM" }] }));
  expect(down.urgent).not.toBe(calm.urgent);
  expect(f.set(down)).toBe(true);
  // spaces, chats and usage alone change v, never urgent
  const used = doc(snapOf({ config: { plans: [{ name: "Claude Max", windows: [{ name: "Weekly", used: 40 }] }] } }));
  expect(used.urgent).toBe(calm.urgent);
  expect(used.v).not.toBe(calm.v);
});

test("usage: the plan window with the least left, as Settings › Plans has it; none read: null", () => {
  const s = snapOf({ config: { plans: [{ name: "Claude Max", windows: [{ name: "5-hour", used: 12 }, { name: "Weekly", used: 61.4, resets: "Resets Fri 9:00" }] }, { name: "Codex Pro", windows: [{ name: "Weekly", used: 30 }] }] } });
  expect(doc(s).usage).toEqual({ plan: "Claude Max", window: "Weekly", used: 61, left: 39, resets: "Resets Fri 9:00" });
  expect(doc(snapOf()).usage).toBeNull();
});

test("an older reader's fields are all still there, unchanged", () => {
  const g = doc(snapOf());
  for (const k of ["format", "v", "urgent", "at", "counts", "order", "groups", "items", "unread"]) expect(g).toHaveProperty(k);
  expect(g.format).toBe(1);
});

/* ---------- a chat's pages ---------- */

const msgs = [
  { id: "m1", who: "you", text: "Make the shop blue", at: 1 },
  { id: "b1", who: "agent", text: "brief", brief: { label: "Task brief" } },
  { id: "m2", who: "agent", text: "**On it.** See [the page](https://x)", at: 2 },
  { id: "m3", who: "agent", question: { id: "q", title: "Blue or teal?" }, at: 3 },
  { id: "m4", who: "agent", activity: { rows: [] } },
  { id: "m5", who: "you", text: "Teal", at: 5 },
];

test("lines: plain words, newest first; quiet rows left out; a question is its title", () => {
  expect(lineOf(msgs[1])).toBeNull();
  expect(lineOf(msgs[4])).toBeNull();
  const p = pageOf({ messages: msgs }, "p:sp2");
  expect(p).toEqual({ chat: "p:sp2", more: false, messages: [
    { id: "m5", who: "you", at: 5, text: "Teal" },
    { id: "m3", who: "agent", at: 3, text: "Blue or teal?", question: true },
    { id: "m2", who: "agent", at: 2, text: "On it. See the page" },
    { id: "m1", who: "you", at: 1, text: "Make the shop blue" },
  ] });
});

test("pages: limit and before; more while older ones or earlier log pages are there; an unknown before is an empty page", () => {
  const a = pageOf({ messages: msgs }, "c", undefined, 2);
  expect(a.messages.map((m) => m.id)).toEqual(["m5", "m3"]);
  expect(a.more).toBe(true);
  const b = pageOf({ messages: msgs }, "c", "m3", 2);
  expect(b.messages.map((m) => m.id)).toEqual(["m2", "m1"]);
  expect(b.more).toBe(false);
  expect(pageOf({ messages: msgs, earlier: true }, "c", "m3", 2).more).toBe(true);
  expect(pageOf({ messages: msgs }, "c", "gone")).toEqual({ chat: "c", messages: [], more: false });
});

test("chatPage: follows the chat for the moment, reads earlier log pages for a short page, lets it go after", async () => {
  let watching = 0, earlierCalls = 0;
  const reader = { pages: 1 };
  const all = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, who: i % 2 ? "agent" : "you", text: `words ${i}`, at: i }));
  const d = {
    addrOf: (k) => (k === "p:sp2" ? "mini/t1" : null),
    freshChat: (k) => (k === "p:new" ? { messages: [], top: true } : null),
    chatOf: () => ({ messages: all.slice(-10 * reader.pages), earlier: reader.pages < 3 }),
    terminal: () => ({}),
    watch: (_a, w) => { watching++; setTimeout(() => w(reader, {}), 1); },
    unwatch: () => { watching--; },
    earlier: async (r) => { earlierCalls++; r.pages++; return true; },
  };
  const p = await chatPage(d, "p:sp2", undefined, 25);
  expect(p.messages.length).toBe(25);
  expect(p.messages[0].id).toBe("m29");
  expect(p.more).toBe(true);
  expect(earlierCalls).toBe(2);
  expect(watching).toBe(0);
  // a limit past 50 is 50; a chat with no agent yet is its fresh chat; none at all: null
  expect((await chatPage(d, "p:new")).messages).toEqual([]);
  expect(await chatPage(d, "p:nope")).toBeNull();
});
