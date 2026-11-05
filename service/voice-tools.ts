// What a voice call's tools do (core/voice.js TOOLS: look, open, send, act), for the web app's call and the window's
// alike: read from the snapshot the web app shows (service/compat.ts), the chats as the service reads them, and change
// things through the same actions the web app's buttons send (service/actions.ts), so a call reaches what the person's
// web app reaches, no more. Every answer is a few short sentences to be spoken, never raw data; long ones are cut
// here. An act changes nothing until the voice agent says the person confirmed it out loud (confirmed: true).
import type { Snapshot, Task, Place } from "../web/shared/types.ts";
import { navWords } from "../core/voice.js";

/** Where a call comes from: its app, the chat it started in, and what that app shows now (sent by the page or the window). */
export type Where = {
  client: "web" | "window";
  /** phone, tablet or desktop (web) */
  device?: string | null;
  /** the machine whose window it is (window), or the one serving the web app */
  machine?: string | null;
  /** the chat the call is with (its key: p:<space> for an Assistant, <task>/worker for a task's agent) */
  call: string;
  /** what the app shows now: a space (place id), a task, the task's tab, an artifact open, Settings */
  place?: string | null;
  task?: string | null;
  tab?: string | null;
  artifact?: string | null;
  settings?: boolean;
};

/** Something to show in the app the call runs in (the page's kernel, or the window's chat mod). */
export type Nav =
  | { kind: "space"; place: string }
  | { kind: "task"; task: string; tab?: string; chat?: string; addr?: string | null; ref?: string; title?: string; folder?: string; machine?: string | null }
  | { kind: "tasks"; filter?: string }
  | { kind: "needs" }
  | { kind: "artifact"; artifact: string; title: string; v: number; machine?: string | null }
  | { kind: "settings"; section?: string }
  | { kind: "chat"; chat: string; addr?: string | null };

export type ChatRead = { status: string | null; doing?: string | null; items: { who: "you" | "agent" | "news"; text: string; at?: number }[]; earlier?: () => Promise<boolean> };

export interface VoiceIO {
  snap(): Snapshot | null;
  /** a chat by its key, read now (null: no such chat running) */
  chat(key: string): Promise<ChatRead | null>;
  /** a message as the person's own into a chat; throws an Error in plain words */
  send(key: string, text: string): Promise<void>;
  /** one of the web app's actions (Action), as /api/action runs it: its answer, or throws an Error in plain words */
  action(body: Record<string, unknown>): Promise<any>;
  /** a chat key's terminal address (the window opens a task's chat by it) */
  addrOf?(key: string): string | null;
  /** a task's folder and machine (the window's Accept card needs them) */
  taskWhere?(id: string): { ref: string; folder: string; machine: string | null } | null;
}

/** a tool's answer: words for the voice agent; an open's nav, and what it shows in words, for the app to show and confirm */
export type Answer = { result: string; nav?: Nav; shows?: string; error?: boolean };
/** what the app said once it tried a nav: it shows it now (ok), or why not; with what it shows now */
export type Ack = { ok: boolean; why?: string | null; where?: Record<string, unknown> };

const MAX = 3500;
const cut = (s: string, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const words = (s: unknown) => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const HERE = new Set(["", "here", "this", "that", "it", "current", "thisone", "thatone", "thistask", "thisspace", "thischat", "me"]);
const isHere = (id: unknown) => HERE.has(norm(id));
/** a list said out loud: the first n, then how many more */
function list(items: string[], n: number, what: string) {
  if (!items.length) return "";
  const shown = items.slice(0, n);
  return shown.join("\n") + (items.length > n ? `\n…and ${items.length - n} more ${what}.` : "");
}
const done = (result: string, nav?: Nav): Answer => ({ result: result.length > MAX ? `${result.slice(0, MAX - 1)}…` : result, ...(nav ? { nav } : {}) });
const fail = (result: string): Answer => ({ result, error: true });

export const STATUS: Record<string, string> = {
  need: "needs you", ready: "ready for review", merging: "merging", work: "working", queued: "queued", scheduled: "scheduled", todo: "to do", done: "done",
};
const ORDER = ["need", "ready", "work", "merging", "queued", "scheduled", "todo", "done"];
/** "ready", "review", "needs me": a task state from the person's words */
function stateOf(q: string): string | null {
  const w = norm(q);
  if (!w) return null;
  if (/^(need|needs|needsyou|needsme|waiting|blocked|asking)/.test(w)) return "need";
  if (/^(ready|review|toreview|accept)/.test(w)) return "ready";
  if (/^(work|working|running|active|busy|inprogress)/.test(w)) return "work";
  if (/^merg/.test(w)) return "merging";
  if (/^queue/.test(w)) return "queued";
  if (/^(schedul|later)/.test(w)) return "scheduled";
  if (/^(todo|notstarted|open)/.test(w)) return "todo";
  if (/^(done|finished|merged|closed)/.test(w)) return "done";
  return null;
}

function ago(ms: number | undefined) {
  if (!ms) return "";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 0) return inTime(ms);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}
function inTime(ms: number) {
  const s = Math.round((ms - Date.now()) / 1000);
  if (s < 90) return "in a minute";
  if (s < 3600) return `in ${Math.round(s / 60)} minutes`;
  if (s < 86400 * 2) return `in ${Math.round(s / 3600)} hours`;
  return `in ${Math.round(s / 86400)} days`;
}
/** "SHEP-45" read as "SHEP 45"; another machine's "vm:SHEP-4" by its id */
const spoken = (id: string) => id.split(":").pop()!.replace(/-/g, " ");

// ---- finding what the person means --------------------------------------------------------

const placeName = (snap: Snapshot, id: string | null | undefined) => snap.places.find((p) => p.id === id)?.name ?? "";
const taskOfChat = (snap: Snapshot, key: string) => (key.endsWith("/worker") ? snap.tasks.find((t) => t.id === key.slice(0, -7)) ?? null : null);
const placeOfChat = (snap: Snapshot, key: string) => snap.places.find((p) => p.chat === key) ?? null;

