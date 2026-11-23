// What a voice call's tools do (core/voice.js TOOLS: look, open, send, act, screen): read from the snapshot the app
// shows (service/next.ts enrich), in the words the screen uses (web/shared/view.ts: no status is worked out twice),
// the chats as the service reads them, and change things through the same actions the app's buttons send
// (service/main.ts doAction), so a call reaches what the person's app reaches, no more. Every answer is a few short
// sentences to be spoken, never raw data; long ones are cut here. A task is named by its title, a space as the list
// names it ("#shop", "Everything"). An act that deletes, merges or stops changes nothing until the voice agent says
// the person confirmed it out loud (confirmed: true).
import type { AgentPick, Need, Snapshot, Task, Place } from "../web/shared/types.ts";
import { ACTS, ASK_FIRST, navWords, REPLY_MAX, SETTINGS } from "../core/voice.js";
import { screenParams, screenWords } from "../core/screen.js";
import { planRows, windowWords, whyWords, healthWords } from "../core/machines.js";
import { artifactsIn, everything, isEverything, listOf, machineLabel, machineWarn, needsCount, nowGroups, onBranch, scheduleLine, schedulesOf, spaceLabel, spacesOf, statusWord, taskLine, taskWhen, tstate, unreachable, whereWords } from "../web/shared/view.ts";
import { SOURCES, scrub, render, at, search, segments, type SourceArgs } from "./voice-data.ts";

/** Where a call comes from and what its app shows now (sent by the page as it changes). SHEP-105: a call is with
 *  Shepherdr as a whole, not one chat: "here" is what the screen shows. */
export type Where = {
  client: "web" | "window";
  /** phone or desktop */
  device?: string | null;
  /** the machine serving the app */
  machine?: string | null;
  /** the chat a call was started from, when it was started from one (its key); only "here" while the screen shows none */
  call?: string | null;
  /** what the app shows now: a space (place id), a task, its right-hand pane (tasks, artifacts, screen, terminal), an
   *  artifact open, Settings */
  place?: string | null;
  task?: string | null;
  tab?: string | null;
  artifact?: string | null;
  settings?: boolean;
  /** (3.2: the call runs over the app, there is no full-screen call) */
  full?: boolean;
  /** SHEP-251: the phone is locked (Shepherdr Wake runs the call); SHEP-261: it can do all an unlocked one can */
  locked?: boolean;
  /** SHEP-251: the phone's screen is on */
  screen?: boolean;
};

/** Something to show in the app the call runs in: what the page's voiceNav takes (web/plugins/voice/client.tsx). */
export type Nav =
  | { kind: "space"; place: string }
  /** a space's chat (its p: key) */
  | { kind: "chat"; chat: string }
  /** a task, in the Tasks pane; tab: its agent's Screen beside it */
  | { kind: "task"; task: string; tab?: "screen" | "browser" }
  /** Tasks, Now */
  | { kind: "tasks" }
  | { kind: "needs" }
  /** the shown chat's or task's own views: its chat or its agent's terminal, its Screen (browser, desktop), Tasks, Artifacts */
  | { kind: "panel"; panel: "chat" | "terminal" | "screen" | "browser" | "desktop" | "tasks" | "artifacts" }
  | { kind: "artifact"; artifact: string }
  | { kind: "settings"; section?: string }
  /** the page itself (core/screen.js) */
  | { kind: "screen"; do: string; ref?: string; text?: string; direction?: string; submit?: boolean; find?: string; confirmed?: boolean };

export type ChatRead = { status: string | null; doing?: string | null; items: { who: "you" | "agent" | "news"; text: string; at?: number }[]; earlier?: () => Promise<boolean> };

export interface VoiceIO {
  /** the snapshot the app shows (enriched: service/next.ts) */
  snap(): Snapshot | null;
  /** a chat by its key, read now (null: no such chat running) */
  chat(key: string): Promise<ChatRead | null>;
  /** a message as the person's own into a chat; throws an Error in plain words */
  send(key: string, text: string): Promise<void>;
  /** one of the app's actions (Action), as /api/action runs it: its answer, or throws an Error in plain words */
  action(body: Record<string, unknown>): Promise<any>;
  /** (not used since 3.2: the page opens a chat or task by its key or id alone) */
  addrOf?(key: string): string | null;
  taskWhere?(id: string): { ref: string; folder: string; machine: string | null } | null;
  /** one of the other reads (voice-data.ts SOURCES): its data, or throws an Error in plain words */
  read?(source: string, args: SourceArgs): Promise<unknown>;
}

/** a tool's answer: words for the voice agent; an open's nav, and what it shows in words, for the app to show and confirm */
export type Answer = { result: string; nav?: Nav; shows?: string; error?: boolean; then?: Nav; sent?: string };
/** what the app said once it tried a nav: it shows it now (ok), or why not; with what it shows now */
export type Ack = { ok: boolean; why?: string | null; where?: Record<string, unknown>; did?: string; ask?: string; screen?: string };

const MAX = 3500;
const cut = (s: unknown, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const words = (s: unknown) => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const HERE = new Set(["", "here", "this", "that", "it", "current", "thisone", "thatone", "thistask", "thisspace", "thischat", "me"]);
const isHere = (id: unknown) => HERE.has(norm(id));
/** the app's " · " between facts, as a spoken pause */
const plain = (s: string) => s.replace(/\s*·\s*/g, ", ").replace(/…$/, "");
/** a list said out loud: the first n, then how many more */
function list(items: string[], n: number, what: string) {
  if (!items.length) return "";
  const shown = items.slice(0, n);
  return shown.join("\n") + (items.length > n ? `\n…and ${items.length - n} more ${what}.` : "");
}
const done = (result: string, nav?: Nav, max = MAX): Answer => ({ result: result.length > max ? `${result.slice(0, max - 1)}…` : result, ...(nav ? { nav } : {}) });
const fail = (result: string): Answer => ({ result, error: true });

/** The groups of Tasks › Now and the statuses within them, from the person's words ("the ready ones", "what's stuck"). */
type Filter = "needs" | "ready" | "stopped" | "working" | "next" | "done" | "archived";
const FILTER_WORDS: Record<Filter, string> = { needs: "that need you", ready: "ready for review", stopped: "stopped", working: "working", next: "up next", done: "done", archived: "archived" };
function stateOf(q: string): Filter | null {
  const w = norm(q);
  if (!w) return null;
  if (/^(ready|review|toreview|forreview)/.test(w)) return "ready";
  if (/^(stop|stuck|crash|fail)/.test(w)) return "stopped";
  if (/^(need|needs|needsyou|needsme|waiting|blocked|asking|ask)/.test(w)) return "needs";
  if (/^(work|working|running|active|busy|inprogress|merging)/.test(w)) return "working";
  if (/^(upnext|next|queue|schedul|later|todo|notstarted|open)/.test(w)) return "next";
  if (/^(done|finished|merged|closed)/.test(w)) return "done";
  if (/^archiv/.test(w)) return "archived";
  return null;
}
const fits = (t: Task, f: Filter) => {
  const s = tstate(t);
  return f === "needs" ? s === "ask" || s === "ready" : f === "ready" ? s === "ready" : f === "stopped" ? s === "ask" && !!t.stopped : f === "working" ? s === "working" : f === "next" ? s === "next" : s === f;
};

function ago(ms: number | undefined) {
  if (!ms) return "";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 0) return "soon";
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}

// ---- finding what the person means --------------------------------------------------------

/** a space as the list names it: "Everything", "#shop" */
const label = (snap: Snapshot, id: string | null | undefined) => (id ? spaceLabel(snap, id) || snap.places.find((p) => p.id === id)?.name || "" : "");
/** a task as it is said: by its title, never its id */
const titled = (t: Task, n = 80) => `"${cut(t.name, n)}"`;
/** the spaces the app lists: Everything, then every space (another machine's home folder is not one) */
function appSpaces(snap: Snapshot): Place[] {
  const ev = everything(snap);
  return [...(ev ? [ev] : []), ...spacesOf(snap)];
}
const taskOfChat = (snap: Snapshot, key: string) => (key.endsWith("/worker") ? snap.tasks.find((t) => t.id === key.slice(0, -7)) ?? null : snap.tasks.find((t) => t.agent?.chat === key) ?? null);
const placeOfChat = (snap: Snapshot, key: string) => snap.places.find((p) => p.chat === key) ?? null;

/** the chat the screen shows: an open task's, else the shown space's, else the one the call started from */
export function screenChat(snap: Snapshot, where: Where): string | null {
  const t = where.task ? snap.tasks.find((x) => x.id === where.task) : null;
  if (t) return t.agent?.chat ?? `${t.id}/worker`;
  const p = where.place ? snap.places.find((x) => x.id === where.place) : null;
  return p?.chat ?? where.call ?? null;
}
const callKey = (where: Where) => where.call ?? "";
const placeHere = (snap: Snapshot, where: Where) => where.place ?? placeOfChat(snap, callKey(where))?.id ?? taskOfChat(snap, callKey(where))?.place ?? null;

const TASK_FILLER = new Set(["the", "a", "an", "task", "tasks", "one", "that", "this", "about", "called", "named", "titled", "please", "my"]);
/** the task meant: "this" (on screen, else the call's), words of its title (all of them; the one in the space on
 *  screen first, then the newest), or its id should the voice agent have one from the data */
