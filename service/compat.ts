// The web app is Shepherdr 2.1's screen (its design, phone layout and motion, kept as they were), fed with
// Shepherdr 3's data: this turns what the service builds with the shared core (spaces, tasks, chats) into the
// shapes 2.1's screen reads (web/shared/types.ts: Snapshot, Chat), and its chat keys back into terminals.
//   a space's chat (its Assistant):  p:<space id, "/" as ":">     a task's chat:  <task id>/worker
// A task id is its ref ("SHEP-7"), "<machine>:<ref>" on another machine, as 2.1 wrote them.
import type { Snapshot, Place, Task, Need, Section, Machine, Chat, Message, Status, TaskStatus, StepKind, ActivityAnswer, Question, Artifact, SettingSection, Job } from "../web/shared/types.ts";
import * as T from "../core/tasks.js";
import * as SPc from "../core/spaces.js";
import { kindOf as kindOfTerm } from "../core/chat-reader.js";
import * as CL from "../core/chat-log.js";
import * as CV from "../core/chat-view.js";
const { summary, names } = CL as any;
const { senderName, briefLabel, newsTimeline, resolveArtifacts, unsigned } = CV as any;
import { mentionedIn } from "../core/send.js";
import * as SCc from "../core/screens.js";
const { SCREEN } = SCc as any;
import { readFileSync } from "node:fs";
import { join } from "node:path";
const APP_HOME = process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app");
import * as MNc from "../core/menus.js";
import * as APc from "../core/autopilot.js";
const { machineLabel } = MNc as any;
import { HOME } from "./paths.ts";
const { spaceName } = SPc as any;
import type { Where } from "./worktree.ts";
import * as AGc from "../core/agents.js";
const { current, rowFor, menuFor, modelName, levelName, NAMES } = AGc as any;
// each kind's name (lib/kinds.json: Claude Code, Codex, Pi, ...)
const CLI_NAMES: Record<string, string> = NAMES;
import * as NF from "../core/notify.js";
const { NOTIFY, everywhereOf, spaceLevel, machineLevel, machineOfSpace, spaceOwn, machineOwn } = NF as any;
// Settings › Notify's words, the window's own (core/settings.js)
import * as STcore from "../core/settings.js";
const STc = STcore as any;

const { ago } = T as any;

export type Row = any;
export type Space = any;

const SECTION: Record<string, TaskStatus> = { needs: "need", working: "work", merging: "merging", ready: "ready", queued: "queued", todo: "todo", done: "done" };
const AGENT: Record<string, Status> = { blocked: "need", working: "work", done: "idle", idle: "idle" };

// Autopilot's words and picks: core/autopilot.js, the window's Settings › Autopilot's too
const AP = APc as any;
const tilde = (p: string | null) => (p && p.startsWith(HOME + "/") ? `~${p.slice(HOME.length)}` : p ?? undefined);

/** Settings › Autopilot's rows, as the window's (mods/shepherdr-settings/autopilot-section.js): one setting for every
 *  space, as Tasks is: the heartbeat (its file's words), the schedule (picks or its own words) and the events. A space
 *  only switches it on, in its Assistant's header. e: Everywhere's, from herdr-task (model.ts pilotEverywhere). */
function pilotRows(e: any) {
  const R = AP.ROWS;
  return [
    { label: R.heartbeat.label, key: "autopilot.heartbeat", value: e.words ?? "", doc: true, hint: R.heartbeat.about, file: tilde(e.heartbeat ?? null) },
    { label: R.every.label, key: "autopilot.every", value: e.every ?? "", text: true, hint: R.every.about,
      trigger: { words: e.trigger ?? "Only Run now", next: [], presets: AP.PRESETS.map(([value, label]: string[]) => ({ label, value })) } },
    { label: R.events.label, key: "autopilot.events", value: AP.eventsIn(e.events).join(","), multi: AP.EVENTS.map(([value, label]: string[]) => ({ value, label })),
      hint: R.events.about },
  ];
}

/** What an Assistant's header shows of its Autopilot (3.0's switch): on, the next wake, queued or waking, its events,
 *  and whether its heartbeat is still empty (unchanged from herdr-task's starter: "Write a heartbeat") */
function headerPilot(a: any) {
  const words = String(a?.words ?? "").trim();
  return { on: !!a?.on, next_run: a?.next_run ?? null, pending: !!a?.pending, inflight: !!a?.inflight, events: a?.events ?? [],
    blank: !words || words === String((APc as any).STARTER).trim() };
}


export const placeKey = (spaceId: string) => `p:${spaceId.replace("/", ":")}`;
export const taskId = (r: Row) => (r.machine ? `${r.machine}:${r.ref}` : r.ref);

// a news event's dot: what the task was at that moment
const NEWS: Record<string, TaskStatus> = { added: "todo", queued: "queued", started: "work", needs: "need", asks: "need", stalled: "need", failed: "need", ready: "ready", merging: "merging", merged: "done", done: "done", closed: "done" };
// a message's reactions as 2.1 shows them: yours, the agent's, or both
function reactionsOf(list?: { emoji: string; by: string }[]) {
  if (!list?.length) return {};
  const by = new Map<string, Set<string>>();
  for (const r of list) (by.get(r.emoji) ?? by.set(r.emoji, new Set()).get(r.emoji)!).add(r.by);
  return { reactions: [...by].map(([emoji, s]) => ({ emoji, by: s.size > 1 ? "both" : s.has("you") ? "me" : "them" })) as any[] };
}
const STEP: Record<string, StepKind> = { run: "run", read: "read", edit: "edit", search: "search", web: "web", agent: "agent" };
const stepRow = (s: any, i: number) => ({ key: `${s.id ?? i}`, kind: STEP[s.kind] ?? "other", text: s.count > 1 ? `${s.line} ×${s.count}` : s.line, steps: [`${s.id ?? i}`] });

/** A tools row opened (GET api/activity?chat&what=turn&id): each step's line and what it printed, read from the log
 *  only now, as the window's open row (mods/chat loadResults). */
