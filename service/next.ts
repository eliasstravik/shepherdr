// What the 3.2 app shows on top of the model: Everything and which spaces are home or archived, each task's facts
// (web/shared/view.ts works its status out from them by plain rules: no model in that path), the settings window's
// values for everything and each space, the picker's lists read from each agent's own catalog, the plans' use and
// the warnings line. And the app's own actions on them. The service only says what is so; behaviour stays words the
// agents read (herdr-task turns Settings into lines of a brief).
import type { Automation, Catalog, CatalogAgent, Config, LevelConfig, Place, Snapshot, Task, AgentPick } from "../web/shared/types.ts";
import { HOME } from "./paths.ts";
import { everythingOf, sameFolder } from "../core/spaces.js";
import { readSettings, repoLayer, REPO_SECTIONS, writeSettings } from "./settings.ts";
import { repoKey, repoOf } from "../core/host.js";

/** the plugins: Tasks, Artifacts, Search and Alerts are always on; the rest each have a switch */
export const PLUGINS: { id: string; name: string; always?: boolean }[] = [
  { id: "tasks", name: "Tasks", always: true }, { id: "artifacts", name: "Artifacts", always: true }, { id: "terminal", name: "Terminal" },
  { id: "screens", name: "Screens" }, { id: "voice", name: "Voice" }, { id: "schedules", name: "Schedules" }, { id: "reactions", name: "Reactions" },
  { id: "search", name: "Search", always: true }, { id: "alerts", name: "Alerts", always: true },
];

function file(): any { try { return readSettings(); } catch { return {}; } }

/** The plugins switched off (Settings › Plugins): left out of the page, their buttons, menu items and settings gone. */
export function offPlugins(): string[] {
  const off = file()?.everywhere?.plugins_off;
  return Array.isArray(off) ? off.filter((id) => PLUGINS.some((p) => p.id === id && !p.always)) : [];
}
export const pluginOn = (id: string) => !offPlugins().includes(id);

/* ---------- settings: everything's, and a space's own on top ---------- */

const ROLE = { Chats: "coordinator", Tasks: "worker", Reviews: "reviewer" } as const;
const MERGE: Record<string, LevelConfig["merge"]> = { ask: "done", checks: "checks", auto: "now" };
const MERGE_BACK: Record<LevelConfig["merge"], string> = { done: "ask", checks: "checks", now: "auto" };
const pickOf = (v: any): AgentPick | null => (v && typeof v === "object" && typeof v.agent === "string" ? { agent: v.agent, model: v.model ?? null, effort: v.effort ?? null, fast: v.fast === "ultrafast" ? "ultrafast" : !!v.fast, perm: v.perm ?? null } : null);

/** What an unset role runs: the first installed agent's own defaults; reviews, the other agent where there is one. */
export type Defaults = { Chats: AgentPick; Tasks: AgentPick; Reviews: AgentPick };

function levelOf(layer: any, base: LevelConfig): { lv: LevelConfig; own: string[] } {
  const own: string[] = [];
  const agents = { ...base.agents };
  for (const [name, key] of Object.entries(ROLE) as [keyof typeof ROLE, string][]) {
    const p = pickOf(layer?.[key]);
    if (p) { agents[name] = p; own.push(`agents.${name}`); }
  }
  const t = layer?.tasks ?? {};
  const has = (k: string) => t[k] !== undefined && t[k] !== null;
  if (has("review_rounds")) own.push("review");
  if (has("merge")) own.push("merge");
  if (has("proof")) own.push("proof");
  return {
    own,
    lv: {
      agents,
      review: has("review_rounds") ? Number(t.review_rounds) > 0 : base.review,
      merge: has("merge") ? MERGE[t.merge] ?? base.merge : base.merge,
      proof: has("proof") ? !!t.proof : base.proof,
    },
  };
}

/** SHEP-335: a repo (or plain folder) tasks work in, on its machine: its key in settings.json "repos" (core/host.js
 *  repoKey), the spaces sitting on it and how many tasks work there. */
