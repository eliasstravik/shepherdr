// Where Shepherdr keeps its own data (SHEP-141): its own `shepherdr` folders, never under Herdr's name. The one
// source is mods/tasks/bin/herdr_task/layout.py (the move, healing, rollback); this is its table and its shell for
// the window's mods, the service and the web app. test/test_layout.py checks both say the same.
//   config ~/.config/shepherdr        settings.json, model-picks.json
//   data   ~/.local/share/shepherdr   tasks/, artifacts/, secrets/, worktrees/, tools.json, LAYOUT
//   state  ~/.local/state/shepherdr   service/, browser/, secret-drop/, secret-served/, cli-check.json, machine-hold.json
// SHEPHERDR_HOME=<root> puts them under <root>/{config,data,state,cache}; else XDG_* are honoured. Until a machine's
// data moved (data/LAYOUT says 2) every kind is its old ~/.herdr path; after, the old paths link to the new ones, so
// a reader on either is right on any machine, old or new.
// Shared core: the source is core/paths.js; bin/sync-shared copies it into the mods in lib/COPIES.

export const LAYOUT = 2;
export const LEGACY = ".herdr";
export const ROLLBACK = ".layout-rollback";

// kind: [old path under home, base, new path under base]
export const KINDS = {
  "settings": [".herdr/shepherdr.json", "config", "settings.json"],
  "model-picks": [".herdr/model-picks.json", "config", "model-picks.json"],
  "tasks": [".herdr/tasks", "data", "tasks"],
  "artifacts": [".herdr/artifacts", "data", "artifacts"],
  "vault": [".herdr/vault.json", "data", "secrets/vault.json"],
  "secret-remote": [".herdr/secret-remote", "data", "secrets/remote"],
  "tools": [".herdr/tools.json", "data", "tools.json"],
  "service": [".herdr/shepherdr", "state", "service"],
  "browser": [".herdr/browser", "state", "browser"],
  "secret-drop": [".herdr/secret-drop", "state", "secret-drop"],
  "secret-served": [".herdr/secret-served", "state", "secret-served"],
  "cli-check": [".herdr/cli-check.json", "state", "cli-check.json"],
  "machine-hold": [".herdr/machine-hold.json", "state", "machine-hold.json"],
};

const abs = (p) => (typeof p === "string" && p.startsWith("/") ? p.replace(/\/+$/, "") : null);

/** { config, data, state, cache } for a home and its environment (SHEPHERDR_HOME, then XDG_*, then defaults). */
export function roots(home, env = {}, mac = false) {
  const one = abs(env.SHEPHERDR_HOME);
  if (one) return { config: `${one}/config`, data: `${one}/data`, state: `${one}/state`, cache: `${one}/cache` };
  const x = (v, dflt) => `${abs(env[v]) ?? `${home}/${dflt}`}/shepherdr`;
  return { config: x("XDG_CONFIG_HOME", ".config"), data: x("XDG_DATA_HOME", ".local/share"), state: x("XDG_STATE_HOME", ".local/state"),
           cache: abs(env.XDG_CACHE_HOME) ? `${abs(env.XDG_CACHE_HOME)}/shepherdr` : `${home}/${mac ? "Library/Caches" : ".cache"}/shepherdr` };
}

/** Every kind's path: the new one when `migrated`, else the old one. Plus worktrees (where new ones go).
 *  @returns {ShepPaths} */
export function paths(home, env = {}, migrated = false, mac = false) {
  return pathsFrom(home, roots(home, env, mac), migrated);
}

/**
 * @typedef {{ roots: { config: string, data: string, state: string, cache?: string }, migrated: boolean, settings: string,
 *   "model-picks": string, tasks: string, artifacts: string, vault: string, "secret-remote": string, tools: string,
 *   service: string, browser: string, "secret-drop": string, "secret-served": string, "cli-check": string,
 *   "machine-hold": string, worktrees: string }} ShepPaths
 */

/** The same from roots already known (what SH_PRINT printed on that machine).
 *  @param {string} home @param {{ config: string, data: string, state: string, cache?: string }} r @param {boolean} migrated
 *  @returns {ShepPaths} */
export function pathsFrom(home, r, migrated = false) {
  /** @type {any} */
  const out = { roots: r, migrated };
  for (const [k, [old, base, rel]] of Object.entries(KINDS)) out[k] = migrated ? `${r[base]}/${rel}` : `${home}/${old}`;
  out.worktrees = migrated ? `${r.data}/worktrees` : `${home}/.herdr/worktrees`;
  return out;
}

