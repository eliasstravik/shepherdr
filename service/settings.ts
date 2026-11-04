// Shepherdr settings for the web app: the Everywhere rows of ~/.herdr/shepherdr.json (core/settings.js: the same words
// and choices as the window's settings), as 2.1's settings sections, and a change from the web written back to the same
// file, keeping everything else in it. The window's settings read the file when they open; herdr-task reads it each time.
import { existsSync, readFileSync, renameSync, watch, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HOME } from "./paths.ts";
import * as C from "../core/settings.js";
import type { SettingSection } from "../web/shared/types.ts";

const { TASK_ROWS, valueOf, withValue, wordFor, valueFor } = C as any;
const FILE = process.env.HERDR_TASK_SETTINGS || join(HOME, ".herdr", "shepherdr.json");

export class Settings {
  private file: any = {};
  private listeners = new Set<() => void>();

  on(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  start() {
    this.read();
    if (existsSync(dirname(FILE))) watch(dirname(FILE), (_e, name) => { if (name === "shepherdr.json") this.read(); });
  }

  private read() {
    let next: any = {};
    try { next = JSON.parse(readFileSync(FILE, "utf8")); } catch {}
    if (JSON.stringify(next) === JSON.stringify(this.file)) return;
    this.file = next;
    for (const fn of this.listeners) fn();
  }

  /** 2.1's sections: Tasks (Everywhere), and Web (the link). */
  sections(link: string | null): SettingSection[] {
    const tasks: SettingSection = {
      name: "Tasks", global: true,
      rows: TASK_ROWS.map(([section, field, label, choices]: any) => {
        const v = valueOf(this.file, section, field);
        return Array.isArray(choices)
          ? { label, key: `${section}.${field}`, value: wordFor(choices, v), options: choices.map(([, w]: any) => w) }
          : { label, key: `${section}.${field}`, value: String(v), num: { min: choices.min, max: choices.max, unit: "tasks", one: "task" } };
      }),
    };
    const web: SettingSection = {
      name: "Web", global: true,
      rows: [{ label: "Link", key: "web.link", value: link ?? "Tailscale isn't running here", fixed: true }],
    };
    return [tasks, web];
  }

  /** A row changed on the web: its new words, written as the value the file keeps. */
  set(key: string, word: string | null) {
    const row = TASK_ROWS.find(([s, f]: any) => `${s}.${f}` === key);
    if (!row) throw new Error("That setting can't be changed here.");
    const [section, field, , choices] = row;
    let value = word === null ? null : valueFor(choices, word);
    if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) throw new Error("Not one of its choices.");
    if (!Array.isArray(choices) && value !== null) value = Math.max(choices.min, Math.min(choices.max, Math.round(value)));
    let file: any = {};
    try { file = JSON.parse(readFileSync(FILE, "utf8")); } catch {}
    const next = withValue(file, section, field, value);
    writeFileSync(`${FILE}.web-tmp`, JSON.stringify(next, null, 1) + "\n");
    renameSync(`${FILE}.web-tmp`, FILE);
    this.read();
  }
}
