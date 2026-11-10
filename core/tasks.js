// A task as the person sees it: its status (one of seven, as herdr-task shows them), why it needs them, its
// second line, its order in a group, and the words for times. The same rules as herdr-task's task_status(),
// for the Tasks panel (mods/tasks) and the web app alike: what Herdr knows live (a task's agents and their
// status) comes in as arguments, so nothing here reads Herdr.
// Shared core: the source is core/tasks.js; bin/sync-shared copies it into the mods in lib/COPIES.
import { REASONS } from "./needs.js";

// An agent's own status, most urgent first.
export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
export const STATUS = { needs: "Needs you", working: "Working", merging: "Merging", ready: "Ready", queued: "Queued", scheduled: "Scheduled", todo: "To do", done: "Done" };
export const RANK_OF = Object.fromEntries(["needs", "ready", "merging", "working", "queued", "scheduled", "todo", "done"].map((id, i) => [id, i]));
// The list's order: its groups, and the filter row's chips.
// Scheduled (SHEP-38, herdr-task --at/--in): a task that starts by itself at a time, after Queued (it waits longer).
export const ORDER = ["needs", "ready", "merging", "working", "queued", "scheduled", "todo", "done", "automations"];
// How the list can be grouped (the ⋯ menu's Group by; Shepherdr's GROUP_WORDS). "folder" was Space's old key.
export const GROUP_BY = ["you", "space", "status"];
// A grouping's key: "folder" was Space's; Machine and Machine › Space are gone (SHEP-98): For you.
export const groupBy = (v) => (v === "folder" ? "space" : GROUP_BY.includes(v) ? v : "you");
// The window's grouping now (shared "tasks.group", from its ⋯), For you until chosen. Before SHEP-98
// it was "tasks.groupby", Status split by space by default: Status with Split by space off stays
// Status, Space stays Space, the rest is For you. shared: the window's shared(key).
export const groupNow = (shared) => {
  const v = shared("tasks.group");
  if (v) return groupBy(v);
  const old = shared("tasks.groupby");
  return old === "space" || old === "folder" ? "space" : old === "status" && shared("tasks.split") === false ? "status" : "you";
};

export const machineOf = (address) => (address?.includes("/") ? address.split("/")[0] : null);
// A machine as people read it (the Spaces sidebar's words): its name, or This computer.
export const machineName = (m) => m ?? "This computer";

// An automation set off by another folder's task events (herdr-task auto --from), as its row's second line says it:
// the events, then where they happen ("On merges in vm-b · shepherdr").
const FROM_EVENTS = { added: "new tasks", ready: "ready tasks", failed: "failures", "needs-you": "tasks that need you", merged: "merges", stalled: "stalls" };
export function fromLine(events, where) {
  const words = (events ?? []).map((e) => FROM_EVENTS[e] ?? e);
  return `On ${words.length && words.length < 3 ? words.join(" or ") : "task events"} in ${where}`;
}

// What an automation's row says of where it is: its machine and space, both whatever the grouping (the Automations
// group sits under no machine or space heading); its machine only when more than one machine has tasks.
export const autoWhere = (machine, space, multi) => [multi ? machine : null, space].filter(Boolean).join(" · ") || null;
// This space (SHEP-72, the filter row's toggle): a task, automation or Needs-you item is a space's when it is on the
// space's machine and either its list's folder is the space's folder, or it was started for that space (the space id
// herdr-task keeps on it: "sp3", or "vm/sp3" once read from another machine). space: { id, machine, folder };
// thing: { machine, folder, space }.
const bareId = (id) => (id == null ? null : String(id).slice(String(id).lastIndexOf("/") + 1));
export function inSpace(space, thing) {
  if (!space || !thing || (thing.machine ?? null) !== (space.machine ?? null)) return false;
  return (Boolean(thing.folder) && thing.folder === space.folder) || (thing.space != null && bareId(thing.space) === bareId(space.id));
}
// A list's task id: HAT-4.
export const refOf = (list, task) => `${list.prefix}-${task.id}`;
// A task's pin key (shared "tasks.pinned"): "<machine, empty here>:<folder>#<id>".
export const taskKey = (list, task) => `${list.machine ?? ""}:${list.folder}#${task.id}`;

