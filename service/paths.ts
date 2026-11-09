// Where Shepherdr keeps its data (core/paths.js; the move: mods/tasks/bin/herdr_task/layout.py): its own folders,
// ~/.local/state/shepherdr/service for the service's own files, ~/.local/share/shepherdr/tasks for herdr-task's lists,
// ~/.config/shepherdr/settings.json, ... once this machine's data moved there, else the old ~/.herdr paths (which
// then link to the new ones). The installer moves the data before it starts the service, so its paths are read once.
// SHEPHERDR_DATA moves only the service's files (tests); it never changes HOME, so herdr-core and herdr-task stay the real ones.
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { mkdirSync, chmodSync, lstatSync, readlinkSync, realpathSync, readFileSync, existsSync } from "node:fs";
import * as P from "../core/paths.js";

export const HOME = homedir();

/** This machine's Shepherdr paths now (core/paths.js paths(): the new ones once its data moved). Read again each time
 *  (cheap): the move can happen while the service runs (herdr-task does it on a machine that got a new copy). */
export function where(home = HOME, env: Record<string, string | undefined> = process.env) {
  const r = P.roots(home, env, process.platform === "darwin");
  let layout = "";
  try { layout = readFileSync(join(r.data, "LAYOUT"), "utf8"); } catch {}
  return P.pathsFrom(home, r, P.isMigrated(layout, existsSync(join(home, P.LEGACY, P.ROLLBACK))));
}
export const DATA = process.env.SHEPHERDR_DATA || where().service;
// The one-copy lock: a second service finds it answering. A socket's path must stay under 104 bytes (macOS; Linux 108):
// with a long home the state folder's is too long, so the first short one of: the state folder, $XDG_RUNTIME_DIR (the
// user's own, made by the system), the old ~/.herdr/shepherdr when it is still a link to the same folder, then
// /tmp/shepherdr-<uid> only when it is this user's own folder (not a link, not someone else's).
const short = (p: string) => Buffer.byteLength(p) < 100;
function mine(dir: string, uid: number): boolean {
  try { const st = lstatSync(dir); return st.isDirectory() && !st.isSymbolicLink() && st.uid === uid && (st.mode & 0o077) === 0; }
  catch { try { mkdirSync(dir, { mode: 0o700 }); const st = lstatSync(dir); return st.isDirectory() && st.uid === uid; } catch { return false; } }
}
export function sockPath(data: string, uid = process.getuid?.() ?? 0, env: Record<string, string | undefined> = process.env, home = HOME): string {
  const own = join(data, "service.sock");
  if (short(own)) return own;
  const run = env.XDG_RUNTIME_DIR?.startsWith("/") ? join(env.XDG_RUNTIME_DIR, "shepherdr-service.sock") : null;
  if (run && short(run)) return run;
  const old = join(home, ".herdr", "shepherdr");
  try { if (short(join(old, "service.sock")) && realpathSync(old) === realpathSync(data)) return join(old, "service.sock"); } catch {}
  const tmp = join("/tmp", `shepherdr-${uid}`);
  return mine(tmp, uid) ? join(tmp, "service.sock") : own;   // none: the long one, and the bind says why
}
export const SOCK = sockPath(DATA);
export const TOKEN = join(DATA, "token");         // local callers (the Herdr window, the CLI) show this
export const LOG = join(DATA, "service.log");
export const PORT = Number(process.env.SHEPHERDR_PORT || 7788);
export const MOUNT = "/shepherdr";                // tailscale serve --set-path; never funnel

// The settings file, ~/.config/shepherdr/settings.json (HERDR_TASK_SETTINGS: a test's own). Read at each use, so a
// test's own file holds whichever module loaded first.
const realSettings = () => where().settings;
export const settingsFile = () => process.env.HERDR_TASK_SETTINGS || realSettings();
/** Running under bun test (test/preload.ts sets SHEPHERDR_TEST; bun sets NODE_ENV=test). */
export const underTest = () => !!process.env.SHEPHERDR_TEST || process.env.NODE_ENV === "test";
/** The settings file to write: a test is refused the real one, so it can never change the person's settings (nor have
 *  the window and herdr-task send them on to their Assistants and other machines). */
export function writableSettings(path = settingsFile()): string {
  if (underTest() && [realSettings(), join(HOME, ".herdr", "shepherdr.json"), paths_new().settings].some((p) => landing(path) === landing(p)))
    throw new Error("A test may not write the real settings file.");
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

// The new layout's paths whether or not this machine moved yet: a test may write neither.
const paths_new = () => P.pathsFrom(HOME, P.roots(HOME, process.env, process.platform === "darwin"), true);

/** A file to write under Herdr's or Shepherdr's homes: a test is refused anything in the person's real
 *  ~/.config/herdr-app, ~/.herdr or Shepherdr's own folders (test/preload.ts points them away), so no import order can
 *  have a test write their data. */
export function writable(path: string): string {
  const r = paths_new().roots;
  if (underTest() && [REAL_APP, REAL_HERDR, r.config, r.data, r.state].some((d) => inside(path, d))) throw new Error(`A test may not write the real ${path}.`);
  return path;
}

export function ensureData() {
  mkdirSync(DATA, { recursive: true, mode: 0o700 });
  chmodSync(DATA, 0o700);
}