/** the task meant: "this" (on screen, else the call's), its id ("SHEP-45", "shep 45", "45"), or words of its title */
export function findTask(snap: Snapshot, id: unknown, where: Where): Task | null {
  if (isHere(id)) return (where.task ? snap.tasks.find((t) => t.id === where.task) : null) ?? taskOfChat(snap, where.call);
  const want = norm(id);
  const live = snap.tasks.filter((t) => !t.archived);
  const byId = (ts: Task[]) => ts.find((t) => norm(t.id) === want || norm(t.id.split(":").pop()) === want);
  const hit = byId(live) ?? byId(snap.tasks);
  if (hit) return hit;
  // just its number: the one in the space on screen first
  if (/^\d+$/.test(want)) {
    const num = live.filter((t) => t.id.split("-").pop() === want);
    const here = where.place ?? placeOfChat(snap, where.call)?.id ?? taskOfChat(snap, where.call)?.place;
    return num.find((t) => t.place === here) ?? (num.length === 1 ? num[0] : null);
  }
  const ws = words(id);
  if (!ws.length) return null;
  const match = (t: Task) => ws.every((w) => `${t.id} ${t.name}`.toLowerCase().includes(w));
  return live.find(match) ?? snap.tasks.find(match) ?? null;
}

/** every name a machine goes by: its name, its own name, its key ("eliass-mac-mini"), and "this computer" for the one
 *  Shepherdr serves from (the Mac mini that serves calls itself "This computer", but the person says "the Mac mini") */
export function machineAliases(m: Snapshot["machines"][number]) {
  const out = [m.name, m.ownName ?? "", m.machine, ...(m.here ? ["this computer", "this machine"] : [])].filter(Boolean);
  return [...new Set(out)];
}
const FILLER = new Set(["the", "a", "an", "space", "spaces", "project", "on", "in", "at", "of", "my", "assistant", "s", "to", "switch", "go", "open", "show", "one", "please", "machine", "computer", "s"]);
const said = (s: unknown) => words(s).filter((w) => !FILLER.has(w));
/** the machines named in the person's words, and the words left for the space: "Mac Mini Home" → the Mac mini, ["home"] */
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

/** every space the person may mean: "here", its name, its id, "Home on the Mac mini", "Mac Mini Home", words of it */
export function spacesSaid(snap: Snapshot, id: unknown, where: Where): Place[] {
  if (isHere(id)) {
    const p = where.place ?? placeOfChat(snap, where.call)?.id ?? taskOfChat(snap, where.call)?.place;
    const hit = snap.places.find((x) => x.id === p);
    return hit ? [hit] : [];
  }
  const want = norm(id);
  const exact = snap.places.filter((p) => norm(p.id) === want || norm(p.id.split("/").pop()) === want);
  if (exact.length === 1) return exact;
  const { machines, rest } = machinesSaid(snap, id);
  const on = (p: Place) => !machines.length || machines.some((m) => m.machine === p.machine);
  const named = (p: Place, ws: string[]) => {
    const name = norm(p.name), nameWords = words(p.name);
    if (!ws.length) return !!p.home;
    return norm(ws.join("")) === name || ws.every((w) => nameWords.some((n) => n === w || (w.length > 2 && n.startsWith(w))) || (w.length > 2 && name.includes(w)) || (w === "home" && !!p.home));
  };
  // a machine said and its space's name: that machine's
  let hits = snap.places.filter((p) => on(p) && named(p, rest));
  // the space's name said whole (one with a machine's word in it, "mini app")
  if (!hits.length) hits = snap.places.filter((p) => norm(p.name) === want);
  if (!hits.length && machines.length) hits = snap.places.filter((p) => named(p, said(id)));
  // words that name no space (a machine called otherwise than said): the space by the words that do, so it asks which
  if (!hits.length) {
    const known = said(id).filter((w) => snap.places.some((p) => named(p, [w])));
    if (known.length) hits = snap.places.filter((p) => on(p) && named(p, known));
    if (!hits.length && known.length) hits = snap.places.filter((p) => named(p, known));
  }
  if (hits.length > 1) {
    // the same name exactly beats words of it
    const whole = hits.filter((p) => norm(p.name) === norm(rest.join("")));
    if (whole.length) hits = whole;
  }
  return hits;
}

/** the space meant, when only one fits (else null: none, or it could be several; open says which) */
export function findSpace(snap: Snapshot, id: unknown, where: Where): Place | null {
  const hits = spacesSaid(snap, id, where);
  return hits.length === 1 ? hits[0] : null;
}

/** "Home on the Mac mini": a space as the person would say it, its machine named when the name is on more than one */
const spaceSaid = (snap: Snapshot, p: Place) => `${p.name} on ${machineSaid(snap, p.machine)}`;
/** a machine as the person knows it: "This computer" with its own name beside it */
function machineSaid(snap: Snapshot, key: string | undefined) {
  const m = snap.machines.find((x) => x.machine === key);
  if (!m) return key ?? "";
  return m.here && m.machine && norm(m.name) !== norm(m.machine) ? `${m.name} (${m.machine})` : m.name;
}

/** the artifact meant: "this" (open now), its id, or words of its title (most words first, newest first) */
export function findArtifact(snap: Snapshot, id: unknown, where: Where) {
  const arts = [...(snap.artifacts ?? [])].sort((a, b) => b.at - a.at);
  if (isHere(id)) return (where.artifact ? arts.find((x) => x.id === where.artifact) : null) ?? arts[0] ?? null;
  const exact = arts.find((x) => x.id === id);
  if (exact) return exact;
  const ws = said(id).filter((w) => !["artifact", "page", "proof", "report", "the", "that", "it"].includes(w));
  if (!ws.length) return arts.find((x) => words(x.title).some((w) => words(id).includes(w))) ?? null;
  const text = (x: any) => `${x.title} ${x.task ?? ""} ${x.by ?? ""}`.toLowerCase();
  const score = (x: any) => ws.filter((w) => text(x).includes(w)).length;
  let best = 0, hit: (typeof arts)[number] | null = null;
  for (const a of arts) { const s = score(a); if (s > best) { best = s; hit = a; } }
  // most of the words said: at least half (newest first among the best)
  return hit && best * 2 >= ws.length ? hit : null;
}

