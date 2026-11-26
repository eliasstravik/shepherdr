// Recaps (the recaps plugin): a short recap of what happened in a chat, for any agent. Claude Code writes its own
// when you come back after a while (core/chat-log.js reads it as a recap item); for the rest, and on the Recap
// action, Shepherdr asks the chat's agent once with a <herdr-recap> message. The ask never shows in the chat, and the
// agent's answer shows as a recap, not a message. Only an idle agent is asked (never one at work: that would steer
// it), only when something happened since the last recap, and never twice in a row.
import type { Hub } from "./hub.ts";

export const RECAP_ASK = `<herdr-recap>The person is back and wants a quick recap of this chat. In two or three short, plain sentences: what was done since they last looked, what you are waiting for, and anything they need to decide. Only the recap: no tools, no headings, no suggested replies, and start no new work.</herdr-recap>`;

/** what a recap ask is refused for, in the person's words */
export const RECAP_WORDS = {
  busy: "It's working: a recap can wait until it stops.",
  gone: "Its agent isn't running.",
  nothing: "Nothing new since the last recap.",
  asked: "A recap is on its way.",
};

// when each chat's agent was last asked (its address → ms): one ask at a time
const asked = new Map<string, number>();
const AGAIN_AFTER = 3 * 60_000;

/** Is there anything to recap: words or work of the agent's after the newest recap (and after the newest ask's
 *  answer)? `items` are core/chat-log.js's. */
export function newSinceRecap(items: { kind: string }[]): boolean {
  const last = items.findLastIndex((x) => x.kind === "recap");
  return items.slice(last + 1).some((x) => x.kind === "agent" || x.kind === "tools");
}

/** ask the agent at `addr` for a recap, or say why not: { ok, asked?, why? } (auto: the page's own on your return,
 *  which never errs) */
export async function askRecap(hub: Hub, addr: string, items: { kind: string }[], { auto = false, now = Date.now() } = {}) {
  const t: any = hub.terminals.get(addr);
  const no = (why: string) => {
    if (auto) return { ok: true, asked: false, why };
    throw new Error(why);
  };
  if (!t || t.state !== "live") return no(RECAP_WORDS.gone);
  const st = t.status?.state;
  if (st === "working" || st === "blocked") return no(RECAP_WORDS.busy);
  if (asked.has(addr) && now - asked.get(addr)! < AGAIN_AFTER) return no(RECAP_WORDS.asked);
  if (!newSinceRecap(items)) return no(RECAP_WORDS.nothing);
  asked.set(addr, now);
  const r = await hub.send(addr, RECAP_ASK);
  if (r.code !== 0) {
    asked.delete(addr);
    return no(RECAP_WORDS.gone);
  }
  return { ok: true, asked: true };
}

/** for tests: forget the asks */
export const forgetAsks = () => asked.clear();