export function findTask(snap: Snapshot, id: unknown, where: Where): Task | null {
  if (isHere(id)) return (where.task ? snap.tasks.find((t) => t.id === where.task) : null) ?? taskOfChat(snap, callKey(where));
  const want = norm(id);
  const live = snap.tasks.filter((t) => !t.archived);
  const whole = (ts: Task[]) => ts.find((t) => norm(t.name) === want);
  const byId = (ts: Task[]) => ts.find((t) => norm(t.id) === want || norm(t.id.split(":").pop()) === want);
  const exact = whole(live) ?? byId(live) ?? whole(snap.tasks) ?? byId(snap.tasks);
  if (exact) return exact;
  const ws = words(id).filter((w) => !TASK_FILLER.has(w));
  if (!ws.length) return null;
  const here = placeHere(snap, where);
  const match = (t: Task) => { const text = `${t.name} ${t.id}`.toLowerCase(); return ws.every((w) => text.includes(w)); };
  const best = (ts: Task[]) => ts.filter(match).sort((a, b) => Number(b.place === here) - Number(a.place === here) || (b.at ?? 0) - (a.at ?? 0))[0];
  return best(live) ?? best(snap.tasks) ?? null;
}

/** every name a machine goes by: its name, its own name, its key ("eliass-mac-mini"), and "this computer" for the one
 *  Shepherdr serves from */
export function machineAliases(m: Snapshot["machines"][number]) {
  const out = [m.name, m.ownName ?? "", m.machine, ...(m.here ? ["this computer", "this machine"] : [])].filter(Boolean);
  return [...new Set(out)];
}
const FILLER = new Set(["the", "a", "an", "space", "spaces", "project", "on", "in", "at", "of", "my", "s", "to", "switch", "go", "open", "show", "one", "please", "machine", "computer", "chat", "its"]);
const said = (s: unknown) => words(s).filter((w) => !FILLER.has(w));
/** the machines named in the person's words, and the words left for the space: "Mac Mini shop" → the Mac mini, ["shop"] */
function machinesSaid(snap: Snapshot, id: unknown) {
  const all = norm(id), ws = said(id);
  let best = 0, hits: Snapshot["machines"] = [], used = new Set<string>();
  for (const m of snap.machines) {
    let score = 0;
    const mine = new Set<string>();
    for (const a of machineAliases(m)) {
      const aw = said(a).filter((w) => w.length > 1);
      // the whole name said ("mac mini", "macmini"), else the most of its words ("mini" for "eliass-mac-mini")
      const whole = norm(a).length > 2 && all.includes(norm(a)) ? aw.length + 1 : 0;
      const some = aw.filter((w) => ws.includes(w));
      const sc = Math.max(whole, some.length);
      if (sc > score) { score = sc; mine.clear(); (whole >= some.length ? aw : some).forEach((w) => mine.add(w)); if (whole) mine.add(norm(a)); }
    }
    if (!score) continue;
    if (score > best) { best = score; hits = [m]; used = mine; }
    else if (score === best) { hits.push(m); mine.forEach((w) => used.add(w)); }
  }
  return { machines: hits, rest: ws.filter((w) => !used.has(w)) };
}

/** every space the person may mean: "here", "Everything", its name ("shop", "#shop"), "shop on the Mac mini", words of it */
export function spacesSaid(snap: Snapshot, id: unknown, where: Where): Place[] {
  if (isHere(id)) {
    const hit = snap.places.find((x) => x.id === placeHere(snap, where));
    return hit ? [hit] : [];
  }
  const want = norm(id);
  const ev = everything(snap);
  if (ev && /^(everything|everythingchat|theeverythingchat|home|root|mainchat|shepherdr)$/.test(want.replace(/^the/, ""))) return [ev];
  const all = spacesOf(snap);
  const exact = all.filter((p) => norm(p.id) === want || norm(p.id.split("/").pop()) === want);
  if (exact.length === 1) return exact;
  const { machines, rest } = machinesSaid(snap, id);
  const on = (p: Place) => !machines.length || machines.some((m) => m.machine === p.machine);
  const named = (p: Place, ws: string[]) => {
    const name = norm(p.name), nameWords = words(p.name);
    if (!ws.length) return false;
    return norm(ws.join("")) === name || ws.every((w) => nameWords.some((n) => n === w || (w.length > 2 && n.startsWith(w))) || (w.length > 2 && name.includes(w)));
  };
  // a machine said and its space's name: that machine's
  let hits = all.filter((p) => on(p) && named(p, rest));
  // the space's name said whole (one with a machine's word in it, "mini app")
  if (!hits.length) hits = all.filter((p) => norm(p.name) === want);
  if (!hits.length && machines.length) hits = all.filter((p) => named(p, said(id)));
  // words that name no space (a machine called otherwise than said): the space by the words that do, so it asks which
  if (!hits.length) {
    const known = said(id).filter((w) => all.some((p) => named(p, [w])));
    if (known.length) hits = all.filter((p) => on(p) && named(p, known));
    if (!hits.length && known.length) hits = all.filter((p) => named(p, known));
  }
  if (hits.length > 1) {
    // the same name exactly beats words of it; one in the list beats an archived one
    const whole = hits.filter((p) => norm(p.name) === norm(rest.join("")));
    if (whole.length) hits = whole;
    const active = hits.filter((p) => !p.archived);
    if (active.length) hits = active;
  }
  return hits;
}

/** the space meant, when only one fits (else null: none, or it could be several; open says which) */
export function findSpace(snap: Snapshot, id: unknown, where: Where): Place | null {
  const hits = spacesSaid(snap, id, where);
  return hits.length === 1 ? hits[0] : null;
}

/** "#shop on mac-mini": a space with its machine, as the list's small print has it (whereWords) */
const spaceSaid = (snap: Snapshot, p: Place) => (isEverything(snap, p.id) ? "Everything" : plain(whereWords(snap, p.id)).replace(", ", " on "));

/** the artifact meant: "this" (open now), its id, or words of its title (most words first, newest first) */
export function findArtifact(snap: Snapshot, id: unknown, where: Where) {
  const arts = [...(snap.artifacts ?? [])].sort((a, b) => b.at - a.at);
  if (isHere(id)) return (where.artifact ? arts.find((x) => x.id === where.artifact) : null) ?? arts[0] ?? null;
  const exact = arts.find((x) => x.id === id);
  if (exact) return exact;
  const ws = said(id).filter((w) => !["artifact", "page", "proof", "report", "the", "that", "it"].includes(w));
  if (!ws.length) return arts.find((x) => words(x.title).some((w) => words(id).includes(w))) ?? null;
  const text = (x: any) => `${x.title} ${snap.tasks.find((t) => t.id === x.task)?.name ?? ""} ${x.task ?? ""}`.toLowerCase();
  const score = (x: any) => ws.filter((w) => text(x).includes(w)).length;
  let best = 0, hit: (typeof arts)[number] | null = null;
  for (const a of arts) { const s = score(a); if (s > best) { best = s; hit = a; } }
  // most of the words said: at least half (newest first among the best)
  return hit && best * 2 >= ws.length ? hit : null;
}

/** what a chat is called: "Everything", "#shop", the task "Fix the login" */
export function chatName(snap: Snapshot, key: string) {
  const p = placeOfChat(snap, key);
  if (p) return label(snap, p.id) || "this chat";
  const t = taskOfChat(snap, key);
  return t ? `the task ${titled(t)}` : "this chat";
}
/** a chat as it is said after a send ("Passed it to shop."): a space's name without its "#", a task's title */
function chatSaid(snap: Snapshot, key: string) {
  const p = placeOfChat(snap, key);
  if (p) return isEverything(snap, p.id) ? "Everything" : p.name;
  const t = taskOfChat(snap, key);
  return t ? titled(t) : "this chat";
}

type ChatHit = { key: string; name: string; task?: Task; place?: Place };
/** a chat by what the person called it: "here" (the one on screen), a space (its chat) or a task (its own) */
function findChat(snap: Snapshot, id: unknown, where: Where): ChatHit | { error: string } {
  if (isHere(id)) {
    const key = screenChat(snap, where);
    if (!key) return { error: "No chat is on screen: which space or task?" };
    return { key, name: chatName(snap, key), task: taskOfChat(snap, key) ?? undefined, place: placeOfChat(snap, key) ?? undefined };
  }
  const p = findSpace(snap, id, where);
  const t = findTask(snap, id, where);
  if (t && (!p || norm(id) === norm(t.name) || norm(id) === norm(t.id))) {
    const key = t.agent?.chat;
    return key ? { key, name: `the task ${titled(t)}`, task: t } : { error: `${titled(t)} has no agent running: it is ${statusWord(t).word}.${tstate(t) === "next" ? " Start it first." : ""}` };
  }
  if (p) return { key: p.chat, name: label(snap, p.id), place: p };
  const many = spacesSaid(snap, id, where);
  if (many.length > 1) return { error: `Which one: ${many.slice(0, 6).map((x) => spaceSaid(snap, x)).join("; ")}? Ask the person.` };
  return { error: `I can't find a space or task called "${cut(id, 60)}".` };
}

// ---- look ---------------------------------------------------------------------------------

