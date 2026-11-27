// Shared core: the source is core/screens.js; bin/sync-shared copies it into mods/chat/core/. Edit it here.
// A CLI's own startup screens and in-session dialogs, shown as cards that open its terminal.
// No hook reports these, so the screen is read: two matching reads a poll apart put a card up, and the card opens the
// terminal for the person to answer there (Shepherdr never presses keys in an agent's screens). A screen with
// nothing to choose makes no card (it may be a slow start), unless a card came before and this one holds a link (a
// sign-in). After startup, only a reported question or a visible active dialog makes a card.
// A card: { id, addr, cli, words, choices: [{ label, description? }], at (the cursor's choice), all (screenText),
// seen (sameScreen), state: "open" | "answered" | "closed", how, opened, changed }.

// ---- reading a screen ------------------------------------------------------------------------

const MARKER = /^(\s*[❯›▶►➤→>]\s+)(.*)$/u;
const TICK = /^[✔✓]\s+/u;
const NUMBER = /^\d{1,2}[.)]\s+/;
const ENTER = /press (?:enter|return)|(?:enter|return) to continue/i;
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

// The menu lowest on the screen, for it is the one in play: a line with the CLI's cursor mark and at least one
// sibling beside it.
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
// The screen as it is, all but what moves with no one touching the words: the menu's cursor and a spinner's frame. A
// press needs this to match what the card was drawn from.
export function screenText(text) {
  const lines = String(text ?? "").split("\n"), plain = cleaned(text), cursor = cursorLine(plain);
  if (cursor >= 0) { const mark = plain[cursor].search(/\S/); lines[cursor] = `${lines[cursor].slice(0, mark)} ${lines[cursor].slice(mark + 1)}`; }
  return lines.map((line) => line.replace(SPINNER, "$1 ").trimEnd()).join("\n");
}

// ---- watching agents that are starting ---------------------------------------------------------

const FIRST_LOOK = 6000;  // an agent this young may just be slow
const RETRY = 10000;      // a pressed choice has this long to leave the screen before it's asked again
export const KEEP = 6;    // closed cards kept per agent (their quiet lines)
export const CLI = { claude: "Claude Code", codex: "Codex" };

// Which CLI a terminal runs: { claude | codex } from its report or its program, else null.
export function cliOf(k) {
  const a = String(k?.status?.app ?? k?.agent ?? k?.foreground?.name ?? "");
  return /^claude/.test(a) ? "claude" : /^codex/.test(a) ? "codex" : null;
}

// Still before its session: live, no status reported, no turn taken. (hc ls's `status` is the report's state word,
// or null.)
export function starting(k) {
  const st = typeof k?.status === "string" ? k.status : k?.status?.state ?? null;
  return Boolean(k) && k.state === "live" && !st && !(k.turn > 0) && Boolean(cliOf(k));
}

export function mayHaveDialog(k) {
  return k?.state === "live" && !!cliOf(k) && !starting(k);
}

