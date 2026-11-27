// Shepherdr's settings file, ~/.config/shepherdr/settings.json, read and written here: its rows as sections (core/settings.js:
// their words and choices), and a change (the `setting` action: a voice call, an agent) written back to the same
// file, keeping everything else in it. herdr-task reads the file each time. The web app's own settings window shows
// snapshot.config (service/next.ts), which reads and writes this same file.
// Levels: Everywhere ("everywhere"), a space ("spaces"[its id], with its repo folder, which is how herdr-task finds
// it), and for the Machines page each machine ("machines"[its name, "local" here]).
// Gone with 3.2 and ignored where a file still has them: Autopilot ("autopilot"), "Tasks at once"
// (tasks.max_running), the add-ons' "off" and Notify; with SHEP-319, Instructions ("instructions", everywhere and per
// space: the update keeps the words in a plain file beside this one).
import { existsSync, readFileSync, renameSync, statSync, watch, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { HOME, settingsFile, where, writableSettings } from "./paths.ts";
import * as C from "../core/settings.js";
import { SH } from "../core/paths.js";
import * as M from "../core/machines.js";
import * as HC from "../core/host.js";
import type { SettingRow, SettingSection } from "../web/shared/types.ts";

const { TASK_ROWS, DEFAULTS, wordFor, valueFor, ROLES: CORE_ROLES, NOTES: CORE_NOTES, ABOUT, BACKUP, REACTIONS, SUGGESTIONS, FEEDBACK, feedbackRepo, upgradeReactions, BASE, BRANCH, branchPattern, FLAGS, flagWords, MACHINES, OLD_NAMES, SECTIONS,
  WEB, modelLabel, roleSel, otherCli, otherCliWords, backupProblem, homeAbout, webState, fromWord, LOADING_AGENTS, RESET, machineLabel } = C as any;
const { HOLD } = M as any;
const TEMPLATES = join(HOME, ".config", "herdr-core", "templates");
// herdr-task's check of each machine's CLIs (installed, signed in), and its home round (each machine's home space)
const CLI_CHECK = where()["cli-check"];
const HOME_ROUND = join(where().tasks, ".home.json");
const LOCAL = "local";
const { SERVE } = HC as any;
/** Settings › Web's Serve from, as the service tells it (service/main.ts serveNow) */
export type Serve = { rows: { name: string; here: boolean; state: string; os: string | null; serves: boolean; label: string }[]; host: string | null; reachable: boolean; moving: string | null; error: string | null };
const title = (id: string) => SECTIONS.find((s: any) => s.id === id).title as string;
const readJson = (f: string) => { try { return JSON.parse(readFileSync(f, "utf8")) ?? {}; } catch { return {}; } };

/** A space Settings can scope to: its id (machine/id for another machine's), name, machine, and repo folder; repo: the
 *  key its repo's task settings are kept under (SHEP-335: settings.json "repos", core/host.js repoKey). */
export type Scope = { id: string; name: string; machine: string | null; folder?: string | null; repo?: string | null };
// SHEP-335: the sections that shape a task, kept per repo, not per space
export const REPO_SECTIONS = ["tasks", "worker", "reviewer"];
/** The repo's own layer in a settings file being changed (made when new). A file not moved yet (the update moves them):
 *  the task settings the space `from` still holds go along first, so a save never drops what its tasks had. */
export function repoLayer(next: any, key: string, from?: string | null): any {
  const repos = (next.repos ??= {});
  if (!repos[key]) {
    repos[key] = {};
    const sp = from ? next.spaces?.[from] : null;
    if (sp && typeof sp === "object") for (const sec of REPO_SECTIONS) if (sec in sp) { repos[key][sec] = sp[sec]; delete sp[sec]; }
  }
  return repos[key];
}

export const ROLES: { id: string; title: string; about: string; file: string; told: string }[] = CORE_ROLES;
const NOTES: { id: string; field: string; mono?: boolean; title: string; about: string; example: string }[] = CORE_NOTES;
// Machines: when new tasks wait (each a percent; CPU as a share of all cores), and how task agents run
const LIMIT_STEPS: Record<string, { min: number; max: number; step: number; scale: number }> = {
  start_memory: { min: 10, max: 100, step: 5, scale: 1 },
  start_load: { min: 25, max: 400, step: 25, scale: 100 },
  start_disk: { min: 10, max: 100, step: 5, scale: 1 },
};
const LIMITS = MACHINES.limits.map((l: any) => ({ ...l, label: l.title, ...LIMIT_STEPS[l.field] })) as { field: string; label: string; about: string; min: number; max: number; step: number; scale: number }[];
// a stepper's choices in words, low to high (the window's − and + step through them)
const range = (lo: number, hi: number, by: number, word: (n: number) => string) => Array.from({ length: Math.floor((hi - lo) / by) + 1 }, (_, i) => word(lo + i * by));
const CAPS = [0, 1, 2, 4, 8, 16, 32];
const FIELDS = ["start_memory", "start_load", "start_disk", "low_priority", "worker_memory"];
const MACHINE_DEFAULTS: Record<string, unknown> = { ...HOLD, low_priority: true, worker_memory: 0 };
const ON = (v: unknown) => (v ? "on" : "off");

// the window's push to other machines (mods/shepherdr-settings): each gets Everywhere, its machine's and its spaces'
// (by their ids there), marked so it knows which machine it is; a file there without the mark is that machine's own
// (its settings file wherever that machine keeps it: Shepherdr's folders, or ~/.herdr on an older one: core/paths.js SH)
export const PUSH = `${SH}f="$SHEP_SETTINGS"; mkdir -p "$(dirname "$f")" || exit 1
if [ -f "$f" ] && ! grep -q '"pushed_from"' "$f"; then echo own; exit 0; fi
if [ -f "$f" ] && [ "$(cat "$f")" = "$1" ]; then exit 0; fi
umask 077; printf '%s\\n' "$1" > "$f.tmp" && mv "$f.tmp" "$f"`;
/** What one other machine is sent. */
export function pushBody(file: any, m: string) {
  const spaces = Object.fromEntries(Object.entries(file.spaces ?? {}).filter(([id]) => id.startsWith(`${m}/`)).map(([id, v]) => [id.split("/").pop(), v]));
  // SHEP-335: its repos' task settings, by their folder there
  const repos = Object.fromEntries(Object.entries(file.repos ?? {}).filter(([k]) => k.startsWith(`${m}:`)).map(([k, v]) => [k.slice(m.length + 1), v]));
  return JSON.stringify({ version: 1, pushed_from: "herdr-app", here: m, everywhere: file.everywhere ?? {}, machines: file.machines?.[m] ? { [m]: file.machines[m] } : {}, spaces, ...(Object.keys(repos).length ? { repos } : {}) }, null, 2);
}

/** Writes the whole file as the window does (version 1), then tells whoever pushes it to other machines. */
/** The file as it is: {} only when there is none yet. Unreadable (half-written, hand-broken) refuses, so a change
 *  never writes a file with everything else gone. */
export function readSettings(): any {
  let text: string;
  try { text = readFileSync(settingsFile(), "utf8"); } catch (e: any) { if (e?.code === "ENOENT") return {}; throw new Error("The settings file can't be read now. Try again."); }
  // SHEP-42's assistant.reactions comes back as agents.reactions, so a change writes it there
  try { const f = JSON.parse(text); if (f && typeof f === "object" && !Array.isArray(f)) return upgradeReactions(f); } catch {}
  throw new Error(`The settings file can't be read now (${settingsFile()} isn't valid JSON).`);
}
const SAFE = (k: string) => !["__proto__", "constructor", "prototype"].includes(k);

export function writeSettings(next: any) {
  next.version = 1;
  const file = writableSettings();
  writeFileSync(`${file}.web-tmp`, JSON.stringify(next, null, 2) + "\n");
  renameSync(`${file}.web-tmp`, file);
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
    // the file by the name it has now (SHEP-263: this still waited for "shepherdr.json", its name before SHEP-141, so a
    // change made in the window's Settings never reached the service: an Assistant started from the web ran on what
    // Settings said when the service started). A writer renames a temporary file onto it, so any name that starts
    // with the file's counts, and one the watcher can't name too.
    const file = settingsFile();
    if (existsSync(dirname(file))) watch(dirname(file), (_e, name) => { if (!name || String(name).startsWith(basename(file))) this.read(); });
  }

  /** The file changed since it was read (its time or size): read again. Asked before a start reads a role, so one
   *  never runs on settings a missed watch event left stale. */
  private stamp = "";
  private fresh() {
    let now = "";
    try { const st = statSync(settingsFile()); now = `${st.mtimeMs}:${st.size}`; } catch {}
    if (now !== this.stamp) this.read();
  }

  private read() {
    let next: any = {};
    try { const st = statSync(settingsFile()); this.stamp = `${st.mtimeMs}:${st.size}`; } catch { this.stamp = ""; }
    try { next = upgradeReactions(JSON.parse(readFileSync(settingsFile(), "utf8")) ?? {}); } catch {}
    if (JSON.stringify(next) === JSON.stringify(this.file)) return;
    this.file = next;
    for (const fn of this.listeners) fn();
  }

  /** File-only so the owner can change it even when the web app refuses entry. */
  webIgnoreAccounts(): readonly string[] {
    this.fresh();
    const names: unknown = this.file.everywhere?.web?.ignore_accounts;
    if (!Array.isArray(names) || !names.every((name) => typeof name === "string" && /^\S+$/.test(name) && !/^\d+$/.test(name))) {
      return [];
    }
    return names;
  }

  private layer(scope: string | null, section?: string) {
    if (!scope) return this.file.everywhere;
    // a task section: the repo the space sits on (a file not moved yet: the space's own, as herdr-task reads it)
    if (section && REPO_SECTIONS.includes(section)) {
      const key = this.scopes.find((s) => s.id === scope)?.repo;
      if (key && this.file.repos?.[key]) return this.file.repos[key];
    }
    return this.file.spaces?.[scope];
  }
  /** A field as a scope sees it, as the window's chain: its own, else what its machine set for its spaces before
   *  (the old machine scope), else Everywhere's, else the default; whether the scope sets it; and what it follows. */
  private pick(scope: string | null, section: string, field: string | null) {
    const at = (l: any) => { const v = field ? l?.[section]?.[field] : l?.[section]; return v === null ? undefined : v; };
    const m = scope ? (scope.includes("/") ? scope.split("/")[0] : LOCAL) : null;
    const own = scope ? at(this.layer(scope, section)) : undefined, mach = m ? at(this.file.machines?.[m]) : undefined, every = at(this.file.everywhere);
    const dflt = field ? DEFAULTS[section]?.[field] ?? null : null;
    const parent = mach ?? every ?? dflt;
    return { value: scope ? own ?? parent : every ?? dflt, own: own !== undefined, parent, level: mach !== undefined ? "machine" : "everywhere", machine: m };
  }

  /** The agent a role runs in a space (null: Everywhere's), as the window's chat starts it (lib/coordinator.js
   *  shepherdrFor): { agent, model, effort, fast, perm }, or null when none is set (the template's own command). */
  role(scope: string | null, role: string): any {
    this.fresh();
    const v = this.pick(scope, role, null).value;
    return v && typeof v === "object" && v.agent ? v : null;
  }

  /** What the agents offer (core/settings.js choicesFrom: menus, permission defaults, what an unset role runs), set by
   *  the service from each CLI's own settings; null until read. */
  choices: any = null;
  /** The branch a space's folder has checked out (Base branch's empty box says it), by space id; fetchBranch reads one. */
  branches: Record<string, string> = {};
  fetchBranch: ((s: Scope) => Promise<string>) | null = null;
  private asked = new Set<string>();

  /** Every page at every level: Agents and Tasks (Everywhere and each space), Machines (all and each machine), Web.
   *  web: what the service last said of the web app (web.json: on, link, why, its QR picture's SVG). */
  sections(web: { on: boolean; link: string | null; why: string | null; qr?: string | null; serve?: Serve } | string | null, spaces: Scope[] = [], machines: string[] = [], host = LOCAL): SettingSection[] {
    this.host = host;
    this.scopes = spaces;
    this.machineNames = machines;
    // herdr-task's CLI check and home round, read again at most every 10 s (the snapshot is built often)
    if (Date.now() - this.readAt > 10_000) {
      this.readAt = Date.now();
      this.checks = readJson(CLI_CHECK)?.machines ?? {};
      this.homes = readJson(HOME_ROUND)?.machines ?? {};
    }
    const out: SettingSection[] = [];
    for (const s of [null, ...spaces]) out.push(this.agents(s), this.tasks(s));
    // Machines, as the window's page: the limits for every machine, then each machine's block
    out.push({ name: title("machines"), level: "all", rows: [null, LOCAL, ...machines].flatMap((m) => this.machines(m)) });
    out.push(this.web(typeof web === "string" ? { on: true, link: web, why: null } : web ?? { on: true, link: null, why: "Tailscale isn't running here" }));
    return out;
  }
  private checks: Record<string, any> = {};
  private readAt = 0;
  private homes: Record<string, any> | null = null;

  /** Web, as the window's page: the web app's state, then its link (Copy) and its QR code to open it on a phone. */
  private web(w: { on: boolean; link: string | null; why: string | null; qr?: string | null; serve?: Serve }): SettingSection {
    const rows: SettingRow[] = [{ label: WEB.title, key: "", value: "", hint: webState(true, w), fixed: true }];
    // Serve from (core/host.js): the machine serving it now, and every connected one to move it to
    const sv = w.serve;
    if (w.on && sv?.rows.length) {
      const now = sv.rows.find((r) => r.serves) ?? sv.rows[0];
      rows.push({ label: SERVE.title, key: "web.serve", value: now.label, hint: SERVE.about, disabled: !!sv.moving,
        options: sv.rows.filter((r) => r.serves || r.state === "connected").map((r) => r.label), ...(sv.error ? { warn: SERVE.failed(sv.error) } : {}) });
    }
    const shown = w.on && w.link && !w.why;
    if (shown) rows.push({ label: WEB.link, key: "web.link", value: "", hint: w.link!, copy: w.link!, fixed: true });
    return { name: title("web"), global: true, rows, ...(shown && w.qr ? { qr: w.qr, qrTitle: WEB.phone } : {}) };
  }

  /** Under a row, as the window's: in a space "Changed here · Reset" or "Same as everywhere"; on Everywhere the spaces
   *  that use their own (section, field: where the row's value is kept). */
  private follows(scope: Scope | null, p: { own: boolean; parent: unknown; level?: string; machine?: string | null }, word: (v: any) => string, section?: string, field?: string | null): Partial<SettingRow> {
    if (!scope) {
      if (!section) return {};
      const others = this.scopes.filter((sc) => { const l = this.file.spaces?.[sc.id]; const v = field ? l?.[section]?.[field] : l?.[section]; return v !== undefined && v !== null; })
        .map((sc) => ({ id: sc.id, name: sc.name }));
      return others.length ? { others } : {};
    }
    // "Inherited from Everywhere", or the machine a value set before still comes from
    const from = fromWord(p.level, p.machine);
    return p.own ? { inherits: { value: word(p.parent), from } } : { from };
  }
  private scopes: Scope[] = [];

  private agents(s: Scope | null): SettingSection {
    const scope = s?.id ?? null;
    const worker = this.pick(scope, "worker", null).value?.agent ?? "claude";
    const menus = this.choices?.menus;
    const rows: SettingRow[] = ROLES.map((r) => {
      const p = this.pick(scope, r.id, null);
      // as the window's model button: what it runs, "Opus 5.5 · 1M · High"; an unset Reviewer says "Other CLI (Codex)"
      const button = (v: any) => {
        if (!this.choices) return LOADING_AGENTS;
        const { sel, unset } = roleSel(r.id, v ?? null, this.choices, worker);
        return unset && r.id === "reviewer" && sel ? otherCliWords(otherCli(worker)) : sel ? modelLabel(menus, sel) : LOADING_AGENTS;
      };
      const { sel, unset } = roleSel(r.id, p.value ?? null, this.choices, worker);
      // on Everywhere its row has "Edit instructions" too (the same for every space), and a set Reviewer "Use other CLI"
      return { label: r.title, key: `role.${r.id}`, value: button(p.value), hint: r.about,
        agent: { role: r.id, pick: p.value ?? null, sel, unset, other: !s && r.id === "reviewer" && !unset },
        ...(s ? {} : { file: r.file }), ...this.follows(s, p, button, r.id, null) } as SettingRow;
    });
    // Backup: the other CLI takes over a task once when its agent can't go on (on: unset or a CLI; off: "off"); a
    // machine where the other CLI can't is one more line under it
    const b = this.pick(scope, "backup", "agent");
    const on = b.value !== "off";
    const problem = on ? backupProblem(this.checks, s ? b.machine : null, b.value && b.value !== "off" ? b.value : otherCli(worker)) : "";
    rows.push({ label: BACKUP.title, key: "backup.agent", value: ON(on), options: ["on", "off"], hint: problem ? `${BACKUP.about}\n${problem}` : BACKUP.about,
      ...this.follows(s, b, (v) => ON(v !== "off"), "backup", "agent") });
    // Reactions, for every agent: each reacts to some of your messages with an emoji (herdr-task's reactions.py)
    const re = this.pick(scope, "agents", "reactions");
    rows.push({ label: REACTIONS.title, key: "agents.reactions", value: ON(re.value !== false), options: ["on", "off"], hint: REACTIONS.about,
      ...this.follows(s, re, (v) => ON(v !== false), "agents", "reactions") });
    // Suggested replies: the agent's guesses at what you'd send next, bubbles above the box (SHEP-186; the agents' side is herdr-task's settings)
    const sg = this.pick(scope, "agents", "suggestions");
    rows.push({ label: SUGGESTIONS.title, key: "agents.suggestions", value: ON(sg.value !== false), options: ["on", "off"], hint: SUGGESTIONS.about,
      ...this.follows(s, sg, (v) => ON(v !== false), "agents", "suggestions") });
    // Feedback offers: agents offer once to file a problem in Shepherdr itself, only on your yes (herdr-task's feedback.py);
    // the repo it files to is Everywhere's only
    const fb = this.pick(scope, "agents", "feedback");
    rows.push({ label: FEEDBACK.title, key: "agents.feedback", value: ON(fb.value !== false), options: ["on", "off"], hint: FEEDBACK.about,
      ...this.follows(s, fb, (v) => ON(v !== false), "agents", "feedback") });
    if (!s) {
      const repo = this.pick(null, "agents", "feedback_repo");
      rows.push({ label: FEEDBACK.repoTitle, key: "agents.feedback_repo", value: String(repo.value ?? ""), text: true, hint: FEEDBACK.repoAbout,
        placeholder: FEEDBACK.repo } as SettingRow);
    }
    return { name: title("agents"), level: scope ?? "all", rows };
  }

  private tasks(s: Scope | null): SettingSection {
    const scope = s?.id ?? null;
    // Must fix shows only while there is a review
    const rounds = Number(this.pick(scope, "tasks", "review_rounds").value) || 0;
    const rows: SettingRow[] = TASK_ROWS.filter(([, field]: any) => field !== "must_fix" || rounds > 0).map(([section, field, label, choices]: any) => {
      const p = this.pick(scope, section, field);
      const words = (v: any) => wordFor(choices, v);
      const key = `${section}.${field}`;
      return Array.isArray(choices)
        ? { label, key, value: words(p.value), options: choices.map(([, w]: any) => w), hint: ABOUT[key], ...this.follows(s, p, words, section, field) }
        // a count: − and + step through it
        : { label, key, value: String(p.value), steps: range(choices.min, choices.max, 1, String), hint: ABOUT[key], ...this.follows(s, p, String, section, field) };
    });
    // Base branch, a space's only (as the window's): its box, empty for the branch the folder has checked out
    if (s) {
      const p = this.pick(scope, "tasks", "base");
      if (!(s.id in this.branches) && !this.asked.has(s.id) && this.fetchBranch) {
        this.asked.add(s.id);
        void this.fetchBranch(s).then((b) => { this.branches[s.id] = b; for (const fn of this.listeners) fn(); }).catch(() => {});
      }
      const at = rows.findIndex((r) => r.key === "automations.enabled");
      rows.splice(at, 0, { label: BASE.title, key: "tasks.base", value: String(p.value ?? "").trim(), text: true, hint: BASE.about,
        placeholder: BASE.empty(this.branches[s.id] ?? ""), ...this.follows(s, p, (v) => v || BASE.follows, "tasks", "base") });
    }
    // Branch names (#570): Everywhere's or a space's own pattern for new task branches; empty: task/{n}-{slug}
    {
      const p = this.pick(scope, "tasks", "branch");
      const at = rows.findIndex((r) => r.key === "automations.enabled");
      rows.splice(at, 0, { label: BRANCH.title, key: "tasks.branch", value: String(p.value ?? "").trim(), text: true, hint: BRANCH.about,
        placeholder: BRANCH.pattern, ...this.follows(s, p, (v) => v || BRANCH.pattern, "tasks", "branch") });
    }
    // Extra flags (#1222), one box per CLI: Everywhere's or a space's own; a list (none: [] says "none")
    for (const [cli, label] of FLAGS.rows) {
      const p = this.pick(scope, "tasks", `${cli}_flags`);
      const words = (v: any) => (Array.isArray(v) ? (v.length ? flagWords(v) : FLAGS.none) : "");
      const at = rows.findIndex((r) => r.key === "automations.enabled");
      rows.splice(at, 0, { label, key: `tasks.${cli}_flags`, value: words(p.value), text: true, hint: FLAGS.about(label.replace(/ flags$/, "")),
        placeholder: FLAGS.example[cli], ...this.follows(s, p, (v) => words(v) || FLAGS.none, "tasks", `${cli}_flags`) });
    }
    for (const n of NOTES) {
      const p = this.pick(scope, "tasks", n.field);
      rows.push({ label: n.title, key: `tasks.${n.field}`, value: p.value ?? "", multiline: true, ...(n.mono ? { mono: true } : {}), hint: n.about, placeholder: n.example, ...this.follows(s, p, (v) => v ?? "", "tasks", n.field) });
    }
    return { name: title("tasks"), level: scope ?? "all", rows };
  }

  /** Machines: when new tasks wait and how task agents run, for every machine (null) or one's own; a machine's page
   *  has its Home Assistant too. */
  private machines(m: string | null): SettingRow[] {
    const every = this.file.everywhere?.machine ?? {}, layer = m ? this.file.machines?.[m] ?? {} : {};
    const own = m ? layer.machine ?? {} : every;
    const base = (f: string) => (f in every ? every[f] : MACHINE_DEFAULTS[f]);
    const val = (f: string) => (f in own ? own[f] : base(f));
    // as the window's: on a machine "Changed here · Reset" or "Same as all machines"; for all machines how many use their own
    const ownCount = (f: string) => Object.values(this.file.machines ?? {}).filter((x: any) => f in (x?.machine ?? {})).length;
    const from = (f: string, word: (v: any) => string): Partial<SettingRow> => (!m ? (ownCount(f) ? { machinesOwn: ownCount(f) } : {}) : f in own ? { inherits: { value: word(base(f)), from: "all machines" } } : { from: "all machines" });
    // a machine without limits of its own shows "Limits · Same as all machines" and Set its own, which opens its rows
    const ownLimits = !!m && FIELDS.some((f) => f in own);
    const hidden = m && !ownLimits ? { hidden: `limits@${m}` } : {};
    // a machine's own rows say which machine (key@machine); the heading is its name, as the window's blocks
    const at = m ? `@${m}` : "";
    const group = m ? machineLabel(m) : MACHINES.heading;
    // the window's steppers: "Off" or "80%", − and + stepping through the choices (from the default when off)
    const rows: SettingRow[] = LIMITS.map((l) => {
      const word = (v: any) => (v == null ? "Off" : `${Math.round(Number(v) * l.scale)}%`);
      return { label: l.label, key: `machine.${l.field}${at}`, value: word(val(l.field)), hint: l.about, steps: range(l.min, l.max, l.step, (n) => `${n}%`),
        stepFrom: word(HOLD[l.field]), group, ...hidden, ...from(l.field, word) };
    });
    rows.push({ label: MACHINES.low.title, key: `machine.low_priority${at}`, value: ON(val("low_priority") !== false), options: ["on", "off"],
      hint: MACHINES.low.about, group, ...hidden, ...from("low_priority", (v) => ON(v !== false)) });
    const gb = (v: any) => (Number(v) ? `${Number(v)} GB` : "Off");
    rows.push({ label: MACHINES.cap.title, key: `machine.worker_memory${at}`, value: gb(val("worker_memory")), steps: CAPS.map(gb),
      hint: MACHINES.cap.about, group, ...hidden, ...from("worker_memory", gb) });
    if (m && !ownLimits) rows.push({ label: MACHINES.own.title, key: "", value: "", hint: MACHINES.own.about, reveals: `limits@${m}`, group } as SettingRow);
    // what a machine set for all its spaces before (the old machine scope): it still applies there, until Reset
    const old = m ? Object.entries(layer).filter(([k]) => !["machine", "home"].includes(k))
      .flatMap(([k, v]: [string, any]) => (["tasks", "automations"].includes(k) && v && typeof v === "object" ? Object.keys(v).map((f) => (k === "automations" ? k : f)) : [k])) : [];
    if (old.length) rows.push({ label: MACHINES.old.title, key: `machine.old${at}`, value: "", button: RESET, group,
      hint: MACHINES.old.about([...new Set(old.map((x) => OLD_NAMES[x] ?? x))]) } as SettingRow);
    if (m) {
      // Home Assistant: its line says what herdr-task's home round last found; a machine without a home space has
      // Make home space beside the switch
      const home = typeof layer.home === "boolean" ? layer.home : m === LOCAL;
      const st = this.homes?.[m];
      const missing = home && !st?.space && !st?.error && this.homes !== null;
      rows.unshift({ label: MACHINES.home.title, key: `machine.home${at}`, value: ON(home), options: ["on", "off"], group, details: m,
        hint: homeAbout(home, st), ...(missing ? { extra: { label: MACHINES.home.make, key: `machine.makehome${at}` } } : {}) });
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
    const [section, field] = key.split(".");
    // SHEP-335: a task's setting set from a space goes to the repo it sits on
    const toRepo = !!space && (section === "tasks" || (section === "role" && (field === "worker" || field === "reviewer")));
    if (toRepo && !scope?.repo) throw new Error("This space isn't in a repo or folder tasks can use.");
    const target = () => {
      if (!space) return (next.everywhere ??= {});
      if (toRepo) return repoLayer(next, scope!.repo!, space);
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

    const task = TASK_ROWS.find(([s, f]: any) => `${s}.${f}` === key);
    if (machine !== null || key.startsWith("machine.")) {
      if (!key.startsWith("machine.")) throw new Error("That setting can't be changed here.");
      const layer = machine ? ((next.machines ??= {})[machine] ??= {}) : (next.everywhere ??= {});
      if (field === "old") {
        // Reset of what a machine set for all its spaces before: only its own rows and Home Assistant stay
        if (!machine) throw new Error("That is set per machine.");
        for (const k of Object.keys(layer)) if (!["machine", "home"].includes(k)) delete layer[k];
      } else if (field === "home") {
        if (!machine) throw new Error("Home Assistant is set per machine.");
        const on = word === "on";
        if (on === (machine === LOCAL)) delete layer.home; else layer.home = on;
      } else {
        const l = LIMITS.find((x) => x.field === field);
        let v: unknown;
        if (word === null) v = undefined;
        else if (l) v = /^off$/i.test(word) || word === "" ? null : Math.max(l.min, Math.min(l.max, Number.parseFloat(word))) / l.scale;
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
    } else if (key === "tasks.base") {
      // a space's own (the service checked the branch is there first); empty: back to the folder's branch
      if (!space) throw new Error("A base branch is set per space.");
      put("tasks", "base", word?.trim() ? word.trim() : null);
    } else if (key === "tasks.claude_flags" || key === "tasks.codex_flags") {
      // herdr-task's own list (service/main.ts asked `herdr-task flags` first); null: back to the level above
      let v: unknown = null;
      if (word !== null && word.trim()) {
        try { v = JSON.parse(word); } catch { throw new Error("Not a list of flags."); }
        if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x.startsWith("-"))) throw new Error("Not a list of flags.");
      }
      put("tasks", field, v);
    } else if (key === "tasks.branch") {
      // a pattern herdr-task can fill in (core/settings.js branchPattern); empty: back to the level above
      const v = word?.trim() ?? "";
      const why = branchPattern(v);
      if (why) throw new Error(why);
      put("tasks", "branch", v || null);
    } else if (section === "tasks" && NOTES.some((n) => n.field === field)) {
      put("tasks", field, word === null ? null : word.slice(0, 8000));
    } else if (section === "role" && ROLES.some((r) => r.id === field)) {
      // a role's agent: { agent, model, effort, fast } as the window's model button keeps it
      let v: any = null;
      if (word !== null) {
        try { v = JSON.parse(word); } catch { throw new Error("Not an agent."); }
        const ok = (x: unknown) => x == null || (typeof x === "string" && /^[\w.\[\]-]{1,60}$/.test(x));
        if (!["claude", "codex"].includes(v?.agent) || !ok(v.model) || !ok(v.effort)) throw new Error("Pick Claude Code or Codex.");
        // its permission mode, as the window's Permissions pick (one of the CLI's modes; none: the CLI's own default)
        const PERM: Record<string, string[]> = { claude: ["manual", "auto", "acceptEdits", "plan", "bypassPermissions"], codex: ["read-only", "auto", "approve", "full"] };
        if (v.perm != null && !PERM[v.agent].includes(v.perm)) throw new Error("Not one of its permission modes.");
        v = { agent: v.agent, model: v.model ?? null, effort: v.effort ?? null, fast: v.fast === "ultrafast" && v.agent === "codex" ? "ultrafast" : !!v.fast, perm: v.perm ?? null };
      }
      put(field, null, v);
    } else if (key === "agents.reactions" || key === "assistant.reactions") {
      // on or off (assistant.reactions: its key before it was for every agent); the same as what this level would
      // inherit unsets it, so it follows again (as the window's)
      if (word !== null && word !== "on" && word !== "off") throw new Error("Not one of its choices.");
      const parent = space ? file.everywhere?.agents?.reactions ?? DEFAULTS.agents.reactions : DEFAULTS.agents.reactions;
      put("agents", "reactions", word === null || (word === "on") === parent ? null : word === "on");
    } else if (key === "agents.suggestions") {
      // on or off; the same as what this level would inherit unsets it, so it follows again (as Reactions)
      if (word !== null && word !== "on" && word !== "off") throw new Error("Not one of its choices.");
      const parent = space ? file.everywhere?.agents?.suggestions ?? DEFAULTS.agents.suggestions : DEFAULTS.agents.suggestions;
      put("agents", "suggestions", word === null || (word === "on") === parent ? null : word === "on");
    } else if (key === "agents.feedback") {
      // on or off; the same as what this level would inherit unsets it, so it follows again (as Reactions)
      if (word !== null && word !== "on" && word !== "off") throw new Error("Not one of its choices.");
      const parent = space ? file.everywhere?.agents?.feedback ?? DEFAULTS.agents.feedback : DEFAULTS.agents.feedback;
      put("agents", "feedback", word === null || (word === "on") === parent ? null : word === "on");
    } else if (key === "agents.feedback_repo") {
      // Everywhere's only: owner/name (a github.com link is made one); empty goes back to Shepherdr's own repo
      if (space) throw new Error("The feedback repo is set for every space at once.");
      const repo = feedbackRepo(word ?? "");
      if (repo === null) throw new Error(FEEDBACK.bad);
      put("agents", "feedback_repo", repo || null);
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
