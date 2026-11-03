// A CLI's own screens before its session starts (trust this folder, theme, sign in, an update
// prompt, whatever a later version adds), as cards in the chat, as Shepherdr has them
// (server/common/screen-card.ts, server/core/screens.ts). No hook reports these, so the chat
// reads the agent's screen: two matching reads a poll apart put a card up, and one press on a
// choice presses it in the terminal, only if the screen still shows what the card was drawn
// from. A screen with nothing to choose makes no card (it may be a slow start), unless a card
// came before and this one holds a link (a sign-in). An agent that reports a status (its
// session started) or took a turn never gets one.
// Cards live in shared "chat.screens" = { [address]: [card, ...] } (newest last), so the
// agent's own chat and its Assistant's chat (a task worker's) show the same card and both see
// how it closed: { id, addr, cli, words, choices: [{ label, description? }], at (the cursor's
// choice), all (screenText), seen (sameScreen), state: "open" | "answered" | "closed", how,
// opened, changed }.

import { hc, shared, setShared } from "herdr";
import { terminals } from "./live.js";
import { headStrip, linkCtl } from "./cards.js";

// ---- reading a screen (screen-card.ts) ---------------------------------------------------------

const MARKER = /^(\s*[❯›▶►➤→>]\s+)(.*)$/u;
const TICK = /^[✔✓]\s+/u;
const NUMBER = /^\d{1,2}[.)]\s+/;
const ENTER = /press enter|enter to continue/i;
const MOST_WORDS = 8;
// A frame of the usual Braille spinner or Claude Code's, starting a line, in a box or not.
const SPINNER = /^([\s│┃]*)[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✢✳✶✻✽](?=\s|$)/u;

// Box sides turn to spaces, so columns stay where the CLI drew them.
const cleaned = (text) => String(text ?? "").split("\n").map((line) => line.replace(/[│┃]/g, " ").trimEnd());
const indent = (line) => line.length - line.trimStart().length;
// Words, not a logo, a rule or a spinner.
const wordy = (line) => { const text = line.replace(/\s/g, ""); return text.length > 2 && [...text.matchAll(/\p{L}/gu)].length * 2 > text.length; };

function optionAt(line, index, numbered, column) {
  const mark = line.match(MARKER), text = mark ? mark[2] : line.trimStart(), tick = text.match(TICK)?.[0] ?? "";
  const label = text.slice(tick.length), at = (mark ? mark[1].length : indent(line)) + tick.length;
  if (at !== column || numbered !== NUMBER.test(label)) return undefined;
  return { line: index, column: at, label: label.replace(NUMBER, "").replace(/\s{2,}/g, " · ") };
}

function menuAt(lines, line) {
  const mark = lines[line].match(MARKER);
  if (!mark) return undefined;
  const tick = mark[2].match(TICK)?.[0] ?? "", numbered = NUMBER.test(mark[2].slice(tick.length)), column = mark[1].length + tick.length;
  // Numbered menus may space their choices out; a plain one ends at its first blank line.
  const walk = (step) => {
    let end = line;
    for (let at = line + step, blanks = 0; at >= 0 && at < lines.length; at += step) {
      if (!lines[at]) { if (!numbered || ++blanks > 1) break; continue; }
      blanks = 0;
      if (optionAt(lines[at], at, numbered, column)) end = at;
      else if (indent(lines[at]) <= column) break;
      else if (step > 0) end = at;
    }
    return end;
  };
  const top = walk(-1), bottom = walk(1), options = [];
  for (let at = top; at <= bottom; at++) {
    const option = optionAt(lines[at], at, numbered, column);
    if (option) options.push({ label: option.label, line: at });
    else if (lines[at] && options.length) options[options.length - 1].description = [options[options.length - 1].description, lines[at].trim()].filter(Boolean).join(" ");
  }
  return options.length > 1 ? { top, options, current: options.findIndex((o) => o.line === line) } : undefined;
}

// The words just above: back to a logo or rule, or a wide gap.
function wordsAbove(lines, end, most) {
  const words = [];
  for (let at = end - 1, blanks = 0; at >= 0 && words.filter(Boolean).length < most; at--) {
    if (!lines[at]) { if (++blanks > 1 && words.length) break; continue; }
    if (!wordy(lines[at])) { if (words.length) break; blanks = 0; continue; }
    if (blanks && words.length) words.unshift("");
    blanks = 0;
    words.unshift(lines[at].trim());
  }
  return words.join("\n").trim();
}

