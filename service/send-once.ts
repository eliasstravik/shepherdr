// A page's send, once (SHEP-93): a phone that lost the answer asks again with the same id, and gets the same answer.
// What went in is kept on disk an hour (a service restart between the send and the page asking again must not send it
// twice); one that stayed in Claude Code's box is remembered so sending it again only presses its Enter; one held for
// the agent's turn that then couldn't go is told to the page (Chat.failed), never dropped quietly.
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "./paths.ts";

const KEEP = 60 * 60_000;
const FILE = () => join(process.env.SHEPHERDR_DATA || DATA, "sent.json");

type Done = { at: number; result: unknown };
let done: Map<string, Done> | null = null;

function load(): Map<string, Done> {
  if (done) return done;
  done = new Map();
  try {
    if (existsSync(FILE())) for (const [k, v] of Object.entries(JSON.parse(readFileSync(FILE(), "utf8")) as Record<string, Done>)) if (Date.now() - v.at < KEEP) done.set(k, v);
  } catch {}
  return done;
}

function save() {
  try {
    const tmp = `${FILE()}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries([...load()].filter(([, v]) => !(v.result as { waiting?: boolean })?.waiting))), { mode: 0o600 });
    renameSync(tmp, FILE());
  } catch {}
}

/** sends on their way now, by the page's id */
const going = new Map<string, Promise<unknown>>();
/** ids whose message stayed in Claude Code's box: sent again, it gets Enter (core/send.js sendTyped again) */
const stuck = new Set<string>();

/** go() once per cid: asked again while on its way, the same answer; once it went in, its answer again (kept across
 *  a restart); one that failed may go again. go(again): its last try stayed in the box */
export function once(cid: string, go: (again: boolean) => Promise<unknown>): Promise<unknown> {
  const d = load();
  for (const [k, v] of d) if (Date.now() - v.at > KEEP) d.delete(k);
  const was = d.get(cid);
  if (was) return Promise.resolve(was.result);
  const on = going.get(cid);
  if (on) return on;
  const p = go(stuck.has(cid));
  going.set(cid, p);
  p.then(
    (result) => {
      going.delete(cid);
      stuck.delete(cid);
      d.set(cid, { at: Date.now(), result });
      // one held for the agent's turn is held in memory only: after a restart it is gone, so its Retry must go again
      if (!(result as { waiting?: boolean })?.waiting) save();
    },
    (e) => {
      going.delete(cid);
      if ((e as { stuck?: boolean })?.stuck) stuck.add(cid);
    },
  );
  return p;
}

/** held messages that couldn't go once the agent was free, by agent address: the page shows them failed with Retry */
const heldFailed = new Map<string, { cid: string; error: string; at: number }[]>();
export function noteFailed(addr: string, cid: string, error: string, stayed = false) {
  // it stayed in Claude Code's box: its Retry presses Enter only
  if (stayed) stuck.add(cid);
  // its Retry goes again (its answer was "held", not "in")
  if (load().delete(cid)) save();
  const list = (heldFailed.get(addr) ?? []).filter((f) => f.cid !== cid && Date.now() - f.at < KEEP);
  heldFailed.set(addr, [...list, { cid, error, at: Date.now() }]);
}
export function failedOf(addr: string | null | undefined): { cid: string; error: string }[] {
  return (heldFailed.get(addr ?? "") ?? []).filter((f) => Date.now() - f.at < KEEP).map(({ cid, error }) => ({ cid, error }));
}

/** tests: a restart (what is on disk is read again) */
export function forgetAll() {
  done = null;
  going.clear();
  stuck.clear();
  heldFailed.clear();
}
