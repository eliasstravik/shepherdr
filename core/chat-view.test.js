import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { WORDS, clock, bandActs, bandOrder, senderName, briefLabel, newsWords, newsTimeline, resolveArtifacts, fitThumbs, dayLabel, imagesLine, questionsBelow, notSent, unsigned, elapsed, reportMsg, doingWords, ownWords, outsideTerminal, fromName, sentTo, selfName, initialOf, literal, firstUser, firstKeys } from "./chat-view.js";

const ROOT = join(import.meta.dir, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

describe("one set of words for the window's chat and the web's", () => {
  // the window's chat (mods/chat) and the web app's (web/plugins/chat, web/src/restart.tsx) read every fixed word
  // from WORDS: none is typed out again as a string in either, so they can't drift apart
  const window = ["mods/chat/main.js"];
  const web = readdirSync(join(ROOT, "web/plugins/chat")).filter((f) => /\.tsx?$/.test(f)).map((f) => `web/plugins/chat/${f}`);
  for (const file of [...window, ...web]) {
    test(file, () => {
      // code only: a comment may quote a word; a toast's title is core/toasts.test.js's to check
      const src = read(file).split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l) && !/title: `\$\{toastWho/.test(l)).map((l) => l.replace(/\s\/\/ .*$/, "")).join("\n");
      for (const w of Object.values(WORDS)) for (const q of [`"${w}"`, `'${w}'`, `>${w}<`, `\`${w}\``]) expect(src.includes(q) ? `${q} in ${file}` : "").toBe("");
    });
  }
  test("both sides import them", () => {
    expect(read("mods/chat/main.js")).toContain('from "./core/chat-view.js"');
    expect(read("web/plugins/chat/rows.tsx")).toContain("from '@core/chat-view.js'");
  });
});