// herdr-task's auto_prefix: the initials of the folder name's words (herdr-app-ttt -> HAT, up to
// 5), or a single word's first 4 letters (shepherdr -> SHEP); at least 2 letters.
export function autoPrefix(folder) {
  const name = String(folder ?? "").split("/").filter(Boolean).pop() ?? "";
  const ws = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z]+/).filter(Boolean);
  let p = ws.length > 1 ? ws.map((w) => w[0]).join("").slice(0, 5) : (ws[0] ?? "").slice(0, 4);
  if (p.length < 2) p = ws.join("").length >= 2 ? ws.join("").slice(0, 2) : "TASK";
  return p.toUpperCase();
}

// An agent was started for the task under STARTING_MS ago and hasn't ended (as herdr-task's).
export const STARTING_MS = 90000;
export function starting(task, now = Date.now()) {
  const last = task.agents?.[task.agents.length - 1];
  if (last?.ended) return false;
  const at = Math.max(0, ...[task.started, last?.at, task.review?.at].filter((x) => typeof x === "number"));
  return now - at < STARTING_MS;
}

// A Ready task whose agent took up work again since it said ready (a message in its chat from anyone,
// herdr-task fix or resume) is Working again until its next ready, as herdr-task's busy_again(). Herdr counts an
// agent's finished turns (its terminal's turn): ready keeps, per agent, the turn it is on once the one it said
// ready in has ended (task.ready_turns); working on that turn or a later one is new work. Not while it merges as
// asked, nor a reviewer's turn; a ready said before turns were kept: any work once STARTING_MS have passed.
export const WORKING_AGAIN = "Working again";
export function busyAgain(task, live, now = Date.now()) {
  if (task.state !== "ready" || task.merge_requested) return false;
  const seen = task.ready_turns;
  if (!seen && now - (task.ready_at ?? 0) < STARTING_MS) return false;
  return live.some((a) => a.status === "working" && a.role !== "reviewer" && (a.turn ?? 0) >= (seen?.[a.address] ?? 0));
}

// A task's attention (failing checks, a conflict, a failed merge) needs the person only while nobody is on it
// (SHEP-8), as herdr-task's on_it(): one of its agents is at work (working, or asking: its question shows), it was
// just handed the problem (herdr-task fix, GitHub news: handed_at) and is starting, or its agent said what it's doing
// (herdr-task status) since the problem came up and that is still fresh (ON_IT_MS, or its own time left if longer):
// an agent waiting on CI in the background is idle to Herdr. Herdr's own words (progress.by) don't count.
export const ON_IT_MS = 30 * 60000;
export function onIt(task, live, now = Date.now()) {
  if (live.some((a) => (a.status === "working" || a.status === "blocked") && a.role !== "reviewer")) return true;
  if (now - (task.handed_at ?? 0) < STARTING_MS) return true;
  const p = task.progress ?? {}, said = p.set ?? 0;
  if (p.by || !live.length || !said || said < (task.attention_at ?? 0)) return false;
  return now - said < Math.max(ON_IT_MS, typeof p.left === "number" ? p.left : 0);
}

// A short grace before Needs you (SHEP-133), as herdr-task's GRACE_MS: a task often flips to Needs you for a few
// seconds and moves on by itself (its agent ends a turn a moment before it says ready, a background job's notice wakes
// it, a problem is found just before its agent is handed it). So a quiet agent (reply) and a problem Herdr found
// (attention) need the person only once they've lasted GRACE_MS: the agent's own status change (a.since: hc's
// status_ms) or the problem's attention_at says since when. What really asks (a question, a permission: blocked) needs
// the person at once.
export const GRACE_MS = 20000;
export const quietSince = (live) => Math.max(0, ...live.map((a) => (typeof a.since === "number" ? a.since : 0)));

// A provider retry's line (herdr-task's retry_line): "Provider overloaded · Retry in 2m".
export function retryLine(r, now = Date.now()) {
  return r.due ? `${r.reason} · Retry in ${Math.max(1, Math.ceil((r.due - now) / 60000))}m` : `${r.reason} · Retrying`;
}

