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

// ---- the window's panels (#1175) ----------------------------------------------------------------------------------
// Herdr caps an exec's output at 8 MiB and the window's script runtime stops ("interrupted") on a big string: a busy
// machine's lists (hundreds of archived tasks, each with its whole prompt) left the Tasks panel empty with no word.
// The panels read with READ_PANEL instead: each list on its own, written compact, without what they never show (a
// task's prompt, details, reviews, AGENTS.md notes; any other text cut at SLIM_CUT), and only the lists that changed
// since the last read (the others come back as "=", kept from before). Without python3 there it is READ_LISTS.
// exec("sh", ["-c", READ_PANEL, ...panelArgs(files)], { on }); panelLists(stdout, files) -> { lists, files, warn }.
const SLIM_DROP = ["prompt", "details", "agents_md", "brief_review", "pr_note", "reviews"];
export const SLIM_CUT = 1000;
export const PANEL_WARN = 4 * 1024 * 1024;   // well under Herdr's 8 MiB, where the window's runtime may give up
const PANEL_PY = `import json, os, stat, sys
known = dict(a.split("\\t", 1) for a in sys.argv[1:] if "\\t" in a)
drop, cut = set(${JSON.stringify(SLIM_DROP)}), ${SLIM_CUT}
def slim(t):
    if not isinstance(t, dict):
        return t
    o = {k: v for k, v in t.items() if k not in drop}
    for k, v in o.items():
        if isinstance(v, str) and len(v) > cut:
            o[k] = v[:cut] + "\\u2026"
    return o
out = sys.stdout.buffer
for n in sorted(os.listdir(".")):
    if not n.endswith(".json"):
        continue
    try:
        st = os.stat(n)
        if not stat.S_ISREG(st.st_mode):
            continue
        stamp = "%d:%d" % (st.st_size, st.st_mtime_ns)
        if known.get(n) == stamp:
            body = "="
        else:
            with open(n, "rb") as f:
                d = json.loads(f.read().decode("utf-8"))
            if isinstance(d, dict) and isinstance(d.get("folder"), str) and isinstance(d.get("tasks"), list):
                d = dict(d, tasks=[slim(t) for t in d["tasks"]])
            body = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
    except (OSError, ValueError):
        continue
    out.write((n + "\\t" + stamp + "\\n" + body + "\\n@@herdr-task-list@@\\n").encode("utf-8", "replace"))
`;
export const READ_PANEL = SH + 'cd "$SHEP_TASKS" 2>/dev/null || exit 0; p=$1; shift; if command -v python3 >/dev/null 2>&1; then exec python3 -c "$p" "$@"; fi; for f in *.json .*.json; do [ -f "$f" ] && printf "%s\\n" "$f" && cat "$f" && printf "\\n@@herdr-task-list@@\\n"; done; true';

// READ_PANEL's arguments: its script, then each file read before with its stamp (sent again only once it changed).
export const panelArgs = (files) => ["sh", PANEL_PY, ...[...(files ?? new Map())].filter(([, f]) => f.stamp).map(([n, f]) => `${n}\t${f.stamp}`)];

// READ_PANEL's output -> { lists: [{ slug, ...list }] (task lists only), files: Map name -> { stamp, data } (keep it
// for the next read), warn: words when the read came near what Herdr passes back, else null }.
export function panelLists(stdout, files = new Map()) {
  const next = new Map();
  for (const x of (stdout ?? "").split("\n@@herdr-task-list@@\n")) {
    if (!x.trim()) continue;
    const nl = x.indexOf("\n");
    if (nl < 0) continue;
    const [name, stamp] = x.slice(0, nl).split("\t");
    const body = x.slice(nl + 1);
    let data = null;
    if (body === "=") {
      if (!files.has(name)) continue;
      data = files.get(name).data;
    } else {
      try { data = JSON.parse(body); } catch {}
    }
    next.set(name, { stamp: stamp ?? "", data });
  }
  const lists = [];
  for (const [name, f] of next) {
    const slug = name.replace(/\.json$/, "");
    if (slug && isTaskList(f.data)) lists.push({ slug, ...f.data });
  }
  const size = (stdout ?? "").length;
  const warn = size > PANEL_WARN
    ? `The task lists here are very big (${(size / 1048576).toFixed(1)} MB read): some may not show. Remove tasks you no longer need.`
    : null;
  return { lists, files: next, warn };
}
