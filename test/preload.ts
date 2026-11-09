// bun test (bunfig.toml): the service's data (paths.ts DATA) in a throwaway folder before any test imports it, so no
// test writes the real ~/.herdr/shepherdr (ask-ends.json and the rest).
// The settings file too: a throwaway one unless a test names its own, and SHEPHERDR_TEST makes paths.ts refuse every
// write to the real ~/.herdr/shepherdr.json (writableSettings), so no test can change the person's settings or have
// them sent on to their Assistants and other machines.
// Herdr's app home too (HERDR_APP_HOME): a throwaway one unless a test names its own, so a module imported before a
// test points it elsewhere still lands in a throwaway (SHEP-131), and paths.ts writable() refuses the real one anyway.
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

process.env.SHEPHERDR_TEST = "1";
process.env.SHEPHERDR_DATA ||= mkdtempSync(join(tmpdir(), "shep-data-"));
const real = resolve(join(homedir(), ".herdr", "shepherdr.json"));
const named = process.env.HERDR_TASK_SETTINGS;
if (!named || resolve(named) === real) process.env.HERDR_TASK_SETTINGS = join(mkdtempSync(join(tmpdir(), "shep-settings-")), "shepherdr.json");
const realApp = resolve(join(homedir(), ".config", "herdr-app"));
const app = process.env.HERDR_APP_HOME;
if (!app || resolve(app) === realApp) process.env.HERDR_APP_HOME = mkdtempSync(join(tmpdir(), "shep-app-"));
