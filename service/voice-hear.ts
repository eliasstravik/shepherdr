// What a voice call hears (SHEP-105): a call is with Shepherdr itself, not one chat, so it follows the chats it sent to
// during the call and the one on screen (their replies said briefly, their status as quiet notes), and says anything new
// anywhere that needs the person (a question, a secret, a task Ready) in one short line. Updates wait in a queue: the
// call takes them once the person and the voice are both quiet, several as one (core/voice.js batchLines). The web's
// call (voice.ts) and the window's (POST /api/voice/hear, from mods/chat/voice.ts) both use it.
import type { Snapshot } from "../web/shared/types.ts";
import * as V from "../core/voice.js";
import { chatName, screenChat, type Where } from "./voice-tools.ts";

const { replyLine, statusLine, needLine, batchLines } = V as any;

/** What the call reads of one chat: the agent's last reply and its status. */
export type ChatView = { lastReply(): { id: string; text: string; at?: number } | null; status(): string | null; asking(): string | null };

export type HearIO = {
  snap(): Snapshot | null;
  /** a chat's view, by its key (null: no agent running there now) */
  view(key: string): ChatView | null;
  /** keeps that chat read while the call follows it: the stop, and ready once its first read came (what it had before
   *  then is not news) */
  follow(key: string): { stop: () => void; ready?: Promise<unknown> };
};

type Line = { type: string; text: string };
const spoken = (id: string) => id.split(":").pop()!.replace(/-/g, " ");

/** a need's key and its words ("the shop Assistant needs you: Which port?") */
function needWords(snap: Snapshot, n: Snapshot["needs"][number]) {
  const who = n.task ? `${spoken(n.task)}'s agent` : chatName(snap, n.chat);
  const what = n.question?.title ?? (n.secret ? `a secret, ${n.secret.name}` : n.text ?? "");
  return `${who} needs the person${what ? `: ${String(what).replace(/\s+/g, " ").slice(0, 300)}` : ""}`;
}
const needKey = (n: Snapshot["needs"][number]) => `${n.chat}#${n.id}`;
const readyIds = (snap: Snapshot | null) => new Set((snap?.tasks ?? []).filter((t) => t.status === "ready" && !t.archived).map((t) => t.id));

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
  const needs = new Set((first?.needs ?? []).map(needKey));
  let ready = readyIds(first);
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
    /** looks once (about every second): new replies, status, needs, Ready tasks, into the queue */
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
      // a need answered is forgotten: the same one again later (a task's "attention" id comes back) is new
      const now = new Set((s.needs ?? []).map(needKey));
      for (const k of needs) if (!now.has(k)) needs.delete(k);
      for (const n of s.needs ?? []) {
        const k = needKey(n);
        if (needs.has(k)) continue;
        needs.add(k);
        // a followed chat's wait that its status just said (statusLine); a later question of one still waiting is new
        if (!n.secret && Date.now() - (toldWait.get(n.chat) ?? 0) < WAIT_TOLD_MS) { toldWait.delete(n.chat); continue; }
        queue.push(needLine(needWords(s, n)));
      }
      const nowReady = readyIds(s);
      for (const id of nowReady) if (!ready.has(id)) {
        const t = s.tasks.find((x) => x.id === id)!;
        queue.push(needLine(`${spoken(t.id)}, "${String(t.name).slice(0, 80)}", is ready for review`));
      }
      ready = nowReady;
    },
    /** the queued updates, as few lines as can be (several said as one), and the queue empty */
    take(): Line[] { return queue.length ? batchLines(queue.splice(0)) : []; },
    pending: () => queue.length,
    stop() { for (const k of [...chats.keys()]) drop(k); },
  };
}
export type Hearing = ReturnType<typeof hearing>;