// Ready only when the person must act (SHEP-175), as herdr-task's ready_wait(): a task said ready is Ready (and its
// news and alerts) only once the person's Accept is what's left. Not while its pull request's checks still run or
// GitHub works out whether it can merge (task.pr.wait, kept by herdr-task's tick), nor while it merges by itself:
// then it is Working, with what it waits for in a few words. Null when it's the person's.
export function readyWait(task, live = []) {
  if (task.merge_requested && live.length) return "Merging";
  if (task.merge_queued && task.pr) return "In GitHub's merge queue";
  // #743: waits calmly for a review GitHub requires.
  if (task.auto_merge && task.pr && !task.merged) return task.pr.needs_approval ? "Merges once it's approved" : "Merges once its checks pass";
  return task.pr?.wait || null;
}

// A task's status (its section), why it needs the person, and its live agents. live: its agents now
// ([{ address, status, ... }], only while it runs or is ready); loaded: false while its machine's agents
// aren't known yet; each { address, status, turn, role, since (hc's status_ms: GRACE_MS) }. The same rules as herdr-task's task_status(): its record,
// then its agents' own status.
// helpers: its worker's own helper agents (SHEP-54: a reviewer it started as its hc child), never among live: one at
// work or asking keeps the task Working (its worker waits on it; the worker answers what it asks), else they count not.
export function place(list, task, { live = [], helpers = [], loaded = true, now = Date.now() } = {}) {
  // A problem Herdr just found: the task reads as it would without it until GRACE_MS have passed (settles: when then).
  if (task.attention && ["running", "ready"].includes(task.state) && now - (task.attention_at ?? 0) < GRACE_MS) {
    const p = place(list, { ...task, attention: null }, { live, helpers, loaded, now });
    return { ...p, task, settles: (task.attention_at ?? 0) + GRACE_MS };
  }
  const st = task.state;
  if (!(st === "running" || st === "ready")) live = [];
  const status = live.reduce((s, a) => ((RANK[a.status] ?? 0) > (RANK[s] ?? 0) ? a.status : s), null);
  const busy = live.length && helpers.some((a) => a.status === "working" || a.status === "blocked");
  const states = [...live.map((a) => a.status), ...(busy ? ["working"] : [])];
  let section = ["todo", "queued", "scheduled", "done"].includes(st) ? st : null, needs = null, why = null, settles = 0;
  const need = (kind, text) => { section = "needs"; needs = kind; why = text; };
  if (section) return { list, task, live, status, section, needs, why };
  // Cut off by its model's provider (herdr-task tick): Working while Herdr waits to tell it to
  // carry on ("Provider overloaded · Retry in 2m"); Needs you once the tries are used up.
  const retry = st === "running" && task.retry && live.some((a) => a.address === task.retry.address) && !states.includes("blocked") ? task.retry : null;
  // Something Herdr found that only the person can sort out: failing checks, a conflict; while its agent is on it
  // (onIt()), Working with its agent's own line.
  const fixing = task.attention && onIt(task, live, now);
  if (task.attention && !fixing) need("attention", task.attention);
  else if (retry?.over) need("provider", retry.reason);
  else if (retry) { section = "working"; why = retryLine(retry, now); }
  // Why it waits: herdr-task's words (its agent's own status line, its question or last words),
  // kept on the task by its scheduler (task.waits), else the standard reason.
  else if (states.includes("blocked")) need("asks", task.waits ?? REASONS.question);
  // Claude Code's folder-trust dialog (#755): its agent reports no status while it shows; herdr-task's scheduler read
  // it off the screen (task.trust_ask: that agent's address).
  else if (task.trust_ask && live.some((a) => a.address === task.trust_ask && !a.status)) need("asks", task.waits ?? REASONS.trust);
  // Back at work after it said ready: no Accept until it says ready again.
  else if (busyAgain(task, live, now)) { section = "working"; why = WORKING_AGAIN; }
  else if (fixing) { section = "working"; why = st === "ready" ? WORKING_AGAIN : null; }
  else if (st === "ready") {
    // Nothing for the person yet (SHEP-175, readyWait()): Working, with what it waits for.
    const wait = readyWait(task, live);
    section = wait ? "working" : "ready";
    if (wait) why = wait;
    // Said ready but not at rest yet (SHEP-148, herdr-task's not_at_rest()): still at work in the turn it said ready
    // in, or its own work still running (a background job, a Monitor, a helper: task.own_work, kept by its scheduler).
    // Working until it is, and only then Ready.
    if (section === "ready" && live.length && (busy || task.own_work || live.some((a) => a.status === "working" && a.role !== "reviewer"))) section = "working";
  }
  // Its agents' terminals aren't known yet (the machine is loading): no verdict yet.
  else if (states.some((x) => x !== "idle" && x !== "done") || (!live.length && !loaded)) section = "working";
  // Just started (herdr-task's starting()): its terminal still runs the shell that starts the
  // agent, or the agent is idle before its first message lands.
  else if (starting(task, now)) section = "working";
  // Quiet, but on its own background work (SHEP-53, herdr-task's own_work()): a background shell or
  // Monitor still running, or its fresh status line says it waits on CI or a review. Kept on the task
  // by its scheduler (task.own_work); Working, with its own status line.
  else if (live.length && task.own_work && st === "running") section = "working";
  // Just gone quiet: still Working for GRACE_MS (settles: when it would need the person).
  else if (live.length && quietSince(live) && now - quietSince(live) < GRACE_MS) { section = "working"; settles = quietSince(live) + GRACE_MS; }
  // Quiet without saying ready (herdr-task ready): alive, it ended its turn (on what: task.waits);
  // its process gone, the agent stopped.
  else if (live.length) need("reply", task.waits ?? REASONS.reply);
  else need("stopped", REASONS.stopped);
  return { list, task, live, status, section, needs, why, ...(settles ? { settles } : {}) };
}

