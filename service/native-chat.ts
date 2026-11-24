// A chat for a phone's or watch's own app (SHEP-447, docs/native-chat.md): GET /api/chat pages one chat's messages, text
// only, newest first. The page socket (/api/ws) sends the whole snapshot (~720 KB) on every change and a chat whole each
// time it moves: far too much for a watch. Sending and marking read are the page's own POST /api/action calls.
import type { Chat, Message } from "../web/shared/types.ts";
import type { Watcher } from "./chats.ts";
import { TEXT_MAX, fullText } from "./glance.ts";

export const PAGE = 20, PAGE_MAX = 50;
/** how long a chat nobody follows may take to be read the first time */
const READ_WAIT_MS = 8_000;

/** one message as a watch shows it: who said it, when (ms, when known), its words in plain text (<= TEXT_MAX) */
export type Line = { id: string; who: "you" | "agent"; at?: number; text: string; question?: true };
export type Page = { chat: string; messages: Line[]; more: boolean };

/** a message's words, or none: quiet rows (a brief, a message between agents, a tool run, a divider) are left out; a
 *  question is its title */
export function lineOf(m: Message): Line | null {
  if (m.brief || m.relay || m.taskBrief || m.secret) return null;
  const said = m.text || m.question?.title || m.news?.text || "";
  const text = fullText(said, TEXT_MAX);
  if (!text) return null;
  return { id: m.id, who: m.who === "you" ? "you" : "agent", ...(typeof m.at === "number" ? { at: m.at } : {}), text, ...(m.question && !m.text ? { question: true as const } : {}) };
}

/** the page before message `before` (none: the newest), newest first, `limit` long. more: older ones are there or can
 *  be read (the chat's log not read from its start). A `before` the chat no longer has gives an empty page. */
export function pageOf(chat: Pick<Chat, "messages" | "earlier">, key: string, before?: string, limit = PAGE): Page {
  const all = chat.messages;
  const end = before ? all.findIndex((m) => m.id === before) : all.length;
  if (end < 0) return { chat: key, messages: [], more: false };
  const lines: Line[] = [];
  let i = end - 1;
  for (; i >= 0 && lines.length < limit; i--) { const l = lineOf(all[i]); if (l) lines.push(l); }
  const left = all.slice(0, i + 1).some((m) => lineOf(m));
  return { chat: key, messages: lines, more: left || !!chat.earlier };
}

export type Deps = {
  addrOf: (key: string) => string | null;
  freshChat: (key: string) => Chat | null;
  chatOf: (key: string, reader: any, terminal: any) => Chat;
  terminal: (addr: string) => any;
  watch: (addr: string, w: Watcher) => void;
  unwatch: (addr: string, w: Watcher) => void;
  /** read the chat's page before what it has (core ChatReader.earlier): true if it got more */
  earlier: (reader: any) => Promise<boolean>;
};

/** GET /api/chat: a chat read once (followed for the moment, then let go: Chats drops it a minute later), its page */
export async function chatPage(d: Deps, key: string, before?: string, limit = PAGE): Promise<Page | null> {
  limit = Math.max(1, Math.min(PAGE_MAX, Math.floor(limit) || PAGE));
  const addr = d.addrOf(key);
  if (!addr) { const fresh = d.freshChat(key); return fresh ? pageOf(fresh, key, before, limit) : null; }
  let w: Watcher | null = null;
  const reader = await new Promise<any>((resolve) => {
    const cut = setTimeout(() => resolve(null), READ_WAIT_MS);
    w = (r) => { clearTimeout(cut); resolve(r); };
    d.watch(addr, w);
  });
  try {
    if (!reader) return { chat: key, messages: [], more: true };
    let chat = d.chatOf(key, reader, d.terminal(addr));
    let page = pageOf(chat, key, before, limit);
    // a short page while the log has earlier pages: read them (a few at most) so a page is whole
    for (let n = 0; n < 3 && page.messages.length < limit && chat.earlier && (await d.earlier(reader)); n++) {
      chat = d.chatOf(key, reader, d.terminal(addr));
      page = pageOf(chat, key, before, limit);
    }
    return page;
  } finally {
    if (w) d.unwatch(addr, w);
  }
}