export async function activity(reader: any, id: string): Promise<ActivityAnswer> {
  const x = (reader?.conv?.items ?? []).find((i: any) => i.id === id && i.kind === "tools");
  if (!x) return { error: "That turn isn't in the chat any more." };
  const outs: Map<string, string> = await reader.results?.(x.steps).catch(() => new Map()) ?? new Map();
  return { steps: x.steps.map((s: any, i: number) => ({ id: `${s.id ?? i}`, kind: STEP[s.kind] ?? "other", tool: s.kind, at: 0, end: 1, title: s.line, doing: s.line, target: "", ...(outs.has(s.id) ? { out: outs.get(s.id) } : {}) })) };
}

/** An artifact (herdr-artifact list) as 2.1's: its versions newest first, which space it belongs to (its folder's,
 *  here), and whether the web can draw it (a recipe) or only the window (an older GPUI one). */
/** herdr-task's automations as each space's (by its folder): the window's row words, its name, Paused or Didn't
 *  start, and when it runs next */
function automationsBySpace(list: any[], spaces: Space[], spaceName: (s: Space) => string = (s) => s.name) {
  const out: Record<string, any[]> = {};
  for (const a of list) {
    // a list no space works in: under its folder's own key, named by its list (as the window's row)
    const s = spaces.find((x) => (x.machine ?? null) === (a.machine ?? null) && x.folder === a.folder);
    const next = !a.last_error && !a.paused && a.next_run ? [new Date(a.next_run).toLocaleString("en", { weekday: "short", hour: "numeric", minute: "2-digit" })] : [];
    // as the window's automation row (mods/tasks autoRow): its name, why it won't run as planned, when it runs next,
    // its last task (a tap opens it), where it is
    const ref = typeof a.last_task === "string" ? a.last_task : null;
    (out[s?.id ?? `${a.machine ?? ""}:${a.folder}`] ??= []).push({ name: a.title ?? a.id, when: a.last_error ? "Didn't start" : a.paused ? "Paused" : a.when ?? "", what: a.title ?? "", on: !a.paused, next,
      ...(a.last_error ? { error: String(a.last_error.message ?? ""), failed: a.last_error.kind === "fire" ? "fire" : "start" } : {}),
      ...(!a.last_error && !a.paused && a.next_run ? { nextAt: a.next_run } : {}),
      ...(ref ? { task: a.machine ? `${a.machine}:${ref}` : ref } : {}),
      listName: s ? spaceName(s) : a.list ?? a.folder, machine: a.machine ?? null });
  }
  return out;
}

/** Settings › Window's look switches, each on unless set to false (as the window reads them). */
export const LOOK = { tabs: "tabbar.tabs", worktrees: "sidebar.worktrees", unread: "sidebar.unread", red: "counts.red", green: "counts.green", filters: "tasks.filters", place: "tasks.place", helpers: "chat.helpers" } as const;
export const lookOf = (value: (k: string) => unknown) => Object.fromEntries(Object.entries(LOOK).map(([k, key]) => [k, value(key) !== false])) as Record<keyof typeof LOOK, boolean>;

/** Where a space's artifacts are kept, as herdr-artifact's locate(): a repo's main folder (a worktree's too), else its
 *  own folder; named by its last part ("~" at home), as the window's Artifacts header names it. */
export function artifactStore(s: { folder: string; machine?: string | null; git?: { repo?: string } | null }, home = HOME) {
  const repo = s.git?.repo ?? "";
  const folder = repo.endsWith("/.git") ? repo.slice(0, -5) : s.folder;
  // another machine's home: /home/<user>, /Users/<user> or /root, as herdr-artifact there names it "~"
  const atHome = s.machine ? /^\/(home\/[^/]+|Users\/[^/]+|root)\/?$/.test(folder) : folder === home;
  return { folder, key: `${s.machine ?? ""}|${folder}`, name: !repo && atHome ? "~" : folder.split("/").filter(Boolean).pop() ?? "/" };
}

function artifactOf(a: any, spaces: Space[], program: (addr: string) => string | null = () => null): Artifact {
  // its store is a folder: the space it is kept for (its own folder first, then a worktree of its repo), else none
  // (it shows with All)
  // (it shows with All). Another machine's (service/artifacts.ts reads them there) belongs to that machine's spaces.
  const m = a.machine ?? null;
  const mine = spaces.filter((s) => (s.machine ?? null) === m && artifactStore(s as any).folder === a.folder);
  const place = (mine.find((s) => s.folder === a.folder) ?? mine[0])?.id ?? "";
  // 3.0's row: "v3 · Claude Code · 2h ago": the program of the agent that published it while it runs, else nothing;
  // Mark up writes to that agent ("the agent" when it isn't known)
  const by = (a.publisher && program(m ? `${m}/${a.publisher}` : a.publisher)) || "";
  const recipe = (a.files ?? []).includes("recipe.json") && !(a.files ?? []).includes("main.js");
  // its folder's name as its registry has it (another machine's), else as herdr-artifact names it
  const name = a.folderName || (!m && a.folder === HOME ? "~" : String(a.folder ?? "").split("/").filter(Boolean).pop() ?? "");
  return {
    id: a.id, title: a.title, place, v: a.version, at: a.at, when: ago(a.at, false), by, keeper: by, kind: recipe ? "recipe" : "gpui",
    folder: a.folder ?? "", folderName: name, store: `${m ?? ""}|${a.folder ?? ""}`, ...(m ? { machine: m } : {}), ...(a.task ? { task: a.task } : {}),
    versions: [...(a.versions ?? [])].reverse().map((x: any) => ({ n: x.v, at: x.at, when: ago(x.at, false), by, html: x.v, ...(x.note ? { note: x.note } : {}) })),
  };
}

export class Compat {
  /** chat key -> terminal address, from the last build */
  private chats = new Map<string, string>();
  /** task id -> where herdr-task finds it */
  private tasks = new Map<string, { ref: string; folder: string; machine: string | null; key: string; pin: string; where: Where }>();

  taskOf(id: string) { return this.tasks.get(id) ?? null; }

  private rows: Row[] = [];
  /** the artifacts' registries as herdr-artifact lists them (versions with who published them), for a chat's publishes */
  private rawArts: any[] = [];
  private spaceList: Space[] = [];
  /** A space by its id: its folder and machine. */
  spaceOf(id: string) { const s = this.spaceList.find((x) => x.id === id); return s ? { id: s.id, folder: s.folder, machine: s.machine ?? null } : null; }
  /** Every space: its folder and machine (the worktree dialog's "open" marks). */
  allSpaces() { return this.spaceList.map((s) => ({ id: s.id as string, folder: s.folder as string, machine: (s.machine ?? null) as string | null })); }

