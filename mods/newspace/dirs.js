// Where Shepherdr keeps its data on this computer, for the window's mods (core/paths.js; the move:
// mods/tasks/bin/herdr_task/layout.py): ~/.local/share/shepherdr/tasks, ~/.config/shepherdr/settings.json, ... once
// this computer's data moved there, else the old ~/.herdr paths. A mod has no environment of its own, so the first use
// asks a shell once (SHEPHERDR_HOME, XDG_*, the LAYOUT file); until it answers, dirs() gives the old paths, which link
// to the new ones once moved, so a read is right either way.
//   dirs().tasks, dirs().settings, dirs().artifacts, ...     now (sync)
//   await dirsReady()                                          the answer, then dirs() is exact
// On another machine: put SH (core/paths.js) first in the script and use $SHEP_TASKS, $SHEP_SETTINGS, ...
// Shared: the source is lib/dirs.js; bin/sync-shared copies it into each mod in lib/COPIES.

import { home, exec } from "herdr";
import { pathsFrom, SH_PRINT } from "./core/paths.js";

let known = null;
let asking = null;
let at = 0;

const fallback = () => {
  const h = home();
  return pathsFrom(h, { config: `${h}/.config/shepherdr`, data: `${h}/.local/share/shepherdr`, state: `${h}/.local/state/shepherdr` }, false);
};

/** Asks this computer's shell once (again after `again`, e.g. once the data moved). */
export function dirsReady(again = false) {
  if (again) asking = null;
  asking ??= exec("sh", ["-c", SH_PRINT]).then((r) => {
    const j = JSON.parse(String(r?.stdout ?? "").trim().split("\n").pop() || "null");
    at = Date.now();
    if (j?.home && j.data) known = pathsFrom(j.home, { config: j.config, data: j.data, state: j.state }, !!j.on);
    return dirs();
  }).catch(() => dirs());
  return asking;
}

dirsReady();   // asked at once, so the window's first writes already go to the exact place

/** This computer's paths now: exact once dirsReady() answered, else the old ones (which still lead there). */
export function dirs() {
  if (!known && !asking) dirsReady();
  // asked again every 10 s, so a move (or a rollback) while the window runs is followed; until then the old paths
  // lead to the same data, and what it wrote at the new ones just after a rollback is taken back (layout.heal_back)
  else if (known && Date.now() - at > 10_000) { at = Date.now(); dirsReady(true); }
  return known ?? fallback();
}
