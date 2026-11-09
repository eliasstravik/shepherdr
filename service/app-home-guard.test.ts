import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
// imported first, as in a whole-suite run where another file loaded it before any test pointed HERDR_APP_HOME away
import { logSpace } from "./actions.ts";
import { appHome, underTest, writable } from "./paths.ts";

// SHEP-131: the person's real space log once got a test's fake closes and renames. A test may read whether their files
// are there, never write them.
const realApp = join(homedir(), ".config", "herdr-app");
const realLog = join(realApp, "data", "backups", "space-log.jsonl");
const stamp = (f: string) => (existsSync(f) ? `${statSync(f).size}:${statSync(f).mtimeMs}` : null);

test("bun test runs with Herdr's app home pointed away from the real one", () => {
  expect(underTest()).toBe(true);
  expect(resolve(appHome())).not.toBe(resolve(realApp));
});

test("a write anywhere in the real app home or ~/.herdr is refused; a throwaway one is fine", () => {
  for (const p of [realLog, realApp, join(realApp, "data", "chat-asks", "ans", "x.json"), join(homedir(), ".herdr", "model-picks.json")])
    expect(() => writable(p)).toThrow("A test may not write");
  const tmp = mkdtempSync(join(tmpdir(), "shep-guard-"));
  expect(writable(join(tmp, "data", "backups", "space-log.jsonl"))).toContain(tmp);
  // a link to the real home is followed, not trusted
  const link = join(tmp, "app");
  symlinkSync(realApp, link);
  expect(() => writable(join(link, "data", "backups", "space-log.jsonl"))).toThrow("A test may not write");
  // a link to where the real home would be, before it exists (GitHub's runner has none)
  const ahead = join(tmp, "ahead");
  symlinkSync(join(realApp, "data", "not-made-yet"), ahead);
  expect(() => writable(join(ahead, "space-log.jsonl"))).toThrow("A test may not write");
});

test("the space log goes where HERDR_APP_HOME says at each call, and never to the real one", () => {
  const before = stamp(realLog);
  // checked first: a broken guard stops here, before the call below could add a line to the real log
  expect(() => writable(realLog)).toThrow("A test may not write");
  const was = process.env.HERDR_APP_HOME;
  const mine = mkdtempSync(join(tmpdir(), "shep-guard-app-"));
  try {
    process.env.HERDR_APP_HOME = mine;
    logSpace("close", "spGuard", "Guard test");
    const line = JSON.parse(readFileSync(join(mine, "data", "backups", "space-log.jsonl"), "utf8").trim());
    expect(line).toMatchObject({ space: "spGuard", name: "Guard test", action: "close" });
    // the old leak: the module kept the real home from import time; now even pointing at it is refused
    process.env.HERDR_APP_HOME = realApp;
    logSpace("close", "spGuard", "Guard test");
    delete process.env.HERDR_APP_HOME;
    logSpace("close", "spGuard", "Guard test");
  } finally {
    process.env.HERDR_APP_HOME = was;
  }
  expect(stamp(realLog)).toBe(before);
});
