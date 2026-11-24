import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setConfig, shortcutsOf } from "./next.ts";

// SHEP-470: Settings › Shortcuts keeps the person's own keys in the settings file, the same for every device: a
// command's id to its keys (empty: none), null back to its default, Reset all, and single letters on or off.
function withFile(d: any, fn: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "shep-470-"));
  const was = process.env.HERDR_TASK_SETTINGS;
  const path = join(dir, "settings.json");
  process.env.HERDR_TASK_SETTINGS = path;
  try {
    writeFileSync(path, JSON.stringify(d));
    fn(path);
  } finally {
    process.env.HERDR_TASK_SETTINGS = was;
    rmSync(dir, { recursive: true, force: true });
  }
}
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("a shortcut changed, removed, put back; reset all; letters off and on", () => {
  withFile({ everywhere: { merge: "checks" } }, (path) => {
    setConfig("all", "shortcut.tasks.open", ["Mod+Shift+Y"]);
    setConfig("all", "shortcut.shortcuts.list", []);
    expect(read(path).everywhere).toEqual({ merge: "checks", shortcuts: { "tasks.open": ["Mod+Shift+Y"], "shortcuts.list": [] } });
    expect(shortcutsOf(read(path))).toEqual({ keys: { "tasks.open": ["Mod+Shift+Y"], "shortcuts.list": [] }, letters: true });
    setConfig("all", "shortcut.tasks.open", null);
    expect(read(path).everywhere.shortcuts).toEqual({ "shortcuts.list": [] });
    setConfig("all", "shortcuts.letters", false);
    expect(shortcutsOf(read(path)).letters).toBe(false);
    setConfig("all", "shortcuts.letters", true);
    expect(read(path).everywhere.shortcut_letters_off).toBeUndefined();
    setConfig("all", "shortcuts.reset", true);
    expect(read(path).everywhere).toEqual({ merge: "checks" });
  });
});

test("only a command's id and a short list of keys are kept", () => {
  withFile({}, () => {
    expect(() => setConfig("all", "shortcut.__proto__.x", ["J"])).toThrow();
    expect(() => setConfig("all", "shortcut.nodot", ["J"])).toThrow();
    expect(() => setConfig("all", "shortcut.tasks.open", "J")).toThrow();
    expect(() => setConfig("all", "shortcut.tasks.open", ["a", "b", "c", "d", "e"])).toThrow();
  });
  // a hand-edited file: what isn't a command or keys is left out
  expect(shortcutsOf({ everywhere: { shortcuts: { "tasks.open": ["G T"], bad: ["J"], "chat.reply": [1] } } })).toEqual({ keys: { "tasks.open": ["G T"] }, letters: true });
  expect(shortcutsOf({})).toEqual({ keys: {}, letters: true });
});
