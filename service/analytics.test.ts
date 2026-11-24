// Personal analytics' service side (SHEP-453): the app's events go to this machine's own record, only ids and
// timings, nothing when it is off; an update is noticed once.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyticsAction, howOf, noteVersion, record } from "./analytics.ts";

let dir = "", old: Record<string, string | undefined> = {};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "analytics-"));
  old = { a: process.env.HERDR_ANALYTICS_DIR, s: process.env.HERDR_TASK_SETTINGS, h: process.env.SHEPHERDR_HOME };
  process.env.HERDR_ANALYTICS_DIR = join(dir, "a");
  process.env.SHEPHERDR_HOME = dir;
  process.env.HERDR_TASK_SETTINGS = join(dir, "settings.json");
});
afterEach(() => {
  for (const [k, v] of [["HERDR_ANALYTICS_DIR", old.a], ["SHEPHERDR_HOME", old.h], ["HERDR_TASK_SETTINGS", old.s]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(dir, { recursive: true, force: true });
});
const lines = () => readdirSync(join(dir, "a")).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readFileSync(join(dir, "a", f), "utf8").trim().split("\n").map((l) => JSON.parse(l)));

test("only allowed fields, never words", () => {
  expect(record("message.sent", { chat: "sp1", how: "dictated", text: "my secret plan" })).toBe(true);
  expect(record("not.an.event", { chat: "sp1" })).toBe(false);
  expect(lines().map(({ t: _t, ...e }) => e)).toEqual([{ e: "message.sent", chat: "sp1", how: "dictated" }]);
  expect(howOf("bubble")).toBe("bubble");
  expect(howOf("anything else")).toBe("typed");
});

test("the page may only add its own few events", async () => {
  await analyticsAction({ do: "event", event: "app.opened", fields: { device: "phone" } }, () => {});
  await analyticsAction({ do: "event", event: "task.done", fields: { task: "X-1" } }, () => {});
  expect(lines().map((e) => e.e)).toEqual(["app.opened"]);
});

test("off records nothing", () => {
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ everywhere: { analytics_off: true } }));
  expect(record("app.opened", { device: "phone" })).toBe(false);
  noteVersion("9.9.9");
  expect(() => readdirSync(join(dir, "a"))).toThrow();
});

test("an update is noticed once", () => {
  noteVersion("1.0.0");
  noteVersion("1.0.0");
  noteVersion("1.0.1");
  expect(lines().map(({ t: _t, ...e }) => e)).toEqual([{ e: "shepherdr.updated", version: "1.0.1" }]);
});