describe("rows", () => {
  test("a message's time: today's as 14:05, an older one with its day", () => {
    const now = new Date(2026, 10, 4, 18, 0);
    expect(clock(new Date(2026, 10, 4, 14, 5).getTime(), now)).toBe("14:05");
    expect(clock(new Date(2026, 10, 3, 9, 7).getTime(), now)).toBe("3 Nov 09:07");
    expect(clock(0)).toBe("");
  });
  test("the band's actions: rewind on yours (not a /command), fork on the agent's", () => {
    expect(bandActs("user", "hi")).toEqual(["reply", "copy", "rewind"]);
    expect(bandActs("user", "/compact")).toEqual(["reply", "copy"]);
    expect(bandActs("agent", "done")).toEqual(["reply", "copy", "fork"]);
    expect(bandActs("agent", "done", { fork: false })).toEqual(["reply", "copy"]);
  });
  test("who sent a message, never its address", () => {
    const terms = { t1: { labels: { "herdr.role": "reviewer" } }, t2: { labels: { "herdr.role": "coordinator" } }, "vm/t3": { name: "herd-12-fix" } };
    const find = (a) => terms[a] ?? null;
    expect(senderName("t1", "", { find })).toBe("Reviewer");
    expect(senderName("t2", "", { find })).toBe("Assistant");
    expect(senderName("vm/t3", "", { find })).toBe("HERD-12 on vm");
    expect(senderName("t9 shep-7-web", "", { find, taskOf: () => null })).toBe("SHEP-7");
    expect(senderName("box/ppid:12", "From Coverage: hi")).toBe("Coverage");
    expect(senderName("person")).toBe("You");
    expect(unsigned("From HERD-76 (t12u): the words")).toBe("the words");
  });
  test("a sender on the machine reading the chat, written with its name (SHEP-12)", () => {
    // the web service on m3 shows a chat on vm whose agent got a message from m3's Assistant
    const terms = { t75: { template: "herdr-assistant-mw3acvzz", labels: { "herdr.role": "coordinator" } }, t80: { name: "shep-4-fix" }, t81: {} };
    const find = (a) => terms[a] ?? null;
    expect(senderName("m3/t75", "", { find, machine: "vm", here: "m3" })).toBe("Assistant on m3");
    expect(senderName("m3/t80", "", { find, machine: "vm", here: "m3" })).toBe("SHEP-4 on m3");
    expect(senderName("m3/t81", "", { find, machine: "vm", here: "m3", taskOf: (a) => (a === "t81" ? "SHEP-9" : null) })).toBe("SHEP-9 on m3");
    // its own chat: no "on"
    expect(senderName("m3/t75", "", { find, machine: null, here: "m3" })).toBe("Assistant");
    // an Assistant known only by its template
    expect(senderName("t75", "", { find: () => ({ template: "herdr-assistant-x" }) })).toBe("Assistant");
    // unknown here: "Another agent", unless it signed
    expect(senderName("box/t99", "", { find, machine: "vm", here: "m3" })).toBe("Another agent on box");
    expect(senderName("box/t99", "From the person's Assistant on m3 (t10v): the key", { find, machine: "vm", here: "m3" })).toBe("Assistant on m3");
    expect(unsigned("From the person's Assistant on m3 (t10v): the key")).toBe("the key");
  });
  test("the band: each side the other's mirror, pills at the bubble's outer edge", () => {
    expect(bandOrder("user", ["reply", "copy", "rewind"])).toEqual(["time", "reply", "copy", "rewind", "react", "pills"]);
    expect(bandOrder("agent", ["reply", "copy", "fork"])).toEqual(["pills", "react", "fork", "copy", "reply", "time"]);
    expect(bandOrder("agent", ["reply", "copy"], { time: false, react: false })).toEqual(["pills", "copy", "reply"]);
    expect(bandOrder("user", ["reply", "copy"], { react: false })).toEqual(["time", "reply", "copy", "pills"]);
  });
  test("a brief's label", () => {
    expect(briefLabel({ from: "t1", text: "x" }, 4, { sender: () => "Reviewer" })).toBe("Message from Reviewer");
    expect(briefLabel({ text: "brief" }, 0, { start: 0, task: true })).toBe("Task brief");
    expect(briefLabel({ text: "brief" }, 0, { start: 0, template: "assistant" })).toBe("New session");
    expect(briefLabel({ text: "<restart>x</restart>" }, 0, { start: 0 })).toBe("New session");
    expect(briefLabel({ text: "hi" }, 0, { start: 0 })).toBe(null);
    expect(briefLabel({ text: "brief" }, 0, { start: 900, task: true })).toBe(null);
  });
  test("a task's news line: what happened and the rest, without its id and title", () => {
    expect(newsWords({ ref: "HERD-4", event: "needs-you", text: "HERD-4 needs you: Needs a go (Fix login)" }, { title: "Fix login" })).toEqual({ mark: "needs", what: "needs you", text: "Needs a go" });
    expect(newsWords({ ref: "HERD-4", event: "ready", text: "HERD-4 is ready: Fix login · It works" }, { title: "Fix login" })).toEqual({ mark: "ready", what: "ready", text: "It works" });
    expect(newsWords({ ref: "HERD-4", event: "working-again", text: "HERD-4 is working again: resumed (Fix login)" }, { title: "Fix login" })).toEqual({ mark: "started", what: "working again", text: "resumed" });
    expect(newsWords({ ref: "HERD-4", event: "done", text: "HERD-4 is done (Fix login)" }, { title: "Fix login" })).toEqual({ mark: "done", what: "done", text: "Fix login" });
    expect(newsWords({ ref: "HERD-4", event: "started", made: true }, { title: "Fix login" })).toEqual({ mark: "started", what: "started", text: "Fix login" });
  });
  test("news lines: Herdr's in place, a start it never said from the task, Accept on the newest ready line", () => {
    const tasks = new Map([["H-1", { title: "A", status: "ready", started: 100, ready_at: 300 }]]);
    const items = [{ kind: "agent", at: 50 }, { kind: "news", id: "n1", at: 300, ref: "H-1", event: "ready", text: "H-1 is ready: A · ok" }];
    const out = newsTimeline(items, tasks, { start: 0 });
    expect(out.map((e) => [e.event, e.made ?? false, e.accept])).toEqual([["started", true, false], ["ready", false, true]]);
  });
  test("no ready line while its checks still run (SHEP-175)", () => {
    const tasks = new Map([["H-1", { title: "A", status: "working", started: 100, ready_at: 300 }]]);
    expect(newsTimeline([{ kind: "agent", at: 50 }], tasks, { start: 0 }).map((e) => e.event)).toEqual(["started"]);
  });
  test("which artifact a publish made", () => {
    const arts = [{ id: "a", title: "Plan", version: 2, versions: [{ v: 1, at: 1000, publisher: "t7" }, { v: 2, at: 9000, publisher: "t7" }] }];
    const r = resolveArtifacts([{ kind: "artifact", id: "x1", at: 900 }, { kind: "artifact", id: "x2", at: 8000 }], arts, "t7");
    expect(r.get("x1")).toMatchObject({ id: "a", v: 1, latest: false });
    expect(r.get("x2")).toMatchObject({ id: "a", v: 2, latest: true, title: "Plan", version: 2 });
  });
  test("images under a message keep their shape, fitted, shrunk together to the column", () => {
    expect(fitThumbs([{ w: 1600, h: 1100 }]).boxes[0]).toEqual({ w: 320, h: 220 });
    expect(fitThumbs([{ w: 100, h: 50 }]).boxes[0]).toEqual({ w: 100, h: 50 });
    expect(fitThumbs([null, null]).boxes).toEqual([{ w: 187, h: 140 }, { w: 187, h: 140 }]);
    expect(fitThumbs([{ w: 2000, h: 1000 }, { w: 2000, h: 1000 }], 206).boxes).toEqual([{ w: 101, h: 50 }, { w: 101, h: 50 }]);
  });
  test("day lines and small words", () => {
    const now = new Date(2026, 10, 4, 12);
    expect(dayLabel(now.getTime(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 3).getTime(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 20).getTime(), now)).toBe("Tue 20 Oct");
    expect(dayLabel(new Date(2025, 9, 20).getTime(), now)).toBe("Mon 20 Oct 2025");
    expect(imagesLine(1)).toBe("1 image");
    expect(imagesLine(3)).toBe("3 images");
    expect(questionsBelow(0)).toBe("Latest");
    expect(questionsBelow(2)).toBe("2 questions below");
    expect(notSent("Busy.")).toBe("Not sent: Busy. Click to try again.");
    expect(elapsed(75)).toBe("1:15");
  });
});