/** a chat by what the person called it: "here" (the call's), a task (its agent's chat) or a space (its Assistant's) */
function findChat(snap: Snapshot, id: unknown, where: Where): { key: string; name: string } | { error: string } {
  if (isHere(id)) return { key: where.call, name: chatName(snap, where.call) };
  const t = findTask(snap, id, where);
  if (t && (norm(id) === norm(t.id) || norm(id) === norm(t.id.split(":").pop()) || !findSpace(snap, id, where))) {
    const key = t.agent?.chat;
    return key ? { key, name: `${spoken(t.id)}'s agent` } : { error: `${spoken(t.id)} has no agent running (it is ${STATUS[t.status] ?? t.status}).` };
  }
  const p = findSpace(snap, id, where);
  if (p) return { key: p.chat, name: `the ${p.name} Assistant` };
  return { error: `I can't find a space or task called "${cut(String(id), 60)}".` };
}

export function chatName(snap: Snapshot, key: string) {
  const t = taskOfChat(snap, key);
  if (t) return `${spoken(t.id)}'s agent`;
  const p = placeOfChat(snap, key);
  return p ? `the ${p.name} Assistant` : "this chat";
}

// ---- look ---------------------------------------------------------------------------------

function taskLine(snap: Snapshot, t: Task, withPlace = true) {
  const bits = [STATUS[t.status] ?? t.status];
  if (t.status === "work") {
    if (t.report?.progress != null) bits.push(`${t.report.progress}% done`);
    if (t.left) bits.push(`${t.left} left`);
  }
  if (t.status === "scheduled" && t.startsAt) bits.push(`starts ${inTime(t.startsAt)}`);
  if (t.status === "queued" && t.after?.length) bits.push(`after ${t.after.map(spoken).join(", ")}`);
  const what = t.status === "ready" ? t.summary : t.status === "done" ? "" : t.report?.msg || t.sub;
  const space = withPlace ? placeName(snap, t.place) : "";
  return `${spoken(t.id)}, "${cut(t.name, 80)}"${space ? ` in ${space}` : ""}: ${bits.join(", ")}${what ? `. ${cut(what, 140)}` : ""}`;
}

/** Where the call is and what the app shows, in words (look here, and the call's opening). */
export function lookHere(snap: Snapshot, where: Where) {
  const from = where.client === "web" ? `the web app${where.device ? ` on a ${where.device}` : ""}` : `the Herdr window${where.machine ? ` on ${where.machine}` : ""}`;
  const out = [`The call runs in ${from}. It is with ${chatName(snap, where.call)}.`];
  const shows: string[] = [];
  if (where.settings) shows.push("Settings");
  const t = where.task ? snap.tasks.find((x) => x.id === where.task) : null;
  if (t) shows.push(`task ${spoken(t.id)}, "${cut(t.name, 80)}" (${STATUS[t.status] ?? t.status})${where.tab && where.tab !== "chat" ? `, its ${where.tab} tab` : ""}`);
  const p = where.place ? snap.places.find((x) => x.id === where.place) : null;
  if (p) shows.push(`${t ? "in " : ""}the ${p.name} space on ${machineSaid(snap, p.machine)}`);
  const a = where.artifact ? snap.artifacts.find((x) => x.id === where.artifact) : null;
  if (a) shows.push(`the artifact "${cut(a.title, 80)}"`);
  if (shows.length) out.push(`The app shows ${shows.join(", ")}.`);
  const need = snap.needs.length, ready = snap.tasks.filter((x) => x.status === "ready" && !x.archived).length, work = snap.tasks.filter((x) => x.status === "work" && !x.archived).length;
  out.push(`Overall: ${need} waiting on the person, ${ready} ready for review, ${work} working.`);
  return out.join(" ");
}

async function lookChat(io: VoiceIO, snap: Snapshot, where: Where, id: unknown, query: string, count: number) {
  const c = findChat(snap, id, where);
  if ("error" in c) return fail(c.error);
  const read = await io.chat(c.key);
  if (!read) return fail(`I can't read ${c.name}'s chat right now: its agent isn't running.`);
  const st = read.status === "working" ? `working${read.doing ? `: ${cut(read.doing, 120)}` : ""}` : read.status === "blocked" ? "waiting for the person" : read.status === "done" || read.status === "idle" ? "idle, waiting for a message" : read.status ?? "not running";
  const line = (x: ChatRead["items"][number]) => `${x.who === "you" ? "Person" : x.who === "news" ? "From elsewhere" : "Agent"}${x.at ? ` (${ago(x.at)})` : ""}: ${cut(x.text, query ? 300 : 500)}`;
  if (query) {
    const ws = words(query);
    const find = () => read.items.filter((x) => ws.every((w) => x.text.toLowerCase().includes(w)));
    // not in what is loaded: up to a few pages earlier
    for (let i = 0; i < 4 && find().length < count && read.earlier && (await read.earlier().catch(() => false)); i++);
    const hits = find().slice(-count);
    if (!hits.length) return done(`Nothing about "${cut(query, 60)}" in ${c.name}'s chat (as far back as I can read).`);
    return done(`${hits.length} message${hits.length === 1 ? "" : "s"} in ${c.name}'s chat about "${cut(query, 60)}", oldest first:\n${hits.map(line).join("\n")}`);
  }
  const last = read.items.slice(-count);
  return done(`${c.name} is ${st}.${last.length ? `\nIts last ${last.length} message${last.length === 1 ? "" : "s"}, oldest first:\n${last.map(line).join("\n")}` : " Its chat is empty."}`);
}