// Why a queued task waits: the tasks it comes after that aren't done, else the folder is full.
// running: how many of the list's tasks run with a live agent now.
export function queueReason(list, task, running) {
  const byId = new Map(list.tasks.map((x) => [x.id, x]));
  const wait = (task.after ?? []).filter((i) => byId.has(i) && byId.get(i).state !== "done");
  // Another folder's or machine's task (herdr-task --after WEB-2, vm-b:HAT-12): its state as
  // herdr-task last read it ("gone": removed, it holds nothing up).
  const ext = (task.after_ext ?? []).filter((x) => !["done", "gone"].includes(x.state)).map((x) => x.ref);
  if (wait.length || ext.length) return `after ${[...wait.map((i) => refOf(list, { id: i })), ...ext].join(", ")}`;
  // In plain words, as herdr-task's queue_reason: the folder's limit, else its machine too busy
  // (herdr-task tick's "held": "vm-a's memory is 92% full", HERD-40).
  if (running >= (list.config?.max_running ?? 10)) return `Waits: ${running === 1 ? "1 task is" : `${running} tasks are`} running here`;
  return task.held ? `Waits: ${task.held}` : "Starts soon";
}

// Minutes left show from the agent's very first estimate on: a rough guess beats none (DECISIONS.md,
// SHEP-13). Herdr never shows more than the agent said.
export const estimated = (p) => typeof p?.left === "number";

// What a task's agent last said (herdr-task status), as shown: { text, done, left (minutes), paused };
// none once it's ready or waits for a go or other tasks. Its minutes count down while it works and
// stop while it waits on the person (herdr-task notes when: progress.paused_at). own: the progress an
// agent reports itself (OSC 7501: { pct, msg }), which gives the % done, and its message is the line
// until it says one through herdr-task status.
export function reportOf(task, section, own = null, now = Date.now()) {
  const p = task.progress;
  if (task.state !== "running" || !["working", "needs"].includes(section)) return null;
  const text = p?.text || own?.msg || null;
  if (!text && !own) return null;
  const done = own ? own.pct : p?.done ?? null;
  let left = null;
  if (estimated(p)) {
    const rem = Math.max(0, p.left - ((p.paused_at ?? now) - (p.at ?? now)));
    left = rem < 60000 ? 0 : Math.ceil(rem / 60000);
  }
  return { text, done, left, paused: section === "needs" };
}

