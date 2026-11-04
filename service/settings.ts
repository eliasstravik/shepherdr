// Shepherdr settings for the web app: ~/.herdr/shepherdr.json as the window's settings show it (core/settings.js: the
// same words and choices), as 2.1's settings sections, and a change from the web written back to the same file,
// keeping everything else in it. The window's settings read the file when they open; herdr-task reads it each time.
// Levels as the window's scopes: Everywhere ("everywhere"), a space ("spaces"[its id], with its repo folder, which is
// how herdr-task finds it), and for the Machines page each machine ("machines"[its name, "local" here]).
import { existsSync, readFileSync, renameSync, watch, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HOME } from "./paths.ts";
import * as C from "../core/settings.js";
import * as M from "../core/machines.js";
import * as AG from "../core/agents.js";
import type { SettingRow, SettingSection } from "../web/shared/types.ts";

const { TASK_ROWS, DEFAULTS, wordFor, valueFor } = C as any;
const { HOLD } = M as any;
const { line, NAMES } = AG as any;
const FILE = process.env.HERDR_TASK_SETTINGS || join(HOME, ".herdr", "shepherdr.json");
const TEMPLATES = join(HOME, ".config", "herdr-core", "templates");
const LOCAL = "local";

/** A space Settings can scope to: its id (machine/id for another machine's), name, machine, and repo folder. */
export type Scope = { id: string; name: string; machine: string | null; folder?: string | null };

export const ROLES = [
  { id: "coordinator", title: "Assistant", about: "Plans the work and starts a task for each part.", file: "assistant.md", told: "What every Assistant is told first" },
  { id: "worker", title: "Workers", about: "Do one task each.", file: "worker.md", told: "What every worker is told first" },
  { id: "reviewer", title: "Reviewer", about: "Checks each task's work before it's ready.", file: "reviewer.md", told: "What every reviewer is told first" },
];
const NOTES = [
  { id: "start", title: "When a task starts", about: "Steps its agent does before the work." },
  { id: "finish", title: "When a task finishes", about: "Steps its agent does before it says the task is ready." },
];
// Machines: when new tasks wait (each a percent; CPU as a share of all cores), and how task agents run
const LIMITS = [
  { field: "start_memory", label: "Memory busy above", about: "New tasks there wait while more memory is in use.", min: 10, max: 100, step: 5, scale: 1 },
  { field: "start_load", label: "CPU busy above", about: "The 1-minute load, as a share of all its cores.", min: 25, max: 400, step: 25, scale: 100 },
  { field: "start_disk", label: "Disk busy above", about: "Its home or /tmp, whichever is fuller.", min: 10, max: 100, step: 5, scale: 1 },
];
const CAPS = [0, 1, 2, 4, 8, 16, 32];
const MACHINE_DEFAULTS: Record<string, unknown> = { ...HOLD, low_priority: true, worker_memory: 0 };
const ON = (v: unknown) => (v ? "on" : "off");

// the window's push to other machines (mods/shepherdr-settings): each gets Everywhere, its machine's and its spaces'
// (by their ids there), marked so it knows which machine it is; a file there without the mark is that machine's own
export const PUSH = `f="$HOME/.herdr/shepherdr.json"; mkdir -p "$HOME/.herdr" || exit 1
if [ -f "$f" ] && ! grep -q '"pushed_from"' "$f"; then echo own; exit 0; fi
if [ -f "$f" ] && [ "$(cat "$f")" = "$1" ]; then exit 0; fi
umask 077; printf '%s\\n' "$1" > "$f.tmp" && mv "$f.tmp" "$f"`;
/** What one other machine is sent. */
export function pushBody(file: any, m: string) {
  const spaces = Object.fromEntries(Object.entries(file.spaces ?? {}).filter(([id]) => id.startsWith(`${m}/`)).map(([id, v]) => [id.split("/").pop(), v]));
  return JSON.stringify({ version: 1, pushed_from: "herdr-app", here: m, everywhere: file.everywhere ?? {}, machines: file.machines?.[m] ? { [m]: file.machines[m] } : {}, spaces }, null, 2);
}

/** Writes the whole file as the window does (version 1), then tells whoever pushes it to other machines. */
/** The file as it is: {} only when there is none yet. Unreadable (half-written, hand-broken) refuses, so a change
 *  never writes a file with everything else gone. */