function lookSpaces(snap: Snapshot) {
  const out: string[] = [];
  for (const m of snap.machines) {
    const mine = snap.places.filter((p) => p.machine === m.machine);
    if (!mine.length) continue;
    const rows = mine.map((p) => {
      const ts = snap.tasks.filter((t) => t.place === p.id && !t.archived);
      const n = (s: string) => ts.filter((t) => t.status === s).length;
      const bits = [p.mode === "autopilot" || p.pilot?.on ? "Autopilot on" : "", n("need") ? `${n("need")} need you` : "", n("ready") ? `${n("ready")} ready` : "", n("work") ? `${n("work")} working` : ""].filter(Boolean);
      return `${p.name}${p.home ? " (home)" : ""}${bits.length ? `: ${bits.join(", ")}` : ""}`;
    });
    out.push(`On ${machineSaid(snap, m.machine)}${m.status === "off" ? " (offline)" : ""}: ${rows.join("; ")}.`);
  }
  return done(out.join("\n") || "No spaces yet.");
}

function lookMachines(snap: Snapshot) {
  return done(snap.machines.map((m) => {
    const sp = snap.places.filter((p) => p.machine === m.machine).length;
    const work = snap.tasks.filter((t) => !t.archived && t.status === "work" && snap.places.find((p) => p.id === t.place)?.machine === m.machine).length;
    return `${machineSaid(snap, m.machine)}${m.here ? " (where Shepherdr serves from)" : ""}: ${m.status === "off" ? `offline${m.unreachableSince ? ` since ${m.unreachableSince}` : ""}` : m.connecting ? "connecting" : "online"}, ${sp} space${sp === 1 ? "" : "s"}, ${work} task${work === 1 ? "" : "s"} working.`;
  }).join("\n") || "No machines.");
}

function lookTasks(snap: Snapshot, where: Where, id: unknown, query: string, count: number) {
  let ts = snap.tasks.filter((t) => !t.archived);
  let scope = "";
  if (id) {
    const m = snap.machines.find((x) => norm(x.name) === norm(id) || norm(x.machine) === norm(id));
    const p = m ? null : findSpace(snap, id, where);
    if (m) { ts = ts.filter((t) => snap.places.find((p) => p.id === t.place)?.machine === m.machine); scope = ` on ${m.name}`; }
    else if (p) { ts = ts.filter((t) => t.place === p.id); scope = ` in ${p.name}`; }
    else return fail(`I can't find a space or machine called "${cut(String(id), 60)}".`);
  }
  const st = stateOf(query);
  if (st) ts = ts.filter((t) => t.status === st);
  else if (query) { const ws = words(query); ts = ts.filter((t) => ws.every((w) => `${t.id} ${t.name} ${t.sub ?? ""} ${t.summary ?? ""}`.toLowerCase().includes(w))); }
  else ts = ts.filter((t) => t.status !== "done");
  ts.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || (b.at ?? 0) - (a.at ?? 0));
  if (!ts.length) return done(`No ${st ? `${STATUS[st]} ` : ""}tasks${scope}${query && !st ? ` matching "${cut(query, 60)}"` : ""}.`);
  const counts = ORDER.map((s) => [s, ts.filter((t) => t.status === s).length] as const).filter(([, n]) => n).map(([s, n]) => `${n} ${STATUS[s]}`).join(", ");
  return done(`${ts.length} task${ts.length === 1 ? "" : "s"}${scope}: ${counts}.\n${list(ts.map((t) => taskLine(snap, t, !scope)), count, "tasks")}`);
}

async function lookTask(io: VoiceIO, snap: Snapshot, where: Where, id: unknown) {
  const t = findTask(snap, id, where);
  if (!t) return fail(isHere(id) ? "No task is on screen or on this call: which one?" : `I can't find task "${cut(String(id), 60)}".`);
  const out = [`${spoken(t.id)}, "${cut(t.name, 120)}", in ${placeName(snap, t.place) || "no space"}: ${STATUS[t.status] ?? t.status}${t.archived ? " (archived)" : ""}.`];
  if (t.status === "work" || t.status === "need") {
    if (t.report?.msg) out.push(`Its status: ${cut(t.report.msg, 120)}${t.report.progress != null ? `, ${t.report.progress}% done` : ""}${t.left ? `, ${t.left} left` : ""}.`);
    const need = snap.needs.find((n) => n.task === t.id);
    if (need) out.push(`It waits for: ${cut(need.question?.title ?? need.secret?.name ?? need.text ?? "an answer", 200)}.`);
  }
  if (t.status === "queued" && t.after?.length) out.push(`It waits for ${t.after.map(spoken).join(", ")}.`);
  if (t.status === "scheduled" && t.startsAt) out.push(`It starts ${inTime(t.startsAt)}.`);
  if (t.summary) out.push(`Its summary: ${cut(t.summary, 300)}`);
  if (t.details) out.push(`Details: ${cut(t.details, 600)}`);
  if (t.pr) out.push(`Pull request number ${t.pr.number}.`);
  if (t.facts) out.push(cut(t.facts, 300));
  if (t.status === "ready") {
    // what the Accept card shows: checks and proof, from Git and GitHub (never the agent's own words)
    const ev = await Promise.race([io.action({ type: "evidence", task: t.id }).catch(() => null), new Promise((r) => setTimeout(() => r(null), 8000))]) as any;
    const said = evidenceWords(ev);
    if (said) out.push(said);
  }
  if (!t.summary && t.desc) out.push(`Its brief starts: ${cut(t.desc, 300)}`);
  if (t.started) out.push(`Started ${ago(t.started)}.`);
  if (t.doneAt) out.push(`Finished ${ago(t.doneAt)}.`);
  return done(out.join("\n"));
}

