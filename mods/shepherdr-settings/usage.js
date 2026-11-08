// Usage insights in the window (the "insights" add-on): note("view", { view: "settings" }) appends one line to
// ~/.herdr/shepherdr/usage.jsonl on this machine, and nothing while the add-on is off. Kinds, ids, counts and times
// only (core/usage.js keeps those and drops the rest). No network call: a local shell append, nothing else.
// Shared: the source is lib/usage.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/usage.js, never a mod's copy, then run bin/sync-shared.
//   note(kind, fields)           one event from the window
//   watchViews(cx)               the shown space and tab, and the time on each (the tab bar's init, once)

import { exec, home, focused, window as win } from "herdr";
import { on } from "./addons.js";
import { lines, APPEND, CAP } from "./core/usage.js";

const dir = () => `${home()}/.herdr/shepherdr`;

export function note(kind, fields = {}) {
  if (!on("insights")) return;
  const text = lines([{ ...fields, kind, from: "window" }]);
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
  if (shown?.key) note("view", { view: "tab", space: shown.space, tab: shown.tab, ms: now - shown.since });
  shown = { key, space: f?.space, tab: f?.tab, since: now };
}

// Every 2 s: a switch of space or tab, or the window left, ends the last one with its time.
export function watchViews(cx) {
  cx.timer.every(2000, () => { try { look(); } catch { /* a reload's old build */ } });
}
