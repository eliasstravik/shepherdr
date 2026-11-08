import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "./paths.ts";
import { record, deleteAll } from "./usage.ts";
import * as U from "../core/usage.js";

// DATA is a throwaway folder (test/preload.ts); fake ids only
const log = join(DATA, "usage.jsonl"), old = join(DATA, "usage.1.jsonl");
const T = Date.now() + 1000; // after any Delete below
const read = () => readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("the web app's events are kept without their words; off keeps nothing", async () => {
  await deleteAll([], async () => true);
  expect(record([{ kind: "send", from: "phone", text: "hello there", at: T }, { kind: "view", from: "web", view: "task", task: "SHOP-2", ms: 900, at: T + 1 }], true)).toBe(true);
  expect(read()).toEqual([{ at: T, kind: "send", from: "phone" }, { at: T + 1, kind: "view", from: "web", view: "task", task: "SHOP-2", ms: 900 }]);
  expect(record([{ kind: "act", from: "web", type: "accept" }], false)).toBe(false);
  expect(read()).toHaveLength(2);
});

test("a full log becomes the one old file", () => {
  writeFileSync(log, "x".repeat((U as any).CAP + 1));
  record([{ kind: "feature", from: "web", type: "dictation", at: T + 2 }], true);
  expect(readFileSync(old, "utf8").length).toBe((U as any).CAP + 1);
  expect(read()).toEqual([{ at: T + 2, kind: "feature", from: "web", type: "dictation" }]);
});

test("Delete removes both files here and asks each other machine to", async () => {
  const calls: string[][] = [];
  const missed = await deleteAll(["vm-a", "vm-b"], async (args) => { calls.push(args); return args[2] === "vm-a"; });
  expect(existsSync(log) || existsSync(old)).toBe(false);
  expect(missed).toEqual(["vm-b"]);
  expect(calls[0]).toEqual(["exec", "--on", "vm-a", "--timeout", "20", "--", "sh", "-c", (U as any).DELETE]);
});

test("a batch still on its way after Delete doesn't bring older events back", async () => {
  await deleteAll([], async () => true);
  const after = Date.now() + 1;
  record([{ kind: "view", from: "web", view: "place", at: after - 60_000 }, { kind: "view", from: "web", view: "task", at: after }], true);
  expect(read()).toEqual([{ at: after, kind: "view", from: "web", view: "task" }]);
});

test("a view that began before Delete keeps only its time after it", async () => {
  await deleteAll([], async () => true);
  const now = Date.now() + 5000;
  record([{ kind: "view", from: "web", view: "place", at: now, ms: 3_600_000 }], true);
  const [e] = read();
  expect(e.ms).toBeLessThanOrEqual(5100);
  expect(e.ms).toBeGreaterThan(4000);
});
