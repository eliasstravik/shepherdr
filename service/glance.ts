// The glance feed (SHEP-246, for ELIA-54's Shepherdr Wake): what a phone's widgets, lock screen and watch show, small
// enough to keep a live link to all day. The page socket sends the whole snapshot (~720 KB) on every change; this doc is
// ~15 KB and changes only when what the person sees changes. Built from the same snapshot with the same alert words
// (push.ts alertsOf), so a native notification says exactly what a web push says. The format: docs/glance.md.
//
// glanceOf started as ELIA-54's reference (glance-feed/glance.ts in shepherdr-wake), kept as it is but for a stable `at`
// (an item with no time of its own never takes "now": that changed `v` on every snapshot), and to list what the app
// lists: every need (one its space's Notify keeps quiet too, without alerting), an agent's alert only while it stands.
import { needAlert } from "./push.ts";
import { GROUPS } from "../web/shared/types.ts";
import { ALERT_FRESH_MS, MEMORY_BACK_UNDER, alertStands, needsYou, unreadChats, waitingTasks } from "../web/shared/needs-you.ts";

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
};
export type Kind = Item["kind"];
export type Counts = Record<Kind, number>;
/** a section of the list, in the web app's Tasks panel order (Needs you, Ready, Working, Done): its kind, its name there,
 *  and how many items it holds (all of them, even past the 40 items) */
export type Group = { kind: Kind; label: string; count: number };
/** v: changes with anything; urgent: changes only with what notifies (a new or gone alert, its words, the counts): a
 *  stream sends an urgent change at once and the rest (status lines, progress) at most once a minute */
/** unread: how many Assistants' chats have a new message not yet read (their space not muted): Chat's badge, never in
 *  Needs you (SHEP-253) */
export type Glance = { format: number; v: string; urgent: string; at: number; counts: Counts; order: Kind[]; groups: Group[]; items: Item[]; unread: number };

/** the Tasks panel's statuses each kind lists (merging is Working here) */
const KIND_OF: Partial<Record<string, Kind>> = { need: "needs", ready: "ready", merging: "working", work: "working", done: "done" };
/** the status whose name a kind takes */
const NAMED: Record<Kind, string> = { needs: "need", ready: "ready", working: "work", done: "done" };
/** the kinds in the Tasks panel's order, with its names (web/shared/types.ts GROUPS, as the web app's groups.ts) */
export const KINDS: { kind: Kind; label: string }[] = GROUPS.flatMap(([s]) => KIND_OF[s] ?? [])
  .filter((k, i, all) => all.indexOf(k) === i)
  .map((kind) => ({ kind, label: GROUPS.find(([s]) => s === NAMED[kind])![1] }));

export const WATCH_TITLE = 30, WATCH_BODY = 80, LABEL = 24, MAX_ITEMS = 40;
// the rule of what stands (an agent's alert while it lasts) is Needs you's own, shared with the web app
export { ALERT_FRESH_MS, MEMORY_BACK_UNDER, alertStands };
const clip = (s: string, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…"; };
const urlOf = (place: string, task?: string, focus?: string) => { const q = new URLSearchParams({ place }); if (task) q.set("task", task); if (focus) q.set("focus", focus); return `./?${q}`; };

/** a card's choices a button may send by itself (Shepherdr's quickChoices and choiceButtons rules: never a plan, a form, a
 *  merge, a pick of several, a terminal menu, a choice that needs a note or a grant for good); three at most (Android) */
export function buttonChoices(q: any): Choice[] {
  if (!q?.choices?.length || q.kind === "Plan" || (q.parts && q.parts.length > 1) || /^merge\b/i.test(q.title ?? "") || q.evidence || q.multi || String(q.id ?? "").startsWith("menu:")) return [];
  return q.choices
    .map((c: any, i: number) => ({ i, label: clip(c.label, LABEL) }))
    .filter((c: Choice) => c.i !== q.noteRequiredFor && c.i !== q.always)
    .slice(0, 3);
}

/** start of today (local time on the serving machine) */
const today = (now: number) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };

/**
 * snap: Shepherdr's snapshot. alerts: alertsOf(snap, …) from service/push.ts (its wording, tags, urls and reply targets).
 */
export function glanceOf(snap: any, alerts: Map<string, any>, now = Date.now()): Glance {
  const places = new Map<string, any>((snap.places ?? []).map((p: any) => [p.id, p]));
  const spaceOf = (id?: string) => (id ? places.get(id) : null);
  const items: Item[] = [];
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
    if (w.type === "task") { items.push(taskItem(t, "needs", w.at || undefined)); continue; }
    const pushed = alerts.get(w.key);
    const a: any = pushed ?? (w.need ? needAlert(snap, w.need) : { title: w.alert!.title, body: w.alert!.body, tag: w.key, ...(w.place ? { place: w.place, url: urlOf(w.place) } : {}) });
    const it: Item = { key: w.key, kind: "needs", type: w.type, tag: a.tag, title: clip(a.title, WATCH_TITLE), body: clip(a.body, WATCH_BODY),
      task: t.id, ...taskRow(t), ...(w.at ? { at: w.at } : {}), alert: !!pushed,
      url: a.url ?? (a.place ?? w.place ? urlOf(a.place ?? w.place) : "./") };
    if (a.accept) it.accept = a.accept;
    if (a.reply) it.reply = a.reply;
    // an agent's own alert from a chat: Reply writes to that agent
    else if (w.alert?.chat) it.reply = { chat: w.alert.chat };
    const n = w.need;
    if (n?.question) {
      const choices = buttonChoices(n.question);
      if (choices.length) it.answer = { chat: n.chat, question: n.question.id, choices, ...(n.question.other && n.question.kind !== "Plan" ? { other: true } : {}) };
    }
    items.push(it);
  }
  // a task in Needs you is in no other section
  const waiting = waitingTasks(waits);
  for (const [key, a] of alerts) {
    if (!key.startsWith("ready:")) continue;
    const t = tasks.get(key.slice(6));
    if (!t || waiting.has(t.id)) continue;
    items.push({ key, kind: "ready", type: "task", tag: a.tag, title: clip(a.title, WATCH_TITLE), body: clip(a.body, WATCH_BODY), task: t.id, ...taskRow(t), ...(t.at ? { at: t.at } : {}), alert: true,
      url: a.url ?? urlOf(t.place, t.id), ...(a.accept ? { accept: a.accept } : {}) });
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
  const unread = unreadChats(snap).length;
  const v = Bun.hash(JSON.stringify([GLANCE_FORMAT, counts, kept, unread])).toString(36);
  return { format: GLANCE_FORMAT, v, urgent: urgentOf(counts, kept), at: now, counts, order, groups, items: kept, unread };
}

/** what notifies in a doc: its alerts, their words and the counts */
const urgentOf = (counts: Counts, items: Item[]) =>
  Bun.hash(JSON.stringify([GLANCE_FORMAT, counts, items.filter((i) => i.alert).map((i) => [i.key, i.title, i.body])])).toString(36);

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
    const now = new Set(doc.items.filter((i) => i.alert).map((i) => i.key));
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
    if (!doc || !seen?.size || !doc.items.some((i) => i.alert && seen.has(i.key))) return doc;
    const items = doc.items.map((i) => (i.alert && seen.has(i.key) ? { ...i, alert: false } : i));
    return { ...doc, items, urgent: urgentOf(doc.counts, items) };
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
