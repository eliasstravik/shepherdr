// A stand-in for herdr-app's "herdr" module in bun tests of window mods. Bun's mock.module is one per process: the
// first test file to import "herdr" fixes its export names, so a later file's stand-in may only change what they do.
// Every test that mocks "herdr" goes through here, so each one has every name the mods import (none is missing).
const NAMES = [
  "agents", "appHome", "closeOverlay", "commands", "exec", "focused", "hc", "home", "keys", "knownAgents", "layout",
  "layouts", "machines", "nextCommand", "notify", "openOverlay", "panes", "pickFolder", "placement", "playSound", "props",
  "readTextFile", "run", "setShared", "settings", "shared", "spaces", "terminals", "theme", "updates", "watchFolder",
  "window", "writeTextFile",
] as const;

// A mod's module may keep a name's function itself (lib/live.js's once(spaces)), so it would keep the first file's
// stand-in for the whole run: each name is one function for the run that calls the latest file's.
const latest: Record<string, unknown> = {};
const calls: Record<string, (...a: unknown[]) => unknown> = {};

export function fakeHerdr(given: Partial<Record<(typeof NAMES)[number], unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const n of NAMES) {
    latest[n] = given[n] ?? (() => undefined);
    calls[n] ??= function (this: unknown, ...a: unknown[]) {
      const f = latest[n];
      return typeof f === "function" ? f.apply(this, a) : f;
    };
    out[n] = typeof latest[n] === "function" ? calls[n] : latest[n];
  }
  return out;
}
