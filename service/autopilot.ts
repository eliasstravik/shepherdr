// Autopilot from the web, as the window's Settings › Autopilot: herdr-task keeps it (its switch, schedule, events, the
// heartbeat file and Run now), on this machine's spaces only. Its refusal is said as herdr-task says it.
import { writeFileSync } from "node:fs";

async function task(args: string[]) {
  const p = Bun.spawn(["herdr-task", "autopilot", ...args, "--json"], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  let json: any = null;
  try { json = JSON.parse(out); } catch {}
  if ((await p.exited) !== 0 || json?.error) throw new Error(json?.error ?? (err.trim().split("\n").pop()?.replace(/^herdr-task: /, "") || "Autopilot didn't change."));
  return json;
}

const EVENTS = new Set(["added", "ready", "failed", "needs-you", "merged", "stalled"]);

/** Sets one of a space's Autopilot rows (autopilot.on, .every, .events, .heartbeat). */
export async function setPilot(space: string, key: string, value: string | null) {
  if (!/^[\w-]+$/.test(space)) throw new Error("Autopilot is set on that space's own machine.");
  const v = value ?? "";
  if (key === "autopilot.on") return task([v === "on" ? "on" : "off", "--space", space]);
  if (key === "autopilot.every") return task(["set", "--every", v.trim().slice(0, 200), "--space", space]);
  if (key === "autopilot.events") {
    const on = v.split(",").map((x) => x.trim()).filter(Boolean);
    if (on.some((x) => !EVENTS.has(x))) throw new Error("Not an event Autopilot knows.");
    return task(["set", "--on", on.join(","), "--space", space]);
  }
  if (key === "autopilot.heartbeat") {
    // the file is made with its starter when missing, then holds these words
    const file = (await task(["heartbeat", "--space", space]))?.heartbeat;
    if (!file) throw new Error("Couldn't make the heartbeat file.");
    writeFileSync(file, v.endsWith("\n") || !v ? v : `${v}\n`);
    return { ok: true };
  }
  throw new Error("Not an Autopilot setting.");
}

/** Wakes a space's Assistant now (queued until it is idle). */
export const runPilot = (space: string) => {
  if (!/^[\w-]+$/.test(space)) throw new Error("Autopilot runs on that space's own machine.");
  return task(["run-now", "--space", space]);
};
