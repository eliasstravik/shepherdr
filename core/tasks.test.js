import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { place, queueReason, reportOf, estimated, order, ago, autoPrefix, refOf, taskKey, matches, busyAgain, secondLine, leftOf, ORDER, STATUS, WORKING_AGAIN, GRACE_MS, fromLine, autoWhere, inSpace, holdingItems } from "./tasks.js";
import { REASONS, fit } from "./needs.js";

const NOW = 1_800_000_000_000;
const list = (tasks, more = {}) => ({ slug: "dev-x", prefix: "X", folder: "/f", machine: null, tasks, ...more });
const at = (task, live = [], loaded = true) => place(list([task]), task, { live, loaded, now: NOW });

describe("a task's status (as herdr-task's task_status)", () => {
  test("todo, queued and done come from the record", () => {
    for (const s of ["todo", "queued", "done"]) expect(at({ id: 1, state: s }).section).toBe(s);
  });
  test("an agent asking makes it need you, with herdr-task's words when it has them", () => {
    expect(at({ id: 1, state: "running" }, [{ address: "t1", status: "blocked" }])).toMatchObject({ section: "needs", needs: "asks", why: REASONS.question });
    expect(at({ id: 1, state: "running", waits: "Pick a colour" }, [{ address: "t1", status: "blocked" }]).why).toBe("Pick a colour");
  });
  test("Claude Code's folder-trust dialog needs you, not Working (#755)", () => {
    const fresh = [{ address: "t1", status: null }];
    expect(at({ id: 1, state: "running", started: NOW - 10_000 }, fresh).section).toBe("working");
    expect(at({ id: 1, state: "running", started: NOW - 10_000, trust_ask: "t1" }, fresh)).toMatchObject({ section: "needs", needs: "asks", why: REASONS.trust });
    // Answered: it reports a status, and the old mark is no ask.
    expect(at({ id: 1, state: "running", started: NOW - 10_000, trust_ask: "t1" }, [{ address: "t1", status: "working" }]).section).toBe("working");
  });
  test("working while its agent works, or while just started", () => {
    expect(at({ id: 1, state: "running" }, [{ address: "t1", status: "working" }]).section).toBe("working");
    expect(at({ id: 1, state: "running", started: NOW - 10_000 }).section).toBe("working");
  });
  test("an idle live agent waits for a reply; no agent at all has stopped", () => {
    expect(at({ id: 1, state: "running", started: NOW - 600_000 }, [{ address: "t1", status: "idle" }])).toMatchObject({ section: "needs", needs: "reply" });
    expect(at({ id: 1, state: "running", started: NOW - 600_000 })).toMatchObject({ section: "needs", needs: "stopped" });
  });
  test("an idle agent on its own background work is working; asking still needs you (SHEP-53)", () => {
    const idle = [{ address: "t1", status: "idle" }];
    expect(at({ id: 1, state: "running", started: NOW - 600_000, own_work: true }, idle)).toMatchObject({ section: "working", needs: null });
    expect(at({ id: 1, state: "running", started: NOW - 600_000, own_work: true }, [{ address: "t1", status: "blocked" }])).toMatchObject({ section: "needs", needs: "asks" });
    expect(at({ id: 1, state: "running", started: NOW - 600_000, own_work: true })).toMatchObject({ section: "needs", needs: "stopped" });
  });
  test("a machine still loading gives no verdict", () => {
    expect(at({ id: 1, state: "running", started: NOW - 600_000 }, [], false).section).toBe("working");
  });
  test("ready; merging once asked or by itself is Working (SHEP-175)", () => {
    expect(at({ id: 1, state: "ready" }).section).toBe("ready");
    // #802: in GitHub's merge queue, Working (never done) until GitHub merged it; #743: waiting calmly for an approval.
    expect(at({ id: 1, state: "ready", merge_queued: NOW, pr: { number: 3 } })).toMatchObject({ section: "working", why: "In GitHub's merge queue" });
    expect(at({ id: 1, state: "ready", auto_merge: "checks", pr: { number: 3, needs_approval: true } })).toMatchObject({ section: "working", why: "Merges once it's approved" });
    expect(at({ id: 1, state: "ready", merge_requested: true }, [{ address: "t1", status: "working" }])).toMatchObject({ section: "working", why: "Merging" });
    expect(at({ id: 1, state: "ready", auto_merge: true, pr: { number: 3 } })).toMatchObject({ section: "working", why: "Merges once its checks pass" });
  });
  test("a pull request whose checks still run is Working, then Ready (SHEP-175)", () => {
    const idle = [{ address: "t1", status: "idle", since: NOW - 600_000 }];
    expect(at({ id: 1, state: "ready", pr: { number: 3, wait: "Checks running" } }, idle)).toMatchObject({ section: "working", needs: null, why: "Checks running" });
    expect(at({ id: 1, state: "ready", pr: { number: 3 } }, idle).section).toBe("ready");
    // A failing check found a moment ago: back to its agent, Working, never Ready first.
    const failing = { id: 1, state: "ready", attention: "Checks failing: check.", attention_at: NOW - 5000, pr: { number: 3, wait: "Back to its agent to fix" } };
    expect(at(failing, idle)).toMatchObject({ section: "working", why: "Back to its agent to fix" });
  });
  test("attention and provider retries", () => {
    expect(at({ id: 1, state: "running", attention: "Checks failed" })).toMatchObject({ section: "needs", why: "Checks failed" });
    const retry = { address: "t1", reason: "Provider overloaded", due: NOW + 90_000 };
    expect(at({ id: 1, state: "running", retry }, [{ address: "t1", status: "idle" }])).toMatchObject({ section: "working", why: "Provider overloaded · Retry in 2m" });
    expect(at({ id: 1, state: "running", retry: { ...retry, over: true } }, [{ address: "t1", status: "idle" }])).toMatchObject({ section: "needs", needs: "provider" });
  });
});