// Sort within a section: the newest activity first; to do in the order they were added.
export function order(section) {
  // Scheduled: the next to start first.
  if (section === "scheduled") return (a, b) => (a.task.scheduled_for ?? 0) - (b.task.scheduled_for ?? 0);
  if (section === "todo") return (a, b) => a.task.id - b.task.id;
  if (section === "done") return (a, b) => (b.task.done_at ?? 0) - (a.task.done_at ?? 0);
  return (a, b) => (b.task.ready_at ?? b.task.started ?? 0) - (a.task.ready_at ?? a.task.started ?? 0);
}

// Whether every word typed is in one of these, any case (Shepherdr's matches(): its lists' filters).
export function matches(q, ...fields) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const all = fields.filter((f) => f != null && f !== "").join(" ").toLowerCase();
  return words.every((w) => all.includes(w));
}

// "9:00" today, "Tue 9:00" this week, else "Nov 12 9:00".
export function day(ms, now = Date.now()) {
  const d = new Date(ms), today = new Date(now);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === today.toDateString()) return hm;
  // Within the week: its day; further: its date ("Nov 12").
  if (Math.abs(ms - now) < 6 * 86400000) return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${hm}`;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]} ${d.getDate()} ${hm}`;
}

export function ago(ms, suffix = true, now = Date.now()) {
  const m = Math.floor((now - ms) / 60000);
  const s = m < 1 ? "<1m" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
  return suffix ? (m < 1 ? "just now" : `${s} ago`) : s;
}

// Every second line starts with a capital ("After HERD-14"), an agent's own words too; a word
// already in mixed case ("iOS") is left as it is.
export const capital = (s) => (/^[a-z](?![A-Z])/.test(String(s)) ? s[0].toUpperCase() + s.slice(1) : s);

// Time left, as Shepherdr writes it short under a working row's glyph: "6m", "<1m", "2h".
export const short = (n) => (n < 1 ? "<1m" : n < 60 ? `${n}m` : `${Math.round(n / 60)}h`);

// A row's second line, as Shepherdr's: Needs you and Merging, why; Working, why or what its agent says it's
// doing (w: reportOf); Queued, what it waits for (queued: queueReason's words); Ready, since when.
export function secondLine(p, w, queued = null, now = Date.now()) {
  const { section } = p;
  return section === "needs" || section === "merging" ? p.why : section === "working" ? p.why ?? w?.text ?? null
    : section === "queued" ? queued
    : section === "scheduled" ? startsLine(p.task.scheduled_for, now)
    : section === "ready" ? (p.task.ready_at ? `Ready ${ago(p.task.ready_at, true, now)}` : "Ready to accept") : null;
}

// The minutes left under a working row's dot ("6m"), once its agent gave them; a scheduled one's time until it starts
// ("6h", "2d"), under its clock.
export const leftOf = (p, w, now = Date.now()) => (p.section === "scheduled" ? untilShort(p.task.scheduled_for, now)
  : p.section === "working" && !p.why && w?.left != null ? short(w.left) : null);

// ---- Scheduled (SHEP-38) ----------------------------------------------------------------------------------------
// herdr-task's when.py words: "Today 18:00", "Tomorrow 9:00", "Fri 9:00" this week, else "Nov 20 9:00".
export function startsAt(ms, now = Date.now()) {
  const d = new Date(ms), n = new Date(now);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 86400000);
  if (days === 0) return `Today ${hm}`;
  if (days === 1) return `Tomorrow ${hm}`;
  if (days > 1 && days < 7) return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${hm}`;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]} ${d.getDate()} ${hm}`;
}
// Until it starts, as few letters as fit under a dot: "45m", "6h", "2d"; "now" once due (the next tick starts it).
export function untilShort(ms, now = Date.now()) {
  if (typeof ms !== "number") return null;
  const m = Math.ceil((ms - now) / 60000);
  return m <= 0 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}
// A scheduled row's second line: "Starts Today 18:00"; "Starts now" once due.
export const startsLine = (ms, now = Date.now()) => (typeof ms !== "number" ? "Scheduled" : ms <= now ? "Starts now" : `Starts ${startsAt(ms, now)}`);
