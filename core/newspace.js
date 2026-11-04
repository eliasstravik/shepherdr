// The New space dialog's words and rules, the same in the window (mods/newspace) and on the web
// (web/plugins/places/add.tsx, service/spaces.ts): its field holds the folder the space is made in, its
// suggestions are that machine's recent folders (at most SHOWN), Browse… lists a folder's subfolders on
// another machine, and a folder outside git is offered "Make it a git repo".
// Plain JS (no herdr or node imports): bin/sync-shared copies it into mods/newspace/core/.

export const WORDS = {
  title: "New space",
  on: (machine) => `on ${machine}`,
  label: "Icon and folder",
  placeholder: "~/path/to/folder",
  browse: "Browse…",
  loading: "Loading…",
  empty: "No folders inside",
  missing: "This folder doesn't exist. It will be created.",
  makeRepo: "Make it a git repo",
  makeRepoWhy: "so each task gets its own worktree",
  isRepo: "A git repo: each task gets its own worktree",
  create: "Create space",
  creating: "Creating…",
  cancel: "Cancel",
  cantList: (dir, machine) => `Couldn't list ${dir}${machine ? ` on ${machine}` : ""}.`,
  cantMake: (dir) => `Couldn't make ${dir}.`,
  cantRepo: (why) => `Couldn't make it a git repo: ${why || "git failed"}`,
};

// The suggestions shown at most.
export const SHOWN = 5;

// A new repo, as Shepherdr's: main, one empty commit, no hooks or signing in the way.
export const NEW_REPO = [["init", "-q", "--initial-branch=main"],
  ["-c", "user.useConfigOnly=false", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "First commit"]];

// A folder's subfolders, hidden ones left out, sorted (sh -c SUBFOLDERS x <dir>).
export const SUBFOLDERS = 'cd "$1" 2>/dev/null || exit 1; for d in */; do [ -d "$d" ] && printf "%s\\n" "${d%/}"; done; true';

// Folders as their repo's top folder (sh -c REPO_TOPS x <paths…>), one per line.
export const REPO_TOPS = 'for d; do [ -d "$d" ] || continue; git -C "$d" rev-parse --show-toplevel 2>/dev/null || echo "$d"; done';

// Builders' scratch folders (under /tmp, a scratchpad): nobody's work, never offered.
export const scratch = (p) => /^\/(private\/)?(var\/)?tmp(\/|$)/.test(p) || /\/scratchpad(\/|$)/.test(p);

// Paths as the dialog shows them: from the machine's home as ~.
export const tilde = (p, home) => (p === home ? "~" : p.startsWith(home + "/") ? "~" + p.slice(home.length) : p);
export const untilde = (p, home) => (p === "~" ? home : p.startsWith("~/") ? home + p.slice(1) : p);
export const base = (p, home) => (p === home ? "Home" : p.split("/").filter(Boolean).pop() ?? p);
export const parent = (p) => p.replace(/\/[^/]+\/?$/, "") || "/";

// The folder a field's text names, or null when it isn't a path (a filter word).
export const pathOf = (text, home) => {
  const f = String(text ?? "").trim();
  return /^[~/]/.test(f) ? untilde(f.length > 1 ? f.replace(/\/+$/, "") : f, home) : null;
};

// The suggestions: `all` (recent folders, Browse…'s picks first) matching what's typed (all of them for
// an empty field or a path), at most SHOWN, the field's own folder left out.
export function suggestions(all, text, home) {
  const word = String(text ?? "").trim().toLowerCase();
  const p = pathOf(text, home);
  return all.filter((f) => f !== p && (!word || tilde(f, home).toLowerCase().includes(word) || base(f, home).toLowerCase().includes(word)))
    .slice(0, SHOWN);
}

// A machine's recent folders from its terminals ({ cwd, at } newest first), before they are made their repo's top:
// no scratch and no task worktree, at most 40 asked.
export function recentCandidates(list) {
  const at = new Map();
  for (const { cwd, at: t } of list) if (cwd && !cwd.includes("/.herdr/worktrees/")) at.set(cwd, Math.max(at.get(cwd) ?? 0, t ?? 0));
  return [...at.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 40);
}

// REPO_TOPS' answer as the recent folders: each once, no task worktree, at most 8.
export function recentFrom(stdout) {
  const out = [];
  for (const p of String(stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (!out.includes(p) && !p.includes("/.herdr/worktrees/")) out.push(p);
    if (out.length >= 8) break;
  }
  return out;
}

// Where the field starts: the folder the person works in (as its recent repo's top when it is in one),
// else home; never a scratch folder.
export function startFolder(at, recent, home) {
  if (!at || scratch(at)) return home;
  return recent.find((r) => at === r || at.startsWith(r + "/")) ?? at;
}

// Whether "Make it a git repo" shows: a folder known not to be in a repo, not home or /.
export const offersRepo = (folder, inRepo, home) => Boolean(folder) && folder !== home && folder !== "/" && inRepo === false;

// What Herdr calls an unnamed space there: "Home" at home, else its repo's top folder, else the folder.
export const placeName = (folder, top, home) => (folder === home ? "Home" : (top || folder).split("/").filter(Boolean).pop() ?? folder);
