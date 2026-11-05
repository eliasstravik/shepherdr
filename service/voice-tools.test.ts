// The voice call's tools (voice-tools.ts) on a fixture snapshot: what each says, what it opens, and that an act
// changes nothing without the person's yes.
import { expect, test } from "bun:test";
import { voiceTool, findTask, findSpace, findArtifact, spacesSaid, shown, evidenceWords, type VoiceIO, type Where } from "./voice-tools.ts";

const now = Date.now();
const snap: any = {
  host: "vm", name: "Shepherdr", user: "You",
  machines: [{ id: "m:vm", machine: "vm", name: "This computer", status: "idle", here: true }, { id: "m:mini", machine: "mini", name: "Mac mini", status: "off", unreachableSince: "14:02" }],
  places: [
    { id: "sp1", name: "shepherdr", machine: "vm", chat: "p:sp1", mode: "autopilot", level: 2, status: "idle", pilot: { on: true, next_run: Math.round((now + 3600_000) / 1000), pending: false, inflight: false, events: ["Started SHEP-45"], blank: false } },
    { id: "mini/sp2", name: "gtm", machine: "mini", chat: "p:mini:sp2", mode: "regular", level: 2, status: "idle" },
  ],
  tasks: [
    { id: "SHEP-45", name: "Voice calls can read and navigate", status: "work", place: "sp1", left: "2h", report: { msg: "Writing tests", progress: 65 }, agent: { chat: "SHEP-45/worker", role: "worker", cli: "claude", status: "work", age: "" }, at: now - 60_000, age: "", state: "", on: "", created: "" },
    { id: "SHEP-41", name: "Model menu: Fast switch", status: "ready", place: "sp1", summary: "The Fast switch is back", pr: { number: 681, url: "x" }, at: now - 3600_000, age: "", state: "", on: "", created: "" },
    { id: "mini:GTM-3", name: "Outbound list", status: "need", place: "mini/sp2", report: { msg: "Asking about the list" }, agent: { chat: "mini:GTM-3/worker", role: "worker", cli: "claude", status: "need", age: "" }, at: now - 7200_000, age: "", state: "", on: "", created: "" },
    { id: "SHEP-30", name: "Old thing", status: "done", place: "sp1", doneAt: now - 86400_000 * 3, at: now - 86400_000 * 3, age: "", state: "", on: "", created: "" },
    { id: "SHEP-50", name: "Later work", status: "scheduled", place: "sp1", startsAt: now + 7200_000, at: now - 100, age: "", state: "", on: "", created: "" },
  ],
  needs: [{ id: "q1", chat: "mini:GTM-3/worker", place: "mini/sp2", task: "mini:GTM-3", at: now, question: { id: "q1", title: "Which list?", kind: "Question", to: "", choices: [{ label: "Sweden" }, { label: "Norway" }] } }],
  automations: { sp1: [{ name: "nightly", when: "Every day at 2:00", what: "Run the checks", on: true, next: ["Tomorrow 2:00"] }] },
  artifacts: [{ id: "a1", title: "SHEP-41 Model menu · Proof", place: "sp1", v: 2, at: now - 600_000, when: "10m", by: "SHEP-41 agent" }],
  alerts: [{ id: "al", at: now - 30_000, title: "Memory at 91%", body: "The VM is low on memory", notify: true }],
  settings: [
    { name: "Tasks", level: "all", rows: [{ label: "Review", key: "tasks.review", value: "off", options: ["on", "off"] }, { label: "Base branch", key: "tasks.base", value: "", text: true }] },
    { name: "Tasks", level: "sp1", rows: [{ label: "Review", key: "tasks.review", value: "on", options: ["on", "off"] }] },
    { name: "Secrets", level: "all", rows: [], vault: [{ name: "ELEVENLABS_API_KEY", scope: "everywhere", where: "Everywhere" }, { name: "GH_TOKEN", scope: "space", space: "sp1", where: "Space shepherdr" }] },
  ],
  asks: {},
};

const chats: Record<string, any> = {
  "SHEP-45/worker": { status: "working", doing: "Running the tests", items: [
    { who: "you", text: "Please add the voice tools", at: now - 600_000 },
    { who: "agent", text: "On it: first the spec, then the service.", at: now - 500_000 },
    { who: "agent", text: "The read_chat bug: the service only read chats a page had open.", at: now - 100_000 },
  ] },
};
function io(over: Partial<VoiceIO> = {}) {
  const calls: any[] = [], sent: any[] = [];
  const x: VoiceIO & { calls: any[]; sent: any[] } = {
    calls, sent,
    snap: () => snap,
    chat: async (key) => chats[key] ?? null,
    send: async (key, text) => { sent.push({ key, text }); },
    action: async (body) => { calls.push(body); return { ok: true }; },
    addrOf: (key) => (key === "SHEP-45/worker" ? "t1" : null),
    taskWhere: (id) => ({ ref: id.split(":").pop()!, folder: "/repo", machine: null }),
    ...over,
  };
  return x;
}
const web: Where = { client: "web", device: "phone", call: "SHEP-45/worker", place: "sp1", task: "SHEP-45", tab: "chat" };

