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
export type ChatView = { lastReply(): { id: string; text: string } | null; status(): string | null; asking(): string | null };

export type HearIO = {
  snap(): Snapshot | null;
  /** a chat's view, by its key (null: no agent running there now) */
  view(key: string): ChatView | null;
  /** keeps that chat read while the call follows it; the stop */
  follow(key: string): () => void;
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

export function hearing(io: HearIO) {
  /** the chats followed now: { stop, last reply seen, last status } */
  const chats = new Map<string, { stop: () => void; view: ChatView; reply: string | null; status: string | null }>();
  /** sent to during the call: followed to its end */
  const sent = new Set<string>();
  let shown: string | null = null;
  const queue: Line[] = [];
  const first = io.snap();
  const needs = new Set((first?.needs ?? []).map(needKey));
  let ready = readyIds(first);

  const wanted = () => new Set([...sent, ...(shown ? [shown] : [])]);
  const name = (key: string) => { const s = io.snap(); return s ? chatName(s, key) : "an agent"; };
  function watch(key: string) {
    if (chats.has(key)) return;
    const view = io.view(key);
    if (!view) return;
    chats.set(key, { stop: io.follow(key), view, reply: view.lastReply()?.id ?? null, status: view.status() });
  }
  function drop(key: string) { chats.get(key)?.stop(); chats.delete(key); }

  return {
    /** the call sent there: its replies are told until the call ends */
    sentTo(key: string) { sent.add(key); watch(key); },
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
        const st = c.view.status();
        if (st !== c.status) {
          c.status = st;
          const line = statusLine(name(key), st, c.view.asking());
          if (line) queue.push(line);
        }
        const r = c.view.lastReply();
        if (r && r.id !== c.reply) { c.reply = r.id; queue.push(replyLine(name(key), r.text)); }
      }
      const s = io.snap();
      if (!s) return;
      for (const n of s.needs ?? []) {
        const k = needKey(n);
        if (needs.has(k)) continue;
        needs.add(k);
        // a followed chat's own wait is said by its status (statusLine) already
        if (chats.has(n.chat) && !n.secret) continue;
        queue.push(needLine(needWords(s, n)));
      }
      const now = readyIds(s);
      for (const id of now) if (!ready.has(id)) {
        const t = s.tasks.find((x) => x.id === id)!;
        queue.push(needLine(`${spoken(t.id)}, "${String(t.name).slice(0, 80)}", is ready for review`));
      }
      ready = now;
    },
    /** the queued updates, as few lines as can be (several said as one), and the queue empty */
    take(): Line[] { return queue.length ? batchLines(queue.splice(0)) : []; },
    pending: () => queue.length,
    stop() { for (const k of [...chats.keys()]) drop(k); },
  };
}
export type Hearing = ReturnType<typeof hearing>;