export type RepoInfo = { key: string; folder: string; machine: string | null; name: string; spaces: string[]; tasks: number };
const only = (layer: any, keep: (k: string) => boolean) => Object.fromEntries(Object.entries(layer && typeof layer === "object" ? layer : {}).filter(([k]) => keep(k)));
/** A repo's own task settings: its "repos" entry, else (a file not moved yet) the task settings of a space on it. */
export function repoOwn(f: any, r: { key: string; spaces: string[] }): any {
  if (f.repos?.[r.key]) return only(f.repos[r.key], (k) => REPO_SECTIONS.includes(k));
  const sp = r.spaces.map((id) => f.spaces?.[id]).find((l) => l && REPO_SECTIONS.some((k) => k in l));
  return only(sp, (k) => REPO_SECTIONS.includes(k));
}

/** The folder a space's tasks are kept by: its repo's main checkout (from its git's common folder), else its own. */
const repoFolder = (sp: { folder?: string; git?: { repo?: string } | null }) => {
  const repo = sp.git?.repo ?? "";
  return repo.endsWith("/.git") ? repo.slice(0, -5) : sp.folder ?? "";
};
/** A space's repo key (settings.json "repos"), or null when it has no folder. machine: the space's, null here. */
export const spaceRepo = (sp: { folder?: string; machine?: string | null; git?: { repo?: string } | null } | null | undefined) =>
  sp?.folder ? repoKey(sp.machine ?? null, repoFolder(sp)) : null;

/** The repos and folders tasks work in or a space sits on, per machine (spaces: Shepherdr's, their machine null here; tasks:
 *  the snapshot's, `on` their machine by name; host: this machine's name). A space in a repo's subfolder or worktree is
 *  on the repo's main checkout, as herdr-task keys a folder's tasks. Most tasks first. */
export function reposOf(spaces: { id: string; folder?: string; machine?: string | null; git?: { repo?: string } | null; archived?: boolean }[],
  tasks: { on?: string; taskFolder?: string }[], host: string | null): RepoInfo[] {
  const out = new Map<string, RepoInfo>();
  const at = (machine: string | null, folder: string) => {
    const key = repoKey(machine, folder);
    let r = out.get(key);
    if (!r) out.set(key, (r = { key, folder, machine, name: folder.split("/").filter(Boolean).pop() ?? "/", spaces: [], tasks: 0 }));
    return r;
  };
  for (const sp of spaces) if (sp.folder) at(sp.machine ?? null, repoFolder(sp)).spaces.push(sp.id);
  for (const t of tasks) if (t.taskFolder) at(!t.on || t.on === host ? null : t.on, t.taskFolder).tasks++;
  return [...out.values()].sort((a, b) => b.tasks - a.tasks || a.folder.localeCompare(b.folder));
}

export function configOf(input: { defaults: Defaults; spaces: string[]; secrets: { name: string; space: string | null }[]; plans: Config["plans"]; addMachine?: string; desktops?: string[]; repos?: RepoInfo[] }): Config {
  const f = file();
  const start: LevelConfig = { agents: input.defaults, review: false, merge: "done", proof: true };
  const all = levelOf(f.everywhere, start).lv;
  const spaces: Config["spaces"] = {};
  // a space keeps only what is about itself (its Assistant: Chats); its tasks' settings are its repo's
  for (const id of input.spaces) {
    const layer = f.spaces?.[id];
    if (!layer) continue;
    const { lv, own } = levelOf(only(layer, (k) => !REPO_SECTIONS.includes(k)), all);
    if (own.length) spaces[id] = { ...lv, own };
  }
  const known = [...(input.repos ?? [])];
  for (const key of Object.keys(f.repos ?? {})) if (!known.some((r) => r.key === key)) {
    const { machine, folder } = repoOf(key);
    known.push({ key, folder, machine, name: folder.split("/").filter(Boolean).pop() ?? "/", spaces: [], tasks: 0 });
  }
  const repos: Config["repos"] = known.map((r) => { const { lv, own } = levelOf(repoOwn(f, r), all); return { ...r, ...lv, own }; });
  const off = offPlugins();
  return {
    all, spaces, repos,
    secrets: input.secrets.map((s) => ({ name: s.name, scope: s.space ?? "all" })),
    plugins: PLUGINS.map((p) => ({ id: p.id, name: p.name, on: !off.includes(p.id), ...(p.always ? { always: true } : {}) })),
    plans: input.plans,
    ...(input.addMachine ? { addMachine: input.addMachine } : {}),
    ...(input.desktops?.length ? { desktops: input.desktops } : {}),
  };
}