/** Whether a LAYOUT file's text (and no rollback mark) means the new layout. */
export const isMigrated = (layoutText, rolledBack = false) => !rolledBack && Number(String(layoutText ?? "").trim().split(/\s+/)[0]) >= LAYOUT;

/** A task worktree's path (any machine, any root this or an older Shepherdr made them in): kept out of the lists of
 *  folders people work in. */
export const WORKTREE_RE = /\/(\.herdr|shepherdr)\/worktrees\//;
export const isWorktreePath = (p) => !!p && WORKTREE_RE.test(`${p}/`);

const shVar = (k) => "SHEP_" + k.toUpperCase().replace(/-/g, "_");

// Shell (any machine, old or new, run over herdr-core): sets SHEP_CONFIG, SHEP_DATA, SHEP_STATE and one variable per
// kind (SHEP_TASKS, SHEP_SETTINGS, SHEP_ARTIFACTS, ...), each the new path once that machine's data moved, else its
// old one. Put it first in a `sh -c` script.
export const SH = [
  'if [ -n "${SHEPHERDR_HOME:-}" ]; then SHEP_CONFIG="$SHEPHERDR_HOME/config"; SHEP_DATA="$SHEPHERDR_HOME/data"; '
    + 'SHEP_STATE="$SHEPHERDR_HOME/state"; else SHEP_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/shepherdr"; '
    + 'SHEP_DATA="${XDG_DATA_HOME:-$HOME/.local/share}/shepherdr"; SHEP_STATE="${XDG_STATE_HOME:-$HOME/.local/state}/shepherdr"; fi',
  `if [ "$(cat "$SHEP_DATA/LAYOUT" 2>/dev/null | cut -c1)" = "${LAYOUT}" ] && [ ! -e "$HOME/${LEGACY}/${ROLLBACK}" ]; then`,
  Object.entries(KINDS).map(([k, [, b, rel]]) => `${shVar(k)}="$SHEP_${b.toUpperCase()}/${rel}";`).join(" "),
  "else",
  Object.entries(KINDS).map(([k, [old]]) => `${shVar(k)}="$HOME/${old}";`).join(" "),
  "fi",
].join("\n") + "\n";

// Python (3.8+), for scripts run on another machine (python3 -c): SHEP(".herdr/vault.json") is that path on that
// machine, new or old as it is there. Needs `import os`. The same text as layout.py's PY (test/test_layout.py checks).
const pyTable = "{" + Object.values(KINDS).map(([old, b, rel]) => `'${old}': ('${b}', '${rel}')`).join(", ") + "}";
export const PY = `
def SHEP(rel, _t=${pyTable}):
    H, E = os.path.expanduser("~"), os.environ
    a = lambda v: E.get(v) if (E.get(v) or "").startswith("/") else None
    one = a("SHEPHERDR_HOME")
    R = dict((k, os.path.join(one, k)) for k in ("config", "data", "state")) if one else {
        "config": os.path.join(a("XDG_CONFIG_HOME") or os.path.join(H, ".config"), "shepherdr"),
        "data": os.path.join(a("XDG_DATA_HOME") or os.path.join(H, ".local", "share"), "shepherdr"),
        "state": os.path.join(a("XDG_STATE_HOME") or os.path.join(H, ".local", "state"), "shepherdr")}
    try:
        with open(os.path.join(R["data"], "LAYOUT")) as f:
            on = int((f.read().split() or ["0"])[0]) >= ${LAYOUT} and not os.path.lexists(os.path.join(H, "${LEGACY}", "${ROLLBACK}"))
    except (OSError, ValueError):
        on = False
    if on:
        for old, (base, new) in _t.items():
            if rel == old or rel.startswith(old + "/"):
                return os.path.join(R[base], new + rel[len(old):])
    return os.path.join(H, rel)
`;

/** A script that prints this machine's paths as JSON, for callers with no environment of their own (the window). */
export const SH_PRINT = SH + 'printf \'{"home":"%s","config":"%s","data":"%s","state":"%s","on":%s}\\n\' "$HOME" "$SHEP_CONFIG" "$SHEP_DATA" "$SHEP_STATE" '
  + `"$( [ "$SHEP_TASKS" = "$SHEP_DATA/tasks" ] && echo true || echo false )"`;