test("why a queued task waits", () => {
  const l = list([{ id: 1, state: "running" }, { id: 2, state: "queued", after: [1] }, { id: 3, state: "queued" }], { config: { max_running: 1 } });
  expect(queueReason(l, l.tasks[1], 1)).toBe("after X-1");
  expect(queueReason(l, l.tasks[2], 1)).toBe("Waits: 1 task is running here");
  expect(queueReason(l, { id: 4, state: "queued", held: "vm-a's memory is 92% full" }, 0)).toBe("Waits: vm-a's memory is 92% full");
  expect(queueReason(l, { id: 4, state: "queued" }, 0)).toBe("Starts soon");
});

test("what the agent last said, with minutes from its very first estimate", () => {
  const task = (progress) => ({ id: 1, state: "running", progress });
  expect(reportOf(task({ text: "Starting", done: 0, left: 600_000, at: NOW }), "working", null, NOW)).toEqual({ text: "Starting", done: 0, left: 10, paused: false });
  expect(reportOf(task({ text: "Writing tests", done: 40, left: 600_000, at: NOW }), "working", null, NOW).left).toBe(10);
  expect(reportOf(task({ text: "Writing tests", done: 40, at: NOW }), "working", null, NOW).left).toBeNull();
  expect(reportOf(task({ text: "x" }), "ready", null, NOW)).toBeNull();
  expect(reportOf(task(null), "working", { pct: 30, msg: "own words" }, NOW)).toMatchObject({ text: "own words", done: 30 });
  expect(estimated({ left: 1 })).toBe(true);
  expect(estimated({ done: 50 })).toBe(false);
});

test("order, words and keys", () => {
  const rows = [{ task: { id: 2, done_at: 5 } }, { task: { id: 1, done_at: 9 } }];
  expect([...rows].sort(order("done")).map((r) => r.task.id)).toEqual([1, 2]);
  expect([...rows].sort(order("todo")).map((r) => r.task.id)).toEqual([1, 2]);
  expect(ago(NOW - 3 * 60_000, true, NOW)).toBe("3m ago");
  expect(ago(NOW, true, NOW)).toBe("just now");
  expect(autoPrefix("/x/herdr-app-ttt")).toBe("HAT");
  expect(autoPrefix("/x/shepherdr")).toBe("SHEP");
  expect(refOf({ prefix: "SHEP" }, { id: 7 })).toBe("SHEP-7");
  expect(taskKey({ machine: null, folder: "/f" }, { id: 7 })).toBe(":/f#7");
  expect(matches("ship web", "SHEP-7", "Ship the Web client")).toBe(true);
  expect(fit("one two three four five six seven eight nine ten eleven")).toBe("one two three four five six seven eight…");
});

// The same cases herdr-task's busy_again() passes (test/test_herdr_task.py).
const back = JSON.parse(readFileSync(new URL("./back-to-work.cases.json", import.meta.url), "utf8"));

