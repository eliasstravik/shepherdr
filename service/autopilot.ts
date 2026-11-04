// Autopilot from the web, as the window's Settings › Autopilot: Everywhere's heartbeat, schedule and events, and a
// space's own, kept in Shepherdr settings with the rest (service/settings.ts writes them); herdr-task checks a schedule's
// words first, and wakes the spaces switched on in their Assistant's header (service/actions.ts mode). Its refusal is
// said as herdr-task says it.
import * as APc from "../core/autopilot.js";

async function task(args: string[]) {
  const p = Bun.spawn(["herdr-task", "autopilot", ...args, "--json"], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  let json: any = null;
  try { json = JSON.parse(out); } catch {}
  if ((await p.exited) !== 0 || json?.error) throw new Error(json?.error ?? (err.trim().split("\n").pop()?.replace(/^herdr-task: /, "") || "Autopilot didn't change."));
  return json;
}

/** A schedule's words as Settings keeps them ("" for none), once herdr-task knows them; refused as it says. A
 *  herdr-task from before `check` (a machine not updated yet) takes only the picks. */
export async function checkEvery(words: string) {
  const v = words.trim().slice(0, 200);
  if (!v) return "";
  try { return String((await task(["check", "--every", v]))?.every ?? ""); }
  catch (err) {
    if (!/invalid choice/.test((err as Error).message)) throw err;
    if ((APc as any).presetOf(v) !== null) return v;
    throw new Error("herdr-task here is older than this page: update Shepherdr to save your own schedule's words.");
  }
}

/** Wakes a space's Assistant now (queued until it is idle); another machine's ("vm/sp1") through herdr-task there. */
export const runPilot = (space: string) => {
  if (!/^([\w.-]+\/)?[\w-]+$/.test(space) || space === "all") throw new Error("bad space");
  return task(["run-now", "--space", space]);
};
