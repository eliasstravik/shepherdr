import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SHOWN, NEEDS_YOU, FINISHED, toastTitle, assistantWho, taskWho, together, needReason, withToast, unexpired, tone } from "./toasts.js";
import { REASONS } from "./needs.js";

const root = join(import.meta.dir, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

test("titles say who and what, as the window's", () => {
  expect(toastTitle("HERD-4", NEEDS_YOU)).toBe("HERD-4 · Needs you");
  expect(toastTitle(assistantWho("tt-repo"), FINISHED)).toBe("tt-repo Assistant · Finished");
  expect(assistantWho(null)).toBe("Assistant");
  // this computer's task by its ref alone; another machine's with that machine's name
  expect(taskWho("SHEP-17", null)).toBe("SHEP-17");
  expect(toastTitle(taskWho("SHEP-17", "MacBook"), NEEDS_YOU)).toBe("SHEP-17 on MacBook · Needs you");
});

test("one event is one toast: the same key takes the old one's place", () => {
  let l = withToast([], { title: "a", body: "Question for you", key: "need:x" }, 1000, "t1");
  l = withToast(l, { title: "b" }, 1001, "t2");
  l = withToast(l, { title: "a", body: "Rerun CI?", key: "need:x" }, 1002, "t3");
  expect(l.map((n) => [n.id, n.body ?? null])).toEqual([["t2", null], ["t1", "Rerun CI?"]]);
});

test("several at once in one line", () => {
  expect(together([{ need: true, task: true }, { need: true, task: true }])).toBe("2 tasks need you");
  expect(together([{ need: true, task: true }, { need: true }])).toBe("2 need you");
  expect(together([{ need: true }, {}, {}])).toBe("3 updates");
});

test("why it needs you", () => {
  expect(needReason({ question: { kind: "Plan", title: "x" } })).toBe(REASONS.plan);
  expect(needReason({ question: { kind: "Question", title: "Rerun CI?" } })).toBe("Rerun CI?");
  expect(needReason({ secret: { name: "API_KEY" } })).toBe("Asks for API_KEY");
  expect(needReason({})).toBe(REASONS.question);
});

test("kept and gone", () => {
  let l = [];
  for (let i = 0; i < 7; i++) l = withToast(l, { title: String(i) }, 1000 + i, `t${i}`);
  expect(l.map((n) => n.title)).toEqual(["2", "3", "4", "5", "6"]);
  expect(unexpired([{ at: 0, level: "alert" }, { at: 0 }], 10000).length).toBe(1);
  expect(tone("alert")).toBe("red");
  expect(SHOWN).toBe(3);
});

test("the window's toasts say the same words as these (mods/chat, lib/ui.js), and mods/toasts reads its rules here", () => {
  expect(read("mods/chat/main.js")).toContain('st === "blocked" ? "Needs you" : "Finished"');
  expect(read("lib/inbox.js")).toContain("· Needs you`");
  expect(read("lib/ui.js")).toContain("`${name} Assistant` : \"Assistant\"");
  expect(read("mods/toasts/main.js")).toContain('from "./core/toasts.js"');
  expect(read("web/plugins/alerts/toasts.tsx")).toContain("@core/toasts.js");
  expect(read("service/push.ts")).toContain("../core/toasts.js");
});