describe("a Ready task back at work (as herdr-task's busy_again)", () => {
  for (const c of back.cases) test(c.name, () => expect(busyAgain(c.task, c.live, back.now)).toBe(c.expect));
  test("it shows Working, saying so, with no Ready line", () => {
    const task = { id: 7, state: "ready", ready_at: back.now - 600_000, ready_turns: { t1: 5 } };
    const p = place(list([task]), task, { live: [{ address: "t1", status: "working", turn: 5 }], now: back.now });
    expect(p).toMatchObject({ section: "working", why: WORKING_AGAIN });
    expect(secondLine(p, null, null, back.now)).toBe(WORKING_AGAIN);
  });
  test("Working, not Working again, while it ends the turn it said ready in; Ready once idle (SHEP-148)", () => {
    const task = { id: 7, state: "ready", ready_at: back.now - 5_000, ready_turns: { t1: 5 } };
    expect(place(list([task]), task, { live: [{ address: "t1", status: "working", turn: 4 }], now: back.now })).toMatchObject({ section: "working", why: null });
    expect(place(list([task]), task, { live: [{ address: "t1", status: "idle", turn: 5 }], now: back.now }).section).toBe("ready");
  });
  test("asking the person while back at work needs them", () => {
    const task = { id: 7, state: "ready", ready_at: back.now - 600_000, ready_turns: { t1: 5 } };
    expect(place(list([task]), task, { live: [{ address: "t1", status: "blocked", turn: 5 }], now: back.now }).section).toBe("needs");
  });
});

// A task with a problem (failing checks) its agent is on: Working; nobody on it: Needs you (SHEP-8). The same
// cases herdr-task's task_status() passes (test/test_herdr_task.py).
const onIt = JSON.parse(readFileSync(new URL("./on-it.cases.json", import.meta.url), "utf8"));
const grace = JSON.parse(readFileSync(new URL("./grace.cases.json", import.meta.url), "utf8"));

describe("a problem someone is on (as herdr-task's on_it)", () => {
  for (const c of onIt.cases) test(c.name, () => {
    const task = { id: 7, ...c.task };
    const p = place(list([task]), task, { live: c.live, now: onIt.now });
    const why = c.expect.why === "QUESTION" ? REASONS.question : c.expect.why;
    expect({ section: p.section, needs: p.needs, why: p.why }).toEqual({ section: c.expect.status, needs: c.expect.needs, why });
  });
});

// SHEP-133: a short grace before Needs you (core/grace.cases.json, which herdr-task's tests read too).
describe("a short grace before Needs you (as herdr-task's GRACE_MS)", () => {
  for (const c of grace.cases) test(c.name, () => {
    const task = { id: 7, ...c.task };
    const p = place(list([task]), task, { live: c.live, now: grace.now });
    expect({ section: p.section, needs: p.needs }).toEqual({ section: c.expect.status, needs: c.expect.needs });
    if (c.expect.settles) expect(p.settles).toBe(c.expect.settles);
    else expect(p.settles).toBeUndefined();
  });
  test("the grace is the same on both sides", () => {
    expect(GRACE_MS).toBe(20000);
    expect(readFileSync(new URL("../mods/tasks/bin/herdr_task/agents.py", import.meta.url), "utf8")).toContain("GRACE_MS = 20_000");
  });
});

// SHEP-38: a task that starts by itself at a time (herdr-task --at / --in) is Scheduled: its row says when ("Starts
// Today 18:00"), its time until then under its mark ("6h"), the next to start first.
test("a scheduled task says when it starts", () => {
  const now = new Date(2026, 10, 5, 12, 0).getTime(); // a Thursday, noon
  const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
  const list = { prefix: "HAT", folder: "/f", tasks: [] };
  const p = (ms) => place(list, { id: 1, state: "scheduled", scheduled_for: ms, agents: [] }, { now });
  expect(p(at(5, 18)).section).toBe("scheduled");
  expect(secondLine(p(at(5, 18)), null, null, now)).toBe("Starts Today 18:00");
  expect(secondLine(p(at(6, 9)), null, null, now)).toBe("Starts Tomorrow 9:00");
  expect(secondLine(p(at(9, 8, 15)), null, null, now)).toBe("Starts Mon 8:15");
  expect(secondLine(p(at(25, 9)), null, null, now)).toBe("Starts Nov 25 9:00");
  expect(secondLine(p(at(5, 11)), null, null, now)).toBe("Starts now");
  expect([at(5, 12, 45), at(5, 18), at(7, 12)].map((ms) => leftOf(p(ms), null, now))).toEqual(["45m", "6h", "2d"]);
  const rows = [p(at(7, 9)), p(at(5, 18))];
  expect(rows.sort(order("scheduled")).map((r) => r.task.scheduled_for)).toEqual([at(5, 18), at(7, 9)]);
  expect(ORDER.indexOf("scheduled")).toBe(ORDER.indexOf("queued") + 1);
  expect(STATUS.scheduled).toBe("Scheduled");
});

