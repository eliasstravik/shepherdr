// Autopilot from the web, as the window's Settings › Autopilot: one setting for every space (its heartbeat file,
// schedule and events), kept by herdr-task; a space switches it on in its Assistant's header (service/actions.ts mode).
// Its refusal is said as herdr-task says it.
import { writeFileSync } from "node:fs";
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

/** Sets one of Autopilot's rows (autopilot.every, .events, .heartbeat): the same in every space, whatever level the
 *  page was asked from. */
export async function setPilot(_place: string, key: string, value: string | null) {
  const v = value ?? "";
  if (key === "autopilot.every") return task(["set", "--every", v.trim().slice(0, 200), "--everywhere"]);
  if (key === "autopilot.events") {
    const on = v.split(",").map((x) => x.trim()).filter(Boolean);
    if (on.some((x) => !EVENTS.has(x))) throw new Error("Not an event Autopilot knows.");
    return task(["set", "--on", on.join(","), "--everywhere"]);
  }
  if (key === "autopilot.heartbeat") {
    // the file is made with its starter when missing, then holds these words as typed (saved as you type)
    const file = (await task(["heartbeat"]))?.heartbeat;
    if (!file) throw new Error(AP.NO_HEARTBEAT);
    writeFileSync(file, v);
    return { ok: true };
  }
  throw new Error("Not an Autopilot setting.");
}

/** Wakes a space's Assistant now (queued until it is idle). */
export const runPilot = (space: string) => {
  if (!/^[\w-]+$/.test(space) || space === "all") throw new Error("Autopilot runs on that space's own machine.");
  return task(["run-now", "--space", space]);
};