/** One setting changed from the settings window: for everything ("all"), a repo ("repo:<its key>", SHEP-335) or a space;
 *  null puts a row back to Everything's value (Reset). A task's setting asked of a space (a voice call) goes to the repo
 *  it sits on (scope.repo); on a repo, `scope` is a space sitting on it, if any (what a file not moved yet carries). */
export function setConfig(place: string, key: string, value: unknown, scope?: { id: string; name: string; machine: string | null; folder?: string | null; repo?: string | null } | null) {
  const next = structuredClone(file());
  if (key.startsWith("plugin.")) {
    const id = key.slice(7);
    if (!PLUGINS.some((p) => p.id === id && !p.always)) throw new Error("That plugin is always on.");
    const e = (next.everywhere ??= {});
    const off = new Set<string>(Array.isArray(e.plugins_off) ? e.plugins_off : []);
    if (value) off.delete(id); else off.add(id);
    if (off.size) e.plugins_off = [...off]; else delete e.plugins_off;
    return writeSettings(next);
  }
  const all = place === "all";
  const repoPlace = place.startsWith("repo:") ? place.slice(5) : null;
  const forTasks = /^agents\.(Tasks|Reviews)$/.test(key) || ["review", "merge", "proof"].includes(key);
  const repo = repoPlace ?? (forTasks && !all ? scope?.repo ?? null : null);
  if (repo !== null && !/^(\/|[\w.-]+:\/)/.test(repo)) throw new Error("That repo isn't here any more.");
  if (repoPlace && !forTasks) throw new Error("That is set per space.");
  if (!all && !repoPlace && !scope) throw new Error("That space isn't here any more.");
  if (!all && !repoPlace && forTasks && !repo) throw new Error("This space isn't in a repo or folder tasks can use.");
  if (!all && ["__proto__", "constructor", "prototype"].includes(place)) throw new Error("That space isn't here any more.");
  const layer = all ? (next.everywhere ??= {}) : repo ? repoLayer(next, repo, scope?.id ?? null) : ((next.spaces ??= {})[place] ??= {});
  if (!all && !repo) {
    if (scope!.folder) layer.folder = scope!.folder;
    layer.name = scope!.name;
    if (scope!.machine) layer.machine = scope!.machine;
  }
  const task = (field: string, v: unknown) => {
    const t = { ...(layer.tasks ?? {}) };
    if (v === null) delete t[field]; else t[field] = v;
    if (Object.keys(t).length) layer.tasks = t; else delete layer.tasks;
  };
  const m = /^agents\.(Chats|Tasks|Reviews)$/.exec(key);
  if (m) {
    const p = value === null ? null : pickOf(value);
    if (value !== null && (!p || !/^[\w.-]{1,40}$/.test(p.agent) || [p.model, p.effort, p.perm].some((x) => x != null && !/^[\w.\[\]:/ -]{1,80}$/.test(String(x))))) throw new Error("Not an agent.");
    const role = ROLE[m[1] as keyof typeof ROLE];
    if (p) layer[role] = p; else delete layer[role];
  } else if (key === "review") {
    // on: a second agent reviews (the rounds set before, else one); off: none
    const was = Number(layer.tasks?.review_rounds ?? next.everywhere?.tasks?.review_rounds) || 0;
    task("review_rounds", value === null ? null : value ? Math.max(1, was) : 0);
  } else if (key === "merge") {
    if (value !== null && !(String(value) in MERGE_BACK)) throw new Error("Not one of its choices.");
    task("merge", value === null ? null : MERGE_BACK[value as LevelConfig["merge"]]);
  } else if (key === "proof") task("proof", value === null ? null : !!value);
  else throw new Error("That setting can't be changed here.");
  writeSettings(next);
}

