import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// a throwaway settings file
const file = join(mkdtempSync(join(tmpdir(), "shep-plugins-")), "shepherdr.json");
writeFileSync(file, JSON.stringify({ everywhere: { plugins_off: ["voice"] } }));
process.env.HERDR_TASK_SETTINGS = file;
const { offPlugins, setConfig } = await import("./next.ts");

test("a plugin that is off by default stays off until switched on, and off again when switched off", () => {
  expect(offPlugins().sort()).toEqual(["files", "voice"]);
  setConfig("all", "plugin.files", true);
  expect(offPlugins()).toEqual(["voice"]);
  expect(JSON.parse(readFileSync(file, "utf8")).everywhere).toEqual({ plugins_off: ["voice"], plugins_on: ["files"] });
  setConfig("all", "plugin.files", false);
  setConfig("all", "plugin.voice", true);
  expect(offPlugins()).toEqual(["files"]);
  expect(JSON.parse(readFileSync(file, "utf8")).everywhere).toEqual({ plugins_off: ["files"] });
  // a plugin on by default never lands in plugins_on
  setConfig("all", "plugin.voice", true);
  expect(JSON.parse(readFileSync(file, "utf8")).everywhere.plugins_on).toBeUndefined();
});
