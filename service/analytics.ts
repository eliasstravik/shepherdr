// Personal analytics (SHEP-453): the app's own events (opened, messages sent and how, questions answered, settings
// changed, updates, errors), appended to this machine's record. herdr-task records task changes into the same folder
// (herdr_task/analytics.py) and reads it all back (`herdr-task analytics`), over the person's own machines' links.
// The promise: nothing here sends anything anywhere. Only files in Shepherdr's own data folder; test/test_analytics.py
// fails if this file (or core/analytics.js) reaches for the network.
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clean, EVENTS } from "../core/analytics.js";
import { where } from "./paths.ts";
import { readSettings } from "./settings.ts";
import { spawn } from "./spawn.ts";

const DAY_MAX = 4 * 1024 * 1024;

export function folder(env: Record<string, string | undefined> = process.env): string {
  if (env.HERDR_ANALYTICS_DIR) return env.HERDR_ANALYTICS_DIR;
  if (env.HERDR_TASK_STORE) return join(env.HERDR_TASK_STORE, ".analytics");
  return where().analytics;
}

export function isOn(): boolean {
  try { return readSettings()?.everywhere?.analytics_off !== true; } catch { return true; }
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dayOf = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** Append one event. Never throws: analytics never gets in the way. */
export function record(event: string, fields: Record<string, unknown> = {}, at = Date.now()): boolean {
  try {
    if (!(event in EVENTS) || !isOn()) return false;
    const dir = folder();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const p = join(dir, `${dayOf(at)}.jsonl`);
    try { if (statSync(p).size > DAY_MAX) return false; } catch {}
    appendFileSync(p, JSON.stringify({ t: at, e: event, ...clean(fields) }) + "\n", { mode: 0o600 });
    return true;
  } catch { return false; }
}

/** Shepherdr's version changed since this machine's service last ran: an update. */
export function noteVersion(version: string) {
  try {
    if (!isOn()) return;
    const p = join(folder(), ".version");
    let was = "";
    try { was = readFileSync(p, "utf8").trim(); } catch {}
    if (was === version) return;
    if (was) record("shepherdr.updated", { version });
    mkdirSync(folder(), { recursive: true, mode: 0o700 });
    writeFileSync(p, version, { mode: 0o600 });
  } catch {}
}

/** What a message's send says about how it was written (the page's `how`). */
export const howOf = (v: unknown) => (v === "dictated" || v === "bubble" || v === "talk" ? v : "typed");

const PAGE_EVENTS = new Set(["app.opened", "app.link_lost", "message.failed"]);

async function herdrTask(args: string[]): Promise<any> {
  const p = spawn(["herdr-task", "analytics", ...args, "--json"], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  try { return JSON.parse(out.trim().split("\n").pop() || ""); }
  catch { throw new Error(err.trim().split("\n").pop()?.replace(/^herdr-task: /, "") || "The analytics couldn't be read."); }
}

/** Settings › Personal analytics, and the page's own events. `set(key, value)` writes a setting (next.ts setConfig). */
export async function analyticsAction(b: any, set: (key: string, value: unknown) => void): Promise<unknown> {
  const days = Math.max(1, Math.min(3660, Number(b.days) || 7));
  switch (b.do) {
    case "state": {
      let noted = false;
      try { noted = readSettings()?.everywhere?.analytics_noted === true; } catch {}
      return { ok: true, on: isOn(), noted };
    }
    case "event":
      if (typeof b.event === "string" && PAGE_EVENTS.has(b.event)) record(b.event, b.fields ?? {});
      return { ok: true };
    case "set":
      set("analytics.on", !!b.on);
      if (b.on) record("analytics.on");
      return { ok: true, on: isOn() };
    case "noted":
      set("analytics.noted", true);
      return { ok: true };
    case "show": return { ok: true, ...(await herdrTask(["show", "--days", String(days)])) };
    case "raw": return { ok: true, ...(await herdrTask(["raw", "--days", String(days)])) };
    case "export": return { ok: true, ...(await herdrTask(["export", "--days", "3660"])) };
    case "delete": {
      const r = await herdrTask(["delete"]);
      return { ok: Object.values(r.deleted ?? {}).every(Boolean), deleted: r.deleted ?? {} };
    }
  }
  return { ok: false, error: "Not an analytics action." };
}