const DIALOG_FOOTER = /^(?:(?:enter|press enter|esc|escape|tab)\b|[↑↓]).*\b(?:confirm|select|cancel|deny|continue|close|dismiss|skip|submit|choose|navigate)\b/i;
const BASH_CONFIRM = /can(?:not|'t|’t) (?:safely parse|parse .* safely)/i;

function dialogScreen(text, k) {
  const lines = cleaned(text).slice(-40);
  const line = cursorLine(lines);
  if (line >= 0) {
    const menu = menuAt(lines, line);
    const end = menu.options.at(-1).line + 1;
    const after = lines.slice(end).map((l) => l.trim()).filter(Boolean);
    const before = wordsAbove(lines, menu.top, MOST_WORDS);
    // A menu in scrollback does not count once the normal input prompt is visible below it.
    if ((after.length <= 3 && after.some((l) => DIALOG_FOOTER.test(l)) && !after.some((l) => /^[❯›>](?:\s|$)/.test(l))) ||
        (!after.length && BASH_CONFIRM.test(before))) {
      return lines.slice(Math.max(0, menu.top - MOST_WORDS), end).join("\n");
    }
  }
  const last = lines.findLastIndex((l) => l.trim());
  if (/^press (?:enter|return) to continue[.!]?$/i.test(lines[last]?.trim() ?? ""))
    return lines.slice(Math.max(0, last - MOST_WORDS), last + 1).join("\n");
  const st = k.status;
  if (st?.state === "blocked" && ["permission", "question", "prompt"].includes(st.kind)) return "";
  return null;
}

// The words a start screen's card says: its title, how a press went, how it closed.
export const SCREEN = {
  title: (cli) => `${cli} is waiting on its screen`,
  dialog: (cli) => `${cli} is waiting for an answer`,
  answered: (label) => `Answered: ${label}`,
  inTerminal: "Answered in the terminal",
  stopped: "The agent stopped",
  changed: "The screen changed",
  gone: "This screen is no longer waiting.",
  changedNothing: "That screen has changed, so nothing was pressed.",
  failed: "It didn't go through.",
  ended: (cli, how, dialog = false) => `${cli}'s ${dialog ? "dialog" : "start screen"} · ${how}`,
};

// A CLI's folder-trust screen (#1441): Claude Code's "Quick safety check" / "Do you trust the files in this folder?" (its
// Enter on the wrong choice exits), Codex's "Do you trust the contents of this directory?". The person's choice every
// time: { yes, no } (the screen's own choice for each, wherever its cursor is) and the folder it names, else null.
const TRUST_WORDS = /Quick safety check|Do you trust the files in this folder|trust this folder|Do you trust the contents of this directory|allow Codex to work in this folder/i;
export function trustOf(card) {
  if (!card || !TRUST_WORDS.test(`${card.all ?? ""}\n${card.words ?? ""}`)) return null;
  const labels = (card.choices ?? []).map((c) => String(c.label ?? ""));
  const yes = labels.findIndex((l) => /^yes\b/i.test(l)), no = labels.findIndex((l) => /^no\b/i.test(l));
  if (yes < 0 || no < 0) return null;
  const folder = cleaned(card.all).map((l) => l.trim()).find((l) => /^(\/|~\/|~$|[A-Z]:\\)\S*$/.test(l)) ?? null;
  return { yes, no, folder };
}
// The trust card's words: plain, the same on the web card, the phone and the watch.
export const TRUST = {
  title: "Trust this folder?",
  waits: (cli, folder) => `${cli} won't start${folder ? ` in ${folder}` : " here"} until you trust this folder.`,
  allows: "Trusting it lets the folder's project settings and hooks run.",
  yes: "Trust this folder and start",
  no: (task) => (task ? "No, stop the task" : "No, close it"),
  // on a notification's or a watch's button (24 characters at most)
  yesShort: "Trust and start",
  noShort: (task) => (task ? "No, stop it" : "No, close it"),
};

// Watches agents' screens: one per chat copy (the window's) or one for the web app (the service's). io: { hc(args)
// -> { code, stdout }, cards(addr) -> [card], save(addr, list) }. tick(addr, k) every couple of seconds while the agent
// is starting; it says (through onPost) when it put a new card up, for the alert.
export class ScreenWatch {
  constructor(io, onPost) {
    this.io = io;
    this.onPost = onPost;
    this.last = new Map();
    this.looking = new Set();
  }

  open(addr) { const c = this.io.cards(addr).at(-1); return c?.state === "open" ? c : null; }
  update(card, change) { this.io.save(card.addr, this.io.cards(card.addr).map((c) => (c.id === card.id ? { ...c, ...change, changed: Date.now() } : c))); }
  // A card gone with no press on it: `how` says why.
  close(card, how) { this.update(card, { state: "closed", how }); }

  // k: the terminal as hc get has it (created_ms, cols) or the live list's entry.
  async tick(addr, k, now = Date.now(), alreadyCarded = false) {
    const was = this.open(addr);
    const start = starting(k);
    if (alreadyCarded || (!start && !mayHaveDialog(k))) {
      this.last.delete(addr);
      // Its session started (it reports, or took a turn), or it ended: the card's wait is over.
      if (was) this.close(was, k?.state === "live" ? SCREEN.inTerminal : SCREEN.stopped);
      return;
    }
    if (this.looking.has(addr)) return;
    this.looking.add(addr);
    try {
      // The live list doesn't say when it started or how wide it is: hc get does.
      if (k.created_ms === undefined) { try { k = { ...JSON.parse((await this.io.hc(["get", addr, "--json"])).stdout || "{}"), ...k }; } catch {} }
      if (k.created_ms && now - k.created_ms < FIRST_LOOK) return;
      const r = await this.io.hc(["read", addr]);
      if (r.code !== 0) return;
      const text = start ? r.stdout ?? "" : dialogScreen(r.stdout ?? "", k);
      if (text === null) {
        this.last.delete(addr);
        if (was) this.close(was, SCREEN.inTerminal);
        return;
      }
      const dialog = !start;
      const seen = sameScreen(text), all = screenText(text), { words, choices, at } = readScreen(text, k.cols ?? Infinity);
      const shown = JSON.stringify([all, choices]);
      const before = this.last.get(addr);
      this.last.set(addr, { seen, shown });
      if (before?.seen !== seen) return; // still moving
      const cards = this.io.cards(addr), last = cards.at(-1);
      const open = last?.state === "open" && last.seen === seen ? last : null;
      // The same screen with a new code or number on it: a new card, so a press on the old one can't reach words it
      // didn't show.
      if (open && before.shown === shown && JSON.stringify([open.all, open.choices]) !== shown) { this.close(open, SCREEN.changed); this.post(addr, k, { seen, all, words, choices, at, dialog }); return; }
      if (open || cards.some((c) => c.seen === seen && now - (c.changed ?? c.opened) < RETRY)) return;
      if (last?.state === "open") this.close(last, SCREEN.inTerminal);
      if (!dialog && !choices.length && !(words && cards.length && /https?:\/\//.test(text))) return;
      this.post(addr, k, { seen, all, words, choices, at, dialog });
    } finally {
      this.looking.delete(addr);
    }
  }

  post(addr, k, s) {
    const card = { id: `scr-${addr}-${Date.now()}`, addr, cli: CLI[cliOf(k)] ?? "The agent", ...s, state: "open", opened: Date.now() };
    this.io.save(addr, [...this.io.cards(addr), card].slice(-KEEP));
    this.onPost?.(card);
  }
}
