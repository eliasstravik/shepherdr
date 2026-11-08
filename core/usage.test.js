import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clean, lines, sinceDelete, APPEND, CAP, DELETE, DELETED_AT } from "./usage.js";

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

test("Delete on a machine: both files go, and its moment is marked for late batches", () => {
  const home = mkdtempSync(join(tmpdir(), "usage-home-"));
  const d = join(home, ".herdr", "shepherdr");
  Bun.spawnSync(["sh", "-c", APPEND, "usage", d, '{"a":1}\n', String(CAP)]);
  writeFileSync(join(d, "usage.1.jsonl"), "old\n");
  // a throwaway HOME for this shell line only
  Bun.spawnSync(["sh", "-c", DELETE], { env: { HOME: home, PATH: process.env.PATH } });
  expect(existsSync(join(d, "usage.jsonl")) || existsSync(join(d, "usage.1.jsonl"))).toBe(false);
  expect(existsSync(join(d, "usage.deleted"))).toBe(true);
  // its time, as the window reads it before it notes a timed view
  const secs = Number(Bun.spawnSync(["sh", "-c", DELETED_AT, "usage", d]).stdout.toString().trim());
  expect(Math.abs(secs * 1000 - statSync(join(d, "usage.deleted")).mtimeMs)).toBeLessThan(1000);
  expect(Bun.spawnSync(["sh", "-c", DELETED_AT, "usage", join(home, "none")]).stdout.toString()).toBe("");
});

test("after a Delete: older events go, a view across it keeps only its time after it", () => {
  expect(sinceDelete({ kind: "act", at: 900 }, 1000)).toBeNull();
  expect(sinceDelete({ kind: "view", at: 1500, ms: 4000 }, 1000)).toEqual({ kind: "view", at: 1500, ms: 500 });
  expect(sinceDelete({ kind: "view", at: 1500, ms: 200 }, 1000)).toEqual({ kind: "view", at: 1500, ms: 200 });
  expect(sinceDelete({ kind: "view", at: 1500, ms: 4000 }, 0)).toEqual({ kind: "view", at: 1500, ms: 4000 });
});