/** herdr-task show --evidence, in a few words: commits and files, checks, proof */
export function evidenceWords(ev: any) {
  if (!ev || typeof ev !== "object") return "";
  const out: string[] = [];
  const commits = Array.isArray(ev.commits) ? ev.commits.length : null, files = Array.isArray(ev.files) ? ev.files.length : null;
  if (commits != null || files != null) out.push(`Changes: ${commits ?? "?"} commit${commits === 1 ? "" : "s"}${files != null ? `, ${files} file${files === 1 ? "" : "s"}` : ""}.`);
  const checks = ev.checks ?? ev.pr?.checks;
  if (Array.isArray(checks) && checks.length) {
    const bad = checks.filter((c: any) => /fail|error|cancel/i.test(String(c.conclusion ?? c.state ?? c.status ?? "")));
    const wait = checks.filter((c: any) => /pending|progress|queued|expected/i.test(String(c.conclusion ?? c.state ?? c.status ?? "")));
    out.push(bad.length ? `Checks: ${bad.length} failed (${bad.slice(0, 3).map((c: any) => cut(c.name ?? "", 40)).join(", ")}).` : wait.length ? `Checks: ${wait.length} still running.` : `Checks: all ${checks.length} passed.`);
  } else if (typeof checks === "string") out.push(`Checks: ${cut(checks, 100)}.`);
  const proof = ev.proof ?? ev.artifact;
  if (proof) out.push(`It has a proof page${typeof proof === "object" && proof.title ? `, "${cut(proof.title, 80)}"` : ""}.`);
  return out.join(" ");
}

function lookNeeds(snap: Snapshot) {
  const out = snap.needs.map((n) => {
    const who = n.task ? spoken(n.task) : `the ${placeName(snap, n.place) || "space"} Assistant`;
    if (n.question) return `${who} asks: ${cut(n.question.title, 160)}${n.question.choices?.length ? ` (choices: ${n.question.choices.slice(0, 4).map((c) => cut(c.label, 40)).join(", ")})` : ""}`;
    if (n.secret) return `${who} needs the secret ${n.secret.name}${n.secret.why ? `: ${cut(n.secret.why, 100)}` : ""}. It goes in the app's masked box, not by voice.`;
    return `${who} waits: ${cut(n.text ?? "for an answer", 160)}`;
  });
  const ready = snap.tasks.filter((t) => t.status === "ready" && !t.archived).map((t) => `${spoken(t.id)}, "${cut(t.name, 80)}", is ready for review${t.summary ? `: ${cut(t.summary, 140)}` : ""}`);
  if (!out.length && !ready.length) return done("Nothing waits on the person right now.");
  return done(list([...out, ...ready], 10, "things"));
}

function lookNews(snap: Snapshot, count: number) {
  const items: { at: number; text: string }[] = [];
  for (const a of snap.alerts ?? []) items.push({ at: a.at, text: `Alert, ${cut(a.title, 80)}: ${cut(a.body, 140)}` });
  for (const t of snap.tasks) {
    if (t.archived || !t.at) continue;
    items.push({ at: t.at, text: `${spoken(t.id)}, "${cut(t.name, 70)}", ${t.status === "done" ? "was done" : t.status === "ready" ? "became ready for review" : t.status === "work" ? "is working" : `is ${STATUS[t.status] ?? t.status}`}` });
  }
  items.sort((a, b) => b.at - a.at);
  if (!items.length) return done("No news.");
  return done(`Latest first:\n${items.slice(0, count).map((x) => `${ago(x.at)}: ${x.text}.`).join("\n")}`);
}

function pilotLine(snap: Snapshot, p: Place) {
  const a = p.pilot;
  const on = a?.on ?? p.mode === "autopilot";
  if (!on) return `${p.name}: Autopilot off.`;
  const bits = [a?.inflight ? "waking now" : a?.pending ? "queued to wake" : a?.next_run ? `next wake ${inTime(a.next_run * (a.next_run < 1e12 ? 1000 : 1))}` : "", a?.blank ? "its heartbeat is still empty" : ""].filter(Boolean);
  const last = a?.events?.length ? ` Latest: ${cut(a.events[a.events.length - 1], 140)}.` : "";
  return `${p.name}: Autopilot on${bits.length ? `, ${bits.join(", ")}` : ""}.${last}`;
}

function lookAutopilot(snap: Snapshot, where: Where, id: unknown) {
  if (id) {
    const p = findSpace(snap, id, where);
    if (!p) return fail(`I can't find a space called "${cut(String(id), 60)}".`);
    return done(pilotLine(snap, p));
  }
  const on = snap.places.filter((p) => p.pilot?.on || p.mode === "autopilot");
  return done(on.length ? `Autopilot is on in ${on.length} space${on.length === 1 ? "" : "s"}:\n${on.map((p) => pilotLine(snap, p)).join("\n")}` : "Autopilot is off in every space.");
}

function lookAutomations(snap: Snapshot, where: Where, id: unknown) {
  const p = id ? findSpace(snap, id, where) : null;
  if (id && !p) return fail(`I can't find a space called "${cut(String(id), 60)}".`);
  const rows: string[] = [];
  for (const [place, autos] of Object.entries(snap.automations ?? {})) {
    if (p && place !== p.id) continue;
    for (const a of autos) rows.push(`${a.name}${p ? "" : ` (${placeName(snap, place)})`}: ${a.on ? "" : "paused, "}${cut(a.when, 80)}, adds "${cut(a.what, 80)}"${a.on && a.next?.[0] ? `, next ${a.next[0]}` : ""}${a.error ? `. Its last run failed: ${cut(a.error, 100)}` : ""}.`);
  }
  return done(rows.length ? list(rows, 12, "automations") : `No automations${p ? ` in ${p.name}` : ""}.`);
}

