import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "./paths.ts";
import { record, deleteAll } from "./usage.ts";
import * as U from "../core/usage.js";

// DATA is a throwaway folder (test/preload.ts); fake ids only
const log = join(DATA, "usage.jsonl"), old = join(DATA, "usage.1.jsonl");
const read = () => readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("the web app's events are kept without their words; off keeps nothing", async () => {
  await deleteAll([], async () => true);
  expect(record([{ kind: "send", from: "phone", text: "hello there", at: 7 }, { kind: "view", from: "web", view: "task", task: "SHOP-2", ms: 900, at: 8 }], true)).toBe(true);
  expect(read()).toEqual([{ at: 7, kind: "send", from: "phone" }, { at: 8, kind: "view", from: "web", view: "task", task: "SHOP-2", ms: 900 }]);
  expect(record([{ kind: "act", from: "web", type: "accept" }], false)).toBe(false);
  expect(read()).toHaveLength(2);
});

test("a full log becomes the one old file", () => {
  writeFileSync(log, "x".repeat((U as any).CAP + 1));
  record([{ kind: "feature", from: "web", type: "dictation", at: 9 }], true);
  expect(readFileSync(old, "utf8").length).toBe((U as any).CAP + 1);
  expect(read()).toEqual([{ at: 9, kind: "feature", from: "web", type: "dictation" }]);
});

test("Delete removes both files here and asks each other machine to", async () => {
  const calls: string[][] = [];
  const missed = await deleteAll(["vm-a", "vm-b"], async (args) => { calls.push(args); return args[2] === "vm-a"; });
  expect(existsSync(log) || existsSync(old)).toBe(false);
  expect(missed).toEqual(["vm-b"]);
  expect(calls[0]).toEqual(["exec", "--on", "vm-a", "--timeout", "20", "--", "sh", "-c", (U as any).DELETE]);
});
