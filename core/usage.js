// Usage insights (the "insights" add-on, docs/insights.md): what the person does on screen, one JSON line per event,
// kept only on their own machine in ~/.local/state/shepherdr/service/usage.jsonl, so their own agents can suggest better ways to
// work when the person asks. Private: nothing here or in its writers makes a network call; the data never leaves the
// machine unless the person's own agent reads it over their own machines' link.
// Only what Shepherdr keeps nowhere else is written here: views opened and the time on them, space and tab switches,
// clicks on main controls, features used, errors shown. Tasks, messages, asks and Autopilot wakes are read where
// they already live (the insights skill, templates/insights.md, says where).
// Never words: kinds, ids, counts and times only. clean() keeps the fields below and drops everything else, so a
// caller can't put a message's words in by mistake.
// Shared core: the source is core/usage.js; bin/sync-shared copies it into the mods in lib/COPIES. The window writes
// with lib/usage.js, the service with service/usage.ts (the web app's events go through it).

import { SH } from "./paths.js";
export const FILE = "usage.jsonl";
// One older file is kept when the log passes CAP bytes: at most about 2 × CAP on disk.
export const OLD = "usage.1.jsonl";
// Touched by every Delete (here, the window's, another machine's): the service drops a late batch's events older
// than it, so nothing deleted comes back.
export const DELETED = "usage.deleted";
export const CAP = 2_000_000;

// What happened.
// ask: an agent's question or permission closed, with how long it waited (the service, service/asks.ts).
export const KINDS = ["view", "act", "send", "feature", "error", "ask"];
// Where the person was: the web app on a wide screen or a phone, the Herdr window, a voice call, the agent's own
// terminal (an ask answered there). Optional: an ask answered in a chat doesn't know which.
export const SURFACES = ["web", "phone", "window", "voice", "terminal"];

// An id, a kind or a key: letters, digits and the marks ids use. Anything else (words, paths with spaces) is dropped.
const ID = /^[\w.:@#/+=-]{1,120}$/;
const id = (v) => (typeof v === "string" && ID.test(v) ? v : undefined);
const count = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : undefined);

// The fields an event may have, and how each is checked.
export const FIELDS = {
  view: id,      // what was shown: place, task, settings, artifact, search, jump, tab (the window's)
  space: id,     // a space's or place's id
  task: id,      // a task's id or key
  tab: id,       // a tab's id (the window) or a task's tab (the web: chat, files, changes, browser)
  artifact: id,  // an artifact's id
  section: id,   // a settings page's id
  type: id,      // an action's, a feature's or an ask's kind (accept, dictation, voice-call, Plan)
  key: id,       // a setting's key (never its value)
  ms: (v) => count(v, 86_400_000),  // how long it lasted
  n: (v) => count(v, 100_000),       // how many (files sent with a message)
  status: (v) => count(v, 999),      // an HTTP status an error came back with
};

/** The event as it may be kept, with its time; null when it isn't one (an unknown kind or surface). */
export function clean(e, at = Date.now()) {
  if (!e || typeof e !== "object" || !KINDS.includes(e.kind) || (e.from !== undefined && !SURFACES.includes(e.from))) return null;
  const out = { at: Number.isInteger(e.at) && e.at > 0 && e.at <= at + 60_000 ? e.at : at, kind: e.kind };
  if (e.from) out.from = e.from;
  for (const [k, check] of Object.entries(FIELDS)) {
    const v = check(e[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** An event as it stands after a Delete at `cut` (ms; 0: none): one from before it is gone (null), a view that began
 *  before it keeps only its time after it. */
export function sinceDelete(e, cut) {
  if (!cut || !e || typeof e.at !== "number") return e;
  if (e.at < cut) return null;
  return typeof e.ms === "number" && e.at - e.ms < cut ? { ...e, ms: Math.max(0, Math.round(e.at - cut)) } : e;
}

// The shell line that prints the last Delete's time in seconds ($1 the folder; nothing when there was none), on
// Linux and macOS.
export const DELETED_AT = 'f="$1/usage.deleted"; [ -f "$f" ] && { stat -c %Y "$f" 2>/dev/null || stat -f %m "$f"; }; true';

/** The events as lines to append (each ends with a new line); "" when none is kept. */
export function lines(events, at = Date.now()) {
  return (Array.isArray(events) ? events : []).slice(0, 500).map((e) => clean(e, at)).filter(Boolean)
    .map((e) => `${JSON.stringify(e)}\n`).join("");
}

// The shell lines that append: $1 the folder, $2 the lines, $3 CAP. The log passing CAP becomes the one old file.
export const APPEND = 'd="$1"; mkdir -p "$d" && chmod 700 "$d"; f="$d/usage.jsonl"; '
  + '[ -f "$f" ] && [ "$(wc -c < "$f")" -gt "$3" ] && mv -f "$f" "$d/usage.1.jsonl"; printf %s "$2" >> "$f"; chmod 600 "$f"';

// The shell line that deletes it all on a machine (Settings' Delete, and an agent asked to), and marks when.
export const DELETE = SH + 'd="$SHEP_SERVICE"; rm -f "$d/usage.jsonl" "$d/usage.1.jsonl"; mkdir -p "$d" && touch "$d/usage.deleted"';
