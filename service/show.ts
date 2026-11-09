// An agent shows the person an artifact (`herdr-artifact open <id>`, SHEP-99): it sets the core label herdr.show =
// { id, at, artifact } on its own terminal, which this service hears at once, the agent here or on another machine (as
// herdr-task alert's herdr.alert). Only the machine that serves the web app acts on it: the page the person used last,
// while on screen, opens the artifact (what matters is where the person is, as a voice call's open). None on screen: the
// Herdr window on the serving machine opens it, for an agent on another machine (one here opened it in this window
// itself: herdr-artifact open runs herdr-app where there is one).
import { TOOL } from "./artifacts.ts";

export const SHOW = "herdr.show";
/** an ask older than this is stale when heard (a service started late, a label left from before) */
export const SHOW_FRESH = 2 * 60_000;

/** machine: the asking terminal's (null: this one), where the artifact is */
export type ShowAsk = { id: string; at: number; artifact: string; machine: string | null };

/** A terminal's ask to show an artifact (its herdr.show label), or null. */
export function showAsk(t: { address?: string; labels?: Record<string, string> | null } | null | undefined): ShowAsk | null {
  let a: any = null;
  try { a = JSON.parse(t?.labels?.[SHOW] ?? "null"); } catch { return null; }
  if (!a || typeof a.id !== "string" || !a.id || typeof a.artifact !== "string" || !/^\w[\w.-]{0,119}$/.test(a.artifact)) return null;
  const cut = t?.address?.indexOf("/") ?? -1;
  return { id: a.id.slice(0, 64), at: Number(a.at) || 0, artifact: a.artifact, machine: cut > 0 ? t!.address!.slice(0, cut) : null };
}

/** Follows the terminals' asks: each new, fresh one once (an ask already set when it starts is never shown). */
export class Shows {
  private done = new Set<string>();
  private primed = false;

  constructor(private now = () => Date.now()) {}

  /** The asks to show now, from every terminal's labels. */
  take(terminals: Iterable<{ address?: string; labels?: Record<string, string> | null }>): ShowAsk[] {
    const out: ShowAsk[] = [];
    for (const t of terminals) {
      const a = showAsk(t);
      if (!a || this.done.has(a.id)) continue;
      this.done.add(a.id);
      if (this.primed && Math.abs(this.now() - a.at) < SHOW_FRESH) out.push(a);
    }
    this.primed = true;
    return out;
  }
}

/** herdr-artifact's words to open another machine's artifact in this machine's window, in a new tab. */
export const windowArgs = (a: ShowAsk) => ["open", a.artifact, "--from", a.machine!, "--tab", "--json"];

/** Opens another machine's artifact in the window here (no window: nothing). Not as an agent: no ask of its own. */
export async function showInWindow(a: ShowAsk) {
  if (!a.machine || !/^[\w.-]{1,64}$/.test(a.machine)) return;
  const { HC_TERMINAL_ID: _t, ...env } = process.env;
  const p = Bun.spawn([TOOL, ...windowArgs(a)], { env, stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  await p.exited;
}