/** Settings' rows at a level (all: Everywhere's; a space's id), what each is set to */
function settingRows(snap: Snapshot, level: string) {
  return (snap.settings ?? []).filter((s) => s.name !== "Secrets" && (s.global || (s.level ?? "all") === level))
    .flatMap((s) => s.rows.filter((r) => r.key && !r.button && !(r as any).hidden).map((r) => ({ section: s.name, row: r, level: s.level ?? "all" })));
}

function lookSettings(snap: Snapshot, where: Where, id: unknown, query: string) {
  const p = id ? findSpace(snap, id, where) : null;
  if (id && !p) return fail(`I can't find a space called "${cut(String(id), 60)}".`);
  let rows = settingRows(snap, p?.id ?? "all");
  const ws = words(query);
  if (ws.length) rows = rows.filter((x) => ws.every((w) => `${x.section} ${x.row.label} ${x.row.key}`.toLowerCase().includes(w)));
  if (!rows.length) return done(`No settings${query ? ` about "${cut(query, 60)}"` : ""}${p ? ` for ${p.name}` : ""}.`);
  const say = (x: (typeof rows)[number]) => `${x.section} › ${x.row.label}: ${cut(x.row.value || "default", 80)}${x.row.options?.length && x.row.options.length <= 6 ? ` (choices: ${x.row.options.join(", ")})` : ""}`;
  return done(`${p ? `${p.name}'s` : "Everywhere's"} settings${query ? ` about "${cut(query, 40)}"` : ""}:\n${list(rows.map(say), ws.length ? 15 : 25, "settings: ask about one")}`);
}

type Kept = { name: string; scope: string; machine?: string | null; space?: string | null; where?: string };
const vaultOf = (snap: Snapshot): Kept[] => ((snap.settings ?? []).find((s) => s.name === "Secrets" && (s as any).vault) as any)?.vault ?? [];

function lookSecrets(snap: Snapshot) {
  const v = vaultOf(snap);
  if (!v.length) return done("No secrets are kept yet.");
  return done(`${v.length} secret${v.length === 1 ? "" : "s"} kept (names only, values are never read out):\n${list(v.map((e) => `${e.name}, ${e.where ?? e.scope}`), 20, "secrets")}`);
}

function lookArtifacts(snap: Snapshot, where: Where, query: string, count: number) {
  let arts = [...(snap.artifacts ?? [])].sort((a, b) => b.at - a.at);
  const ws = words(query);
  if (ws.length) arts = arts.filter((a) => ws.every((w) => `${a.title} ${(a as any).task ?? ""} ${placeName(snap, a.place)}`.toLowerCase().includes(w)));
  if (!arts.length) return done(`No artifacts${query ? ` about "${cut(query, 60)}"` : ""}.`);
  return done(list(arts.map((a) => `"${cut(a.title, 90)}"${placeName(snap, a.place) ? ` in ${placeName(snap, a.place)}` : ""}, ${ago(a.at)}${(a as any).by ? ` by ${(a as any).by}` : ""}`), count, "artifacts"));
}

// ---- the tools ----------------------------------------------------------------------------

/** One tool call from the voice agent: its answer in words, and what to show in the app (open). */
export async function voiceTool(name: string, params: any, where: Where, io: VoiceIO): Promise<Answer> {
  const snap = io.snap();
  const p = params && typeof params === "object" ? params : {};
  const id = typeof p.id === "string" ? p.id.slice(0, 200) : typeof p.id === "number" ? String(p.id) : "";
  const query = typeof p.query === "string" ? p.query.slice(0, 200).trim() : "";
  const count = Math.max(1, Math.min(30, Number.isFinite(Number(p.count)) && Number(p.count) > 0 ? Math.round(Number(p.count)) : 6));
  // the oldest calls' tools, from an agent made before (send_to_agent, read_chat): as send and look at the chat
  if (name === "send_to_agent") return voiceTool("send", { text: p.text }, where, io);
  if (name === "read_chat") return voiceTool("look", { what: "chat" }, where, io);
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
        case "autopilot": return lookAutopilot(snap, where, id);
        case "automations": return lookAutomations(snap, where, id);
        case "settings": return lookSettings(snap, where, id, query);
        case "secrets": return lookSecrets(snap);
        case "artifacts": return lookArtifacts(snap, where, query, p.count ? count : 8);
      }
      return fail(`look can read: here, chat, spaces, machines, tasks, task, needs, news, autopilot, automations, settings, secrets, artifacts.`);
    }
    if (name === "open") return open(snap, where, io, String(p.what ?? ""), id, typeof p.tab === "string" ? p.tab : "", query);
    if (name === "send") {
      const text = typeof p.text === "string" ? p.text.trim() : "";
      if (!text || text.length > 16000) return fail("Nothing to send.");
      const c = findChat(snap, typeof p.to === "string" ? p.to.slice(0, 200) : "", where);
      if ("error" in c) return fail(c.error);
      await io.send(c.key, text);
      return done(`Sent to ${c.name}.`);
    }
    if (name === "act") return await act(snap, where, io, p, id);
    return fail("No such tool.");
  } catch (e: any) {
    return fail(cut(String(e?.message ?? e), 400) || "That didn't work.");
  }
}

/** An open: what to show and, until the app confirms, words that claim nothing (shown() says the rest). */
const showing = (shows: string, nav: Nav): Answer => ({ result: `Asked the app to show ${shows}, but it hasn't confirmed: don't say it's on screen.`, nav, shows });

