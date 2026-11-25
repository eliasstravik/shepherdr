// The glance feed (SHEP-246, for ELIA-54's Shepherdr Wake): what a phone's widgets, lock screen and watch show, small
// enough to keep a live link to all day. The page socket sends the whole snapshot (~720 KB) on every change; this doc is
// ~15 KB and changes only when what the person sees changes. Built from the same snapshot with the same alert words
// (push.ts alertsOf), so a native notification says exactly what a web push says. The format: docs/glance.md.
//
// glanceOf started as ELIA-54's reference (glance-feed/glance.ts in shepherdr-wake), kept as it is but for a stable `at`
// (an item with no time of its own never takes "now": that changed `v` on every snapshot), and to list what the app
// lists: every need (one its space's Notify keeps quiet too, without alerting), an agent's alert only while it stands.
import { needAlert } from "./push.ts";
import { needReason } from "../core/toasts.js";
import { REASONS } from "../core/needs.js";
import { suggestsOfMessage, suggestionsOn } from "../web/shared/suggest.ts";
import { GROUPS } from "../web/shared/types.ts";
import { ALERT_FRESH_MS, MEMORY_BACK_UNDER, alertStands, needsYou, unreadChats, waitingTasks } from "../web/shared/needs-you.ts";
import { notifyOf } from "../web/shared/alerts.ts";

/** the doc's format: a change the Android app can't read as before bumps it (new fields alone don't) */
export const GLANCE_FORMAT = 1;

export type Choice = { i: number; label: string };
export type Item = {
  /** one thing, stable while it lasts: a new key is a new alert */
  key: string;
  /** the list's section: needs (an agent waits on you), working, ready (to accept), done (today) */
  kind: "needs" | "working" | "ready" | "done";
  /** what it is: need (a question, a permission, a stalled agent), alert (herdr-task alert), task (a task's row). An
   *  Assistant's new message is no item (SHEP-253): Glance.unread counts those for a Chat badge */
  type: "need" | "alert" | "task";
  /** a notification's tag: one per task or chat, a newer alert takes the old one's place */
  tag: string;
  task?: string;
  /** a watch's line: <= 30 */
  title: string;
  /** two watch lines: <= 80 */
  body: string;
  /** the task's name, its space and machine, its status line and progress (a row in the list) */
  name?: string;
  space?: string;
  machine?: string | null;
  line?: string;
  progress?: number | null;
  left?: string | null;
  at?: number;
  /** notify about it (a needs or ready item); a working/done row only shows in the list */
  alert?: boolean;
  /** where a tap opens, relative to Shepherdr's address (./?place=…&task=…) */
  url: string;
  accept?: { task: string };
  /** other: the card takes free words too (Reply sends them as its "Other" answer) */
  answer?: { chat: string; question: string; choices: Choice[]; other?: boolean };
  reply?: { chat: string; to?: string };
  /** what it asks or says in full, plain text (<= TEXT_MAX, cut at a word): only on needs and ready items; body is its
   *  first 80 characters */
  text?: string;
  /** the chat's suggested replies, in order, at most 5 (the web app's bubbles): only on an item that takes words (reply
   *  or answer.other), and only when it has some */
  suggest?: string[];
  /** a Ready item's last review round (SHEP-447): passed, changes asked, or none (no round recorded) */
  review?: "passed" | "changes" | "none";
  /** a Ready item's pull request checks: green, red, running, or none (no pull request or no checks) */
  checks?: "green" | "red" | "running" | "none";
  /** a Ready item's proof pages */
  proofs?: number;
};
/** a space a watch can send a new task to (SHEP-447): its Assistant's chat takes a `send`; last used first */
export type Space = { id: string; name: string; machine: string | null; chat: string; used?: number; home?: true };
/** an Assistant's chat with a message not yet read (SHEP-447): its newest words' first lines (<= CHAT_TEXT) */
export type ChatNews = { chat: string; place: string; space: string; machine: string | null; text?: string };
/** something worth a buzz that is no task (SHEP-447): a schedule's run that failed, a machine out of reach or out of
 *  memory. key: stable while it lasts, a new one is a new alert; alert: notify about it (false: its space's Notify is Off) */
