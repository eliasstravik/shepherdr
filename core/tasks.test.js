import { describe, expect, test } from "bun:test";
import { place, queueReason, reportOf, estimated, order, ago, autoPrefix, refOf, taskKey, matches } from "./tasks.js";
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
  test("working while its agent works, or while just started", () => {
    expect(at({ id: 1, state: "running" }, [{ address: "t1", status: "working" }]).section).toBe("working");
    expect(at({ id: 1, state: "running", started: NOW - 10_000 }).section).toBe("working");
  });
  test("an idle live agent waits for a reply; no agent at all has stopped", () => {
    expect(at({ id: 1, state: "running", started: NOW - 600_000 }, [{ address: "t1", status: "idle" }])).toMatchObject({ section: "needs", needs: "reply" });
    expect(at({ id: 1, state: "running", started: NOW - 600_000 })).toMatchObject({ section: "needs", needs: "stopped" });
  });
  test("a machine still loading gives no verdict", () => {
    expect(at({ id: 1, state: "running", started: NOW - 600_000 }, [], false).section).toBe("working");
  });
  test("ready, and merging once asked or merging by itself", () => {
    expect(at({ id: 1, state: "ready" }).section).toBe("ready");
    expect(at({ id: 1, state: "ready", merge_requested: true }, [{ address: "t1", status: "working" }]).section).toBe("merging");
    expect(at({ id: 1, state: "ready", auto_merge: true, pr: { number: 3 } })).toMatchObject({ section: "merging", why: "Merges once its checks pass" });
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

test("what the agent last said, with minutes only once they're a real estimate", () => {
  const task = (progress) => ({ id: 1, state: "running", progress });
  expect(reportOf(task({ text: "Writing tests", done: 10, left: 600_000, at: NOW }), "working", null, NOW)).toEqual({ text: "Writing tests", done: 10, left: null, paused: false });
  expect(reportOf(task({ text: "Writing tests", done: 40, left: 600_000, at: NOW }), "working", null, NOW).left).toBe(10);
  expect(reportOf(task({ text: "x" }), "ready", null, NOW)).toBeNull();
  expect(reportOf(task(null), "working", { pct: 30, msg: "own words" }, NOW)).toMatchObject({ text: "own words", done: 30 });
  expect(estimated({ left: 1, n: 2 }, null)).toBe(true);
  expect(estimated({ left: 1 }, 14)).toBe(false);
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