export function readSettings(): any {
  let text: string;
  try { text = readFileSync(FILE, "utf8"); } catch (e: any) { if (e?.code === "ENOENT") return {}; throw new Error("The settings file can't be read now. Try again."); }
  try { const f = JSON.parse(text); if (f && typeof f === "object" && !Array.isArray(f)) return f; } catch {}
  throw new Error("The settings file can't be read now (~/.herdr/shepherdr.json isn't valid JSON).");
}
const SAFE = (k: string) => !["__proto__", "constructor", "prototype"].includes(k);

export function writeSettings(next: any) {
  next.version = 1;
  writeFileSync(`${FILE}.web-tmp`, JSON.stringify(next, null, 2) + "\n");
  renameSync(`${FILE}.web-tmp`, FILE);
  for (const fn of written) fn(next);
}
const written = new Set<(file: any) => void>();
export const onWritten = (fn: (file: any) => void) => written.add(fn);

export class Settings {
  private file: any = {};
  private host = LOCAL;
  private machineNames: string[] = [];
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

  private layer(scope: string | null) { return scope ? this.file.spaces?.[scope] : this.file.everywhere; }
  /** A field as a scope sees it: its own, else Everywhere's, else the default; and whether the scope sets it. */
  private pick(scope: string | null, section: string, field: string | null) {
    const at = (l: any) => (field ? l?.[section]?.[field] : l?.[section]);
    const own = at(this.layer(scope)), every = at(this.file.everywhere);
    const dflt = field ? DEFAULTS[section]?.[field] ?? null : null;
    return { value: own ?? (scope ? every : undefined) ?? dflt, own: scope ? own !== undefined && own !== null : false, parent: every ?? dflt };
  }

  /** Every page at every level: Agents and Tasks (Everywhere and each space), Machines (all and each machine), Web. */
  sections(link: string | null, spaces: Scope[] = [], machines: string[] = [], host = LOCAL): SettingSection[] {
    this.host = host;
    this.machineNames = machines;
    const out: SettingSection[] = [];
    for (const s of [null, ...spaces]) out.push(this.agents(s), this.tasks(s));
    // Machines, as the window's page: the limits for every machine, then each machine's block
    out.push({ name: "Machines", level: "all", rows: [null, LOCAL, ...machines].flatMap((m) => this.machines(m)) });
    out.push({ name: "Web", global: true, rows: [{ label: "Link", key: "web.link", value: link ?? "Tailscale isn't running here", fixed: true }] });
    return out;
  }

  private follows(scope: Scope | null, p: { own: boolean; parent: unknown }, word: (v: any) => string): Partial<SettingRow> {
    if (!scope) return {};
    return p.own ? { inherits: { value: word(p.parent), from: "Everywhere" } } : { from: "Everywhere" };
  }

  private agents(s: Scope | null): SettingSection {
    const scope = s?.id ?? null;
    const worker = this.pick(scope, "worker", null).value?.agent ?? "claude";
    const other = worker === "codex" ? "claude" : "codex";
    const rows: SettingRow[] = ROLES.map((r) => {
      const p = this.pick(scope, r.id, null);
      const words = (v: any) => (v ? line(v) : r.id === "reviewer" ? `Other CLI (${NAMES[other]})` : "Default");
      // on Everywhere its row has "Edit instructions" too: the file every agent of the role is told first (the same for every space)
      return { label: r.title, key: `role.${r.id}`, value: words(p.value), agent: { role: r.id, pick: p.value ?? null }, hint: r.about, ...(s ? {} : { file: r.file }), ...this.follows(s, p, words) } as SettingRow;
    });
    // Backup: the other CLI takes over a task once when its agent can't go on (on: unset or a CLI; off: "off")
    const b = this.pick(scope, "backup", "agent");
    rows.push({ label: "Backup agent", key: "backup.agent", value: ON(b.value !== "off"), options: ["on", "off"], hint: "The other CLI takes over a task once when its agent can't go on.",
      ...this.follows(s, b, (v) => ON(v !== "off")) });
    return { name: "Agents", level: scope ?? "all", rows };
  }