/** the screen of a task or a chat, as the snapshot knows it (none: idle, the person's to use) */
const screenOf = (snap: Snapshot, key: string) => snap.screens?.[key];
/** a step only the person can do there, still open */
const handsOf = (snap: Snapshot, key: string) => { const h = screenOf(snap, key)?.hands; return h && !h.settled ? h.what : ""; };

/** what waits in a chat, in the app's words: a question and its choices, a command to allow, a secret, a reply */
export function askWords(n: Need): string {
  const q = n.question;
  if (q && q.command !== undefined) return `wants to run a command: ${cut(q.command || q.title, 160)}`;
  if (q) return `asks: ${cut(q.title, 160)}${q.choices?.length ? ` (choices: ${q.choices.slice(0, 4).map((c) => cut(c.label, 40)).join(", ")})` : ""}`;
  if (n.secret) return `needs the secret ${n.secret.name}${n.secret.why ? ` (${cut(n.secret.why, 100)})` : ""}: it goes in the app's masked box, never by voice`;
  return `waits for a reply${n.text ? `: ${cut(n.text, 160)}` : ""}`;
}

/** A task in one line, as its row reads: its title, where, its status word and what it says now. */
export function taskSaid(snap: Snapshot, t: Task, withPlace = true) {
  const s = tstate(t), word = statusWord(t).word, line = taskLine(t);
  // the row's second line, without the status said twice ("Stopped · it hit its limit" after "Stopped")
  const rest = line.startsWith(word) ? line.slice(word.length).replace(/^[\s·…]+/, "") : line.startsWith(word.split(" · ")[0]) ? "" : line;
  const what = s === "ready" ? t.summary ?? "" : handsOf(snap, `task:${t.id}`) ? `Needs your hands: ${handsOf(snap, `task:${t.id}`)}` : rest;
  const when = taskWhen(t);
  const time = !when || when === "now" ? "" : s === "working" ? `, ${when}` : s === "ask" || s === "ready" ? `, for ${when}` : "";
  const space = withPlace ? label(snap, t.place) : "";
  return `${titled(t)}${space ? ` in ${space}` : ""}: ${plain(word)}${time}${what ? `. ${cut(plain(what), 140)}` : ""}`;
}

const PANES: Record<string, string> = { tasks: "Tasks", artifacts: "Artifacts", screen: "Screen", terminal: "your terminal" };

/** Where the call is and what the app shows, in words (look here, and the call's opening). */
export function lookHere(snap: Snapshot, where: Where) {
  const out = [`The call runs in the Shepherdr app${where.device ? ` on a ${where.device}` : ""}. It is with Shepherdr, not one agent.`];
  const shows: string[] = [];
  if (where.settings) shows.push("Settings");
  const t = where.task ? snap.tasks.find((x) => x.id === where.task) : null;
  if (t) shows.push(`the task ${titled(t)} (${plain(statusWord(t).word)})${where.tab === "screen" ? " and its Screen" : ""}`);
  const p = where.place ? snap.places.find((x) => x.id === where.place) : null;
  if (p) shows.push(`${t ? "in " : ""}${isEverything(snap, p.id) ? "Everything" : `the space ${spaceSaid(snap, p)}`}`);
  const a = where.artifact ? snap.artifacts.find((x) => x.id === where.artifact) : null;
  if (a) shows.push(`the artifact "${cut(a.title, 80)}"`);
  if (where.tab && !t && !a && PANES[where.tab]) shows.push(where.tab === "screen" ? "its agent's Screen" : PANES[where.tab]);
  if (shows.length) out.push(`The app shows ${shows.join(", ")}.`);
  if (where.locked === true) out.push("The person is on their phone with it locked: the app is not on its screen, but you can do all you can do unlocked.");
  const live = snap.tasks.filter((x) => !x.archived);
  const n = needsCount(snap), ready = live.filter((x) => tstate(x) === "ready").length, work = live.filter((x) => tstate(x) === "working").length;
  out.push(`Overall: ${n} ${n === 1 ? "needs" : "need"} the person${ready ? ` (${ready} ready for review)` : ""}, ${work} working.`);
  return out.join(" ");
}

async function lookChat(io: VoiceIO, snap: Snapshot, where: Where, id: unknown, query: string, count: number) {
  const c = findChat(snap, id, where);
  if ("error" in c) return fail(c.error);
  const read = await io.chat(c.key);
  if (!read) return fail(`I can't read ${c.name}'s chat right now: its agent isn't running.`);
  const st = read.status === "working" ? `working${read.doing ? `: ${cut(read.doing, 120)}` : ""}` : read.status === "blocked" ? "waiting for the person" : read.status === "done" || read.status === "idle" ? "idle, waiting for a message" : read.status ?? "not running";
  // without a query the newest agent reply goes whole (up to REPLY_MAX, like a reply the call says), the rest cut short (#785)
  const newest = query ? null : [...read.items].reverse().find((x) => x.who !== "you" && x.who !== "news");
  const line = (x: ChatRead["items"][number]) => `${x.who === "you" ? "Person" : x.who === "news" ? "From elsewhere" : "Agent"}${x.at ? ` (${ago(x.at)})` : ""}: ${cut(x.text, x === newest ? REPLY_MAX : query ? 300 : 500)}`;
  if (query) {
    const ws = words(query);
    const find = () => read.items.filter((x) => ws.every((w) => x.text.toLowerCase().includes(w)));
    // not in what is loaded: up to a few pages earlier
    for (let i = 0; i < 4 && find().length < count && read.earlier && (await read.earlier().catch(() => false)); i++);
    const hits = find().slice(-count);
    if (!hits.length) return done(`Nothing about "${cut(query, 60)}" in ${c.name}'s chat (as far back as I can read).`);
    return done(`${hits.length} message${hits.length === 1 ? "" : "s"} in ${c.name}'s chat about "${cut(query, 60)}", oldest first:\n${hits.map(line).join("\n")}`);
  }
  // the newest reply whole; the others, oldest dropped first, stay within MAX
  let last = read.items.slice(-count);
  const size = (xs: typeof last) => xs.filter((x) => x !== newest).map(line).join("\n").length;
  while (last.length > 1 && size(last) > MAX - 200) last = last.slice(1);
  return done(`The agent in ${c.name} is ${st}.${last.length ? `\nIts last ${last.length} message${last.length === 1 ? "" : "s"}, oldest first:\n${last.map(line).join("\n")}` : " Its chat is empty."}`, undefined, MAX + REPLY_MAX);
}