/* ---------- the picker's lists ---------- */

const PERM_ABOUT: Record<string, Record<string, string>> = {
  claude: { manual: "Asks before edits and commands", default: "Asks before edits and commands", acceptEdits: "Edits files without asking", plan: "Plans first and changes nothing", auto: "Decides by itself what is safe to run", bypassPermissions: "Never asks" },
  codex: { "read-only": "Reads, and asks before anything else", auto: "Works in the folder, asks before leaving it", full: "Never asks" },
};
const PERM_LABEL: Record<string, string> = { manual: "Default", bypassPermissions: "Bypass" };

/** A machine's agents and their models, from what each agent's own settings and catalog say there (`choices`: per CLI
 *  { kind, name, models, speeds, perms, permDefault }); `known`: the other agents herdr-core can run there. */
export function catalogOf(machine: string, choices: any[], installed: Record<string, boolean>, known: { key: string; name: string; installed?: boolean }[] = []): Catalog {
  const agents: CatalogAgent[] = choices.map((c) => {
    // a model's own speeds (its service tiers): Speed shows only where a model has more than one
    const speeds = (m: any) => ["regular", ...(m.fast ? ["fast"] : []), ...(m.ultrafast ? ["ultrafast"] : [])];
    const efforts = [...new Set<string>((c.models ?? []).flatMap((m: any) => m.efforts ?? []))];
    return {
      id: c.kind, name: c.name, installed: installed[c.kind] !== false,
      ...(installed[c.kind] === false ? { why: "Not installed" } : {}),
      models: (c.models ?? []).map((m: any) => ({ id: m.id, name: m.label ?? m.name ?? m.id, speeds: speeds(m), ...(m.efforts?.length ? { efforts: m.efforts } : {}), ...(m.defaultEffort ? { defaultEffort: m.defaultEffort } : {}) })),
      efforts,
      perms: (c.perms ?? []).map((p: any) => ({ id: p.id, label: PERM_LABEL[p.id] ?? p.label, about: PERM_ABOUT[c.kind]?.[p.id] ?? "" })),
      permDefault: c.permDefault,
      defaultModel: c.models?.[0]?.id,
    };
  });
  // the agents herdr-core can run that Shepherdr can't hold a chat with yet: listed, greyed, with why
  for (const k of known) if (!agents.some((a) => a.id === k.key)) agents.push({ id: k.key, name: k.name, installed: false, why: k.installed === false ? "Not installed" : "No chat yet", models: [], efforts: [], perms: [] });
  return { machine, agents };
}

/* ---------- the plans' use, and the warnings line ---------- */

const PLAN_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex", elevenlabs: "ElevenLabs" };

export function plansOf(snap: Snapshot): Config["plans"] {
  const out: Config["plans"] = [];
  const m = snap.machines.find((x) => x.here) ?? snap.machines[0];
  for (const [cli, l] of Object.entries((m?.limits ?? {}) as Record<string, any>)) {
    if (l?.state !== "ok" || !Array.isArray(l.windows) || !l.windows.length) continue;
    out.push({ name: [PLAN_NAMES[cli] ?? cli, l.plan].filter(Boolean).join(" "), windows: l.windows.map((w: any) => ({ name: w.name, used: Math.round(Number(w.used) || 0), ...(w.resets ? { resets: /^reset/i.test(w.resets) ? w.resets : `Resets ${w.resets}` } : {}) })) });
  }
  return out;
}

