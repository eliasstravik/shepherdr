import { expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { settingsFile, underTest, writableSettings } from "./paths.ts";
import { writeSettings } from "./settings.ts";
import { Sync } from "./sync.ts";

// The person's real settings file: a test may read whether it is there, never write it.
const real = join(homedir(), ".herdr", "shepherdr.json");
const stamp = () => (existsSync(real) ? statSync(real).mtimeMs : null);

test("bun test runs with the settings file pointed away from the real one", () => {
  expect(underTest()).toBe(true);
  expect(resolve(settingsFile())).not.toBe(resolve(real));
});

test("a write to the real ~/.herdr/shepherdr.json is refused, and the file stays as it was", () => {
  const before = stamp();
  // checked first: a broken guard stops here, before anything below could write
  expect(() => writableSettings(real)).toThrow("A test may not write");
  expect(writableSettings(join("/tmp", "elsewhere", "shepherdr.json"))).toContain("elsewhere");
  const was = process.env.HERDR_TASK_SETTINGS;
  process.env.HERDR_TASK_SETTINGS = real;
  try {
    expect(() => writeSettings({ everywhere: { fake: true } })).toThrow("A test may not write");
  } finally {
    process.env.HERDR_TASK_SETTINGS = was;
  }
  expect(stamp()).toBe(before);
});

test("the settings sync never writes another machine's files under test", async () => {
  let called = false;
  const hub = { call: async () => { called = true; return { code: 0 }; } };
  const sync: any = new Sync(hub as any, {} as any);
  await expect(sync.write("vm-fake", ".herdr/shepherdr.json", "{}")).rejects.toThrow("A test may not write");
  expect(called).toBe(false);
});
