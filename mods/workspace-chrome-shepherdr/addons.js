// Add-ons (Shepherdr 3.0.0, everything is a plugin): each feature can be switched off in Shepherdr
// settings > Window. lib/addons.json names each one, what it is made of and what it needs; an
// add-on without "switch" is always on. The off list lives in two places that say the same:
// shared "addons.off" (what the window's mods read, so a flip shows at once) and "everywhere.off"
// in ~/.config/shepherdr/settings.json (written by the settings window, pushed to other machines with the
// rest of Everywhere; herdr-task reads it for its background work: autopilot, browsers, the sync
// to other machines).
// Shared: the source is lib/addons.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/addons.js, never a mod's copy, then run bin/sync-shared.
//   on("voice")                  false only when the person switched it off
//   await manifest()             lib/addons.json, as installed (appHome()/lib)
//   flip("voice", false)         the new off list, already in shared state: save it as "off"

import { shared, setShared, appHome, readTextFile } from "herdr";

export const off = () => (Array.isArray(shared("addons.off")) ? shared("addons.off") : []);

export const on = (id) => !off().includes(id);

let cached = null;
export function manifest() {
  cached ??= readTextFile(`${appHome()}/lib/addons.json`).then((s) => JSON.parse(s ?? "null")).catch(() => null);
  return cached;
}

// What stops a flip: turning `id` on needs its needs on first; turning it off waits until the on
// add-ons that need it are off. The ids in the way, [] when none.
export function blockers(m, id, next) {
  const all = m?.addons ?? [];
  if (next) return (all.find((a) => a.id === id)?.needs ?? []).filter((n) => !on(n));
  return all.filter((a) => on(a.id) && (a.needs ?? []).includes(id)).map((a) => a.id);
}

export function flip(id, next) {
  const list = next ? off().filter((x) => x !== id) : [...new Set([...off(), id])];
  setShared("addons.off", list);
  return list;
}
