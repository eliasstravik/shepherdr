// Where the service keeps its own files: ~/.herdr/shepherdr (next to herdr-task's ~/.herdr/tasks).
// SHEPHERDR_DATA moves only these (tests); it never changes HOME, so herdr-core and herdr-task stay the real ones.
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { mkdirSync, chmodSync, lstatSync, readlinkSync, realpathSync } from "node:fs";

export const HOME = homedir();
export const DATA = process.env.SHEPHERDR_DATA || join(HOME, ".herdr", "shepherdr");
export const SOCK = join(DATA, "service.sock");   // the one-copy lock: a second service finds it answering
export const TOKEN = join(DATA, "token");         // local callers (the Herdr window, the CLI) show this
export const LOG = join(DATA, "service.log");
export const PORT = Number(process.env.SHEPHERDR_PORT || 7788);
export const MOUNT = "/shepherdr";                // tailscale serve --set-path; never funnel

// herdr-task's settings file, ~/.herdr/shepherdr.json (HERDR_TASK_SETTINGS: a test's own). Read at each use, so a
// test's own file holds whichever module loaded first.
const REAL_SETTINGS = join(HOME, ".herdr", "shepherdr.json");
export const settingsFile = () => process.env.HERDR_TASK_SETTINGS || REAL_SETTINGS;
/** Running under bun test (test/preload.ts sets SHEPHERDR_TEST; bun sets NODE_ENV=test). */
export const underTest = () => !!process.env.SHEPHERDR_TEST || process.env.NODE_ENV === "test";
/** The settings file to write: a test is refused the real one, so it can never change the person's settings (nor have
 *  the window and herdr-task send them on to their Assistants and other machines). */
export function writableSettings(path = settingsFile()): string {
  if (underTest() && resolve(path) === resolve(REAL_SETTINGS)) throw new Error("A test may not write the real ~/.herdr/shepherdr.json.");
  return path;
}

// Herdr's app home, ~/.config/herdr-app (HERDR_APP_HOME: a test's own). Read at each use, never kept from import: a
// module a test imports before it points HERDR_APP_HOME away would otherwise write the person's real one (SHEP-131:
// the space log got a test's fake closes and renames that way).
const REAL_APP = join(HOME, ".config", "herdr-app");
const REAL_HERDR = join(HOME, ".herdr");
export const appHome = () => process.env.HERDR_APP_HOME || REAL_APP;

/** A path with its symlinks followed as far as it exists (the rest kept as written), so a link can't hide where it
 *  lands, even one to a folder not made yet (a write through it would make it). */
function landing(path: string, hops = 0): string {
  let p = resolve(path), rest = "";
  for (;;) {
    try { return join(realpathSync(p), rest); } catch {}
    try {
      if (hops < 40 && lstatSync(p).isSymbolicLink()) return landing(join(resolve(dirname(p), readlinkSync(p)), rest), hops + 1);
    } catch {}
    const up = dirname(p);
    if (up === p) return resolve(path);
    rest = join(p.slice(up.length).replace(/^\//, ""), rest);
    p = up;
  }
}
const inside = (path: string, dir: string) => {
  const r = relative(landing(dir), landing(path));
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

/** A file to write under Herdr's homes: a test is refused anything in the person's real ~/.config/herdr-app or
 *  ~/.herdr (test/preload.ts points both away), so no import order can have a test write their data. */
export function writable(path: string): string {
  if (underTest() && (inside(path, REAL_APP) || inside(path, REAL_HERDR))) throw new Error(`A test may not write the real ${path}.`);
  return path;
}

export function ensureData() {
  mkdirSync(DATA, { recursive: true, mode: 0o700 });
  chmodSync(DATA, 0o700);
}