function lookSpaces(snap: Snapshot) {
  const out: string[] = [];
  const counts = (id: string) => {
    const n = needsCount(snap, id), w = snap.tasks.filter((t) => t.place === id && tstate(t) === "working").length;
    return [n ? `${n} ${n === 1 ? "needs" : "need"} you` : "", w ? `${w} working` : ""].filter(Boolean).join(", ");
  };
  const ev = everything(snap);
  if (ev) { const n = needsCount(snap); out.push(`Everything, the root chat${n ? `: ${n} ${n === 1 ? "needs" : "need"} you in all` : ""}.`); }
  for (const m of listOf(snap, "Active")) {
    const rows = [...m.groups.flatMap((g) => g.spaces), ...m.spaces].map((p) => `#${p.name}${counts(p.id) ? `: ${counts(p.id)}` : ""}`);
    if (rows.length) out.push(`On ${m.machine.name}${unreachable(m.machine) ? " (can't reach it)" : ""}: ${rows.join("; ")}.`);
  }
  const arch = spacesOf(snap).filter((p) => p.archived);
  if (arch.length) out.push(`Archived: ${arch.slice(0, 8).map((p) => `#${p.name}`).join(", ")}.`);
  return done(out.join("\n") || "No spaces yet.");
}

function lookMachines(snap: Snapshot) {
  const rows = snap.machines.map((m) => {
    const sp = spacesOf(snap).filter((p) => p.machine === m.machine && !p.archived).length;
    const work = snap.tasks.filter((t) => tstate(t) === "working" && snap.places.find((p) => p.id === t.place)?.machine === m.machine).length;
    const plans = planWords((m as any).stats);
    const warn = machineWarn(m);
    return `${m.name}${m.here ? " (serves Shepherdr)" : ""}: ${unreachable(m) ? `can't reach it${m.unreachableSince ? `, last seen ${m.unreachableSince}` : ""}${m.linkWhy ? " (its link is broken: herdr-task carry-over links it again)" : ""}` : m.connecting ? "connecting" : "online"}, ${sp} space${sp === 1 ? "" : "s"}, ${work} task${work === 1 ? "" : "s"} working.${warn && !unreachable(m) ? ` ${warn}.` : ""}${plans ? ` ${plans}` : ""}`;
  });
  const warns = (snap.warnings ?? []).map((w) => plain(w.text));
  return done((rows.join("\n") || "No machines.") + (warns.length ? `\nWarnings: ${warns.join("; ")}.` : ""));
}

/** a machine's health and its agent plans' limits, as Settings › Machines and Usage word them (core/machines.js) */
export function planWords(stats: any, now = Date.now()) {
  if (!stats) return "";
  const out: string[] = [];
  const h = stats.health ? healthWords(stats) : "";
  if (h) out.push(`Health: ${h}.`);
  for (const r of planRows(stats, now) as any[]) {
    if (r.none) continue;
    const name = `${r.name}${r.read?.plan ? ` (${r.read.plan})` : ""}`;
    if (r.read?.state !== "ok") { out.push(`${name}: ${whyWords(r.read)}`); continue; }
    const ws = (r.read.windows ?? []).map((w: any) => windowWords(w, now)).map((w: any) => (w.dead ? w.dead : `${w.name} ${w.words}, ${w.refill[0].toLowerCase()}${w.refill.slice(1)}`));
    out.push(`${name} plan: ${ws.length ? ws.join("; ") : "no limits reported"}.${r.read.failed ? " Its last read failed, so these may be old." : ""}`);
  }
  return out.join(" ");
}

function lookTasks(snap: Snapshot, where: Where, id: unknown, query: string, count: number) {
  let ts = snap.tasks;
  let scope = "";
  if (id) {
    const m = snap.machines.find((x) => machineAliases(x).some((a) => norm(a) === norm(id)));
    const p = m ? null : findSpace(snap, id, where);
    if (m) { ts = ts.filter((t) => snap.places.find((p) => p.id === t.place)?.machine === m.machine); scope = ` on ${m.name}`; }
    else if (p && !isEverything(snap, p.id)) { ts = ts.filter((t) => t.place === p.id); scope = ` in ${label(snap, p.id)}`; }
    else if (!p) return fail(`I can't find a space or machine called "${cut(id, 60)}".`);
  }
  const st = stateOf(query);
  if (st) ts = ts.filter((t) => fits(t, st));
  else if (query) { const ws = words(query); ts = ts.filter((t) => !t.archived && ws.every((w) => `${t.name} ${t.sub ?? ""} ${t.summary ?? ""}`.toLowerCase().includes(w))); }
  else ts = ts.filter((t) => !["done", "archived"].includes(tstate(t)));
  if (!ts.length) return done(`No tasks${st ? ` ${FILTER_WORDS[st]}` : ""}${scope}${query && !st ? ` matching "${cut(query, 60)}"` : ""}.`);
  // in the order of Tasks › Now: Needs you, Working, Up next, Done
  const groups = nowGroups(ts).filter((g) => g.tasks.length);
  const counts = groups.map((g) => `${g.tasks.length} ${g.name === "Needs you" ? (g.tasks.length === 1 ? "needs you" : "need you") : g.name.toLowerCase()}`).join(", ");
  return done(`${ts.length} task${ts.length === 1 ? "" : "s"}${scope}: ${counts}.\n${list(groups.flatMap((g) => g.tasks).map((t) => taskSaid(snap, t, !scope)), count, "tasks")}`);
}

async function lookTask(io: VoiceIO, snap: Snapshot, where: Where, id: unknown) {
  const t = findTask(snap, id, where);
  if (!t) return fail(isHere(id) ? "No task is on screen or on this call: which one?" : `I can't find a task called "${cut(id, 60)}".`);
  const s = tstate(t), p = snap.places.find((x) => x.id === t.place);
  const out = [`${titled(t, 120)} in ${p ? spaceSaid(snap, p) : "no space"}: ${plain(taskLine(t) || statusWord(t).word)}.`];
  if (s === "archived") out.push("It is archived.");
  const need = snap.needs.find((n) => n.task === t.id);
  if (s === "ask" && need && (need.question || need.secret)) out.push(`It ${askWords(need)}.`);
  const hands = handsOf(snap, `task:${t.id}`);
  if (hands) out.push(`It needs your hands on its Screen: ${cut(hands, 160)}.`);
  else if (screenOf(snap, `task:${t.id}`)?.active) out.push(`Its agent is using its Screen now${screenOf(snap, `task:${t.id}`)?.driver === "you" ? " (you took over)" : ""}.`);
  if (s === "working" && taskWhen(t)) out.push(`About ${taskWhen(t)}.`);
  if (t.afterTitle && s === "next") out.push(`It starts after "${cut(t.afterTitle, 80)}".`);
  if (t.schedule) out.push("It is a run of a schedule.");
  if (t.summary) out.push(`Its summary: ${cut(t.summary, 300)}`);
  if (t.details) out.push(`Details: ${cut(t.details, 600)}`);
  if (s === "ready") {
    out.push(onBranch(t) ? "It is on its own branch: Mark as done and merge." : t.repo === "folder" ? "It changed the folder itself, no branch: Mark as done, nothing to merge." : "Mark as done when you are happy with it; Not now leaves it here.");
    if (t.mergeFailed) out.push(`The last merge failed: ${cut(t.mergeFailed, 160)}.`);
    // what its review card shows: files changed, checks and proof, from Git and GitHub (never the agent's own words)
    const ev = await Promise.race([io.action({ type: "evidence", task: t.id }).catch(() => null), new Promise((r) => setTimeout(() => r(null), 8000))]) as any;
    const words = evidenceWords(ev);
    if (words) out.push(words);
  }
  if (!t.summary && t.desc && s !== "done") out.push(`Its brief starts: ${cut(t.desc, 300)}`);
  if (t.started && s !== "next") out.push(`Started ${ago(t.started)}.`);
  if (t.doneAt) out.push(`Finished ${ago(t.doneAt)}.`);
  return done(out.join("\n"));
}

/** a task's review card in a few words: files changed, checks, proof (herdr-task show --evidence, either shape) */
export function evidenceWords(got: any) {
  const ev = got?.evidence ?? got;
  if (!ev || typeof ev !== "object") return "";
  const out: string[] = [];
  const files = typeof ev.diff?.files === "number" ? ev.diff.files : Array.isArray(ev.diff?.list) ? ev.diff.list.length : Array.isArray(ev.files) ? ev.files.length : null;
  if (files != null) out.push(`${files} file${files === 1 ? "" : "s"} changed.`);
  const checks = ev.checks ?? ev.pr?.checks;
  if (Array.isArray(checks) && checks.length) {
    const bad = checks.filter((c: any) => /fail|error|cancel/i.test(String(c.conclusion ?? c.state ?? c.status ?? "")));
    const wait = checks.filter((c: any) => /pending|progress|queued|expected/i.test(String(c.conclusion ?? c.state ?? c.status ?? "")));
    out.push(bad.length ? `Checks: ${bad.length} failed (${bad.slice(0, 3).map((c: any) => cut(c.name ?? "", 40)).join(", ")}).` : wait.length ? `Checks: ${wait.length} still running.` : `Checks: all ${checks.length} passed.`);
  } else if (checks && typeof checks === "object" && typeof checks.state === "string") {
    if (checks.state === "passed") out.push("Checks passed.");
    else if (checks.state === "failed") out.push(`Checks failed${checks.text ? `: ${cut(checks.text, 100)}` : ""}.`);
    else if (checks.state === "running") out.push("Checks are still running.");
  } else if (typeof checks === "string") out.push(`Checks: ${cut(checks, 100)}.`);
  const proof = ev.proof ?? ev.artifact;
  if (proof) out.push(`It has a proof${typeof proof === "object" && proof.title ? `, "${cut(proof.title, 80)}"` : ""}.`);
  return out.join(" ");
}

/** Everything that waits on the person, as Tasks › Needs you and the chats' own asks show it. */
function lookNeeds(snap: Snapshot) {
  const rows: string[] = [];
  const told = new Set<Need>();
  for (const t of snap.tasks.filter((x) => ["ask", "ready"].includes(tstate(x)))) {
    const n = snap.needs.find((x) => x.task === t.id && (x.question || x.secret));
    if (n) told.add(n);
    for (const x of snap.needs) if (x.task === t.id) told.add(x);
    rows.push(n ? `${titled(t)} in ${label(snap, t.place)} ${askWords(n)}` : taskSaid(snap, t));
  }
  for (const n of snap.needs) if (!told.has(n) && !n.task) { told.add(n); rows.push(`${label(snap, n.place) || "A chat"} ${askWords(n)}`); }
  for (const p of appSpaces(snap)) {
    const hands = handsOf(snap, `chat:${p.id}`);
    if (hands) rows.push(`${label(snap, p.id)} needs your hands on its Screen: ${cut(hands, 140)}`);
    else if (p.needs && !snap.needs.some((n) => !n.task && n.place === p.id)) rows.push(`${label(snap, p.id)} waits for the person in its chat`);
  }
  if (!rows.length) return done("Nothing needs the person right now.");
  return done(`${rows.length} ${rows.length === 1 ? "needs" : "need"} the person:\n${list(rows, 10, "things")}`);
}

function lookNews(snap: Snapshot, count: number) {
  const items: { at: number; text: string }[] = [];
  for (const a of snap.alerts ?? []) items.push({ at: a.at, text: `Alert, ${cut(a.title.replace(/^[A-Z][A-Z0-9]*-\d+\s*·\s*/, ""), 80)}: ${cut(a.body, 140)}` });
  for (const t of snap.tasks) if (!t.archived && t.at) items.push({ at: t.at, text: taskSaid(snap, t) });
  items.sort((a, b) => b.at - a.at);
  const warns = (snap.warnings ?? []).map((w) => plain(w.text));
  if (!items.length && !warns.length) return done("No news.");
  return done(`${warns.length ? `Warnings: ${warns.join("; ")}.\n` : ""}${items.length ? `Latest first:\n${items.slice(0, count).map((x) => `${ago(x.at)}: ${x.text}.`).join("\n")}` : ""}`.trim());
}

function lookSchedules(snap: Snapshot, where: Where, id: unknown) {
  const p = id ? findSpace(snap, id, where) : null;
  if (id && !p) return fail(`I can't find a space called "${cut(id, 60)}".`);
  const all = !p || isEverything(snap, p.id);
  const rows = schedulesOf(snap, p?.id).map((a) => `"${cut(a.name, 80)}"${all ? ` in ${label(snap, a.place) || "Everything"}` : ""}: ${plain(scheduleLine(a))}${a.last ? `; last run ${plain(a.last)}` : ""}${a.error ? `. It didn't run as planned: ${cut(a.error, 100)}` : ""}.`);
  return done(rows.length ? list(rows, 12, "schedules") : `No schedules${all ? "" : ` in ${label(snap, p!.id)}`}.`);
}

const MERGE_WORDS: Record<string, string> = { done: "When I mark it as done", checks: "When checks pass", now: "Right away" };
const pickSaid = (p: AgentPick | undefined) => (p ? [p.agent, p.model, p.effort, p.fast === "ultrafast" ? "ultrafast" : p.fast ? "fast" : ""].filter(Boolean).join(", ") : "its own default");
const onOff = (v: unknown) => (v ? "on" : "off");

/** Settings as its pages show them: everything's values, or a space's own on top (the rest are Everything's). */
function lookSettings(snap: Snapshot, where: Where, id: unknown, query: string) {
  const c = snap.config;
  if (!c) return fail("Settings can't be read right now.");
  const p = id ? findSpace(snap, id, where) : null;
  if (id && !p) return fail(`I can't find a space called "${cut(id, 60)}".`);
  const own = p && !isEverything(snap, p.id) ? c.spaces[p.id] : null;
  const space = p && !isEverything(snap, p.id) ? p : null;
  const lv = own ?? c.all;
  const mark = (k: string) => (space ? (own?.own.includes(k) ? " (its own)" : " (as everywhere)") : "");
  let rows = [
    ...(["Chats", "Tasks", "Reviews"] as const).map((r) => `Agents › ${r} run on ${pickSaid(lv.agents?.[r])}${mark(`agents.${r}`)}`),
    `Tasks › Review by a second agent: ${onOff(lv.review)}${mark("review")}`,
    `Tasks › Merge: ${MERGE_WORDS[lv.merge] ?? lv.merge}${mark("merge")}`,
    `Tasks › Proof: ${onOff(lv.proof)}${mark("proof")}`,
    ...(space ? [] : [
      `Plugins: ${c.plugins.map((x) => `${x.name} ${x.always ? "always on" : onOff(x.on)}`).join(", ")}`,
      `Usage: ${c.plans.length ? c.plans.map((pl) => `${pl.name}: ${pl.windows.map((w) => `${w.name} ${w.used}% used${w.resets ? `, ${w.resets[0].toLowerCase()}${w.resets.slice(1)}` : ""}`).join("; ")}`).join(". ") : "no plan usage read yet"}`,
      `Secrets: ${c.secrets.length} kept (look secrets for their names)`,
      `Machines: ${snap.machines.map((m) => m.name).join(", ")}`,
    ]),
  ];
  const ws = words(query);
  if (ws.length) rows = rows.filter((r) => ws.every((w) => r.toLowerCase().includes(w)));
  if (!rows.length) return done(`No settings about "${cut(query, 60)}"${space ? ` for ${label(snap, space.id)}` : ""}. Its pages: ${SETTINGS.join(", ")}.`);
  return done(`${space ? `${label(snap, space.id)}'s settings` : "Settings, for every space"}${query ? ` about "${cut(query, 40)}"` : ""}:\n${rows.join("\n")}`);
}

function lookSecrets(snap: Snapshot) {
  const c = snap.config;
  if (!c) return fail("Secrets can't be read right now.");
  if (!c.secrets.length) return done("No secrets are kept yet.");
  return done(`${c.secrets.length} secret${c.secrets.length === 1 ? "" : "s"} kept (names only, values are never read out):\n${list(c.secrets.map((e) => `${e.name}, ${e.scope === "all" ? "every space" : `only ${label(snap, e.scope) || "one space"}`}`), 20, "secrets")}`);
}

function lookArtifacts(snap: Snapshot, where: Where, id: unknown, query: string, count: number) {
  const p = id ? findSpace(snap, id, where) : null;
  if (id && !p) return fail(`I can't find a space called "${cut(id, 60)}".`);
  const ev = everything(snap);
  const ws = words(query);
  // the Artifacts list: things made to keep (a task's proof stays on its task); a search finds proofs too
  let arts = ws.length ? [...(snap.artifacts ?? [])].sort((a, b) => b.at - a.at).filter((a) => !p || isEverything(snap, p.id) || a.place === p.id)
    : p || ev ? artifactsIn(snap, (p ?? ev)!.id) : [...(snap.artifacts ?? [])].sort((a, b) => b.at - a.at);
  if (ws.length) arts = arts.filter((a) => ws.every((w) => `${a.title} ${snap.tasks.find((t) => t.id === a.task)?.name ?? ""} ${snap.places.find((x) => x.id === a.place)?.name ?? ""}`.toLowerCase().includes(w)));
  if (!arts.length) return done(`No artifacts${query ? ` about "${cut(query, 60)}"` : ""}${p && !isEverything(snap, p.id) ? ` in ${label(snap, p.id)}` : ""}.`);
  return done(list(arts.map((a) => `"${cut(a.title, 90)}"${label(snap, a.place) ? ` in ${label(snap, a.place)}` : ""}, ${ago(a.at)}${a.pinned ? ", pinned" : ""}${a.proof ? ", a task's proof" : ""}`), count, "artifacts"));
}

// ---- data: everything the app shows (voice-data.ts) ---------------------------------------

/** What look data's top shows: the snapshot's every part, then the other sources. */
function dataTop(snap: Snapshot) {
  const parts = Object.entries(snap as any).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${Array.isArray(v) ? `${v.length} items` : v && typeof v === "object" ? `{${Object.keys(v).slice(0, 8).join(", ")}${Object.keys(v).length > 8 ? ", …" : ""}}` : JSON.stringify(v)}`);
  const src = Object.entries(SOURCES).map(([k, s]) => `${k}${s.arg ? ` (id: ${s.arg.replace(/-/g, " ")})` : ""}: ${s.about}`);
  return `Everything the app shows. path a part, then any key, item id or name ("machines/mini/stats/limits"), or query words to search it all.\nThe app's live data:\n${parts.join("\n")}\nRead on demand (path its name):\n${src.join("\n")}`;
}

/** what a source is about, from the look's id: a task, a space, a chat... ("here": what is on screen) */
function sourceArgs(snap: Snapshot, where: Where, kind: string | undefined, id: string): SourceArgs | { error: string } {
  if (!kind) return {};
  if (kind === "task" || kind === "task-or-space") {
    const t = findTask(snap, id, where);
    const exact = t && (isHere(id) || norm(id) === norm(t.name) || norm(id) === norm(t.id) || norm(id) === norm(t.id.split(":").pop()));
    if (t && (kind === "task" || exact)) return { task: t.id };
    if (kind === "task-or-space") { const p = findSpace(snap, id, where); if (p) return { place: p.id }; if (t) return { task: t.id }; }
    return { error: isHere(id) ? "Which task? Say its title." : `I can't find ${kind === "task" ? "a task" : "a task or space"} called "${cut(id, 60)}".` };
  }
  if (kind === "space") { const p = findSpace(snap, id, where); return p ? { place: p.id } : { error: `Which space? I can't find "${cut(id, 60)}".` }; }
  if (kind === "chat") { const c = findChat(snap, id || "here", where); return "error" in c ? c : { chat: c.key }; }
  if (kind === "machine") {
    if (!id || isHere(id)) return { machine: null };
    const m = snap.machines.find((x) => machineAliases(x).some((a) => norm(a) === norm(id)));
    return m ? { machine: m.here ? null : m.machine } : { error: `I can't find a machine called "${cut(id, 60)}".` };
  }
  return {};
}

async function lookData(io: VoiceIO, snap: Snapshot, where: Where, id: string, path: string, query: string) {
  const segs = segments(path);
  const src = segs.length ? Object.keys(SOURCES).find((k) => norm(k) === norm(segs[0])) : undefined;
  if (!src) {
    const root = scrub(snap);
    if (!segs.length && !query) return done(dataTop(snap));
    const node = at(root, segs);
    if ("error" in node) return fail(`${node.error} Look at data with no path for every part.`);
    if (query) {
      const hits = search(node.v, query);
      return done(hits.length ? `${hits.length} value${hits.length === 1 ? "" : "s"} about "${cut(query, 60)}"${segs.length ? ` in ${node.trail}` : ""}:\n${hits.join("\n")}` : `Nothing about "${cut(query, 60)}"${segs.length ? ` in ${node.trail}` : ""} in the live data. What is read on demand may have it: look at data with no path for those.`);
    }
    return done(`${node.trail}:\n${render(node.v, node.key)}`);
  }
  const s = SOURCES[src];
  if (!io.read) return fail("I can't read that from here.");
  const a = sourceArgs(snap, where, s.arg, id);
  if ("error" in a) return fail(a.error);
  const rest = segs.slice(1);
  const data = scrub(await io.read(src, s.rest ? { ...a, path: rest.join("/") } : a));
  const node = s.rest ? { v: data, key: src, trail: segs.join("/") } : at(data, rest);
  if ("error" in node) return fail(node.error);
  if (query) {
    const hits = search(node.v, query);
    return done(hits.length ? `${src}, about "${cut(query, 60)}":\n${hits.join("\n")}` : `Nothing about "${cut(query, 60)}" in ${src}.`);
  }
  return done(`${[src, ...rest].join("/")}:\n${render(node.v, node.key)}`);
}

// ---- the tools ----------------------------------------------------------------------------

/** One tool call from the voice agent: its answer in words, and what to show in the app (open). */
export async function voiceTool(name: string, params: any, where: Where, io: VoiceIO): Promise<Answer> {
  const snap = io.snap();
  const p = params && typeof params === "object" ? params : {};
  const id = typeof p.id === "string" ? p.id.slice(0, 200) : typeof p.id === "number" ? String(p.id) : "";
  const query = typeof p.query === "string" ? p.query.slice(0, 200).trim() : "";
  const count = Math.max(1, Math.min(30, Number.isFinite(Number(p.count)) && Number(p.count) > 0 ? Math.round(Number(p.count)) : 6));
  if (!snap) return fail("Shepherdr is still starting: try again in a moment.");
  try {
    if (name === "look") {
      switch (String(p.what ?? "")) {
        case "here": return done(lookHere(snap, where));
        case "chat": return await lookChat(io, snap, where, id, query, count);
        case "spaces": return lookSpaces(snap);
        case "machines": return lookMachines(snap);
        case "tasks": return lookTasks(snap, where, id, query, p.count ? count : 10);
        case "task": return await lookTask(io, snap, where, id);
        case "needs": return lookNeeds(snap);
        case "news": return lookNews(snap, p.count ? count : 8);
        case "schedules": return lookSchedules(snap, where, id);
        case "settings": return lookSettings(snap, where, id, query);
        case "secrets": return lookSecrets(snap);
        case "artifacts": return lookArtifacts(snap, where, id, query, p.count ? count : 8);
        case "data": return await lookData(io, snap, where, id, typeof p.path === "string" ? p.path.slice(0, 300) : "", query);
      }
      return fail(`look can read: here, chat, spaces, machines, tasks, task, needs, news, schedules, settings, secrets, artifacts, data.`);
    }
    if (name === "open") return open(snap, where, String(p.what ?? ""), id, typeof p.view === "string" ? p.view : typeof p.tab === "string" ? p.tab : "");
    if (name === "send") {
      const text = typeof p.text === "string" ? p.text.trim() : "";
      if (!text || text.length > 16000) return fail("Nothing to send.");
      const c = findChat(snap, typeof p.to === "string" ? p.to.slice(0, 200) : "", where);
      if ("error" in c) return fail(c.error);
      await io.send(c.key, text);
      // the call follows that chat from now on: its replies come as [Update]s (voice-hear.ts)
      return { ...done(`Sent to ${c.name}. Say "Passed it to ${chatSaid(snap, c.key)}." and nothing else: the reply comes later as an [Update].`), sent: c.key };
    }
    if (name === "act") return await act(snap, where, io, p, id);
    if (name === "screen") {
      const q = screenParams(p) as any;
      if (q.error) return fail(q.error);
      return { result: "Asked the page, but it hasn't answered.", nav: { kind: "screen", ...q }, shows: "the page" };
    }
    return fail("No such tool.");
  } catch (e: any) {
    return fail(cut(String(e?.message ?? e), 400) || "That didn't work.");
  }
}

/** An open: what to show and, until the app confirms, words that claim nothing (shown() says the rest). */
const showing = (shows: string, nav: Nav, then?: Nav): Answer => ({ result: `Asked the app to show ${shows}, but it hasn't confirmed: don't say it's on screen.`, nav, shows, ...(then ? { then } : {}) });
const which = (snap: Snapshot, hits: Place[], id: string): Answer =>
  fail(hits.length ? `Which one: ${hits.slice(0, 6).map((p) => spaceSaid(snap, p)).join("; ")}? Ask the person.` : `I can't find a space called "${cut(id, 60)}". Spaces: ${appSpaces(snap).filter((p) => !p.archived).slice(0, 12).map((p) => spaceSaid(snap, p)).join("; ")}.`);

/** the Settings page meant ("usage", "the plugins page", "voice" → Plugins, "schedules" → Plugins): null when none fits */
function settingsPage(id: string): string | null {
  const w = norm(id);
  if (!w) return "";
  const hit = SETTINGS.find((n: string) => w.includes(n.toLowerCase()) || (w.length > 2 && n.toLowerCase().startsWith(w)));
  if (hit) return hit;
  if (/model|claude|codex|agent/.test(w)) return "Agents";
  if (/review|merge|proof/.test(w)) return "Tasks";
  if (/voice|screens|schedule|reaction|terminal|plugin/.test(w)) return "Plugins";
  if (/plan|limit|usage/.test(w)) return "Usage";
  if (/theme|appearance|notification|alert|motion|width/.test(w)) return "General";
  if (/key|token|secret/.test(w)) return "Secrets";
  return null;
}

function open(snap: Snapshot, where: Where, what: string, id: string, view: string): Answer {
  /** a list or view of the shown chat; a space named: there first (the page goes to it, then opens the view) */
  const panel = (panel: "chat" | "terminal" | "tasks" | "artifacts", name: string): Answer => {
    if (!id || isHere(id)) return showing(name, { kind: "panel", panel });
    const hits = spacesSaid(snap, id, where);
    if (hits.length !== 1) return which(snap, hits, id);
    return showing(`${label(snap, hits[0].id)}'s ${name}`, { kind: "space", place: hits[0].id }, { kind: "panel", panel });
  };
  switch (what) {
    case "space": {
      const hits = spacesSaid(snap, id, where);
      if (hits.length !== 1) return which(snap, hits, id);
      const p = hits[0];
      return showing(isEverything(snap, p.id) ? "Everything" : `the space ${spaceSaid(snap, p)}`, { kind: "space", place: p.id });
    }
    case "chat": {
      const c = !id || isHere(id) ? null : findChat(snap, id, where);
      // "back to the chat": the shown chat again, its agent's terminal put away
      if (!c) return where.task ? showing("the task's chat", { kind: "task", task: where.task }) : showing("the chat", { kind: "panel", panel: "chat" });
      if ("error" in c) {
        // a task with no agent running still opens: its thread shows what it is
        const t = findTask(snap, id, where);
        return t && !findSpace(snap, id, where) ? showing(`the task ${titled(t)}`, { kind: "task", task: t.id }) : fail(c.error);
      }
      if (c.task) return showing(`the task ${titled(c.task)}`, { kind: "task", task: c.task.id });
      return showing(`${c.name}'s chat`, { kind: "chat", chat: c.key }, { kind: "panel", panel: "chat" });
    }
    case "task": {
      const t = findTask(snap, id, where);
      if (!t) return fail(isHere(id) ? "Which task?" : `I can't find a task called "${cut(id, 60)}".`);
      if (/^(screen|browser|desktop)$/.test(view)) return open(snap, where, "screen", t.id, view);
      return showing(`the task ${titled(t)}`, { kind: "task", task: t.id });
    }
    case "screen": {
      // an agent's Screen: its browser, or its desktop; a task's opens beside its task, a chat's beside its chat
      const desk = /^d/i.test(view);
      const name = desk ? "desktop" : "Screen";
      if (!id || isHere(id)) {
        if (!where.task && !where.place) return fail("Whose Screen? Say the task or the space.");
        return showing(`its agent's ${name}`, { kind: "panel", panel: desk ? "desktop" : "screen" });
      }
      const c = findChat(snap, id, where);
      const t = "error" in c ? (findSpace(snap, id, where) ? null : findTask(snap, id, where)) : c.task ?? null;
      if (t) return showing(`the ${name} of ${titled(t)}`, { kind: "task", task: t.id, tab: "screen" }, desk ? { kind: "panel", panel: "desktop" } : undefined);
      if ("error" in c) return fail(c.error);
      return showing(`${c.name}'s ${name}`, { kind: "space", place: c.place!.id }, { kind: "panel", panel: desk ? "desktop" : "screen" });
    }
    case "terminal": {
      // "Switch to terminal": a chat's agent's own terminal, in the chat's place
      const t = id && !isHere(id) && !findSpace(snap, id, where) ? findTask(snap, id, where) : isHere(id) || !id ? (where.task ? snap.tasks.find((x) => x.id === where.task) ?? null : null) : null;
      if (t) return fail(`A task's terminal opens from its menu: open the task ${titled(t)}, then with screen press its menu's "Switch to terminal".`);
      return panel("terminal", "agent's terminal");
    }
    case "tasks": case "needs": {
      // Tasks, Now: Needs you first
      if (id && !isHere(id)) {
        const hits = spacesSaid(snap, id, where);
        if (hits.length !== 1) return which(snap, hits, id);
        return showing(`${label(snap, hits[0].id)}'s Tasks`, { kind: "space", place: hits[0].id }, { kind: "panel", panel: "tasks" });
      }
      return showing(what === "needs" ? "Tasks, with what needs the person first" : "Tasks", { kind: what });
    }
    case "artifacts": return panel("artifacts", "Artifacts");
    case "artifact": {
      const a = findArtifact(snap, id, where);
      if (!a) return fail(`I can't find an artifact like "${cut(id, 60)}". Look at artifacts for their titles.`);
      return showing(`the artifact "${cut(a.title, 80)}"`, { kind: "artifact", artifact: a.id });
    }
    case "settings": {
      const page = settingsPage(id);
      if (page === null) return fail(`Settings has no page like "${cut(id, 40)}". Its pages: ${SETTINGS.join(", ")}.`);
      return showing(`Settings${page ? `, ${page}` : ""}`, { kind: "settings", ...(page ? { section: page } : {}) });
    }
  }
  return fail("open can show: space, chat, task, screen, terminal, tasks, needs, artifacts, artifact, settings.");
}

/** An open's answer once the app that started the call tried it: on screen only when it said so. show() asks that very
 *  page (its call socket) and resolves with its ack, or null when it didn't answer. */
export async function shown(a: Answer, show: (nav: Nav) => Promise<Ack | null>): Promise<Answer> {
  if (!a.nav) return a;
  const ask = (nav: Nav) => show(nav).catch((e) => ({ ok: false, why: String(e?.message ?? e) }) as Ack);
  let ack = await ask(a.nav);
  // the page's answer is the page itself (core/screen.js)
  if (a.nav.kind === "screen") { const { then: _t, ...rest } = a; return { ...rest, ...(screenWords(ack, a.nav.do) as { result: string; error?: boolean }) }; }
  // two steps (a space, then its view): the second only once the first is on screen
  if (ack?.ok && a.then) ack = await ask(a.then);
  const { then: _t, ...rest } = a;
  return { ...rest, ...(navWords(a.shows ?? "it", ack) as { result: string; error?: boolean }) };
}

// ---- act: what the app's buttons do -------------------------------------------------------

const TASK_ACTS = ["done", "done_without_merging", "start", "stop", "restart", "rename_task", "move_task", "archive", "unarchive", "delete"];
const SPACE_ACTS = ["rename_space", "archive_space", "unarchive_space", "remove_space"];
const SCHEDULE_ACTS: Record<string, string> = { run_schedule: "run", pause_schedule: "pause", resume_schedule: "resume" };
const SCREEN_ACTS: Record<string, string> = { take_over: "take", hand_back: "handback", skip_step: "skip" };
const YES = /^(yes|yeah|yep|y|ok|okay|allow|allowit|approve|accept|go|goahead|run|runit|sure|do|doit|true|on)$/;
const NO = /^(no|nope|n|deny|denyit|reject|dont|stop|cancel|refuse|false|off)$/;

/** the choice of a question the person's words pick: its number ("the second", "2"), its label, yes or no */
function choiceOf(n: Need, value: string): number | null {
  const cs = n.question?.choices ?? [];
  const w = norm(value);
  if (!w) return null;
  if (n.question?.command !== undefined && (YES.test(w) || NO.test(w) || /^declin/.test(w))) return YES.test(w) ? 0 : 1;
  if (!cs.length) return null;
  const nth = ["first", "second", "third", "fourth", "fifth"].findIndex((x) => w === x || w === `the${x}` || w === `${x}one` || w === `the${x}one`);
  if (nth >= 0 && nth < cs.length) return nth;
  if (/^\d$/.test(w) && Number(w) >= 1 && Number(w) <= cs.length) return Number(w) - 1;
  const exact = cs.findIndex((c) => norm(c.label) === w);
  if (exact >= 0) return exact;
  const yes = YES.test(w), no = NO.test(w) || /^declin/.test(w);
  if (yes || no) {
    // a command to allow, as its card's buttons: Allow once is the first choice, Decline the second
    if (n.question?.command !== undefined) return yes ? 0 : 1;
    const hit = cs.findIndex((c) => (yes ? /^(yes|allow|approve|ok|run|proceed|continue)/i : /^(no|deny|decline|reject|don|cancel|stop)/i).test(c.label.trim()));
    if (hit >= 0) return hit;
  }
  const ws = words(value);
  const part = cs.map((c, i) => ({ i, n: ws.filter((x) => c.label.toLowerCase().includes(x)).length })).filter((x) => x.n === ws.length);
  return part.length === 1 ? part[0].i : null;
}

/** One of the app's buttons, pressed for the person. An act that deletes, merges or stops says what to ask first
 *  ("Mark “Fix the login” as done and merge it?") and changes nothing until confirmed. */
async function act(snap: Snapshot, where: Where, io: VoiceIO, p: any, id: string): Promise<Answer> {
  const action = String(p.action ?? "");
  const value = typeof p.value === "string" ? p.value.trim().slice(0, 4000) : typeof p.value === "number" || typeof p.value === "boolean" ? String(p.value) : "";
  const key = typeof p.key === "string" ? p.key.trim().slice(0, 200) : "";
  const confirmed = p.confirmed === true;
  /** asked first: the acts that delete, merge or stop (core/voice.js ASK_FIRST), and others when they would */
  let asks = ASK_FIRST.includes(action);
  let ask = "", body: Record<string, unknown> | null = null, did = "";
  if (TASK_ACTS.includes(action)) {
    const t = findTask(snap, id, where);
    if (!t) return fail(isHere(id) ? "Which task?" : `I can't find a task called "${cut(id, 60)}".`);
    const n = titled(t, 70), chat = t.agent?.chat ?? `${t.id}/worker`, s = tstate(t), is = plain(statusWord(t).word);
    switch (action) {
      case "done": {
        if (s === "done" || s === "archived") return fail(`${n} is already ${is}.`);
        if (t.status === "merging" || t.accepting) return fail(`${n} is merging already.`);
        if (s === "ready") {
          // the review card's button: on its own branch it merges, else it is just done
          const merges = onBranch(t);
          ask = merges ? `Mark ${n} as done and merge it?` : `Mark ${n} as done?`; body = { type: "accept", task: t.id };
          did = merges ? `${n} is marked as done: it merges now.` : `${n} is marked as done.`;
        } else {
          // the menu's Mark as done on one not handed in: done as it is, nothing merged
          ask = `Mark ${n} as done? It is ${is}${onBranch(t) ? ", and its branch is not merged" : ""}.`; body = { type: "close", chat, force: true }; did = `${n} is marked as done${onBranch(t) ? ", not merged" : ""}.`;
        }
        break;
      }
      case "done_without_merging":
        if (s === "done" || s === "archived") return fail(`${n} is already ${is}.`);
        ask = `Mark ${n} as done without merging anything?`; body = { type: "close", chat, force: true }; did = `${n} is marked as done, not merged.`; break;
      case "start":
        if (s !== "next") return fail(`${n} isn't waiting to start: it is ${is}.${t.stopped ? " Restart it instead." : ""}`);
        body = { type: "task-start", chat }; did = `${n} starts now.`; break;
      case "stop":
        if (s !== "working") return fail(`${n} isn't working: it is ${is}.`);
        ask = `Stop ${n}? Its agent stops where it is; your next message carries on.`; body = { type: "stop", chat }; did = `Stopped ${n}.`; break;
      case "restart":
        if (!t.stopped) return fail(`${n} isn't stopped: it is ${is}.`);
        body = { type: "task-resume", chat }; did = `${n} is starting again.`; break;
      case "rename_task":
        if (!value) return fail("What should it be called?");
        body = { type: "task-rename", chat, name: cut(value, 200) }; did = `It is called "${cut(value, 80)}" now.`; break;
      case "move_task": {
        if (s !== "next") return fail(`A task moves only before it has started: ${n} is ${is}.`);
        const hits = spacesSaid(snap, value, where);
        if (hits.length !== 1) return value ? which(snap, hits, value) : fail("Move it to which space?");
        if (hits[0].id === t.place) return fail(`${n} is in ${label(snap, t.place)} already.`);
        body = { type: "task-move", chat, place: hits[0].id }; did = `Moved ${n} to ${label(snap, hits[0].id)}.`; break;
      }
      case "archive":
        if (t.archived) return fail(`${n} is archived already.`);
        // archiving a working task stops its agent first: asked like a stop
        if (s === "working") { asks = true; ask = `Archive ${n}? It is working: its agent stops.`; }
        body = { type: "archive", chat, on: true }; did = `Archived ${n}.`; break;
      case "unarchive":
        if (!t.archived) return fail(`${n} isn't archived.`);
        body = { type: "archive", chat, on: false }; did = `${n} is back in Tasks.`; break;
      case "delete": ask = `Delete ${n}? It is removed and its agent is stopped; its branch and files are left alone. This can't be undone.`; body = { type: "delete", chat, force: true }; did = `Deleted ${n}.`; break;
    }
  } else if (action === "answer") {
    // a question or a command to allow, answered as its card's buttons do; a plain wait is answered with send
    const c = findChat(snap, id || "here", where);
    if ("error" in c) return fail(c.error);
    const n = snap.needs.find((x) => x.chat === c.key && x.question && x.question.sent === undefined && !x.question.closed);
    if (!n) return fail(`${c.name} has no question open. To reply in its chat, use send.`);
    const q = n.question!;
    if ((q.parts?.length ?? 0) > 1) return fail(`${c.name} asks several things at once: open it and answer on the page.`);
    if (!value) return fail(`Answer what? It ${askWords(n)}.`);
    const pick = choiceOf(n, value);
    // words that pick no choice are a reply: what is typed next in that chat goes to its agent
    if (pick === null) return fail(q.command !== undefined ? "Allow it or decline it?" : q.choices?.length ? `That isn't one of its choices: ${q.choices.slice(0, 6).map((x) => cut(x.label, 40)).join(", ")}. Which one? Other words go in its chat with send.` : "It has no choices to pick: reply in its chat with send.");
    body = { type: "answer", chat: c.key, question: q.id, choice: pick, ...(q.command === undefined ? { byVoice: true, voiceAnswer: q.choices[pick]?.label ?? value } : {}) };
    did = q.command !== undefined ? (pick === 0 ? `Allowed it once for ${c.name}.` : `Declined it for ${c.name}.`) : `Answered ${c.name}: ${cut(q.choices[pick]?.label ?? value, 60)}.`;
  } else if (action in SCHEDULE_ACTS) {
    const all = schedulesOf(snap);
    const ws = words(id).filter((w) => !["the", "schedule", "a", "my"].includes(w));
    const hits = isHere(id) ? [] : all.filter((a) => norm(a.name) === norm(id));
    const some = hits.length ? hits : ws.length ? all.filter((a) => ws.every((w) => a.name.toLowerCase().includes(w))) : [];
    if (some.length !== 1) return fail(some.length ? `Which one: ${some.slice(0, 6).map((a) => `"${cut(a.name, 50)}" in ${label(snap, a.place) || "Everything"}`).join("; ")}?` : `I can't find a schedule called "${cut(id, 60)}". Look at schedules for their names.`);
    const a = some[0], op = SCHEDULE_ACTS[action];
    if (op === "pause" && !a.on) return fail(`"${cut(a.name, 60)}" is paused already.`);
    if (op === "resume" && a.on) return fail(`"${cut(a.name, 60)}" isn't paused.`);
    body = { type: "automation", op, id: a.id, place: a.place, name: a.name };
    did = op === "run" ? `"${cut(a.name, 60)}" runs now, as a task.` : op === "pause" ? `Paused "${cut(a.name, 60)}".` : `"${cut(a.name, 60)}" is on again.`;
  } else if (SPACE_ACTS.includes(action)) {
    const hits = spacesSaid(snap, id, where);
    if (hits.length !== 1) return isHere(id) && !hits.length ? fail("Which space?") : which(snap, hits, id);
    const sp = hits[0], n = label(snap, sp.id);
    if (isEverything(snap, sp.id)) return fail("Everything is the root chat: it can't be renamed, archived or removed.");
    const working = snap.tasks.filter((t) => t.place === sp.id && tstate(t) === "working").length;
    const stops = `${working ? `Its ${working} working task${working === 1 ? " stops" : "s stop"}, and its` : "Its"} schedules stop.`;
    switch (action) {
      case "rename_space":
        if (!value) return fail("What should it be called?");
        body = { type: "rename", id: sp.id, name: value }; did = `It is called ${cut(value, 80)} now.`; break;
      case "archive_space":
        if (sp.archived) return fail(`${n} is archived already.`);
        ask = `Archive ${n}? ${stops} Nothing is deleted.`; body = { type: "space-archive", place: sp.id, on: true }; did = `Archived ${n}.`; break;
      case "unarchive_space":
        if (!sp.archived) return fail(`${n} isn't archived.`);
        body = { type: "space-archive", place: sp.id, on: false }; did = `${n} is back in the list.`; break;
      case "remove_space": ask = `Remove ${n} from Shepherdr? ${stops} Its folder and code stay on disk.`; body = { type: "space-remove", place: sp.id, stop: true }; did = `Removed ${n}.`; break;
    }
  } else if (action === "setting") {
    const c = snap.config;
    if (!c) return fail("Settings can't be changed right now.");
    // no space said: for every space; "here": the space on screen
    const sp = id ? findSpace(snap, id, where) : null;
    if (id && !sp) return fail(isHere(id) ? "Which space?" : `I can't find a space called "${cut(id, 60)}".`);
    const place = sp && !isEverything(snap, sp.id) ? sp.id : "all";
    const forWhom = place === "all" ? "for every space" : `for ${label(snap, place)}`;
    const k = norm(key), v = norm(value);
    const reset = /^(reset|default|same|aseverything|aseverywhere)$/.test(v);
    if (reset && place === "all") return fail("Only a space's own setting can be reset: say which space.");
    const toggle = () => (YES.test(v) || v === "enable" || v === "enabled" ? true : NO.test(v) || v === "disable" || v === "disabled" ? false : null);
    const plugin = c.plugins.find((x) => norm(x.name) === k || norm(x.id) === k || k === `plugin${norm(x.id)}` || k === `${norm(x.name)}plugin`);
    if (/^merge/.test(k) || k === "whentomerge") {
      const m = reset ? null : /check/.test(v) ? "checks" : /now|rightaway|atonce|immediately|auto/.test(v) ? "now" : /done|mark|ask|review|manual/.test(v) ? "done" : undefined;
      if (m === undefined) return fail(`Merge can be: ${Object.values(MERGE_WORDS).join(", ")}.`);
      body = { type: "config", place, key: "merge", value: m }; did = `Merge is ${m ? `"${MERGE_WORDS[m]}"` : "as everywhere"} ${forWhom}.`;
    } else if (/^(review|proof)/.test(k) || /secondagent/.test(k)) {
      const which = /^proof/.test(k) ? "proof" : "review", on = reset ? null : toggle();
      if (on === null && !reset) return fail(`${which === "proof" ? "Proof" : "Review by a second agent"} is on or off: which?`);
      body = { type: "config", place, key: which, value: on }; did = `${which === "proof" ? "Proof" : "Review by a second agent"} is ${on === null ? "as everywhere" : onOff(on)} ${forWhom}.`;
    } else if (plugin) {
      if (plugin.always) return fail(`${plugin.name} is always on.`);
      const on = toggle();
      if (on === null) return fail(`${plugin.name} is on or off: which?`);
      // switching Voice off takes this call's button away: asked first
      if (plugin.id === "voice" && !on) { asks = true; ask = "Switch Voice off? Its button goes, and so does this way of talking to me."; }
      body = { type: "config", place: "all", key: `plugin.${plugin.id}`, value: on }; did = `${plugin.name} is ${onOff(on)}.`;
    } else return fail(`By voice I can set Merge, Review by a second agent, Proof and the plugins (${c.plugins.filter((x) => !x.always).map((x) => x.name).join(", ")}). For the rest, open Settings and use screen, or ask in Everything.`);
  } else if (action === "pin_artifact" || action === "unpin_artifact" || action === "delete_artifact") {
    const a = findArtifact(snap, id, where);
    if (!a) return fail(`I can't find an artifact like "${cut(id, 60)}".`);
    const n = `"${cut(a.title, 80)}"`;
    if (action === "delete_artifact") { ask = `Delete the artifact ${n} and its versions? This can't be undone.`; body = { type: "artifact-delete", place: a.place, artifact: a.id }; did = `Deleted ${n}.`; }
    else { const on = action === "pin_artifact"; body = { type: "artifact-pin", place: a.place, artifact: a.id, on }; did = `${on ? "Pinned" : "Unpinned"} ${n}.`; }
  } else if (action in SCREEN_ACTS) {
    // an agent's Screen: the task's or chat's on screen, or the one named
    const c = findChat(snap, id || "here", where);
    const t = "error" in c ? (id && !isHere(id) && !findSpace(snap, id, where) ? findTask(snap, id, where) : null) : c.task ?? null;
    if ("error" in c && !t) return fail(isHere(id) ? "Whose Screen? Say the task or the space." : c.error);
    const k = t ? `task:${t.id}` : `chat:${(c as ChatHit).place!.id}`;
    const whose = t ? titled(t) : (c as ChatHit).name;
    const sc = screenOf(snap, k), op = SCREEN_ACTS[action];
    const src = /^d/i.test(value) ? "d" : /^b/i.test(value) ? "b" : sc?.b || !sc?.d ? "b" : "d";
    const hands = handsOf(snap, k);
    if (op === "skip" && !hands) return fail(`${whose} has no step waiting for your hands.`);
    if (op === "handback" && sc && sc.driver !== "you" && !hands) return fail(`You haven't taken over the Screen of ${whose}.`);
    body = { type: "screen", key: k, op, src, ...(op === "handback" && hands ? { done: true } : {}) };
    did = op === "take" ? `You have the Screen of ${whose} now: its mouse and keyboard are yours. Say "hand back" when you are done.` : op === "handback" ? `Handed the Screen of ${whose} back to its agent.` : `Skipped that step for ${whose}.`;
  } else return fail(`act can do: ${(ACTS as string[]).join(", ")}. Anything else: ask for it in a chat with send, or do it on the page with screen.`);
  if (asks && !confirmed) return done(`Nothing changed yet. Ask the person: "${ask}" Only after a clear yes, call act again with confirmed true.`);
  const r = await io.action(body!);
  if (r && typeof r === "object" && r.ok === false) return fail(cut(String(r.error ?? "It didn't go through."), 300));
  return done(r?.why ? `${did} ${cut(String(r.why), 200)}` : did);
}