describe("the working line says what the agent does, in the window and on the web", () => {
  test("its CLI's status report, from either side's terminal", () => {
    // the window's terminals(): a plain status word and the report; the service's herdr-core record: the report in status
    expect(reportMsg({ status: "working", report: { app: "claude-code", msg: "Computing build times", state: "working" } })).toBe("Computing build times");
    expect(reportMsg({ status: { app: "claude-code", msg: " Computing build times ", state: "working" } })).toBe("Computing build times");
    expect(reportMsg({ status: { app: "claude-code", state: "working" } })).toBe("");
    expect(reportMsg({ status: "working", report: null })).toBe("");
    expect(reportMsg(undefined)).toBe("");
  });
  test("its log's open call first, then the report, never a question", () => {
    expect(doingWords({ doing: "Editing main.js" }, "Computing build times")).toBe("Editing main.js");
    expect(doingWords({ doing: null }, "Computing build times")).toBe("Computing build times");
    expect(doingWords(null, "answer: Tea or coffee?")).toBe(null);
    expect(doingWords(null, "")).toBe(null);
  });
  test("both sides read it from here", () => {
    for (const f of ["mods/chat/main.js", "service/compat.ts"]) for (const fn of ["reportMsg(", "doingWords("]) expect(read(f).includes(fn) ? "" : `${fn} not in ${f}`).toBe("");
  });
});

