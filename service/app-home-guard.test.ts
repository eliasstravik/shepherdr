import { expect, test } from "bun:test";
import { mkdtempSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { appHome, underTest, writable } from "./paths.ts";

// SHEP-131: the person's real space log once got a test's fake closes and renames. A test may read whether their files
// are there, never write them.
const realApp = join(homedir(), ".config", "herdr-app");
const realLog = join(realApp, "data", "backups", "space-log.jsonl");

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
