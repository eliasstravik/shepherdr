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
// The tailnet HTTPS port tailscale serve shares /shepherdr on (default 443). Another one when something else on this
// machine already answers on the tailnet's 443.
export const HTTPS_PORT = Number(process.env.SHEPHERDR_HTTPS_PORT || 443);

/** The tailnet origin the web app is served from: https://<machine>, with the port when it isn't 443. */
export function tailnetOrigin(dns: string, httpsPort = HTTPS_PORT) {
  return httpsPort === 443 ? `https://${dns}` : `https://${dns}:${httpsPort}`;
}

export function ensureData() {
  mkdirSync(DATA, { recursive: true, mode: 0o700 });
  chmodSync(DATA, 0o700);
}
