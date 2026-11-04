import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SHOWN, NEEDS_YOU, FINISHED, toastTitle, assistantWho, needReason, withToast, unexpired, tone } from "./toasts.js";
import { REASONS } from "./needs.js";

const root = join(import.meta.dir, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

test("titles say who and what, as the window's", () => {
  expect(toastTitle("HERD-4", NEEDS_YOU)).toBe("HERD-4 · Needs you");
  expect(toastTitle(assistantWho("tt-repo"), FINISHED)).toBe("tt-repo Assistant · Finished");
  expect(assistantWho(null)).toBe("Assistant");
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
