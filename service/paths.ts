// Where the service keeps its own files: ~/.herdr/shepherdr (next to herdr-task's ~/.herdr/tasks).
// SHEPHERDR_DATA moves only these (tests); it never changes HOME, so herdr-core and herdr-task stay the real ones.
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, chmodSync } from "node:fs";

export const HOME = homedir();
export const DATA = process.env.SHEPHERDR_DATA || join(HOME, ".herdr", "shepherdr");
export const SOCK = join(DATA, "service.sock");   // the one-copy lock: a second service finds it answering
export const TOKEN = join(DATA, "token");         // local callers (the Herdr window, the CLI) show this
export const LOG = join(DATA, "service.log");
export const PORT = Number(process.env.SHEPHERDR_PORT || 7788);
export const MOUNT = "/shepherdr";                // tailscale serve --set-path; never funnel

export function ensureData() {
  mkdirSync(DATA, { recursive: true, mode: 0o700 });
  chmodSync(DATA, 0o700);
}
