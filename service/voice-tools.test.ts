// The voice call's tools (voice-tools.ts) on a fixture snapshot as the 3.2 service sends it (service/next.ts enrich):
// what each says, in the app's own words; what it opens, as the page's voiceNav takes it; and that an act which
// deletes, merges or stops changes nothing without the person's yes. Fake data only.
import { expect, test } from "bun:test";
import { voiceTool, findTask, findSpace, findArtifact, spacesSaid, shown, evidenceWords, taskSaid, type VoiceIO, type Where } from "./voice-tools.ts";
import { ACTS, ASK_FIRST } from "../core/voice.js";
import { statusWord } from "../web/shared/view.ts";

const now = Date.now();
const pick = { agent: "claude", model: "opus", effort: "high", fast: false, perm: null };
const base = { age: "", state: "", on: "", created: "" };
const snap: any = {
  host: "box", name: "Shepherdr", user: "You", everything: "home",
  machines: [{ id: "m:box", machine: "box", name: "box", status: "idle", here: true }, { id: "m:mini", machine: "mini", name: "Mac mini", status: "off", unreachableSince: "14:02" }],
  places: [
    { id: "home", name: "home", home: true, machine: "box", chat: "p:home", level: 0, status: "idle" },
    { id: "sp1", name: "shop", machine: "box", chat: "p:sp1", level: 2, status: "idle" },
    { id: "mini/sp2", name: "garden", machine: "mini", chat: "p:mini:sp2", level: 2, status: "idle", needs: true },
    { id: "sp3", name: "attic", machine: "box", chat: "p:sp3", level: 2, status: "idle", archived: true },
    { id: "mini/h", name: "home", home: true, machine: "mini", chat: "p:mini:h", level: 1, status: "idle" },
  ],
  tasks: [
    { ...base, id: "SHOP-45", name: "Voice reads the new app", status: "work", place: "sp1", started: now - 600_000, report: { msg: "Writing tests", progress: 50, eta: 10 }, repo: "branch", agent: { chat: "SHOP-45/worker", role: "worker", cli: "claude", status: "work", age: "" }, at: now - 60_000 },
    { ...base, id: "SHOP-41", name: "Fast switch in the picker", status: "ready", place: "sp1", summary: "The Fast switch is back", repo: "branch", branch: "task/41", needsAt: now - 7200_000, at: now - 3600_000, agent: { chat: "SHOP-41/worker", role: "worker", cli: "claude", status: "ready", age: "" } },
    { ...base, id: "mini:GARD-3", name: "Outbound list", status: "need", place: "mini/sp2", blocked: "question", needsAt: now - 300_000, agent: { chat: "mini:GARD-3/worker", role: "worker", cli: "claude", status: "need", age: "" }, at: now - 7200_000 },
    { ...base, id: "SHOP-30", name: "Old thing", status: "done", place: "sp1", merged: true, doneAt: now - 86400_000 * 3, at: now - 86400_000 * 3 },
    { ...base, id: "SHOP-50", name: "Later work", status: "todo", place: "sp1", afterTitle: "Voice reads the new app", at: now - 100 },
    { ...base, id: "SHOP-51", name: "Nightly links", status: "need", place: "sp1", stopped: { by: "limit", why: "It hit its plan's limit." }, needsAt: now - 120_000, at: now - 120_000 },
    { ...base, id: "SHOP-52", name: "Check the links", status: "done", place: "sp1", quiet: "nothing", schedule: "nightly", doneAt: now - 3600_000, at: now - 3600_000 },
    { ...base, id: "SHOP-53", name: "Sign in to the store", status: "need", place: "sp1", repo: "folder", agent: { chat: "SHOP-53/worker", role: "worker", cli: "claude", status: "need", age: "" }, needsAt: now - 60_000, at: now - 50_000 },
  ],
  needs: [
    { id: "q1", chat: "mini:GARD-3/worker", place: "mini/sp2", task: "mini:GARD-3", at: now, question: { id: "q1", title: "Which list?", kind: "Question", to: "", choices: [{ label: "Sweden" }, { label: "Norway" }] } },
    { id: "q2", chat: "p:mini:sp2", place: "mini/sp2", at: now, question: { id: "q2", title: "Run a command", command: "npm test", kind: "Question", to: "", choices: [{ label: "Allow once" }, { label: "Decline" }] } },
    { id: "attention", chat: "SHOP-53/worker", place: "sp1", task: "SHOP-53", at: now, text: "" },
  ],
  screens: { "task:SHOP-53": { b: { url: "https://store.example" }, active: true, hands: { what: "Sign in to the store" } }, "task:SHOP-45": { b: { url: "http://localhost" }, active: true, driver: "agent" } },
  automations: { sp1: [{ id: "|/repo|nightly", place: "sp1", name: "Nightly links", when: "Every day 2:00", what: "Check the links", on: true, next: [], nextWords: "in 9h", last: "today 2:00 · nothing to do" },
    { id: "|/repo|weekly", place: "sp1", name: "Weekly report", when: "Mondays 9:00", what: "Write the report", on: false, next: [] }] },
  artifacts: [{ id: "a1", title: "Fast switch · Proof", place: "sp1", v: 2, at: now - 600_000, when: "10m", by: "SHOP-41 agent", proof: true, task: "SHOP-41" },
    { id: "a2", title: "Weekly board", place: "sp1", v: 1, at: now - 7200_000, when: "2h", by: "x", pinned: true }],
  alerts: [{ id: "al", at: now - 30_000, title: "SHOP-45 · Memory at 91%", body: "The machine is low on memory", notify: true }],
  warnings: [{ id: "u:Claude:Weekly", kind: "usage", text: "You've used 81% of this week's Claude plan" }],
  config: {
    all: { agents: { Chats: pick, Tasks: pick, Reviews: { agent: "codex", model: "gpt", effort: null, fast: false, perm: null } }, review: false, merge: "done", proof: true },
    spaces: { sp1: { agents: { Chats: pick, Tasks: pick, Reviews: pick }, review: true, merge: "done", proof: true, own: ["review"] } },
    secrets: [{ name: "ELEVENLABS_API_KEY", scope: "all" }, { name: "GH_TOKEN", scope: "sp1" }],
    plugins: [{ id: "tasks", name: "Tasks", on: true, always: true }, { id: "screens", name: "Screens", on: true }, { id: "voice", name: "Voice", on: true }, { id: "schedules", name: "Schedules", on: false }],
    plans: [{ name: "Claude Max", windows: [{ name: "Weekly", used: 81, resets: "Resets Friday" }] }],
  },
  settings: [], asks: {},
};

