// Usage insights in the service (the "insights" add-on, docs/insights.md): the web app's events (POST /api/action
// { type: "usage", events }), a voice call's sends and closed asks, appended to this machine's
// ~/.herdr/shepherdr/usage.jsonl. Kinds, ids, counts and times only (core/usage.js drops the rest). Nothing here
// makes a network call: the file stays on this machine; Delete removes it here and on the person's own other
// machines over herdr-core's link (hc exec --on), the same way every other cross-machine read goes.
import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "./paths.ts";
import * as U from "../core/usage.js";

const { lines, FILE, OLD, CAP, DELETE } = U as any;
const file = () => join(DATA, FILE);

// The add-on is on (Shepherdr settings > Window > Add-ons): main.ts gives the off list's check (not imported here, so
// a test's settings file isn't read before it is set).
let insightsOn = () => false;
export function followSwitch(on: () => boolean) { insightsOn = on; }

/** Appends the events that may be kept; false when the add-on is off (nothing written). */
export function record(events: unknown[], on = insightsOn()): boolean {
  if (!on) return false;
  const text: string = lines(events);
  if (!text) return true;
  try {
    mkdirSync(DATA, { recursive: true, mode: 0o700 });
    const f = file();
    if (existsSync(f) && statSync(f).size > CAP) renameSync(f, join(DATA, OLD));
    appendFileSync(f, text, { mode: 0o600 });
    chmodSync(f, 0o600);
  } catch { /* a full disk: insights are never worth an error */ }
  return true;
}

/** One event from the service itself. */
export const note = (kind: string, fields: Record<string, unknown> = {}) => record([{ ...fields, kind }]);

/** Deletes this machine's usage log, and each other machine's given (its own Delete there). The machines it couldn't
 *  reach. */
export async function deleteAll(machines: string[], hc: (args: string[]) => Promise<boolean>): Promise<string[]> {
  for (const n of [FILE, OLD]) rmSync(join(DATA, n), { force: true });
  const missed: string[] = [];
  await Promise.all(machines.map(async (m) => { if (!(await hc(["exec", "--on", m, "--timeout", "20", "--", "sh", "-c", DELETE]))) missed.push(m); }));
  return missed;
}