function open(snap: Snapshot, where: Where, io: VoiceIO, what: string, id: string, tab: string, query: string): Answer {
  switch (what) {
    case "space": {
      const hits = spacesSaid(snap, id, where);
      if (!hits.length) return fail(`I can't find a space called "${cut(id, 60)}". Spaces: ${snap.places.slice(0, 12).map((p) => spaceSaid(snap, p)).join("; ")}.`);
      if (hits.length > 1) return fail(`Which one: ${hits.slice(0, 6).map((p) => spaceSaid(snap, p)).join("; ")}? Ask the person.`);
      const p = hits[0];
      return showing(`the ${spaceSaid(snap, p)} space`, { kind: "space", place: p.id });
    }
    case "task": {
      const t = findTask(snap, id, where);
      if (!t) return fail(isHere(id) ? "Which task?" : `I can't find task "${cut(id, 60)}".`);
      const want = ["chat", "terminal", "files", "changes", "pr", "browser", "review"].includes(tab) ? tab : "chat";
      if (want === "review" && t.status !== "ready") return fail(`${spoken(t.id)} isn't ready for review: it is ${STATUS[t.status] ?? t.status}.`);
      if (want === "pr" && !t.pr) return fail(`${spoken(t.id)} has no pull request yet.`);
      const at = io.taskWhere?.(t.id);
      const chat = t.agent?.chat;
      return showing(`${spoken(t.id)}${want === "chat" ? "" : want === "review" ? "'s review" : `'s ${want === "pr" ? "pull request" : want}`}`,
        { kind: "task", task: t.id, tab: want, ...(chat ? { chat, addr: io.addrOf?.(chat) ?? null } : {}), ...(at ? { ref: at.ref, folder: at.folder, machine: at.machine } : {}), title: t.name });
    }
    case "tasks": return showing(`the Tasks panel${query ? `, ${query}` : ""}`, { kind: "tasks", ...(query ? { filter: stateOf(query) ?? undefined } : {}) });
    case "needs": return showing("what needs the person", { kind: "needs" });
    case "artifact": {
      const a = findArtifact(snap, id, where);
      if (!a) return fail(`I can't find an artifact like "${cut(id, 60)}". Look at artifacts for their titles.`);
      return showing(`the artifact "${cut(a.title, 80)}"`, { kind: "artifact", artifact: a.id, title: a.title, v: a.v, machine: (a as any).machine ?? null });
    }
    case "settings": return showing(`Settings${id ? `, ${id}` : ""}`, { kind: "settings", ...(id ? { section: id } : {}) });
    case "chat": {
      const c = id ? findChat(snap, id, where) : { key: where.call, name: chatName(snap, where.call) };
      if ("error" in c) return fail(c.error);
      return showing(`${c.name}'s chat`, { kind: "chat", chat: c.key, addr: io.addrOf?.(c.key) ?? null });
    }
  }
  return fail("open can show: space, task, tasks, needs, artifact, settings, chat.");
}

/** An open's answer once the app that started the call tried it: on screen only when it said so. show() asks that very
 *  app (the page's call socket, or the window's chat) and resolves with its ack, or null when it didn't answer. */
export async function shown(a: Answer, show: (nav: Nav) => Promise<Ack | null>): Promise<Answer> {
  if (!a.nav) return a;
  const ack = await show(a.nav).catch((e) => ({ ok: false, why: String(e?.message ?? e) }) as Ack);
  return { ...a, ...(navWords(a.shows ?? "it", ack) as { result: string; error?: boolean }) };
}