export type Event = { key: string; kind: "schedule" | "machine"; title: string; body: string; at?: number; place?: string; machine?: string | null; alert: boolean; url?: string };
/** the plan with the least left (SHEP-447): its name, its fullest window, the share used and left (0-100) */
export type Usage = { plan: string; window: string; used: number; left: number; resets?: string };
export type Kind = Item["kind"];
export type Counts = Record<Kind, number>;
/** a section of the list, in the web app's Tasks panel order (Needs you, Ready, Working, Done): its kind, its name there,
 *  and how many items it holds (all of them, even past the 40 items) */
export type Group = { kind: Kind; label: string; count: number };
/** v: changes with anything; urgent: changes only with what notifies (a new or gone alert, its words, the counts): a
 *  stream sends an urgent change at once and the rest (status lines, progress) at most once a minute */
/** unread: how many Assistants' chats have a new message not yet read (their space not muted): Chat's badge, never in
 *  Needs you (SHEP-253) */
/** spaces, chats, events, usage: SHEP-447's optional additions (an older app ignores them) */
export type Glance = { format: number; v: string; urgent: string; at: number; counts: Counts; order: Kind[]; groups: Group[]; items: Item[]; unread: number;
  spaces: Space[]; chats: ChatNews[]; events: Event[]; usage?: Usage | null };

/** the Tasks panel's statuses each kind lists (merging is Working here) */
const KIND_OF: Partial<Record<string, Kind>> = { need: "needs", ready: "ready", merging: "working", work: "working", done: "done" };
/** the status whose name a kind takes */
const NAMED: Record<Kind, string> = { needs: "need", ready: "ready", working: "work", done: "done" };
/** the kinds in the Tasks panel's order, with its names (web/shared/types.ts GROUPS, as the web app's groups.ts) */
export const KINDS: { kind: Kind; label: string }[] = GROUPS.flatMap(([s]) => KIND_OF[s] ?? [])
  .filter((k, i, all) => all.indexOf(k) === i)
  .map((kind) => ({ kind, label: GROUPS.find(([s]) => s === NAMED[kind])![1] }));