const chats: Record<string, any> = {
  "SHOP-45/worker": { status: "working", doing: "Running the tests", items: [
    { who: "you", text: "Please add the voice tools", at: now - 600_000 },
    { who: "agent", text: "On it: first the spec, then the service.", at: now - 500_000 },
    { who: "agent", text: "The read bug: the service only read chats a page had open.", at: now - 100_000 },
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
    ...over,
  };
  return x;
}
const web: Where = { client: "web", device: "phone", place: "sp1", task: "SHOP-45", tab: "tasks" };
const top: Where = { client: "web", device: "desktop", place: "sp1" };
const look = async (p: any, w: Where = web, x = io()) => (await voiceTool("look", p, w, x)).result;

test("the words: nothing a tool says names what 3.2 dropped, or a task's id", async () => {
  const said: string[] = [];
  for (const what of ["here", "spaces", "machines", "tasks", "needs", "news", "schedules", "settings", "secrets", "artifacts"]) said.push(await look({ what }));
  for (const t of snap.tasks) said.push(await look({ what: "task", id: t.name }));
  said.push(await look({ what: "tasks", query: "done" }), await look({ what: "chat" }));
  for (const action of ACTS as string[]) said.push((await voiceTool("act", { action, id: "Voice reads", value: "x", key: "merge", confirmed: false }, web, io())).result);
  for (const what of ["space", "chat", "task", "screen", "terminal", "tasks", "needs", "artifacts", "artifact", "settings"]) said.push((await voiceTool("open", { what, id: what === "artifact" ? "weekly board" : what === "settings" ? "" : "shop" }, web, io())).result);
  const all = said.join("\n");
  expect(all).not.toMatch(/\b(Assistant|coordinator|worker|Accept(ed|ing)?|Autopilot|automations?|add-ons?|window|tabs?|layout)\b/i);
  expect(all).not.toMatch(/\b(SHOP|GARD)[- ]\d+/);
  expect(all).not.toContain("This computer");
});

test("look here: the app, a call with Shepherdr, what is on screen, and how much needs the person", async () => {
  const a = await look({ what: "here" });
  expect(a).toContain("the Shepherdr app on a phone");
  expect(a).toContain("It is with Shepherdr, not one agent");
  expect(a).toContain('the task "Voice reads the new app" (Working), in the space #shop on box');
  // the Tasks button's own count (needsCount): three tasks under Needs you, one chat asking
  expect(a).toContain("Overall: 5 need the person (1 ready for review), 1 working.");
  expect(await look({ what: "here" }, { client: "web", device: "desktop", place: "home", tab: "artifacts" })).toContain("The app shows Everything, Artifacts.");
});

test("look chat: the one on screen by default, its status and last messages, oldest first", async () => {
  const a = await look({ what: "chat", count: 2 });
  expect(a).toMatch(/^The agent in the task "Voice reads the new app" is working: Running the tests\./);
  expect(a).toContain("Agent (8 minutes ago): On it");
  expect(a).not.toContain("Please add");
  expect(a.indexOf("On it")).toBeLessThan(a.indexOf("read bug"));
  // a space's chat with no agent running says so, by the space's name
  const none = await voiceTool("look", { what: "chat", id: "garden" }, web, io());
  expect(none.error).toBe(true);
  expect(none.result).toContain("#garden's chat");
});

test("look chat gives the newest agent reply whole, older messages cut short (#785); a query searches further back", async () => {
  const long = "word ".repeat(1200).trim() + " THE END.";
  const x = io({ chat: async () => ({ status: "idle", items: [
    { who: "agent", text: "older " + "x".repeat(900), at: now - 200_000 },
    { who: "you", text: "Tell me everything", at: now - 100_000 },
    { who: "agent", text: long, at: now - 50_000 },
  ] }) as any });
  const a = await look({ what: "chat", count: 3 }, web, x);
  expect(a).toContain("THE END.");
  expect(a).not.toContain("x".repeat(600));
  let pulled = 0;
  const y = io({ chat: async () => ({ ...chats["SHOP-45/worker"], items: [...chats["SHOP-45/worker"].items], earlier: async () => (++pulled < 2) }) });
  expect(await look({ what: "chat", query: "bug" }, web, y)).toContain('1 message in the task "Voice reads the new app"\'s chat about "bug"');
  expect(pulled).toBeGreaterThan(0);
  expect(await look({ what: "chat", query: "unicorn" })).toContain('Nothing about "unicorn"');
});

test("look tasks: as Tasks › Now groups them, each row in the screen's own words", async () => {
  const all = await look({ what: "tasks" });
  expect(all).toMatch(/^6 tasks: 4 need you, 1 working, 1 up next\./);
  // Needs you first, then Working, then Up next; Done only when asked
  expect(all.indexOf("Outbound list")).toBeLessThan(all.indexOf("Voice reads"));
  expect(all.indexOf("Voice reads")).toBeLessThan(all.indexOf("Later work"));
  expect(all).toContain('"Voice reads the new app" in #shop: Working, 10 min left. Writing tests');
  expect(all).toContain('"Fast switch in the picker" in #shop: Ready for review, for 2h. The Fast switch is back');
  expect(all).toContain('"Nightly links" in #shop: Stopped, for 2m. It hit its plan\'s limit.');
  expect(all).toContain('"Sign in to the store" in #shop: Needs you, for 1m. Needs your hands: Sign in to the store');
  expect(all).toContain('"Later work" in #shop: Up next. Starts after Voice reads the new app');
  expect(all).not.toContain("Old thing");
  // every status word is the screen's (statusWord)
  for (const t of snap.tasks) expect(taskSaid(snap, t)).toContain(statusWord(t).word.replace(/\s*·\s*/g, ", "));
  const ready = await look({ what: "tasks", query: "ready for review" });
  expect(ready).toContain("Fast switch");
  expect(ready).not.toContain("Voice reads");
  expect(await look({ what: "tasks", query: "stopped" })).toMatch(/^1 task: 1 needs you\.\n"Nightly links"/);
  const doneOnes = await look({ what: "tasks", query: "done" });
  expect(doneOnes).toContain('"Old thing" in #shop: Done and merged');
  expect(doneOnes).toContain('"Check the links" in #shop: Done, nothing to do');
  expect(await look({ what: "tasks", id: "Mac mini" })).toMatch(/^1 task on Mac mini/);
  expect(await look({ what: "tasks", id: "here" })).toMatch(/^5 tasks in #shop/);
  expect(await look({ what: "tasks", query: "picker" })).toContain("Fast switch");
});

test("look task: by words of its title or 'this'; a Ready one with what Mark as done does, its checks and proof", async () => {
  const x = io({ action: async (b) => (b.type === "evidence" ? { evidence: { commit: "abc", diff: { files: 3, added: 9, removed: 1, list: [] }, checks: { state: "passed", text: "" }, proof: { id: "a1", title: "Fast switch · Proof" } } } : { ok: true }) });
  const a = await look({ what: "task", id: "the fast switch task" }, web, x);
  expect(a).toContain('"Fast switch in the picker" in #shop on box: Ready for review.');
  expect(a).toContain("It is on its own branch: Mark as done and merge.");
  expect(a).toContain('3 files changed. Checks passed. It has a proof, "Fast switch · Proof".');
  expect(await look({ what: "task", id: "this" })).toContain("Voice reads the new app");
  expect(await look({ what: "task", id: "this" })).toContain("Its agent is using its Screen now.");
  expect(findTask(snap, "outbound", web)?.id).toBe("mini:GARD-3");
  expect(findTask(snap, "Voice reads the new app", top)?.id).toBe("SHOP-45");
  // an id still finds it, should the voice agent have one from the data
  expect(findTask(snap, "GARD-3", web)?.id).toBe("mini:GARD-3");
  const need = await look({ what: "task", id: "outbound list" });
  expect(need).toContain("It asks: Which list? (choices: Sweden, Norway).");
  expect(await look({ what: "task", id: "sign in" })).toContain("It needs your hands on its Screen: Sign in to the store.");
  expect(await look({ what: "task", id: "check the links" })).toContain("Done, nothing to do");
  expect(await look({ what: "task", id: "nightly links" })).toContain("Stopped, It hit its plan's limit.");
});

test("look needs: every question, command, step for the person's hands, review and stop, each once", async () => {
  const needs = await look({ what: "needs" });
  expect(needs).toMatch(/^5 need the person:/);
  expect(needs).toContain('"Outbound list" in #garden asks: Which list? (choices: Sweden, Norway)');
  expect(needs).toContain('"Fast switch in the picker" in #shop: Ready for review');
  expect(needs).toContain('"Nightly links" in #shop: Stopped');
  expect(needs).toContain("Needs your hands: Sign in to the store");
  expect(needs).toContain("#garden wants to run a command: npm test");
  expect(needs.match(/Sign in to the store"/g)).toHaveLength(1);
});

test("look spaces, machines, news, schedules", async () => {
  const spaces = await look({ what: "spaces" });
  expect(spaces).toContain("Everything, the root chat: 5 need you in all.");
  expect(spaces).toContain("On box: #shop: 3 need you, 1 working.");
  expect(spaces).toContain("On Mac mini (can't reach it): #garden: 2 need you.");
  expect(spaces).toContain("Archived: #attic.");
  const machines = await look({ what: "machines" });
  expect(machines).toContain("box (serves Shepherdr): online, 1 space, 1 task working.");
  expect(machines).toContain("Mac mini: can't reach it, last seen 14:02, 1 space, 0 tasks working.");
  expect(machines).toContain("Warnings: You've used 81% of this week's Claude plan.");
  const news = await look({ what: "news", count: 3 });
  expect(news).toMatch(/^Warnings: You've used 81%/);
  expect(news.split("\n")[2]).toContain("Later work");
  expect(news).toContain("Alert, Memory at 91%");
  const sch = await look({ what: "schedules" });
  expect(sch).toContain('"Nightly links" in #shop: Every day 2:00, next in 9h; last run today 2:00, nothing to do.');
  expect(sch).toContain('"Weekly report" in #shop: Paused.');
  expect(await look({ what: "schedules", id: "garden" })).toBe("No schedules in #garden.");
  // 3.2: what is gone can't be looked at or switched
  for (const what of ["autopilot", "automations"]) expect((await voiceTool("look", { what }, web, io())).error).toBe(true);
  for (const action of ["autopilot_on", "accept", "pin", "schedule", "unschedule", "reopen", "forget_secret"]) expect((await voiceTool("act", { action, id: "shop", confirmed: true }, web, io())).error).toBe(true);
  expect((await voiceTool("call_view", { view: "full" }, web, io())).error).toBe(true);
});

test("look settings (snapshot.config), secrets (names only), artifacts", async () => {
  const st = await look({ what: "settings" });
  expect(st).toMatch(/^Settings, for every space:/);
  expect(st).toContain("Agents › Chats run on claude, opus, high");
  expect(st).toContain("Agents › Reviews run on codex, gpt");
  expect(st).toContain("Tasks › Review by a second agent: off");
  expect(st).toContain("Tasks › Merge: When I mark it as done");
  expect(st).toContain("Tasks › Proof: on");
  expect(st).not.toContain("Instructions");  // gone (SHEP-319): AGENTS.md / CLAUDE.md instruct agents
  expect(st).toContain("Plugins: Tasks always on, Screens on, Voice on, Schedules off");
  expect(st).toContain("Usage: Claude Max: Weekly 81% used, resets Friday");
  const own = await look({ what: "settings", id: "here", query: "review" });
  expect(own).toContain("#shop's settings");
  expect(own).toContain("Review by a second agent: on (its own)");
  expect(await look({ what: "settings", id: "shop", query: "merge" })).toContain("Merge: When I mark it as done (as everywhere)");
  const sec = await look({ what: "secrets" });
  expect(sec).toContain("ELEVENLABS_API_KEY, every space");
  expect(sec).toContain("GH_TOKEN, only #shop");
  expect(sec).toContain("values are never read out");
  // the Artifacts list keeps a task's proof on its task; a search finds it
  const arts = await look({ what: "artifacts" });
  expect(arts).toContain('"Weekly board" in #shop, 2 hours ago, pinned');
  expect(arts).not.toContain("Proof");
  expect(await look({ what: "artifacts", query: "proof" })).toContain('"Fast switch · Proof" in #shop, 10 minutes ago, a task\'s proof');
});

test("open: what it shows, as the page's voiceNav takes it", async () => {
  const nav = async (p: any, w: Where = web) => { const a = await voiceTool("open", p, w, io()); return a.then ? [a.nav, a.then] : a.nav; };
  expect(await nav({ what: "space", id: "the garden space" })).toEqual({ kind: "space", place: "mini/sp2" });
  expect(await nav({ what: "space", id: "Everything" })).toEqual({ kind: "space", place: "home" });
  expect(await nav({ what: "space", id: "#shop" })).toEqual({ kind: "space", place: "sp1" });
  // a task by its title; never "it's open" before the app says so
  const t = await voiceTool("open", { what: "task", id: "fast switch" }, web, io());
  expect(t.nav).toEqual({ kind: "task", task: "SHOP-41" });
  expect(t.result).toContain("hasn't confirmed");
  expect(t.shows).toBe('the task "Fast switch in the picker"');
  // a chat: a space's (and back from its agent's terminal), a task's is the task
  expect(await nav({ what: "chat", id: "shop" })).toEqual([{ kind: "chat", chat: "p:sp1" }, { kind: "panel", panel: "chat" }]);
  expect(await nav({ what: "chat", id: "outbound list" })).toEqual({ kind: "task", task: "mini:GARD-3" });
  expect(await nav({ what: "chat" })).toEqual({ kind: "task", task: "SHOP-45" });
  expect(await nav({ what: "chat" }, top)).toEqual({ kind: "panel", panel: "chat" });
  // "show me its screen": a task's beside its task, a chat's beside its chat, the one on screen as it is
  expect(await nav({ what: "screen", id: "voice reads" })).toEqual({ kind: "task", task: "SHOP-45", tab: "screen" });
  expect(await nav({ what: "task", id: "voice reads", view: "screen" })).toEqual({ kind: "task", task: "SHOP-45", tab: "screen" });
  expect(await nav({ what: "screen", id: "voice reads", view: "desktop" })).toEqual([{ kind: "task", task: "SHOP-45", tab: "screen" }, { kind: "panel", panel: "desktop" }]);
  expect(await nav({ what: "screen", id: "garden" })).toEqual([{ kind: "space", place: "mini/sp2" }, { kind: "panel", panel: "screen" }]);
  expect(await nav({ what: "screen" })).toEqual({ kind: "panel", panel: "screen" });
  expect(await nav({ what: "screen", view: "desktop" }, top)).toEqual({ kind: "panel", panel: "desktop" });
  // View as terminal: a chat's agent's; a task's is in its menu
  expect(await nav({ what: "terminal" }, top)).toEqual({ kind: "panel", panel: "terminal" });
  expect(await nav({ what: "terminal", id: "garden" })).toEqual([{ kind: "space", place: "mini/sp2" }, { kind: "panel", panel: "terminal" }]);
  expect((await voiceTool("open", { what: "terminal" }, web, io())).result).toContain('press its menu\'s "View as terminal"');
  // Tasks (Now), Needs you, Artifacts; a space's: there first
  expect(await nav({ what: "tasks" })).toEqual({ kind: "tasks" });
  expect(await nav({ what: "needs" })).toEqual({ kind: "needs" });
  expect(await nav({ what: "tasks", id: "garden" })).toEqual([{ kind: "space", place: "mini/sp2" }, { kind: "panel", panel: "tasks" }]);
  expect(await nav({ what: "artifacts" })).toEqual({ kind: "panel", panel: "artifacts" });
  expect(await nav({ what: "artifact", id: "the weekly board" })).toEqual({ kind: "artifact", artifact: "a2" });
  // Settings' pages, as the app names them
  expect(await nav({ what: "settings" })).toEqual({ kind: "settings" });
  expect(await nav({ what: "settings", id: "usage" })).toEqual({ kind: "settings", section: "Usage" });
  expect(await nav({ what: "settings", id: "the voice plugin" })).toEqual({ kind: "settings", section: "Plugins" });
  const bad = await voiceTool("open", { what: "settings", id: "banana" }, web, io());
  expect(bad.error).toBe(true);
  expect(bad.result).toContain("General, Agents, Tasks, Secrets, Machines, Usage, Plugins");
  // what 3.2 has no place for
  for (const what of ["files", "changes", "call"]) expect((await voiceTool("open", { what }, web, io())).error).toBe(true);
});

test("send: here, Everything, a space, a task by title; one with no agent says so", async () => {
  const x = io();
  const here = await voiceTool("send", { text: "Run the tests" }, web, x);
  expect(here.result).toStartWith('Sent to the task "Voice reads the new app".');
  expect(here.result).toContain('Say "Passed it to "Voice reads the new app"." and nothing else');
  // the call follows that chat from now on (voice-hear.ts)
  expect(here.sent).toBe("SHOP-45/worker");
  const g = await voiceTool("send", { to: "garden", text: "Add a task: call Bob" }, web, x);
  expect(g.sent).toBe("p:mini:sp2");
  expect(g.result).toContain('Sent to #garden. Say "Passed it to garden."');
  expect((await voiceTool("send", { to: "Everything", text: "What is running?" }, web, x)).result).toContain('Say "Passed it to Everything."');
  expect(x.sent.map((s) => s.key)).toEqual(["SHOP-45/worker", "p:mini:sp2", "p:home"]);
  const none = await voiceTool("send", { to: "Later work", text: "hi" }, web, x);
  expect(none.error).toBe(true);
  expect(none.result).toBe('"Later work" has no agent running: it is Up next. Start it first.');
  // no chat on screen: it asks which
  const lost = await voiceTool("send", { text: "hi" }, { client: "web", device: "phone" }, x);
  expect(lost.error).toBe(true);
  expect(lost.result).toContain("which space or task");
  expect((await voiceTool("send", { text: "Check the build" }, top, x)).sent).toBe("p:sp1");
});

test("act: Mark as done asks first and merges only what is on its own branch", async () => {
  const x = io();
  const ask = await voiceTool("act", { action: "done", id: "fast switch", confirmed: false }, web, x);
  expect(ask.result).toBe('Nothing changed yet. Ask the person: "Mark "Fast switch in the picker" as done and merge it?" Only after a clear yes, call act again with confirmed true.');
  expect(x.calls).toEqual([]);
  expect((await voiceTool("act", { action: "done", id: "fast switch", confirmed: true }, web, x)).result).toBe('"Fast switch in the picker" is marked as done: it merges now.');
  expect(x.calls.pop()).toEqual({ type: "accept", task: "SHOP-41" });
  // changed in the folder itself: nothing to merge, and it says so
  const t41 = snap.tasks.find((t: any) => t.id === "SHOP-41");
  t41.repo = "folder";
  try { expect((await voiceTool("act", { action: "done", id: "fast switch", confirmed: false }, web, x)).result).toContain('"Mark "Fast switch in the picker" as done?"'); }
  finally { t41.repo = "branch"; }
  // one not handed in: the menu's Mark as done, nothing merged
  expect((await voiceTool("act", { action: "done", id: "this", confirmed: false }, web, x)).result).toContain("It is Working, and its branch is not merged.");
  await voiceTool("act", { action: "done", id: "this", confirmed: true }, web, x);
  expect(x.calls.pop()).toEqual({ type: "close", chat: "SHOP-45/worker", force: true });
  await voiceTool("act", { action: "done_without_merging", id: "fast switch", confirmed: true }, web, x);
  expect(x.calls.pop()).toEqual({ type: "close", chat: "SHOP-41/worker", force: true });
  expect((await voiceTool("act", { action: "done", id: "old thing", confirmed: true }, web, x)).error).toBe(true);
});

test("act: what deletes or stops asks first; the rest runs at once, each as the app's own action", async () => {
  const x = io();
  const run = async (p: any, w: Where = web) => { const r = await voiceTool("act", { confirmed: false, ...p }, w, x); return [r.error ? `! ${r.result}` : r.result, x.calls.pop() ?? null]; };
  // asked first: nothing sent
  for (const p of [{ action: "stop", id: "this" }, { action: "delete", id: "this" }, { action: "remove_space", id: "shop" }, { action: "archive_space", id: "shop" }, { action: "delete_artifact", id: "weekly board" }]) {
    expect(ASK_FIRST).toContain(p.action);
    const [said, sent] = await run(p);
    expect(said).toStartWith("Nothing changed yet. Ask the person:");
    expect(sent).toBeNull();
  }
  expect((await run({ action: "stop", id: "this", confirmed: true }))[1]).toEqual({ type: "stop", chat: "SHOP-45/worker" });
  expect((await run({ action: "delete", id: "old thing", confirmed: true }))[1]).toEqual({ type: "delete", chat: "SHOP-30/worker", force: true });
  expect((await run({ action: "remove_space", id: "shop", confirmed: true }))[1]).toEqual({ type: "space-remove", place: "sp1", stop: true });
  expect((await run({ action: "remove_space", id: "shop" }))[0]).toContain("Its 1 working task stops, and its schedules stop. Its folder and code stay on disk.");
  expect((await run({ action: "archive_space", id: "shop", confirmed: true }))[1]).toEqual({ type: "space-archive", place: "sp1", on: true });
  expect((await run({ action: "delete_artifact", id: "weekly board", confirmed: true }))[1]).toEqual({ type: "artifact-delete", place: "sp1", artifact: "a2" });
  // at once
  expect(await run({ action: "start", id: "later work" })).toEqual(['"Later work" starts now.', { type: "task-start", chat: "SHOP-50/worker" }]);
  expect(await run({ action: "restart", id: "nightly links" })).toEqual(['"Nightly links" is starting again.', { type: "task-resume", chat: "SHOP-51/worker" }]);
  expect((await run({ action: "rename_task", id: "later work", value: "Sooner work" }))[1]).toEqual({ type: "task-rename", chat: "SHOP-50/worker", name: "Sooner work" });
  expect(await run({ action: "move_task", id: "later work", value: "garden" })).toEqual(['Moved "Later work" to #garden.', { type: "task-move", chat: "SHOP-50/worker", place: "mini/sp2" }]);
  expect((await run({ action: "move_task", id: "this", value: "garden" }))[0]).toContain("only before it has started");
  expect((await run({ action: "archive", id: "old thing" }))[1]).toEqual({ type: "archive", chat: "SHOP-30/worker", on: true });
  // archiving a working one stops its agent: asked like a stop
  expect((await run({ action: "archive", id: "this" }))[0]).toContain('Ask the person: "Archive "Voice reads the new app"? It is working: its agent stops."');
  expect((await run({ action: "unarchive_space", id: "attic" }))[1]).toEqual({ type: "space-archive", place: "sp3", on: false });
  expect((await run({ action: "rename_space", id: "here", value: "store" }))[1]).toEqual({ type: "rename", id: "sp1", name: "store" });
  expect((await run({ action: "remove_space", id: "Everything", confirmed: true }))[0]).toStartWith("! Everything is the root chat");
  expect((await run({ action: "pin_artifact", id: "weekly board" }))[1]).toEqual({ type: "artifact-pin", place: "sp1", artifact: "a2", on: true });
  // schedules: by name, with the id and space the app sends
  expect(await run({ action: "run_schedule", id: "nightly links" })).toEqual(['"Nightly links" runs now, as a task.', { type: "automation", op: "run", id: "|/repo|nightly", place: "sp1", name: "Nightly links" }]);
  expect((await run({ action: "resume_schedule", id: "the weekly report schedule" }))[1]).toMatchObject({ type: "automation", op: "resume", id: "|/repo|weekly" });
  expect((await run({ action: "pause_schedule", id: "weekly report" }))[0]).toBe('! "Weekly report" is paused already.');
  // a refusal comes back in its words
  const no = await voiceTool("act", { action: "delete", id: "this", confirmed: true }, web, io({ action: async () => ({ ok: false, error: "It holds work." }) }));
  expect(no).toEqual({ result: "It holds work.", error: true });
});

test("act answer: a question's choice, a command allowed once or declined, as the card's buttons", async () => {
  const x = io();
  const r = await voiceTool("act", { action: "answer", id: "outbound list", value: "Norway", confirmed: false }, web, x);
  expect(r.result).toBe('Answered the task "Outbound list": Norway.');
  expect(x.calls.pop()).toEqual({ type: "answer", chat: "mini:GARD-3/worker", question: "q1", choice: 1, byVoice: true, voiceAnswer: "Norway" });
  await voiceTool("act", { action: "answer", id: "outbound list", value: "the first one", confirmed: false }, web, x);
  expect(x.calls.pop()).toMatchObject({ question: "q1", choice: 0 });
  expect((await voiceTool("act", { action: "answer", id: "garden", value: "allow", confirmed: false }, web, x)).result).toBe("Allowed it once for #garden.");
  expect(x.calls.pop()).toEqual({ type: "answer", chat: "p:mini:sp2", question: "q2", choice: 0 });
  await voiceTool("act", { action: "answer", id: "garden", value: "no", confirmed: false }, web, x);
  expect(x.calls.pop()).toMatchObject({ question: "q2", choice: 1 });
  // words that pick nothing are a reply: sent in its chat instead
  const other = await voiceTool("act", { action: "answer", id: "outbound list", value: "Denmark", confirmed: false }, web, x);
  expect(other.error).toBe(true);
  expect(other.result).toContain("Sweden, Norway");
  expect((await voiceTool("act", { action: "answer", id: "this", value: "yes", confirmed: false }, web, x)).result).toContain("has no question open");
  expect(x.calls).toEqual([]);
});

test("act setting: Merge, Review, Proof and the plugins, through the settings window's own action", async () => {
  const x = io();
  const set = async (p: any) => { const r = await voiceTool("act", { action: "setting", confirmed: false, ...p }, web, x); return [r.result, x.calls.pop() ?? null]; };
  expect(await set({ key: "merge", value: "when checks pass" })).toEqual(['Merge is "When all checks pass" for every space.', { type: "config", place: "all", key: "merge", value: "checks" }]);
  expect((await set({ key: "merge", value: "right away", id: "shop" }))[1]).toEqual({ type: "config", place: "sp1", key: "merge", value: "now" });
  expect((await set({ key: "merge", value: "reset", id: "shop" }))[1]).toEqual({ type: "config", place: "sp1", key: "merge", value: null });
  expect((await set({ key: "merge", value: "maybe" }))[0]).toBe("Merge can be: When I mark it as done, When all checks pass, Right away.");
  expect((await set({ key: "review", value: "on" }))[1]).toEqual({ type: "config", place: "all", key: "review", value: true });
  expect((await set({ key: "proof", value: "off", id: "here" }))[1]).toEqual({ type: "config", place: "sp1", key: "proof", value: false });
  expect(await set({ key: "Schedules", value: "on" })).toEqual(["Schedules is on.", { type: "config", place: "all", key: "plugin.schedules", value: true }]);
  expect((await set({ key: "Tasks", value: "off" }))[0]).toBe("Tasks is always on.");
  // switching Voice off ends this way of talking: asked first
  expect((await set({ key: "voice", value: "off" }))[0]).toContain('Ask the person: "Switch Voice off?');
  expect((await set({ key: "voice", value: "off", confirmed: true }))[1]).toEqual({ type: "config", place: "all", key: "plugin.voice", value: false });
  expect((await set({ key: "theme", value: "dark" }))[0]).toContain("By voice I can set Merge, Review by a second agent, Proof and the plugins (Screens, Voice, Schedules)");
});

test("an agent's Screen: take over, hand back and skip go through the app's screen action", async () => {
  const x = io();
  const r = await voiceTool("act", { action: "take_over", id: "this", confirmed: false }, web, x);
  expect(r.result).toStartWith('You have the Screen of "Voice reads the new app" now');
  expect(x.calls.pop()).toEqual({ type: "screen", key: "task:SHOP-45", op: "take", src: "b" });
  await voiceTool("act", { action: "take_over", id: "shop", value: "desktop", confirmed: false }, web, x);
  expect(x.calls.pop()).toEqual({ type: "screen", key: "chat:sp1", op: "take", src: "d" });
  await voiceTool("act", { action: "take_over", id: "here", confirmed: false }, top, x);
  expect(x.calls.pop()).toEqual({ type: "screen", key: "chat:sp1", op: "take", src: "b" });
  // a step that needed the person's hands: handing back says it is done; skip leaves it
  await voiceTool("act", { action: "hand_back", id: "sign in to the store", confirmed: false }, web, x);
  expect(x.calls.pop()).toEqual({ type: "screen", key: "task:SHOP-53", op: "handback", src: "b", done: true });
  await voiceTool("act", { action: "skip_step", id: "sign in to the store", confirmed: false }, web, x);
  expect(x.calls.pop()).toEqual({ type: "screen", key: "task:SHOP-53", op: "skip", src: "b" });
  expect((await voiceTool("act", { action: "skip_step", id: "this", confirmed: false }, web, x)).error).toBe(true);
  // not taken over: nothing to hand back
  expect((await voiceTool("act", { action: "hand_back", id: "this", confirmed: false }, web, x)).result).toContain("haven't taken over");
  expect(x.calls).toEqual([]);
});

test("finding spaces: by name, with or without #, Everything, here; another machine's home folder is no space", () => {
  expect(findSpace(snap, "Shop", web)?.id).toBe("sp1");
  expect(findSpace(snap, "#shop", web)?.id).toBe("sp1");
  expect(findSpace(snap, "garden on the mac mini", web)?.id).toBe("mini/sp2");
  expect(findSpace(snap, "everything", web)?.id).toBe("home");
  expect(findSpace(snap, "the Everything chat", web)?.id).toBe("home");
  expect(findSpace(snap, "here", { client: "web", call: "p:mini:sp2" })?.id).toBe("mini/sp2");
  expect(spacesSaid(snap, "home on the mac mini", web).map((p) => p.id)).not.toContain("mini/h");
  // an archived one is found when nothing else has its name
  expect(findSpace(snap, "attic", web)?.id).toBe("sp3");
});

// Two machines with a space of the same name, and one whose name has a machine's word in it.
const fleet: any = {
  ...snap,
  host: "fake-mini", everything: "h1",
  machines: [
    { id: "m:fake-mini", machine: "fake-mini", name: "mac-mini", ownName: "fake-mini", status: "idle", here: true },
    { id: "m:mbp", machine: "fake-macbook-pro", name: "MacBook Pro", ownName: "fake-macbook-pro", status: "idle" },
    { id: "m:vm", machine: "vm-dev", name: "Dev VM", ownName: "vm-dev", status: "idle" },
  ],
  places: [
    { id: "h1", name: "home", home: true, machine: "fake-mini", chat: "p:h1", level: 0, status: "idle" },
    { id: "s1", name: "shop", machine: "fake-mini", chat: "p:s1", level: 2, status: "idle" },
    { id: "fake-macbook-pro/s2", name: "shop", machine: "fake-macbook-pro", chat: "p:fake-macbook-pro:s2", level: 2, status: "idle" },
    { id: "vm-dev/s3", name: "shop", machine: "vm-dev", chat: "p:vm-dev:s3", level: 2, status: "idle" },
    { id: "vm-dev/s4", name: "mini-app", machine: "vm-dev", chat: "p:vm-dev:s4", level: 2, status: "idle" },
  ],
  tasks: [],
  artifacts: [
    { id: "old", title: "Voice call · Proof", place: "s1", v: 1, at: now - 86400_000, when: "1d", by: "x" },
    { id: "new", title: "Voice calls read and navigate · Proof", place: "s1", v: 3, at: now - 3600_000, when: "1h", by: "x" },
    { id: "hulk", title: "Hulk mini game · Proof", place: "s1", v: 1, at: now - 7200_000, when: "2h", by: "x" },
  ],
};
const fromMbp: Where = { client: "web", device: "desktop", machine: "fake-mini", place: "s1" };

test("a space by its machine: the serving one by its names (and \"this computer\"), others by theirs", () => {
  const id = (q: string) => spacesSaid(fleet, q, fromMbp).map((p) => p.id);
  expect(id("Mac Mini shop")).toEqual(["s1"]);
  expect(id("shop on the Mac mini")).toEqual(["s1"]);
  expect(id("the mac mini's shop space")).toEqual(["s1"]);
  expect(id("shop on this computer")).toEqual(["s1"]);
  expect(id("MacBook Pro shop")).toEqual(["fake-macbook-pro/s2"]);
  expect(id("shop on the macbook")).toEqual(["fake-macbook-pro/s2"]);
  expect(id("dev vm shop")).toEqual(["vm-dev/s3"]);
  // a space whose name has a machine's word in it
  expect(id("mini app")).toEqual(["vm-dev/s4"]);
  // truly ambiguous: every machine has a shop
  expect(id("shop")).toHaveLength(3);
  expect(findSpace(fleet, "shop", fromMbp)).toBeNull();
});

test("open space: the one meant, or which one when several fit", async () => {
  const x = { ...io(), snap: () => fleet };
  const a = await voiceTool("open", { what: "space", id: "Mac Mini shop" }, fromMbp, x);
  expect(a.nav).toEqual({ kind: "space", place: "s1" });
  expect(a.shows).toBe("the space #shop on mac-mini");
  const which = await voiceTool("open", { what: "space", id: "shop" }, fromMbp, x);
  expect(which.error).toBe(true);
  expect(which.nav).toBeUndefined();
  expect(which.result).toContain("Which one: #shop on mac-mini; #shop on MacBook Pro; #shop on Dev VM?");
  const none = await voiceTool("open", { what: "space", id: "banana" }, fromMbp, x);
  expect(none.result).toContain('I can\'t find a space called "banana". Spaces: Everything; #shop on mac-mini;');
});

test("an artifact by words of its title, newest first", () => {
  expect(findArtifact(fleet, "the voice call one", fromMbp)?.id).toBe("new");
  expect(findArtifact(fleet, "voice call proof", fromMbp)?.id).toBe("new");
  expect(findArtifact(fleet, "the Hulk mini game", fromMbp)?.id).toBe("hulk");
  expect(findArtifact(fleet, "hulk", fromMbp)?.id).toBe("hulk");
  expect(findArtifact(fleet, "quarterly sales deck", fromMbp)).toBeNull();
  // by the title of the task that made it
  expect(findArtifact(snap, "the picker's proof", web)?.id).toBe("a1");
});

test("open is on screen only once the app that started the call says so; two steps stop at the first that fails", async () => {
  const a = await voiceTool("open", { what: "artifact", id: "hulk mini game" }, fromMbp, { ...io(), snap: () => fleet });
  // shown: as few words as can be, so the voice just says "Opened." (SHEP-83)
  expect((await shown(a, async () => ({ ok: true }))).result).toBe('{"ok":true,"shown":"the artifact \\"Hulk mini game · Proof\\""}');
  const no = await shown(a, async () => ({ ok: false, why: "this app doesn't list that artifact" }));
  expect(no.error).toBe(true);
  expect(no.result).toContain("couldn't open");
  expect(no.result).toContain("doesn't list that artifact");
  // a page that never answers: not on screen
  const silent = await shown(a, async () => null);
  expect(silent.error).toBe(true);
  expect(silent.result).not.toContain('"ok":true');
  // look and send aren't asked about
  const here = await voiceTool("look", { what: "here" }, fromMbp, { ...io(), snap: () => fleet });
  expect(await shown(here, async () => { throw new Error("asked"); })).toEqual(here);
  // a space, then its Artifacts
  const there = await voiceTool("open", { what: "artifacts", id: "garden" }, web, io());
  const asked: any[] = [];
  const r = await shown(there, async (nav) => { asked.push(nav); return { ok: true }; });
  expect(asked).toEqual([{ kind: "space", place: "mini/sp2" }, { kind: "panel", panel: "artifacts" }]);
  expect(r.result).toContain('"ok":true');
  expect("then" in r).toBe(false);
  const one: any[] = [];
  await shown(there, async (nav) => { one.push(nav); return { ok: false, why: "no" }; });
  expect(one.length).toBe(1);
});

test("screen: checked here, done by the page that started the call, its answer the page itself", async () => {
  expect((await voiceTool("screen", { do: "click" }, web, io())).error).toBe(true);
  const a = await voiceTool("screen", { do: "click", ref: "e4" }, web, io());
  expect(a.nav).toMatchObject({ kind: "screen", do: "click", ref: "e4", confirmed: false });
  const r = await shown(a, async () => ({ ok: true, did: 'Pressed the button "Scheduled"', screen: "Screen: Shepherdr on a phone." }));
  expect(r.result).toBe('Pressed the button "Scheduled". The screen now, for your next step only (don\'t read it out):\nScreen: Shepherdr on a phone.');
  const held = await shown(a, async () => ({ ok: false, ask: "Press Delete?", screen: "" }));
  expect(held.result).toContain("Ask the person first");
  expect((await shown(a, async () => null)).error).toBe(true);
  // nothing changes in Shepherdr itself: no action was sent
  const x = io();
  await voiceTool("screen", { do: "look" }, web, x);
  expect(x.calls).toEqual([]);
});

test("results stay short, and a review card's evidence reads plainly in either shape", async () => {
  const big = { ...chats["SHOP-45/worker"], items: Array.from({ length: 30 }, (_, i) => ({ who: "agent", text: "x".repeat(2000) + i })) };
  const a = await look({ what: "chat", count: 30 }, web, io({ chat: async () => big }));
  // all but the newest reply (said whole, #785) stays within 3500, the newest ones kept
  expect(a.length).toBeLessThanOrEqual(3500 + 2010);
  expect(a.endsWith("x29")).toBe(true);
  expect(evidenceWords({ checks: [{ name: "build", conclusion: "failure" }, { name: "lint", conclusion: "success" }] })).toBe("Checks: 1 failed (build).");
  expect(evidenceWords({ evidence: { diff: { files: 1 }, checks: { state: "failed", text: "build failed" } } })).toBe("1 file changed. Checks failed: build failed.");
  expect(evidenceWords({ evidence: { checks: { state: "none", text: "" } } })).toBe("");
  expect(evidenceWords(null)).toBe("");
});

test("a snapshot from before the app's own facts (no config, no Everything named) still answers", async () => {
  const bare: any = { ...snap, config: undefined, everything: undefined, warnings: undefined, screens: undefined };
  const x = io({ snap: () => bare });
  // Everything is still the serving machine's home folder
  expect(findSpace(bare, "everything", web)?.id).toBe("home");
  expect((await voiceTool("look", { what: "settings" }, web, x)).result).toBe("Settings can't be read right now.");
  expect((await voiceTool("look", { what: "tasks" }, web, x)).error).toBeUndefined();
  expect((await voiceTool("look", { what: "needs" }, web, x)).error).toBeUndefined();
});

test("SHEP-261: a locked phone does all an unlocked one does: acts ask the same spoken yes, then run; secrets and settings answer", async () => {
  const locked: Where = { ...web, locked: true, screen: false };
  const unlocked: Where = { ...web, locked: false, screen: true };
  const lx = io(), ux = io();
  for (const p of [{ action: "done", id: "fast switch" }, { action: "start", id: "later work" }, { action: "stop", id: "this" }, { action: "delete", id: "this" },
    { action: "remove_space", id: "shop" }, { action: "setting", key: "review", value: "on" }]) {
    // unconfirmed: the same answer as unlocked
    const ask = await voiceTool("act", { ...p, confirmed: false }, locked, lx);
    expect(ask).toEqual(await voiceTool("act", { ...p, confirmed: false }, unlocked, ux));
    expect(ask.result).not.toContain("locked");
    // confirmed: it runs, as unlocked
    expect(await voiceTool("act", { ...p, confirmed: true }, locked, lx)).toEqual(await voiceTool("act", { ...p, confirmed: true }, unlocked, ux));
  }
  expect(lx.calls.length).toBeGreaterThan(0);
  expect(lx.calls).toEqual(ux.calls);
  for (const what of ["secrets", "settings", "tasks"]) {
    const r = await voiceTool("look", { what }, locked, lx);
    expect(r).toEqual(await voiceTool("look", { what }, unlocked, ux));
    expect(r.result).not.toContain("unlock it");
  }
  expect((await voiceTool("send", { to: "this", text: "Ship it" }, locked, lx)).result).toContain("Sent to");
  expect(lx.sent).toEqual([{ key: "SHOP-45/worker", text: "Ship it" }]);
  // the where line still says the phone is locked (nothing on its screen), but not that it can't act
  const here = (await voiceTool("look", { what: "here" }, locked, lx)).result;
  expect(here).toContain("with it locked");
  expect(here).not.toContain("not act");
  for (const w of [unlocked, web]) expect((await voiceTool("look", { what: "here" }, w, ux)).result).not.toContain("locked");
});