  /** The tasks a chat's messages can mention (#HAT-1): its folder's, on its machine, as the window's chat has them. */
  tasksFor(chatKey: string) {
    const t = chatKey.endsWith("/worker") ? this.rows.find((r) => taskId(r) === chatKey.slice(0, -7)) : null;
    const s = !t ? this.spaceList.find((x) => placeKey(x.id) === chatKey) : null;
    const machine = t ? t.machine ?? null : s?.machine ?? null, folder = t ? t.folder : s?.folder;
    return this.rows.filter((r) => (r.machine ?? null) === machine && r.folder === folder)
      .map((r) => ({ ref: r.ref, id: r.id, title: r.title, status_text: r.sub ?? r.section, why: r.why, folder: r.folder, prompt: r.prompt, state: r.section }));
  }

  /** The person's shared choices (service/store.ts, its document) and their values now, set by main. */
  shared: { value(key: string): any; set(key: string, value: unknown): Promise<unknown> } | null = null;
  host = "";

  /** A machine's health and plan limits (service/machines.ts), set by main. */
  machineStats: ((m: string | null) => any) | null = null;

  /** The model menu and restarts (service/agents.ts), set by main. */
  agents: { info(addr: string, reader: any): Promise<unknown>; restart(addr: string, reader: any, pick: any): Promise<string>; choices(machine: string | null): Promise<unknown>; ownDefaults(): Promise<Record<string, unknown>> } | null = null;

  /** Agents' secret asks (service/secrets.ts), set by main. */
  secrets: { asks(): { address: string; name: string; why: string }[] } | null = null;

  /** A secret ask as 2.1's masked card: kept for this space, this machine, or Everywhere. */
  secretAsk(a: { address: string; name: string; why: string }) {
    const t: any = (this as any).terminalsOf?.(a.address);
    const sp = ["herdr.space", "herdr.task.space", "herdr.coordinator.space"].map((k) => t?.labels?.[k]).find(Boolean);
    const m = a.address.includes("/") ? a.address.split("/")[0] : "";
    return { id: `secret:${a.address}:${a.name}`, name: a.name, ...(a.why ? { why: a.why } : {}),
      levels: [...(sp ? [{ id: `p:${m}:${sp}`, label: "This space" }] : []), { id: `m:${m}`, label: m || "This computer" }, { id: "all", label: "Everywhere" }] };
  }

  /** The reader of a chat someone follows now (service/chats.ts), set by main. */
  reader: ((addr: string) => any) | null = null;

  /** This machine's artifacts (service/artifacts.ts), set by main: notes and answers go through it. */
  artifacts: { say(id: string, v: number, text: string, spot?: string): Promise<unknown> } | null = null;

  /** Open hook asks (service/asks.ts), set by main: they show as cards in their chat and in Needs you. */
  asks: { of(terminal: string): any[]; open: Map<string, any> } | null = null;