// SHEP-3: the person's words that came wrapped as another machine's process's message are theirs once this chat knows
// it just sent them; an agent's message, or words nobody here sent, stay another's.
describe("ownWords", () => {
  const matches = (u, p) => u.text === p.text && u.at >= p.at - 5000;
  test("a window's send on another machine, wrapped, is the person's", () => {
    expect(outsideTerminal("laptop/ppid:25569")).toBe(true);
    const users = [{ id: 1, text: "kill shep-1 and start a new task for it instead", from: "laptop/ppid:25569", at: 10_000 }];
    expect(ownWords(users, [{ text: "kill shep-1 and start a new task for it instead", at: 9_000 }], matches)).toEqual([1]);
  });
  test("an agent's message with the same words stays the agent's", () => {
    expect(outsideTerminal("t7 review")).toBe(false);
    expect(ownWords([{ id: 1, text: "ok", from: "t7 review", at: 10_000 }], [{ text: "ok", at: 9_000 }], matches)).toEqual([]);
    expect(ownWords([{ id: 1, text: "ok", from: "vm/t7", at: 10_000 }], [{ text: "ok", at: 9_000 }], matches)).toEqual([]);
  });
  test("nothing sent from here, or other words: still another's", () => {
    const users = [{ id: 1, text: "hello", from: "mac/ppid:1", at: 10_000 }];
    expect(ownWords(users, [], matches)).toEqual([]);
    expect(ownWords(users, [{ text: "bye", at: 9_000 }], matches)).toEqual([]);
    expect(ownWords(users, [{ text: "hello", at: 60_000 }], matches)).toEqual([]);
  });
  test("one send claims one message", () => {
    const users = [{ id: 1, text: "yes", from: "mac/ppid:1", at: 10_000 }, { id: 2, text: "yes", from: "mac/ppid:9", at: 11_000 }];
    expect(ownWords(users, [{ text: "yes", at: 9_000 }], matches)).toEqual([1]);
  });
});

describe("agent to agent as a group chat (SHEP-27)", () => {
  test("another Assistant is named by its machine and space; this machine's unsaid", () => {
    const x = { from: "mac/t13", assistant: { machine: "mac", space: "Home" }, text: "hi" };
    expect(fromName(x, () => "nope", { machineName: (m) => (m === "mac" ? "Mac mini" : null) })).toBe("Assistant on Mac mini · Home");
    expect(fromName(x, () => "nope", { here: "mac" })).toBe("Assistant · Home");
    expect(fromName({ from: "t3", text: "x" }, (f) => `name of ${f}`)).toBe("name of t3");
    expect(briefLabel(x, 5, { machineName: () => "Mac mini" })).toBe("Message from Assistant on Mac mini · Home");
  });
  test("whom a sent message went to", () => {
    const sender = (a) => ({ t10s: "SHEP-4", "mac/t13": "Another agent on mac" }[a] ?? "Another agent");
    expect(sentTo({ to: "t10s", how: "hc" }, sender)).toBe("SHEP-4");
    expect(sentTo({ to: "mac/t13", how: "assistant" }, sender)).toBe("Assistant on mac");
    expect(sentTo({ to: "Home", how: "assistant" }, sender)).toBe("Assistant · Home");
  });
  test("who the chat's own agent is, and initials", () => {
    expect(selfName({ assistant: true })).toBe("Assistant");
    expect(selfName({ task: "SHEP-4" })).toBe("SHEP-4");
    expect(selfName({ kind: "codex" })).toBe("Codex");
    expect(initialOf("SHEP-4")).toBe("S");
    expect(initialOf("Assistant on Mac mini · Home")).toBe("A");
  });
});

// SHEP-54: an agent's own helper agents in herdr, over its chat
import { subagentsOf, subagentTitle, isHelper } from "./chat-view.js";
test("subagentsOf: its own hc children labelled reviewer or helper, never workers", () => {
  const now = 10_000_000;
  const terms = [
    { address: "t1", state: "live", labels: { "herdr.task": "x#1" } },
    { address: "t2", parent: "t1", state: "live", status: { state: "working" }, created_ms: 100, name: "x-1-review", labels: { "herdr.task": "x#1", "herdr.role": "reviewer", "herdr.agent": "codex" } },
    // a worker: an Assistant's child with a task, no helper role
    { address: "t3", parent: "t0", state: "live", labels: { "herdr.task": "x#2" } },
    { address: "t4", parent: "t1", state: "live", status: { state: "blocked" }, created_ms: 50, agent: "claude-code", labels: { "herdr.role": "helper" } },
    // ended an hour and more ago: gone
    { address: "t5", parent: "t1", state: "finished", finished_ms: now - 2 * 3600000, labels: { "herdr.role": "reviewer" } },
    { address: "t6", parent: "t1", state: "finished", created_ms: 10, finished_ms: now - 60000, labels: { "herdr.role": "reviewer", "herdr.agent": "claude" } },
    // another machine's: its parent named there
    { address: "vm/t8", parent: "t7", state: "live", status: "idle", created_ms: 1, labels: { "herdr.role": "reviewer" } },
  ];
  const got = subagentsOf(terms, "t1", now);
  expect(got.map((s) => [s.address, s.title, s.status])).toEqual([
    ["t6", "Reviewer · Claude Code", "done"], ["t4", "Helper · Claude Code", "needs"], ["t2", "Reviewer · Codex", "working"]]);
  expect(got[0].ended).toBe(now - 60000);
  expect(subagentsOf(terms, "vm/t7", now).map((s) => [s.address, s.status])).toEqual([["vm/t8", "done"]]);
  expect(subagentsOf(terms, "t0", now)).toEqual([]);
  expect(isHelper({ labels: { "herdr.role": "reviewer" } })).toBe(false); // no parent: an old herdr-task reviewer
  expect(subagentTitle({ role: "reviewer", cli: null })).toBe("Reviewer");
});