  private tasks(s: Scope | null): SettingSection {
    const scope = s?.id ?? null;
    const rows: SettingRow[] = TASK_ROWS.map(([section, field, label, choices]: any) => {
      const p = this.pick(scope, section, field);
      const words = (v: any) => wordFor(choices, v);
      return Array.isArray(choices)
        ? { label, key: `${section}.${field}`, value: words(p.value), options: choices.map(([, w]: any) => w), ...this.follows(s, p, words) }
        : { label, key: `${section}.${field}`, value: String(p.value), num: { min: choices.min, max: choices.max, unit: "tasks", one: "task" }, ...this.follows(s, p, String) };
    });
    for (const n of NOTES) {
      const p = this.pick(scope, "tasks", `${n.id}_notes`);
      rows.push({ label: n.title, key: `tasks.${n.id}_notes`, value: p.value ?? "", multiline: true, hint: n.about, group: "Notes", ...this.follows(s, p, (v) => v ?? "") });
    }
    return { name: "Tasks", level: scope ?? "all", rows };
  }

  /** Machines: when new tasks wait and how task agents run, for every machine (null) or one's own; a machine's page
   *  has its Home Assistant too. */
  private machines(m: string | null): SettingRow[] {
    const every = this.file.everywhere?.machine ?? {}, layer = m ? this.file.machines?.[m] ?? {} : {};
    const own = m ? layer.machine ?? {} : every;
    const base = (f: string) => (f in every ? every[f] : MACHINE_DEFAULTS[f]);
    const val = (f: string) => (f in own ? own[f] : base(f));
    const from = (f: string, word: (v: any) => string): Partial<SettingRow> => (!m ? {} : f in own ? { inherits: { value: word(base(f)), from: "All machines" } } : { from: "All machines" });
    // a machine's own rows say which machine (key@machine); the heading is its name, as the window's blocks
    const at = m ? `@${m}` : "";
    const group = m ? (m === LOCAL ? "This computer" : m) : "When new tasks wait, on every machine";
    const rows: SettingRow[] = LIMITS.map((l) => {
      const word = (v: any) => (v == null ? "off" : String(Math.round(Number(v) * l.scale)));
      return { label: l.label, key: `machine.${l.field}${at}`, value: word(val(l.field)), hint: l.about, num: { min: l.min, max: l.max, step: l.step, unit: "%", one: "%", off: true }, group, ...from(l.field, word) };
    });
    rows.push({ label: "Workers run at low priority", key: `machine.low_priority${at}`, value: ON(val("low_priority") !== false), options: ["on", "off"],
      hint: "Task agents start below the Assistant and your apps, and are ended first when memory runs out.", group, ...from("low_priority", (v) => ON(v !== false)) });
    const gb = (v: any) => (Number(v) ? `${Number(v)} GB` : "Off");
    rows.push({ label: "Memory cap per worker", key: `machine.worker_memory${at}`, value: gb(val("worker_memory")), options: CAPS.map(gb),
      hint: "A worker over it is slowed down, not ended. Applies to tasks started after a change.", group, ...from("worker_memory", gb) });
    if (m) {
      const home = typeof layer.home === "boolean" ? layer.home : m === LOCAL;
      rows.unshift({ label: "Home Assistant", key: `machine.home${at}`, value: ON(home), options: ["on", "off"], group,
        hint: home ? "Its home space's Assistant watches its disk, load and processes." : "Off: nobody watches its disk, load and processes." });
    }
    return rows;
  }

  /** The instructions file every agent of a role is told first. */
  template(role: string, text?: string) {
    const r = ROLES.find((x) => x.id === role);
    if (!r) throw new Error("Not a role.");
    const file = join(TEMPLATES, r.file);
    if (text === undefined) { try { return readFileSync(file, "utf8"); } catch { return ""; } }
    writeFileSync(`${file}.web-tmp`, text);
    renameSync(`${file}.web-tmp`, file);
    return text;
  }