/** A plan past 75%, a machine running low (disk or memory over 90%) or out of reach. */
export function warningsOf(snap: Snapshot, plans: Config["plans"]): NonNullable<Snapshot["warnings"]> {
  const out: NonNullable<Snapshot["warnings"]> = [];
  for (const p of plans) {
    const w = [...p.windows].sort((a, b) => b.used - a.used)[0];
    if (w && w.used > 75) out.push({ id: `u:${p.name}:${w.name}`, kind: "usage", text: `You've used ${w.used}% of ${/week/i.test(w.name) ? "this week's" : "your"} ${p.name.split(" ")[0]} plan` });
  }
  for (const m of snap.machines) {
    if (m.status === "off" && !m.connecting) { out.push({ id: `m:${m.machine}:down`, kind: "machine", text: `Can't reach ${m.name}${m.unreachableSince ? ` · last seen ${m.unreachableSince}` : ""}${m.linkWhy ? " · its link is broken: run herdr-task carry-over to link it again" : ""}` }); continue; }
    const hot = m.health?.meters.find((x) => /disk|memory/i.test(x.name) && x.pct > 90);
    if (hot) out.push({ id: `m:${m.machine}:${hot.name.toLowerCase()}`, kind: "machine", text: `${m.name}: ${/disk/i.test(hot.name) ? "disk" : "memory"} nearly full` });
  }
  return out;
}

/* ---------- the snapshot's 3.2 facts ---------- */

/** a machine's home folder: this computer's own, another's /home/<user>, /Users/<user> or /root */
const atHome = (s: { folder?: string; machine?: string | null }) => (s.machine ? /^\/(home\/[^/]+|Users\/[^/]+|root)\/?$/.test(s.folder ?? "") : sameFolder(s.folder, HOME, HOME));

export interface Facts {
  spaces: any[];
  rows: any[];
  /** shared "spaces-chat": its archived list */
  archived: string[];
  /** the open cards by task chat: "permission" or "question" */
  asked: (chat: string) => "permission" | "question" | null;
  /** an agent's own report (OSC 7501): its state and kind */
  reportOf: (address: string | null) => { state?: string; kind?: string } | null;
  config: Config;
  /** this machine's own name */
  hostName?: string;
  /** each chat's and task's screen where its agent has one open or needs the person's hands (service/screens.ts) */
  screens?: Snapshot["screens"];
  /** the screen keys ("task:<id>") waiting for a Mac's one desktop */
  waiting?: string[];
  /** every schedule as herdr-task keeps it (its list's folder and machine with it) */
  schedules?: any[];
}