// SHEP-69 (#591, #592, #589): the person's words as typed, and the session's first message found again.
describe("the person's words and the session's first message", () => {
  test("a <word> the person typed stays in their bubble; code is left alone (#591)", () => {
    expect(literal("Decisions: B1 = <yours>, B3 = <yours>.")).toBe("Decisions: B1 = \\<yours>, B3 = \\<yours>.");
    expect(literal("a `<code>` and\n```\n<div>\n```\nafter <x>")).toBe("a `<code>` and\n```\n<div>\n```\nafter \\<x>");
    // an entity typed is its characters; a lone & needs nothing
    expect(literal("&lt; & ampersand")).toBe("\\&lt; & ampersand");
    expect(literal(null)).toBe("");
  });
  test("the first message is the first user item, wherever news read out of it went (#589)", () => {
    expect(firstUser([{ kind: "news" }, { kind: "news" }, { kind: "user" }, { kind: "user" }])).toBe(2);
    expect(firstUser([{ kind: "agent" }])).toBe(-1);
    // its quiet row's label follows it there
    expect(briefLabel({ text: "role" }, 2, { start: 0, template: "herdr-assistant", first: 2 })).toBe("New session");
    expect(briefLabel({ text: "later" }, 3, { start: 0, template: "herdr-assistant", first: 2 })).toBe(null);
    expect(briefLabel({ text: "role" }, 0, { start: 0, template: "herdr-assistant" })).toBe("New session");
  });
  test("a chat opened again by the agent's address finds the first words by its labels (#592)", () => {
    const labels = { "herdr.chat.slot": "coord-abc", "herdr.chat.origin": "slot:coord-abc" };
    expect(firstKeys({ labels, origin: "slot:coord-abc", addr: "t12" })).toEqual(["coord-abc", "slot:coord-abc", "t12"]);
    expect(firstKeys({ slot: "coord-abc", labels: {}, origin: "slot:coord-abc" })).toEqual(["coord-abc", "slot:coord-abc"]);
    expect(firstKeys({})).toEqual([]);
  });
});

// SHEP-92: at most one row over the box for each kind of background work
import { bgGroups } from "./chat-view.js";
test("bgGroups: one row per kind, subagents first, the newest and their shared state", () => {
  expect(bgGroups([])).toEqual([]);
  const one = bgGroups([{ id: "s1", kind: "shell", at: 5, title: "Build" }]);
  expect(one.map((g) => [g.kind, g.words, g.newest.id])).toEqual([["proc", null, "s1"]]);
  const many = bgGroups([
    { id: "s1", kind: "shell", at: 5 }, { id: "m1", kind: "monitor", at: 9 }, { id: "s2", kind: "shell", at: 7 },
    { id: "c1", kind: "child", at: 3, status: "done" }, { id: "a1", kind: "agent", at: 4 },
  ]);
  expect(many.map((g) => [g.kind, g.words, g.newest.id, g.status, g.items.length])).toEqual([
    ["sub", "2 subagents", "a1", "working", 2], ["proc", "3 background processes", "m1", "working", 3]]);
  expect(bgGroups([{ kind: "child", at: 1, status: "done" }, { kind: "child", at: 2, status: "needs" }, { kind: "child", at: 3, status: "working" }])[0].status).toBe("needs");
  expect(bgGroups([{ kind: "child", at: 1, status: "done" }, { kind: "child", at: 2, status: "done" }])[0].status).toBe("done");
});
