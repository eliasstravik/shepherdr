// What a voice call hears (SHEP-105): a call is with Shepherdr as a whole, not one chat, so it follows the chats it sent
// to during the call and the one on screen (their replies said briefly, their status as quiet notes), and says anything
// new anywhere that needs the person, once, in one short line and in the app's words: a question, a command to allow,
// a step that needs their hands, a task Ready for review, a task Stopped. Updates wait in a queue: the call takes them
// once the person and the voice are both quiet, several as one (core/voice.js batchLines).
import type { Snapshot } from "../web/shared/types.ts";
import { spaceLabel, tstate } from "../web/shared/view.ts";
import * as V from "../core/voice.js";
import { askWords, chatName, screenChat, type Where } from "./voice-tools.ts";

const { replyLine, statusLine, needLine, batchLines } = V as any;

/** What the call reads of one chat: the agent's last reply and its status. */
export type ChatView = { lastReply(): { id: string; text: string; at?: number } | null; status(): string | null; asking(): string | null };

export type HearIO = {
  /** the snapshot the app shows (enriched: service/next.ts) */
  snap(): Snapshot | null;
  /** a chat's view, by its key (null: no agent running there now) */
  view(key: string): ChatView | null;
  /** keeps that chat read while the call follows it: the stop, and ready once its first read came (what it had before
   *  then is not news) */
  follow(key: string): { stop: () => void; ready?: Promise<unknown> };
};