// A link wrapped at the screen's edge, whole, whatever else keeps it from the words.
function links(lines, width, words) {
  const found = lines.flatMap((line, at) => {
    if (!/https?:\/\//.test(line)) return [];
    let link = line.slice(line.search(/https?:\/\//)), end = at;
    while (lines[end].length >= width && lines[end + 1]) link += lines[++end];
    return [link.split(/\s/)[0]];
  });
  return [...new Set(found)].filter((link) => !words.includes(link));
}
const withLinks = (words, lines, width) => [words, ...links(lines, width, words)].filter(Boolean).join("\n\n");

// The menu lowest on the screen, for it is the one in play: a line with the CLI's cursor mark
// and at least one sibling beside it.
function cursorLine(lines) {
  for (let i = lines.length - 1; i >= 0; i--) if (menuAt(lines, i)) return i;
  return -1;
}

// { words, choices: [{ label, description? }] in screen order, at: the cursor's choice }.
export function readScreen(text, width = Infinity) {
  const lines = cleaned(text), line = cursorLine(lines);
  if (line >= 0) {
    const menu = menuAt(lines, line);
    return { words: withLinks(wordsAbove(lines, menu.top, MOST_WORDS), lines.slice(0, menu.top), width),
      choices: menu.options.map(({ label, description }) => ({ label, ...(description ? { description } : {}) })), at: menu.current };
  }
  let enter = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (ENTER.test(lines[i])) { enter = i; break; }
  return { words: withLinks(wordsAbove(lines, enter >= 0 ? enter : lines.length, MOST_WORDS), lines, width), choices: enter >= 0 ? [{ label: "Continue" }] : [], at: 0 };
}

// Letters only, so a screen with a timer on it still settles enough to show.
export const sameScreen = (text) => cleaned(text).join(" ").replace(/[^\p{L}]+/gu, " ").trim();
// The screen as it is, all but what moves with no one touching the words: the menu's cursor and
// a spinner's frame. A press needs this to match what the card was drawn from.
export function screenText(text) {
  const lines = String(text ?? "").split("\n"), plain = cleaned(text), cursor = cursorLine(plain);
  if (cursor >= 0) { const mark = plain[cursor].search(/\S/); lines[cursor] = `${lines[cursor].slice(0, mark)} ${lines[cursor].slice(mark + 1)}`; }
  return lines.map((line) => line.replace(SPINNER, "$1 ").trimEnd()).join("\n");
}
// The keys that move from the cursor to a choice and take it.
export const pressKeys = (at, choice) => [...Array(Math.abs(choice - at)).fill(choice < at ? "up" : "down"), "enter"];

// ---- watching agents that are starting (screens.ts) --------------------------------------------

const FIRST_LOOK = 6000;  // an agent this young may just be slow
const RETRY = 10000;      // a pressed choice has this long to leave the screen before it's asked again
const KEEP = 6;           // closed cards kept per agent (their quiet lines)
const CLI = { claude: "Claude Code", codex: "Codex" };

// Which CLI a terminal runs: { claude | codex } from its report or its program, else null.
export function cliOf(k) {
  const a = String(k?.status?.app ?? k?.agent ?? k?.foreground?.name ?? "");
  return /^claude/.test(a) ? "claude" : /^codex/.test(a) ? "codex" : null;
}

// Still before its session: live, no status reported, no turn taken. (hc ls's `status` is the
// report's state word, or null.)
export function starting(k) {
  const st = typeof k?.status === "string" ? k.status : k?.status?.state ?? null;
  return Boolean(k) && k.state === "live" && !st && !(k.turn > 0) && Boolean(cliOf(k));
}

export const cardsOf = (addr) => (shared("chat.screens") ?? {})[addr] ?? [];
export const openCard = (addr) => { const c = cardsOf(addr).at(-1); return c?.state === "open" ? c : null; };

// One write for the whole store: the cards of agents no longer there go.
function store(addr, list) {
  const live = new Set(terminals().filter((k) => k.state === "live").map((k) => k.address));
  const all = Object.fromEntries(Object.entries(shared("chat.screens") ?? {}).filter(([a]) => a !== addr && live.has(a)));
  if (list.length) all[addr] = list.slice(-KEEP);
  setShared("chat.screens", all);
}
function update(card, change) {
  store(card.addr, cardsOf(card.addr).map((c) => (c.id === card.id ? { ...c, ...change, changed: Date.now() } : c)));
}
// A card gone with no press on it: `how` says why.
export function closeCard(card, how) { update(card, { state: "closed", how }); }

// Watches agents' screens: one per chat copy. tick(addr) every couple of seconds while the agent
// is starting; it says (through onPost) when it put a new card up, for the alert.
export class ScreenWatch {
  constructor(onPost) {
    this.onPost = onPost;
    this.last = new Map();
    this.looking = new Set();
    this.pressing = new Set();
  }

  // k: the terminal as hc get has it (created_ms, cols) or terminals()'s entry.
  async tick(addr, k, now = Date.now()) {
    const was = openCard(addr);
    if (!starting(k)) {
      this.last.delete(addr);
      // Its session started (it reports, or took a turn), or it ended: the card's wait is over.
      if (was) closeCard(was, k?.state === "live" ? "Answered in the terminal" : "The agent stopped");
      return;
    }
    if (this.looking.has(addr) || this.pressing.has(addr)) return;
    this.looking.add(addr);
    try {
      // The live list (terminals()) doesn't say when it started or how wide it is: hc get does.
      if (k.created_ms === undefined) { try { k = { ...JSON.parse((await hc(["get", addr, "--json"])).stdout || "{}"), ...k }; } catch {} }
      if (k.created_ms && now - k.created_ms < FIRST_LOOK) return;
      const r = await hc(["read", addr]);
      if (r.code !== 0) return;
      const text = r.stdout ?? "";
      const seen = sameScreen(text), all = screenText(text), { words, choices, at } = readScreen(text, k.cols ?? Infinity);
      const shown = JSON.stringify([all, choices]);
      const before = this.last.get(addr);
      this.last.set(addr, { seen, shown });
      if (before?.seen !== seen) return; // still moving
      const cards = cardsOf(addr), last = cards.at(-1);
      const open = last?.state === "open" && last.seen === seen ? last : null;
      // The same screen with a new code or number on it: a new card, so a press on the old one
      // can't reach words it didn't show.
      if (open && before.shown === shown && JSON.stringify([open.all, open.choices]) !== shown) { closeCard(open, "The screen changed"); this.post(addr, k, { seen, all, words, choices, at }); return; }
      if (open || cards.some((c) => c.seen === seen && now - (c.changed ?? c.opened) < RETRY)) return;
      if (last?.state === "open") closeCard(last, "Answered in the terminal");
      if (!choices.length && !(words && cards.length && /https?:\/\//.test(text))) return;
      this.post(addr, k, { seen, all, words, choices, at });
    } finally {
      this.looking.delete(addr);
    }
  }

  post(addr, k, s) {
    const card = { id: `scr-${addr}-${Date.now()}`, addr, cli: CLI[cliOf(k)] ?? "The agent", ...s, state: "open", opened: Date.now() };
    store(addr, [...cardsOf(addr), card]);
    this.onPost?.(card);
  }

  // A press on a choice: only on the screen the card was drawn from. Resolves with an error's
  // words, or null once pressed.
  async press(card, choice) {
    if (this.pressing.has(card.addr)) return null;
    const now = openCard(card.addr);
    if (!now || now.id !== card.id) return "This screen is no longer waiting.";
    this.pressing.add(card.addr);
    try {
      const r = await hc(["read", card.addr]);
      const s = r.code === 0 ? readScreen(r.stdout, Infinity) : null;
      if (!s || screenText(r.stdout) !== card.all || JSON.stringify(s.choices) !== JSON.stringify(card.choices)) {
        closeCard(card, "The screen changed");
        return "That screen has changed, so nothing was pressed.";
      }
      const k = await hc(["keys", card.addr, ...pressKeys(s.at, choice)]);
      if (k.code !== 0) return "It didn't go through.";
      update(card, { state: "answered", how: `Answered: ${card.choices[choice].label}` });
      this.last.delete(card.addr);
      return null;
    } finally {
      this.pressing.delete(card.addr);
    }
  }
}

// ---- the card --------------------------------------------------------------------------------

// The card's strips for an open screen: the CLI's words, each choice a row that presses it, and
// the terminal. opts: { who (whose screen: "Claude", "HERD-12"), links ([ctl] at the header's
// right), press(i, cx), toTerminal(cx) (none: no link), busy (a press on its way), error }.
export function screenStrips(card, opts = {}) {
  const id = card.id.replace(/[^\w-]/g, "_");
  const links = [...(opts.links ?? []), ...(opts.toTerminal ? [linkCtl(`scr-term-${id}`, "Answer in terminal", (cx) => opts.toTerminal(cx))] : [])];
  const out = [headStrip({ who: opts.who ?? card.cli, links }), { key: "title", kind: "title", text: `${card.cli} is waiting on its screen` }];
  if (card.words) out.push({ key: "words", kind: "detail", lines: card.words.split("\n"), clip: null });
  card.choices.forEach((c, i) => out.push({ key: `c${i}`, kind: "option", gap: i ? 1 : 8, num: i + 1, label: c.label, desc: c.description,
    disabled: Boolean(opts.busy), fn: opts.busy ? null : (cx) => opts.press?.(i, cx) }));
  if (opts.error) out.push({ key: "error", kind: "text", tone: "red", text: opts.error });
  return out;
}