/** What an act will do, in words to ask the person ("Accept SHEP 45, “Voice calls”? That merges it."). */
async function act(snap: Snapshot, where: Where, io: VoiceIO, p: any, id: string): Promise<Answer> {
  const action = String(p.action ?? "");
  const value = typeof p.value === "string" ? p.value.trim().slice(0, 300) : "";
  const key = typeof p.key === "string" ? p.key.trim().slice(0, 200) : "";
  const confirmed = p.confirmed === true;
  const TASK = ["accept", "start", "schedule", "unschedule", "stop", "resume", "done", "reopen", "delete", "pin", "unpin"];
  const SPACE = ["autopilot_on", "autopilot_off", "autopilot_run", "rename_space", "remove_space"];
  let ask = "", body: Record<string, unknown> | null = null, said = "";
  if (TASK.includes(action)) {
    const t = findTask(snap, id, where);
    if (!t) return fail(isHere(id) ? "Which task?" : `I can't find task "${cut(id, 60)}".`);
    const n = `${spoken(t.id)}, "${cut(t.name, 70)}"`, chat = `${t.id}/worker`;
    switch (action) {
      case "accept":
        if (t.status !== "ready") return fail(`${spoken(t.id)} isn't ready to accept: it is ${STATUS[t.status] ?? t.status}.`);
        ask = `Accept ${n}? That merges it.`; body = { type: "accept", task: t.id }; said = `Accepted ${spoken(t.id)}: it merges now.`; break;
      case "start": ask = `Start ${n} now?`; body = { type: "schedule", chat, now: true }; said = `${spoken(t.id)} starts now.`; break;
      case "schedule":
        if (!value) return fail("When? Say a time, like in 2 hours or tomorrow at 9.");
        ask = `Start ${n} ${value}?`; body = /^in\s+/i.test(value) ? { type: "schedule", chat, in: value.replace(/^in\s+/i, "") } : { type: "schedule", chat, at: value }; said = `${spoken(t.id)} is scheduled.`; break;
      case "unschedule": ask = `Take ${n} off its schedule, back to to do?`; body = { type: "schedule", chat, off: true }; said = `${spoken(t.id)} is back to to do.`; break;
      case "stop":
        if (!t.agent?.chat) return fail(`${spoken(t.id)} has no agent running.`);
        ask = `Stop ${n}'s agent? Its work stays.`; body = { type: "stop", chat: t.agent.chat }; said = `Stopped ${spoken(t.id)}'s agent.`; break;
      case "resume": ask = `Start ${n}'s agent again where it left off?`; body = { type: "task-resume", chat }; said = `${spoken(t.id)}'s agent is starting again.`; break;
      case "done": ask = `Mark ${n} done without merging anything?`; body = { type: "close", chat }; said = `${spoken(t.id)} is done.`; break;
      case "reopen": ask = `Reopen ${n}?`; body = { type: "reopen", chat }; said = `${spoken(t.id)} is open again.`; break;
      case "delete": ask = `Delete ${n}: its agent, branch and chat? This can't be undone.`; body = { type: "delete", chat }; said = `Deleted ${spoken(t.id)}.`; break;
      case "pin": case "unpin": ask = `${action === "pin" ? "Pin" : "Unpin"} ${n}?`; body = { type: "pin", chat, on: action === "pin" }; said = `${action === "pin" ? "Pinned" : "Unpinned"} ${spoken(t.id)}.`; break;
    }
  } else if (SPACE.includes(action)) {
    const sp = findSpace(snap, id, where);
    if (!sp) return fail(isHere(id) ? "Which space?" : `I can't find a space called "${cut(id, 60)}".`);
    switch (action) {
      case "autopilot_on": ask = `Turn Autopilot on in ${sp.name}? Its Assistant then works on its own.`; body = { type: "mode", place: sp.id, mode: "autopilot" }; said = `Autopilot is on in ${sp.name}.`; break;
      case "autopilot_off": ask = `Turn Autopilot off in ${sp.name}?`; body = { type: "mode", place: sp.id, mode: "regular" }; said = `Autopilot is off in ${sp.name}.`; break;
      case "autopilot_run": ask = `Wake ${sp.name}'s Autopilot now?`; body = { type: "autopilot-run", place: sp.id }; said = `${sp.name}'s Autopilot wakes now.`; break;
      case "rename_space":
        if (!value) return fail("What should it be called?");
        ask = `Rename ${sp.name} to ${value}?`; body = { type: "rename", id: sp.id, name: value }; said = `Renamed it ${value}.`; break;
      case "remove_space": ask = `Remove ${sp.name} from Shepherdr? Its folder and code stay on disk.`; body = { type: "space-remove", place: sp.id }; said = `Removed ${sp.name}.`; break;
    }
  } else if (action === "setting") {
    const sp = id ? findSpace(snap, id, where) : null;
    if (id && !sp) return fail(`I can't find a space called "${cut(id, 60)}".`);
    const ws = words(key);
    const rows = settingRows(snap, sp?.id ?? "all").filter((x) => ws.length && ws.every((w) => `${x.section} ${x.row.label} ${x.row.key}`.toLowerCase().includes(w)));
    const exact = rows.find((x) => norm(x.row.label) === norm(key));
    const r = exact ?? (rows.length === 1 ? rows[0] : null);
    if (!r) return fail(rows.length ? `Which one: ${rows.slice(0, 6).map((x) => `${x.section} › ${x.row.label}`).join("; ")}?` : `I can't find a setting called "${cut(key, 60)}". Look at settings first.`);
    let v: string | null = value;
    if (r.row.options?.length) {
      v = r.row.options.find((o) => norm(o) === norm(value)) ?? r.row.options.find((o) => norm(o).startsWith(norm(value)) && norm(value)) ?? null;
      if (!v) return fail(`${r.row.label} can be: ${r.row.options.join(", ")}.`);
    } else if (/^(default|reset|clear|none)$/i.test(value)) v = null;
    if (v === null && !r.row.text && !r.row.options?.length) return fail("What value?");
    ask = `Set ${r.section} › ${r.row.label} to ${v ?? "its default"}${sp ? ` for ${sp.name}` : " everywhere"}?`;
    body = { type: "setting", key: r.row.key, value: v, place: r.level }; said = `${r.row.label} is now ${v ?? "its default"}.`;
  } else if (action === "forget_secret") {
    const all = vaultOf(snap).filter((e) => norm(e.name) === norm(key));
    if (!all.length) return fail(`No secret called "${cut(key, 60)}" is kept.`);
    const sp = id ? findSpace(snap, id, where) : null;
    const e = (sp ? all.find((x) => x.space === sp.id) : null) ?? (all.length === 1 ? all[0] : null);
    if (!e) return fail(`${all[0].name} is kept in ${all.length} places: ${all.map((x) => x.where ?? x.scope).join("; ")}. Which one?`);
    const level = e.scope === "everywhere" ? "all" : e.scope === "machine" ? `m:${e.machine ?? ""}` : String(e.space);
    ask = `Delete the secret ${e.name} (${e.where ?? e.scope})? Agents that use it lose it.`; body = { type: "secret", level, name: e.name, value: null }; said = `Deleted the secret ${e.name}.`;
  } else if (action === "delete_artifact") {
    const ws = words(id);
    const a = isHere(id) && where.artifact ? snap.artifacts.find((x) => x.id === where.artifact) : snap.artifacts.find((x) => x.id === id) ?? (ws.length ? snap.artifacts.find((x) => ws.every((w) => x.title.toLowerCase().includes(w))) : null);
    if (!a) return fail(`I can't find an artifact like "${cut(id, 60)}".`);
    ask = `Delete the artifact "${cut(a.title, 80)}" and its versions?`; body = { type: "artifact-delete", place: a.place, artifact: a.id }; said = `Deleted "${cut(a.title, 80)}".`;
  } else return fail(`act can do: ${["accept", "start", "schedule", "unschedule", "stop", "resume", "done", "reopen", "delete", "pin", "unpin", "autopilot_on", "autopilot_off", "autopilot_run", "rename_space", "remove_space", "setting", "forget_secret", "delete_artifact"].join(", ")}. Anything else goes to the space's Assistant with send.`);
  if (!confirmed) return done(`Nothing changed yet. Ask the person: "${ask}" Only after a clear yes, call act again with confirmed true.`);
  const r = await io.action(body!);
  if (r && typeof r === "object" && r.ok === false) return fail(cut(String(r.error ?? "It didn't go through."), 300));
  return done(r?.why ? `${said} ${cut(String(r.why), 200)}` : said);
}
