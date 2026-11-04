// Settings › Window from the web, as 3.0's: the window's look switches (shared keys the window reads; lib/bridge.js
// brings a change made here to it) and the add-ons' switches. An add-on's off is kept where the window keeps it:
// Everywhere's "off" in ~/.herdr/shepherdr.json (herdr-task, other machines) and shared "addons.off" (the window's
// mods). The web app leaves an off add-on's plugins out (lib/addons.json's "web") and its pages with them.
import { readFileSync } from "node:fs";
import { readSettings, writeSettings } from "./settings.ts";
import { join } from "node:path";
import { HOME } from "./paths.ts";
import type { SettingRow, SettingSection } from "../web/shared/types.ts";

const FILE = process.env.HERDR_TASK_SETTINGS || join(HOME, ".herdr", "shepherdr.json");
// the repo's lib/addons.json, installed beside the service
const MANIFEST = join(import.meta.dir, "..", "lib", "addons.json");

export const SWITCHES = [
  { id: "tabs", title: "Show tabs", about: "The space's tabs, in the bar at the top. The bar's buttons stay either way.", key: "tabbar.tabs" },
  { id: "worktrees", title: "Worktrees in the sidebar", about: "A repo's worktree spaces, listed under it.", key: "sidebar.worktrees" },
  { id: "unread", title: "Bold unread spaces", about: "A space whose Assistant has something new shows bold and bright.", key: "sidebar.unread" },
  { id: "counts", title: "Red counts", about: "What needs you, counted in red on spaces, tabs and Tasks.", key: "counts.red" },
  { id: "greens", title: "Green counts", about: "Tasks in Ready, counted in green on spaces, tabs and Tasks.", key: "counts.green" },
  { id: "filters", title: "Status filters in Tasks", about: "The row of status chips under the Tasks search.", key: "tasks.filters" },
  { id: "place", title: "Show space on task rows", about: "Each task row names its space and machine, dimmed on the right.", key: "tasks.place" },
  { id: "helpers", title: "Show subagents above the chat box", about: "The agent's own subagents at work, listed over the box.", key: "chat.helpers" },
  { id: "assistant", title: "Assistant in new spaces", about: "A new space opens with its Assistant's chat, else a terminal.", key: "coordinator.auto" },
];

type Addon = { id: string; title: string; about: string; switch?: boolean; needs?: string[]; web?: string[] };
let manifest: Addon[] | null = null;
export function addons(): Addon[] {
  try { manifest ??= JSON.parse(readFileSync(MANIFEST, "utf8")).addons ?? []; } catch { manifest = []; }
  return manifest!;
}

function readFile(): any { try { return readSettings(); } catch { return {}; } }
/** The add-ons switched off (Everywhere's "off"). */
export const offList = (): string[] => { const o = readFile()?.everywhere?.off; return Array.isArray(o) ? o : []; };
/** The web app's plugins left out now. */
export const offPlugins = () => addons().filter((a) => offList().includes(a.id)).flatMap((a) => a.web ?? []);

const names = (ids: string[]) => ids.map((id) => addons().find((a) => a.id === id)?.title ?? id).join(", ");
/** What stops a flip: on needs its needs on; off waits for the on add-ons that need it. */
function blockers(id: string, next: boolean, off: string[]) {
  if (next) return (addons().find((a) => a.id === id)?.needs ?? []).filter((n) => off.includes(n));
  return addons().filter((a) => !off.includes(a.id) && (a.needs ?? []).includes(id)).map((a) => a.id);
}

/** The Window page: its switches (value: a shared key's, on unless false) and the add-ons'. */
export function windowSection(value: (key: string) => unknown): SettingSection {
  const off = offList();
  const rows: SettingRow[] = SWITCHES.map((s) => ({ label: s.title, key: `window.${s.id}`, value: value(s.key) === false ? "off" : "on", options: ["on", "off"], hint: s.about }));
  for (const a of addons().filter((x) => x.switch)) {
    const now = !off.includes(a.id), stop = blockers(a.id, !now, off);
    const n = stop.length === 1;
    const hint = !stop.length ? a.about : now ? `${a.about} ${names(stop)} need${n ? "s" : ""} it: turn ${n ? "that" : "them"} off first.` : `${a.about} Needs ${names(stop)}: turn ${n ? "it" : "them"} on first.`;
    rows.push({ label: a.title, key: `addon.${a.id}`, value: now ? "on" : "off", options: stop.length ? [now ? "on" : "off"] : ["on", "off"], hint, group: "Add-ons" });
  }
  return { name: "Window", global: true, rows };
}

/** A switch flipped on the web. setShared: the service's shared document (the bridge brings it to the window). */
export async function setWindow(key: string, word: string | null, setShared: (k: string, v: unknown) => Promise<unknown>) {
  const on = word !== "off";
  const sw = SWITCHES.find((s) => `window.${s.id}` === key);
  if (sw) { await setShared(sw.key, on); return; }
  const a = addons().find((x) => x.switch && `addon.${x.id}` === key);
  if (!a) throw new Error("That setting can't be changed here.");
  const off = offList();
  if (blockers(a.id, on, off).length) throw new Error(on ? "Turn on what it needs first." : "Turn off what needs it first.");
  const list = on ? off.filter((x) => x !== a.id) : [...new Set([...off, a.id])];
  const file = readSettings();
  const e = (file.everywhere ??= {});
  if (list.length) e.off = list; else delete e.off;
  writeSettings(file);
  await setShared("addons.off", list);
}
