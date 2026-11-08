// Shepherdr 3.1: the person's own shared choices (pinned tasks, the sidebar's sections, icons and Pinned, Notify) live
// in the service's shared document ("shepherdr", herdr-core), so the web app and the window show the same. This keeps
// the window's shared keys and that document in step every 3 s: a change made here goes to the document, one made on
// the web comes here, and the mods go on reading and writing their shared keys as before. The first time, the
// window's own values fill the document. Without the service (not running, not installed) nothing happens.
// Shared: the source is lib/bridge.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/bridge.js, never a mod's copy, then run bin/sync-shared.

import { shared, setShared } from "herdr";
import { localService, localToken } from "./local.js";

// the person's pins, sidebar and Notify; the Window page's switches and the add-ons switched off (Settings › Window);
// Usage insights' last Delete (lib/usage.js: a view open then counts from it)
export const KEYS = ["tasks.pinned", "spaces-chat", "notify", "addons.off", "tabbar.tabs", "sidebar.worktrees", "sidebar.unread", "counts.red",
  "counts.green", "tasks.filters", "tasks.place", "chat.helpers", "coordinator.auto", "usage.deletedAt"];
// the same value whatever order its keys are in (herdr-core keeps a document's keys sorted, a mod writes its own order;
// another machine's words come back in another): never a change by itself
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
let started = false, token = null;
// What each key last was on both sides (in step), so a change knows where it came from.
const last = new Map();

async function sync(cx) {
  token ??= await localToken();
  if (!token) return;
  // the service's port, and that it is really Shepherdr's service there, before the token or the state go out
  const svc = await localService(cx);
  if (!svc) return;
  const STATE = `${svc.base}/api/state`;
  const auth = { authorization: `Bearer ${token}` };
  const got = await Promise.race([fetch(STATE, { headers: auth }).then((r) => (r.ok ? r.json() : null)), cx.sleep(1500).then(() => null)]).catch(() => null);
  if (!got) return;
  const doc = got.value ?? {};
  for (const k of KEYS) {
    const here = shared(k), there = doc[k], was = last.get(k);
    if (same(here, there)) { last.set(k, here); continue; }
    // changed here (or the document doesn't have it yet): the document takes it; else it came from the web
    if (!last.has(k) ? there === undefined : !same(here, was)) {
      if (here === undefined) continue;
      const r = await fetch(STATE, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ key: k, value: here }) }).catch(() => null);
      if (r?.ok) last.set(k, here);
    } else {
      setShared(k, there);
      last.set(k, there);
    }
  }
}

// From the always-loaded tab bar's init.
export function startBridge(cx) {
  if (started) return;
  started = true;
  cx.timer.every(3000, (cx) => cx.spawn(async (cx) => { await sync(cx).catch(() => {}); }));
}
