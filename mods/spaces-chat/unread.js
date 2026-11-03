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

import { terminals, panes, focused, window, shared, hc } from "herdr";
import { muted } from "./notify.js";

export const READ = "herdr.chat.read";

const machineOf = (address) => (address.includes("/") ? address.split("/")[0] : null);

// A space's Assistant: the live coordinator terminal labelled for it, on the space's machine
// (labels hold that machine's own ids, without the "<machine>/" an app id has).
export function assistantOf(space, ts = terminals()) {
  const id = String(space.id).split("/").pop();
  return ts.find((k) => k.state === "live" && k.labels?.["herdr.role"] === "coordinator"
    && k.labels?.["herdr.coordinator.space"] === id && machineOf(k.address) === (space.machine ?? null)) ?? null;
}

// The turn last read. Before any mark: the turn Herdr last saw it done at (mods/chat's "chat.seen").
function readTurn(k) {
  const mark = Number(k.labels?.[READ]);
  return Number.isFinite(mark) ? mark : (shared("chat.seen") ?? {})[k.address] ?? 0;
}

// What a mark sent already covers, until the core has it.
const asked = new Map();

export function unread(k) {
  if (!k || k.labels?.["herdr.role"] !== "coordinator") return false;
  return (k.turn ?? 0) > Math.max(readTurn(k), asked.get(k.address) ?? 0);
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
  const chat = k.labels?.["herdr.chat"];
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
