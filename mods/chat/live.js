// Herdr's live lists, read once per render (HERD-94, SHEP-15). Herdr gives a render about 50 ms;
// past that it stops it and shows "This view could not be re-rendered; showing the last version
// that worked". Each terminals(), panes(), spaces() or agents() call copies the whole list again
// (terminals() about 3.5 ms for 18 terminals over six machines), and a render asked for them
// dozens of times: the chat, then the status bar (a terminals() per waiting agent, per waiting
// agent). Inside inRender() these give one copy per render; anywhere else (clicks, timers, tasks)
// the live list, as before. The copies are shared by the whole render: never sort or change them
// in place. Every view wraps its render in inRender(), and the shared modules read the lists here.
//
// Shared: the source is lib/live.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/live.js, never a mod's copy, then run bin/sync-shared.
import { agents as liveAgents, panes as livePanes, terminals as liveTerminals, spaces as liveSpaces } from "herdr";

// The render's copies. A render Herdr stops runs no `finally`, so a copy older than any render
// can be (STALE ms) is never used.
const STALE = 250;
let frame = null;
const current = () => (frame && Date.now() - frame.at < STALE ? frame : null);
const once = (name, read) => () => {
  const f = current();
  if (!f) return read();
  if (!(name in f.lists)) f.lists[name] = read();
  return f.lists[name];
};

export const agents = once("agents", liveAgents);
export const panes = once("panes", livePanes);
export const terminals = once("terminals", liveTerminals);
export const spaces = once("spaces", liveSpaces);

// Runs fn (a render) with one copy of each list; a render inside another uses the outer one's.
export function inRender(fn) {
  const outer = current();
  frame = outer ?? { at: Date.now(), lists: {} };
  try { return fn(); } finally { frame = outer; }
}