test("look here: the app, the call's agent and what is on screen", async () => {
  const a = await voiceTool("look", { what: "here" }, web, io());
  expect(a.result).toContain("web app on a phone");
  expect(a.result).toContain("SHEP 45's agent");
  expect(a.result).toContain("the shepherdr space");
  expect(a.result).toContain("1 waiting on the person, 1 ready for review, 1 working");
});

test("look chat: the call's own by default, its status and last messages, oldest first", async () => {
  const a = await voiceTool("look", { what: "chat", count: 2 }, web, io());
  expect(a.result).toMatch(/^SHEP 45's agent is working: Running the tests\./);
  expect(a.result).toContain("Agent (8 minutes ago): On it");
  expect(a.result).not.toContain("Please add");
  expect(a.result.indexOf("On it")).toBeLessThan(a.result.indexOf("read_chat bug"));
});

test("look chat with a query searches it, and reads further back when it has to", async () => {
  let pulled = 0;
  const x = io({ chat: async () => ({ ...chats["SHEP-45/worker"], items: [...chats["SHEP-45/worker"].items], earlier: async () => (++pulled < 2) }) });
  const a = await voiceTool("look", { what: "chat", query: "bug" }, web, x);
  expect(a.result).toContain("1 message in SHEP 45's agent's chat about \"bug\"");
  expect(pulled).toBeGreaterThan(0);
  const none = await voiceTool("look", { what: "chat", query: "unicorn" }, web, io());
  expect(none.result).toContain("Nothing about \"unicorn\"");
});

test("look chat of another space's Assistant that isn't running says so", async () => {
  const a = await voiceTool("look", { what: "chat", id: "gtm" }, web, io());
  expect(a.error).toBe(true);
  expect(a.result).toContain("the gtm Assistant");
});

test("look tasks: open ones by state first; filters by state, space and machine", async () => {
  const all = await voiceTool("look", { what: "tasks" }, web, io());
  expect(all.result).toMatch(/^4 tasks: 1 needs you, 1 ready for review, 1 working, 1 scheduled\./);
  expect(all.result.indexOf("GTM 3")).toBeLessThan(all.result.indexOf("SHEP 41"));
  expect(all.result).toContain("working, 65% done, 2h left. Writing tests");
  expect(all.result).not.toContain("SHEP 30");
  const ready = await voiceTool("look", { what: "tasks", query: "ready" }, web, io());
  expect(ready.result).toContain("SHEP 41");
  expect(ready.result).not.toContain("SHEP 45");
  const mini = await voiceTool("look", { what: "tasks", id: "Mac mini" }, web, io());
  expect(mini.result).toMatch(/^1 task on Mac mini/);
  const here = await voiceTool("look", { what: "tasks", id: "here" }, web, io());
  expect(here.result).toContain("in shepherdr");
});

test("look task: by spoken id, number or 'this'; a Ready one with its checks", async () => {
  const x = io({ action: async (b) => (b.type === "evidence" ? { commits: [1, 2], files: [1], checks: [{ name: "check", conclusion: "success" }], proof: { title: "Proof" } } : { ok: true }) });
  const a = await voiceTool("look", { what: "task", id: "shep 41" }, web, x);
  expect(a.result).toContain("SHEP 41, \"Model menu: Fast switch\", in shepherdr: ready for review.");
  expect(a.result).toContain("Pull request number 681");
  expect(a.result).toContain("Changes: 2 commits, 1 file. Checks: all 1 passed. It has a proof page, \"Proof\".");
  expect((await voiceTool("look", { what: "task", id: "this" }, web, io())).result).toContain("SHEP 45");
  expect(findTask(snap, "45", web)?.id).toBe("SHEP-45");
  expect(findTask(snap, "GTM-3", web)?.id).toBe("mini:GTM-3");
  expect(findTask(snap, "outbound", web)?.id).toBe("mini:GTM-3");
  const need = await voiceTool("look", { what: "task", id: "gtm 3" }, web, io());
  expect(need.result).toContain("It waits for: Which list?");
});

test("look needs, news, spaces, machines, autopilot, automations", async () => {
  const needs = (await voiceTool("look", { what: "needs" }, web, io())).result;
  expect(needs).toContain("GTM 3 asks: Which list? (choices: Sweden, Norway)");
  expect(needs).toContain("SHEP 41, \"Model menu: Fast switch\", is ready for review");
  const news = (await voiceTool("look", { what: "news", count: 3 }, web, io())).result;
  expect(news.split("\n")[1]).toContain("SHEP 50");
  expect(news).toContain("Alert, Memory at 91%");
  const spaces = (await voiceTool("look", { what: "spaces" }, web, io())).result;
  expect(spaces).toContain("On This computer (vm): shepherdr: Autopilot on, 1 ready, 1 working.");
  expect(spaces).toContain("On Mac mini (offline): gtm: 1 need you.");
  expect((await voiceTool("look", { what: "machines" }, web, io())).result).toContain("Mac mini: offline since 14:02, 1 space, 0 tasks working.");
  const pilot = (await voiceTool("look", { what: "autopilot" }, web, io())).result;
  expect(pilot).toContain("Autopilot is on in 1 space");
  expect(pilot).toMatch(/next wake in (60 minutes|1 hours)/);
  expect((await voiceTool("look", { what: "autopilot", id: "gtm" }, web, io())).result).toBe("gtm: Autopilot off.");
  expect((await voiceTool("look", { what: "automations" }, web, io())).result).toContain("nightly (shepherdr): Every day at 2:00, adds \"Run the checks\", next Tomorrow 2:00.");
});

test("look settings, secrets (names only), artifacts", async () => {
  const st = (await voiceTool("look", { what: "settings", query: "review" }, web, io())).result;
  expect(st).toContain("Tasks › Review: off (choices: on, off)");
  expect((await voiceTool("look", { what: "settings", id: "here", query: "review" }, web, io())).result).toContain("Review: on");
  const sec = (await voiceTool("look", { what: "secrets" }, web, io())).result;
  expect(sec).toContain("ELEVENLABS_API_KEY, Everywhere");
  expect(sec).toContain("values are never read out");
  expect((await voiceTool("look", { what: "artifacts", query: "proof" }, web, io())).result).toContain("\"SHEP-41 Model menu · Proof\" in shepherdr, 10 minutes ago by SHEP-41 agent");
});

test("open: what it shows in the app the call runs in", async () => {
  expect((await voiceTool("open", { what: "space", id: "the gtm space" }, web, io())).nav).toEqual({ kind: "space", place: "mini/sp2" });
  const t = await voiceTool("open", { what: "task", id: "this", tab: "terminal" }, web, io());
  expect(t.nav).toMatchObject({ kind: "task", task: "SHEP-45", tab: "terminal", chat: "SHEP-45/worker", addr: "t1", ref: "SHEP-45", folder: "/repo" });
  // never "it's open" before the app says so
  expect(t.result).toContain("hasn't confirmed");
  expect(t.shows).toBe("SHEP 45's terminal");
  const review = await voiceTool("open", { what: "task", id: "45", tab: "review" }, web, io());
  expect(review.error).toBe(true);
  expect((await voiceTool("open", { what: "task", id: "41", tab: "review" }, web, io())).nav).toMatchObject({ kind: "task", task: "SHEP-41", tab: "review" });
  expect((await voiceTool("open", { what: "tasks", query: "ready" }, web, io())).nav).toEqual({ kind: "tasks", filter: "ready" });
  expect((await voiceTool("open", { what: "artifact", id: "model menu proof" }, web, io())).nav).toMatchObject({ kind: "artifact", artifact: "a1" });
  expect((await voiceTool("open", { what: "chat" }, web, io())).nav).toEqual({ kind: "chat", chat: "SHEP-45/worker", addr: "t1" });
});

test("send: here, a space's Assistant, a task's agent; one with no agent says so", async () => {
  const x = io();
  expect((await voiceTool("send", { text: "Run the tests" }, web, x)).result).toBe("Sent to SHEP 45's agent.");
  expect((await voiceTool("send", { to: "gtm", text: "Add a task: call Bob" }, web, x)).result).toBe("Sent to the gtm Assistant.");
  expect(x.sent).toEqual([{ key: "SHEP-45/worker", text: "Run the tests" }, { key: "p:mini:sp2", text: "Add a task: call Bob" }]);
  const none = await voiceTool("send", { to: "SHEP-41", text: "hi" }, web, x);
  expect(none.error).toBe(true);
  expect(none.result).toContain("has no agent running");
  // an agent made before: its old tools still work
  expect((await voiceTool("send_to_agent", { text: "old" }, web, x)).result).toBe("Sent to SHEP 45's agent.");
  expect((await voiceTool("read_chat", {}, web, x)).result).toContain("is working");
});

test("act changes nothing until confirmed, then sends the web app's action", async () => {
  const x = io();
  const ask = await voiceTool("act", { action: "accept", id: "41", confirmed: false }, web, x);
  expect(ask.result).toContain("Nothing changed yet. Ask the person: \"Accept SHEP 41, \"Model menu: Fast switch\"? That merges it.\"");
  expect(x.calls).toEqual([]);
  expect((await voiceTool("act", { action: "accept", id: "41", confirmed: true }, web, x)).result).toBe("Accepted SHEP 41: it merges now.");
  expect(x.calls.pop()).toEqual({ type: "accept", task: "SHEP-41" });
  expect((await voiceTool("act", { action: "accept", id: "45", confirmed: true }, web, x)).error).toBe(true);
  await voiceTool("act", { action: "schedule", id: "this", value: "in 2 hours", confirmed: true }, web, x);
  expect(x.calls.pop()).toEqual({ type: "schedule", chat: "SHEP-45/worker", in: "2 hours" });
  await voiceTool("act", { action: "autopilot_off", id: "here", confirmed: true }, web, x);
  expect(x.calls.pop()).toEqual({ type: "mode", place: "sp1", mode: "regular" });
  await voiceTool("act", { action: "autopilot_run", id: "shepherdr", confirmed: true }, web, x);
  expect(x.calls.pop()).toEqual({ type: "autopilot-run", place: "sp1" });
  await voiceTool("act", { action: "setting", key: "review", value: "On", confirmed: true }, web, x);
  expect(x.calls.pop()).toEqual({ type: "setting", key: "tasks.review", value: "on", place: "all" });
  expect((await voiceTool("act", { action: "setting", key: "review", value: "maybe", confirmed: true }, web, x)).result).toBe("Review can be: on, off.");
  await voiceTool("act", { action: "forget_secret", key: "GH_TOKEN", confirmed: true }, web, x);
  expect(x.calls.pop()).toEqual({ type: "secret", level: "sp1", name: "GH_TOKEN", value: null });
  await voiceTool("act", { action: "reopen", id: "SHEP-30", confirmed: true }, web, x);
  expect(x.calls.pop()).toEqual({ type: "reopen", chat: "SHEP-30/worker" });
  // a refusal comes back in its words
  const no = await voiceTool("act", { action: "delete", id: "45", confirmed: true }, web, io({ action: async () => ({ ok: false, error: "It holds work." }) }));
  expect(no).toEqual({ result: "It holds work.", error: true });
});

test("finding spaces by name, words and here; the window's here", () => {
  expect(findSpace(snap, "Shepherdr", web)?.id).toBe("sp1");
  expect(findSpace(snap, "gtm on the mac mini", web)?.id).toBe("mini/sp2");
  const win: Where = { client: "window", machine: "vm", call: "p:mini:sp2" };
  expect(findSpace(snap, "here", win)?.id).toBe("mini/sp2");
});

test("results stay short, and evidence words read plainly", async () => {
  const big = { ...chats["SHEP-45/worker"], items: Array.from({ length: 30 }, (_, i) => ({ who: "agent", text: "x".repeat(2000) + i })) };
  const a = await voiceTool("look", { what: "chat", count: 30 }, web, io({ chat: async () => big }));
  expect(a.result.length).toBeLessThanOrEqual(3500);
  expect(evidenceWords({ checks: [{ name: "build", conclusion: "failure" }, { name: "lint", conclusion: "success" }] })).toBe("Checks: 1 failed (build).");
  expect(evidenceWords(null)).toBe("");
});

// The person's fleet as the Mac mini serves it: the mini is "This computer" (its key its host name), the MacBook and a
// VM linked, each with a Home space.
const fleet: any = {
  ...snap,
  host: "eliass-mac-mini",
  machines: [
    { id: "m:eliass-mac-mini", machine: "eliass-mac-mini", name: "This computer", ownName: "This computer", status: "idle", here: true },
    { id: "m:mbp", machine: "eliass-macbook-pro", name: "MacBook Pro", ownName: "eliass-macbook-pro", emoji: "💻", status: "idle" },
    { id: "m:vm", machine: "vm-dev", name: "Dev VM", ownName: "vm-dev", status: "idle" },
  ],
  places: [
    { id: "h1", name: "Home", home: true, machine: "eliass-mac-mini", chat: "p:h1", mode: "regular", level: 0, status: "idle" },
    { id: "s1", name: "shepherdr", machine: "eliass-mac-mini", chat: "p:s1", mode: "regular", level: 2, status: "idle" },
    { id: "eliass-macbook-pro/h2", name: "Home", home: true, machine: "eliass-macbook-pro", chat: "p:eliass-macbook-pro:h2", mode: "regular", level: 0, status: "idle" },
    { id: "vm-dev/h3", name: "Home", home: true, machine: "vm-dev", chat: "p:vm-dev:h3", mode: "regular", level: 0, status: "idle" },
    { id: "vm-dev/s4", name: "mini app", machine: "vm-dev", chat: "p:vm-dev:s4", mode: "regular", level: 2, status: "idle" },
  ],
  artifacts: [
    { id: "old", title: "SHEP-40 Voice call · Proof", place: "s1", v: 1, at: now - 86400_000, when: "1d", by: "SHEP-40 agent" },
    { id: "new", title: "SHEP-45 Voice calls read and navigate · Proof", place: "s1", v: 3, at: now - 3600_000, when: "1h", by: "SHEP-45 agent" },
    { id: "hulk", title: "Hulk mini game · Proof", place: "s1", v: 1, at: now - 7200_000, when: "2h", by: "SHEP-39 agent" },
  ],
};
const fromMbp: Where = { client: "web", device: "desktop", machine: "eliass-mac-mini", call: "p:s1", place: "s1" };

test("a space by its machine: the Mac mini that serves (\"This computer\") by its own name, others by theirs", () => {
  const id = (q: string) => spacesSaid(fleet, q, fromMbp).map((p) => p.id);
  expect(id("Mac Mini Home")).toEqual(["h1"]);
  expect(id("Home on the Mac mini")).toEqual(["h1"]);
  expect(id("the mac mini's home space")).toEqual(["h1"]);
  expect(id("home on this computer")).toEqual(["h1"]);
  expect(id("MacBook Pro home")).toEqual(["eliass-macbook-pro/h2"]);
  expect(id("home on the macbook")).toEqual(["eliass-macbook-pro/h2"]);
  expect(id("dev vm home")).toEqual(["vm-dev/h3"]);
  // a space whose name has a machine's word in it
  expect(id("mini app")).toEqual(["vm-dev/s4"]);
  // truly ambiguous: every machine has a Home
  expect(id("home")).toHaveLength(3);
  expect(findSpace(fleet, "home", fromMbp)).toBeNull();
});

test("open space: the one meant, or which one when several fit", async () => {
  const x = { ...io(), snap: () => fleet };
  const a = await voiceTool("open", { what: "space", id: "Mac Mini Home" }, fromMbp, x);
  expect(a.nav).toEqual({ kind: "space", place: "h1" });
  expect(a.shows).toBe("the Home on This computer (eliass-mac-mini) space");
  const which = await voiceTool("open", { what: "space", id: "Home" }, fromMbp, x);
  expect(which.error).toBe(true);
  expect(which.nav).toBeUndefined();
  expect(which.result).toContain("Which one: Home on This computer (eliass-mac-mini); Home on MacBook Pro; Home on Dev VM?");
});

test("an artifact by words of its title, newest first", () => {
  expect(findArtifact(fleet, "the voice call one", fromMbp)?.id).toBe("new");
  expect(findArtifact(fleet, "voice call proof", fromMbp)?.id).toBe("new");
  expect(findArtifact(fleet, "SHEP-40", fromMbp)?.id).toBe("old");
  expect(findArtifact(fleet, "the Hulk mini game", fromMbp)?.id).toBe("hulk");
  expect(findArtifact(fleet, "hulk", fromMbp)?.id).toBe("hulk");
  expect(findArtifact(fleet, "quarterly sales deck", fromMbp)).toBeNull();
});

test("open is on screen only once the app that started the call says so", async () => {
  const a = await voiceTool("open", { what: "artifact", id: "hulk mini game" }, fromMbp, { ...io(), snap: () => fleet });
  expect((await shown(a, async () => ({ ok: true }))).result).toBe("It's on the person's screen now: the artifact \"Hulk mini game · Proof\".");
  const no = await shown(a, async () => ({ ok: false, why: "this app doesn't list that artifact" }));
  expect(no.error).toBe(true);
  expect(no.result).toContain("couldn't open");
  expect(no.result).toContain("doesn't list that artifact");
  // an old page that never answers: not on screen
  const silent = await shown(a, async () => null);
  expect(silent.error).toBe(true);
  expect(silent.result).not.toContain("on the person's screen now");
  // look and send aren't asked about
  const look = await voiceTool("look", { what: "here" }, fromMbp, { ...io(), snap: () => fleet });
  expect(await shown(look, async () => { throw new Error("asked"); })).toEqual(look);
});
