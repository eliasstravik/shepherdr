// Autopilot from the web, as the window's Settings › Autopilot: herdr-task keeps it (Everywhere's switch, schedule,
// events and heartbeat file, and each space's own where it sets one; Run now), on this machine's spaces only. A value
// set back to null is that space's Reset: it follows Everywhere's again. Its refusal is said as herdr-task says it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as APc from "../core/autopilot.js";
const AP = APc as any;

async function task(args: string[]) {
  const p = Bun.spawn(["herdr-task", "autopilot", ...args, "--json"], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  let json: any = null;
  try { json = JSON.parse(out); } catch {}
  if ((await p.exited) !== 0 || json?.error) throw new Error(json?.error ?? (err.trim().split("\n").pop()?.replace(/^herdr-task: /, "") || "Autopilot didn't change."));
  return json;
}

const EVENTS = new Set(AP.EVENTS.map(([v]: string[]) => v));
const FIELD: Record<string, string> = { "autopilot.on": "on", "autopilot.every": "every", "autopilot.events": "events", "autopilot.heartbeat": "heartbeat" };
const words = (file: string | null) => { try { return file && existsSync(file) ? readFileSync(file, "utf8") : AP.STARTER; } catch { return AP.STARTER; } };
const write = (file: string, v: string) => writeFileSync(file, v.endsWith("\n") || !v ? v : `${v}\n`);

/** Sets one of Autopilot's rows (autopilot.on, .every, .events, .heartbeat) for Everywhere (place "all") or a space;
 *  autopilot.run is the space's Run now. */
export async function setPilot(place: string, key: string, value: string | null) {
  if (key === "autopilot.run") return runPilot(place);
  const all = place === "all";
  if (!all && !/^[\w-]+$/.test(place)) throw new Error("Autopilot is set on that space's own machine.");
  const at = all ? ["--everywhere"] : ["--space", place];
  // a space's Reset: back to Everywhere's
  if (value === null && !all && FIELD[key]) return task(["reset", "--only", FIELD[key], ...at]);
  const v = value ?? "";
  if (key === "autopilot.on") return task([v === "on" ? "on" : "off", ...at]);
  if (key === "autopilot.every") return task(["set", "--every", v.trim().slice(0, 200), ...at]);
  if (key === "autopilot.events") {
    const on = v.split(",").map((x) => x.trim()).filter(Boolean);
    if (on.some((x) => !EVENTS.has(x))) throw new Error("Not an event Autopilot knows.");
    return task(["set", "--on", on.join(","), ...at]);
  }
  if (key === "autopilot.heartbeat") {
    // Everywhere's file, or the space's own (made from Everywhere's words); a space's words the same as Everywhere's
    // follow Everywhere's again. A missing file is made with herdr-task's starter, then holds these words.
    if (!all) {
      const everywhere = (await task(["heartbeat", "--everywhere"]))?.heartbeat ?? null;
      if (v.trim() === String(words(everywhere)).trim()) return task(["reset", "--only", "heartbeat", ...at]);
    }
    const file = (await task(["heartbeat", ...at, ...(all ? [] : ["--own"])]))?.heartbeat;
    if (!file) throw new Error(AP.NO_HEARTBEAT);
    write(file, v);
    return { ok: true };
  }
  throw new Error("Not an Autopilot setting.");
}

/** Wakes a space's Assistant now (queued until it is idle). */
export const runPilot = (space: string) => {
  if (!/^[\w-]+$/.test(space) || space === "all") throw new Error("Autopilot runs on that space's own machine.");
  return task(["run-now", "--space", space]);
};
