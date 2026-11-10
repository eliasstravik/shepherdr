// Unread, as Slack has it (Shepherdr's src/unread.ts): a space whose Assistant (its coordinator)
// has something new the person hasn't seen shows its sidebar row bold and bright. Only the
// Assistant counts; task chats never make a row bold.
// New: the agent's core counts its turns (`turn`, up each time it stops working: a reply, or its
// answer to something Herdr or a task sent it). Read: the turn last seen, kept on the agent's own
// terminal as the core label herdr.chat.read, so every Herdr client and device shows the same.
// Having its chat (or its terminal) on screen, in a window in front, reads it; a space row's menu
// has Mark as read (mods/spaces-chat).
// Shared: the source is lib/unread.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/unread.js, never a mod's copy, then run bin/sync-shared.

import { focused, window, shared, hc } from "herdr";
import { terminals, panes } from "./live.js";
import { muted } from "./notify.js";

// The rules (which terminal is a space's Assistant, the turn read, unread) are core/spaces.js, shared with
// the service and the web app.
export { READ } from "./core/spaces.js";
import { READ, assistantOf as assistantIn, isUnread, chatPane } from "./core/spaces.js";

export const assistantOf = (space, ts = terminals()) => assistantIn(space, ts);

// What a mark sent already covers, until the core has it.
const asked = new Map();

export function unread(k) {
  return isUnread(k, shared("chat.seen") ?? {}, asked.get(k?.address) ?? 0);
}

// The ids of the spaces whose Assistant has something new. A muted one (Notify: Off) never is.
export function unreadSpaces(sp, ts = terminals()) {
  return new Set(sp.filter((s) => !muted(s.id) && unread(assistantOf(s, ts))).map((s) => s.id));
}

export function markRead(k) {
  if (!unread(k)) return;
  asked.set(k.address, k.turn);
  const undo = () => asked.get(k.address) === k.turn && asked.delete(k.address);
  hc(["label", k.address, `${READ}=${k.turn}`]).then((r) => r.code !== 0 && undo(), undo);
}

// On screen: its chat pane, or the pane its terminal shows in, is in the tab the window shows,
// not behind another pane's zoom nor showing a worker's thread, and the window is in front.
export function onScreen(k, ps = panes()) {
  if (!k || !window()?.active) return false;
  const chat = chatPane(k);
  const p = ps.find((x) => x.terminal === k.address) ?? ps.find((x) => x.pane === chat && x.mod === "chat");
  if (!p || p.tab !== focused()?.tab) return false;
  if (p.mod === "chat" && shared("chat.threads")?.[p.pane]) return false;
  return !ps.some((x) => x.tab === p.tab && x.zoomed && x.pane !== p.pane);
}

// Every Assistant on screen is read.
export function readShown(ts = terminals()) {
  const ps = panes();
  for (const k of ts) if (unread(k) && onScreen(k, ps)) markRead(k);
}
