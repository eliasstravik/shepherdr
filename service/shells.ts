// Your own terminal: one per space, a real shell through herdr-core in the space's folder on the space's machine
// (Everything: the home folder on the serving machine), and one per task in the task's folder (its worktree when it
// works on its own branch). It keeps running when the drawer is closed or the page reloads; once its shell exits,
// opening the drawer again starts a fresh one. It is never an agent's session: that stays behind Switch to terminal.
import type { Hub } from "./hub.ts";
import { hc } from "./actions.ts";

export const SHELL_LABEL = "shepherdr.shell";

export interface ShellAt {
  /** the folder it starts in, and the machine (null: this one) */
  folder: string;
  machine: string | null;
}

/** the live shell kept for a key ("sh:<space id>" or "sh:task:<task id>"), if any */
export function shellOf(hub: Hub, key: string): string | null {
  for (const k of hub.terminals.values()) if (k.state === "live" && k.labels?.[SHELL_LABEL] === key) return k.address;
  return null;
}

const starting = new Map<string, Promise<string>>();

/** The shell for a key: the one running, else a fresh one started in its folder. */
export function ensureShell(hub: Hub, key: string, at: ShellAt): Promise<string> {
  const live = shellOf(hub, key);
  if (live) return Promise.resolve(live);
  const was = starting.get(key);
  if (was) return was;
  const p = (async () => {
    // with no program, hc starts that machine's own shell; it outlives the page and is nobody's child
    const r = await hc(["run", "--bg", "--json", "--no-parent", ...(at.machine ? ["--on", at.machine] : []), "--cwd", at.folder, "--label", `${SHELL_LABEL}=${key}`]);
    let out: any = null;
    try { out = JSON.parse(r.stdout); } catch {}
    const address: string | undefined = out?.address ?? out?.terminal?.address ?? out?.terminal;
    if (r.code !== 0 || !address) throw new Error(r.stderr.trim().split("\n").pop() || "The terminal didn't start.");
    // the page attaches once herdr-core lists it
    for (let i = 0; i < 50 && hub.terminals.get(address)?.state !== "live"; i++) await new Promise((res) => setTimeout(res, 100));
    return address;
  })().finally(() => starting.delete(key));
  starting.set(key, p);
  return p;
}
