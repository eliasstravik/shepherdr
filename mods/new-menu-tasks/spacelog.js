// The space log: every space close or rename our mods perform is one line in
// ~/.config/herdr-app/data/backups/space-log.jsonl = { at, machine, space, name, action, to?, by }.
// Herdr keeps no log of its own, so a space that went can be traced here afterwards (HERD-55).
// A line is written before the command runs: a close the person then cancels in Herdr's confirm
// still shows (as asked for).
// Shared: the source is lib/spacelog.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/spacelog.js, never a mod's copy, then run bin/sync-shared.

import { appHome, exec, spaces } from "herdr";

// action: "close" | "rename"; id: the space (remote ones "vm/sp…"); by: what did it, in words.
export function logSpace(action, id, by, extra = {}) {
  const s = spaces().find((x) => x.id === id);
  const line = JSON.stringify({ at: new Date().toISOString(), machine: s?.machine ?? null, space: id, name: s?.name ?? null, action, ...extra, by });
  exec("sh", ["-c", 'mkdir -p "$1" && printf "%s\\n" "$2" >> "$1/space-log.jsonl"', "spacelog", `${appHome()}/data/backups`, line]).catch(() => {});
}
