// Usage insights in the window (the "insights" add-on): note("view", { view: "settings" }) appends one line to
// usage.jsonl in the service's folder on this machine (~/.local/state/shepherdr/service), and nothing while the add-on is off. Kinds, ids, counts and times
// only (core/usage.js keeps those and drops the rest). No network call: a local shell append, nothing else.
// Shared: the source is lib/usage.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/usage.js, never a mod's copy, then run bin/sync-shared.
//   note(kind, fields)           one event from the window
//   watchViews(cx)               the shown space and tab, and the time on each (the tab bar's init, once)

import { exec, home, focused, shared, window as win } from "herdr";
import { on } from "./addons.js";
import { lines, sinceDelete, APPEND, DELETED_AT, CAP } from "./core/usage.js";
import { dirs } from "./dirs.js";

const dir = () => dirs().service;

export function note(kind, fields = {}) {
  if (!on("insights")) return;
  const e = { ...fields, kind, from: "window", at: Date.now() };
  if (typeof e.ms !== "number") return append(e);
  // a timed view: a Delete since it began (from anywhere: Settings, an agent, another machine's) leaves only the time
  // after it (usage.deleted's time)
  exec("sh", ["-c", DELETED_AT, "usage", dir()])
    .then((r) => append(sinceDelete(e, (Number(String(r?.stdout ?? "").trim()) || 0) * 1000)))
    .catch(() => append(e));
}

function append(e) {
  const text = e ? lines([e]) : "";
  if (text) exec("sh", ["-c", APPEND, "usage", dir(), text, String(CAP)]).catch(() => {});
}

// What is shown while the window is the active one ("" when it isn't), and since when.
let shown = null;
function look() {
  // off: no view is timed, so turning it on again starts from then
  const f = on("insights") && win()?.active ? focused() : null;
  const key = f ? `${f.space}\t${f.tab}` : "";
  if (shown?.key === key) return;
  const now = Date.now();
  // a Delete since it began (Settings, here or on the web: shared "usage.deletedAt"): only the time after it counts
  const since = Math.max(shown?.since ?? 0, Number(shared("usage.deletedAt")) || 0);
  if (shown?.key) note("view", { view: "tab", space: shown.space, tab: shown.tab, ms: Math.max(0, now - since) });
  shown = { key, space: f?.space, tab: f?.tab, since: now };
}

// Every 2 s: a switch of space or tab, or the window left, ends the last one with its time.
export function watchViews(cx) {
  cx.timer.every(2000, () => { try { look(); } catch { /* a reload's old build */ } });
}