  /** A hook ask as 2.1's question card (core/asks.js words: a permission, a plan, or a question). */
  question(a: any, key: string): Question {
    const w = a.words;
    if (w.kind === "questions") {
      const q = w.questions[0];
      const choices = (x: any) => x.options.map((o: any) => ({ label: o.name, ...(o.description ? { description: o.description } : {}), ...(o.recommended ? { recommended: true } : {}) }));
      // several questions: one card with a step for each, then one to check the answers (3.0's card)
      if (w.questions.length > 1)
        return { id: a.id, title: `${w.questions.length} questions`, kind: "Question", to: key, choices: [], other: true,
          parts: w.questions.map((x: any) => ({ title: x.text, header: x.header || undefined, multi: x.multi, choices: choices(x) })) };
      return { id: a.id, title: q.text, kind: "Question", to: key, multi: q.multi, other: true, choices: choices(q) };
    }
    // the request word for word in a code block whose fence no run of backticks in it can close; one too long to show
    // whole says so (and can't be allowed from here: service/asks.ts)
    const fence = "`".repeat(Math.max(3, ...[...String(w.detail ?? "").matchAll(/`+/g)].map((m) => m[0].length + 1)));
    // cut short: the window's card's words (mods/chat cards.js)
    const cut = "\n\nSome of it is too long for the chat; the terminal shows it all.";
    const detail = w.detail ? `${fence}text\n${w.detail}\n${fence}${w.cut ? cut : ""}` : undefined;
    return w.kind === "plan"
      ? { id: a.id, title: w.title, kind: "Plan", to: key, plan: `${w.detail ?? ""}${w.cut ? cut : ""}`, choices: [{ label: "Approve" }, { label: "Keep planning" }], noteRequiredFor: 1 }
      : { id: a.id, title: w.title, kind: "Question", to: key, ...(detail ? { plan: detail } : {}), choices: [{ label: "Allow" }, { label: "Deny" }] };
  }
  last: Snapshot | null = null;
  /** chat key -> the files its messages show (a chat's images): the only ones /api/file serves for it */
  files = new Map<string, Set<string>>();
  fileOf(key: string, path: string) { return this.files.get(key)?.has(path) ? path : null; }

  addrOf(key: string) { return this.chats.get(key) ?? null; }

  snapshot(input: { host: string; user: string; machines: { name: string; here: boolean; state: string }[]; spaces: Space[]; sections: any[]; rows: Row[]; artifacts?: any[]; settings?: SettingSection[]; off?: string[]; offPlugins?: string[]; automations?: any[]; pilot?: any }): Snapshot {
    const { host, spaces, rows } = input;
    this.host = host;
    this.rows = rows;
    this.rawArts = input.artifacts ?? [];
    this.spaceList = spaces;
    const chats = new Map<string, string>();
    const machines: Machine[] = input.machines.map((m) => {
      // named as the window's sidebar names it: the person's name for it, else its own; this computer "This computer"
      const key = m.here ? host : m.name, look = (this.shared?.value("spaces-chat") ?? {}).machines?.[m.here ? "" : m.name] ?? {};
      return { id: `m:${key}`, machine: key, name: machineLabel(m.here ? null : m.name, look.name), ownName: m.here ? "This computer" : m.name, ...(look.icon ? { emoji: look.icon } : {}), status: m.state === "connected" ? "idle" : "off", ...(m.here ? { here: true } : {}), ...(m.state === "connecting" ? { connecting: true } : {}), ...(this.machineStats?.(m.here ? null : m.name) ?? {}) } as Machine;
    });
    // a task's space: the one that started it (herdr-task keeps it), else the one in its folder, as the window places it
    // what its row says it is in, as the window's Tasks: the space working in its list's folder, else the list's name
    const placeName = (r: Row) => places.find((p) => spaces.find((s) => s.id === p.id && (s.machine ?? null) === (r.machine ?? null) && s.folder === r.folder))?.name ?? r.list ?? "";
    const placeOf = (r: Row) => (r.space && spaces.some((s) => s.id === r.space) ? r.space : spaces.find((s) => (s.machine ?? null) === (r.machine ?? null) && s.folder === r.folder)?.id ?? "");

    const places: Place[] = spaces.map((s) => {
      const key = placeKey(s.id);
      if (s.assistant) chats.set(key, s.assistant);
      // its other tabs: each tab's first terminal, opened by the key t:<address> (the Assistant's tab is its chat)
      // (3.0's tab bar: its id, its name as the bar shows it, what runs in it, its status and folder)
      const named = (n: unknown) => typeof n === "string" && !!n && !/^tb\d+$/.test(n);
      const shortHome = (p: string | null | undefined) => (!p ? "" : s.machine ? p : p === HOME ? "~" : p.startsWith(HOME + "/") ? `~${p.slice(HOME.length)}` : p);
      const stateOf = (k: any) => (["working", "blocked", "done", "idle"].includes(k?.status?.state) ? k.status.state : "idle");
      // which of the machine's known agents a terminal runs (the window's entryFor), by the window's machines.stats
      const known: any[] = (this.shared?.value("machines.stats") as any)?.[s.machine ?? ""]?.agents ?? [];
      const base = (v: unknown) => String(v ?? "").split(/[\\/]/).pop();
      const agentIn = (k: any) => {
        const e = known.find((a) => a.key === k?.labels?.["herdr.agent"]) ?? known.find((a) => Array.isArray(a.run) && base(a.run[0]) === base(k?.foreground?.argv?.[0] ?? k?.argv?.[0]));
        return e ? { key: e.key as string, name: e.name as string } : null;
      };
      const tabs =(s.tabs ?? []).map((t: any) => ({ id: t.id, raw: t.name, addr: (t.terminals ?? [])[0] })).filter((t: any) => t.addr && t.addr !== s.assistant)
        .map((t: any) => {
          chats.set(`t:${t.addr}`, t.addr);
          const k: any = (this as any).terminalsOf?.(t.addr), cli = kindOfTerm(k), agent = agentIn(k);
          const prog = cli ? CLI_NAMES[cli] ?? cli : agent?.name ?? null;
          return { id: t.id, name: (MNc as any).tabName(named(t.raw) ? t.raw : "", prog), named: named(t.raw), term: `t:${t.addr}`,
            ...(cli ? { cli } : {}), ...(agent || cli ? { agent: agent?.key ?? cli } : {}), state: stateOf(k), where: shortHome(k?.foreground?.cwd ?? k?.cwd),
            // what its pane header calls it: the agent, else the program in front, else its title
            prog: prog ?? (k?.foreground?.name || k?.title || "Shell") };
        });
      // the Assistant's own tab (first in the bar): the tab its terminal or chat is in
      const ak: any = s.assistant ? (this as any).terminalsOf?.(s.assistant) : null;
      const atLabel = ak?.labels?.["herdr.coordinator.tab"] ?? ak?.labels?.["herdr.tab"];
      const own = (s.tabs ?? []).find((t: any) => (t.terminals ?? []).includes(s.assistant) || (atLabel && (t.id === atLabel || t.id === `${s.machine}/${atLabel}`)));
      const assistantTab = { ...(own ? { id: own.id } : {}), name: named(own?.name) ? own.name : "Assistant", named: named(own?.name), state: s.assistant ? stateOf(ak) : "idle", live: !!s.assistant, ...(kindOfTerm(ak) ? { cli: kindOfTerm(ak) } : {}),
        ...(agentIn(ak) || kindOfTerm(ak) ? { agent: agentIn(ak)?.key ?? kindOfTerm(ak) } : {}) };
      const name = spaceName(s, { home: s.machine ? null : HOME, repo: s.git?.name ?? null });
      // what 3.0's pane header says under it: "Assistant · Claude Code" (just "Assistant" until it has started), and the
      // folder it works in, home shortened to ~
      const kind = s.assistant ? kindOfTerm((this as any).terminalsOf?.(s.assistant)) : null;
      const header = `Assistant${kind ? ` · ${CLI_NAMES[kind] ?? kind}` : ""}`;
      const where = s.machine ? s.folder : s.folder === HOME ? "~" : s.folder.startsWith(HOME + "/") ? `~${s.folder.slice(HOME.length)}` : s.folder;
      return { id: s.id, name, ...(!s.name || s.name === "~" ? { unnamed: true } : {}), ...(s.icon ? { emoji: s.icon } : {}),...(s.git ? { git: s.git.linked ? "linked" : "main", repo: s.git.repo, gitName: s.git.name, branch: s.git.branch ?? null, ahead: s.git.ahead ?? 0, behind: s.git.behind ?? 0 } : {}), ...(s.git?.linked ? { worktree: true } : {}), machine: s.machine ?? host, level: 0, status: AGENT[s.assistantStatus] ?? "idle", mode: s.autopilot ? "autopilot" : "regular", chat: key, header, where, assistantTab, ...(s.pilot ? { pilot: headerPilot(s.pilot) } : {}),store: artifactStore(s as any), ...((s as any).changedAt ? { changedAt: (s as any).changedAt } : {}),...(tabs.length ? { tabs } : {}) };
    });

    this.tasks = new Map(rows.map((r) => [taskId(r), { ref: r.ref, folder: r.folder, machine: r.machine ?? null, key: `${r.slug}#${r.id}`, pin: r.key,
      where: { folder: r.worktree, machine: r.machine ?? null, base: r.base, start: r.start, branch: r.branch, pr: r.pr } }]));
    // one older than 10 minutes was left by a quit (as the window reads it)
    const acc = this.shared?.value("tasks.accepting") ?? {};
    const accepting = (r: Row) => { const at = acc?.[`${r.machine ?? ""}:${r.folder}:${r.ref}`]; return typeof at === "number" && Date.now() - at < 600000; };
    const tasks: Task[] = rows.filter((r) => r.section !== "done" || (r.done_at && Date.now() - r.done_at < 7 * 86400000)).map((r) => {
      const id = taskId(r);
      if (r.worker) chats.set(`${id}/worker`, r.worker);
      else if (r.lastLog) chats.set(`${id}/worker`, `log:${r.machine ?? ""}|${r.lastLog.kind}|${r.lastLog.path}`);
      const t: Task = {
        id, name: r.title, status: SECTION[r.section] ?? "todo", place: placeOf(r), listName: placeName(r), age: r.started ? ago(r.started, false) : "",
        state: r.section, on: r.machine ?? host, created: "",
        // its latest news (ms), as Jump orders tasks newest first
        at: Math.max(0, ...[r.done_at, r.ready_at, r.started].filter((x: unknown): x is number => typeof x === "number")),
        ...(r.sub ? { sub: r.sub } : {}),
        // the window's Accept card accepting it now (shared "tasks.accepting", mods/accept-card): "Accepting…"
        ...(accepting(r) ? { accepting: true } : {}),
        // the minutes left under a Working row's dot, as the window writes them (core/tasks.js leftOf: "6m", "<1m", "2h")
        ...(r.left ? { left: r.left } : {}),
        ...(r.done_at ? { doneAt: r.done_at } : {}),
        ...(r.pr ? { pr: { number: r.pr.number, url: r.pr.url } } : {}),
        ...(r.branch ? { branch: r.branch } : {}), ...(r.base ? { base: r.base } : {}),
        // the task's browser (agent-browser), relayed for this machine's tasks
        ...(r.machine ? { browser: { ready: false, hint: `This task runs on ${r.machine}. Its browser can be watched only from that machine's Herdr for now.` } } : { browser: { ready: true } }),
        ...(r.pinned ? { pinned: 1 } : {}),
        ...(r.archived ? { archived: r.done_at ?? 1 } : {}),
        // what its agent last said, as the window's task header (mods/chat/panel.js reportLine): working, its words (a
        // provider retry's line first) and minutes left; needing you, frozen with the % it stopped at
        ...(r.said ? { report: { msg: r.section === "working" && r.why ? r.why : r.said.text, ...(r.said.done != null ? { progress: r.said.done } : {}),
          ...(r.said.left != null && !r.said.paused ? { eta: r.said.left } : {}), ...(r.said.paused ? { paused: true } : {}) } }
          : r.section === "working" && r.why ? { report: { msg: r.why, ...(r.pct != null ? { progress: r.pct } : {}) } } : {}),
        ...(r.worker ? { agent: { chat: `${id}/worker`, role: "worker", cli: "claude", status: r.section === "needs" ? "need" : "work", running: true, age: "", note: "" } } : {}),
        ...(!r.worker && r.lastLog ? { agent: { chat: `${id}/worker`, role: "worker", cli: r.lastLog.kind, status: "idle", running: false, age: "", note: "" } } : {}),
      };
      return t;
    });

    const needs: Need[] = [
      ...rows.filter((r) => r.section === "needs" && !r.archived).map((r) => ({ id: "attention", chat: `${taskId(r)}/worker`, place: placeOf(r), task: taskId(r), at: r.started ?? Date.now(), text: r.sub ?? "" })),
      ...spaces.filter((s) => s.assistantStatus === "blocked").map((s) => ({ id: "attention", chat: placeKey(s.id), place: s.id, at: Date.now(), text: "Waits for you" })),
    ];

    // hook asks waiting on the person: each a Need with its card
    const keyOf = new Map([...chats].map(([k, a]) => [a, k]));
    for (const a of this.asks?.open.values() ?? []) {
      const key = keyOf.get(a.terminal);
      if (!key) continue;
      const task = key.endsWith("/worker") ? key.slice(0, -7) : undefined;
      const place = task ? tasks.find((x) => x.id === task)?.place ?? "" : places.find((p) => p.chat === key)?.id ?? "";
      needs.push({ id: a.id, chat: key, place, ...(task ? { task } : {}), at: a.at, question: this.question(a, key) });
    }

    for (const a of this.secrets?.asks() ?? []) {
      const key = keyOf.get(a.address);
      if (!key) continue;
      const task = key.endsWith("/worker") ? key.slice(0, -7) : undefined;
      const place = task ? tasks.find((x) => x.id === task)?.place ?? "" : places.find((p) => p.chat === key)?.id ?? "";
      needs.push({ id: `secret:${a.address}:${a.name}`, chat: key, place, ...(task ? { task } : {}), at: Date.now(), secret: this.secretAsk(a) });
    }

    const pinned = spaces.filter((s) => s.pinned).map((s) => s.id);
    const sections: Section[] = [
      ...(pinned.length ? [{ id: "pinned", name: "Pinned", spaces: pinned }] : []),
      ...input.sections.map((x: any) => ({ id: `s:${x.id}`, name: x.name, ...(x.icon ? { emoji: x.icon } : {}), machine: x.machine ?? host, spaces: x.spaces ?? [] })),
    ];

    // unread: a space's chat counts as new until its Assistant's turn is read (core label herdr.chat.read)
    const last: Record<string, number> = {}, read: Record<string, number> = { "*": 0 };
    for (const s of spaces) { const k = placeKey(s.id); last[k] = s.unread ? 2 : 1; read[k] = 1; }

    // Notify (3.0's All / Needs me / Off): a row per space's level and Everywhere, as 2.1's Settings and space menu read it
    const n = this.shared?.value("notify") ?? {};
    const level = (s: Space) => spaceLevel(n, s.id), parent = (s: Space) => machineLevel(n, machineOfSpace(s.id));
    const notify: SettingSection[] = [
      { name: "Notify", level: "all", rows: [{ label: "Notify", key: "notify", value: everywhereOf(n), options: [...NOTIFY], hint: STc.NOTIFY_ABOUT,
        // as the window's Everywhere: the spaces that set their own
        ...(spaces.some((s) => spaceOwn(n, s.id)) ? { others: spaces.filter((s) => spaceOwn(n, s.id)).map((s) => ({ id: s.id, name: places.find((p) => p.id === s.id)?.name ?? s.name })) } : {}) },
        // machines that set their own before machine scope went: still applied, shown with Reset (the window's)
        ...Object.entries((n as any).machines ?? {}).filter(([, v]) => NOTIFY.includes(v as string)).map(([m, v]) =>
          ({ label: STc.machineLabel(m), key: `notify.machine@${m}`, value: "", button: STc.RESET, hint: STc.notifyMachineAbout(v) })),
        // push alerts on this phone or browser: 2.1's alerts action (it asks the device, then tells the service)
        { label: "Alerts on this device", key: "alerts", value: "", options: ["Turn on"] }] },
      ...spaces.map((s) => {
        // "Same as everywhere", or its machine's own set before
        const m = machineOfSpace(s.id), from = STc.sameAs(machineOwn(n, m) ? "machine" : "everywhere", m).replace(/^Same as /, "");
        return { name: "Notify", level: s.id, rows: [{ label: "Notify", key: "notify", value: level(s), options: [...NOTIFY], hint: STc.NOTIFY_ABOUT,
          ...(spaceOwn(n, s.id) ? { inherits: { value: parent(s), from } } : { from }) }] };
      }),
    ];

    // Autopilot (3.0's Settings › Autopilot, herdr-task keeps it): one setting for every space, Everywhere's page only;
    // a space switches it on in its Assistant's header. The Autopilot add-on off: no page, no switch (Settings › Window)
    const pilotOn = !(input.off ?? []).includes("autopilot");
    const ev = input.pilot ?? { ...AP.everywhereOf(null), words: AP.STARTER };
    if (pilotOn) notify.push({ name: "Autopilot", level: "all", about: AP.ABOUT, rows: pilotRows(ev) } as SettingSection);

    this.chats = chats;
    this.last = {
      terminalTransport: "core", name: "Shepherdr", host, user: input.user, places, machines, tasks, automations: automationsBySpace(input.automations ?? [], spaces, (s) => places.find((p) => p.id === s.id)?.name ?? s.name), asks: {}, needs, settings: [...(input.settings ?? []), ...notify],
      artifacts: (input.artifacts ?? []).map((a) => artifactOf(a, spaces, (addr) => { const k = kindOfTerm((this as any).terminalsOf?.(addr)); return k ? CLI_NAMES[k] ?? k : null; })),
      sections, last, read, off: input.offPlugins ?? [],
      // the Window page's look switches (shared keys the window reads too): the web follows the same ones
      look: lookOf((k) => this.shared?.value(k)),
      // Herdr's Files and Changes panels, as the window's tab bar offers them (unset: both)
      panels: Array.isArray(this.shared?.value("workspace.panels")) ? this.shared!.value("workspace.panels").filter((x: unknown) => x === "files" || x === "changes") : ["files", "changes"],
    };
    return this.last;
  }