  /** A row changed on the web, at a level ("all", a space's id, "m:<machine>"): its new words, written as the value
   *  the file keeps. null: back to what it follows. scope: the space's name, machine and repo folder (herdr-task
   *  finds a space's settings by its folder). */
  set(key: string, word: string | null, level = "all", scope?: Scope | null) {
    // a machine's own row on the Machines page: machine.<field>@<machine>
    const atMachine = /^(machine\.[a-z_]+)@([\w.-]+)$/.exec(key);
    if (atMachine) { key = atMachine[1]; level = `m:${atMachine[2]}`; }
    const file = readSettings();
    const next = structuredClone(file);
    const machine = level.startsWith("m:") ? (level.slice(2) === this.host ? LOCAL : level.slice(2)) : null;
    const space = level !== "all" && !machine ? level : null;
    // only a machine there is (this computer, or one connected), and keys that are plain names
    if (machine !== null && (!SAFE(machine) || (machine !== LOCAL && !this.machineNames.includes(machine)))) throw new Error("That machine isn't connected.");
    if (space && (!SAFE(space) || !scope)) throw new Error("That space isn't here any more.");
    if (space && !scope) throw new Error("That space isn't here any more.");
    // the object this level holds its values in
    const target = () => {
      if (!space) return (next.everywhere ??= {});
      const own = ((next.spaces ??= {})[space] ??= {});
      if (scope?.folder) own.folder = scope.folder;
      own.name = scope?.name ?? own.name;
      if (scope?.machine) own.machine = scope.machine;
      return own;
    };
    const put = (section: string, field: string | null, value: unknown) => {
      const t = target();
      if (field === null) { if (value === null) delete t[section]; else t[section] = value; return; }
      if (value === null) { if (t[section]) { delete t[section][field]; if (!Object.keys(t[section]).length) delete t[section]; } return; }
      t[section] = { ...(t[section] ?? {}), [field]: value };
    };

    const [section, field] = key.split(".");
    const task = TASK_ROWS.find(([s, f]: any) => `${s}.${f}` === key);
    if (machine !== null || key.startsWith("machine.")) {
      if (!key.startsWith("machine.")) throw new Error("That setting can't be changed here.");
      const layer = machine ? ((next.machines ??= {})[machine] ??= {}) : (next.everywhere ??= {});
      if (field === "home") {
        if (!machine) throw new Error("Home Assistant is set per machine.");
        const on = word === "on";
        if (on === (machine === LOCAL)) delete layer.home; else layer.home = on;
      } else {
        const l = LIMITS.find((x) => x.field === field);
        let v: unknown;
        if (word === null) v = undefined;
        else if (l) v = word === "off" || word === "" ? null : Math.max(l.min, Math.min(l.max, Number(word))) / l.scale;
        else if (field === "low_priority") v = word === "on";
        else if (field === "worker_memory") { const n = word === "Off" ? 0 : parseInt(word, 10); v = CAPS.includes(n) ? n : NaN; }
        else throw new Error("That setting can't be changed here.");
        if (typeof v === "number" && !Number.isFinite(v)) throw new Error("Not one of its choices.");
        const m = { ...(layer.machine ?? {}) };
        if (v === undefined) delete m[field]; else m[field] = v;
        if (Object.keys(m).length) layer.machine = m; else delete layer.machine;
      }
      if (machine && !Object.keys(layer).length) delete next.machines[machine];
    } else if (task) {
      const [, , , choices] = task;
      let value = word === null ? null : valueFor(choices, word);
      if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) throw new Error("Not one of its choices.");
      if (!Array.isArray(choices) && value !== null) value = Math.max(choices.min, Math.min(choices.max, Math.round(value)));
      put(section, field, value);
    } else if (section === "tasks" && /^(start|finish)_notes$/.test(field)) {
      put("tasks", field, word === null ? null : word.slice(0, 8000));
    } else if (section === "role" && ROLES.some((r) => r.id === field)) {
      // a role's agent: { agent, model, effort, fast } as the window's model button keeps it
      let v: any = null;
      if (word !== null) {
        try { v = JSON.parse(word); } catch { throw new Error("Not an agent."); }
        const ok = (x: unknown) => x == null || (typeof x === "string" && /^[\w.\[\]-]{1,60}$/.test(x));
        if (!["claude", "codex"].includes(v?.agent) || !ok(v.model) || !ok(v.effort)) throw new Error("Pick Claude Code or Codex.");
        // the permission mode isn't picked on the web: the one it had stays (null: the CLI's own default)
        const was = (space ? file.spaces?.[space] : file.everywhere)?.[field];
        v = { agent: v.agent, model: v.model ?? null, effort: v.effort ?? null, fast: !!v.fast, perm: was?.agent === v.agent ? was.perm ?? null : null };
      }
      put(field, null, v);
    } else if (key === "backup.agent") {
      // off is "off"; on follows what it would get anyway when that is on, else names the other CLI (as the window's)
      const parent = space ? file.everywhere?.backup?.agent ?? null : null;
      const worker = (space ? file.spaces?.[space]?.worker?.agent : null) ?? file.everywhere?.worker?.agent ?? "claude";
      put("backup", "agent", word === null ? null : word === "off" ? "off" : parent === "off" ? (worker === "codex" ? "claude" : "codex") : null);
    } else throw new Error("That setting can't be changed here.");

    writeSettings(next);
    this.read();
  }
}
