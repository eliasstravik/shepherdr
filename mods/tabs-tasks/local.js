// This machine's Shepherdr service, found and checked before the window talks to it (GitHub #635). The service writes
// where it listens and a fresh id each start into ~/.herdr/shepherdr/service.json (service/main.ts); its health answers
// that id to this machine's callers. So the port is never written in here (SHEPHERDR_PORT, `install --port` move it),
// and another app on that port (the service didn't start) never gets the token or the shared state.
// Shared: the source is lib/local.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/local.js, never a mod's copy, then run bin/sync-shared.

import { home, readTextFile } from "herdr";

const DATA = () => `${home()}/.herdr/shepherdr`;

/** Where the service said it listens, and its id: { port, id }, or null (never started here). */
export async function serviceFile() {
  const f = JSON.parse((await readTextFile(`${DATA()}/service.json`).catch(() => null)) ?? "null");
  return f && Number.isInteger(f.port) && f.port > 0 && typeof f.id === "string" && f.id ? f : null;
}

/** The service's health and the address to call it on, only when it is really Shepherdr's service answering:
 *  { base, health } or null. With cx, gives up after 1.5 s. */
export async function localService(cx) {
  const f = await serviceFile();
  if (!f) return null;
  const base = `http://127.0.0.1:${f.port}`;
  const ask = fetch(`${base}/api/health`).then((r) => (r.ok ? r.json() : null));
  const health = await (cx ? Promise.race([ask, cx.sleep(1500).then(() => null)]) : ask).catch(() => null);
  return health?.id === f.id ? { base, health } : null;
}

/** The token this machine's callers show the service (~/.herdr/shepherdr/token), or null. */
export async function localToken() {
  return (await readTextFile(`${DATA()}/token`).catch(() => null))?.trim() || null;
}