  /** An Assistant's tasks' workers (its space's tasks with an agent), by the Assistant's address: [{ addr, ref }]. */
  workersOf(addr: string) {
    const key = [...this.chats].find(([k, a]) => a === addr && k.startsWith("p:"))?.[0];
    if (!key) return [];
    const space = key.slice(2).replace(":", "/");
    return this.rows.filter((r) => r.space === space && r.worker && r.ref).map((r) => ({ addr: r.worker as string, ref: r.ref as string }));
  }

  /** What the person asked an Assistant started from its chat (the window's data/chat-first/<slot>.txt), else null. */
  private firsts = new Map<string, { at: number; text: string | null }>();
  firstTask(t: any, addr?: string | null) {
    const safe = (s: string) => String(s).replace(/[^\w.-]/g, "_");
    const names = [t?.labels?.["herdr.chat.slot"], t?.labels?.["herdr.chat.origin"], addr].filter(Boolean).map((n) => join(APP_HOME, "data", "chat-first", `${safe(n)}.txt`));
    for (const f of names) {
      const was = this.firsts.get(f);
      if (was && Date.now() - was.at < 10_000) { if (was.text) return was.text; continue; }
      let text: string | null = null;
      try { text = readFileSync(f, "utf8"); } catch {}
      this.firsts.set(f, { at: Date.now(), text });
      if (text) return text;
    }
    return null;
  }

