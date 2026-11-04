import { expect, test } from "bun:test";
import { newsKey } from "./compat.ts";

// An Assistant's chat is read again only when its conversation moves: the service tells open chats again when what
// their news lines show changes (SHEP-29: "SHEP-28 ready" kept its Accept after the task was accepted and done).
const row = (o: Record<string, unknown> = {}) => ({ space: "m3/sp1", ref: "SHEP-28", section: "ready", ready_at: 100, done_at: null, pct: 40, sub: "Ready", ...o }) as any;

test("a task accepted or done changes it", () => {
  expect(newsKey([row({ section: "done", done_at: 200 })])).not.toBe(newsKey([row()]));
  expect(newsKey([row({ section: "merging" })])).not.toBe(newsKey([row()]));
  expect(newsKey([row(), row({ ref: "SHEP-29", section: "working", ready_at: null })])).not.toBe(newsKey([row()]));
});

test("what news lines don't show leaves it, so chats aren't told again for nothing", () => {
  expect(newsKey([row({ pct: 90, sub: "Checks" })])).toBe(newsKey([row()]));
  // a task no space started gives no news line
  expect(newsKey([row(), row({ space: null, ref: "SHEP-1", section: "done" })])).toBe(newsKey([row()]));
});
