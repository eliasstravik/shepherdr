// A stand-in for herdr-app's "herdr" module in bun tests of window mods. Bun's mock.module is one per process: the
// first test file to import "herdr" fixes its export names, so a later file's stand-in may only change what they do.
// Every test that mocks "herdr" goes through here, so each one has every name the mods import (none is missing).
const NAMES = [
  "agents", "appHome", "closeOverlay", "commands", "exec", "focused", "hc", "home", "keys", "knownAgents", "layout",
  "layouts", "machines", "nextCommand", "notify", "openOverlay", "panes", "pickFolder", "placement", "playSound", "props",
  "readTextFile", "run", "setShared", "settings", "shared", "spaces", "terminals", "theme", "updates", "watchFolder",
  "window", "writeTextFile",
] as const;

export function fakeHerdr(given: Partial<Record<(typeof NAMES)[number], unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const n of NAMES) out[n] = given[n] ?? (() => undefined);
  return out;
}