  /** A CLI's start screen (core/screens.js card) as a card that presses a choice on a tap. */
  screenQuestion(c: any, key: string, by?: { ref: string; title: string; chat: string }): Question {
    return { id: c.id, title: SCREEN.title(c.cli), kind: "Question", to: key, ...(c.words ? { screen: c.words } : {}), press: true,
      choices: (c.choices ?? []).map((x: any) => ({ label: x.label, ...(x.description ? { description: x.description } : {}) })), ...(by ? { by } : {}) } as Question;
  }

  /** A followed conversation (core/chat-reader.js) as 2.1's Chat. A run of tool calls (3.0's tools row) is 2.1's turn
   *  rows: the first three, then "N more" (activity()). */
  chat(key: string, reader: any, t: any): Chat {
    const messages: Message[] = [];
    let at = 0;
    const items: any[] = reader.conv?.items ?? [];
    const machine = reader.machine ?? null;
    const term = (a: string) => (this as any).terminalsOf?.(a) ?? null;
    // an Assistant's chat: its space's tasks (as the window's newsLines(): Herdr's news in place, a start, ready or done
    // it never said from the task's own record), and their workers, by address, for who sent a message
    const space = key.startsWith("p:") ? key.slice(2).replace(":", "/") : null;
    const spaceRows = space ? this.rows.filter((r) => r.space === space && r.ref) : [];
    const workerOf = new Map<string, string>(this.rows.filter((r) => r.worker).map((r) => [r.worker, r.ref]));
    const sender = (from: string, text: string) => senderName(from, text, { find: term, machine, taskOf: (a: string) => workerOf.get(a) ?? null });
    const news = space ? newsTimeline(items, new Map(spaceRows.map((r) => [r.ref, { ...r, status: r.section }])), { start: reader.start }) : [];
    const newsLine = (e: any): Message => {
      const task = machine ? `${machine}:${e.ref}` : e.ref;
      return { id: e.id, who: "agent", at: e.at, news: { task, ref: e.ref, mark: e.mark, what: e.what, text: e.text, ...(e.live ? { live: true } : {}), ...(e.accept ? { accept: true } : {}) } };
    };
    const inline = new Map(news.filter((e: any) => !e.made).map((e: any) => [e.id, e]));
    const made = news.filter((e: any) => e.made);
    let mi = 0;
    // which artifact each publish made (core/chat-view.js resolveArtifacts, as the window's chat)
    const arts = resolveArtifacts(items, this.rawArts.filter((a: any) => (a.machine ?? null) === machine), String(reader.addr ?? "").split("/").pop());
    const template = t?.template ?? null, task = Boolean(t?.labels?.["herdr.task"]);
    const mentionable = this.tasksFor(key);
    const own = this.chats.get(key);
    const asking = !!own && (this.asks?.of(own) ?? []).some((a: any) => a.words?.kind === "questions");
    // an Assistant started from its chat with the person's words: what they asked (data/chat-first, as the window's)
    const ft = reader.start === 0 && items[0]?.kind === "user" ? this.firstTask(t, own)?.trim() : null;
    for (const [i, raw] of items.entries()) {
      let x = raw;
      if (x.at) at = x.at;
      while (mi < made.length && x.at && made[mi].at < x.at) messages.push(newsLine(made[mi++]));
      const reactions = reactionsOf(reader.conv?.reactions?.get(x.id));
      // the template's part a quiet "New session" row, the person's words their own message
      const first = i === 0 && !!ft && x.kind === "user" && String(x.text ?? "").trim().endsWith(ft);
      if (first) {
        const body = String(x.text).trim().slice(0, -ft!.length).trim();
        if (body) messages.push({ id: `${x.id}:b`, who: "you", at: x.at, text: body, brief: { label: "New session" } });
        x = { ...x, text: ft };
      }
      // not typed by the person: a launch brief or another agent's message, as one quiet row
      const brief = x.kind === "user" && !first ? briefLabel(x, i, { start: reader.start, template, task, sender }) : null;
      if (brief) {
        const restart = /^<restart>/.test(x.text ?? "");
        messages.push({ id: x.id, who: "you", at: x.at, text: restart ? x.text.replace(/<\/?restart>/g, "") : x.from ? unsigned(x.text) : x.text, brief: { label: brief, ...(restart ? { bare: true } : {}) } });
      } else if (x.kind === "user" && (x.text || x.paths?.length || x.images)) {
        // the tasks it mentions, as chips under it (core/send.js: the same matching as the window's)
        const chips = x.text ? mentionedIn(x.text, mentionable) : [];
        const mentions = chips.length ? { mentions: chips.map((r: any) => ({ task: machine ? `${machine}:${r.ref}` : r.ref, ref: r.ref ?? `#${r.id}`, title: r.title })) } : {};
        // what it replies to: the message it names, which a press on its line brings into view (the window's goTo)
        const to = x.replyTo ? items.slice(0, i).reverse().find((y: any) => (y.kind === "user" || y.kind === "agent") && y.text && names(y.text, String(x.replyTo).slice(0, 60))) : null;
        if (x.text) messages.push({ id: x.id, who: "you", text: x.text, at: x.at, ...(x.replyTo ? { reply: { text: x.replyTo, ...(to ? { id: to.id, who: to.kind === "user" ? "you" : "agent" } : {}) } } : {}), ...reactions, ...mentions } as Message);
        // the images sent with it, under its words as the window shows them; only files a chat names are ever served
        // (fileOf)
        for (const [n, path] of (x.paths ?? []).entries()) {
          (this.files.get(key) ?? this.files.set(key, new Set()).get(key)!).add(path);
          messages.push({ id: `${x.id}:f${n}`, who: "you", at: x.at, file: { name: path.split("/").pop() ?? "image", path } } as Message);
        }
        // images Claude Code didn't say the source of: how many, as the window's paperclip line
        const unseen = (x.images ?? 0) - (x.paths?.length ?? 0);
        if (unseen > 0) messages.push({ id: `${x.id}:n`, who: "you", at: x.at, images: unseen } as Message);
      }
      else if (x.kind === "agent" && x.text) messages.push({ id: x.id, who: "agent", text: x.text, at: x.at, ...reactions });
      else if (x.kind === "error" && x.text) messages.push({ id: x.id, who: "agent", text: x.text, at: x.at, error: true });
      // its own question asked now shows as its card (at the end), in place of its "Asked you" box, as the window's
      else if (x.kind === "ask" && !x.closed && asking) continue;
      else if (x.kind === "ask" && x.text) messages.push({ id: x.id, who: "agent", text: x.text, at: x.at, asked: x.closed === "answered" ? "answered" : x.closed ? "dismissed" : "open" });
      else if (x.kind === "news" && x.ref) {
        // a task's news line in its Assistant's chat (<herdr-news task=… event=…>), as it was said
        const e = inline.get(x.id);
        if (e) messages.push(newsLine(e));
      } else if (x.kind === "artifact") {
        // a publish: its card (the latest of it) or line, as the artifacts plugin draws it; a quiet line while the
        // registry doesn't list it yet
        const r = arts.get(x.id);
        if (r) messages.push({ id: x.id, who: "agent", at: x.at, artifact: { id: r.id, v: r.v } });
        else if (Date.now() - (x.at ?? 0) < 180000) messages.push({ id: x.id, who: "agent", at: x.at, publishing: true });
      } else if (x.kind === "tools" && x.steps?.length) {
        // 3.0's tools row: one quiet line ("Ran a command"), opening to each step's line and what it printed
        const rows = x.steps.map(stepRow);
        messages.push({ id: x.id, who: "agent", at, activity: { id: x.id, at, end: at, rows, steps: x.steps.length, summary: summary(x.steps) } });
      }
    }
    while (mi < made.length) messages.push(newsLine(made[mi++]));
    // what the agent asks now, as cards at the end of its chat
    const addr = this.chats.get(key);
    for (const a of addr ? this.asks?.of(addr) ?? [] : []) messages.push({ id: `ask:${a.id}`, who: "agent", at: a.at, question: this.question(a, key) });
    for (const a of (this.secrets?.asks() ?? []).filter((x) => x.address === addr)) messages.push({ id: `secret:${a.address}:${a.name}`, who: "agent", at: Date.now(), secret: this.secretAsk(a) } as Message);
    // asks that closed, as the window's quiet lines ("✓ Run: npm test · Allowed in the chat"); a question's own line is
    // its "Asked you" box, from the log
    const watch = (this as any).watch;
    const quiet = (id: string, at: number, text: string): Message => ({ id, who: "agent", at, ended: text });
    if (addr) for (const e of (this.asks as any)?.endsOf?.(addr) ?? []) if (e.kind !== "questions") messages.push(quiet(`ae:${e.id}`, e.at, `${e.title} · ${e.how}`));
    // its start screens (core/screens.js): an open one as its card, the rest a line saying how they went
    const screens = (who: string, ref: string | null, by?: { ref: string; title: string; chat: string }) => {
      for (const c of watch?.cardsOf?.(who) ?? []) {
        if (c.state === "open") messages.push({ id: `card:${c.id}`, who: "agent", at: c.opened, question: this.screenQuestion(c, key, by) });
        else messages.push(quiet(`se:${c.id}`, c.opened, `${ref ? `${ref} · ` : ""}${SCREEN.ended(c.cli, c.how)}`));
      }
    };
    if (addr) screens(addr, null);
    // an Assistant's chat: its tasks' workers' asks on their own cards, headed by their task (one per task, its oldest),
    // their secrets, their start screens, and how each closed
    if (space) for (const r of spaceRows.filter((r) => r.worker)) {
      const by = { ref: r.ref, title: r.title, chat: `${taskId(r)}/worker` };
      const a = (this.asks?.of(r.worker) ?? []).sort((p: any, q: any) => p.at - q.at)[0];
      if (a) messages.push({ id: `ask:${a.id}`, who: "agent", at: a.at, question: { ...this.question(a, key), by } as any });
      else for (const s of (this.secrets?.asks() ?? []).filter((x) => x.address === r.worker)) messages.push({ id: `secret:${s.address}:${s.name}`, who: "agent", at: Date.now(), secret: { ...this.secretAsk(s), by } } as Message);
      for (const e of (this.asks as any)?.endsOf?.(r.worker) ?? []) messages.push(quiet(`ae:${e.id}`, e.at, `${r.ref} · ${e.title} · ${e.how}`));
      screens(r.worker, r.ref, by);
    }
    const st = t?.status?.state ?? null;
    // the CLI's own subagents still at work, then its background shells and watchers, above the box (3.0: the helpers
    // list; core/bg-jobs.js)
    const jobs: Job[] = [
      ...(reader.conv?.running?.() ?? []).map((h: any, i: number) => ({ id: `h${i}`, kind: "agent" as const, title: h.desc, at: h.at ?? Date.now() })),
      ...(reader.jobs?.() ?? []).map((j: any) => ({ id: `b:${j.id}`, kind: j.kind === "monitor" ? "monitor" as const : "shell" as const, title: j.label, at: j.at ?? Date.now(), command: j.cmd, stop: true, ...(j.path ? { more: "output" as const } : {}) })),
    ];
    // what it runs on, for the line under the box (core/agents.js: the window's model button says the same)
    let agent: any;
    try {
      // as the window's chat: the CLI's own settings fill what its arguments and log don't say; a resumed log's model
      // counts only once this process writes
      const kind = reader.kind ?? "claude", dflt = (this.agents as any)?.cached?.(kind, machine) ?? {};
      let meta = reader.conv?.meta ?? {};
      if (t?.created_ms && meta.at && meta.at < t.created_ms) meta = { used: meta.used, window: meta.window };
      const c = current(kind, t?.foreground?.argv ?? t?.argv ?? [], meta, dflt);
      const row = rowFor(kind, c), label = menuFor(kind, {}).models.find((m: any) => m.id === row)?.name ?? modelName(c.model);
      // the window's model button (mods/chat pickParts): model, level, Fast
      const words = [c.label ?? modelName(c.model), levelName(c.effort), c.fast ? "Fast" : null].filter(Boolean).join(" · ") || NAMES[kind] || "Agent";
      agent = { kind, words, ...(c.model ? { model: c.model, modelLabel: label } : {}), ...(c.effort ? { effort: c.effort } : {}), ...(c.model ? { runtime: { model: c.model, modelLabel: label, ...(c.effort ? { effort: c.effort } : {}), speed: c.fast ? "fast" : "normal", source: "session", at: Date.now() } } : {}) };
    } catch {}
    // the first row: the log's very start, or earlier pages to load as it scrolls up
    const head = reader.start === 0 ? { top: true } : reader.start ? { earlier: true } : {};
    // the window's lines over the box: what it does while it works (its log's call, else its status report), only
    // waiting (no spinner); asking in its terminal with no card here (Needs you)
    const report = typeof t?.report?.msg === "string" ? t.report.msg.trim() : "";
    const cards = messages.some((m) => (m.question && !m.question.closed) || m.secret);
    const under = st === "working" ? { doing: reader.conv?.doing ?? (report && !/^answer:/i.test(report) ? report : ""), ...(reader.conv?.waiting ? { waits: true } : {}) }
      : st === "blocked" && !cards ? { blocked: report.replace(/^answer:\s*/i, "") } : {};
    // a note under the conversation (a lost session being started again: service/watch.ts)
    const note = addr ? watch?.notes?.get(addr)?.text : undefined;
    // instead of the conversation, the window's notice: still opening, not a chat agent, its log not found, ended
    const kind = kindOfTerm(t);
    const notice = !reader.conv && (reader.state === "finding" || reader.state === "pending") ? "opening"
      : reader.state === "none" || reader.state === "missing" ? ((t && t.state !== "live") || !t ? "ended" : kind ? "none" : "unsupported")
      : !reader.pinned && (!t || t.state !== "live") && !items.length ? "ended" : null;
    return { key, messages, ...head, ...under, ...(note ? { note } : {}), ...(notice ? { notice } : {}), ...(agent ? { agent } : {}), ...(jobs.length ? { jobs } : {}), working: st === "working", cli: reader.kind === "codex" ? "codex" : "claude", ...(reader.pinned || (t && t.state !== "live") ? { finished: true } : {}) };
  }
}