describe("an automation's row (SHEP-43)", () => {
  test("says its machine and space whatever the grouping, its machine only with more than one", () => {
    expect(autoWhere("vm-b", "shepherdr", true)).toBe("vm-b · shepherdr");
    expect(autoWhere("This computer", "Home", true)).toBe("This computer · Home");
    expect(autoWhere("This computer", "Home", false)).toBe("Home");
    expect(autoWhere(null, null, true)).toBe(null);
  });
  test("one set off from another folder says by what and where", () => {
    expect(fromLine(["merged"], "vm-b · shepherdr")).toBe("On merges in vm-b · shepherdr");
    expect(fromLine(["ready", "merged"], "x")).toBe("On ready tasks or merges in x");
    expect(fromLine(["added", "ready", "merged"], "x")).toBe("On task events in x");
    expect(fromLine([], "x")).toBe("On task events in x");
  });
});

// SHEP-54: a worker's own helper agent (its reviewer, an hc child) is never one of its agents: at work or asking, its
// quiet worker is Working; once over, it counts not
test("place: a worker's helper keeps it Working, never Needs you", () => {
  const list = { slug: "x", folder: "/x", prefix: "X", tasks: [] };
  const task = { id: 1, state: "running", started: 1, agents: [{ address: "t1", at: 1 }] };
  const live = [{ address: "t1", status: "idle", role: "worker" }];
  expect(place(list, task, { live, helpers: [{ address: "t2", status: "working" }] }).section).toBe("working");
  expect(place(list, task, { live, helpers: [{ address: "t2", status: "blocked" }] }).section).toBe("working");
  expect(place(list, task, { live, helpers: [{ address: "t2", status: "idle" }] }).section).toBe("needs");
  // no worker left: its helper alone keeps nothing going
  expect(place(list, task, { live: [], helpers: [{ address: "t2", status: "working" }] }).section).toBe("needs");
});

describe("This space (inSpace)", () => {
  const sp = { id: "sp3", machine: null, folder: "/work/shop" };
  test("its list's folder, on its machine", () => {
    expect(inSpace(sp, { machine: null, folder: "/work/shop" })).toBe(true);
    expect(inSpace(sp, { machine: "vm", folder: "/work/shop" })).toBe(false);
    expect(inSpace(sp, { machine: null, folder: "/work/other" })).toBe(false);
  });
  test("started for the space, wherever its list is (a bare id or one read from a machine)", () => {
    expect(inSpace(sp, { machine: null, folder: "/work/other", space: "sp3" })).toBe(true);
    expect(inSpace({ ...sp, machine: "vm", id: "vm/sp3" }, { machine: "vm", folder: "/x", space: "sp3" })).toBe(true);
    expect(inSpace({ ...sp, machine: "vm" }, { machine: "vm", folder: "/x", space: "vm/sp3" })).toBe(true);
    expect(inSpace(sp, { machine: null, folder: "/x", space: "sp4" })).toBe(false);
  });
  test("no space: nothing is in it", () => {
    expect(inSpace(null, { machine: null, folder: "/work/shop" })).toBe(false);
  });
});

describe("Needs-you items the task's own status has moved past (SHEP-195)", () => {
  // The task as its list says it now, keyed as the Tasks panel keys items.
  const truthOf = (...ps) => new Map(ps.map((p) => [`${p.list.machine ?? ""}:${p.list.folder}:${refOf(p.list, p.task)}`, p]));
  const item = (kind, extra = {}) => ({ kind, machine: null, folder: "/f", ref: "X-3", ...extra });
  test("a check or waiting item for a task now Done is dropped; its row shows Done", () => {
    const done = at({ id: 3, state: "done", attention: "CI failed", title: "T" });
    const truth = truthOf(done);
    expect(holdingItems([item("check"), item("waiting")], truth)).toEqual([]);
    expect(done.section).toBe("done");
  });
  test("an item for a task still needing the person stays", () => {
    const stuck = at({ id: 3, state: "running", attention: "CI failed" });
    expect(holdingItems([item("check")], truthOf(stuck))).toHaveLength(1);
  });
  test("an item whose task no list has (another machine not loaded) stays, as do asks and provider items", () => {
    const done = at({ id: 3, state: "done" });
    const items = [item("check", { ref: "X-9" }), item("blocked", { terminal: "t1" }), item("provider")];
    expect(holdingItems(items, truthOf(done))).toHaveLength(3);
  });
});