export const WATCH_TITLE = 30, WATCH_BODY = 80, LABEL = 24, MAX_ITEMS = 40, TEXT_MAX = 2000;
/** SHEP-447: the most spaces listed, unread chats listed, and characters of a chat's newest words */
export const MAX_SPACES = 30, MAX_CHATS = 10, CHAT_TEXT = 280;
// the rule of what stands (an agent's alert while it lasts) is Needs you's own, shared with the web app
export { ALERT_FRESH_MS, MEMORY_BACK_UNDER, alertStands };
const clip = (s: string, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…"; };
/** an item's full text: plain words (Markdown's marks, links' targets and code fences' backticks off), its paragraphs
 *  kept, cut at a word to n with "…" */
export function fullText(s: unknown, n = TEXT_MAX): string {
  const t = String(s ?? "")
    .replace(/```[^\n]*\n?/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(#{1,6}|>)\s+/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const at = cut.search(/\s\S*$/);
  return (at > n / 2 ? cut.slice(0, at) : cut.slice(0, n - 1)).replace(/[\s,;:.-]+$/, "") + "…";
}
/** what a need asks, in full: its card's question (a permission's command under it, a plan's words), a secret's ask,
 *  or what the agent last said while it waits */
const needText = (n: any) => {
  const q = n?.question;
  if (!q) return needReason(n);
  if (q.kind === "Plan") return [REASONS.plan, q.plan].filter(Boolean).join("\n\n");
  // #1441: a folder-trust card says what waits and what trusting allows
  if (q.trust) return [q.trust.waits, q.trust.allows].filter(Boolean).join("\n\n");
  const parts = q.parts?.length > 1 ? q.parts.map((p: any) => p.title) : [];
  return [q.title, q.command, ...parts].filter(Boolean).join("\n\n") || needReason(n);
};
const urlOf = (place: string, task?: string, focus?: string) => { const q = new URLSearchParams({ place }); if (task) q.set("task", task); if (focus) q.set("focus", focus); return `./?${q}`; };

/** a card's choices a button may send by itself (Shepherdr's quickChoices and choiceButtons rules: never a plan, a form, a
 *  merge, a pick of several, a terminal menu, a choice that needs a note or a grant for good); three at most (Android) */
export function buttonChoices(q: any): Choice[] {
  if (!q?.choices?.length || q.kind === "Plan" || (q.parts && q.parts.length > 1) || /^merge\b/i.test(q.title ?? "") || q.evidence || q.multi || String(q.id ?? "").startsWith("menu:")) return [];
  return q.choices
    .map((c: any, i: number) => ({ i, label: clip(c.short ?? c.label, LABEL) }))
    .filter((c: Choice) => c.i !== q.noteRequiredFor && c.i !== q.always)
    .slice(0, 3);
}

/** start of today (local time on the serving machine) */
const today = (now: number) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };

/**
 * snap: Shepherdr's snapshot. alerts: alertsOf(snap, …) from service/push.ts (its wording, tags, urls and reply targets).
 * last: a chat's newest message with words, as the web app's chat has it (its text and the agent's suggested replies;
 * who: "you" when the person's), for an item's suggested replies.
 */
/** a chat log item (core/chat-log.js) that counts for the suggested replies: the agent's words or the person's, never a
 *  message between agents (another agent's in: a user item with from; one it sent: kind "sent"), so the agent's
 *  bubbles outlive its no-reply answer to another Assistant's message, news or a background notice */
export const saidToPerson = (x: any) => !!x?.text && (x.kind === "agent" || (x.kind === "user" && !x.from));
export type LastSaid = (chat: string) => { who: "agent" | "you"; text?: string; suggests?: string[] } | null | undefined;
export function glanceOf(snap: any, alerts: Map<string, any>, now = Date.now(), last: LastSaid = () => null): Glance {
  // the chat's bubbles, as web/plugins/chat/suggest.ts suggestionOf shows them: the agent's newest words', none after
  // the person wrote, none when Settings turned them off
  const sugOn = suggestionsOn(snap.settings);
  const suggestOf = (chat?: string) => {
    if (!sugOn || !chat) return [];
    const m = last(chat);
    return m && m.who !== "you" ? suggestsOfMessage(m).slice(0, 5) : [];
  };
  const places = new Map<string, any>((snap.places ?? []).map((p: any) => [p.id, p]));
  const spaceOf = (id?: string) => (id ? places.get(id) : null);
  const items: Item[] = [];
  const textOf = (s: unknown) => { const text = fullText(s); return text ? { text } : {}; };
  const taskRow = (t: any) => {
    const sp = spaceOf(t.place);
    return { name: clip(t.name, 60), space: sp?.name ?? t.listName ?? "", machine: sp?.machine ?? null, line: clip(t.sub ?? t.report?.msg ?? t.summary ?? "", 80),
      progress: typeof t.report?.progress === "number" ? Math.max(0, Math.min(100, Math.round(t.report.progress))) : null, left: t.left ?? null };
  };
  const tasks = new Map<string, any>((snap.tasks ?? []).map((t: any) => [t.id, t]));
  const taskItem = (t: any, kind: Kind, at?: number): Item => ({ key: `task:${t.id}`, kind, type: "task", tag: t.id, task: t.id,
    title: clip(`${t.name} · ${kind === "working" ? "Working" : kind === "done" ? "Done" : "Needs you"}`, WATCH_TITLE), body: clip(t.name, WATCH_BODY), ...taskRow(t), ...(at ? { at } : {}), alert: false, url: urlOf(t.place, t.id) });
  // Needs you: what the web app's Tasks panel lists there, in its order (web/shared/needs-you.ts, SHEP-250): tasks only
  // (SHEP-255). Each says what its push alert says; one that isn't pushed (its space's Notify keeps it quiet) lists
  // without alerting
  const waits = needsYou(snap, now);
  for (const w of waits) {
    const t = tasks.get(w.task);
    if (w.type === "task") { items.push({ ...taskItem(t, "needs", w.at || undefined), ...textOf(t.sub ?? t.report?.msg ?? t.summary) }); continue; }
    const pushed = alerts.get(w.key);
    const a: any = pushed ?? (w.need ? needAlert(snap, w.need) : { title: w.alert!.title, body: w.alert!.body, tag: w.key, ...(w.place ? { place: w.place, url: urlOf(w.place) } : {}) });
    const it: Item = { key: w.key, kind: "needs", type: w.type, tag: a.tag, title: clip(a.title, WATCH_TITLE), body: clip(a.body, WATCH_BODY),
      task: t.id, ...taskRow(t), ...(w.at ? { at: w.at } : {}), alert: !!pushed,
      url: a.url ?? (a.place ?? w.place ? urlOf(a.place ?? w.place) : "./"), ...textOf(w.need ? needText(w.need) : w.alert?.body ?? a.body) };
    if (a.accept) it.accept = a.accept;
    if (a.reply) it.reply = a.reply;
    // an agent's own alert from a chat: Reply writes to that agent
    else if (w.alert?.chat) it.reply = { chat: w.alert.chat };
    const n = w.need;
    if (n?.question) {
      const choices = buttonChoices(n.question);
      if (choices.length) it.answer = { chat: n.chat, question: n.question.id, choices, ...(n.question.other && n.question.kind !== "Plan" ? { other: true } : {}) };
    }
    const words = it.reply?.chat ?? (it.answer?.other ? it.answer.chat : undefined);
    const sg = suggestOf(words);
    if (sg.length) it.suggest = sg;
    items.push(it);
  }
  // a task in Needs you is in no other section
  const waiting = waitingTasks(waits);
  const proofIds = new Set<string>((snap.artifacts ?? []).filter((a: any) => a?.proof).map((a: any) => a.id));
  for (const [key, a] of alerts) {
    if (!key.startsWith("ready:")) continue;
    const t = tasks.get(key.slice(6));
    if (!t || waiting.has(t.id)) continue;
    items.push({ key, kind: "ready", type: "task", tag: a.tag, title: clip(a.title, WATCH_TITLE), body: clip(a.body, WATCH_BODY), task: t.id, ...taskRow(t), ...(t.at ? { at: t.at } : {}), alert: true,
      url: a.url ?? urlOf(t.place, t.id), ...(a.accept ? { accept: a.accept } : {}), ...textOf(t.summary ?? a.body), ...trustOf(t, proofIds) });
  }
  const start = today(now);
  for (const t of snap.tasks ?? []) {
    if (t.archived || waiting.has(t.id)) continue;
    const kind = t.status === "work" || t.status === "merging" ? "working" : t.status === "done" && (t.doneAt ?? 0) >= start ? "done" : null;
    if (kind) items.push(taskItem(t, kind, kind === "done" ? t.doneAt : t.at));
  }
  const rank = Object.fromEntries(KINDS.map((k, i) => [k.kind, i])) as Record<Kind, number>;
  items.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.kind === "done" ? (b.at ?? 0) - (a.at ?? 0) : (a.at ?? 0) - (b.at ?? 0)));
  // each count is what its section lists (SHEP-248: Needs you said 1 over an Assistant's message and a task's card)
  const counts: Counts = { needs: 0, working: 0, ready: 0, done: 0 };
  for (const i of items) counts[i.kind]++;
  const groups: Group[] = KINDS.map((k) => ({ ...k, count: counts[k.kind] }));
  const order = KINDS.map((k) => k.kind);
  const kept = items.slice(0, MAX_ITEMS);
  const unreadNow = unreadChats(snap);
  const unread = unreadNow.length;
  const spaces = spacesOf(snap);
  const chats: ChatNews[] = unreadNow.slice(0, MAX_CHATS).map((u) => {
    const p = places.get(u.place), m = last(u.chat);
    const text = m && m.who !== "you" ? fullText(m.text, CHAT_TEXT) : "";
    return { chat: u.chat, place: u.place, space: p?.name ?? "", machine: p?.machine ?? null, ...(text ? { text } : {}) };
  });
  const events = eventsOf(snap, now);
  const usage = usageOf(snap);
  const v = Bun.hash(JSON.stringify([GLANCE_FORMAT, counts, kept, unread, spaces, chats, events, usage])).toString(36);
  return { format: GLANCE_FORMAT, v, urgent: urgentOf(counts, kept, events), at: now, counts, order, groups, items: kept, unread, spaces, chats, events, usage };
}

/** a Ready task's review, checks and proof (SHEP-447): what a watch needs to offer Mark as done only when nothing is red */
function trustOf(t: any, proofIds: Set<string>): Pick<Item, "review" | "checks" | "proofs"> {
  const ids = new Set<string>((t.artifacts ?? []).filter((id: string) => proofIds.has(id)));
  if (t.proof) ids.add(t.proof);
  const checks = t.pr?.checks === "passed" ? "green" : t.pr?.checks === "failed" ? "red" : t.pr?.checks === "running" ? "running" : "none";
  return { review: t.review === "passed" || t.review === "changes" ? t.review : "none", checks, proofs: ids.size };
}

/** the spaces a new task can go to, last used first: not archived, each with its Assistant's chat. Used: its Assistant's
 *  last change or its newest task's, to the minute (a working Assistant moves it on every step) */
export function spacesOf(snap: any): Space[] {
  const newest = new Map<string, number>();
  for (const t of snap.tasks ?? []) if (t.place && typeof t.at === "number") newest.set(t.place, Math.max(newest.get(t.place) ?? 0, t.at));
  const out: Space[] = [];
  for (const p of snap.places ?? []) {
    if (p.archived || !p.chat || !p.id) continue;
    const used = Math.floor(Math.max(Number(p.changedAt) || 0, newest.get(p.id) ?? 0) / 60_000) * 60_000;
    out.push({ id: p.id, name: p.name ?? "", machine: p.machine ?? null, chat: p.chat, ...(used ? { used } : {}), ...(p.home ? { home: true as const } : {}) });
  }
  // a stable sort: equal times keep the sidebar's order
  return out.sort((a, b) => (b.used ?? 0) - (a.used ?? 0)).slice(0, MAX_SPACES);
}

/** what is worth a buzz and is no task: a schedule whose run failed (its row in Schedules says so), a machine out of reach
 *  or short of memory (the warnings line's words, and the memory guard's own alert while it stands) */
export function eventsOf(snap: any, now: number): Event[] {
  const out: Event[] = [];
  const quiet = (place?: string) => !!place && !!snap.settings && notifyOf({ settings: snap.settings }, place) === "Off";
  const seen = new Set<string>();
  for (const [place, list] of Object.entries((snap.automations ?? {}) as Record<string, any[]>)) for (const a of list ?? []) {
    if (!a?.failed || !a.error) continue;
    const key = `schedule:${a.machine ?? ""}:${a.id ?? a.name}:${a.failed}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const at = a.runs?.find((r: any) => r?.error)?.at;
    const where = a.place ?? place;
    out.push({ key, kind: "schedule", title: clip(`Schedule failed · ${a.name}`, WATCH_TITLE), body: clip(a.error, WATCH_BODY), ...(typeof at === "number" ? { at } : {}),
      place: where, machine: a.machine ?? null, alert: !quiet(where), url: urlOf(where) });
  }
  // the memory guard's alert (herdr-task tick: agents stopped to free memory) while it stands, before the warnings line's
  const machines: any[] = snap.machines ?? [];
  const memory = new Set<string>();
  for (const a of snap.alerts ?? []) {
    if (!a.memory || a.task || !alertStands(a, snap, now)) continue;
    const m = machines.find((x) => (a.machine ? x.machine === a.machine && !x.here : x.here));
    if (m) memory.add(m.machine);
    out.push({ key: `alert:${a.id}`, kind: "machine", title: clip(a.title, WATCH_TITLE), body: clip(a.body, WATCH_BODY), at: Number(a.at) || undefined, machine: m?.machine ?? a.machine ?? null, alert: true });
  }
  for (const w of snap.warnings ?? []) {
    const m = /^m:(.+):(down|memory)$/.exec(String(w.id ?? ""));
    if (w.kind !== "machine" || !m || (m[2] === "memory" && memory.has(m[1]))) continue;
    const name = machines.find((x) => x.machine === m[1])?.name ?? m[1];
    out.push({ key: `machine:${m[1]}:${m[2]}`, kind: "machine", title: clip(m[2] === "down" ? `Can't reach ${name}` : `${name}: memory nearly full`, WATCH_TITLE), body: clip(w.text, WATCH_BODY), machine: m[1], alert: true });
  }
  return out;
}

/** the plan with the least left, as Settings › Plans shows them (this machine's CLIs), or null when none is read */
export function usageOf(snap: any): Usage | null {
  let best: Usage | null = null;
  for (const p of snap.config?.plans ?? []) for (const w of p.windows ?? []) {
    const used = Math.max(0, Math.min(100, Math.round(Number(w.used) || 0)));
    if (!best || used > best.used) best = { plan: String(p.name ?? ""), window: String(w.name ?? ""), used, left: 100 - used, ...(w.resets ? { resets: String(w.resets) } : {}) };
  }
  return best;
}

/** what notifies in a doc: its alerts and events, their words and the counts */
const urgentOf = (counts: Counts, items: Item[], events: Event[] = []) =>
  Bun.hash(JSON.stringify([GLANCE_FORMAT, counts, items.filter((i) => i.alert).map((i) => [i.key, i.title, i.body]),
    ...(events.some((e) => e.alert) ? [events.filter((e) => e.alert).map((e) => [e.key, e.title, e.body])] : [])])).toString(36);

/** how long a device's web push stays quiet after its native stream dropped (a phone reconnecting) */
export const NATIVE_GRACE_MS = 120_000;
/** a comment line this often keeps proxies and the phone's network from closing a quiet stream */
export const PING_MS = 240_000;
/** a change that notifies nothing (a status line, progress) goes to the streams at most this often: each send wakes the
 *  phone's radio, and with 7 agents working the doc changes several times a second */
export const CALM_MS = 60_000;

type Stream = { send: (text: string) => void; device: string | null; native: boolean };
const enc = new TextEncoder();
const frame = (g: Glance) => `event: glance\ndata: ${JSON.stringify(g)}\n\n`;

/**
 * The feed: the doc now, the streams that follow it, and the devices that have the phone app's own notifications (a
 * native stream open now, or closed less than 2 minutes ago): web push leaves those alone (push.ts send).
 */
export class GlanceFeed {
  /** the doc now (GET /api/glance, and a new stream's first frame) */
  doc: Glance | null = null;
  /** the doc the streams last heard */
  private sent: Glance | null = null;
  private sentAt = 0;
  private later: ReturnType<typeof setTimeout> | null = null;
  private streams = new Set<Stream>();
  /** device -> its native streams open now, and when the last one closed */
  private native = new Map<string, { open: number; closed: number }>();
  /** is device D's Shepherdr page on screen now (live.ts looking) */
  looking: (device: string) => boolean = () => false;
  /** device -> the alerts that came while its page was on screen (SHEP-338): its phone app hears them with alert false,
   *  so it lists them but never notifies, then or after; they go when the alert does */
  private seen = new Map<string, Set<string>>();
  /** the alert keys of the doc before */
  private keys: Set<string> | null = null;

  constructor(private clock: () => number = Date.now, ping = PING_MS) {
    if (ping > 0) (setInterval(() => this.ping(), ping) as any).unref?.();
  }

  /** a new doc: the streams hear it once if its `v` changed; at once if its `urgent` did, else at most once a minute
   *  (the latest then). True: sent now. */
  set(doc: Glance) {
    this.mark(doc);
    this.doc = doc;
    if (doc.v === this.sent?.v) { this.hold(); return false; }
    const wait = this.sent && doc.urgent === this.sent.urgent ? this.sentAt + CALM_MS - this.clock() : 0;
    if (wait > 0) { this.later ??= setTimeout(() => { this.later = null; if (this.doc && this.doc.v !== this.sent?.v) this.send(this.doc); }, wait); return false; }
    this.send(doc);
    return true;
  }

  /** a new alert (a key the doc before didn't have) is seen on each phone-app device whose page is on screen now; the
   *  first doc after a start marks nothing (what it lists was there before) */
  private mark(doc: Glance) {
    const now = new Set([...doc.items, ...(doc.events ?? [])].filter((i) => i.alert).map((i) => i.key));
    const fresh = this.keys ? [...now].filter((k) => !this.keys!.has(k)) : [];
    this.keys = now;
    if (fresh.length) for (const d of this.native.keys()) {
      if (!this.looking(d)) continue;
      const s = this.seen.get(d) ?? new Set<string>();
      for (const k of fresh) s.add(k);
      this.seen.set(d, s);
    }
    for (const [d, s] of this.seen) {
      for (const k of s) if (!now.has(k)) s.delete(k);
      if (!s.size) this.seen.delete(d);
    }
  }

  /** the doc as device D's phone app hears it: what came while its page was on screen notifies nothing there */
  docFor(device: string | null | undefined, doc = this.doc): Glance | null {
    const seen = device ? this.seen.get(device) : undefined;
    const quiet = <T extends { key: string; alert?: boolean }>(i: T) => !!i.alert && seen!.has(i.key);
    if (!doc || !seen?.size || ![...doc.items, ...(doc.events ?? [])].some(quiet)) return doc;
    const items = doc.items.map((i) => (quiet(i) ? { ...i, alert: false } : i));
    const events = (doc.events ?? []).map((e) => (quiet(e) ? { ...e, alert: false } : e));
    return { ...doc, items, events, urgent: urgentOf(doc.counts, items, events) };
  }

  /** nothing waits to go: back where the streams already are */
  private hold() { if (this.later) { clearTimeout(this.later); this.later = null; } }

  private send(doc: Glance) {
    this.hold();
    this.sent = doc;
    this.sentAt = this.clock();
    const text = frame(doc);
    const own = new Map<string, string>();
    for (const s of this.streams) {
      if (!s.native || !s.device) { s.send(text); continue; }
      if (!own.has(s.device)) { const d = this.docFor(s.device, doc)!; own.set(s.device, d === doc ? text : frame(d)); }
      s.send(own.get(s.device)!);
    }
  }

  ping() { for (const s of this.streams) s.send(": ping\n\n"); }

  /** does device D's web push wait: its native stream is open, or dropped less than 2 minutes ago */
  quiet(device: string | null | undefined) {
    if (!device) return false;
    const n = this.native.get(device);
    return !!n && (n.open > 0 || this.clock() - n.closed < NATIVE_GRACE_MS);
  }

  /** streams open now, for /api/health-like checks and tests */
  get size() { return this.streams.size; }

  /** a stream (text/event-stream) for one connection: retry, the doc now, then each change and a ping */
  stream(device: string | null, native: boolean, signal?: AbortSignal): Response {
    let s: Stream | null = null;
    const end = () => {
      if (!s || !this.streams.delete(s)) return;
      if (s.native && s.device) { const n = this.native.get(s.device); if (n) { n.open = Math.max(0, n.open - 1); n.closed = this.clock(); } }
    };
    const body = new ReadableStream<Uint8Array>({
      start: (c) => {
        s = { device, native: native && !!device, send: (text) => { try { c.enqueue(enc.encode(text)); } catch { end(); } } };
        this.streams.add(s);
        if (s.native) { const n = this.native.get(device!) ?? { open: 0, closed: 0 }; n.open++; this.native.set(device!, n); }
        const d = s.native ? this.docFor(device) : this.doc;
        c.enqueue(enc.encode(`retry: 5000\n\n${d ? frame(d) : ""}`));
        signal?.addEventListener("abort", () => { end(); try { c.close(); } catch {} });
      },
      cancel: () => end(),
    });
    return new Response(body, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
  }
}

/** POST /api/open's url: one Shepherdr link a tap on an alert opens (./?place=…&task=…&focus=… or ./#accept=<task>) */
export function openUrlOk(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 600) return false;
  if (/^\.\/#accept=[^\s#?&]+$/.test(url)) return true;
  const m = /^\.\/\?([^#\s]*)$/.exec(url);
  if (!m) return false;
  const q = new URLSearchParams(m[1]);
  return !!q.get("place") && [...q.keys()].every((k) => k === "place" || k === "task" || k === "focus");
}
