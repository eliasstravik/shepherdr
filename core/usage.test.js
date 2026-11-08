import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clean, lines, APPEND, CAP } from "./usage.js";

test("keeps kinds, ids, counts and times; drops words and unknown fields", () => {
  const e = clean({ kind: "send", from: "phone", n: 2, text: "my secret plan", task: "SHEP-7", at: 5 }, 10);
  expect(e).toEqual({ at: 5, kind: "send", from: "phone", n: 2, task: "SHEP-7" });
  // a field holding words (spaces), or a value that isn't a count, is dropped
  expect(clean({ kind: "act", from: "web", type: "rename to Big Plans", ms: -3, status: "500" }, 10)).toEqual({ at: 10, kind: "act", from: "web" });
  expect(clean({ kind: "view", from: "window", view: "settings", section: "agents", space: "p:vm:shop", ms: 1200 }, 10))
    .toEqual({ at: 10, kind: "view", from: "window", view: "settings", section: "agents", space: "p:vm:shop", ms: 1200 });
});

test("an unknown kind or surface is no event; an ask may have no surface", () => {
  expect(clean({ kind: "keystroke", from: "web" })).toBeNull();
  expect(clean({ kind: "view", from: "elsewhere" })).toBeNull();
  expect(clean({ kind: "ask", type: "plan", ms: 4000 }, 9)).toEqual({ at: 9, kind: "ask", type: "plan", ms: 4000 });
  expect(clean(null)).toBeNull();
});

test("lines: one JSON object per line; a time from the future is now", () => {
  const text = lines([{ kind: "feature", from: "web", type: "dictation", at: 99_999_999 }, { kind: "nope" }], 1000);
  expect(text).toBe('{"at":1000,"kind":"feature","from":"web","type":"dictation"}\n');
  expect(lines("not a list")).toBe("");
});

test("the window's append: creates the folder, appends, and turns a full log into the one old file", () => {
  const d = join(mkdtempSync(join(tmpdir(), "usage-")), "shepherdr");
  const run = (text, cap = CAP) => Bun.spawnSync(["sh", "-c", APPEND, "usage", d, text, String(cap)]);
  run('{"a":1}\n');
  run('{"a":2}\n');
  expect(readFileSync(join(d, "usage.jsonl"), "utf8")).toBe('{"a":1}\n{"a":2}\n');
  expect((statSync(join(d, "usage.jsonl")).mode & 0o777).toString(8)).toBe("600");
  run('{"a":3}\n', 5);
  expect(readFileSync(join(d, "usage.1.jsonl"), "utf8")).toBe('{"a":1}\n{"a":2}\n');
  expect(readFileSync(join(d, "usage.jsonl"), "utf8")).toBe('{"a":3}\n');
  // words with quotes and $ go in as they are, never run
  run('{"x":"$(touch pwned)"}\n');
  expect(existsSync(join(d, "pwned"))).toBe(false);
});
