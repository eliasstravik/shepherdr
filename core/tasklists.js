// Every folder's task list in a machine's ~/.herdr/tasks, as the Tasks and Jump panels read them.
// Shared core: the source is core/tasklists.js (the window's mods, the service and the web app all use it);
// bin/sync-shared copies it into each mod in lib/COPIES. Edit core/tasklists.js, never a copy, then run bin/sync-shared.
//
// The rule (herdr-task's is_task_list in mods/tasks/bin/herdr_task/store.py; keep them equal): a
// file there is a task list only when it's a JSON object with a string "folder" and a list
// "tasks". Everything else (herdr-task's own .news.json, .seen.json, .newslog.json, ...; some are
// lists) is skipped. A folder under a hidden one has a dot slug (~/.config/x: .config-x.json), so
// file names can't tell them apart.

// Prints each file's name on a line, then the file, then a line of its own between files (output
// stops at a NUL, so not that). Run with exec("sh", ["-c", READ_LISTS], { on }).
import { SH } from "./paths.js";
export const READ_LISTS = SH + 'cd "$SHEP_TASKS" 2>/dev/null || exit 0; for f in *.json .*.json; do [ -f "$f" ] && printf "%s\\n" "$f" && cat "$f" && printf "\\n@@herdr-task-list@@\\n"; done; true';

export const isTaskList = (d) => !!d && typeof d === "object" && !Array.isArray(d) && typeof d.folder === "string" && Array.isArray(d.tasks);

// One of READ_LISTS's files by its name (".autopilot.json": that machine's Autopilot), parsed; null when it isn't there.
export function fileIn(stdout, name) {
  for (const x of (stdout ?? "").split("\n@@herdr-task-list@@\n")) {
    const nl = x.indexOf("\n");
    if (x.slice(0, nl) !== name) continue;
    try { return JSON.parse(x.slice(nl + 1)); } catch { return null; }
  }
  return null;
}

// READ_LISTS's output -> [{ slug, ...list }], task lists only.
export function taskLists(stdout) {
  const out = [];
  for (const x of (stdout ?? "").split("\n@@herdr-task-list@@\n")) {
    if (!x.trim()) continue;
    const nl = x.indexOf("\n");
    let d = null;
    try { d = JSON.parse(x.slice(nl + 1)); } catch {}
    const slug = x.slice(0, nl).replace(/\.json$/, "");
    if (slug && isTaskList(d)) out.push({ slug, ...d });
  }
  return out;
}