type Line = { type: string; text: string };
const short = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Everything that needs the person now, each by a key that lasts as long as it does, with its one line: a need (a
 *  question, a command to allow, a secret, a plain wait), a step for their hands, a task Ready for review or Stopped.
 *  chat: the chat it is in (a followed chat's own wait is said by its status instead). */
export function needsNow(snap: Snapshot): Map<string, { text: string; chat?: string; secret?: boolean }> {
  const out = new Map<string, { text: string; chat?: string; secret?: boolean }>();
  const title = (id: string) => { const t = snap.tasks.find((x) => x.id === id); return t ? `The task "${short(t.name, 80)}"` : "A task"; };
  // a step only the person can do on an agent's Screen
  const hands = new Set<string>();
  for (const [key, sc] of Object.entries(snap.screens ?? {})) {
    if (!sc?.hands || sc.hands.settled) continue;
    const who = key.startsWith("task:") ? title(key.slice(5)) : key.startsWith("chat:") ? spaceLabel(snap, key.slice(5)) || "A chat" : "";
    if (!who) continue;
    if (key.startsWith("task:")) hands.add(key.slice(5));
    out.set(`hands:${key}`, { text: `${who} needs your hands on its Screen: ${short(sc.hands.what, 200)}` });
  }
  const stopped = new Set<string>();
  for (const t of snap.tasks) {
    if (t.archived) continue;
    if (tstate(t) === "ready") out.set(`ready:${t.id}`, { text: `${title(t.id)} is ready for review` });
    // stopped by a crash or a limit (Stopped by you is the person's own doing: not news)
    else if (tstate(t) === "ask" && t.stopped && t.stopped.by !== "you") {
      stopped.add(t.id);
      out.set(`stopped:${t.id}`, { text: `${title(t.id)} stopped${t.stopped.why ? `: ${short(t.stopped.why, 200)}` : t.stopped.by === "limit" ? ": it hit its plan's limit" : ""}` });
    }
  }
  for (const n of snap.needs ?? []) {
    // a wait with no card of a task whose stop or step for the person's hands is said already
    if (n.task && !n.question && !n.secret && (stopped.has(n.task) || hands.has(n.task))) continue;
    if (n.task && snap.tasks.find((t) => t.id === n.task)?.stopped?.by === "you") continue;
    const who = n.task ? title(n.task) : spaceLabel(snap, n.place) || chatName(snap, n.chat);
    out.set(`need:${n.chat}#${n.id}`, { text: `${who} ${n.question || n.secret ? askWords(n).split(": it goes in")[0] : `needs the person${n.text ? `: ${short(n.text, 300)}` : ""}`}`, chat: n.chat, secret: !!n.secret });
  }
  return out;
}

/** how long after a chat's status said it waits its need (the snapshot a little behind) counts as that same wait */
const WAIT_TOLD_MS = 15_000;

export function hearing(io: HearIO) {
  /** the chats followed now: { stop, last reply seen, last status; primed once its first read came } */
  const chats = new Map<string, { stop: () => void; view: ChatView; reply: string | null; status: string | null; primed: boolean; base?: string | null }>();
  /** sent to during the call: followed to its end */
  const sent = new Set<string>();
  let shown: string | null = null;
  const queue: Line[] = [];
  const first = io.snap();
  /** what needed the person when the call started, and what was said since: each said once */
  const needs = new Set(first ? needsNow(first).keys() : []);
  /** when a followed chat's status said it waits for the person: its need that shows soon after isn't said again */
  const toldWait = new Map<string, number>();

  const wanted = () => new Set([...sent, ...(shown ? [shown] : [])]);
  const name = (key: string) => { const s = io.snap(); return s ? chatName(s, key) : "an agent"; };
  /** when the call first sent to each chat: a reply after that is news, even one in the chat's first read */
  const sentAt = new Map<string, number>();
  function watch(key: string) {
    if (chats.has(key)) return;
    const view = io.view(key);
    if (!view) return;
    const f = io.follow(key);
    const c = { stop: f.stop, view, reply: null as string | null, status: null as string | null, primed: false, base: null as string | null };
    chats.set(key, c);
    // what the chat said before its first read came in is not news: the baseline is taken then (or after 8 s)
    const prime = () => {
      if (c.primed) return;
      c.primed = true;
      const r = view.lastReply();
      // a quick answer to this call's send, already there by the first read, is still told
      c.reply = c.base = r && !(sentAt.has(key) && (r.at ?? 0) >= sentAt.get(key)!) ? r.id : null;
      c.status = view.status();
    };
    if (f.ready) Promise.race([f.ready, new Promise((r) => setTimeout(r, 8000))]).then(prime, prime);
    else prime();
  }
  function drop(key: string) { chats.get(key)?.stop(); chats.delete(key); }

  return {
    /** the call sent there: its replies are told until the call ends */
    sentTo(key: string, at = Date.now()) {
      if (!sentAt.has(key)) sentAt.set(key, at);
      sent.add(key);
      watch(key);
      // its first read came while the send was on its way and took a quick answer for history: it is news after all
      const c = chats.get(key), r = c?.view.lastReply();
      if (c?.primed && r && r.id === c.base && r.id === c.reply && (r.at ?? 0) >= at) c.reply = null;
    },
    /** what the screen shows now (the page's or the window's where) */
    onScreen(where: Where) {
      const s = io.snap();
      const key = s ? screenChat(s, where) : null;
      if (key === shown) return;
      const was = shown;
      shown = key;
      if (was && !sent.has(was)) drop(was);
      if (key) watch(key);
    },
    /** the keys followed now (tests, and look) */
    following: () => [...chats.keys()],
    /** looks once (about every second): new replies, status, and what newly needs the person, into the queue */
    tick() {
      for (const key of wanted()) watch(key);
      for (const [key, c] of chats) {
        if (!c.primed) continue;
        const st = c.view.status();
        if (st !== c.status) {
          c.status = st;
          const line = statusLine(name(key), st, c.view.asking());
          if (line) queue.push(line);
          if (st === "blocked") toldWait.set(key, Date.now());
        }
        const r = c.view.lastReply();
        if (r && r.id !== c.reply) { c.reply = r.id; queue.push(replyLine(name(key), r.text)); }
      }
      const s = io.snap();
      if (!s) return;
      // one that went away is forgotten: the same one again later (a task's "attention" id comes back) is new
      const now = needsNow(s);
      for (const k of needs) if (!now.has(k)) needs.delete(k);
      for (const [k, n] of now) {
        if (needs.has(k)) continue;
        needs.add(k);
        // a followed chat's wait that its status just said (statusLine); a later question of one still waiting is new
        if (n.chat && !n.secret && Date.now() - (toldWait.get(n.chat) ?? 0) < WAIT_TOLD_MS) { toldWait.delete(n.chat); continue; }
        queue.push(needLine(n.text));
      }
    },
    /** the queued updates, as few lines as can be (several said as one), and the queue empty */
    take(): Line[] { return queue.length ? batchLines(queue.splice(0)) : []; },
    pending: () => queue.length,
    stop() { for (const k of [...chats.keys()]) drop(k); },
  };
}
export type Hearing = ReturnType<typeof hearing>;
