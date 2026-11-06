// Shepherdr's always-on service (3.1, service/main.ts): while it runs, it does the background work that doesn't hang on
// what this window shows (the task tick, serving secrets to other machines), so the window leaves that to it: one runs
// it at a time. Gone (stopped, not installed), the window does it again, as in 3.0, and starts the service once a
// minute at most. The service's health says whether it took the work over (jobs).
// Shared: the source is lib/service.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/service.js, never a mod's copy, then run bin/sync-shared.

import { exec } from "herdr";
import { localService } from "./local.js";

let runs = false, started = false, startedAt = 0;

// The service does the background work now.
export const serviceRuns = () => runs;

async function check(cx) {
  // only Shepherdr's own service counts (local.js): another app on its port is "not answering"
  const r = (await localService(cx).catch(() => null))?.health ?? null;
  runs = r?.jobs === true;
  // Not answering: start it (its systemd user unit or launchd agent), at most once a minute.
  if (!r && Date.now() - startedAt > 60000) {
    startedAt = Date.now();
    exec("sh", ["-c", 'systemctl --user start shepherdr.service 2>/dev/null || launchctl kickstart "gui/$(id -u)/dev.shepherdr.service" 2>/dev/null; true']).catch(() => {});
  }
}

// From the always-loaded tab bar's init: looks now and every 10 s.
export function watchService(cx) {
  if (started) return;
  started = true;
  cx.spawn(async (cx) => check(cx));
  cx.timer.every(10000, (cx) => cx.spawn(async (cx) => check(cx)));
}
