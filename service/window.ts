// Settings › Window from the web, as 3.0's: the window's look switches (shared keys the window reads; lib/bridge.js
// brings a change made here to it) and the add-ons' switches. An add-on's off is kept where the window keeps it:
// Everywhere's "off" in ~/.config/shepherdr/settings.json (herdr-task, other machines) and shared "addons.off" (the window's
// mods). The web app leaves an off add-on's plugins out (lib/addons.json's "web") and its pages with them.
import { readFileSync } from "node:fs";
import { readSettings, writeSettings } from "./settings.ts";
import { join } from "node:path";
import { HOME } from "./paths.ts";
import type { SettingRow, SettingSection } from "../web/shared/types.ts";
// the switches' words and an add-on's line: core/settings.js, the window's own (mods/shepherdr-settings/layout.js)
import * as C from "../core/settings.js";

const { SWITCHES: CORE_SWITCHES, ADDONS, SECTIONS, INSIGHTS, addonAbout } = C as any;
// the repo's lib/addons.json, installed beside the service
const MANIFEST = join(import.meta.dir, "..", "lib", "addons.json");

export const SWITCHES: { id: string; title: string; about: string; key: string }[] = CORE_SWITCHES;

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

const names = (ids: string[]): string[] => ids.map((id) => addons().find((a) => a.id === id)?.title ?? id);
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
    // one that others need, or that needs one that's off: its switch shows, greyed, and its line says which
    rows.push({ label: a.title, key: `addon.${a.id}`, value: now ? "on" : "off", options: ["on", "off"], hint: addonAbout(a.about, now, names(stop)),
      group: ADDONS, ...(stop.length ? { disabled: true } : {}) });
    // Usage insights: its Delete, right under its switch (service/usage.ts deleteAll)
    if (a.id === "insights") rows.push({ label: INSIGHTS.title, key: "insights.delete", value: "", button: INSIGHTS.button, hint: INSIGHTS.about, group: ADDONS });
  }
  return { name: SECTIONS.find((s: any) => s.id === "window").title, global: true, rows };
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