/** Adds what 3.2 shows to the snapshot the model made: Everything, home and archived spaces, each task's facts. */
export function enrich(snap: Snapshot, f: Facts): Snapshot {
  const spaceOf = new Map(f.spaces.map((s) => [s.id, s]));
  const homes = new Set(f.spaces.filter(atHome).map((s) => s.id));
  const everything = everythingOf(f.spaces, HOME)?.id;
  const places: Place[] = snap.places.map((p) => {
    const s = spaceOf.get(p.id);
    const blocked = ["blocked", "stopped"].includes(s?.assistantStatus) || !!f.asked(p.chat);
    return { ...p, ...(homes.has(p.id) ? { home: true, ...(p.unnamed || p.id === everything ? { name: "home" } : {}) } : {}), ...(f.archived.includes(p.id) ? { archived: true } : {}), ...(blocked ? { needs: true } : {}) };
  });
  const rowOf = new Map(f.rows.map((r) => [r.machine ? `${r.machine}:${r.ref}` : r.ref, r]));
  const rowIn = (r: any, id: unknown) => f.rows.find((x) => x.folder === r.folder && (x.machine ?? null) === (r.machine ?? null) && String(x.id) === String(id));
  // the tasks it still waits for (a done one holds nothing up): the first by title, the rest counted ("+5")
  const waitsFor = (r: any, ids: unknown) => {
    const all = (Array.isArray(ids) ? ids : []).map((id) => rowIn(r, id)).filter(Boolean);
    const open = all.filter((x: any) => x.section !== "done");
    return open.length ? open : all.slice(0, 1);
  };
  const tasks: Task[] = snap.tasks.map((t0) => {
    let t = t0;
    const r = rowOf.get(t.id);
    if (!r) return t;
    const x = r.x ?? {};
    const s = spaceOf.get(t.place);
    const chat = t.agent?.chat ?? `${t.id}/worker`;
    const card = f.asked(chat);
    const rep = f.reportOf(r.worker);
    // stuck on a step only a person can do, asked through its browser or desktop tools: Needs you · Needs your hands
    const hands = !!f.screens?.[`task:${t.id}`]?.hands && !f.screens[`task:${t.id}`]!.hands!.settled && t.status === "work";
    if (hands) t = { ...t, status: "need" };
    const blocked = t.status !== "need" ? undefined : hands ? "auth" : card ?? (rep?.kind === "auth" ? "auth" : rep?.kind === "permission" || rep?.kind === "question" ? rep.kind : rep?.state === "blocked" ? "prompt" : undefined);
    const stopped = x.stopped_by && t.status !== "done" && t.status !== "work" ? { by: x.stopped_by as "you" | "error" | "limit", ...(x.stopped_why ? { why: String(x.stopped_why).slice(0, 200) } : {}) } : undefined;
    const waits = waitsFor(r, x.after);
    const after = waits[0]?.title as string | undefined;
    return {
      ...t,
      // on its own branch or worktree (also one set to, not started yet), changed in the folder itself, or not a repo
      repo: r.branch || r.pr || (r.worktree && r.worktree !== r.folder) || (x.mode === "worktree" && s?.git) ? "branch" : s?.git ? "folder" : undefined,
      ...(stopped ? { stopped, status: "need" as const } : {}),
      ...(blocked ? { blocked } : {}),
      ...(x.merged ? { merged: true } : {}),
      ...(x.quiet === "nothing" || x.quiet === "told" ? { quiet: x.quiet } : {}),
      ...(x.told && x.quiet === "told" ? { doneNote: `told you in ${t.place === everything ? "Everything" : `#${places.find((p) => p.id === t.place)?.name ?? "its space"}`}` } : {}),
      ...(x.automation ? { schedule: String(x.automation) } : {}),
      ...(t.status === "need" || t.status === "ready" || stopped ? { needsAt: x.attention_at ?? r.ready_at ?? r.started ?? undefined } : {}),
      ...(t.status === "done" && r.ready_at ? { needsAtWas: r.ready_at } : {}),
      ...(x.merge_failed ? { mergeFailed: String(x.merge_failed).slice(0, 200) } : {}),
      ...(after ? { afterTitle: after, ...(waits.length > 1 ? { afterMore: waits.length - 1 } : {}) } : {}),
      ...(f.waiting?.includes(`task:${t.id}`) ? { waitsDesktop: true } : {}),
    };
  });
  const automations = f.schedules ? schedulesOf(f.schedules, f.spaces, everything, (ref, machine) => snap.tasks.find((t) => t.id === (machine ? `${machine}:${ref}` : ref))) : {};
  const plans = f.config.plans;
  // a machine is named by its own name, this one too (never "This computer": the app is opened from other devices)
  const machines = snap.machines.map((m) => (m.here && (m.name === "This computer" || !m.name) ? { ...m, name: f.hostName || m.machine } : m));
  return { ...snap, machines, places, tasks, automations, ...(f.screens && Object.keys(f.screens).length ? { screens: f.screens } : {}), ...(everything ? { everything } : {}), config: f.config, warnings: warningsOf(snap, plans), off: offPlugins() };
}

/* ---------- schedules ---------- */

const EVENT_WORDS: Record<string, string> = { added: "a task is added", ready: "a task is ready", failed: "a task fails", "needs-you": "a task needs you", merged: "a task is merged", stalled: "a task stalls", done: "a task is done", "checks-fail": "checks fail" };
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const clock = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

/** when a schedule runs, in words: "Once · Fri 27 Nov 9:00", "Mondays 9:00", "When a task is merged" */
export function whenWords(a: any): string {
  const parts: string[] = [];
  const e = a.every;
  if (e?.kind === "once" && e.at) {
    const d = new Date(String(e.at).replace(" ", "T"));
    parts.push(Number.isNaN(d.getTime()) ? `Once · ${e.at}` : `Once · ${d.toLocaleDateString("en", { weekday: "short" })} ${d.getDate()} ${d.toLocaleDateString("en", { month: "short" })} ${clock(d)}`);
  } else if (e?.text) parts.push(cap(String(e.text).trim()));
  const events = (Array.isArray(a.on) ? a.on : []).map((x: string) => EVENT_WORDS[x] ?? x);
  if (events.length) parts.push(`When ${events.join(" or ")}`);
  return parts.join(", ") || (typeof a.when === "string" ? a.when : "");
}

/** "in 12 min", "in 9h", "tomorrow 7:30", "in 7 days" */
export function nextWords(at: number | null | undefined, now = Date.now()): string {
  if (!at || at <= now) return "";
  const min = Math.round((at - now) / 60000);
  if (min < 60) return `in ${Math.max(1, min)} min`;
  const d = new Date(at), today = new Date(now);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
  if (days === 1) return `tomorrow ${clock(d)}`;
  if (days > 1) return `in ${days} days`;
  return `in ${Math.round(min / 60)}h`;
}

const ENDED: Record<string, string> = { nothing: "nothing to do", told: "told you", merged: "merged", done: "done", ready: "ready for review", working: "working", queued: "waiting to start", error: "did not start", removed: "its task was removed" };

/** when it last ran and how that run ended: "today 9:00 · nothing to do" */
export function lastWords(a: any, now = Date.now()): string {
  const run = (Array.isArray(a.runs) ? a.runs : []).reduce((m: any, r: any) => (!m || (r?.at ?? 0) > m.at ? r : m), null);
  const at = run?.at ?? a.last_run;
  if (!at) return "";
  const d = new Date(at), days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86400000);
  const day = days === 0 ? "today" : days === 1 ? "yesterday" : days < 7 ? d.toLocaleDateString("en", { weekday: "long" }) : `${d.getDate()} ${d.toLocaleDateString("en", { month: "short" })}`;
  const how = run?.error ? "did not start" : ENDED[run?.ended] ?? "";
  return `${day} ${clock(d)}${how ? ` · ${how}` : ""}`;
}

/** a schedule's id for the app: its machine, its list's folder and its own id there */
export const scheduleId = (a: any) => `${a.machine ?? ""}|${a.folder}|${a.id}`;
export function scheduleOf(id: string): { machine: string | null; folder: string; id: string } | null {
  const [machine, folder, own] = String(id).split("|");
  return folder?.startsWith("/") && own && /^[\w.-]{1,60}$/.test(own) && (!machine || /^[\w.-]{1,80}$/.test(machine)) ? { machine: machine || null, folder, id: own } : null;
}

/** Every schedule under its space: the one it was made for, else the one in its list's folder, else Everything. */
export function schedulesOf(list: any[], spaces: any[], everything: string | undefined, taskOf: (ref: string, machine: string | null) => Task | undefined): Record<string, Automation[]> {
  const out: Record<string, Automation[]> = {};
  for (const a of list) {
    const machine = a.machine ?? null;
    const named = a.space ? spaces.find((s) => (s.machine ?? null) === machine && String(s.id).split("/").pop() === String(a.space).split("/").pop()) : null;
    const s = named ?? spaces.find((x) => (x.machine ?? null) === machine && x.folder === a.folder);
    const place = s?.id ?? everything ?? "";
    const once = a.every?.kind === "once";
    const runs = (Array.isArray(a.runs) ? a.runs : []).map((r: any) => ({ at: Number(r.at) || 0, ...(r.task ? { task: machine ? `${machine}:${r.task}` : String(r.task) } : {}), ...(r.error ? { error: String(r.error).slice(0, 200) } : {}) }));
    const agent = a.agent && typeof a.agent === "object" && a.agent.agent ? a.agent : typeof a.agent === "string" ? { agent: a.agent } : undefined;
    (out[place] ??= []).push({
      id: scheduleId(a), place, name: String(a.title ?? a.id), when: whenWords(a), what: String(a.prompt ?? ""), on: !a.paused && !a.space_paused, next: [],
      ...(a.next_run && !a.paused ? { nextAt: a.next_run, nextWords: nextWords(a.next_run) } : {}),
      ...(lastWords(a) ? { last: lastWords(a) } : {}), ...(once ? { once: true } : {}), ...(runs.length ? { runs } : {}), ...(agent ? { agent } : {}),
      ...(a.last_error ? { error: String(a.last_error.message ?? "") } : {}), machine,
    });
    void taskOf;
  }
  return out;
}
