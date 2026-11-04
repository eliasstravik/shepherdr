// The web app is Shepherdr 2.1's screen (its design, phone layout and motion, kept as they were), fed with
// Shepherdr 3's data: this turns what the service builds with the shared core (spaces, tasks, chats) into the
// shapes 2.1's screen reads (web/shared/types.ts: Snapshot, Chat), and its chat keys back into terminals.
//   a space's chat (its Assistant):  p:<space id, "/" as ":">     a task's chat:  <task id>/worker
// A task id is its ref ("SHEP-7"), "<machine>:<ref>" on another machine, as 2.1 wrote them.
import type { Snapshot, Place, Task, Need, Section, Machine, Chat, Message, Status, TaskStatus, StepKind, ActivityAnswer, Question, Artifact, SettingSection } from "../web/shared/types.ts";
import * as T from "../core/tasks.js";
import * as SPc from "../core/spaces.js";
import { kindOf as kindOfTerm } from "../core/chat-reader.js";
const CLI_NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex" };
import * as MNc from "../core/menus.js";
const { machineLabel } = MNc as any;
import { HOME } from "./paths.ts";
const { spaceName } = SPc as any;
import type { Where } from "./worktree.ts";
import * as AGc from "../core/agents.js";
const { current, rowFor, menuFor, modelName } = AGc as any;
import * as NF from "../core/notify.js";
const { NOTIFY, everywhereOf, spaceLevel, machineLevel, machineOfSpace, spaceOwn } = NF as any;

const { ago } = T as any;

export type Row = any;
export type Space = any;

const SECTION: Record<string, TaskStatus> = { needs: "need", working: "work", merging: "merging", ready: "ready", queued: "queued", todo: "todo", done: "done" };
const AGENT: Record<string, Status> = { blocked: "need", working: "work", done: "idle", idle: "idle" };

const PILOT_ABOUT = "Its Assistant wakes on a schedule or when something happens to its tasks, and works from the heartbeat.";
// the schedule's picks (herdr-task's --every words), and the events that wake it, as the window's
const PILOT_EVERY = [{ label: "Off", value: "" }, { label: "Every 30 min", value: "every 30 minutes" }, { label: "Every hour", value: "every 60 minutes" }, { label: "Weekdays 9:00", value: "weekdays 9:00" }];
export const PILOT_EVENTS: [string, string][] = [["added", "Added"], ["ready", "Ready"], ["failed", "Failed"], ["needs-you", "Needs you"], ["merged", "Merged"], ["stalled", "Stalled"]];
function when(ms: number) {
  const d = new Date(ms), today = new Date();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === today.toDateString() ? `Today ${hm}` : `${d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })} ${hm}`;
}
const reasonWords = (r: string) => (r === "schedule" ? "Schedule" : r === "run now" ? "Run now" : String(r ?? "").replace(/^event:(\S+)/, (_m, e) => `Event: ${e}`));

/** A space's Autopilot page, as the window's: its switch, schedule (picks or its own words), events, heartbeat file,
 *  and how its wakes go. */
