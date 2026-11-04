// A CLI's own screens before its session starts (trust this folder, theme, sign in, an update
// prompt, whatever a later version adds), as cards in the chat, as Shepherdr has them. Reading
// a screen and watching an agent that is starting are core/screens.js's (the web app's service
// watches with the same): two matching reads a poll apart put a card up, and one press on a
// choice presses it in the terminal, only if the screen still shows what the card was drawn from.
// Cards live in shared "chat.screens" = { [address]: [card, ...] } (newest last), so the
// agent's own chat and its Assistant's chat (a task worker's) show the same card and both see
// how it closed (the card's fields: core/screens.js).

import { hc, shared, setShared } from "herdr";
import { terminals } from "./live.js";
import { headStrip, linkCtl } from "./cards.js";
import { ScreenWatch as Watch, SCREEN, KEEP, starting, cliOf } from "./core/screens.js";

export { starting, cliOf };

export const cardsOf = (addr) => (shared("chat.screens") ?? {})[addr] ?? [];
export const openCard = (addr) => { const c = cardsOf(addr).at(-1); return c?.state === "open" ? c : null; };

// One write for the whole store: the cards of agents no longer there go.
function store(addr, list) {
  const live = new Set(terminals().filter((k) => k.state === "live").map((k) => k.address));
  const all = Object.fromEntries(Object.entries(shared("chat.screens") ?? {}).filter(([a]) => a !== addr && live.has(a)));
  if (list.length) all[addr] = list.slice(-KEEP);
  setShared("chat.screens", all);
}

// Watches agents' screens: one per chat copy, its cards in shared "chat.screens".
export class ScreenWatch extends Watch {
  constructor(onPost) {
    super({ hc, cards: cardsOf, save: store }, onPost);
  }
}

// ---- the card --------------------------------------------------------------------------------

// The card's strips for an open screen: the CLI's words, each choice a row that presses it, and
// the terminal. opts: { who (whose screen: "Claude", "HERD-12"), links ([ctl] at the header's
// right), press(i, cx), toTerminal(cx) (none: no link), busy (a press on its way), error }.
export function screenStrips(card, opts = {}) {
  const id = card.id.replace(/[^\w-]/g, "_");
  const links = [...(opts.links ?? []), ...(opts.toTerminal ? [linkCtl(`scr-term-${id}`, "Answer in terminal", (cx) => opts.toTerminal(cx))] : [])];
  const out = [headStrip({ who: opts.who ?? card.cli, links }), { key: "title", kind: "title", text: SCREEN.title(card.cli) }];
  if (card.words) out.push({ key: "words", kind: "detail", lines: card.words.split("\n"), clip: null });
  card.choices.forEach((c, i) => out.push({ key: `c${i}`, kind: "option", gap: i ? 1 : 8, num: i + 1, label: c.label, desc: c.description,
    disabled: Boolean(opts.busy), fn: opts.busy ? null : (cx) => opts.press?.(i, cx) }));
  if (opts.error) out.push({ key: "error", kind: "text", tone: "red", text: opts.error });
  return out;
}