function pilotSection(s: Space): SettingSection {
  const a = s.pilot, on = !!a.on, events: string[] = a.events ?? [];
  const pending = a.pending, last = a.last_wake;
  return { name: "Autopilot", level: s.id, about: PILOT_ABOUT, rows: [
    { label: "Autopilot", key: "autopilot.on", value: on ? "on" : "off", options: ["on", "off"] },
    { label: "Schedule", key: "autopilot.every", value: a.every ?? "", text: true, hint: "When it wakes by itself.",
      trigger: { words: a.trigger ?? "Only Run now", next: on && a.next_run ? [when(a.next_run)] : [], presets: PILOT_EVERY } },
    { label: "Events", key: "autopilot.events", value: events.join(","), multi: PILOT_EVENTS.map(([v, l]) => ({ value: v, label: l })),
      hint: "These wake it at once when they happen to this space's tasks." },
    { label: "Heartbeat", key: "autopilot.heartbeat", value: a.words ?? "", doc: true },
    { label: "Next wake", key: "", fixed: true, value: !on ? "Off." : pending ? `Waiting: ${pending.note ?? "goes when its Assistant is idle"}.`
      : a.next_run ? `${when(a.next_run)} · Schedule` : events.length ? "On events only." : "Only on Run now." },
    { label: "Last wake", key: "", fixed: true, value: last ? `${when(last.at)} · ${reasonWords(last.reason)} · ${last.outcome}` : "Never." },
    { label: "Progress", key: "", fixed: true, value: a.progress ? `${a.progress.text} (${when(a.progress.at)})` : "None. The Assistant saves it after each wake." },
  ] } as SettingSection;
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

/** All of a tools row's steps, for 2.1's "N more" (GET api/activity?chat&what=turn&id). */
export function activity(reader: any, id: string): ActivityAnswer {
  const x = (reader?.conv?.items ?? []).find((i: any) => i.id === id && i.kind === "tools");
  if (!x) return { error: "That turn isn't in the chat any more." };
  return { steps: x.steps.map((s: any, i: number) => ({ id: `${s.id ?? i}`, kind: STEP[s.kind] ?? "other", tool: s.kind, at: 0, end: 1, title: s.line, doing: s.line, target: "" })) };
}

/** An artifact (herdr-artifact list) as 2.1's: its versions newest first, which space it belongs to (its folder's,
 *  here), and whether the web can draw it (a recipe) or only the window (an older GPUI one). */
/** herdr-task's automations as each space's (by its folder): the window's row words, its name, Paused or Didn't
 *  start, and when it runs next */
function automationsBySpace(list: any[], spaces: Space[]) {
  const out: Record<string, any[]> = {};
  for (const a of list) {
    const s = spaces.find((x) => (x.machine ?? null) === (a.machine ?? null) && x.folder === a.folder);
    if (!s) continue;
    const next = !a.last_error && !a.paused && a.next_run ? [new Date(a.next_run).toLocaleString("en", { weekday: "short", hour: "numeric", minute: "2-digit" })] : [];
    (out[s.id] ??= []).push({ name: a.title ?? a.id, when: a.last_error ? "Didn't start" : a.paused ? "Paused" : a.when ?? "", what: a.title ?? "", on: !a.paused, next });
  }
  return out;
}

function artifactOf(a: any, spaces: Space[], program: (addr: string) => string | null = () => null): Artifact {
  const place = spaces.find((s) => !s.machine && s.folder === a.folder)?.id ?? spaces.find((s) => !s.machine)?.id ?? "";
  // 3.0's row: "v3 · Claude Code · 2h ago": the program of the agent that published it while it runs, else nothing
  const by = (a.publisher && program(a.publisher)) || "";
  const recipe = (a.files ?? []).includes("recipe.json") && !(a.files ?? []).includes("main.js");
  return {
    id: a.id, title: a.title, place, v: a.version, at: a.at, when: ago(a.at, false), by, keeper: "", kind: recipe ? "recipe" : "gpui",
    versions: [...(a.versions ?? [])].reverse().map((x: any) => ({ n: x.v, when: ago(x.at, false), by, html: x.v, ...(x.note ? { note: x.note } : {}) })),
  };
}

export class Compat {
  /** chat key -> terminal address, from the last build */
  private chats = new Map<string, string>();
  /** task id -> where herdr-task finds it */
  private tasks = new Map<string, { ref: string; folder: string; machine: string | null; key: string; pin: string; where: Where }>();

  taskOf(id: string) { return this.tasks.get(id) ?? null; }

  private rows: Row[] = [];
  private spaceList: Space[] = [];
  /** A space by its id: its folder and machine. */
  spaceOf(id: string) { const s = this.spaceList.find((x) => x.id === id); return s ? { id: s.id, folder: s.folder, machine: s.machine ?? null } : null; }

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
  agents: { info(addr: string, reader: any): Promise<unknown>; restart(addr: string, reader: any, pick: any): Promise<string>; choices(machine: string | null): Promise<unknown> } | null = null;

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
    const detail = w.detail ? `${fence}text\n${w.detail}\n${fence}${w.cut ? "\n\nToo long to show here in full: answer it in the terminal." : ""}` : undefined;
    return w.kind === "plan"
      ? { id: a.id, title: w.title, kind: "Plan", to: key, plan: `${w.detail ?? ""}${w.cut ? "\n\nToo long to show here in full: answer it in the terminal." : ""}`, choices: [{ label: "Approve" }, { label: "Keep planning" }], noteRequiredFor: 1 }
      : { id: a.id, title: w.title, kind: "Question", to: key, ...(detail ? { plan: detail } : {}), choices: [{ label: "Allow" }, { label: "Deny" }] };
  }
  last: Snapshot | null = null;

  addrOf(key: string) { return this.chats.get(key) ?? null; }

  snapshot(input: { host: string; user: string; machines: { name: string; here: boolean; state: string }[]; spaces: Space[]; sections: any[]; rows: Row[]; artifacts?: any[]; settings?: SettingSection[]; off?: string[]; offPlugins?: string[]; automations?: any[] }): Snapshot {
    const { host, spaces, rows } = input;
    this.host = host;
    this.rows = rows;
    this.spaceList = spaces;
    const chats = new Map<string, string>();
    const machines: Machine[] = input.machines.map((m) => {
      // named as the window's sidebar names it: the person's name for it, else its own; this computer "This computer"
      const key = m.here ? host : m.name, look = (this.shared?.value("spaces-chat") ?? {}).machines?.[m.here ? "" : m.name] ?? {};
      return { id: `m:${key}`, machine: key, name: machineLabel(m.here ? null : m.name, look.name), ownName: m.here ? "This computer" : m.name, ...(look.icon ? { emoji: look.icon } : {}), status: m.state === "connected" ? "idle" : "off", ...(this.machineStats?.(m.here ? null : m.name) ?? {}) } as Machine;
    });
    const placeOf = (r: Row) => spaces.find((s) => (s.machine ?? null) === (r.machine ?? null) && s.folder === r.folder)?.id ?? "";

    const places: Place[] = spaces.map((s) => {
      const key = placeKey(s.id);
      if (s.assistant) chats.set(key, s.assistant);
      // its other tabs: each tab's first terminal, opened by the key t:<address> (the Assistant's tab is its chat)
      const tabs = (s.tabs ?? []).map((t: any) => ({ name: t.name || "Tab", addr: (t.terminals ?? [])[0] })).filter((t: any) => t.addr && t.addr !== s.assistant)
        .map((t: any) => { chats.set(`t:${t.addr}`, t.addr); return { name: t.name, term: `t:${t.addr}` }; });
      const name = spaceName(s, { home: s.machine ? null : HOME, repo: s.git?.name ?? null });
      // what 3.0's pane header says under it: "Assistant · Claude Code" (just "Assistant" until it has started), and the
      // folder it works in, home shortened to ~
      const kind = s.assistant ? kindOfTerm((this as any).terminalsOf?.(s.assistant)) : null;
      const header = `Assistant${kind ? ` · ${CLI_NAMES[kind] ?? kind}` : ""}`;
      const where = s.machine ? s.folder : s.folder === HOME ? "~" : s.folder.startsWith(HOME + "/") ? `~${s.folder.slice(HOME.length)}` : s.folder;
      return { id: s.id, name, ...(s.icon ? { emoji: s.icon } : {}), ...(s.git ? { git: s.git.linked ? "linked" : "main", repo: s.git.repo, gitName: s.git.name, branch: s.git.branch ?? null, ahead: s.git.ahead ?? 0, behind: s.git.behind ?? 0 } : {}), ...(s.git?.linked ? { worktree: true } : {}), machine: s.machine ?? host, level: 0, status: AGENT[s.assistantStatus] ?? "idle", mode: s.autopilot ? "autopilot" : "regular", chat: key, header, where, ...(tabs.length ? { tabs } : {}) };
    });

    this.tasks = new Map(rows.map((r) => [taskId(r), { ref: r.ref, folder: r.folder, machine: r.machine ?? null, key: `${r.slug}#${r.id}`, pin: r.key,
      where: { folder: r.worktree, machine: r.machine ?? null, base: r.base, start: r.start, branch: r.branch, pr: r.pr } }]));
    const tasks: Task[] = rows.filter((r) => r.section !== "done" || (r.done_at && Date.now() - r.done_at < 7 * 86400000)).map((r) => {
      const id = taskId(r);
      if (r.worker) chats.set(`${id}/worker`, r.worker);
      else if (r.lastLog) chats.set(`${id}/worker`, `log:${r.machine ?? ""}|${r.lastLog.kind}|${r.lastLog.path}`);
      const t: Task = {
        id, name: r.title, status: SECTION[r.section] ?? "todo", place: placeOf(r), age: r.started ? ago(r.started, false) : "",
        state: r.section, on: r.machine ?? host, created: "",
        ...(r.sub ? { sub: r.sub } : {}),
        ...(r.done_at ? { doneAt: r.done_at } : {}),
        ...(r.pr ? { pr: { number: r.pr.number, url: r.pr.url } } : {}),
        ...(r.branch ? { branch: r.branch } : {}), ...(r.base ? { base: r.base } : {}),
        // the task's browser (agent-browser), relayed for this machine's tasks
        ...(r.machine ? { browser: { ready: false, hint: "On another machine: open it in the Herdr window." } } : { browser: { ready: true } }),
        ...(r.pinned ? { pinned: 1 } : {}),
        ...(r.archived ? { archived: r.done_at ?? 1 } : {}),
        ...(r.section === "working" && r.pct != null ? { report: { msg: r.sub ?? "", progress: r.pct, ...(r.left ? { eta: parseInt(r.left) || 0 } : {}) } } : {}),
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
      { name: "Notify", level: "all", rows: [{ label: "Notify", key: "notify", value: everywhereOf(n), options: [...NOTIFY] },
        // push alerts on this phone or browser: 2.1's alerts action (it asks the device, then tells the service)
        { label: "Alerts on this device", key: "alerts", value: "", options: ["Turn on"] }] },
      ...spaces.map((s) => ({ name: "Notify", level: s.id, rows: [{ label: "Notify", key: "notify", value: level(s), options: [...NOTIFY],
        ...(spaceOwn(n, s.id) ? { inherits: { value: parent(s), from: "Everywhere" } } : { from: "Everywhere" }) }] })),
    ];

    // Autopilot (3.0's Settings › Autopilot): Everywhere lists the spaces on this machine, each space's page has its
    // switch, schedule, events, heartbeat and Run now (herdr-task keeps it all)
    // the Autopilot add-on off: no page, no switch (Settings › Window)
    const pilotOn = !(input.off ?? []).includes("autopilot");
    const local = pilotOn ? spaces.filter((s) => s.pilot) : [];
    const pilots: SettingSection[] = [
      { name: "Autopilot", level: "all", about: `Per space. ${PILOT_ABOUT}`, rows: local.map((s) => ({ label: s.name, key: "", fixed: true,
        value: s.pilot.on ? ["On", s.pilot.trigger, s.pilot.next_run ? `Next ${when(s.pilot.next_run)}` : null].filter(Boolean).join(" · ") : "Off" })) },
      ...local.map((s) => pilotSection(s)),
    ];
    if (pilotOn) notify.push(...pilots);

    this.chats = chats;
    this.last = {
      terminalTransport: "core", name: "Shepherdr", host, user: input.user, places, machines, tasks, automations: automationsBySpace(input.automations ?? [], spaces), asks: {}, needs, settings: [...(input.settings ?? []), ...notify],
      artifacts: (input.artifacts ?? []).map((a) => artifactOf(a, spaces, (addr) => { const k = kindOfTerm((this as any).terminalsOf?.(addr)); return k ? CLI_NAMES[k] ?? k : null; })),
      sections, last, read, off: input.offPlugins ?? [],
    };
    return this.last;
  }

  /** A followed conversation (core/chat-reader.js) as 2.1's Chat. A run of tool calls (3.0's tools row) is 2.1's turn
   *  rows: the first three, then "N more" (activity()). */
  chat(key: string, reader: any, t: any): Chat {
    const messages: Message[] = [];
    let at = 0;
    for (const x of reader.conv?.items ?? []) {
      if (x.at) at = x.at;
      const reactions = reactionsOf(reader.conv?.reactions?.get(x.id));
      if (x.kind === "user" && x.text) messages.push({ id: x.id, who: "you", text: x.text, at: x.at, ...(x.replyTo ? { reply: { text: x.replyTo } } : {}), ...reactions } as Message);
      else if (x.kind === "agent" && x.text) messages.push({ id: x.id, who: "agent", text: x.text, at: x.at, ...reactions });
      else if (x.kind === "error" && x.text) messages.push({ id: x.id, who: "agent", text: x.text, at: x.at });
      else if (x.kind === "news" && x.ref) {
        // a task's news line in its Assistant's chat (<herdr-news task=… event=…>), as it was said
        const task = reader.machine ? `${reader.machine}:${x.ref}` : x.ref;
        const status = NEWS[x.event] ?? "work";
        messages.push({ id: x.id, who: "agent", at: x.at, text: `${task} ${x.text}`, card: { id: x.id, task, status, text: x.text } });
      } else if (x.kind === "tools" && x.steps?.length) {
        const rows = x.steps.map(stepRow);
        messages.push({ id: x.id, who: "agent", at, activity: { id: x.id, at, end: at, rows: rows.slice(0, 3), steps: x.steps.length, ...(rows.length > 3 ? { more: rows.length - 3 } : {}) } });
      }
    }
    // what the agent asks now, as cards at the end of its chat
    const addr = this.chats.get(key);
    for (const a of addr ? this.asks?.of(addr) ?? [] : []) messages.push({ id: `ask:${a.id}`, who: "agent", at: a.at, question: this.question(a, key) });
    for (const a of (this.secrets?.asks() ?? []).filter((x) => x.address === addr)) messages.push({ id: `secret:${a.address}:${a.name}`, who: "agent", at: Date.now(), secret: this.secretAsk(a) } as Message);
    const st = t?.status?.state ?? null;
    // the CLI's own subagents still at work, above the box (3.0: the helpers list)
    const jobs = (reader.conv?.running?.() ?? []).map((h: any, i: number) => ({ id: `h${i}`, kind: "agent", title: h.desc, at: h.at ?? Date.now() }));
    // what it runs on, for the line under the box (core/agents.js: the window's model button says the same)
    let agent: any;
    try {
      const kind = reader.kind ?? "claude", c = current(kind, t?.foreground?.argv ?? t?.argv ?? [], reader.conv?.meta ?? {}, {});
      const row = rowFor(kind, c), label = menuFor(kind, {}).models.find((m: any) => m.id === row)?.name ?? modelName(c.model);
      if (c.model) agent = { kind, model: c.model, modelLabel: label, ...(c.effort ? { effort: c.effort } : {}), runtime: { model: c.model, modelLabel: label, ...(c.effort ? { effort: c.effort } : {}), speed: c.fast ? "fast" : "normal", source: "session", at: Date.now() } };
    } catch {}
    return { key, messages, ...(agent ? { agent } : {}), ...(jobs.length ? { jobs } : {}), working: st === "working", cli: reader.kind === "codex" ? "codex" : "claude", ...(reader.pinned || (t && t.state !== "live") ? { finished: true } : {}) };
  }
}
