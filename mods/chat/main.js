// Chat: an agent's conversation as a chat, read from the agent's own session log, with a
// box to write to it. The agent keeps running in its terminal; this only shows it another way.
// Opened by the `pane-chat` header's Chat / Terminal switch in the agent pane's spot: the
// agent's terminal is parked (running, without a pane) while this shows.
// Props: { terminal }: the agent's address ("t7", or "vps/t7" on another machine). After a
// restart from here the chat follows the new agent: it carries herdr.chat.origin=<props terminal>.
// Or, a chat with no agent yet (a space's Coordinator tab, made by mods/coordinator):
// { role: "coordinator", template, space, folder, slot }. Its first message starts the agent
// (the template) parked behind this chat with that message as its task; shared
// "coordinator.slots"[slot] = { space, tab, pane, folder } says which pane and tab it is. When
// that agent ends, the chat is empty again.
//
// The box takes pasted or dropped files (attach.js), suggests slash commands (slash.js),
// dictates (dictate.js) and keeps an unsent draft per agent in data/chat-drafts. Under it,
// the model button says what the agent runs on and opens a picker (mods/chat-models) to restart it with other
// choices (agent.js). A voice call (voice.ts, run beside the app) talks about this chat.
// Hovering a message shows its actions in a small bar over its top corner: react, reply (quote),
// copy, and rewind (the CLI's own) or fork.
// As Shepherdr's chat (docs/chat.md): a CLI stopped on its own first screen (trust, theme, sign
// in) shows it as a card to answer here (screens.js; a task worker's also in its Assistant's
// chat); an agent whose resumed session is gone starts a new one by itself (lostSession());
// /model opens the model picker instead of reaching the CLI; long replies fold with Show more;
// a day's line (Today, Yesterday, ...) goes where a new day starts.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, Scrollbar, VirtualListScrollHandle, TextView, v_virtual_list, InputState, Input } from "gpui-base";
import { focused, props, run, theme, home, hc, exec, shared, setShared, watchFolder, window, settings, playSound, notify, appHome, readTextFile, writeTextFile, nextCommand, openOverlay, knownAgents, machines } from "herdr";
import { agents, panes, terminals, spaces, inRender } from "./live.js";
import * as fs from "fs/promises";
import { FIND, LOG, Conversation, records, resultText, summary, excerpt, names } from "./core/chat-log.js";
import { BgJobs } from "./core/bg-jobs.js";
import { words, howAnswered } from "./core/asks.js";
// The rows' words and rules the web app's chat draws by too (core/chat-view.js).
import { WORDS, clock, senderName, briefLabel, newsWords, resolveArtifacts, unsigned, fitThumbs, bandActs, imagesLine, questionsBelow, notSent, published, artifactLine, elapsed, LOST, lostMessage, shellWord, sessionStarted, sessionFailed } from "./core/chat-view.js";
// Sending the person's words, as the web app does (core/send.js).
import { refusal, taskTag, messageBody, replyInstead, steerNow, reactionLine, mentionedIn } from "./core/send.js";
import { AskCards, linkCtl } from "./cards.js";
import * as strips from "./strips.js";
import { button, red, green, amber, H, RADIUS, TEXT, toast, toastWho, plainError } from "./ui.js";
import { openViewer, noteChatArea } from "./artview.js";
import { SecretCards } from "./secret-card.js";
import * as secrets from "./secrets.js";
import { taskDot, ownProgress } from "./dot.js";
import * as attach from "./attach.js";
import * as slash from "./slash.js";
import * as agent from "./agent.js";
import * as choices from "./settings.js";
import { Dictation } from "./dictate.js";
import { PanelHost, inner, openTaskThread, backToTasks, requestWorkerTerminal, THREAD } from "./panel.js";
import { markRead, onScreen, unread } from "./unread.js";
import { notifies } from "./notify.js";
import { ScreenWatch, screenStrips, openCard, cardsOf, starting, cliOf } from "./screens.js";
import { dayLabel, dayOf } from "./days.js";
import { on as addonOn } from "./addons.js";

// Messages a page of history holds: the newest page first, earlier ones as the person scrolls up.
const PAGE = 200;
// At most this many log records (and opened tool outputs) kept in memory per chat: past it, the
// oldest go (scrolling to the top reads them again).
const KEEP = 2000;
// The conversation's width at most, in px: lines stay readable in a wide pane.
const COLUMN = 760;
const KINDS = { "claude-code": "claude", ...Object.fromEntries(agent.AGENTS.map((k) => [k, k])), ...Object.fromEntries(agent.AGENTS.map((k) => [agent.KINDS[k].run[0], k])) };
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// The role templates' folder on the machine a command runs on (sh -c prefix: $dir).
const TEMPLATE = 'dir="$HOME/.config/herdr-core/templates"; ';
// Whether a machine's layout is here now (it's connected); this computer always is.
const online = (machine) => !machine || machines().find((m) => m.name === machine)?.layout === "ready";
const same = (a, b) => norm(a) === norm(b);
// When an ask was made: its id is <terminal>.<seconds>.<pid> (ask-hook.sh), taken at the end of
// that second so it sits after what was said in it.
const askAt = (id) => { const p = String(id).split("."); const sec = Number(p[p.length - 2]); return Number.isFinite(sec) && sec > 1e9 ? sec * 1000 + 999 : Date.now(); };
// A space's Assistant (its coordinator), whose alerts follow the space's Notify.
const assistant = (k) => k?.labels?.["herdr.role"] === "coordinator";
// Why hc didn't do it: { kind, message } from its JSON error ("blocked": a dialog is open), else its words.
// The composer's round buttons (Send, Call, End call, mic, Mute), and the height of its text row
// (one line of the box), which the call's row keeps so nothing moves when a call starts.
const ROUND = 28, TEXT_ROW = 34;
// Image thumbnails: the box's files are squares this many px, this far apart; under sent
// messages each image keeps its shape, fitted in THUMB_ONE (one image) or THUMB_MANY (w, h).
const THUMB = 56, THUMB_GAP = 6;
// The live row's level wave: each bar's width and the gap between bars, in px.
const WAVE_BAR = 3, WAVE_GAP = 2;
// ONE row under each message, its band (a list row of its own), on the message's side (left
// for the agent, right for the person), in this order: the time (dim), reply, copy, rewind or
// fork; then on the agent's the reaction pills and the smiley to add one, furthest right, and
// on the person's the smiley and then the pills, furthest right (flush under the bubble's
// edge). The pills always show; the rest only while the pointer is on the message, in room
// that is always kept, so nothing moves. barLayout() places every part; hitBar() reads the
// same places.
// One even rhythm on a 4 px scale (spaced()): under every message its band, always kept: BAND_IN
// of air under the bubble, then the actions' row (ACT tall, pills or not). Then every block (a
// message with its band, a run of quiet lines, a card) is GAP from the next, so the row never
// touches what follows and the room above a bubble is the room after a row.
const ACT = 22, ACT_GAP = 2, BAND_IN = 4, ACT_ROW = BAND_IN + ACT, GAP = 16;
// Quiet lines (tools, "Message from …", artifact lines) sit tight: each is its line with QUIET_PY
// above and below (a tools row's hover box), no more. QUIET_IN: how far their words' ink sits
// inside the row's top and bottom edges (QUIET_PY, then the small text's own leading; the
// baseline sits a little higher than the caps sit low), measured from the window.
const QUIET_PY = 1, QUIET_IN = { top: 5, bottom: 6 };
// A long reply folds (Show more) when it would run past FOLD_TALL lines, to its first FOLD
// lines; LINE_H is a reply's line in px. Its words are measured as they draw, so one that
// turns out shorter than it looked isn't folded after all.
const FOLD = 20, FOLD_TALL = 28, LINE_H = 21;
// A session that is gone (LOST), what the new agent hears (lostMessage) and the chat's note: core/chat-view.js, as
// the service restarts one for the web app.
// The picker's row a typed name means (/model sonnet, /model claude-opus-5-5, /model gpt-5):
// { agent, model }, or null. `menus`: agent.js menuFor() per agent.
function findModel(menus, name) {
  const n = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9.]+/g, "");
  const qs = [n(name), n(agent.modelName(name))];
  const rows = Object.entries(menus ?? {}).flatMap(([a, m]) => (m?.models ?? []).map((r) => ({ agent: a, model: r.id, keys: [n(r.id), n(r.name)] })));
  const hit = rows.find((r) => r.keys.some((k) => qs.includes(k))) ?? rows.find((r) => r.keys.some((k) => qs.some((q) => q && k.startsWith(q))));
  return hit ? { agent: hit.agent, model: hit.model } : null;
}
// About how many lines words take at a width (px), for a row's height before it's measured.
const wrapLines = (text, width) => String(text ?? "").split("\n").reduce((n, l) => n + Math.max(1, Math.ceil((l.length * 7) / Math.max(120, width))), 0);
const ICONS = { copy: "copy", reply: "reply", rewind: "rewind", fork: "git-fork", react: "smile-plus" };
// Reaction pills: this wide, this far apart; and the gap before the first and after the last.
const PILL = 46, PILL_GAP = 4, PILL_EDGE = 6;
// A task's id as shown and typed: herdr-task's PREFIX-n (`ref`, e.g. HAT-1), else #n.
const taskRef = (x) => (x?.ref ? String(x.ref) : `#${x?.id}`);
// Task chips under a message: this wide, this far apart.
const TASK = 170, TASK_GAP = 6;
// A Ready task's news line: its Accept, this wide, at the line's right end.
const ACCEPT = 64;
// The picker's Frequently used before there is any history.
const FREQUENT = ["👍", "👎", "❓", "✅", "👀", "🎉", "❤️", "🔥", "🙏"];
const safe = (s) => String(s).replace(/[^\w.-]/g, "_");
// Threads (openThread()): shared "chat.threads" = { [pane]: { terminal, task, title } }, only
// panes still there; and the one showing a worker.
const threads = () => Object.fromEntries(Object.entries(shared("chat.threads") ?? {}).filter(([p]) => panes().some((x) => x.pane === p && x.mod === "chat")));
const threadOf = (terminal) => Object.entries(threads()).find(([, v]) => v?.terminal === terminal)?.[0] ?? null;
// How a card's answer went, for its quiet line ("Allowed in the chat"); null for no decision
// (the terminal asks instead).

// An answer to a waiting hook (ask-hook.sh prints it as Claude's decision), the one way every
// copy of a card delivers. First how it went (the hook's end/<id>), for the ask's other copies:
// they read it once the request is gone.
async function answerAsk(dir, id, text, how) {
  if (how) await writeTextFile(`${dir}/end/${id}`, `${how}\n`, null).catch(() => {});
  await writeTextFile(`${dir}/ans/${id}.json`, text, null).catch(() => {});
}
// The person's words keep the line breaks they typed: markdown joins single lines, so each one
// becomes a hard break (outside code fences, which keep theirs).
const typed = (text) => String(text).split(/(```[\s\S]*?(?:```|$))/).map((part, i) => (i % 2 ? part : part.replace(/([^\n])\n(?!\n)/g, "$1  \n"))).join("");

// An agent message in parts: markdown, and fenced code blocks (drawn with a Copy bar).
function parts(text) {
  const out = [];
  const re = /^```([^\n`]*)\n([\s\S]*?)\n```[ \t]*$/gm;
  let at = 0, m;
  while ((m = re.exec(text))) {
    const before = text.slice(at, m.index).trim();
    if (before) out.push({ type: "md", text: before });
    out.push({ type: "code", lang: m[1].trim(), code: m[2] });
    at = m.index + m[0].length;
  }
  const rest = text.slice(at).trim();
  if (rest) out.push({ type: "md", text: rest });
  return out;
}

let bound = false;

export default class Chat extends View {
  init(_props, cx) {
    // The Tasks panel's drill-in view (props { panel: true }): its header (props { head: true })
    // and its body, a nested Chat for the task's worker, made with its own props ({ inner: true,
    // thread: true, terminal, ... }).
    if (props()?.panel === true && !_props?.inner) { this.host = new PanelHost(Chat, props()?.head === true); return; }
    this.inner = _props?.inner === true;
    if (this.inner) inner.chat = this;
    const P = this.inner ? _props : props();
    this.origin = P?.terminal ?? null;
    this.addr = this.origin;
    // No agent yet (a Coordinator tab): it may have started one already (this slot's label).
    this.role = P?.role ?? null;
    this.slot = P?.slot ?? null;
    // A thread: a task worker's chat, in the Tasks panel ({ terminal, thread: true, task,
    // title }). The same conversation, box and cards, but only a view: it never claims the
    // worker's herdr.chat, never gives it a pane, and leaving it leaves the worker running.
    this.thread = P?.thread === true;
    // A task whose agent ended (the Tasks list's click): its conversation from that agent's own
    // log, kept by herdr-task ({ path, kind }), and the task ({ machine, folder, slug, id }) for
    // its Resume.
    this.endedLog = this.thread ? P?.log ?? null : null;
    this.taskKey = this.thread ? P?.key ?? null : null;
    // Its task's id (HERD-12), for the box's "Message HERD-12".
    this.taskRef = P?.task ?? null;
    // Tells the Tasks panel threads can be asked for (shared "chat.threadreq").
    if (shared("chat.threads.v") !== 1) setShared("chat.threads.v", 1);
    if (!this.addr && this.role && this.slot) this.addr = this.slotAgent();
    this.machine = this.addr?.includes("/") ? this.addr.split("/")[0] : null;
    this.phase = "finding";
    this.conv = null;
    this.path = null;
    this.reset();
    this.pending = [];
    this.opened = new Set();
    this.results = new Map();
    this.pinned = true;
    this.width = 600;
    this.heights = new Map();
    // When each row's height was first measured: kept measuring a few seconds after (measurer).
    this.measuredAt = new Map();
    this.heightsFor = 0;
    // Bumped whenever the heights are forgotten: the measuring boxes get new ids with it, so
    // each reports its size again. A box that kept its id reports only a change, and a row
    // whose height came out the same at the new width then stayed on its guess (squeezed).
    this.measureGen = 0;
    this.range = null;
    this.scroll = VirtualListScrollHandle.new();
    // Its placeholder is drawn by composer(): it changes while a card asks ("Reply instead…").
    this.box = TextareaState.new({ placeholder: "" });
    this.box.set_rows(1);
    // Ctrl+Enter (the textarea's secondary submit): held until the agent is free.
    this.box.on("submit", (e, cx) => { if (!e?.shift) this.enter(cx, Boolean(e?.secondary)); });
    this.box.on("focus", (_e, cx) => { this.focused = true; noteChatArea(this.areaKey(), { focus: true, at: Date.now() }); cx.notify(); });
    this.box.on("blur", (_e, cx) => { this.focused = false; noteChatArea(this.areaKey(), { focus: false, at: Date.now() }); cx.notify(); });
    this.box.on("change", (_e, cx) => {
      // A big paste (over 8 KB or 200 lines) becomes a text file to send, not text in the box.
      const was = this.lastValue ?? "", now = this.box.value();
      this.lastValue = now;
      if (now.length - was.length > 8192 || now.split("\n").length - was.split("\n").length > 200) {
        let a = 0;
        while (a < was.length && was[a] === now[a]) a++;
        let b = 0;
        while (b < was.length - a && was[was.length - 1 - b] === now[now.length - 1 - b]) b++;
        const pasted = now.slice(a, now.length - b);
        const rest = was.slice(0, a) + was.slice(was.length - b);
        this.box.set_value(rest);
        this.lastValue = rest;
        cx.spawn(async (cx) => { const f = await attach.textFile(pasted); if (f) { this.addFiles([f]); this.saveSoon(cx); cx.notify(); } });
        return;
      }
      // Copied files pasted as text (file:// lines) become attachments.
      const v = this.box.value();
      if (/^file:\/\/\S/m.test(v)) {
        const found = v.split("\n").filter((l) => /^file:\/\/\S+$/.test(l.trim())).map((l) => decodeURIComponent(l.trim().slice(7)));
        this.addFiles(attach.paths(found));
        this.box.set_value(v.split("\n").filter((l) => !/^file:\/\/\S+$/.test(l.trim())).join("\n"));
      }
      this.slashSel = 0;
      // Editing a recalled message makes it a new one: arrows move in it again.
      if (this.recall >= 0 && this.box.value() !== this.recalled) this.recall = -1;
      this.sizeBox();
      this.saveSoon(cx);
      cx.notify();
    });
    // A paste with no text: the clipboard's image or copied files become attachments.
    this.box.on("paste_other", (_e, cx) => cx.spawn(async (cx) => {
      const got = await attach.fromClipboard().catch(() => []);
      if (got.length) { this.addFiles(got); this.saveSoon(cx); cx.notify(); }
    }));
    this.wasFocused = false;
    // Up/Down/Tab/Escape reach the textarea first, which keeps them. While the "/" list shows
    // (chat_slash) or the box is empty or showing a recalled message (chat_recall), these
    // bindings turn them into this chat's own actions instead (on_action in composer()).
    if (!bound) {
      bound = true;
      const keys = [];
      for (const ctx of ["Input", "TextArea", "Textarea"]) {
        keys.push({ keystroke: "up", action: "chat_slash_up", context: `chat_slash > ${ctx}` },
          { keystroke: "down", action: "chat_slash_down", context: `chat_slash > ${ctx}` },
          { keystroke: "tab", action: "chat_slash_take", context: `chat_slash > ${ctx}` },
          { keystroke: "escape", action: "chat_slash_close", context: `chat_slash > ${ctx}` },
          { keystroke: "escape", action: "chat_stop", context: `chat_stop > ${ctx}` },
          { keystroke: "escape", action: "chat_find_close", context: `chat_find > ${ctx}` },
          { keystroke: "enter", action: "chat_find_next", context: `chat_find > ${ctx}` },
          { keystroke: "shift-enter", action: "chat_find_prev", context: `chat_find > ${ctx}` },
          { keystroke: "up", action: "chat_recall_up", context: `chat_recall > ${ctx}` },
          { keystroke: "down", action: "chat_recall_down", context: `chat_recall > ${ctx}` });
      }
      try { cx.bind_keys(keys); } catch {}
    }
    // Asks from Claude's PermissionRequest hook (ask-hook.sh), oldest first: { id, req, words }.
    this.asks = [];
    this.askDir = `${appHome()}/data/chat-asks`;
    // Asks that closed, each a quiet line in the conversation saying how ("Answered in the
    // terminal"): { id, title, how, at }. Kept per agent across reloads.
    this.askEnds = [];
    // The box's extras: files to send, a quoted message, messages held until the agent is free.
    this.files = [];
    this.quote = null;
    this.queue = [];
    this.recall = -1;
    this.slashSel = 0;
    this.slashOff = null;
    this.cmds = [];
    this.copied = null;
    this.note = null;
    this.dflt = null;
    this.argv = null;
    this.call = null;
    this.press = null;
    this.views = {};
    this.myReacts = new Map();
    // Words written in the box while a card asked, which answered it: shown as the person's,
    // after the conversation item that was last when they went ({ id, text, after }).
    this.replied = [];
    // Question cards: their state per ask, and the keyboard for their arrows and digits.
    this.cards = new AskCards({
      reply: (ask, text, cx) => this.reply(ask, text, cx),
      toTerminal: () => this.toTerminal(),
      chatAbout: () => this.box.focus(),
    }, cx.focus_handle());
    // An Assistant's chat: its tasks' workers' asks on the same cards (workerAsks()). Shown ones
    // by id, the requests being read, those answered here (until the hook lets them go).
    this.workerCards = new AskCards({
      reply: (ask, text, cx) => this.replyWorker(ask, text, cx),
      toTerminal: (ask) => { openTaskThread(ask.terminal, ask.ref, ask.title); requestWorkerTerminal(ask.terminal); },
      chatAbout: (ask) => openTaskThread(ask.terminal, ask.ref, ask.title),
    }, cx.focus_handle());
    this.shownAsks = new Map();
    // Secrets agents ask for (herdr-secret ask): their masked cards, here and for the workers.
    this.secretCards = new SecretCards();
    // Kept or declined here: its quiet line, where its card was.
    this.secretCards.onEnd = (ask, how) => this.secretEnded(ask, how);
    // Cards' controls by id: their drawn widths, for which one a press was on (strips.js hit()).
    this.cardW = new Map();
    this.readingAsks = new Set();
    this.answeredAsks = new Set();
    // Ready tasks being accepted from their live rows (by ref).
    this.accepting = new Set();
    // CLI start screens (screens.js): this agent's, and in an Assistant's chat its workers'.
    // A press on its way, and why one didn't go, by card.
    this.screens = new ScreenWatch((card) => this.screenAlert(card));
    this.screenBusy = new Set();
    this.screenErr = new Map();
    // Agents whose lost session this chat already started again (lostSession()).
    this.lostTried = new Set();
    // Long replies opened with Show more (by message id), and their words' drawn height.
    this.unfolded = new Set();
    this.natural = new Map();
    // Find in the chat (Ctrl+F): open, the current match.
    this.finding = false;
    this.findIdx = 0;
    this.findBox = InputState.new({ placeholder: WORDS.find });
    this.findBox.on("change", (_e, cx) => { this.findIdx = 0; this.findJump = true; cx.notify(); });
    // "Show thinking" is gone: so is its stored setting.
    if (shared("chat.showThinking") != null) cx.timer.after(0, () => setShared("chat.showThinking", null));
    this.uses = {};
    cx.spawn(async (cx) => {
      try { this.uses = JSON.parse(await fs.readFile(`${appHome()}/data/chat-emoji-uses.json`, "utf8")) ?? {}; } catch {}
      cx.notify();
    });
    this.viewAsked = new Set();
    this.callReqAt = shared("chat.callreq")?.at ?? null;
    this.restartReqAt = shared("chat.restartreq")?.at ?? null;
    this.reactReqAt = shared("chat.reactreq")?.at ?? null;
    this.sendReqAt = shared("chat.sendreq")?.at ?? null;
    this.startReqAt = shared("chat.startreq")?.at ?? null;
    // The working line's clock, once a second while the agent works; the rows over the box (its
    // subagents, its background shells) count seconds for their first minute, then minutes.
    let ticks = 0;
    cx.timer.every(1000, (cx) => {
      if (this.call) return;
      ticks++;
      const rows = [...this.helpers(), ...this.jobs()];
      if (this.status() === "working" || rows.some((r) => Date.now() - (r.at ?? 0) < 61000) || (rows.length && ticks % 30 === 0)) cx.notify();
    });
    // An Assistant's chat keeps its tasks current for their news lines (newsLines()): herdr-task's own
    // statuses, the same as the Tasks panel's and the news it sends.
    cx.timer.every(8000, (cx) => {
      if (!this.assistant() || this.tasksLoading) return;
      this.tasksLoading = true;
      cx.spawn(async (cx) => {
        const was = this.taskSig();
        try { await this.loadSpaceTasks(); } finally { this.tasksLoading = false; }
        if (this.taskSig() !== was) cx.notify();
      });
    });
    // ... and its workers' start screens and lost sessions, as their own chats would (those are
    // seldom open): only workers that look starting, or that ended at a shell after a resume.
    cx.timer.every(2500, (cx) => {
      if (!this.assistant() || this.workersLooking) return;
      const by = this.workerTasks();
      const look = terminals().filter((k) => by.has(k.address) && (starting(k) || openCard(k.address) || this.lostCandidate(k)));
      if (!look.length) return;
      this.workersLooking = true;
      cx.spawn(async (cx) => {
        try {
          for (const k of look) {
            if (this.lostCandidate(k)) await this.checkLost(k.address, cx);
            else await this.screens.tick(k.address, k);
          }
        } finally { this.workersLooking = false; }
        cx.notify();
      });
    });
    // In a call the box is the call: this handle takes its keys (M mutes).
    this.callFocus = cx.focus_handle();
    // Drafts and dictation belong to the agent's first address (its origin), so they survive
    // Chat ⇄ Terminal, restarts from here, and app restarts.
    const labels = terminals().find((x) => x.address === this.addr)?.labels ?? {};
    this.originKey = labels["herdr.chat.origin"] || (this.slot ? `slot:${this.slot}` : null) || this.addr || "none";
    this.typing = labels["herdr.typing"] ? { addr: this.addr, at: Number(labels["herdr.typing"]) || 0 } : null;
    this.dict = new Dictation(this.originKey);
    this.draftFile = `${appHome()}/data/chat-drafts/${safe(this.originKey)}.json`;
    if (!this.addr && this.role) this.phase = "fresh";
    if (this.phase === "fresh") this.loadChoice(cx);
    if (this.slot) cx.spawn(async (cx) => { this.firstTask = await fs.readFile(this.firstFile, "utf8").catch(() => null); cx.notify(); });
    if (this.addr || this.role) cx.spawn(async (cx) => { await this.loadDraft(cx); attach.prune(); });
    if (this.addr) cx.spawn(async (cx) => this.follow(cx));
    // A Coordinator tab's chat that missed its agent (started, or Herdr restarted, before this
    // copy saw it) takes the slot's live agent as soon as one shows, instead of staying empty.
    if (this.slot && !this.thread) cx.timer.every(2000, (cx) => this.adoptSlot(cx));
    // The list drew nothing while it has rows (scrolled past its end, a height gone wrong):
    // forget the heights and go to the newest again. Checked rarely; redraws only then.
    cx.timer.every(1500, (cx) => {
      if (!this.blank) return;
      this.blank = false;
      this.heights.clear(); this.measuredAt.clear(); this.measureGen++;
      this.anchor = null; this.pinned = true; this.stick = true;
      cx.notify();
    });
    if (this.addr && !this.machine) cx.spawn(async (cx) => this.watchAsks(cx));
    // Keys (keys.json "mod:chat") and the header's buttons (pane-chat) for this chat.
    // At most 5 s per wait (one pending nextCommand), so a reload's old build ends at its next
    // cx use instead of staying in memory.
    cx.spawn(async (cx) => {
      let cmd = null;
      for (;;) {
        cmd ??= nextCommand();
        const c = await Promise.race([cmd, cx.sleep(5000)]);
        if (c === undefined) continue;
        cmd = null;
        // From the shell: data/chat-sendreq.json = { pane, text, files? }, then `herdr-app do
        // chat.send` (with fill: true, the words go into the box instead; with thread:
        // { terminal, task, title }, that worker's thread opens beside this chat).
        if (c === "send") {
          const f = `${appHome()}/data/chat-sendreq.json`;
          let req = null;
          try { req = JSON.parse(await fs.readFile(f, "utf8")); } catch {}
          // The Tasks panel's chat has no pane: it answers to its layout block's id, and
          // { peek: true } opens its worker's terminal.
          const me = this.inner ? THREAD : this.myPane();
          if (req?.pane && req.pane === me && req.peek) {
            await fs.unlink(f).catch(() => {});
            this.toTerminal();
          } else if (req?.pane && req.pane === me && req.secret) {
            // { secret: true }: the keyboard goes to the first secret card's masked box.
            await fs.unlink(f).catch(() => {});
            // Taken in render, once the card's box is there (secret-card.js focus()).
            this.focusSecret = Date.now();
            cx.notify();
          } else if (req?.pane && req.pane === me && req.thread?.terminal) {
            await fs.unlink(f).catch(() => {});
            this.openThread(req.thread);
          } else if (req?.pane && req.pane === me && req.fill) {
            await fs.unlink(f).catch(() => {});
            const v = String(req.text ?? "");
            this.box.set_value(v);
            this.box.set_selected_range({ start: v.length, end: v.length });
            this.box.focus();
            cx.notify();
          } else if (req?.pane && req.pane === me && String(req.text ?? "").trim()) {
            await fs.unlink(f).catch(() => {});
            // files: paths to go with it, as a drop gives them.
            const files = attach.paths(Array.isArray(req.files) ? req.files.map(String) : []);
            this.deliver({ id: `m${Date.now()}`, text: String(req.text).trim(), files, quote: null }, cx);
            this.pinned = true;
            this.stick = true;
            cx.notify();
          }
          continue;
        }
        if (focused()?.pane !== this.myPane()) continue;
        // Voice off (Shepherdr settings > Window > Add-ons): its keys do nothing.
        if (c === "dictate" && addonOn("voice")) this.toggleDictation(cx);
        if (c === "call" && addonOn("voice")) this.toggleCall(cx);
        if (c === "mute") this.callMute(cx);
        if (c === "find") this.openFind(cx);
        cx.notify();
      }
    });
  }

  // Forget what was read: another log file, or this one replaced.
  reset() {
    this.records = [];
    this.start = null;
    this.end = 0;
    this.conv = null;
    // What the agent left running in the background (core/bg-jobs.js), the row opened, and the
    // last lines each printed (job id -> text, while open), the ones being stopped.
    this.bgJobs = new BgJobs();
    this.jobOpen = null;
    this.jobOut = new Map();
    this.jobStopping = new Set();
    this.anchor = null;
    this.loadingEarlier = false;
  }

  // Closing (back to the terminal, or the pane goes): the hook stops waiting on this chat, so
  // Claude asks in its terminal instead. A call or a recording ends with it.
  async close(cx) {
    if (this.host) return this.host.close(cx);
    this.box.release();
    this.findBox.release();
    this.scroll.release();
    this.dict.cancel();
    if (this.call) await this.hangup();
    if (!this.addr || this.machine) return;
    await exec("sh", ["-c", 'rm -f "$1/open/$2"; for f in "$1/req/$2".*.json; do [ -f "$f" ] && : > "$1/ans/${f##*/}"; done; true', "x", this.askDir, this.addr]);
  }

  // ---- drafts -----------------------------------------------------------------------------

  async loadDraft(cx) {
    const text = await fs.readFile(this.draftFile, "utf8").catch(() => null);
    let d = null;
    try { d = JSON.parse(text ?? "null"); } catch {}
    if (!d) return;
    if (d.text && !this.box.value()) this.box.set_value(d.text);
    this.files = Array.isArray(d.files) ? d.files : [];
    this.quote = d.quote ?? null;
    this.queue = Array.isArray(d.queue) ? d.queue : [];
    cx.notify();
  }

  saveSoon(cx) {
    this.saveAt = Date.now();
    cx.timer.after(400, (cx) => { if (Date.now() - this.saveAt >= 380) cx.spawn(async () => this.saveDraft()); });
  }

  async saveDraft() {
    const d = { text: this.box.value(), files: this.files, quote: this.quote, queue: this.queue };
    this.markTyping(!!(d.text.trim() || d.files.length || d.quote));
    const empty = !d.text.trim() && !d.files.length && !d.quote && !d.queue.length;
    try {
      if (empty) { if (await fs.exists(this.draftFile)) await fs.unlink(this.draftFile); return; }
      await fs.mkdir(`${appHome()}/data/chat-drafts`, { recursive: true });
      await fs.writeFile(this.draftFile, JSON.stringify(d));
    } catch {}
  }

  // While the box holds unsent words, its agent's terminal says so (herdr.typing=<ms>, again each
  // minute while they stay, removed once they're sent or cleared): Herdr's news and other
  // automatic messages wait for them (herdr-task's news.py, HERD-71).
  markTyping(on) {
    const addr = this.phase === "ended" ? null : this.addr, at = Date.now(), was = this.typing;
    if (on && addr && was?.addr === addr && at - was.at < 60000) return;
    if (!on && !was) return;
    this.typing = on && addr ? { addr, at } : null;
    if (was && was.addr && was.addr !== this.typing?.addr) hc(["label", was.addr, "herdr.typing="]).catch(() => {});
    if (this.typing) hc(["label", addr, `herdr.typing=${at}`]).catch(() => {});
  }

  addFiles(list) {
    for (const f of list) if (!this.files.some((x) => x.path === f.path)) this.files.push(f);
    this.files = this.files.slice(0, 20);
  }

  // ---- Claude's permission asks -------------------------------------------------------------

  // The hook's flag: this chat is showing. Touched every few seconds; stale after 15. From the
  // moment the chat knows its agent (not only once its conversation shows): an agent started
  // from here may ask in its first seconds, and without the flag the hook leaves it to the CLI.
  async flag() {
    if (this.machine || !this.addr || this.phase === "ended") return;
    await exec("sh", ["-c", 'mkdir -p "$1/open" "$1/req" "$1/ans" && touch "$1/open/$2"', "x", this.askDir, this.addr]);
  }

  async watchAsks(cx) {
    await exec("sh", ["-c", 'mkdir -p "$1/open" "$1/req" "$1/ans"', "x", this.askDir]).catch(() => {});
    for (;;) {
      await this.readAsks(cx);
      // One watch at a time, as for the log.
      this.askWatch ??= watchFolder(`${this.askDir}/req`).finally(() => { this.askWatch = null; });
      await Promise.race([this.askWatch, cx.sleep(5000)]);
    }
  }

  async readAsks(cx) {
    // Each request is named <terminal>.<time>.<hook pid>: one whose hook was killed (Claude or
    // Codex stopped it) is gone, so drop its file.
    const r = await exec("sh", ["-c", 'cd "$1/req" 2>/dev/null || exit 0; for f in "$2".*.json; do [ -f "$f" ] || continue; p=${f%.json}; p=${p##*.}; if kill -0 "$p" 2>/dev/null; then echo "$f"; else rm -f "$f"; fi; done; true', "x", this.askDir, this.addr]);
    const ids = r.stdout.split("\n").filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    const kept = this.asks.filter((a) => ids.includes(a.id));
    // Gone without an answer from here: the hook says how (data/chat-asks/end/<id>: answered
    // or declined in the terminal, the agent stopped), else Claude stopped waiting on it.
    for (const a of this.asks.filter((a) => !ids.includes(a.id))) {
      const how = (await readTextFile(`${this.askDir}/end/${a.id}`).catch(() => null))?.trim();
      this.askEnded(a, how || "No longer waiting");
    }
    let added = false;
    for (const id of ids) {
      if (kept.some((a) => a.id === id)) continue;
      const text = await readTextFile(`${this.askDir}/req/${id}.json`).catch(() => null);
      let req = null;
      try { req = JSON.parse(text ?? ""); } catch {}
      // Unreadable here: it can only be allowed in the terminal.
      const w = req ? words(req) : { kind: "permission", title: "Claude asks for something the chat can't read", detail: "", unread: true };
      kept.push({ id, req, words: w });
      added = true;
    }
    if (added || kept.length !== this.asks.length) {
      this.asks = kept;
      this.cards.keep(kept.map((a) => a.id));
      if (added) this.askAlert();
      cx.notify();
    }
  }

  // A new ask: the agent waits on the person, as when it's blocked.
  askAlert() {
    // A thread's worker alerts from its own tab's chat or the Inbox, not twice.
    if (this.thread) return;
    const mine = this.myPane();
    const looking = Boolean(mine) && focused()?.pane === mine && window()?.active;
    const k = terminals().find((x) => x.address === this.addr);
    if (assistant(k) && !notifies(k, "need")) return;
    if (settings()?.sounds?.enabled !== false) playSound("blocked");
    if (looking) return;
    const tab = mine && panes().find((p) => p.pane === mine)?.tab;
    toast({ title: `${toastWho(k)} · Needs you`, body: this.asks[0]?.words.title ?? "", level: "alert",
      action: tab ? { name: "tab.select", args: { id: tab } } : undefined });
  }

  // An ask closed: its quiet line. Questions have theirs from the log already (log.js "ask").
  askEnded(ask, how) {
    this.loadAskEnds();
    if (ask.words.kind === "questions" || this.askEnds.some((e) => e.id === ask.id)) return;
    this.askEnds = [...this.askEnds, { id: ask.id, title: ask.words.title, how, at: askAt(ask.id) }].slice(-20);
    try { localStorage.setItem(`askends:${this.addr}`, JSON.stringify(this.askEnds)); } catch {}
  }

  // This agent's closed asks, from before a reload.
  loadAskEnds() {
    if (this.askEndsOf === this.addr) return;
    this.askEndsOf = this.addr;
    try { this.askEnds = JSON.parse(localStorage.getItem(`askends:${this.addr}`) ?? "[]") ?? []; } catch { this.askEnds = []; }
  }

  // The card's answer goes to the waiting hook; it prints it as Claude's decision.
  reply(ask, text, cx) {
    this.asks = this.asks.filter((a) => a !== ask);
    const how = howAnswered(ask, text, "in the chat");
    if (how) this.askEnded(ask, how);
    cx.notify();
    // A task worker's ask may show in its Assistant's chat too: that copy reads how it went.
    cx.spawn(async () => answerAsk(this.askDir, ask.id, text, howAnswered(ask, text, this.thread || this.t?.labels?.["herdr.task"] ? "in the task's chat" : "in its chat")));
  }

  // ---- a task worker's asks (an Assistant's chat) ---------------------------------------------
  // The person's decision (DECISIONS, Tasks: "Answer from the Assistant's chat"): while a task's
  // worker asks (a permission, questions, a plan), its own card shows in the Assistant's chat
  // too, answerable there. The card sits in the timeline just under the task's needs-you line
  // (timelineCards()), headed by its task. One card per task (its oldest ask).
  // The Tasks panel's engine (inbox.js, run by the tab bar) keeps the hook asking for every
  // worker not on screen and lists the waiting requests: shared "inbox.asks" = [{ id, terminal }].
  // The answer goes as the worker's own chat sends it (answerAsk()); every copy then closes
  // with a quiet line saying how. Typing in the box still goes to the Assistant only.

  // This space's tasks by their agents' addresses.
  workerTasks() {
    const space = this.assistant(), out = new Map();
    if (!space || this.machine) return out;
    for (const x of this.spaceTasks ?? []) {
      if ((x.space ?? x.queue?.space) !== space || !x.ref) continue;
      for (const a of x.live ?? []) if (a.address && !out.has(a.address)) out.set(a.address, x);
    }
    return out;
  }

  // The worker asks to show now, one per task, in its rows' order. From render: a request not
  // read yet is read right after; one gone without an answer from here gets its quiet line.
  workerAsks(cx) {
    const by = this.workerTasks();
    const listed = (shared("inbox.asks") ?? []).filter((a) => by.has(a.terminal));
    const ids = new Set(listed.map((a) => a.id));
    for (const id of [...this.answeredAsks]) if (!ids.has(id)) this.answeredAsks.delete(id);
    const gone = [...this.shownAsks.values()].filter((a) => !ids.has(a.id));
    const unread = listed.filter((a) => !this.shownAsks.has(a.id) && !this.readingAsks.has(a.id));
    if (gone.length || unread.length) {
      for (const a of gone) this.shownAsks.delete(a.id);
      for (const a of unread) this.readingAsks.add(a.id);
      this.workerCards.keep([...this.shownAsks.keys(), ...unread.map((a) => a.id)]);
      cx.timer.after(0, (cx) => cx.spawn(async (cx) => {
        for (const a of gone) {
          if (a.answered) continue;
          const how = (await readTextFile(`${this.askDir}/end/${a.id}`).catch(() => null))?.trim();
          this.workerAskEnded(a, how || "No longer waiting");
        }
        for (const a of unread) {
          const x = by.get(a.terminal);
          let req = null;
          try { req = JSON.parse((await readTextFile(`${this.askDir}/req/${a.id}.json`).catch(() => null)) ?? ""); } catch {}
          const w = req ? words(req) : { kind: "permission", title: "Claude asks for something the chat can't read", detail: "", unread: true };
          this.readingAsks.delete(a.id);
          if ((shared("inbox.asks") ?? []).some((b) => b.id === a.id)) this.shownAsks.set(a.id, { id: a.id, terminal: a.terminal, req, words: w, ref: x.ref, title: x.title, at: Date.now() });
        }
        cx.notify();
      }));
    }
    const order = this.taskOrder ?? [];
    const rank = (a) => { const i = order.indexOf(a.ref); return i < 0 ? order.length : i; };
    const out = [];
    for (const a of [...this.shownAsks.values()].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1))) {
      if (!this.answeredAsks.has(a.id) && !out.some((b) => b.ref === a.ref)) out.push(a);
    }
    // A worker asking for a secret (secret-card.js): its masked card too, when it asks nothing else.
    for (const [address, x] of by) {
      for (const s of this.secretCards.items(address)) {
        if (!out.some((b) => b.ref === x.ref)) out.push({ id: `secret:${address}:${s.name}`, terminal: address, ref: x.ref, title: x.title, words: { kind: "secret", title: `Secret: ${s.name}` }, secret: s });
      }
    }
    return out;
  }

  // Answered on its card here: the same delivery as the worker's own chat (answerAsk()).
  replyWorker(ask, text, cx) {
    this.answeredAsks.add(ask.id);
    ask.answered = true;
    const how = howAnswered(ask, text, "here");
    if (how) {
      // Questions say what was answered (the worker's log isn't in this chat).
      let picked = "";
      try { picked = Object.values(JSON.parse(text).hookSpecificOutput?.decision?.updatedInput?.answers ?? {}).join("; "); } catch {}
      this.workerAskEnded(ask, picked ? `${how}: ${picked}` : how);
    }
    cx.notify();
    cx.spawn(async () => answerAsk(this.askDir, ask.id, text, howAnswered(ask, text, "in the Assistant's chat")));
  }

  // A worker's ask closed: its quiet line here, with its task.
  workerAskEnded(ask, how) {
    this.loadAskEnds();
    if (this.askEnds.some((e) => e.id === ask.id)) return;
    this.askEnds = [...this.askEnds, { id: ask.id, title: `${ask.ref} · ${ask.words.title}`, how, at: this.afterNews(ask.ref, askAt(ask.id)) }].slice(-20);
    try { localStorage.setItem(`askends:${this.addr}`, JSON.stringify(this.askEnds)); } catch {}
  }

  // A secret ask kept or declined on its card here: its quiet line, at the card's moment.
  secretEnded(ask, how) {
    this.loadAskEnds();
    const id = `secret:${ask.address}:${ask.name}:${Date.now()}`;
    const ref = this.workerTasks().get(ask.address)?.ref;
    const at = ref ? this.afterNews(ref, this.seenAt(`s:${ask.address}|${ask.name}`)) : this.seenAt(`s:${ask.address}|${ask.name}`);
    this.askEnds = [...this.askEnds, { id, title: `${ref ? `${ref} · ` : ""}Secret: ${ask.name}`, how, at }].slice(-20);
    try { localStorage.setItem(`askends:${this.addr}`, JSON.stringify(this.askEnds)); } catch {}
  }

  // When a chat first saw something with no time of its own (a secret ask): shared by every
  // chat (shared "chat.cardseen"), so a task's chat opened later puts its card where it
  // appeared too. New ones go out after this render (render()).
  seenAt(key) {
    const known = shared("chat.cardseen")?.[key] ?? this.seenNew?.[key];
    if (known) return known;
    this.seenNew = { ...(this.seenNew ?? {}), [key]: Date.now() };
    return this.seenNew[key];
  }

  // A worker's card in the Assistant's chat goes just under its task's needs-you line (the news
  // can come a little after the ask): the moment of that line, when there is one near `at`.
  afterNews(ref, at) {
    const near = (this.needsAt?.get(ref) ?? []).filter((n) => n >= at - 300000 && n <= at + 1800000);
    return near.length ? Math.max(at, Math.max(...near) + 1) : at;
  }

  // The cards waiting in this chat, each with its moment: this agent's own (an ask, a secret,
  // its start screen) and, in an Assistant's chat, its tasks' workers'. Each:
  // { id, at, strips, owner (its AskCards, for keys), ask, question (a questions card) }.
  timelineCards() {
    const out = [];
    for (const a of this.asks) out.push({ id: `card:${a.id}`, at: askAt(a.id), strips: this.cards.strips(a, { who: this.cli() }), owner: this.cards, ask: a, question: a.words.kind === "questions" });
    for (const a of this.sasks ?? []) {
      if (!a.kept) out.push({ id: `card:s:${a.name}`, at: this.seenAt(`s:${a.address}|${a.name}`), strips: this.secretCards.strips(a, { who: this.cli() }) });
    }
    const own = this.addr && openCard(this.addr);
    if (own) out.push({ id: `card:${own.id}`, at: own.opened, strips: screenStrips(own, { who: this.cli(),
      busy: this.screenBusy.has(own.id), error: this.screenErr.get(own.id),
      press: (i, cx) => this.pressScreen(own, i, cx), toTerminal: () => this.toTerminal() }) });
    // A worker's: headed by its task, with its chat a quiet link at the right.
    const open = (id, ref, title, terminal) => [linkCtl(`wask-open-${id}`, "Open chat", () => openTaskThread(terminal, ref, title))];
    for (const a of this.wasks ?? []) {
      if (a.secret) {
        if (!a.secret.kept) out.push({ id: `card:${a.id}`, at: this.afterNews(a.ref, this.seenAt(`s:${a.secret.address}|${a.secret.name}`)),
          strips: this.secretCards.strips(a.secret, { who: a.ref, links: open(a.id, a.ref, a.title, a.terminal) }) });
      } else out.push({ id: `card:${a.id}`, at: this.afterNews(a.ref, askAt(a.id)), owner: this.workerCards, ask: a,
        strips: this.workerCards.strips(a, { who: a.ref, links: open(a.id, a.ref, a.title, a.terminal), terminal: false, chatHint: "Or write to it in its own chat." }) });
    }
    for (const [addr, x] of this.workerTasks()) {
      // Its secret asks' moments, noted even while a question of its hides them (seenAt()).
      for (const s of this.secretCards.items(addr)) if (!s.kept) this.seenAt(`s:${s.address}|${s.name}`);
      const card = openCard(addr);
      if (card) out.push({ id: `card:${card.id}`, at: this.afterNews(x.ref, card.opened), strips: screenStrips(card, { who: x.ref, links: open(card.id, x.ref, x.title, addr),
        busy: this.screenBusy.has(card.id), error: this.screenErr.get(card.id), press: (i, cx) => this.pressScreen(card, i, cx) }) });
    }
    return out;
  }

  // Accept on a Ready task's news line: the Tasks panel's command (herdr-task accept: merges
  // first when there's something to merge, else done).
  acceptTask(x, _cx) {
    // Accept shows what you approve first: the Accept card (mods/accept-card) runs herdr-task
    // accept from its own Accept; this row reads the change on its timer.
    openOverlay({ mod: "accept-card", kind: "dialog", modal: true, width: 640, height: 640,
      props: { ref: x.ref, folder: x.folder, machine: this.machine ?? null, title: x.title } });
  }


  // The agent's status. Parked behind this chat it isn't in agents(); the core's word then.
  status() {
    const a = agents().find((x) => x.address === this.addr);
    if (a) return a.status;
    const k = terminals().find((x) => x.address === this.addr);
    return ["working", "blocked", "done", "idle"].includes(k?.status) ? k.status : null;
  }

  // This chat's agent: hc get's record (locate()) with the live status and turn.
  ownTerminal() {
    const live = terminals().find((x) => x.address === this.addr);
    if (!this.t || this.t.address !== this.addr) return live ?? null;
    return live ? { ...this.t, status: live.status, turn: live.turn, state: live.state } : this.t;
  }

  log(args) {
    return exec("sh", ["-c", LOG, "log", ...args], { on: this.machine });
  }

  // ---- start screens and lost sessions ------------------------------------------------------

  // A new start-screen card: the agent waits on the person, as when it asks. A task's worker
  // alerts from its Assistant's chat (which put the card up), named by its task.
  screenAlert(card) {
    const k = terminals().find((x) => x.address === card.addr);
    const task = this.workerTasks().get(card.addr);
    if (card.addr === this.addr && assistant(k) && !notifies(k, "need")) return;
    if (settings()?.sounds?.enabled !== false) playSound("blocked");
    const mine = this.myPane();
    if (Boolean(mine) && focused()?.pane === mine && window()?.active) return;
    const tab = mine && panes().find((p) => p.pane === mine)?.tab;
    toast({ title: `${task?.ref ?? toastWho(k)} · Needs you`, body: `${card.cli} is waiting on its start screen.`, level: "alert",
      action: tab ? { name: "tab.select", args: { id: tab } } : undefined });
  }

  // A press on a start screen's choice (its card here or in the Assistant's chat).
  pressScreen(card, i, cx) {
    if (this.screenBusy.has(card.id)) return;
    this.screenBusy.add(card.id);
    this.screenErr.delete(card.id);
    cx.notify();
    cx.spawn(async (cx) => {
      const err = await this.screens.press(card, i).catch((e) => String(e?.message ?? e));
      this.screenBusy.delete(card.id);
      if (err) this.screenErr.set(card.id, err);
      cx.notify();
    });
  }

  // A worker that may have ended at its shell after a resume (its CLI no longer runs there):
  // looked at once.
  lostCandidate(k) {
    return Boolean(k) && k.state === "live" && !cliOf(k) && !k.status && !this.lostTried.has(k.address);
  }

  // Did the agent at `addr` stop because the session it resumed is gone ("No conversation
  // found")? Then a new one starts by itself. Looked at once per agent.
  async checkLost(addr, cx, t = null) {
    if (this.lostTried.has(addr)) return false;
    this.lostTried.add(addr);
    if (!t) { try { t = JSON.parse((await hc(["get", addr, "--json"])).stdout || "null"); } catch {} }
    const kind = cliOf({ agent: (t?.argv ?? []).map((a) => String(a).split("/").pop()).find((a) => /^(claude|codex)$/.test(a)) });
    const fresh = kind ? agent.freshArgv(kind, t?.argv) : null;
    if (!fresh) return false;
    if (t.state !== "live" && (t.exit_code ?? 1) === 0) return false;
    const screen = (await hc(["read", addr, "--lines", "40"]).catch(() => null))?.stdout ?? "";
    if (!LOST.test(screen.split("\n").slice(-30).join("\n"))) return false;
    // One start for it, whichever chat saw it first (its own, its Assistant's): shared "chat.lost"
    // = { [address]: when }.
    const lost = shared("chat.lost") ?? {};
    if (Date.now() - (lost[addr] ?? 0) < 120000) return true;
    setShared("chat.lost", { ...Object.fromEntries(Object.entries(lost).filter(([, at]) => Date.now() - at < 120000)), [addr]: Date.now() });
    await this.lostSession(t, kind, fresh, cx);
    return true;
  }

  // As Shepherdr: the session is gone, so a new one starts in the same chat with a short
  // handover, and the chat says so in one quiet line (brief()). The agent still at its shell
  // (a task's worker) gets the new agent typed into that shell: the same terminal, labels and
  // task. One whose terminal ended starts again the way the model picker restarts (agent.js).
  async lostSession(t, kind, fresh, cx) {
    // A task's worker: its task's id (herdr-task names its agents hat-4-fix-login).
    const named = /^([a-z][a-z0-9]*)-(\d+)(?:-|$)/.exec(t.name ?? "");
    const ref = this.workerTasks().get(t.address)?.ref ?? (t.labels?.["herdr.task"] && named ? `${named[1].toUpperCase()}-${named[2]}` : null);
    // An Assistant's role is in its first message (its template): it gets that again.
    const template = assistant(t) && !t.address.includes("/") ? await readTextFile(`${home()}/.config/herdr-core/templates/assistant.md`).catch(() => null) : null;
    const msg = lostMessage({ ref, template });
    const mine = t.address === this.addr;
    if (mine) { this.note = { id: `note-${Date.now()}`, text: WORDS.sessionGone }; cx.notify(); }
    try {
      if (t.state === "live") {
        // hc send pastes the line into the shell and presses Enter.
        const r = await hc(["send", t.address, [...fresh, msg].map(shellWord).join(" ")]);
        if (r.code !== 0) throw new Error(refusal(r).message);
      } else {
        const pane = this.myPane();
        if (!mine || !pane) return;
        // herdr-task would resume the same gone session again: its task starts it anew.
        if (t.labels?.["herdr.task"]) throw new Error("ask the Assistant to resume its task.");
        this.swapping = true;
        const next = await agent.restart(t, { argv: [...fresh, msg], resume: true, base: fresh }, pane);
        this.follow_to(next);
      }
      if (mine) this.note = { id: `note-${Date.now()}`, text: sessionStarted };
    } catch (e) {
      if (mine) this.note = { id: `note-${Date.now()}`, text: sessionFailed(String(e?.message ?? e)) };
    } finally {
      this.swapping = false;
    }
    if (mine) cx.timer.after(8000, (cx) => { this.note = null; cx.notify(); });
    cx.notify();
  }

  // ---- following the log --------------------------------------------------------------------

  // The agent's process and its log, again every few seconds: a /clear, a resume or a new
  // agent started in the same terminal writes another file.
  async locate(cx) {
    if (this.swapping) return;
    const r = await hc(["get", this.addr, "--json"]);
    let t = null;
    try { t = JSON.parse(r.stdout || "null"); } catch {}
    // Gone for good (removed after a restart from here), or unreachable for now (another
    // machine offline: try again later, don't call it ended).
    const gone = /not_found|no terminal/.test(`${r.stdout}\n${r.stderr}`);
    if (!gone && (!t || t.error)) return;
    if (gone || t?.state !== "live") {
      // Restarted from here (perhaps before Herdr restarted): the new agent carries the origin.
      const next = terminals().find((x) => x.state === "live" && x.address !== this.addr && x.labels?.["herdr.chat.origin"] === this.originKey);
      if (next) { this.follow_to(next.address); return; }
      // It ended because the session it resumed is gone: a new one starts by itself.
      if (!gone && t && !this.thread && await this.checkLost(this.addr, cx, t)) return;
      // A thread's worker that ended: its conversation stays to read, the box goes (composer()).
      if (this.thread) {
        // Read once from its own log, when the list gave one (read-only, with Resume).
        const log = this.endedLog;
        this.endedLog = null;
        if (!this.path && log?.path && KINDS[log.kind]) { this.path = log.path; this.kind = KINDS[log.kind]; this.reset(); this.pinned = true; }
        else if (!this.conv && !this.path) this.set("ended", cx);
        if (!this.ended) { this.ended = true; cx.notify(); }
        return;
      }
      this.set("ended", cx);
      return;
    }
    // Parked behind this chat, the terminal lost core keep (terminal.park turns it off): turn it
    // back on, so the agent survives a lost core like any pane's terminal.
    // A thread only shows a task worker, which has no pane by design: its keep is Herdr's.
    if (!this.thread && t.keep === false && !t.labels?.["herdr.tab"] && !panes().some((p) => p.terminal === this.addr)) await hc(["keep", this.addr]);
    // The agent lost its link to this chat (herdr.chat) while it has no pane of its own: link it
    // again, or the header, the agents list and the sweep take it for an agent without a chat.
    // Only to the pane this chat last knew as its own, while that is still a chat pane.
    const pane = this.lastPane ?? (this.slot && this.slotRec()?.pane) ?? null;
    if (!this.thread && !this.inner && !this.swapping && !t.labels?.["herdr.chat"] && pane && !panes().some((p) => p.terminal === this.addr)
      && panes().some((p) => p.pane === pane && p.mod === "chat")) await hc(["label", this.addr, `herdr.chat=${pane}`]);
    const kind = KINDS[t.status?.app] ?? KINDS[t.foreground?.name];
    // Back at its shell because the session it resumed is gone: a new agent starts there.
    if (!kind) { if (!(await this.checkLost(this.addr, cx, t))) this.set("unsupported", cx); return; }
    this.t = t;
    this.argv = t.foreground?.argv ?? t.argv ?? null;
    const pid = t.foreground?.pid;
    if (!pid) { if (this.phase !== "ready") this.set("none", cx); return; }
    // What the agent's own settings say (model, effort, speed), once per process.
    if (this.dfltFor !== `${kind}|${pid}`) {
      this.dfltFor = `${kind}|${pid}`;
      cx.spawn(async (cx) => { this.dflt = await agent.defaults(kind, this.machine); cx.notify(); });
      cx.spawn(async (cx) => { this.cmds = await slash.commands(kind, this.machine, t.foreground?.cwd ?? t.cwd); cx.notify(); });
      cx.spawn(async (cx) => { await this.loadTasks(); cx.notify(); });
      if (this.assistant()) cx.spawn(async (cx) => { await this.loadSpaceTasks(); cx.notify(); });
    }
    const f = await exec("sh", ["-c", FIND, "chat", kind, String(pid)], { on: this.machine });
    let path = f.stdout.trim().split("\n").pop() ?? "";
    // Not in its session yet (no report, no turn): perhaps on its own start screen, which
    // shows as a card under an empty chat.
    if (!path && starting(t)) path = "pending";
    if (path === "pending") {
      // A Claude Code that hasn't written its first line yet has no file: an empty chat.
      if (this.phase === "finding") { this.kind = kind; this.conv = new Conversation(kind); this.start = 0; this.set("ready", cx); }
      return;
    }
    if (!path) { if (this.phase !== "ready") this.set("none", cx); return; }
    if (path !== this.path || kind !== this.kind) {
      this.path = path;
      this.kind = kind;
      this.reset();
      this.pinned = true;
    }
  }

  // Shows another terminal from now on (the agent was restarted).
  follow_to(addr) {
    this.addr = addr;
    this.flag();
    // The box comes back once the new agent's conversation shows: give it the keyboard again.
    this.wasFocused = false;
    this.machine = addr.includes("/") ? addr.split("/")[0] : null;
    this.path = null;
    this.dfltFor = null;
    this.reset();
    this.phase = "finding";
  }

  set(phase, cx) {
    if (this.phase === phase) return;
    this.phase = phase;
    cx.notify();
  }

  rebuild() {
    this.conv = new Conversation(this.kind);
    this.conv.feed(this.records);
    // A log read from its start (a new agent's first message makes it) may already hold
    // messages sent from here.
    this.settlePending();
  }

  // A message sent from here is in once the log has it (its typed words, at least: an image
  // path becomes an image, a quote stays in front).
  settlePending() {
    if (!this.conv) return;
    const users = this.conv.items.filter((x) => x.kind === "user");
    // An answer written in the box is in once the log has it as an answer.
    if (this.replied?.length) this.replied = this.replied.filter((r) => !users.some((u) => u.answer && (u.at ?? 0) >= r.at - 5000 && norm(u.text).includes(norm(r.text))));
    if (!this.pending?.length) return;
    this.pending = this.pending.filter((p) => !users.some((u) => (u.at ?? 0) >= p.at - 5000 &&
      (same(u.text, p.sent) || (p.match && norm(u.text).includes(p.match)) || (!p.match && u.images))));
  }

  // The newest page first; after that, what the log gained since.
  async pull(cx) {
    if (!this.path) return;
    const path = this.path;
    if (this.start === null) {
      const r = await this.log(["page", path, "999999999999999", String(PAGE)]);
      if (path !== this.path) return;
      if (r.stdout.startsWith("missing")) { this.path = null; return; }
      const { head, records: recs } = records(r.stdout);
      if (head[0] !== "P") return;
      this.start = Number(head[1]);
      this.end = Number(head[2]);
      this.records = recs;
      this.rebuild();
      this.stick = true;
      this.phase = "ready";
      cx.notify();
      return;
    }
    const r = await this.log(["tail", path, String(this.end)]);
    if (path !== this.path) return;
    if (r.stdout.startsWith("missing")) { this.path = null; return; }
    const { head, records: recs } = records(r.stdout);
    if (head[0] !== "T") return;
    // Shorter than what was read: the file was replaced. Start over from its end.
    if (Number(head[2]) < this.end) { this.reset(); return; }
    this.end = Number(head[3]);
    if (!recs.length) return;
    this.records.push(...recs);
    if (this.records.length > KEEP && !this.loadingEarlier) {
      // Down to three quarters, so the rebuild is now and then, not on every message.
      this.records = this.records.slice(-Math.floor(KEEP * 0.75));
      this.start = this.records[0].off;
      this.rebuild();
    } else this.conv.feed(recs);
    // Your reactions just sent stay shown as sent until the log says the same.
    for (const [id, mine] of this.myReacts) {
      const logged = this.conv.reactions.get(id) ?? [];
      for (const [emoji, on] of mine) if (logged.some((r) => r.by === "you" && r.emoji === emoji) === on) mine.delete(emoji);
      if (!mine.size) this.myReacts.delete(id);
    }
    this.settlePending();
    this.stick = true;
    if (this.call) this.callRecent();
    cx.notify();
  }

  // The page before what is shown, when the person reaches the top. The row that was first
  // stays where it was: the list is scrolled back to it once the new rows are in.
  loadEarlier(cx) {
    if (this.loadingEarlier || !this.start || !this.path) return;
    this.loadingEarlier = true;
    const path = this.path, before = this.start;
    const rows = this.rows();
    const first = rows[Math.min(rows.length - 1, Math.max(1, this.range?.start ?? 1))]?.id;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await this.log(["page", path, String(before), String(PAGE)]);
        const { head, records: recs } = records(r.stdout);
        if (path !== this.path || this.start !== before || head[0] !== "P") return;
        this.start = Number(head[1]);
        this.records = [...recs, ...this.records];
        this.rebuild();
        this.anchor = first ? { id: first, until: Date.now() + 3000 } : null;
        this.reanchor = true;
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        this.loadingEarlier = false;
        cx.notify();
      }
    });
  }

  // An opened tools row shows each call's output, read from the log only now.
  loadResults(row, cx) {
    const want = row.steps.filter((s) => s.out !== undefined && !this.results.has(s.id));
    if (!want.length || !this.path) return;
    for (const s of want) this.results.set(s.id, null);
    for (const k of this.results.keys()) { if (this.results.size <= KEEP) break; this.results.delete(k); }
    const offs = [...new Set(want.map((s) => s.out))].slice(0, 40);
    const path = this.path;
    cx.spawn(async (cx) => {
      try {
        const r = await this.log(["results", path, ...offs.map(String)]);
        for (const part of r.stdout.split("\x1e").slice(1)) {
          const nl = part.indexOf("\n");
          const off = Number(part.slice(0, nl));
          const line = part.slice(nl + 1).replace(/\n$/, "");
          for (const s of want) if (s.out === off) this.results.set(s.id, resultText(line, s.id) ?? "");
        }
      } catch {}
      cx.notify();
    });
  }

  async follow(cx) {
    let last = 0;
    for (;;) {
      try {
        if (!this.path || Date.now() - last > 4000) { last = Date.now(); await this.locate(cx); }
        if (this.phase === "ended" && !this.swapping) {
          // A thread stays open on its notice; ✕ closes it.
          if (this.thread) return;
          // A Coordinator tab's chat stays: empty again, ready to start the next one.
          if (this.role) { this.addr = null; this.path = null; this.reset(); this.phase = "fresh"; cx.notify(); return; }
          this.closeSelf();
          return;
        }
        await this.pull(cx);
        await this.lookJobs(cx);
        await this.flag();
        // Its own start screen, while it has no session (or a card is still open).
        const k = this.ownTerminal();
        if (k && (starting(k) || openCard(this.addr))) { await this.screens.tick(this.addr, k); cx.notify(); }
        // The first message hc couldn't hand over (startAgent): once the agent is idle with no screen to answer.
        if (this.firstSend && k?.turn > 0) this.firstSend = null;
        if (this.firstSend && k?.status?.state === "idle" && !openCard(this.addr)) {
          const text = this.firstSend;
          this.firstSend = null;
          const sent = await hc(["send", this.addr, text]).catch(() => null);
          if (sent?.code !== 0) this.firstSend = text;
        }
        this.alerts(cx);
        this.drainQueue(cx);
        // Dragged to the top with the scrollbar: no wheel said so.
        if (this.start && (this.range?.start ?? 9) <= 1) this.loadEarlier(cx);
        if (this.error) { this.error = null; cx.notify(); }
      } catch (e) {
        this.error = String(e?.message ?? e);
        cx.notify();
      }
      const working = this.status() === "working" || this.pending.length > 0 || starting(this.ownTerminal());
      if (!this.machine && this.path) {
        // Here: wake on the log's folder changing, and look again now and then anyway.
        const dir = this.path.slice(0, this.path.lastIndexOf("/"));
        // One watch at a time: the folder may stay quiet for hours.
        if (this.watching?.dir !== dir) this.watching = { dir, next: watchFolder(dir).finally(() => { this.watching = null; }) };
        await Promise.race([this.watching.next, cx.sleep(4000)]);
      } else {
        await cx.sleep(working ? 1500 : 4000);
      }
    }
  }

  // ---- sending ------------------------------------------------------------------------------

  // Enter: now (while the agent works, it takes it mid-turn). Ctrl+Enter while it
  // works: held, and sent by itself once it is free.
  send(cx, hold = false) {
    const text = this.box.value().trim();
    // Also while the agent asks in its terminal: the words answer it there (deliver()).
    if (!text && !this.files.length) return;
    const msg = { id: `m${Date.now()}`, text, files: this.files, quote: this.quote };
    this.box.set_value("");
    // If the textarea still adds Enter's new line after this, take it out again.
    cx.timer.after(30, () => { if (!this.box.value().trim()) this.box.set_value(""); });
    this.files = [];
    this.quote = null;
    this.recall = -1;
    // /model (with or without a name) never reaches the CLI, which would keep it as the default
    // for every later agent: it opens the model picker instead, that model chosen.
    const mm = !msg.files.length && /^\/model(?:\s+(\S+))?\s*$/i.exec(text);
    if (mm) { this.quote = msg.quote; this.modelCommand(mm[1] ?? null, cx); this.saveSoon(cx); cx.notify(); return; }
    if (hold && this.status() === "working") this.queue.push(msg);
    else this.deliver(msg, cx);
    this.saveSoon(cx);
    this.pinned = true;
    this.stick = true;
    cx.notify();
  }

  // Enter (the textarea's submit and the key both say so; once is enough): takes the chosen
  // "/" command while the list shows, else sends (held with Ctrl).
  enter(cx, hold) {
    if (Date.now() - (this.enterAt ?? 0) < 120) return;
    this.enterAt = Date.now();
    const list = this.suggestions();
    if (list.length) {
      const c = list[Math.min(this.slashSel, list.length - 1)];
      if (this.box.value().trim() !== `/${c.name}`) { this.pick(c, cx); cx.timer.after(30, () => this.box.set_value(`/${c.name} `)); return; }
    }
    this.send(cx, hold);
  }

  // A held message goes once the agent stops working (and isn't asking something).
  drainQueue(cx) {
    if (!this.queue.length || this.phase !== "ready") return;
    const st = this.status();
    if (st === "working" || st === "blocked" || this.asks.length || openCard(this.addr) || this.pending.some((p) => !p.failed && !p.late)) return;
    const msg = this.queue.shift();
    if (msg.raw) hc(["send", this.addr, msg.text]);
    else this.deliver(msg, cx);
    this.saveSoon(cx);
    cx.notify();
  }

  deliver(msg, cx) {
    // /model never reaches the CLI by any way in (held, or sent by another mod): send() says why.
    const mm = !msg.files?.length && /^\/model(?:\s+(\S+))?\s*$/i.exec(msg.text ?? "");
    if (mm) { this.modelCommand(mm[1] ?? null, cx); return; }
    if (this.phase === "fresh") { this.startAgent(msg, cx); return; }
    // The CLI shows its own start screen (a card here): typed words could pick one of its
    // choices, so they wait until it is answered (drainQueue()).
    if (openCard(this.addr)) { this.queue.push(msg); return; }
    // A card asks (a question, a permission, a plan): the words answer it, as typing in the
    // CLI would (cards.js replyWith); the card's buttons still work too.
    if (this.asks.length && msg.text && !msg.files?.length) {
      this.replied = [...this.replied.slice(-20), { id: msg.id, text: msg.text, at: Date.now() }];
      this.cards.replyWith(this.asks[0], msg.text, cx);
      return;
    }
    // Herdr tag lines before the words: the message it replies to, the tasks it mentions.
    const body = messageBody({ text: msg.text, quote: msg.quote?.text ?? null, tags: this.taskTags(msg.text) });
    const p = { id: `pending-${msg.id}`, text: msg.text, replyTo: msg.quote ? excerpt(msg.quote.text, 80) : null, files: msg.files.filter((f) => !f.image).map((f) => f.name),
      paths: msg.files.filter((f) => f.image).map((f) => f.path), at: Date.now(), sent: body,
      match: norm(msg.text).slice(0, 60) || null, msg };
    this.pending.push(p);
    const menu = msg.files.length ? null : slash.opensMenu(this.kind, msg.text);
    if (menu) this.note = { id: `note-${msg.id}`, text: `/${menu} opens a menu in the terminal. Switching to it.` };
    cx.spawn(async (cx) => {
      let r;
      try {
        const paths = await attach.deliver(msg.files, this.addr, this.machine);
        p.sent = [body, ...paths].filter(Boolean).join("\n\n");
        r = await hc(["send", this.addr, p.sent]);
        // Its own dialog is open in its terminal (a question or a permission with no card
        // here): the words answer it the "Reply instead…" way.
        if (r.code !== 0 && refusal(r).kind === "blocked" && (this.kind === "claude" || this.kind === "codex")) r = await this.replyInstead(p.sent, cx);
      } catch (e) {
        r = { code: 1, stderr: String(e?.message ?? e) };
      }
      // Kept as a bubble that sends again when pressed (clickRow), so nothing is lost.
      if (r.code !== 0) { p.failed = refusal(r).message; cx.notify(); return; }
      // In the agent's terminal now: it's sent. The log has it only once taken, so it shows as
      // sent from here.
      p.delivered = true;
      cx.notify();
      // Mid-turn, Claude Code holds a typed message until its turn ends ("ctrl+enter to send
      // now"): send it now, so the agent takes it at once (it steers).
      if (this.kind === "claude") await this.steerNow(cx);
      if (menu) {
        // A command with its own menu: show it where it works, the terminal.
        await cx.sleep(900);
        this.pending = this.pending.filter((x) => x !== p);
        this.note = null;
        this.toTerminal();
        return;
      }
      // Not in the log after a while, with the agent no longer busy: say so, and keep it until it shows up.
      for (let i = 0; i < 60 && this.pending.includes(p) && !p.failed; i++) {
        await cx.sleep(i ? 5000 : 20000);
        if (this.status() !== "working") { p.late = true; cx.notify(); break; }
      }
    });
  }

  // The agent waits on its own dialog in the terminal (a question, a permission): Esc closes it
  // (Claude Code hears the person declined it; Codex stops), then the words go as a message,
  // once it takes typing again.
  replyInstead(text, cx) {
    return replyInstead(this.sendIo(cx), this.addr, text);
  }

  // What core/send.js needs from here: hc, a sleep, the agent's status now.
  sendIo(cx) {
    return { hc, sleep: (ms) => cx.sleep(ms), status: () => this.status() };
  }

  // A message that didn't go, pressed: it goes again.
  retry(p, cx) {
    this.pending = this.pending.filter((x) => x !== p);
    this.deliver(p.msg, cx);
  }

  // Claude Code's "send now" for a message it queued while working: Ctrl+Enter, only when its
  // screen offers it (pressed on an empty prompt it would do something else).
  steerNow(cx) {
    return steerNow(this.sendIo(cx), this.addr);
  }

  // A held message sent at once (the agent takes it mid-turn).
  sendQueued(msg, cx) {
    this.queue = this.queue.filter((m) => m !== msg);
    if (msg.raw) hc(["send", this.addr, msg.text]);
    else this.deliver(msg, cx);
    this.saveSoon(cx);
  }

  // Stop: the CLI's own interrupt. The working line says "Stopping…" until it is idle.
  stop(cx) {
    if (this.status() !== "working") return;
    this.stopping = true;
    hc(["interrupt", this.addr]);
    cx.notify();
  }

  // A held message back into the box, to change it before it goes.
  editQueued(msg, cx) {
    this.queue = this.queue.filter((m) => m !== msg);
    const now = this.box.value().trim();
    this.box.set_value(now ? `${msg.text}\n\n${now}` : msg.text);
    this.addFiles(msg.files);
    if (msg.quote && !this.quote) this.quote = msg.quote;
    this.box.focus();
    this.saveSoon(cx);
  }

  // Up in an empty box (or one showing a recalled message): the previous message again.
  recallStep(dir) {
    const mine = [...(this.conv?.items ?? []).filter((x) => x.kind === "user" && x.text && !x.from).map((x) => x.text), ...this.pending.map((p) => p.text)];
    const list = [...new Set(mine.reverse())];
    if (!list.length) return false;
    const next = this.recall + dir;
    if (next < -1 || next >= list.length) return true;
    this.recall = next;
    this.recalled = next < 0 ? "" : list[next];
    this.box.set_value(this.recalled);
    return true;
  }

  // ---- slash commands -----------------------------------------------------------------------

  suggestions() {
    // Enter's new line may already be in the box when the submit comes.
    const v = this.box.value().replace(/\n+$/, "");
    if (this.slashOff === v) return [];
    // "#4" at the end: this folder's tasks (herdr-task), by number or title.
    const h = /(?:^|\s)#([\w-]*)$/.exec(v);
    if (h && this.tasks?.length) {
      const q = h[1].toLowerCase();
      return this.tasks.filter((x) => !q || String(x.id).startsWith(q) || taskRef(x).toLowerCase().includes(q) || x.title.toLowerCase().includes(q)).slice(0, 8)
        .map((x) => ({ task: true, name: taskRef(x), about: x.title, state: x.status_text ?? x.state }));
    }
    const w = slash.typing(v);
    if (w === null || !this.cmds.length) return [];
    return slash.match(this.cmds, w);
  }

  pick(c, cx) {
    if (c.task) {
      const v = this.box.value().replace(/\n+$/, "");
      const next = v.replace(/#[\w-]*$/, `${c.name} `);
      this.box.set_value(next);
      this.slashOff = next;
    } else {
      this.box.set_value(`/${c.name} `);
      this.slashOff = `/${c.name} `;
    }
    this.box.focus();
    cx.notify();
  }

  // ---- a chat with no agent yet (Coordinator tab) --------------------------------------------

  // This slot's live agent, if one was started.
  slotAgent() {
    return terminals().find((x) => x.state === "live" && x.labels?.["herdr.chat.slot"] === this.slot)?.address ?? null;
  }

  // An empty slot chat whose agent is running after all: follow it, as if found at the start.
  adoptSlot(cx) {
    if (this.addr || this.phase !== "fresh") return;
    // Messages that waited for their machine (startAgent): once it's back, they start it as one.
    const waited = this.pending.filter((p) => p.waiting);
    if (waited.length && online(waited[0].machine)) {
      this.pending = this.pending.filter((p) => !p.waiting);
      const [first, ...rest] = waited.map((p) => p.msg);
      this.startAgent({ ...first, text: [first, ...rest].map((m) => m.text).join("\n\n"), files: [first, ...rest].flatMap((m) => m.files) }, cx);
      return;
    }
    const a = this.slotAgent();
    if (!a) return;
    this.addr = a;
    this.machine = a.includes("/") ? a.split("/")[0] : null;
    this.path = null;
    this.reset();
    this.phase = "finding";
    cx.spawn(async (cx) => this.follow(cx));
    if (!this.machine) cx.spawn(async (cx) => this.watchAsks(cx));
    cx.notify();
  }

  // This chat's pane and tab, from mods/coordinator's record (shared "coordinator.slots"); else
  // the only chat pane in its tab without an agent.
  slotRec() {
    return shared("coordinator.slots")?.[this.slot] ?? null;
  }
  slotPane() {
    const rec = this.slotRec();
    if (rec?.pane && panes().some((p) => p.pane === rec.pane)) return rec.pane;
    const taken = new Set(terminals().filter((k) => k.state === "live").map((k) => k.labels?.["herdr.chat"]).filter(Boolean));
    const tab = rec?.tab ?? focused()?.tab;
    const free = panes().filter((p) => p.mod === "chat" && p.tab === tab && !taken.has(p.pane));
    return free.length === 1 ? free[0].pane : null;
  }

  // The first message starts the agent (its template), parked behind this chat, with the
  // message as its task; then the chat follows it as usual.
  startAgent(msg, cx, thenTerminal = false) {
    const pane = this.slotPane();
    if (!pane) { toast({ title: "Couldn't start the Assistant", body: "This chat hasn't found its pane. Try again in a moment.", level: "error" }); return; }
    const rec = this.slotRec();
    const space = spaces().find((x) => x.id === (props()?.space ?? rec?.space));
    const machine = space?.machine ?? null;
    const folder = props()?.folder ?? rec?.folder ?? space?.folder ?? null;
    // Assistants start from the "assistant" template (chats saved before it was renamed say "coordinator").
    const named = props()?.template ?? this.role;
    const template = named === "coordinator" ? "assistant" : named;
    // No message (the header's Terminal): the template alone.
    const reply = msg?.quote ? `<hc reply-to="${excerpt(msg.quote.text, 80)}"/>\n` : "";
    // Files here go as their paths; on another machine they follow once it runs (hc put needs it).
    const local = machine || !msg ? [] : msg.files.map((f) => f.path);
    const task = msg ? [reply + msg.text, ...local].filter(Boolean).join("\n\n") : "";
    const p = msg ? { id: `pending-${msg.id}`, text: msg.text, replyTo: msg.quote ? excerpt(msg.quote.text, 80) : null, files: msg.files.filter((f) => !f.image).map((f) => f.name),
      paths: msg.files.filter((f) => f.image).map((f) => f.path), at: Date.now(), sent: task, match: norm(msg.text).slice(0, 60) || null } : { failed: null };
    if (msg) this.pending.push(p);
    // Its machine offline: said plainly under the message, which starts it once the machine is
    // back (adoptSlot); nothing is lost meanwhile.
    if (machine && !online(machine)) {
      if (msg) Object.assign(p, { waiting: WORDS.offline(machine), machine, msg });
      else toast({ title: `${machine} is offline`, body: "Its Assistant starts when it's back." });
      cx.notify();
      return;
    }
    this.phase = "starting";
    cx.notify();
    cx.spawn(async (cx) => {
      // Chosen settings (the New space dialog, props.settings): the template's words with that
      // agent and its flags, as a one-off template (as restart.sh does), written beside the
      // template on the machine it runs on. There, an agent that isn't installed leaves the
      // template's own command (what that machine's sync put there).
      // hc runs a template's command under sh -c, and where sh is dash (Debian, Ubuntu) the shell
      // stays the terminal's program, so the chat wouldn't know its CLI: on another machine the
      // command always goes through a one-off that execs it.
      let launch = template, oneOff = null, words = "";
      const st = this.choice?.sel ?? props()?.settings;
      const on = machine ? { on: machine } : {};
      const there = !machine || !st?.agent ? true : (await knownAgents(on).catch(() => []))
        .some((a) => (a.key === st.agent || (a.run ?? [])[0] === st.agent) && a.installed !== false);
      if ((st?.agent && there) || machine) {
        const q = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${String(a).replace(/'/g, "'\\''")}'`);
        const src = (await exec("sh", ["-c", TEMPLATE + 'cat "$dir/$1.md"', "x", template], on).catch(() => null))?.stdout ?? "";
        const head = /^---\n([\s\S]*?)\n---\n?/.exec(src);
        const body = head ? src.slice(head[0].length) : src;
        const own = /^command:[ \t]*(.+)$/m.exec(head?.[1] ?? "")?.[1]?.trim();
        const cmd = st?.agent && there ? agent.argvFor(st, { agent: null, argv: [] }).argv.map(q).join(" ") : own;
        if (body.trim() && cmd) {
          words = body.trim();
          oneOff = `herdr-${template}-${Date.now().toString(36)}`;
          const file = `---\nname: ${oneOff}\ndescription: A one-off ${template} start with chosen settings (mods/chat), removed after use.\ncommand: ${machine && !/^exec\s/.test(cmd) ? "exec " : ""}${cmd}\n---\n${body}`;
          await exec("sh", ["-c", TEMPLATE + 'printf "%s" "$2" > "$dir/$1.md"', "x", oneOff, file], on);
          launch = oneOff;
        }
      }
      const args = ["run", "--bg", "--json", "--no-parent", "--keep", ...(machine ? ["--on", machine] : []), ...(folder ? ["--cwd", folder] : []),
        "--label", `herdr.chat=${pane}`, "--label", `herdr.chat.slot=${this.slot}`, "--label", `herdr.chat.origin=slot:${this.slot}`,
        "--label", `herdr.role=${this.role}`,
        ...(space ? ["--label", `herdr.coordinator.space=${String(space.id).split("/").pop()}`] : []),
        ...(rec?.tab ? ["--label", `herdr.coordinator.tab=${String(rec.tab).split("/").pop()}`] : []),
        launch, ...(task ? [task] : [])];
      const r = await hc(args).catch((e) => ({ code: 1, stderr: String(e?.message ?? e), stdout: "" }));
      if (oneOff) exec("sh", ["-c", TEMPLATE + 'rm -f "$dir/$1.md"', "x", oneOff], on);
      let out = {};
      try { out = JSON.parse(r.stdout || "{}"); } catch {}
      // hc waits to hand the agent its first message and gives up while the CLI shows a screen of
      // its own (trust this folder, in a new folder on another machine): hc took too long, but the
      // agent runs. Then this chat sends the template's words and the task itself once the agent is
      // idle past that screen (follow()), so the Assistant never starts without its instructions.
      const late = (r.code !== 0 || !out.address) && this.slotAgent();
      if (late) out = { address: late, first_message: { sent: false } };
      if (out.address && out.first_message?.sent === false && words) this.firstSend = [words, task].filter(Boolean).join("\n\n");
      if (r.code !== 0 && !late || !out.address) {
        p.failed = (r.stderr || r.stdout || "It didn't start.").trim();
        if (!msg) toast({ title: `The ${this.role === "coordinator" ? "Assistant" : this.role} didn't start`, body: p.failed, level: "error" });
        this.phase = "fresh";
        cx.notify();
        return;
      }
      // Remember what the person asked: the agent's first message is the template's words with it.
      if (msg) {
        this.firstTask = msg.text;
        fs.mkdir(`${appHome()}/data/chat-first`, { recursive: true }).then(() => fs.writeFile(this.firstFile, msg.text)).catch(() => {});
      }
      this.addr = machine && !out.address.includes("/") ? `${machine}/${out.address}` : out.address;
      this.machine = this.addr.includes("/") ? this.addr.split("/")[0] : null;
      await this.flag();
      this.phase = "finding";
      this.wasFocused = false;
      if (machine && msg?.files.length) {
        // On another machine: the files once the agent runs there.
        cx.spawn(async () => { const paths = await attach.deliver(msg.files, this.addr, this.machine).catch(() => []); if (paths.length) await hc(["send", this.addr, paths.join("\n")]); });
      }
      cx.spawn(async (cx) => this.follow(cx));
      if (!this.machine) cx.spawn(async (cx) => this.watchAsks(cx));
      cx.notify();
      // From the header's Terminal: show its terminal once it runs (the usual Chat → Terminal).
      if (thenTerminal) {
        for (let i = 0; i < 40 && terminals().find((k) => k.address === this.addr)?.state !== "live"; i++) await cx.sleep(250);
        this.toTerminal();
      }
    });
  }

  // Before the first message: what the agent will start on (the model button in the box), from
  // props.settings (Shepherdr settings, given when its tab opened), else the CLI's own default.
  // A pick there just changes it: nothing runs yet, so nothing is lost. Kept per slot, so a
  // reload keeps it. On another machine, what is installed there.
  loadChoice(cx) {
    const space = spaces().find((x) => x.id === (props()?.space ?? this.slotRec()?.space));
    if (this.choice) return;
    this.choice = { sel: null, data: null };
    cx.spawn(async (cx) => {
      try {
        const data = await choices.loadChoices(space?.machine ?? null);
        let kept = null;
        try { kept = JSON.parse(localStorage.getItem(`choice:${this.slot}`) ?? "null"); } catch {}
        const st = kept?.agent ? kept : props()?.settings;
        const sel = st?.agent && data.menus[st.agent] ? { perm: data.permDefault[st.agent], effort: null, fast: false, ...st } : { ...data.defaults };
        this.choice = { sel, data, key: this.choice.key };
      } catch { this.choice = null; }
      cx.notify();
    });
  }

  get firstFile() { return `${appHome()}/data/chat-first/${safe(this.slot ?? this.originKey)}.txt`; }

  // The empty state: what to do, and what the assistant does.
  fresh(t) {
    const starting = this.phase === "starting";
    return v_flex().flex_1().min_h(0).items_center().justify_center().px(24).gap(6)
      .child(div().text_size(TEXT.title).font_medium().text_color(t.foreground).child(starting ? WORDS.startingAssistant : WORDS.emptyTitle))
      .child(div().max_w(380).text_center().text_size(TEXT.label).text_color(t.dim)
        .child(WORDS.emptyBody));
  }

  // ---- find (Ctrl+F) ----------------------------------------------------------------------------

  openFind(cx) {
    this.finding = true;
    this.findJump = true;
    cx.timer.after(0, () => this.findBox.focus());
    cx.notify();
  }

  closeFind(cx) {
    this.finding = false;
    this.box.focus();
    cx.notify();
  }

  findQuery() {
    return this.finding ? this.findBox.value().trim() : "";
  }

  // Every match in the loaded conversation: [{ index (row), id, n (matches in it) }].
  findMatches(rows) {
    const q = this.findQuery().toLowerCase();
    if (!q) return [];
    const out = [];
    rows.forEach((r, index) => {
      const text = (["user", "agent", "pending", "brief"].includes(r.kind) ? r.text : r.kind === "code" ? r.code : null) ?? "";
      let n = 0, at = 0;
      const low = text.toLowerCase();
      while ((at = low.indexOf(q, at)) >= 0) { n++; at += q.length; }
      if (n) out.push({ index, id: r.id, n });
    });
    return out;
  }

  // The match `findIdx` (counted over all matches): its row.
  findRow(matches) {
    let k = this.findIdx;
    for (const m of matches) { if (k < m.n) return m; k -= m.n; }
    return matches[matches.length - 1] ?? null;
  }

  findStep(d, rows, cx) {
    const matches = this.findMatches(rows);
    const total = matches.reduce((n, m) => n + m.n, 0);
    if (!total) return;
    this.findIdx = (this.findIdx + d + total) % total;
    this.findJump = true;
    cx.notify();
  }

  // Matched words in bold, outside code (for the message's markdown).
  findMark(text) {
    const q = this.findQuery();
    if (!q || /[*_`\[\]\\]/.test(q)) return text;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    return String(text).split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => (i % 2 ? part : part.replace(re, (m) => `**${m}**`))).join("");
  }

  // The find bar: the box, how many, up and down, earlier messages, close.
  findBar(t, rows) {
    const matches = this.findMatches(rows);
    const total = matches.reduce((n, m) => n + m.n, 0);
    const q = this.findQuery();
    const count = !q ? "" : total ? `${Math.min(this.findIdx, total - 1) + 1} of ${total}` : WORDS.noMatches;
    const icon = (id, path, fn) => div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
      .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); fn(cx); cx.notify(); })
      .child(svg(path).size(14));
    const take = (fn) => (_e, cx) => { fn(cx); cx.stop_propagation(); cx.notify(); };
    return h_flex().id("chat-find").flex_none().w_full().h(40).px(12).gap(8).items_center().border_b(1).border_color(t.border).bg(t.background)
      .key_context("chat_find")
      .on_action("chat_find_close", take((cx) => this.closeFind(cx)))
      .on_action("chat_find_next", take((cx) => this.findStep(1, rows, cx)))
      .on_action("chat_find_prev", take((cx) => this.findStep(-1, rows, cx)))
      .child(svg("mods/chat/search.svg").size(14).flex_none().text_color(t.dim))
      .child(Input.new(this.findBox).flex_1().text_size(13).text_color(t.foreground))
      .child(div().flex_none().font_family(settings().font_family ?? "JetBrains Mono").text_size(11.5).text_color(t.dim).child(count))
      .when(Boolean(this.start), (el) => el.child(h_flex().id("find-earlier").h(22).px(8).flex_none().items_center().rounded(6).cursor_pointer()
        .text_size(12).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); this.loadEarlier(cx); })
        .child(this.loadingEarlier ? "Loading…" : WORDS.searchEarlier)))
      .child(icon("find-prev", "mods/chat/chevron-up.svg", (cx) => this.findStep(-1, rows, cx)))
      .child(icon("find-next", "mods/chat/chevron-down.svg", (cx) => this.findStep(1, rows, cx)))
      .child(icon("find-x", "mods/chat/x.svg", (cx) => this.closeFind(cx)));
  }

  // ---- tasks (#4) -----------------------------------------------------------------------------

  // This folder's tasks, where the agent works (herdr-task; on its machine for a remote agent).
  // Archived ones too (list leaves them out unless --archived): a mention still finds them.
  async loadTasks() {
    const folder = this.t?.foreground?.cwd ?? this.t?.cwd;
    if (!folder) return;
    const args = [...(this.machine ? ["--on", this.machine] : []), "list", "--json", "--folder", folder];
    const [r, old] = await Promise.all([args, [...args, "--archived"]].map((a) => exec("herdr-task", a).catch(() => null)));
    const tasks = (out) => { try { const d = JSON.parse(out?.stdout ?? "{}"); return (d.tasks ?? []).map((x) => ({ ...x, folder: d.folder })); } catch { return null; } };
    const now = tasks(r);
    if (now) this.tasks = [...now, ...(tasks(old) ?? [])];
  }

  // The tasks a message mentions: by their id (HAT-1, from herdr-task's `ref`) or as #4.
  mentioned(text) {
    const t = String(text ?? "");
    // Every message asks on every render: kept per text until the task list changes (HERD-94).
    if (this.mentionsOf !== this.tasks) { this.mentionsOf = this.tasks; this.mentions = new Map(); }
    const known = this.mentions.get(t);
    if (known) return known;
    // core/send.js: the same matching as the web app's
    const found = mentionedIn(t, this.tasks);
    if (this.mentions.size > 1000) this.mentions.clear();
    this.mentions.set(t, found);
    return found;
  }

  // One tag line per task the message mentions, for the agent: what it is and where.
  taskTags(text) {
    return this.mentioned(text).map((x) => taskTag(x, taskRef(x))).join("");
  }

  // ---- task news (an Assistant's chat) --------------------------------------------------------
  // As other news (DECISIONS, Task news): each thing that happens to one of the space's tasks is
  // one slim line in the timeline at its moment (started, needs you, ready, done, ...), never
  // rewritten after. A worker's ask is answered on its card, just under its needs-you line.

  // The space whose Assistant this chat is (its coordinator's label), else null: a worker's
  // thread or any other agent shows no task rows.
  assistant() {
    const l = this.t?.labels ?? {};
    if (this.thread || (l["herdr.role"] !== "coordinator" && this.role !== "coordinator")) return null;
    return l["herdr.coordinator.space"] ?? l["herdr.space"] ?? null;
  }

  // Every folder's tasks on its machine (herdr-task list --all): a space's tasks can be in any
  // folder, not only where its Assistant runs.
  async loadSpaceTasks() {
    const r = await exec("herdr-task", [...(this.machine ? ["--on", this.machine] : []), "list", "--all", "--json"]).catch(() => null);
    try { const d = JSON.parse(r?.stdout ?? "null"); if (Array.isArray(d)) this.spaceTasks = d.flatMap((g) => (g.tasks ?? []).map((x) => ({ ...x, folder: g.folder }))); } catch {}
  }

  taskSig() {
    return (this.spaceTasks ?? []).map((x) => `${x.ref}:${x.status}:${x.why ?? ""}:${x.report?.text ?? ""}:${x.report?.left ?? ""}`).join("|");
  }

  // The lines: { inline: news item id → its row, extra: [{ at, row }] }. Herdr's news to the
  // Assistant (its <herdr-news> lines, log.js) says needs you, ready, done, failed and gone quiet;
  // a start is the task's `started`; a ready or done the news never said here (before this
  // session's log, or not sent) is the task's own ready_at / done_at.
  newsLines(items) {
    const space = this.assistant();
    const inline = new Map(), extra = [];
    if (!space) return { inline, extra };
    // A space's tasks make hundreds of lines: the last render's, unless what they're made of
    // changed (HERD-94: a render past Herdr's 50 ms is stopped).
    const sig = [space, this.spaceTasks, items, items.length, items[items.length - 1]?.id, this.start,
      (this.wasks ?? []).map((a) => a.ref).join(","), [...this.accepting].join(",")];
    if (this.newsMemo?.sig.every((v, i) => v === sig[i])) return this.newsMemo.out;
    const tasks = new Map();
    for (const x of this.spaceTasks ?? []) if ((x.space ?? x.queue?.space) === space && x.ref && !tasks.has(x.ref)) tasks.set(x.ref, x);
    const all = [], said = new Set();
    for (const it of items) if (it.kind === "news") { said.add(`${it.ref}:${it.event}`); all.push(it); }
    // Placed before what this chat has loaded: shown once it's scrolled back to (the top).
    const first = items.find((x) => x.at)?.at ?? 0;
    for (const [ref, x] of tasks) for (const [event, at] of [["started", x.started], ["ready", x.ready_at], ["done", x.done_at]]) {
      if (!Number.isFinite(at) || said.has(`${ref}:${event}`) || (at < first && this.start !== 0)) continue;
      all.push({ id: `tn:${ref}:${event}:${at}`, at, ref, event, text: "", made: true });
    }
    all.sort((a, b) => a.at - b.at);
    const last = new Map(), lastReady = new Map();
    for (const e of all) { last.set(e.ref, e); if (e.event === "ready") lastReady.set(e.ref, e); }
    this.needsAt = new Map();
    for (const e of all) if ((e.event === "needs-you" || e.event === "failed") && Number.isFinite(e.at)) this.needsAt.set(e.ref, [...(this.needsAt.get(e.ref) ?? []), e.at]);
    const order = [], ordered = new Set();
    for (const e of all) {
      const x = tasks.get(e.ref);
      if (!ordered.has(e.ref)) { ordered.add(e.ref); order.push(e.ref); }
      const asks = (this.wasks ?? []).some((a) => a.ref === e.ref);
      // Needs you, still: its words in red, and its card open just under it.
      const live = last.get(e.ref) === e && (e.event === "needs-you" || e.event === "failed") && (x?.status === "needs" || asks);
      // Accept on the newest ready line while the task is still Ready.
      const accept = lastReady.get(e.ref) === e && x?.status === "ready" && !asks;
      const row = { kind: "tasknews", id: e.id, ref: e.ref, task: x ?? null, taskId: x?.id ?? null, folder: x?.folder ?? null, title: x?.title ?? "",
        ...newsWords(e, x), live, asks: live && asks, accept, busy: accept && this.accepting.has(e.ref) };
      if (e.made) extra.push({ at: e.at, row }); else inline.set(e.id, row);
    }
    this.taskOrder = order;
    this.newsMemo = { sig, out: { inline, extra } };
    return { inline, extra };
  }

  // A news line's words: core/chat-view.js newsWords(), as the web app's chat has them.

  // A task chip: its worker's chat in the Tasks panel, else the task list there.
  // k: the task itself, when known (ids repeat across folders).
  openTask(id, k = null) {
    const x = k ?? this.tasks?.find((t) => String(t.id) === String(id));
    const live = x?.live ?? [];
    const worker = (live.find((a) => a.role === "worker") ?? (live.some((a) => a.role) ? null : live[0]))?.address;
    if (worker) { this.openThread({ terminal: worker, task: taskRef(x), title: x.title }); return; }
    run("layout.select", { stack: "panel-body", child: "tasks" });
    backToTasks();
    run("layout.show", { id: "panel" });
  }

  // A worker's thread ({ terminal, task, title }): its chat inside the Tasks panel (drill in,
  // panel.js), never a pane beside this chat.
  openThread(req) {
    openTaskThread(req.terminal, req.task, req.title);
  }

  // A pane, wherever it is: its space and tab shown, then the pane focused.
  revealPane(pane) {
    const p = panes().find((x) => x.pane === pane);
    if (!p) return;
    const s = spaces().find((x) => x.tabs.some((t) => t.id === p.tab));
    if (s && !s.active) run("space.select", { id: s.id });
    run("tab.select", { id: p.tab });
    run("pane.focus", { pane });
  }

  // A reply's reference was clicked: the message it answers, scrolled to and lit up a moment
  // (the light fades natively: one flip of its target, no timer driving frames).
  goTo(to, before, rows) {
    const i = rows.findIndex((r) => r.id === before);
    const target = [...rows.slice(0, i < 0 ? rows.length : i)].reverse().find((r) => (r.kind === "user" || r.kind === "agent") && r.text && names(r.text, String(to).slice(0, 60)));
    if (!target) return;
    this.pinned = false;
    // A jump into a folded reply opens it.
    if (target.blk) this.unfolded.add(target.blk);
    this.scroll.scroll_to_item(rows.indexOf(target), "center");
    this.flash = { id: target.id, on: true };
  }

  // ---- leaving, closing ---------------------------------------------------------------------

  // Back to the terminal: the header's switch (pane-chat) puts the agent's terminal back in
  // this pane's spot. It acts on the focused pane, so focus this one first.
  toTerminal() {
    // A thread's worker has no pane: the Tasks panel's header switches to its terminal there.
    if (this.thread) { if (!this.ended) requestWorkerTerminal(this.addr); return; }
    const mine = this.myPane();
    if (!mine) return;
    run("pane.focus", { pane: mine });
    run("pane-chat.toggle");
  }

  // The agent ended: its pane would have closed, so this one does.
  closeSelf() {
    if (this.inner) { backToTasks(); return; }
    const mine = this.myPane() ?? this.lastPane;
    if (mine) run("pane.close", { pane: mine });
  }

  // ---- message actions ----------------------------------------------------------------------

  // The column's left and right edges in the pane, for the action buttons under messages.
  edges() {
    const outer = Math.min(this.width, COLUMN + 36);
    const left = (this.width - outer) / 2 + 18;
    return { left, right: left + outer - 36 };
  }

  // A message's band, every part in order with its left edge in the pane: { what, x, w,
  // hover (shown only on hover), pill? }. The time takes a fixed width, so the places never
  // depend on how its digits draw.
  barLayout(bar) {
    const { left, right } = this.edges();
    const time = clock(bar.at);
    const parts = [];
    let at = 0;
    const add = (what, w, gap, more = {}) => { at += parts.length ? gap : 0; parts.push({ what, x: at, w, ...more }); at += w; };
    if (time) add("time", time.length > 5 ? 82 : 38, 0, { hover: true, text: time });
    for (const a of bar.acts) add(a, ACT, ACT_GAP, { hover: true });
    const pills = () => (bar.pills ?? []).forEach((p, i) => add(`pill:${p.emoji}`, PILL, i ? PILL_GAP : PILL_EDGE, { pill: p }));
    // Reactions off (an add-on): no smiley; the pills already there still show.
    const react = addonOn("reactions");
    if (bar.side === "user") { if (react) add("react", ACT, ACT_GAP, { hover: true }); pills(); }
    else { pills(); if (react) add("react", ACT, bar.pills?.length ? PILL_EDGE : ACT_GAP, { hover: true }); }
    const x0 = bar.side === "user" ? right - at : left;
    for (const p of parts) p.x += x0;
    return { x: x0, w: at, parts };
  }

  // Which part of a band the press was on (rows take no handlers of their own): the band is a
  // row of its own, so the list names it exactly; across, barLayout()'s places. The time
  // isn't a button.
  hitBar(row) {
    const x = this.press?.x;
    if (row.kind !== "band" || x === undefined || Date.now() - (this.press?.at ?? 0) > 3000) return null;
    const p = this.barLayout(row.bar).parts.find((p) => p.what !== "time" && x >= p.x && x <= p.x + p.w);
    if (p) this.hitLeft = p.x;
    return p?.what ?? null;
  }

  act(row, what, cx) {
    if (!what) return;
    // row: a message's bar ({ id, of, target, text, side, acts }) or its footer row.
    if (what === "copy") this.copy(row.text, row.id, cx);
    if (what === "reply") {
      const t = row.text.replace(/\s+$/, "");
      this.quote = { text: t.length > 280 ? t.slice(0, 279).trimEnd() + "…" : t };
      this.box.focus();
      this.saveSoon(cx);
    }
    if (what === "rewind") this.rewind(row, cx);
    if (what === "fork") this.fork(cx);
    if (what === "react") { this.keepIcons = row.of; this.openReactions(row, this.hitLeft); }
    // A pill: your reaction on or off.
    if (what.startsWith("pill:")) this.toggleReaction(row.of, row.target, what.slice(5), cx);
  }

  // ---- reactions ------------------------------------------------------------------------------

  // A message's reactions as pills: { emoji, you, agent }, the log's word with yours just sent.
  pills(id) {
    if (!id) return [];
    const list = [...(this.conv?.reactions?.get(id) ?? [])];
    const mine = this.myReacts.get(id);
    if (mine) for (const [emoji, on] of mine) {
      const i = list.findIndex((r) => r.by === "you" && r.emoji === emoji);
      if (on && i < 0) list.push({ emoji, by: "you" });
      if (!on && i >= 0) list.splice(i, 1);
    }
    const by = new Map();
    for (const r of list) {
      const p = by.get(r.emoji) ?? { emoji: r.emoji, you: false, agent: false };
      p[r.by === "you" ? "you" : "agent"] = true;
      by.set(r.emoji, p);
    }
    return [...by.values()];
  }

  // The emoji picker (mods/chat-react), anchored to the button that was pressed: its left edge
  // at the button's, above it when there is room, else below; inside the pane's window area.
  openReactions(row, anchor) {
    const W = 360, H = 420;
    const p = this.pressWin, local = this.press;
    let at = "pointer";
    if (p && local?.x !== undefined) {
      const paneX = p.x - local.x, paneY = p.y - (local.y ?? 0);
      const left = anchor ?? local.x;
      const x = Math.max(8, Math.min(paneX + left, paneX + this.width - W - 8));
      const rowTop = p.y - 14, rowBottom = p.y + 14;
      const y = rowTop - H - 4 >= 8 ? rowTop - H - 4 : Math.min(rowBottom + 4, paneY + (this.height ?? 800) - H - 8);
      at = { x, y: Math.max(8, y) };
    }
    const fr = this.frequent(18);
    openOverlay({ mod: "chat-react", kind: "popup", width: W, height: H, at,
      props: { pane: this.myPane(), target: row.of, text: row.target, height: H, width: W,
        frequent: [...fr, ...FREQUENT.filter((e) => !fr.includes(e))].slice(0, Math.max(FREQUENT.length, fr.length)),
        mine: this.pills(row.of).filter((p) => p.you).map((p) => p.emoji) } });
  }

  // How often and how lately you used each emoji (data/chat-emoji-uses.json): Slack's
  // frecency, each of the last ten uses weighed by how long ago it was.
  frequent(n) {
    const H = 3600000, now = Date.now();
    const weight = (age) => [[4 * H, 100], [24 * H, 80], [72 * H, 60], [168 * H, 40], [720 * H, 20], [2160 * H, 10]].find(([upTo]) => age <= upTo)?.[1] ?? 0;
    const score = (u) => (u.t?.length ? (u.n * u.t.reduce((s, t) => s + weight(now - t), 0)) / u.t.length : 0);
    return Object.entries(this.uses ?? {}).map(([e, u]) => [e, score(u)]).filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, n).map(([e]) => e);
  }


  useEmoji(emoji) {
    const u = this.uses[emoji] ?? { n: 0, t: [] };
    this.uses = { ...this.uses, [emoji]: { n: u.n + 1, t: [Date.now(), ...u.t].slice(0, 10) } };
    fs.mkdir(`${appHome()}/data`, { recursive: true }).then(() => fs.writeFile(`${appHome()}/data/chat-emoji-uses.json`, JSON.stringify(this.uses))).catch(() => {});
  }

  // Your reaction on (or off) a message: one tag line to the agent, shown at once.
  // While the agent waits on the person (a menu, a question), it waits in the queue instead.
  toggleReaction(id, text, emoji, cx) {
    const on = !this.pills(id).some((p) => p.emoji === emoji && p.you);
    const mine = new Map(this.myReacts.get(id) ?? []);
    mine.set(emoji, on);
    this.myReacts.set(id, mine);
    if (on) this.useEmoji(emoji);
    const line = reactionLine(emoji, text, on);
    const st = this.status();
    if (st === "blocked" || this.asks.length) {
      this.queue.push({ id: `r${Date.now()}`, text: line, files: [], quote: null, raw: true, label: on ? `${emoji} reaction` : `${emoji} reaction removed` });
      this.saveSoon(cx);
    } else hc(["send", this.addr, line]);
    cx.notify();
  }

  copy(text, id, cx) {
    cx.write_to_clipboard(text);
    this.copied = id;
    cx.timer.after(1500, (cx) => { if (this.copied === id) { this.copied = null; cx.notify(); } });
  }

  // The CLI's own rewind, on that message as nearly as it can: Claude Code's /rewind lists
  // the prompts with the newest last (Up once per later prompt); Codex's Esc Esc browses the
  // transcript from the last prompt (Left once per later prompt). Then the terminal shows it.
  rewind(row, cx) {
    if (this.status() === "working") { toast({ title: "The agent is working", body: "Stop it first, then rewind.", level: "info" }); return; }
    const users = (this.conv?.items ?? []).filter((x) => x.kind === "user" && !x.from && !/^\//.test(x.text ?? ""));
    const i = users.findIndex((u) => u.id === row.of);
    const back = i < 0 ? 1 : users.length - i;
    cx.spawn(async (cx) => {
      if (this.kind === "claude") {
        await hc(["send", this.addr, "/rewind"]);
        await cx.sleep(700);
        await hc(["keys", this.addr, ...Array(back).fill("up")]);
      } else {
        await hc(["keys", this.addr, "esc", "esc"]);
        await cx.sleep(500);
        if (back > 1) await hc(["keys", this.addr, ...Array(back - 1).fill("left")]);
      }
      this.toTerminal();
    });
  }

  // A copy of this conversation, continued in a new tab of this space (the CLI's own fork).
  fork(cx) {
    const session = agent.sessionOf(this.kind, this.path);
    if (!session) { toast({ title: "Can't fork", body: "This conversation has no saved session.", level: "info" }); return; }
    const tab = panes().find((p) => p.pane === this.myPane())?.tab;
    const space = spaces().find((s) => s.tabs.some((x) => x.id === tab));
    const folder = this.t?.foreground?.cwd ?? this.t?.cwd ?? undefined;
    run("tab.new", { space: space?.id, folder, argv: agent.forkArgv(this.kind, this.argv, session) });
  }

  // ---- dictation ----------------------------------------------------------------------------

  // Ctrl+Shift+D, the mic button and Done: start recording, or stop and write it down.
  toggleDictation(cx) {
    if (this.dict.state === "writing") return;
    if (this.dict.state === "recording") {
      cx.notify();
      cx.spawn(async (cx) => {
        cx.notify();
        const text = await this.dict.stop();
        // Into the box where the cursor is (the box is the text's place either way).
        if (text) {
          if (!this.box.value().trim()) this.box.set_value(text);
          else this.box.replace(text);
          this.saveSoon(cx);
        }
        this.box.focus();
        cx.notify();
      });
      return;
    }
    cx.spawn(async (cx) => {
      await this.dict.start();
      cx.notify();
      // The mic's level for the wave, while recording.
      await this.followLevels(cx, () => this.dict.level(), () => this.dict.state === "recording");
    });
  }

  // Cancel: the recording goes, the box stays as it was.
  cancelDictation(cx) {
    this.dict.cancel();
    this.box.focus();
    cx.notify();
  }

  // While recording, the box's bottom row is the recording (the shared live row): the red X
  // throws it away, the mic's level, "Recording" and the time, Done in Send's spot (a spinner
  // while it is written down). The typed text stays above.
  recordingRow(t) {
    const writing = this.dict.state === "writing";
    return this.liveRow(t, "chat-rec",
      this.round("rec-x", "mods/chat/x.svg", t, "danger", writing ? null : (cx) => this.cancelDictation(cx)),
      writing ? "Writing" : "Recording", !writing, this.dict.started ?? Date.now(),
      this.round("rec-done", writing ? "spinner" : "mods/chat/check.svg", t, "call", writing ? null : (cx) => this.toggleDictation(cx)));
  }

  // ---- voice call ---------------------------------------------------------------------------

  get callDir() { return `${appHome()}/data/chat-voice/${safe(this.originKey)}`; }

  toggleCall(cx) {
    if (this.call) { cx.spawn(async (cx) => { await this.hangup(); cx.notify(); }); return; }
    if (this.dict.state === "recording") this.dict.cancel();
    this.call = { phase: "connecting", who: null, muted: false, error: null, started: Date.now() };
    if (shared("chat.callError")) setShared("chat.callError", null);
    this.callShared();
    cx.timer.after(0, () => { if (this.call) this.callFocus.focus(); });
    const call = this.call;
    cx.spawn(async (cx) => this.followLevels(cx, async () => {
      const v = Number((await readTextFile(`${this.callDir}.level`).catch(() => null)) ?? 0);
      return Number.isFinite(v) ? v : 0;
    }, () => this.call === call));
    cx.spawn(async (cx) => this.runCall(cx));
  }

  async runCall(cx) {
    const dir = this.callDir;
    const keyFile = `${appHome()}/secrets/elevenlabs.env`;
    const ok = await exec("sh", ["-c", 'grep -q "^[[:space:]]*\\(export[[:space:]]*\\)\\{0,1\\}ELEVENLABS_API_KEY=." "$1" 2>/dev/null && echo yes', "x", keyFile]);
    // Or kept in Settings › Secrets (Everywhere): voice.ts reads it from the vault itself.
    const kept = ok.stdout.trim() === "yes" || (await secrets.entries().catch(() => [])).some((e) => e.name === "ELEVENLABS_API_KEY" && e.scope === "everywhere");
    if (!kept) {
      this.call = null;
      this.callHelp = true;
      this.callShared();
      cx.notify();
      return;
    }
    this.callHelp = false;
    const name = `${agent.NAMES[this.kind] ?? "the agent"}`;
    await exec("sh", ["-c", 'rm -rf "$1" "$1.level" && mkdir -p "$1/in" && touch "$1/alive"', "x", dir]);
    this.callRecent();
    // The helper runs beside the app (setsid: not tied to this mod's exec); it ends itself when
    // the chat stops touching `alive`.
    await exec("sh", ["-c", 'setsid bun "$2" "$1" "$3" "$4" </dev/null >"$1/log" 2>&1 &', "x", dir, `${appHome()}/mods/chat/voice.ts`, this.addr, name]);
    const call = this.call;
    let touched = 0, lastStatus = null, seen = new Set((this.conv?.items ?? []).map((x) => x.id));
    while (this.call === call) {
      const s = await readTextFile(`${dir}/state.json`).catch(() => null);
      let st = null;
      try { st = JSON.parse(s ?? "null"); } catch {}
      if (st) {
        const changed = st.phase !== call.phase || st.error !== call.error || (st.who ?? null) !== call.who;
        call.phase = st.phase; call.error = st.error; call.pid = st.pid; call.who = st.who ?? null;
        if (changed) { this.callShared(); cx.notify(); }
        if (st.phase === "ended") {
          if (st.error) this.callError(st.error);
          this.call = null; this.callShared(); cx.notify();
          return;
        }
      } else if (Date.now() - call.started > 15000) {
        const log = (await readTextFile(`${dir}/log`).catch(() => "")) ?? "";
        this.callError(log.trim().split("\n").pop() || "The call helper didn't answer.");
        this.call = null; this.callShared(); cx.notify();
        return;
      }
      // The call's clock ticks once a second; the bar elsewhere knows the call is still on.
      if (Date.now() - (call.beat ?? 0) > 15000) { call.beat = Date.now(); this.callShared(); }
      cx.notify();
      if (Date.now() - touched > 4000) { touched = Date.now(); exec("touch", [`${dir}/alive`]); }
      // The agent's status and its finished replies go to the voice agent.
      const now = this.status();
      if (now !== lastStatus) {
        const prev = lastStatus;
        lastStatus = now;
        this.callSay({ type: "status", status: now, asking: now === "blocked" ? (this.asks[0]?.words?.title ?? this.asking()) : null });
        if (prev === "working" && now !== "working") {
          const fresh = (this.conv?.items ?? []).filter((x) => x.kind === "agent" && !seen.has(x.id));
          if (fresh.length) this.callSay({ type: "reply", text: fresh.slice(-2).map((x) => x.text).join("\n\n") });
        }
        seen = new Set((this.conv?.items ?? []).map((x) => x.id));
      } else if (now !== "working") {
        // A reply written while it wasn't marked working (a quick answer).
        const fresh = (this.conv?.items ?? []).filter((x) => x.kind === "agent" && !seen.has(x.id));
        if (fresh.length) { this.callSay({ type: "reply", text: fresh.slice(-2).map((x) => x.text).join("\n\n") }); fresh.forEach((x) => seen.add(x.id)); }
      }
      // One watch at a time (a new one each second would pile up while the folder is quiet).
      if (this.callWatch?.dir !== dir) {
        const w = { dir, next: watchFolder(dir).catch(() => null).finally(() => { if (this.callWatch === w) this.callWatch = null; }) };
        this.callWatch = w;
      }
      await Promise.race([this.callWatch.next, cx.sleep(1000)]);
    }
  }

  callSay(m) {
    const dir = this.callDir;
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`;
    fs.writeFile(`${dir}/in/${name}`, JSON.stringify(m)).catch(() => {});
  }

  // What read_chat tells the voice agent: the status and the last messages.
  callRecent() {
    const items = (this.conv?.items ?? []).filter((x) => x.kind === "user" || x.kind === "agent" || x.kind === "ask").slice(-10);
    const st = this.status();
    const text = [`The coding agent is ${st === "blocked" ? "waiting for the person" : st ?? "idle"}.${this.conv?.doing ? ` Now: ${this.conv.doing}.` : ""}`,
      ...items.map((x) => `${x.kind === "user" ? "Person" : "Agent"}: ${String(x.text).slice(0, 1500)}`)].join("\n\n");
    fs.writeFile(`${this.callDir}/recent.txt`, text).catch(() => {});
  }

  callMute(cx) {
    if (!this.call) return;
    this.call.muted = !this.call.muted;
    this.callSay({ type: "mute", on: this.call.muted });
    this.callShared();
    cx.notify();
  }

  async hangup() {
    const call = this.call;
    this.call = null;
    this.callShared();
    if (!call) return;
    this.callSay({ type: "hangup" });
    const pid = call.pid;
    if (pid) exec("sh", ["-c", 'sleep 1; kill "$1" 2>/dev/null; true', "x", String(pid)]);
  }

  // The call for the bar shown while its chat isn't (mods/chat-call): shared "chat.calls" =
  // { <chat pane>: { phase, who, muted, started, beat, name, tab } }.
  callShared() {
    const mine = this.myPane() ?? this.lastPane;
    if (!mine) return;
    const all = { ...(shared("chat.calls") ?? {}) };
    const c = this.call;
    if (c) {
      const tab = panes().find((p) => p.pane === mine)?.tab ?? null;
      all[mine] = { phase: c.phase, who: c.who, muted: c.muted, started: c.started, beat: c.beat ?? Date.now(),
        name: agent.NAMES[this.kind] ?? "the agent", tab };
    } else if (all[mine]) delete all[mine];
    else return;
    setShared("chat.calls", all);
  }

  // Why a call ended or didn't start: shown at the top of the window (mods/chat-call) until closed.
  callError(text) {
    setShared("chat.callError", { text, pane: this.myPane() ?? this.lastPane ?? null, at: Date.now() });
  }

  // ---- model button and picker -----------------------------------------------------------------

  current() {
    if (!this.kind) return null;
    // A resumed conversation's log names the model it ran on before: until this process
    // writes, its arguments and settings say what it runs on.
    let meta = this.conv?.meta ?? {};
    const born = this.t?.created_ms;
    if (born && meta.at && meta.at < born) meta = { used: meta.used, window: meta.window };
    return agent.current(this.kind, this.argv, meta, this.dflt);
  }

  // The model picker (mods/chat-models), as a popover just above the model button: the chat
  // works out everything it shows (both agents' models, efforts, permission modes) and passes
  // it as props. `at`: where the button was pressed, in the window.
  openPicker(at, cx, name = null) {
    const c = this.current();
    if (!c || this.picking) return;
    this.picking = true;
    cx.spawn(async (cx) => {
      try {
        const stale = !this.pickCache || Date.now() - this.pickCache.at > 60000 || this.pickCache.machine !== this.machine;
        if (stale) {
          const [known, ...each] = await Promise.all([knownAgents({ on: this.machine }).catch(() => []),
            ...agent.AGENTS.map((k) => agent.defaults(k, this.machine))]);
          const dflts = Object.fromEntries(agent.AGENTS.map((k, i) => [k, each[i]]));
          const prog = (key) => known.find((a) => a.key === key || (a.run ?? [])[0] === agent.KINDS[key].run[0]);
          this.pickCache = { at: Date.now(), machine: this.machine, dflts,
            icons: Object.fromEntries(agent.AGENTS.map((k) => [k, { icon: prog(k)?.icon ?? null, tint: Boolean(prog(k)?.tint) }])),
            installed: agent.installedOf(known, dflts) };
        }
        const { dflts, icons, installed } = this.pickCache;
        if (this.kind) dflts[this.kind] = this.dflt ?? dflts[this.kind];
        const remote = this.machine && !this.t?.labels?.["herdr.task"] ? "This computer only" : null;
        const currentRow = agent.rowFor(c.agent, c);
        // Installed agents only (and always the one running).
        const menus = Object.fromEntries(agent.AGENTS.filter((k) => k === c.agent || installed[k])
          .map((k) => [k, agent.menuFor(k, dflts[k], k === c.agent ? currentRow : null)]));
        // As tall as the menu can get (chat-models' sizes): border and padding, Model header and
        // rows, separator, Reasoning header and levels, Fast, Permissions, Restart.
        const rows = Object.values(menus).reduce((n, m) => n + m.models.length, 0);
        const W = 300, H = 2 + 10 + 26 + 31 * rows + 9 + 26 + 34 + 31 + 31 + 33;
        openOverlay({ mod: "chat-models", kind: "popup", frame: "none", width: W, height: H,
          at: at ? { x: Math.max(8, at.x - W + 90), y: Math.max(8, at.y - H - 10) } : "pointer",
          props: { pane: this.pickKey(), remote, height: H, select: name ? findModel(menus, name) : null,
            current: { agent: c.agent, model: currentRow, effort: c.effort ?? null, fast: c.fast, perm: c.perm ?? null },
            menus, icons, permDefault: Object.fromEntries(agent.AGENTS.map((k) => [k, agent.permDefault(k, dflts[k])])) } });
      } finally {
        this.picking = false;
        cx.notify();
      }
    });
  }

  // /model typed in the box: the picker over the model button (before the first message, the
  // menu that chooses what it starts on), with the model named chosen. Without a picker (no
  // pane, no agent yet) it only says why nothing went.
  modelCommand(name, cx) {
    const b = this.composerAt;
    if (this.phase === "fresh") {
      if (!this.choice?.sel || !this.choice?.data) return;
      if (b) this.choice.at = { x: b.x + b.width - 120, y: b.y + b.height - 32, width: 80, height: 28 };
      choices.openMenu(this.choice, name ? findModel(this.choice.data.menus, name) : null);
      return;
    }
    if (!this.pickKey() || !this.current()) {
      this.note = { id: `note-${Date.now()}`, text: "Not sent: /model would change the model for every later agent." };
      cx.timer.after(6000, (cx) => { this.note = null; cx.notify(); });
      return;
    }
    this.openPicker(b ? { x: b.x + b.width - 90, y: b.y + b.height - 18 } : this.pickAt, cx, name);
  }

  // Who the picker's Restart is for (chat-models' props.pane, back in shared "chat.restartreq"):
  // this chat's pane, or in a task's chat (the Tasks panel; no pane of its own) its worker.
  pickKey() {
    return this.thread ? (this.addr ? `thread:${this.addr}` : null) : this.myPane();
  }

  // Restarts the agent with what the picker chose; this chat follows the new one.
  applyPick(pick, cx) {
    if (this.thread) return this.switchTask(pick, cx);
    const mine = this.myPane();
    if (this.restarting || !mine || !this.t) return;
    this.restarting = true;
    cx.spawn(async (cx) => {
      try {
        const t = JSON.parse((await hc(["get", this.addr, "--json"])).stdout);
        const built = agent.argvFor(pick, { agent: this.kind, argv: t.foreground?.argv ?? [], session: agent.sessionOf(this.kind, this.path) });
        this.swapping = true;
        const next = await agent.restart(t, built, mine);
        this.follow_to(next);
        this.note = { id: `note-${Date.now()}`, text: built.resume ? "Restarted. The conversation continues." : `Started ${agent.NAMES[pick.agent]} with a handoff.` };
        cx.timer.after(6000, (cx) => { this.note = null; cx.notify(); });
      } catch (e) {
        toast({ title: "The agent didn't restart", body: plainError(e), level: "error" });
      }
      this.swapping = false;
      this.restarting = false;
      cx.notify();
    });
  }

  // A task's chat: herdr-task switch starts its worker again on the pick, in the same session
  // when the CLI stays the same (else with a handover), and ends the old one. Only herdr-task
  // starts it, so it never gets a pane, a tab or herdr.chat (the parked sweep would end it);
  // the Tasks panel's view then follows the new worker, as after Resume.
  switchTask(pick, cx) {
    if (this.restarting || !this.addr) return;
    this.restarting = true;
    this.note = { id: `note-${Date.now()}`, text: "Restarting…" };
    cx.spawn(async (cx) => {
      try {
        const t = JSON.parse((await hc(["get", this.addr, "--json"])).stdout);
        const k = this.taskKey;
        const ref = k?.id != null ? String(k.id) : t.labels?.["herdr.task"];
        const folder = k?.folder ?? t.foreground?.cwd ?? t.cwd;
        if (!ref || !folder) throw new Error("This chat's task wasn't found.");
        const built = agent.argvFor(pick, { agent: this.kind, argv: t.foreground?.argv ?? [] });
        const on = k?.machine ?? this.machine;
        this.swapping = true;
        const r = await exec(`${appHome()}/mods/tasks/bin/herdr-task`, [...(on ? ["--on", on] : []), "switch", ref, "--folder", folder,
          "--argv", JSON.stringify(built.base), "--json"]);
        let out = null;
        try { out = JSON.parse(r.stdout || "null"); } catch {}
        if (r.code !== 0 || !out?.terminal) throw new Error(out?.error || r.stderr?.trim().split("\n").pop() || "Its agent didn't start.");
        const addr = on && !String(out.terminal).includes("/") ? `${on}/${out.terminal}` : out.terminal;
        setShared("tasks.thread", { ...(shared("tasks.thread") ?? {}), terminal: addr, log: null, note: null, at: Date.now() });
      } catch (e) {
        this.note = null;
        toast({ title: "The agent didn't restart", body: plainError(e), level: "error" });
      }
      this.swapping = false;
      this.restarting = false;
      cx.notify();
    });
  }

  // Buttons as the tasks panel draws them: primary is the view's one main action.
  // A finished or stopped task's Resume: herdr-task resume starts its agent again on its session
  // (a handoff when that's gone); the Tasks panel's view then follows the new agent.
  resumeTask(cx) {
    const k = this.taskKey;
    if (!k || this.resuming) return;
    this.resuming = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(`${appHome()}/mods/tasks/bin/herdr-task`, [...(k.machine ? ["--on", k.machine] : []), "resume", String(k.id), "--json", "--folder", k.folder]);
        let out = null;
        try { out = JSON.parse(r.stdout || "null"); } catch {}
        if (r.code !== 0 || !out?.terminal) throw new Error(out?.error || r.stderr?.trim().split("\n").pop() || "Its agent didn't start.");
        const addr = k.machine && !String(out.terminal).includes("/") ? `${k.machine}/${out.terminal}` : out.terminal;
        setShared("tasks.thread", { ...(shared("tasks.thread") ?? {}), terminal: addr, log: null, note: null, at: Date.now() });
      } catch (e) {
        toast({ title: "Couldn't resume the task", body: plainError(e), level: "error" });
      }
      this.resuming = false;
      cx.notify();
    });
  }

  button(id, label, icon, kind, t, fn) {
    const primary = kind === "primary";
    return h_flex().id(id).h(28).flex_none().gap(6).items_center().rounded(7).cursor_pointer().text_size(12.5).font_medium()
      .pl(icon ? 7 : 10).pr(10)
      .when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground).hover((s) => s.opacity(0.88)))
      .when(kind === "secondary", (el) => el.border_1().border_color(t.input).bg(t.background).text_color(t.foreground).hover((s) => s.bg(t.hover)))
      .when(kind === "ghost", (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => { cx.stop_propagation(); fn(cx); cx.notify(); })
      .when(Boolean(icon), (el) => el.child(svg(icon).size(14).flex_none()))
      .child(label);
  }

  // A 26 px icon button for the composer's bar (ghost, or on while `on`).
  iconButton(id, icon, t, on, fn) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(7).cursor_pointer()
      .when(on, (el) => el.bg(t.blocked + "22").text_color(t.blocked))
      .when(!on, (el) => el.text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => { cx.stop_propagation(); fn(cx); cx.notify(); })
      .child(svg(icon).size(14));
  }

  // Keeps the newest row in view, once this render's rows (and their measured heights) are in.
  follow_bottom(rows) {
    if (this.reanchor) {
      this.reanchor = false;
      const i = this.anchor && Date.now() < this.anchor.until ? rows.findIndex((r) => r.id === this.anchor.id) : -1;
      if (i >= 0) this.scroll.scroll_to_item(i, "top");
    }
    if (!this.stick) return;
    this.stick = false;
    if (this.pinned) this.scroll.scroll_to_bottom();
  }

  // A full-size message instead of the conversation: finding it, not found, ended.
  notice(t, title, body, actions = []) {
    return v_flex().flex_1().min_h(0).items_center().justify_center().px(24).gap(6)
      .child(svg("mods/workspace-chrome/terminal.svg").size(18).flex_none().text_color(t.dim))
      .child(div().pt(4).font_medium().text_color(t.foreground).child(title))
      .when(Boolean(body), (el) => el.child(div().max_w(360).text_center().text_size(12.5).text_color(t.muted).child(body)))
      .when(actions.length > 0, (el) => el.child(h_flex().pt(8).gap(6).children(actions)));
  }

  // ---- the conversation's rows ----------------------------------------------------------------

  rows() {
    const out = [];
    // The rows from `from` on are one message's block (spaced()).
    const block = (from, blk) => { for (let k = from; k < out.length; k++) out[k] = { ...out[k], blk }; };
    if (this.start === 0) out.push({ kind: "top", id: "top" });
    else if (this.start) out.push({ kind: "loading", id: "loading" });
    const items = this.conv?.items ?? [];
    const working = this.status() === "working";
    const arts = this.resolveArts(items);
    // The space's tasks' news lines (newsLines()): Herdr's in place, the rest each before the
    // first thing said after its moment.
    const news = this.newsLines(items);
    this.loadAskEnds();
    // Start screens answered or gone (screens.js): this agent's, and an Assistant's workers'.
    const screenEnds = [[this.addr, null], ...this.workerTasks()].flatMap(([addr, x]) => (addr ? cardsOf(addr) : [])
      .filter((c) => c.state !== "open").map((c) => ({ at: x?.ref ? this.afterNews(x.ref, c.opened) : c.opened,
        row: { kind: "askend", id: `se:${c.id}`, text: `${x?.ref ? `${x.ref} · ` : ""}${c.cli}'s start screen · ${c.how}` } })));
    // Cards waiting on the person, in the timeline at their moment (DECISIONS, Chat): this
    // agent's own question in place of its "Asked you" line, the rest by time.
    const cards = this.timelineCards();
    const ownQ = cards.find((c) => c.question && c.owner === this.cards);
    let qAt = -1;
    if (ownQ) for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === "ask" && !items[i].closed) { qAt = i; break; }
    const tasks = [...news.extra, ...this.askEnds.map((e) => ({ at: e.at, row: { kind: "askend", id: `ae:${e.id}`, text: `${e.title} · ${e.how}` } })), ...screenEnds,
      ...cards.filter((c) => !(c === ownQ && qAt >= 0)).map((c) => ({ at: c.at, card: c }))]
      .sort((a, b) => a.at - b.at);
    // A card is a run of strips, one list row each (strips.js), kept together as one block.
    const putCard = (c) => c.strips.forEach((s, j) => out.push({ kind: "cardstrip", id: `cs:${c.id}:${s.key}`, s, blk: c.id, first: j === 0, last: j === c.strips.length - 1,
      sig: strips.sig(s), owner: c.owner, ask: c.ask }));
    const put = (e) => { if (e.card) putCard(e.card); else out.push(e.row); };
    let ti = 0;
    // A day's line where a new day starts (Today, Yesterday, a weekday, a date), the first too.
    const days = new Set();
    const dated = (at) => {
      if (!(at > 1e12)) return;
      const d = dayOf(at);
      if (!days.has(d) && d > Math.max(-1, ...days)) { days.add(d); out.push({ kind: "day", id: `day:${d}`, text: dayLabel(at) }); }
    };
    for (let i = 0; i < items.length; i++) {
      let x = items[i];
      while (ti < tasks.length && x.at && tasks[ti].at < x.at) { dated(tasks[ti].at); put(tasks[ti++]); }
      if (i === qAt) { putCard(ownQ); continue; }
      if (x.kind === "news") { const r = news.inline.get(x.id); if (r) { dated(x.at); out.push(r); } continue; }
      if (x.kind !== "mark") dated(x.at);
      if (x.kind === "artifact") {
        // A published artifact: its card (the latest publish of it; earlier ones a line), or a
        // quiet line while the registry doesn't list it yet.
        const r = arts.get(x.id);
        if (r) out.push({ kind: "artifact", id: x.id, art: r.id, title: r.title, text: r.title, version: r.version, v: r.v, line: !r.latest });
        else if (Date.now() - (x.at ?? 0) < 180000) out.push({ kind: "artifact", id: x.id, pending: true, text: "" });
        continue;
      }
      // This chat started the agent from a template with the person's words as its task: the
      // template's part is a quiet row, the person's words their own message.
      const ft = this.firstTask?.trim();
      if (i === 0 && this.start === 0 && x.kind === "user" && ft && this.t?.template && String(x.text ?? "").trim().endsWith(ft)) {
        const body = String(x.text).trim().slice(0, -ft.length).trim();
        if (body) out.push({ kind: "brief", id: `${x.id}:b`, label: "New session", text: body });
        x = { ...x, text: ft };
      }
      if (x.kind === "user" && !(i === 0 && ft && x.text === ft) && this.brief(x, i)) {
        // Not typed by the person: a launch brief or another agent's message, as a quiet row.
        // A fresh start's handover says it all in its label.
        const restart = /^<restart>/.test(x.text ?? "");
        out.push({ kind: "brief", id: x.id, label: this.brief(x, i), text: restart ? x.text.replace(/<\/?restart>/g, "") : x.from ? unsigned(x.text) : x.text, bare: restart });
        continue;
      }
      if (x.kind === "user") {
        const from = out.length;
        if (x.replyTo) out.push({ kind: "replyref", id: `rr:${x.id}`, to: x.replyTo, of: x.id, side: "user" });
        // Rewind goes to a prompt; a /command isn't one.
        out.push(x);
        const chips = this.mentioned(x.text);
        if (chips.length) out.push({ kind: "chips", id: `tc:${x.id}`, tasks: chips.map((t) => ({ id: t.id, ref: taskRef(t), title: t.title })) });
        if (x.paths?.length) out.push({ kind: "imgs", id: `i:${x.id}`, paths: x.paths });
        // Its actions in a band row under it (the row above draws them too: band()).
        if (x.text) {
          const bar = { id: `b:${x.id}`, of: x.id, target: x.text, text: x.text, side: "user", at: x.at, pills: this.pills(x.id),
            acts: bandActs("user", x.text, { from: x.from }) };
          out[out.length - 1] = { ...out[out.length - 1], bar };
          out.push({ kind: "band", id: `ab:${x.id}`, bar });
        }
        block(from, x.id);
        continue;
      }
      if (x.kind === "agent") {
        const ps = parts(x.text);
        const first = out.length;
        // A long reply: its first lines (the part where they end cut off there), then Show more.
        const fold = this.foldOf(x, ps);
        const clip = (n) => (fold && !fold.open ? fold.clips.get(n) : undefined);
        if (ps.length === 1 && ps[0].type === "md") out.push(clip(0) ? { ...x, clip: clip(0) } : x);
        else ps.forEach((p, n) => {
          if (fold && !fold.open && n > fold.last) return;
          if (p.type === "md") out.push({ kind: "agent", id: `${x.id}:${n}`, text: p.text, clip: clip(n) });
          else {
            out.push({ kind: "codehead", id: `${x.id}:h${n}`, lang: p.lang, code: p.code });
            out.push({ kind: "code", id: `${x.id}:c${n}`, lang: p.lang, code: p.code, clip: clip(n) });
          }
        });
        if (fold) out.push({ kind: "fold", id: `fold:${x.id}`, of: x.id, open: fold.open });
        // Every message of the agent's gets its own actions and reactions, also while it works;
        // only the one it may still be writing (the newest, while working) waits. The actions go
        // under its last row.
        if (!(working && i === items.length - 1) && out.length > first) {
          const bar = { id: `b:${x.id}`, of: x.id, target: x.text, text: x.text, side: "agent", at: x.at, pills: this.pills(x.id),
            acts: bandActs("agent", x.text, { fork: Boolean(this.kind) }) };
          out[out.length - 1] = { ...out[out.length - 1], bar };
          out.push({ kind: "band", id: `ab:${x.id}`, bar });
        }
        block(first, x.id);
      } else if (x.kind !== "mark") out.push(x);
    }
    while (ti < tasks.length) { dated(tasks[ti].at); put(tasks[ti++]); }
    // Words that answered a card, shown at once, until the log has them right after their
    // question (log.js answers()): they are the newest thing said, so they go last.
    if (this.replied.length || this.pending.length) dated(Date.now());
    for (const r of this.replied) out.push({ kind: "user", id: `rp:${r.id}`, text: r.text });
    for (const p of this.pending) {
      const from = out.length;
      if (p.replyTo) out.push({ kind: "replyref", id: `rr:${p.id}`, to: p.replyTo, of: p.id, side: "user" });
      out.push({ kind: "pending", id: p.id, text: p.text, files: p.files, failed: p.failed, late: p.late, waiting: p.waiting, delivered: p.delivered });
      if (p.paths?.length) out.push({ kind: "imgs", id: `i:${p.id}`, paths: p.paths, faded: !p.delivered });
      block(from, p.id);
    }
    if (this.note) out.push({ kind: "note", id: this.note.id, text: this.note.text });
    if (out.length) out.push({ kind: "end", id: "end" });
    return this.spaced(out);
  }

  // How a long reply folds, or null when it's short (or holds what Find looks for): { open,
  // clips: part → px its words show, last: the last part shown }. Its parts' heights are
  // estimated from their words; one drawn (natural) shorter than that isn't folded after all.
  foldOf(x, ps) {
    const q = this.findQuery().toLowerCase();
    if (q && String(x.text).toLowerCase().includes(q)) return null;
    const w = Math.max(240, Math.floor(Math.min(this.width, COLUMN) * 0.8)) - 24;
    const est = ps.map((p) => (p.type === "md" ? wrapLines(p.text, w) * LINE_H : 34 + 16 + p.code.split("\n").length * 19));
    const drawn = ps.length === 1 ? this.natural.get(x.id) : null;
    if ((drawn ?? est.reduce((a, b) => a + b, 0)) <= FOLD_TALL * LINE_H) return null;
    if (this.unfolded.has(x.id)) return { open: true, clips: new Map(), last: ps.length - 1 };
    const clips = new Map();
    let left = FOLD * LINE_H, last = ps.length - 1;
    for (let n = 0; n < ps.length; n++) {
      if (est[n] < left && n < ps.length - 1) { left -= est[n]; continue; }
      clips.set(n, Math.max(3 * LINE_H, ps[n].type === "md" ? left : left - 34));
      last = n;
      break;
    }
    return { open: false, clips, last };
  }

  // Show more / Show less. Opening grows the reply downward from where it is, and the list
  // stops following the newest, so what is being read stays put; closing one read from far
  // down brings its start back into view.
  toggleFold(row, rows) {
    this.pinned = false;
    if (!this.unfolded.has(row.of)) { this.unfolded.add(row.of); return; }
    this.unfolded.delete(row.of);
    const i = rows.findIndex((r) => r.blk === row.of && r.kind !== "replyref");
    if (i >= 0 && i <= (this.range?.start ?? 0)) this.scroll.scroll_to_item(i, "top");
  }

  // One even rhythm (DECISIONS, Chat > Spacing). Rows of one block sit as they are; at a
  // block's edges a row drops its outer room (top0 / bot0), and between blocks goes one gap
  // row, so every block is GAP from the next: a message with its band, a run of quiet lines
  // (tools, "Message from …", artifact lines) sitting tight together, a card. A band is always
  // ACT_ROW: BAND_IN of air, then the actions' row at its foot, shown or not.
  spaced(rows) {
    const quiet = (r) => r.kind === "tools" || r.kind === "brief" || r.kind === "askend" || r.kind === "tasknews" || (r.kind === "artifact" && (r.line || r.pending));
    const of = (r) => r.blk ?? (quiet(r) ? "quiet" : r.id);
    // How far a row's words sit inside its edge once its outer room is gone (a reply line's
    // small text sits in an 18 px line; it only ever starts a block).
    const inset = (r, edge) => (quiet(r) ? QUIET_IN[edge] : r.kind === "replyref" ? 5 : 0);
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      let r = rows[i];
      const prev = rows[i - 1], next = rows[i + 1];
      const top0 = !prev || of(prev) !== of(r), last = !next || of(next) !== of(r);
      // A message's last row sits flush on its band.
      const bot0 = last || next?.kind === "band";
      if (r.kind === "band") {
        r.bar.box = { top: BAND_IN, h: ACT };
        out.push({ ...r, h: ACT_ROW });
      } else if (top0 || bot0) out.push({ ...r, top0, bot0 });
      else out.push(r);
      if (last && next) {
        const h = Math.max(0, GAP - (r.kind === "band" ? 0 : inset(r, "bottom")) - inset(next, "top"));
        out.push({ kind: "gap", id: `g:${r.id}`, h });
      }
    }
    return out;
  }

  // Who sent a message with hc (<hc from="t7 herd-12-fix-login">): its role or task as people
  // know it ("Reviewer", "HERD-12", "Assistant on vm-ssa"), never its terminal address. An
  // artifact's form says its title; the person's own lines (a kept secret) are "You". A sender
  // outside any terminal (from="<machine>/ppid:123") or one gone goes by the name it signed
  // the message with (text: "From HERD-76: …"), else "Another agent".
  sender(from, text = null) {
    // core/chat-view.js: the web app's chat names senders the same way.
    return senderName(from, text, { find: (a) => terminals().find((x) => x.address === a), machine:this.machine, taskOf: (a) => this.workerTasks().get(a)?.ref ?? null });
  }

  // Whose ask a card shows: the CLI's short name ("Claude asks").
  cli() {
    return this.kind === "codex" ? "Codex" : this.kind === "claude" || !this.kind ? "Claude" : agent.NAMES[this.kind] ?? this.kind;
  }

  // The empty box's words: whom it writes to.
  placeholder() {
    if (this.role === "coordinator" || assistant(this.t)) return "Message the Assistant";
    if (this.thread && this.taskRef) return `Message ${this.taskRef}`;
    return `Message ${agent.NAMES[this.kind] ?? "the agent"}`;
  }

  // A user message the person didn't type, in words for its quiet row, else null: the session's
  // first message when the agent was started from a template (a coordinator), as a handoff, or
  // for a task (herdr-task); and any message another agent sent with hc.
  brief(x, i) {
    // core/chat-view.js: the web app's chat labels them the same way.
    return briefLabel(x, i, { start: this.start, template: this.t?.template ?? null, task: Boolean(this.t?.labels?.["herdr.task"]), sender: (f, t) => this.sender(f, t) });
  }

  // What a row's height depends on: measured once per key and width.
  key(x) {
    const q = this.findQuery();
    const found = q && String(x.text ?? x.code ?? "").toLowerCase().includes(q.toLowerCase()) ? `|f:${q}` : "";
    const open = (x.kind === "tools" || x.kind === "brief") && this.opened.has(x.id);
    const shown = open && x.steps ? x.steps.filter((s) => this.results.get(s.id) != null).length : 0;
    return `${x.id}|${x.kind}${x.closed ? `.${x.closed}` : ""}|${open ? `o${x.steps?.length ?? 1}.${shown}` : ""}|${x.text?.length ?? x.code?.length ?? 0}|${x.from ? 1 : 0}${x.failed ? 1 : 0}${x.late ? 1 : 0}${x.waiting ? 1 : 0}${x.images ? 1 : 0}${x.files?.length ?? 0}|${x.paths?.length ?? 0}${x.paths?.every((p) => this.views[p]) ? "v" : ""}|${(x.pills ?? []).map((p) => p.emoji + (p.you ? 1 : 0) + (p.agent ? 1 : 0)).join("")}|${x.bar ? "b" : ""}${x.kind === "artifact" ? `|a${x.version ?? ""}${x.line ? "l" : ""}${x.pending ? "p" : ""}` : ""}${x.kind === "tasknews" ? `|${x.accept ? "a" : ""}` : ""}${x.kind === "cardstrip" ? `|cs${x.sig}${x.first ? "F" : ""}${x.last ? "L" : ""}` : ""}|${x.clip ? `c${x.clip}` : ""}${x.open ? "o" : ""}${x.kind === "day" ? x.text : ""}|${x.top0 ? "T" : ""}${x.bot0 ? "B" : ""}${x.h ?? ""}${found}`;
  }

  // A row's height before it is measured: bands and gaps are as tall as spaced() made them.
  guess(x) {
    return x.kind === "band" || x.kind === "gap" ? x.h : this.guessBare(x);
  }

  guessBare(x) {
    const w = Math.min(this.width, COLUMN) - 36;
    const lines = (text, width) => String(text ?? "").split("\n").reduce((n, l) => n + Math.max(1, Math.ceil((l.length * 7) / Math.max(120, width))), 0);
    switch (x.kind) {
      case "end": return 10;
      case "top": case "loading": case "note": return 36;
      case "brief": return this.opened.has(x.id) ? 32 + lines(x.text, w) * 19 : 20;
      case "replyref": return 22;
      case "chips": return 30;
      case "imgs": return this.fitThumbs(x.paths).h + 8;
      case "codehead": return 34;
      case "code": return 16 + (x.clip ?? String(x.code).split("\n").length * 19);
      case "fold": return 26;
      case "day": return 18;
      case "user": case "pending": return 30 + lines(x.text, w * 0.8 - 24) * 20 + (x.from ? 17 : 0) + ((x.images || x.files?.length) ? 20 : 0);
      case "agent": return 30 + (x.clip ?? lines(x.text, w * 0.8 - 24) * 21);
      case "tools": return this.opened.has(x.id) ? 26 + x.steps.length * 19 : 20;
      case "artifact": return x.pending || x.line ? 20 : 62;
      case "tasknews": return x.accept ? 26 : 20;
      case "cardstrip": {
        const s = x.s, edge = (x.first ? 10 : s.gap ?? 8) + (x.last ? 10 : 0);
        const h = s.kind === "title" || s.kind === "text" ? 18 * lines(s.text, w)
          : s.kind === "detail" ? 12 + 16 * Math.min(s.clip ? 11 : Infinity, s.lines?.length ?? 1)
          : { head: 18, controls: 24, option: 32 + (s.desc ? 16 : 0), review: 31, input: 32 }[s.kind] ?? 24;
        return edge + h;
      }
      default: return 60;
    }
  }

  // One row of the conversation. Rows are drawn inside the list's layout: no handlers here,
  // clicks come through the list's on_item_click. A message's last row carries its actions in
  // a band below it, in a layer over the whole row that shows while the pointer is on the row:
  // the row's own hover, so it is always the message under the pointer (the list redraws as
  // the pointer moves, so the hover follows it), and its room is always kept, so nothing moves.
  row(x, t, pre = "") {
    const keep = this.keepIcons === x.bar?.of;
    // The band row: its pills always; the rest while the pointer is on it.
    const box = x.bar?.box ?? { top: 0, h: ACT_ROW };
    if (x.kind === "band") return div().relative().w_full().h(x.h)
      .child(this.bar(x.bar, t, x.h - box.top - box.h, false))
      .child(div().absolute().inset_0().opacity(keep ? 1 : 0).hover((s) => s.opacity(1)).child(this.bar(x.bar, t, x.h - box.top - box.h, true)));
    const el = this.rowBare(x, t, pre);
    if (!x.bar) return el;
    // The message's last row: the same actions drawn just below it, in the band row's place,
    // while the pointer is on the message (its row isn't clipped: see the list).
    return div().relative().w_full().child(el)
      .child(div().absolute().inset_0().opacity(keep ? 1 : 0).hover((s) => s.opacity(1)).child(this.bar(x.bar, t, -box.top - box.h, true)));
  }

  // A band's parts at barLayout()'s places: the hover ones (time, icons, the smiley) or the
  // pills, each drawn in its own layer, so the pills stay while the rest fades in and out.
  bar(bar, t, bottom, hover) {
    const done = this.copied === bar.id;
    const icon = (a) => div().size(ACT).flex().items_center().justify_center().rounded(5).cursor_pointer()
      .text_color(done && a === "copy" ? t.foreground : t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .child(svg(`mods/chat/${done && a === "copy" ? "check" : ICONS[a]}.svg`).size(14));
    const pill = (p) => h_flex().w(PILL).h(22).gap(4).items_center().justify_center().rounded(11).border_1().cursor_pointer()
      .when(p.you, (el) => el.bg(t.accent + "26").border_color(t.accent))
      .when(!p.you, (el) => el.border_color(t.border).hover((s) => s.bg(t.hover)))
      .child(div().text_size(13).child(p.emoji))
      .child(div().text_size(11.5).font_medium().text_color(p.you ? t.foreground : t.muted).child(String((p.you ? 1 : 0) + (p.agent ? 1 : 0))));
    const { parts } = this.barLayout(bar);
    return div().absolute().left(0).right(0).bottom(bottom).h(bar.box?.h ?? ACT_ROW)
      .children(parts.filter((p) => Boolean(p.hover) === hover).map((p) => div().absolute().top(0).bottom(0).left(p.x).w(p.w).flex().items_center()
        .when(bar.side === "user" && p.what === "time", (el) => el.justify_end())
        .child(p.what === "time" ? div().pr(bar.side === "user" ? 4 : 0).pl(bar.side === "user" ? 0 : 2).text_size(11.5).text_color(t.dim).child(p.text)
          : p.pill ? pill(p.pill) : icon(p.what))));
  }

  rowBare(x, t, pre = "") {
    // A readable column, centered when the pane is wide.
    // At a block's edge a row drops its outer room there: spaced() puts the gap between blocks.
    const col = (el, px = 18, py = 6) => h_flex().w_full().justify_center()
      .child(div().w_full().max_w(COLUMN + 2 * px).px(px).pt(x.top0 ? 0 : py).pb(x.bot0 ? 0 : py).child(el));
    const pad = (el) => col(el, 18, 7);
    // The person's words on the right in an accent tint; the agent's on the left, quieter.
    const most = Math.max(240, Math.floor(Math.min(this.width, COLUMN) * 0.8));
    const bubble = (text, faded) => h_flex().w_full().justify_end().child(
      // An accent tint under the normal text color: readable in light and dark themes (the
      // accent's own text color on the full accent was too faint on light accents).
      div().max_w(most).px(12).py(8).rounded(12).bg(t.accent + "33").border_1().border_color(t.accent + "4d")
        .text_color(t.foreground).when(faded, (el) => el.opacity(0.55))
        .child(TextView.markdown(`${pre}chat-md-${x.id}`, this.findMark(typed(text)) || " ").selectable(true)));
    const theirs = (text) => h_flex().w_full().justify_start().child(
      div().max_w(most).px(12).py(8).rounded(12).bg(t.raised).text_color(t.foreground)
        .child(x.clip ? this.clipped(t.raised, x.clip, div().id(`${pre}fold-in-${x.id}`).flex_none()
          // Its words' drawn height: a reply shorter than it looked isn't folded (foldOf()).
          .on_size_change((size, cx) => { const was = this.natural.get(x.id); if (!was || Math.abs(was - size.height) > 1) { this.natural.set(x.id, size.height); cx.notify(); } })
          .child(TextView.markdown(`${pre}chat-md-${x.id}`, this.findMark(text) || " ").selectable(true)))
          : TextView.markdown(`${pre}chat-md-${x.id}`, this.findMark(text) || " ").selectable(true)));
    const fileLine = (label) => h_flex().gap(5).items_center().text_size(12).text_color(t.dim)
      .child(svg("mods/chat/paperclip.svg").size(12).flex_none()).child(div().truncate().child(label));
    switch (x.kind) {
      case "end":
        return div().w_full().h(10);
      case "gap":
        return div().w_full().h(x.h);
      case "top":
        return pad(div().w_full().text_center().text_size(12).text_color(t.dim).child(WORDS.top));
      case "loading":
        return pad(div().w_full().text_center().text_size(12).text_color(t.dim).child(WORDS.loading));
      case "note":
        return pad(div().w_full().text_center().text_size(12).text_color(t.muted).child(x.text));
      case "user":
        return pad(v_flex().w_full().items_end().gap(3)
          .when(Boolean(x.from), (el) => el.child(div().text_size(12).text_color(t.dim).child(`From ${this.sender(x.from, x.text)}`)))
          .when(Boolean(x.text), (el) => el.child(bubble(x.text, false)))
          .when(x.images > (x.paths?.length ?? 0), (el) => el.child(fileLine(imagesLine(x.images)))));
      case "pending":
        return pad(v_flex().w_full().items_end().gap(3)
          .when(Boolean(x.text), (el) => el.child(bubble(x.text, !x.delivered || Boolean(x.failed))))
          .when(x.files?.length > 0, (el) => el.child(fileLine(x.files.join(", "))))
          .when(Boolean(x.failed), (el) => el.child(div().text_size(12).text_color(t.blocked).cursor_pointer().child(notSent(x.failed))))
          .when(!x.failed && x.late, (el) => el.child(div().text_size(12).text_color(t.dim).child(WORDS.late)))
          .when(!x.failed && Boolean(x.waiting), (el) => el.child(div().text_size(12).text_color(t.dim).child(x.waiting))));
      case "replyref":
        // The message this one answers, in one dim line above it.
        return col(h_flex().w_full().h(18).justify_end().child(h_flex().max_w(Math.floor(Math.min(this.width, COLUMN) * 0.6)).gap(5).items_center()
          .cursor_pointer().text_size(11.5).text_color(t.dim).hover((s) => s.text_color(t.muted))
          .child(svg("mods/chat/reply.svg").size(12).flex_none())
          .child(div().min_w(0).truncate().child(x.to))), 18, 2);
      case "chips":
        return col(h_flex().w_full().h(24).gap(TASK_GAP).justify_end().children(x.tasks.map((k) => h_flex().w(TASK).h(22).flex_none().px(8).gap(6)
          .items_center().rounded(11).cursor_pointer().bg(t.accent + "26").border_1().border_color(t.accent + "4d").text_size(11.5)
          .hover((s) => s.bg(t.accent + "40"))
          .child(div().flex_none().font_medium().text_color(t.foreground).child(k.ref ?? `#${k.id}`))
          .child(div().min_w(0).truncate().text_color(t.muted).child(k.title)))), 18, 3);
      case "brief": {
        const open = this.opened.has(x.id);
        return col(v_flex().w_full().px(6).py(QUIET_PY).rounded(7).cursor_pointer().hover((s) => s.bg(t.hover))
          .child(h_flex().gap(6).items_center().text_size(12).text_color(t.dim)
            .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none())
            .child(div().flex_none().text_color(t.muted).child(x.label))
            .when(!open && !x.bare, (el) => el.child(div().flex_1().min_w(0).truncate().child(String(x.text ?? "").split("\n").find((l) => l.trim()) ?? ""))))
          .when(open, (el) => el.child(div().pl(18).pt(6).text_size(12.5).text_color(t.muted)
            .child(TextView.markdown(`${pre}chat-brief-${x.id}`, x.text || " ").selectable(true)))), 12, 0);
      }
      case "imgs":
        return col(h_flex().w_full().gap(THUMB_GAP).items_start().justify_end().when(Boolean(x.faded), (el) => el.opacity(0.55))
          .children(this.fitThumbs(x.paths).boxes.map((b) => this.shot(t, b).cursor_pointer())), 18, 4);
      case "agent":
        return pad(theirs(x.text));
      case "codehead": {
        const done = this.copied === x.id;
        return col(h_flex().w_full().h(28).pl(12).pr(4).items_center().rounded_t(8).bg(t.surface).border_1().border_b(0).border_color(t.border)
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(x.lang || "code"))
          .child(h_flex().h(22).px(6).gap(5).items_center().rounded(6).cursor_pointer().text_size(12).text_color(done ? t.foreground : t.dim)
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .child(svg(`mods/chat/${done ? "check" : "copy"}.svg`).size(12).flex_none()).child(done ? "Copied" : "Copy")), 18, 0).pt(x.top0 ? 0 : 6);
      }
      case "code": {
        const lines = v_flex().w_full().flex_none().children(x.code.split("\n").map((l) => div().min_h(19).child(l || " ")));
        return col(div().w_full().px(12).py(8).rounded_b(8).bg(t.surface).border_1().border_color(t.border).overflow_hidden()
          .font_family(settings().font_family ?? "JetBrains Mono").text_size(12.5).text_color(t.foreground)
          .child(x.clip ? this.clipped(t.surface, x.clip, lines) : lines), 18, 0).pb(x.bot0 ? 0 : 6);
      }
      case "fold":
        // Show more / Show less, under the reply's bubble, in line with its words (clickRow()).
        return col(h_flex().w_full().h(22).pl(12).child(h_flex().h(22).gap(4).items_center().cursor_pointer()
          .text_size(12.5).font_medium().text_color(t.muted).hover((s) => s.text_color(t.foreground))
          .child(x.open ? WORDS.showLess : WORDS.showMore)
          .child(svg(`mods/chat/chevron-${x.open ? "up" : "down"}.svg`).size(14).flex_none())), 18, 2);
      case "day":
        return col(div().w_full().text_center().text_size(12).font_medium().text_color(t.dim).child(x.text), 18, 0);
      case "cardstrip":
        // One strip of a card waiting on the person (strips.js): its presses come through
        // clickRow(), by where they were.
        return col(strips.strip(t, x.s, x.first, x.last, pre), 18, 0);
      case "askend":
        // A closed ask: what it asked and how it went, quiet (the card itself is gone).
        return col(h_flex().w_full().py(QUIET_PY).gap(6).items_center().text_size(12).text_color(t.dim)
          .child(svg("mods/chat/check.svg").size(12).flex_none())
          .child(div().min_w(0).truncate().child(x.text)), 18, 0);
      case "artifact": {
        const icon = (n) => svg("mods/artifacts/artifacts.svg").size(n).flex_none();
        // A "Published" line opens its artifact (clickRow): the pointer and a hover say so.
        if (x.pending || x.line) return col(h_flex().w_full().py(QUIET_PY).gap(6).items_center().text_size(12).text_color(t.dim).child(icon(12))
          .when(Boolean(x.art) && !x.pending, (el) => el.rounded(8).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.muted)))
          .child(div().min_w(0).truncate().child(x.pending ? WORDS.publishing : published(x.title, x.v))), 18, 0);
        // The whole card opens it (rows take no handlers; clickRow).
        return pad(h_flex().w_full().max_w(420).gap(10).items_center().px(10).py(8).rounded(10).cursor_pointer()
          .bg(t.surface).border_1().border_color(t.border).hover((s) => s.bg(t.hover))
          .child(div().size(32).flex_none().flex().items_center().justify_center().rounded(8).bg(t.raised).text_color(t.muted).child(icon(16)))
          .child(v_flex().flex_1().min_w(0).gap(1)
            .child(div().font_medium().text_color(t.foreground).truncate().child(x.title))
            .child(div().text_size(12).text_color(t.dim).child(artifactLine(x.version))))
          .child(h_flex().h(28).px(10).flex_none().items_center().rounded(7).border_1().border_color(t.input).bg(t.background)
            .text_size(12.5).font_medium().text_color(t.foreground).child("Open")));
      }
      case "tasknews": {
        // A task's news line (newsLines()): its mark, the id, what happened, then its words, dim;
        // a needs-you line still waiting in red. The whole line opens the task (clickRow()); a
        // Ready one's Accept sits at its right end, found by where the press was (rows take no
        // handlers).
        const tick = (c) => div().size(12).flex_none().rounded(6).bg(c).child(svg("mods/tasks/tick.svg").size(12).flex_none().text_color("#ffffff"));
        const dot = (c) => div().size(8).flex_none().rounded(4).bg(c);
        const mark = x.mark === "ready" ? tick(green()) : x.mark === "done" ? tick(t.dim)
          : dot(x.mark === "started" ? amber() : x.mark === "needs" ? (x.live ? red() : t.dim) : t.dim);
        return col(h_flex().w_full().px(6).py(QUIET_PY).gap(6).items_center().rounded(RADIUS.card).cursor_pointer()
          .text_size(TEXT.label).text_color(t.dim).hover((s) => s.bg(t.hover))
          .child(h_flex().w(14).h(14).flex_none().items_center().justify_center().child(mark))
          .child(div().flex_none().font_medium().text_color(t.muted).child(x.ref))
          .child(div().flex_none().text_color(x.live ? red() : t.muted).child(x.what))
          .when(Boolean(x.text), (el) => el.child(div().flex_none().child("·")).child(div().flex_1().min_w(0).truncate().child(x.text)))
          .when(!x.text, (el) => el.child(div().flex_1()))
          // The Tasks panel's own Accept (ui.js: primary, 20 in a row's line); its press comes
          // through clickRow().
          .when(Boolean(x.accept), (el) => el.child(this.acceptButton(x.busy)
            .when(!x.busy, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88))))), 12, 0);
      }
      case "ask":
        // Red while its dialog is open; once it's gone (answered, or closed without an answer), calm.
        return pad(v_flex().w_full().gap(4).px(12).py(10).rounded(10).border_1().border_color(t.border)
          .child(div().text_size(12).font_medium().text_color(x.closed ? t.dim : t.blocked)
            .child(x.closed === "answered" ? WORDS.askedAnswered : x.closed ? WORDS.askedClosed : WORDS.asked))
          .child(div().text_color(x.closed ? t.muted : t.foreground).child(TextView.markdown(`${pre}chat-md-${x.id}`, x.text).selectable(true))));
      case "error":
        return pad(div().w_full().text_size(12.5).text_color(t.blocked).child(x.text));
      case "tools": {
        const open = this.opened.has(x.id);
        return col(v_flex().w_full().px(6).py(QUIET_PY).rounded(7).cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .child(h_flex().gap(6).items_center().text_size(12).text_color(t.dim)
            .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none())
            .child(div().flex_1().min_w(0).truncate().child(summary(x.steps))))
          .when(open, (el) => el.child(v_flex().pl(18).pt(4).pb(2).gap(3).text_size(12).text_color(t.muted)
            .children(x.steps.flatMap((s) => {
              const out = this.results.get(s.id);
              return [...s.line.split("\n").map((line) => div().truncate().child(line)),
                ...(out ? [v_flex().ml(2).mb(3).pl(8).border_l(1).border_color(t.border).text_size(11.5).text_color(t.dim)
                  .children(out.split("\n").map((l) => div().truncate().child(l || " ")))] : [])];
            })))), 12, 0);
      }
    }
    return div();
  }

  // A folded reply's first `h` px of `el`, fading out into `bg` (its bubble's color).
  clipped(bg, h, el) {
    const fade = [0.3, 0.55, 0.8, 0.95];
    return div().relative().w_full().max_h(h).overflow_hidden().child(el)
      .child(v_flex().absolute().left(0).right(0).bottom(0).children(fade.map((o) => div().w_full().h(8).bg(bg).opacity(o))));
  }

  // A press on a row: open a tools row, copy a code block, or a message action.
  clickRow(key, rows, cx, sizes) {
    const row = rows.find((r) => r.id === key);
    if (!row) return;
    const bar = this.hitBar(row);
    if (bar) { this.act(row.bar, bar, cx); cx.notify(); return; }
    if (row.kind === "tools") {
      if (this.opened.has(key)) this.opened.delete(key);
      else { this.opened.add(key); this.loadResults(row, cx); }
    } else if (row.kind === "codehead") this.copy(row.code, row.id, cx);
    else if (row.kind === "pending" && row.failed) { const p = this.pending.find((x) => x.id === row.id); if (p?.msg) this.retry(p, cx); }
    else if (row.kind === "artifact" && row.art) this.openArtifact(row);
    else if (row.kind === "tasknews") {
      // Accept's place on a Ready line: the line's right end, its padding in (as row() draws it:
      // col(…, 12, 0), then px 6).
      const inner = Math.min(this.width, COLUMN + 24) - 24;
      const off = (this.width + inner) / 2 - 6 - (this.press?.x ?? -1);
      if (row.accept && off >= -2 && off <= (this.cardW.get("accept") ?? ACCEPT) + 2) this.acceptTask(row, cx);
      // Needs you with its card open just under it: the card takes the keys.
      else if (row.asks) { const a = (this.wasks ?? []).find((w) => w.ref === row.ref && !w.secret); if (a) this.workerCards.pressed(a); }
      else this.openTask(row.taskId, row.task);
    }
    else if (row.kind === "cardstrip") {
      // Which of the strip's controls the press was on (rows take no handlers: strips.js hit()).
      const c = strips.hit(row.s, this.press?.x, strips.innerOf(this.edges()), this.cardW);
      if (row.ask) row.owner?.pressed(row.ask);
      if (c?.kind === "input") (c.state ?? null)?.focus();
      else c?.fn?.(cx);
    }
    else if (row.kind === "brief") { if (this.opened.has(key)) this.opened.delete(key); else this.opened.add(key); }
    else if (row.kind === "fold") {
      // Only on its words (as rowBare() draws them: the column's edge, the bubble's padding in).
      const off = (this.press?.x ?? -1) - this.edges().left - 12;
      if (off >= -4 && off <= 100) this.toggleFold(row, rows);
    }
    else if (row.kind === "replyref") {
      this.goTo(row.to, row.of, rows);
      // The light goes out natively: its target flips once, the transition does the rest.
      cx.timer.after(80, (cx) => { if (this.flash) { this.flash.on = false; cx.notify(); } });
      cx.timer.after(1400, (cx) => { this.flash = null; cx.notify(); });
    } else if (row.kind === "chips") {
      const off = this.edges().right - (this.press?.x ?? -1);
      const j = Math.floor(off / (TASK + TASK_GAP));
      const k = row.tasks[row.tasks.length - 1 - j];
      if (off >= 0 && off % (TASK + TASK_GAP) <= TASK && k) this.openTask(k.id);
    }
    else if (row.kind === "imgs") {
      // Right-aligned thumbnails: which one the press was on (rows take no handlers of their own).
      const x = this.press?.x;
      const off = x === undefined ? -1 : this.edges().right - x;
      const boxes = this.fitThumbs(row.paths).boxes;
      for (let i = boxes.length - 1, edge = 0; i >= 0 && off >= 0; edge += boxes[i].w + THUMB_GAP, i--)
        if (off >= edge && off <= edge + boxes[i].w) { this.openImages(row.paths, i); break; }
    }
    cx.notify();
  }

  // What the agent says it waits for (its status report), e.g. "Do you prefer tea or coffee? (Tea · Coffee)".
  asking() {
    const msg = terminals().find((x) => x.address === this.addr)?.report?.msg;
    return typeof msg === "string" && msg.trim() ? msg.replace(/^answer:\s*/i, "").trim() : null;
  }

  // ---- what sits under the conversation -----------------------------------------------------

  // The Tasks panel's Accept (ui.js), drawn here without a handler: a news line is a list row.
  acceptButton(busy) {
    return button("accept-news", busy ? "Accepting…" : "Accept", { kind: "primary", size: "xs", disabled: Boolean(busy) });
  }

  statusLine(t, st) {
    // A card asks (in the timeline, where it appeared): nothing under the conversation repeats it.
    if (this.asks.length || this.sasks?.some((a) => !a.kept) || (this.addr && openCard(this.addr))) return null;
    // The agent this chat is starting, before it says anything.
    if ((this.phase === "starting" || this.phase === "finding") && this.role && this.pending.length) {
      return h_flex().id("chat-status").flex_none().w_full().max_w(COLUMN + 36).mx_auto().h(30).px(18).gap(8).items_center().text_size(12).text_color(t.muted)
        .child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900))
        .child(div().flex_1().min_w(0).truncate().child(`Starting the ${this.role === "coordinator" ? "Assistant" : this.role}…`));
    }
    if (st === "working") {
      // What it is doing, in plain words, for how long, and Stop. The line has the composer box's
      // edges (same width and padding), so Stop's right edge is the box's.
      const secs = Math.max(0, Math.floor((Date.now() - (this.workingSince ?? Date.now())) / 1000));
      const report = terminals().find((x) => x.address === this.addr)?.report?.msg;
      const doing = this.stopping ? WORDS.stopping
        : this.conv?.doing ?? (typeof report === "string" && report.trim() && !/^answer:/i.test(report) ? report.trim() : WORDS.working);
      // Only waiting (hc wait, a sleep, a monitor, a helper it waits on): calm, no spinner; a
      // message wakes it (or comes in at once).
      const waiting = this.waitingNow() && !this.stopping;
      return h_flex().id("chat-status").flex_none().w_full().max_w(COLUMN + 28).mx_auto().h(30).px(14).gap(8).items_center().text_size(12).text_color(t.muted)
        .when(waiting, (el) => el.child(svg("mods/chat/clock.svg").size(12).flex_none().text_color(t.dim)))
        .when(!waiting, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .child(div().flex_1().min_w(0).truncate().child(doing))
        .child(div().flex_none().font_family(settings().font_family ?? "JetBrains Mono").text_size(11.5).text_color(t.dim)
          .child(elapsed(secs)))
        .child(h_flex().id("chat-stop").h(22).px(8).gap(6).flex_none().items_center().rounded(6).border_1().border_color(t.input)
          .text_size(12).text_color(t.muted)
          .when(this.stopping, (el) => el.opacity(0.45))
          .when(!this.stopping, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); this.stop(cx); }))
          .child(svg("mods/chat/stop-chip.svg").size(8).flex_none())
          .child(div().child("Stop"))
          .child(div().text_size(11).text_color(t.dim).child("Esc")));
    }
    if (st === "blocked") {
      return div().flex_none().w_full().max_w(COLUMN + 28).mx_auto().px(14).pt(6).child(h_flex().px(12).py(10).gap(10).items_center().rounded(10)
        .bg(t.surface).border_1().border_color(t.border)
        .child(div().size(8).flex_none().rounded(4).bg(t.blocked))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().font_medium().text_color(t.foreground).child(WORDS.needsYou))
          .child(div().text_size(12).text_color(t.muted).child(this.asking() ?? WORDS.askingInTerminal)))
        .child(this.button("chat-open-terminal", WORDS.openTerminal,"mods/workspace-chrome/terminal.svg", "primary", t, () => this.toTerminal())));
    }
    return null;
  }

  // Why a call can't start (no key yet).
  callBar(t) {
    const wrap = (el) => div().flex_none().w_full().max_w(COLUMN + 28).mx_auto().px(14).pt(6).child(el);
    if (this.callHelp) {
      return wrap(v_flex().px(12).py(10).gap(8).rounded(8).bg(t.surface).border_1().border_color(t.border)
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().text_size(TEXT.body).font_medium().text_color(t.foreground).child("Voice calls need an ElevenLabs key"))
          .child(this.iconButton("call-help-close", "mods/chat/x.svg", t, false, () => { this.callHelp = false; })))
        .child(div().text_size(TEXT.label).text_color(t.muted).child("Add your key in Settings › Secrets as ELEVENLABS_API_KEY, then press the call button again."))
        .child(h_flex().child(this.button("call-help-secrets", "Open Secrets", null, "secondary", t, () => {
          this.callHelp = false;
          openOverlay({ mod: "shepherdr-settings", kind: "dialog", width: 820, height: 620, props: { section: "secrets" } });
        }))));
    }
    return null;
  }

  // The agent's helpers that are busy: its CLI's own (Claude Code's helpers launched and not
  // finished, Codex's spawned agents) count as working; Herdr's (terminals it started with hc:
  // their parent is this agent) count when they report working or blocked. Idle or finished
  // helpers, and programs that report nothing, don't count.
  helpers() {
    // Only the CLI's own subagents (Claude Code's Agent/Task runs, Codex's spawned agents), from
    // its log. Agents it started with hc are terminals Herdr already lists under it in the
    // Agents sidebar, so they aren't repeated here.
    return (this.conv?.running?.() ?? []).map((h) => ({ label: h.desc, at: h.at }));
  }

  // Only waiting: its current call is itself a wait (hc wait, a sleep, a monitor, wait_agent, a
  // helper it waits on). Helpers merely existing don't make it wait.
  waitingNow() {
    return Boolean(this.conv?.waiting);
  }

  // What the agent left running in the background (its shells and watchers, core/bg-jobs.js):
  // live while its agent is, none once it ended or this chat only shows its log.
  jobs() {
    if (!this.conv || this.phase !== "ready" || this.ended || !KINDS[this.kind]) return [];
    return this.bgJobs.list(this.kind, this.conv);
  }

  // Runs a shell script on the agent's machine (core/bg-jobs.js: its first argument is $0).
  runThere(script, args) {
    return exec("sh", ["-c", script, ...args], { on: this.machine });
  }

  // A look at the agent's processes when one is due, and the open row's last lines again.
  async lookJobs(cx) {
    const pid = this.t?.foreground?.pid;
    if (!pid || !this.conv || this.phase !== "ready") return;
    const jobs = this.bgJobs;
    if (jobs.due(this.kind, this.conv) && await jobs.look((s, a) => this.runThere(s, a), this.kind, pid, this.conv)) cx.notify();
    const open = this.jobs().find((j) => j.id === this.jobOpen);
    if (this.jobOpen && !open) { this.jobOpen = null; cx.notify(); }
    if (open?.path) {
      const text = await jobs.output((s, a) => this.runThere(s, a), open);
      if (text !== null && text !== this.jobOut.get(open.id)) { this.jobOut.set(open.id, text); cx.notify(); }
    }
  }

  // Stop on an open row: its processes end; its CLI then tells the agent, as when it stops one.
  stopJob(job, cx) {
    const pid = this.t?.foreground?.pid;
    if (!pid || this.jobStopping.has(job.id)) return;
    this.jobStopping.add(job.id);
    const jobs = this.bgJobs;
    cx.spawn(async (cx) => {
      await jobs.stop((s, a) => this.runThere(s, a), this.kind, pid, job).catch(() => {});
      this.jobStopping.delete(job.id);
      if (this.jobOpen === job.id) this.jobOpen = null;
      cx.notify();
    });
  }

  // Above the box: the CLI's subagents at work, then its background shells and watchers, one row
  // each as Claude Code and Codex list them (an icon, its name, how long). Five rows, else four and
  // "+N more" opens the rest. A shell's or watcher's row opens to its command, what it printed last
  // (Claude Code's), and Stop.
  // Shepherdr settings' "Helpers above the chat box" off (shared "chat.helpers" false): no subagents.
  background(t, st) {
    const now = Date.now();
    const shown = [...(shared("chat.helpers") === false ? [] : this.helpers().map((h) => ({ ...h, kind: "agent" }))), ...this.jobs()];
    if (!shown.length) return null;
    const open = this.helpersOpen || shown.length <= 5;
    const list = open ? shown : shown.slice(0, 4);
    const ago = (at) => {
      if (!at) return "";
      const s = Math.max(0, Math.floor((now - at) / 1000));
      return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
    };
    const mono = settings().font_family ?? "JetBrains Mono";
    const age = (h) => div().flex_none().font_family(mono).text_size(11.5).text_color(t.dim).child(ago(h.at));
    const row = (h, i) => {
      if (h.kind === "agent") return h_flex().id(`helper-${i}`).w_full().h(24).px(6).gap(8).items_center().text_size(12)
        .child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900))
        .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.foreground).child(h.label))
        .child(age(h));
      const on = this.jobOpen === h.id;
      const head = h_flex().id(`job-${h.id}`).w_full().h(24).px(6).gap(8).items_center().rounded(6).cursor_pointer().text_size(12)
        .when(on, (el) => el.bg(t.hover))
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.jobOpen = on ? null : h.id;
          cx.notify();
          if (!on) cx.spawn(async (cx) => this.lookJobs(cx));
        })
        .child(svg(h.kind === "monitor" ? "mods/chat/eye.svg" : "mods/workspace-chrome/terminal.svg").size(12).flex_none().text_color(t.working))
        .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.foreground).child(h.label))
        .child(age(h))
        .child(svg(on ? "mods/chat/chevron-up.svg" : "mods/chat/chevron-down.svg").size(12).flex_none().text_color(t.dim));
      if (!on) return head;
      const out = this.jobOut.get(h.id);
      const lines = out === undefined ? null : out.split("\n").slice(-8).map((l) => (l.length > 200 ? l.slice(0, 199) + "…" : l));
      const stopping = this.jobStopping.has(h.id);
      return v_flex().w_full().child(head)
        .child(v_flex().w_full().pl(26).pr(6).pt(4).pb(6).gap(6)
          .child(div().w_full().font_family(mono).text_size(11.5).text_color(t.muted).child(h.cmd.length > 300 ? h.cmd.slice(0, 299) + "…" : h.cmd))
          .when(Boolean(h.path), (el) => el.child(v_flex().w_full().px(8).py(6).rounded(6).bg(t.surface).border_1().border_color(t.border)
            .font_family(mono).text_size(11.5).text_color(t.dim)
            .children(lines === null ? [div().child("Loading…")] : lines.length && lines.some(Boolean) ? lines.map((l) => div().w_full().truncate().child(l || " ")) : [div().child("(no output)")])))
          .child(h_flex().child(stopping
            ? h_flex().h(28).px(10).items_center().text_size(12.5).text_color(t.dim).child(WORDS.stopping)
            : this.button(`job-stop-${h.id}`, "Stop", "mods/chat/stop.svg", "secondary", t, (cx) => this.stopJob(h, cx)))));
    };
    return v_flex().flex_none().w_full().max_w(COLUMN + 28).mx_auto().px(14).pt(4)
      .children(list.map(row))
      .when(!open, (el) => el.child(h_flex().id("helpers-more").h(22).px(6).gap(6).items_center().rounded(6).cursor_pointer()
        .text_size(12).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); this.helpersOpen = true; cx.notify(); })
        .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none())
        .child(`+${shown.length - 4} more`)));
  }

  // Held messages, each with Edit and Cancel; they go once the agent is free.
  queued(t) {
    if (!this.queue.length) return null;
    const ghost = (id, label, fn) => h_flex().id(id).h(22).px(8).flex_none().items_center().rounded(6).cursor_pointer().text_size(12).font_medium()
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); fn(cx); cx.notify(); })
      .child(label);
    return v_flex().flex_none().w_full().max_w(COLUMN + 28).mx_auto().px(14).pt(6).gap(4).children(this.queue.map((m) =>
      h_flex().id(`queued-${m.id}`).w_full().h(40).pl(10).pr(4).gap(8).items_center().rounded(8).border_1().border_color(t.border).bg(t.background)
        .child(svg("mods/chat/clock.svg").size(14).flex_none().text_color(t.dim))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(12.5).text_color(t.foreground).child(m.label ?? (m.text || m.files.map((f) => f.name).join(", "))))
          .child(div().truncate().text_size(12).text_color(t.dim).child(WORDS.queued)))
        .child(ghost(`queued-now-${m.id}`, WORDS.sendNow,(cx) => this.sendQueued(m, cx)))
        .child(ghost(`queued-edit-${m.id}`, "Edit", (cx) => this.editQueued(m, cx)))
        .child(div().id(`queued-x-${m.id}`).size(22).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.queue = this.queue.filter((x) => x !== m); this.saveSoon(cx); cx.notify(); })
          .child(svg("mods/chat/x.svg").size(12)))));
  }

  // The "/" list: the agent's commands that match what is typed.
  slashList(t, list) {
    if (!list.length) return null;
    const sel = Math.min(this.slashSel, list.length - 1);
    return v_flex().w_full().p(4).gap(1).border_b(1).border_color(t.border).children(list.map((c, i) =>
      h_flex().id(`slash-${c.name}`).h(28).px(8).gap(10).items_center().rounded(6).cursor_pointer()
        .when(i === sel, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { cx.stop_propagation(); this.pick(c, cx); })
        .child(div().flex_none().text_size(12.5).font_medium().text_color(t.foreground).child(c.task ? c.name : `/${c.name}`))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(c.task ? t.muted : t.dim).child(c.about))
        .when(Boolean(c.state), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(c.state)))));
  }

  // Files waiting to go: small tiles above the box, each removable.
  tiles(t) {
    if (!this.files.length && !this.quote) return null;
    return v_flex().w_full().px(10).pt(8).gap(6)
      .when(Boolean(this.quote), (el) => el.child(h_flex().w_full().h(24).pl(4).gap(6).items_center()
        .child(svg("mods/chat/reply.svg").size(12).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(norm(this.quote.text)))
        .child(div().id("quote-x").size(22).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.quote = null; this.saveSoon(cx); cx.notify(); })
          .child(svg("mods/chat/x.svg").size(12)))))
      .when(this.files.length > 0, (el) => el.child(div().flex().flex_wrap().gap(8).pt(2).children(this.files.map((f, i) => {
        const imgs = this.files.filter((x) => x.image).map((x) => x.path);
        const tile = f.image
          ? this.thumb(t, f.path).id(`file-${i}`).cursor_pointer()
            .on_click((_e, cx) => { cx.stop_propagation(); this.openImages(imgs, imgs.indexOf(f.path)); })
          // Not an image: a tile of the same size with its icon and a short name.
          : v_flex().id(`file-${i}`).size(THUMB).flex_none().px(4).gap(3).items_center().justify_center().rounded(8)
            .border_1().border_color(t.border).bg(t.surface)
            // A pasted text opens to read.
            .when(Boolean(f.text), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); this.openText(f); }))
            .child(svg("mods/chat/file.svg").size(16).flex_none().text_color(t.dim))
            .child(div().w_full().text_center().truncate().text_size(10.5).text_color(t.muted).child(f.name));
        return div().relative().flex_none().child(tile)
          .child(div().id(`file-x-${i}`).absolute().top(-6).right(-6).size(18).flex().items_center().justify_center().rounded(9).cursor_pointer()
            .bg(t.popover).border_1().border_color(t.border).text_color(t.muted).hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); attach.drop(f); this.files = this.files.filter((x) => x !== f); this.saveSoon(cx); cx.notify(); })
            .child(svg("mods/chat/x.svg").size(10)));
      }))));
  }

  // An image as a THUMB-sized square, cropped to fill it (attach.cover); a quiet square until its
  // size is known (needViews).
  thumb(t, path) {
    const v = this.views[path];
    const box = div().relative().size(THUMB).flex_none().rounded(8).overflow_hidden().bg(t.raised);
    const edge = div().absolute().inset_0().rounded(8).border_1().border_color(t.foreground + "1a");
    if (!v) return box.child(edge);
    const c = attach.cover(v.w, v.h, THUMB);
    return box.child(image(v.rel).absolute().left(c.left).top(c.top).w(c.w).h(c.h)).child(edge);
  }

  // Thumbnails under a message: each image whole, its shape kept, fitted in THUMB_ONE or
  // THUMB_MANY, never above its own size, all shrunk together when the row would pass the
  // column. A quiet box until its size is known. { boxes: [{ path, w, h }], h: the row's height }.
  fitThumbs(paths) {
    // core/chat-view.js: the web app's chat sizes them the same way.
    const { left, right } = this.edges();
    const fit = fitThumbs(paths.map((p) => this.views[p] ?? null), right - left);
    return { boxes: fit.boxes.map((b, i) => ({ ...b, path: paths[i] })), h: fit.h };
  }

  // One of those: the whole image, rounded, a faint edge drawn over it.
  shot(t, b) {
    const v = this.views[b.path];
    return div().relative().w(b.w).h(b.h).flex_none().rounded(8).overflow_hidden().bg(t.raised)
      .when(Boolean(v), (el) => el.child(image(v.rel).size_full()))
      .child(div().absolute().inset_0().rounded(8).border_1().border_color(t.foreground + "1a"));
  }

  // The images the chat shows, linked where image() can load them, with their sizes. Asked once each.
  needViews(paths, cx) {
    const want = [...new Set(paths)].filter((p) => p && !this.views[p] && !this.viewAsked.has(p));
    if (!want.length) return;
    for (const p of want) this.viewAsked.add(p);
    // Asked from render: start it right after.
    cx.timer.after(0, (cx) => cx.spawn(async (cx) => {
      Object.assign(this.views, await attach.viewable(want));
      cx.notify();
    }));
  }

  // This chat pane in the window ({ x, y, width, height }), from the press that opens something
  // over it (the viewers: images, text, artifacts); null before any press.
  paneArea() {
    const p = this.pressWin, local = this.press;
    if (!p || local?.x === undefined) return null;
    return { x: p.x - local.x, y: p.y - (local.y ?? 0), width: Math.round(this.width), height: Math.round(this.height ?? 700) };
  }

  // Where this chat is and whether its box has the keyboard, for Ctrl+K's artifacts (artview.js
  // chatArea()): its pane's, or "thread" for a task's chat in the Tasks panel. The area is noted
  // when the pointer's event bounds say it moved or resized (b), forgotten on a resize (null).
  areaKey() { return this.inner || this.thread ? "thread" : this.myPane(); }

  noteArea(b) {
    if (b && this.area && ["x", "y", "width", "height"].every((k) => Math.abs(this.area[k] - b[k]) < 1)) return;
    if (!b && !this.area) return;
    this.area = b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
    noteChatArea(this.areaKey(), { area: this.area });
  }

  // A pasted text file in the viewer (mods/chat-image), over this chat pane.
  openText(f) {
    const a = this.paneArea();
    const at = a ? { x: a.x, y: a.y } : "pointer";
    const width = Math.round(this.width), height = Math.round(this.height ?? 700);
    openOverlay({ mod: "chat-image", kind: "popup", frame: "none", width, height, at, props: { textPath: f.path, title: f.name, width, height } });
  }

  // The viewer (mods/chat-image) on these images, from the i-th.
  openImages(paths, i) {
    const all = paths.map((p) => this.views[p] ? { ...this.views[p], name: p.split("/").pop(), path: p } : null);
    const images = all.filter(Boolean);
    if (!images.length) return;
    i = images.indexOf(all[i] ?? images[0]);
    // Over this chat pane, at its size (a popup's root needs its size spelled out).
    const a = this.paneArea();
    const at = a ? { x: a.x, y: a.y } : "pointer";
    const width = Math.round(this.width), height = Math.round(this.height ?? 700);
    openOverlay({ mod: "chat-image", kind: "popup", frame: "none", width, height, at,
      props: { images, index: Math.max(0, Math.min(images.length - 1, i)), width, height } });
  }

  // The box's height. A hidden copy of the words at the box's width (composer()) says how many
  // rows they take; the textarea gets one row more than that, the spare one tucked under the
  // toolbar, so its words never overflow it: no scrollbar and no nudge while they fit (8
  // rows). Past 8 it shows 8 and scrolls, with its bar. A taller box shortens the list above
  // it, so the list goes back to its end the same frame when it was following the newest.
  sizeBox() {
    const rows = this.lineH && this.textH ? Math.max(1, Math.round(this.textH / this.lineH)) : 1;
    const want = Math.min(rows, 8);
    const spare = Boolean(this.lineH) && rows <= 8;
    const key = `${want}|${spare}`;
    if (key === this.boxKey) return;
    this.boxKey = key;
    this.boxRows = want;
    this.boxSpare = spare;
    this.box.set_rows(spare ? want + 1 : want);
    if (this.pinned) this.stick = true;
  }

  // The desktop's own file picker (pick-files.py, xdg-desktop-portal): the chosen files join
  // the message as tiles, as a drop or a paste makes them.
  pickFiles(cx) {
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", 'P=/usr/bin/python3; [ -x "$P" ] || P=python3; exec "$P" -I "$1"', "x", `${appHome()}/mods/chat/pick-files.py`]).catch(() => null);
      const list = (r?.stdout ?? "").split("\n").filter(Boolean);
      if (r && r.code !== 0) this.error = "Couldn't open the file picker.";
      if (!list.length) { cx.notify(); return; }
      this.addFiles(attach.paths(list));
      this.saveSoon(cx);
      this.box.focus();
      cx.notify();
    });
  }

  // The composer's round buttons: one size and shape, so Send, Call, End call, the mic and Mute
  // never change size or move; only the icon and fill change.
  //   fill: "solid" (Send), "call" (Call), "danger" (End call), "on" (muted), "quiet" (Mute), "ghost", "off"
  round(id, icon, t, fill, fn) {
    const el = div().id(id).size(ROUND).flex_none().flex().items_center().justify_center().rounded(ROUND / 2)
      .when(fill === "solid", (el) => el.bg(t.solid).text_color(t.solid_foreground))
      .when(fill === "call" || fill === "on", (el) => el.bg(t.foreground).text_color(t.background))
      .when(fill === "danger", (el) => el.bg(t.blocked).text_color("#ffffff"))
      .when(fill === "quiet", (el) => el.bg(t.raised).text_color(t.foreground))
      .when(fill === "rec", (el) => el.bg(t.blocked + "22").text_color(t.blocked))
      .when(fill === "off", (el) => el.bg(t.raised).text_color(t.dim))
      .when(fill === "ghost", (el) => el.text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .child(icon === "spinner" ? svg("mods/workspace-chrome/spinner.svg").size(14).spin(900) : svg(icon).size(14));
    if (!fn) return el;
    return el.cursor_pointer().when(fill !== "ghost", (el) => el.hover((s) => s.opacity(0.85)))
      .on_click((_e, cx) => { cx.stop_propagation(); fn(cx); cx.notify(); });
  }

  // The bottom row's left part, the same in a call and out of it: what the agent runs on (opens the picker; not during a call).
  pickParts(t, open) {
    const c = this.current();
    // Sized to its words, never cut: a narrow chat drops "· 1M" first.
    const model = String(c?.label ?? agent.modelName(c?.model) ?? "");
    const pick = [(this.width ?? 600) < 460 ? model.replace(/\s*·?\s*1M$/, "") : model, agent.levelName(c?.effort), c?.fast ? "Fast" : null].filter(Boolean).join(" · ") || agent.NAMES[this.kind] || "Agent";
    return [
      h_flex().id("chat-agent-pick").h(ROUND).pl(8).pr(5).gap(4).flex_none().items_center().rounded(6)
        .text_size(12).font_medium().text_color(t.muted)
        .when(open, (el) => el.cursor_pointer().hover((x) => x.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (e) => { this.pickAt = e.position; })
          .on_click((_e, cx) => { cx.stop_propagation(); this.openPicker(this.pickAt, cx); }))
        .child(div().flex_none().whitespace_nowrap().child(pick))
        .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none()),
    ].filter(Boolean);
  }

  // The live row a call and dictation share, 44 px, all on its midline: a round button on each
  // end, the wave across all the room there is, a word and the time.
  liveRow(t, id, left, word, dot, since, right) {
    const secs = Math.max(0, Math.floor((Date.now() - since) / 1000));
    return h_flex().id(id).w_full().h(44).flex_none().px(8).gap(12).items_center()
      .child(left)
      .child(this.wave(t, id))
      .child(h_flex().flex_none().gap(6).items_center()
        .when(dot, (el) => el.child(div().size(8).flex_none().rounded(4).bg(t.blocked)))
        .child(div().text_size(12.5).font_medium().text_color(t.foreground).child(word))
        // Digits of one width, so the time doesn't jiggle.
        .child(div().font_family(settings().font_family ?? "JetBrains Mono").text_size(12).text_color(t.dim)
          .child(elapsed(secs))))
      .child(right);
  }

  // The level wave: bars across the whole width (as many as fit, measured), the newest level
  // coming in on the right and moving left; a calm flat line while it's quiet.
  wave(t, id) {
    const n = Math.max(8, Math.floor(((this.waveW ?? 300) + WAVE_GAP) / (WAVE_BAR + WAVE_GAP)));
    const lv = (this.levels ?? []).slice(-n);
    const bars = [...Array(n - lv.length).fill(0), ...lv];
    // Quiet is one thin faint line across, behind the bars.
    return h_flex().id(`${id}-wave`).relative().flex_1().min_w(0).h(28).gap(WAVE_GAP).items_center().overflow_hidden()
      .on_size_change((size, cx) => { if (Math.abs((this.waveW ?? 0) - size.width) > 2) { this.waveW = size.width; cx.notify(); } })
      .child(div().absolute().left(0).right(0).top(13.5).h(1).bg(t.dim).opacity(0.3))
      .children(bars.map((v) => v < 0.04
        ? div().w(WAVE_BAR).h(1).flex_none()
        : div().w(WAVE_BAR).h(2 + Math.round(Math.min(1, v) * 26)).flex_none().rounded(2).bg(t.foreground)));
  }

  // The level loop for the wave, ten times a second while `on()` holds.
  async followLevels(cx, read, on) {
    this.levels = [];
    while (on()) {
      this.levels = [...this.levels, await read()].slice(-400);
      cx.notify();
      await cx.sleep(100);
    }
    this.levels = [];
  }

  // In a call the box is the call: Mute, the wave, what the call is doing and for how long, the
  // red X hangs up. M mutes while it has the keyboard.
  callComposer(t) {
    const c = this.call;
    const word = c.muted && c.phase !== "speaking" ? "Muted"
      : { connecting: "Connecting", listening: "Listening", thinking: "Thinking", speaking: "Speaking" }[c.phase] ?? "Connecting";
    return div().flex_none().w_full().max_w(COLUMN + 28).mx_auto().px(14).pt(8).child(div().id("chat-call-box").w_full()
      .rounded(10).border_1().border_color(t.input).bg(t.background)
      .track_focus(this.callFocus)
      .on_key_down((e, cx) => {
        const m = e.modifiers ?? {};
        if (e.key === "m" && !m.control && !m.alt && !m.platform) { cx.stop_propagation(); this.callMute(cx); }
      })
      .child(this.liveRow(t, "chat-call",
        this.round("call-mute", `mods/chat/${c.muted ? "mic-off" : "mic"}.svg`, t, c.muted ? "on" : "quiet", (cx) => this.callMute(cx)),
        word, false, c.started,
        this.round("call-x", "mods/chat/x.svg", t, "danger", (cx) => cx.spawn(async (cx) => { await this.hangup(); cx.notify(); })))));
  }

  // The model button before the first message (loadChoice): the same menu, choosing what it starts on.
  freshPick(t, cx) {
    // A pick lands in this.choice.sel just after a render (settings.js applyReply), which then
    // redraws: a changed one is kept per slot here.
    const now = JSON.stringify(this.choice.sel);
    if (this.choice.saved !== undefined && now !== this.choice.saved && this.slot) try { localStorage.setItem(`choice:${this.slot}`, now); } catch {}
    this.choice.saved = now;
    return choices.modelButton(t, this.choice, {}, cx);
  }

  composer(t, st, cx = null) {
    if (this.call) return this.callComposer(t);
    // A thread whose worker ended: read-only now.
    if (this.thread && this.ended) return div().flex_none().w_full().max_w(COLUMN + 28).mx_auto().px(14).pt(8)
      .child(h_flex().w_full().h(36).px(12).gap(8).items_center().rounded(10).border_1().border_color(t.border)
        .text_size(12.5).text_color(t.dim).child(div().size(6).flex_none().rounded(3).bg(t.dim)).child(div().flex_1().child(WORDS.ended))
        .when(Boolean(this.taskKey), (el) => el.child(this.button("chat-resume", this.resuming ? WORDS.resuming : "Resume",null, "primary", t, (cx) => this.resumeTask(cx)))));
    // An open card, or the agent's own dialog in its terminal, doesn't lock the box: words
    // written there answer it ("Reply instead…"). Only a call waits until it's free.
    const blocked = st === "blocked" && !this.asks.length;
    const ready = this.phase === "ready" || this.phase === "fresh";
    const empty = !this.box.value().trim() && !this.files.length;
    const can = ready && !empty;
    const list = this.focused || this.paneFocused ? this.suggestions() : [];
    const rec = this.dict.state;
    const recallable = !list.length && (!this.box.value() || this.recall >= 0);
    const take = (fn) => (_e, cx) => { fn(cx); cx.stop_propagation(); cx.notify(); };
    const sel = Math.min(this.slashSel, Math.max(0, list.length - 1));
    return div().flex_none().w_full().max_w(COLUMN + 28).mx_auto().px(14).pt(8).child(v_flex().id("chat-composer").w_full().rounded(10).border_1()
      // Esc stops a working agent while the box is empty and nothing is open over it.
      .key_context([list.length ? "chat_slash" : recallable ? "chat_recall" : "chat_composer",
        st === "working" && !list.length && !this.box.value().trim() && !this.quote ? "chat_stop" : null].filter(Boolean).join(" "))
      .on_action("chat_stop", take((cx) => this.stop(cx)))
      .on_action("chat_slash_up", take(() => { this.slashSel = (sel + list.length - 1) % list.length; }))
      .on_action("chat_slash_down", take(() => { this.slashSel = (sel + 1) % list.length; }))
      .on_action("chat_slash_take", take((cx) => this.pick(list[sel], cx)))
      .on_action("chat_slash_close", take(() => { this.slashOff = this.box.value().replace(/\n+$/, ""); }))
      .on_action("chat_recall_up", take(() => this.recallStep(1)))
      .on_action("chat_recall_down", take(() => this.recallStep(-1)))
      .on_key_down((e, cx) => {
        const k = e.key, m = e.modifiers ?? {};
        // The "/" list: Up and Down choose, Tab or Enter takes one, Escape closes it.
        if (list.length) {
          const sel = Math.min(this.slashSel, list.length - 1);
          if (k === "down" || k === "up") { this.slashSel = (sel + (k === "down" ? 1 : list.length - 1)) % list.length; cx.stop_propagation(); cx.notify(); return; }
          if (k === "tab") { cx.stop_propagation(); this.pick(list[sel], cx); return; }
          if (k === "escape") { this.slashOff = this.box.value().replace(/\n+$/, ""); cx.stop_propagation(); cx.notify(); return; }
        }
        // Up in an empty box: earlier messages; Down: back again.
        if ((k === "up" && (!this.box.value() || this.recall >= 0)) || (k === "down" && this.recall >= 0)) {
          if (this.recallStep(k === "up" ? 1 : -1)) { cx.stop_propagation(); cx.notify(); }
          return;
        }
        if (k === "escape" && this.quote) { this.quote = null; cx.stop_propagation(); cx.notify(); return; }
        // Enter sends, before the textarea makes it a new line; Shift+Enter stays a new line.
        if (k !== "enter" || m.shift) return;
        cx.stop_propagation();
        this.enter(cx, Boolean(m.control || m.platform));
      })
      .on_drop((e, cx) => { this.addFiles(attach.paths(e.paths ?? [])); this.saveSoon(cx); this.box.focus(); cx.notify(); })
      // Where the box is in the window, for a typed /model's picker (modelCommand()).
      .on_mouse_move((e) => { if (e.bounds) this.composerAt = e.bounds; })
      .border_color(this.focused ? t.accent : t.input).bg(t.background)
      .child(this.slashList(t, list) ?? div())
      .child(this.tiles(t) ?? div())
      // The padding is around the textarea, not on it: its own height is then exactly its rows
      // (auto-grow, 1 to 8), so it never overflows itself by the padding, which showed a
      // scrollbar in an empty box and made it scroll a few pixels on each new line.
      .child(div().relative().w_full().min_h(TEXT_ROW).px(12).pt(9).pb(4)
        // Measured, unseen: a line's height, and the words' height at the box's width (sizeBox()).
        .child(div().id("chat-line-h").absolute().top(0).left(0).opacity(0).text_size(13).child("Xg")
          .on_size_change((size, cx) => { if (Math.abs((this.lineH ?? 0) - size.height) > 0.1) { this.lineH = size.height; this.sizeBox(); cx.notify(); } }))
        .child(div().absolute().top(0).left(12).right(12).h(0).overflow_hidden().opacity(0)
          .child(div().id("chat-text-h").w_full().text_size(13)
            .child(/\n$/.test(this.box.value()) || !this.box.value() ? `${this.box.value()} ` : this.box.value())
            .on_size_change((size, cx) => { if (Math.abs((this.textH ?? 0) - size.height) > 0.1) { this.textH = size.height; this.sizeBox(); cx.notify(); } })))
        .child(Textarea.new(this.box).w_full().text_size(13).text_color(t.foreground)
          .when(Boolean(this.boxSpare && this.lineH), (el) => el.mb(-this.lineH)))
        .when(!this.box.value().trim(), (el) => el.child(div().absolute().top(9).left(12).text_size(13).text_color(t.dim)
          .child(this.asks.length || st === "blocked" ? WORDS.replyInstead : this.placeholder()))))
      // While recording: the recording row. Else one row, on the right: what the agent runs on
      // (opens the picker), dictation, Send (or Call). Send never turns into Stop: while the
      // agent works it still sends (or queues) and calls; Stop is on the working line above.
      .when(rec !== "idle", (el) => el.child(this.recordingRow(t)))
      .when(rec === "idle", (el) => el.child(h_flex().h(36).pl(6).pr(6).gap(4).items_center()
        // Attach on the left, as ChatGPT and Claude have it: the desktop's file picker.
        .child(this.round("chat-attach", "mods/chat/paperclip.svg", t, "ghost", (cx) => this.pickFiles(cx)).tooltip(WORDS.attach))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.blocked).child(rec === "idle" ? this.dict.error ?? "" : ""))
        .when(Boolean(this.addr), (el) => el.children(this.pickParts(t, true)))
        .when(!this.addr && this.phase === "fresh" && Boolean(this.choice?.sel) && Boolean(cx), (el) => el.child(this.freshPick(t, cx)))
        .when(addonOn("voice"), (el) => el.child(this.round("chat-mic", "mods/chat/mic.svg", t, "ghost", (cx) => this.toggleDictation(cx))))
        // Nothing to send: the same button starts a call, also while the agent works (unless the
        // Voice add-on is off).
        .child(empty && ready && !blocked && this.addr && addonOn("voice")
          ? this.round("chat-send", "mods/chat/audio-lines.svg", t, "call", (cx) => this.toggleCall(cx))
          : this.round("chat-send", "mods/chat/send.svg", t, can ? "solid" : "off", can ? (cx) => this.send(cx) : null)))));
  }

  // ---- alerts ---------------------------------------------------------------------------------

  // While its terminal is parked behind this chat, Herdr doesn't see the agent: no sound, no
  // toast. So this does what Herdr does: a sound when it needs the person, or finished while
  // they weren't looking, and a toast unless they're looking; and looking marks done as seen.
  alerts(cx) {
    const k = terminals().find((x) => x.address === this.addr);
    // An Assistant's chat on screen is read (unread.js): its space's row in the sidebar goes back to normal.
    if (!this.thread && unread(k) && onScreen(k)) markRead(k);
    const st = k?.status ?? null;
    const mine = this.myPane();
    const parked = Boolean(k) && !panes().some((p) => p.terminal === this.addr);
    const looking = Boolean(mine) && focused()?.pane === mine && window()?.active;
    if (parked && looking && st === "done") {
      const seen = shared("chat.seen") ?? {};
      if (seen[this.addr] !== k.turn) setShared("chat.seen", { ...seen, [this.addr]: k.turn });
    }
    const before = this.lastStatus;
    this.lastStatus = st;
    if (!parked || before === undefined || before === st || !mine) return;
    if (st !== "blocked" && !(st === "done" && !looking)) return;
    // An Assistant follows its space's Notify (notify.js): a new reply only on All, nothing on Off.
    if (assistant(k) && !notifies(k, st === "done" ? "message" : "need")) return;
    if (settings()?.sounds?.enabled !== false) playSound(st);
    if (looking) return;
    const tab = panes().find((p) => p.pane === mine)?.tab;
    toast({
      title: `${toastWho(k)} · ${st === "blocked" ? "Needs you" : "Finished"}`,
      body: (st === "blocked" ? this.asking() : null) ?? k.title ?? "",
      level: st === "blocked" ? "alert" : "success",
      action: tab ? { name: "tab.select", args: { id: tab } } : undefined,
    });
  }

  // This chat's own pane: the agent's core label herdr.chat (set by the pane-chat switch).
  // ---- artifacts (mods/artifacts) -----------------------------------------------------------

  // Which artifact each publish in the conversation made: the first version this agent
  // published from a few seconds before the call to five minutes after, not already taken.
  // Map item id -> { id, title, version (its latest), v (this publish's), latest }.
  resolveArts(items) {
    // core/chat-view.js: the web app's chat finds them the same way.
    return resolveArtifacts(items, this.arts, String(this.addr ?? "").split("/").pop());
  }

  // Every artifact on the agent's machine (~/.herdr/artifacts, one registry per folder): read
  // when the conversation has a publish, again every few seconds while one isn't listed yet.
  // A folder under a hidden one has a dot slug (~/.config/x: .config-x.json), so dot files
  // count too; locks end in .lock, temp files have no .json.
  loadArts(cx) {
    if (this.artsLoading || Date.now() - (this.artsAt ?? 0) < 3000) return;
    this.artsLoading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", 'cd "$HOME/.herdr/artifacts" 2>/dev/null || exit 0; for f in *.json .*.json; do [ -f "$f" ] && cat "$f" && printf "\\n\\036\\n"; done; true'], this.machine ? { on: this.machine } : {});
        const arts = [];
        for (const part of r.stdout.split("\x1e")) { try { arts.push(...(JSON.parse(part).artifacts ?? [])); } catch {} }
        this.arts = arts;
      } catch {}
      this.artsAt = Date.now();
      this.artsLoading = false;
      cx.notify();
    });
  }

  // An artifact over this chat pane, exactly like an opened image: the image viewer's shell (the
  // person's decision; Ctrl+K opens the same, artview.js). A "Published X v2" line opens v2; the
  // card, the latest.
  openArtifact(row) {
    openViewer({ id: row.art, title: row.title, version: row.line && row.v ? row.v : row.version, latest: row.version, machine: this.machine ?? null }, this.paneArea());
  }

  myPane() {
    if (!this.addr && this.role) return this.slotPane();
    // A thread's pane is the one its opener recorded for this worker (openThread()).
    if (this.thread) return threadOf(this.addr);
    const c = terminals().find((x) => x.address === this.addr)?.labels?.["herdr.chat"] ?? null;
    if (c && panes().some((p) => p.pane === c && p.mod === "chat")) this.lastPane = c;
    return c || (this.swapping ? this.lastPane : null);
  }

  // One copy of Herdr's live lists for the whole render (live.js): a render past Herdr's 50 ms
  // is stopped, and the chat then shows "This view could not be re-rendered".
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw(cx) {
    if (this.host) return this.host.render(cx);
    // The pane getting focus (opened, clicked, gone to) puts the keyboard in the message box.
    const mine = this.myPane();
    const paneFocused = Boolean(mine && focused()?.pane === mine);
    // Herdr settles pane focus a moment later, so ask again after it (as the help mod does).
    // The box also comes back after a notice (opening, restarting): it gets the keyboard then too.
    const showsBox = Boolean(this.addr) && this.phase === "ready";
    // Focus moves only outside render: from a timer callback right after it.
    if (paneFocused && showsBox && (!this.wasFocused || !this.hadBox)) { cx.timer.after(0, () => this.box.focus()); cx.timer.after(600, () => this.box.focus()); }
    // The pane focused again (a command, a click on its header) can leave the box without the
    // keyboard: give it back, unless the person just pressed something inside the chat.
    else if (paneFocused && showsBox && !this.call && this.focused === false && Date.now() - (this.press?.at ?? 0) > 1500
      && Date.now() - (this.refocusAt ?? 0) > 1000) {
      this.refocusAt = Date.now();
      cx.timer.after(0, () => this.box.focus());
    }
    this.wasFocused = paneFocused;
    this.hadBox = showsBox;
    this.paneFocused = paneFocused;
    // The call bar elsewhere (mods/chat-call) ends a call through shared "chat.callreq" =
    // { pane, at, action: "end" }.
    const req = shared("chat.callreq");
    if (req && req.pane === mine && req.at !== this.callReqAt && Date.now() - req.at < 5000) {
      this.callReqAt = req.at;
      if (req.action === "end" ? this.call : true) cx.timer.after(0, (cx) => { this.toggleCall(cx); cx.notify(); });
    }
    // The model picker's Restart (mods/chat-models): shared "chat.restartreq" = { pane, at, pick }.
    const rr = shared("chat.restartreq"), pk = this.pickKey();
    if (rr && pk && rr.pane === pk && rr.at !== this.restartReqAt && Date.now() - rr.at < 5000) {
      this.restartReqAt = rr.at;
      cx.timer.after(0, (cx) => { this.applyPick(rr.pick, cx); cx.notify(); });
    }
    // The header's Terminal on a chat with no agent yet (pane-chat): start it, then show its
    // terminal. Shared "chat.startreq" = { pane, at }.
    const stq = shared("chat.startreq");
    if (stq && stq.pane === mine && stq.at !== this.startReqAt && Date.now() - stq.at < 5000 && this.phase === "fresh") {
      this.startReqAt = stq.at;
      cx.timer.after(0, (cx) => { this.startAgent(null, cx, true); });
    }
    // Another mod sending a message as if typed here: shared "chat.sendreq" = { pane, at, text }.
    const sq = shared("chat.sendreq");
    if (sq && sq.pane === mine && sq.at !== this.sendReqAt && Date.now() - sq.at < 5000 && String(sq.text ?? "").trim()) {
      this.sendReqAt = sq.at;
      cx.timer.after(0, (cx) => { this.deliver({ id: `m${Date.now()}`, text: String(sq.text).trim(), files: [], quote: null }, cx); this.pinned = true; this.stick = true; cx.notify(); });
    }
    // Words put in the box for the person to send (the Inbox's "Merge HAT-1"): shared
    // "chat.prefillreq" = { pane, at, text }. What they had typed stays, below.
    const pq = shared("chat.prefillreq");
    if (pq && pq.pane === mine && pq.at !== this.prefillReqAt && Date.now() - pq.at < 10000 && String(pq.text ?? "").trim()) {
      this.prefillReqAt = pq.at;
      cx.timer.after(0, () => {
        const had = this.box.value().trim();
        this.box.set_value(had && !had.startsWith(pq.text) ? `${pq.text}\n\n${had}` : had || String(pq.text));
        this.box.focus();
      });
    }
    // The emoji row's pick (mods/chat-react): shared "chat.reactreq" = { pane, at, target, text, emoji }.
    // A thread asked for (the Tasks panel, the Inbox): shared "chat.threadreq" = { terminal,
    // task, title, space, at }; the coordinator chat in that space opens it.
    const tq = shared("chat.threadreq");
    if (tq && tq.at !== this.threadReqAt && Date.now() - tq.at < 5000 && this.role === "coordinator" && mine) {
      const tab = panes().find((p) => p.pane === mine)?.tab;
      const space = spaces().find((x) => x.tabs.some((t) => t.id === tab))?.id;
      // A worker runs as its coordinator's hc child, with no space of its own: its parent's chat
      // takes it; one whose parent shows no chat goes to the coordinator of the space asked.
      const parent = terminals().find((k) => k.address === tq.terminal)?.parent ?? null;
      const pc = parent && terminals().find((k) => k.address === parent)?.labels?.["herdr.chat"];
      const parentChat = Boolean(pc) && panes().some((p) => p.pane === pc && p.mod === "chat");
      if (parent === this.addr || (!parentChat && (!tq.space || tq.space === space))) {
        this.threadReqAt = tq.at;
        setShared("chat.threadack", tq.at);
        cx.timer.after(0, () => this.openThread(tq));
      }
    }
    const rq = shared("chat.reactreq");
    if (rq && rq.pane === mine && rq.at !== this.reactReqAt && Date.now() - rq.at < 5000) {
      this.reactReqAt = rq.at;
      cx.timer.after(0, (cx) => { this.toggleReaction(rq.target, rq.text, rq.emoji, cx); });
    }
    // In a call, the call takes the keyboard when the pane does.
    if (this.call && paneFocused && !this.callHadFocus) cx.timer.after(0, () => { if (this.call) this.callFocus.focus(); });
    this.callHadFocus = Boolean(this.call && paneFocused);
    this.alerts(cx);
    const t = theme();
    const st = this.status() ?? null;
    if (st === "working" && this.lastWorking !== "working") this.workingSince = Date.now();
    if (st !== "working") this.stopping = false;
    this.lastWorking = st;
    const root = v_flex().id("chat").size_full().bg(t.background).text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.width) > 1) this.width = size.width;
        this.height = size.height;
        if (this.pinned) this.stick = true;
        this.noteArea(null);
        cx.notify();
      })
      .on_mouse_move((e) => { if (e.bounds) this.noteArea(e.bounds); })
      // Where a press was, for the action buttons under messages (rows can't take handlers).
      .on_mouse_down("left", (e) => { this.press = { x: e.local_position?.x, y: e.local_position?.y, at: Date.now() }; this.pressWin = e.position; this.keepIcons = null; if (e.bounds) this.noteArea(e.bounds); })
      // Files dropped anywhere on the chat go with the next message.
      .on_drop((e, cx) => { this.addFiles(attach.paths(e.paths ?? [])); this.saveSoon(cx); this.box.focus(); cx.notify(); });

    // Starting (or the new agent's log not there yet): the person's message shows at once.
    const starting = (this.phase === "starting" || (this.phase === "finding" && this.role && !this.path)) && this.pending.length > 0;
    if (this.phase === "fresh") {
      return root.child(this.fresh(t)).child(this.composer(t, null, cx)).child(div().flex_none().h(12));
    }
    if (!this.addr && !starting) return root.child(this.notice(t, WORDS.noAgent, WORDS.noAgentBody, [
      this.button("chat-close", "Close", null, "secondary", t, () => this.closeSelf())]));
    // A thread whose worker ended before its conversation was read: the same quiet words.
    if (this.phase === "ended" && this.thread) return root.child(this.notice(t, WORDS.taskEnded, null, [
      ...(this.taskKey ? [this.button("chat-resume", this.resuming ? WORDS.resuming : "Resume",null, "primary", t, (cx) => this.resumeTask(cx))] : []),
      this.button("chat-close", this.inner ? "Back to tasks" : "Close", null, "secondary", t, () => this.closeSelf())]));
    if (this.phase === "ended" && !this.swapping) return root.child(this.notice(t, WORDS.agentEnded, null, [
      this.button("chat-close", "Close chat", null, "secondary", t, () => this.closeSelf())]));
    const open = this.button("chat-open-terminal", WORDS.openTerminal,"mods/workspace-chrome/terminal.svg", "primary", t, () => this.toTerminal());
    if (this.phase === "unsupported") return root.child(this.notice(t, WORDS.unsupported, WORDS.unsupportedBody, [open]));
    if (this.phase === "none") return root.child(this.notice(t, WORDS.notFound, WORDS.notFoundBody, [open]));
    if ((this.phase === "finding" && !starting) || this.phase === "ended") return root.child(this.notice(t, this.swapping ? WORDS.restarting : WORDS.opening, null));

    this.sizeBox();
    // An Assistant's chat: its tasks' workers' asks, before the rows (their live rows say so).
    this.wasks = this.workerAsks(cx);
    // Secrets asked for: this agent's, and its workers' (shown with their asks); another machine's
    // agents using one are answered from here (secrets.js serveRemote()).
    this.sasks = this.addr ? this.secretCards.items(this.addr) : [];
    this.secretCards.prepare([...this.sasks, ...this.wasks.filter((a) => a.secret).map((a) => a.secret)], cx);
    secrets.serveRemote(terminals());
    if (this.focusSecret) {
      const ask = this.sasks.find((a) => !a.kept) ?? this.wasks.find((a) => a.secret)?.secret;
      if (Date.now() - this.focusSecret > 5000) this.focusSecret = null;
      else if (ask && this.secretCards.ready(ask)) { this.focusSecret = null; cx.timer.after(0, () => this.secretCards.focus(ask)); }
    }
    const rows = this.rows();
    // First-seen times this render found (seenAt()), shared once it's done; the newest 60 kept.
    if (this.seenNew && !this.seenFlush) {
      this.seenFlush = true;
      cx.timer.after(0, () => {
        const all = { ...(shared("chat.cardseen") ?? {}), ...this.seenNew };
        this.seenNew = null; this.seenFlush = false;
        setShared("chat.cardseen", Object.fromEntries(Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 60)));
      });
    }
    // A publish the registry doesn't list yet: read it again in a few seconds.
    if (rows.some((r) => r.kind === "artifact" && r.pending) || (this.conv?.items ?? []).some((x) => x.kind === "artifact") && !this.arts) {
      this.loadArts(cx);
      if (!this.artsTick) { this.artsTick = true; cx.timer.after(3500, (cx) => { this.artsTick = false; cx.notify(); }); }
    }
    // Find: the current match's row comes into view once per step.
    const found = this.finding ? this.findMatches(rows) : [];
    const current = found.length ? this.findRow(found) : null;
    if (this.findJump && current) { this.findJump = false; this.pinned = false; this.scroll.scroll_to_item(current.index, "center"); }
    const lit = new Set(found.map((m) => m.id));
    this.needViews([...this.files.filter((f) => f.image).map((f) => f.path), ...rows.flatMap((r) => (r.kind === "imgs" ? r.paths : []))], cx);
    // What sits under the list (an ask card, the working line) changes its height: stay on the newest.
    const below = `${this.asks.length}|${this.sasks.map((a) => a.name + (a.kept ? "+" : "")).join(",")}|${this.wasks.map((a) => a.id).join(",")}|${[this.addr, ...this.workerTasks().keys()].map((a) => openCard(a)?.id ?? "").join("")}|${st}|${this.focused}|${this.queue.length}|${Boolean(this.call)}|${this.files.length}|${Boolean(this.quote)}`;
    if (below !== this.below) { this.below = below; if (this.pinned) this.stick = true; }
    if (Math.abs(this.heightsFor - this.width) > 1) { this.heights.clear(); this.measuredAt.clear(); this.heightsFor = this.width; this.measureGen++; }
    const keys = rows.map((x) => this.key(x));
    // Every size a real number of pixels: one NaN, zero or runaway height leaves the list blank.
    const sizes = rows.map((x, i) => {
      const h = this.heights.get(keys[i]) ?? this.guess(x);
      return Number.isFinite(h) && h > 0 ? Math.min(h, 40000) : 60;
    });
    this.follow_bottom(rows);
    // Following the newest, the list sits at its end: the scroll position is exactly that.
    if (this.pinned && this.listH) this.scrollTop = Math.max(0, sizes.reduce((a, b) => a + b, 0) - (this.listH - 8));
    const body = rows.length === 0
      ? this.notice(t, "No messages", "Write to the agent below.")
      : v_flex().relative().flex_1().min_h(0).pt(8)
        .id("chat-body")
        .on_size_change((size, cx) => {
          const was = this.listH;
          this.listH = size.height;
          if (was && Math.abs(was - size.height) > 0.5 && this.pinned) { this.stick = true; cx.notify(); }
        })
        // How far down the list a press was, for the action bands (rows take no handlers).
        .on_mouse_down("left", (e) => { this.bodyPress = e.local_position?.y; })
        // Rows' hover styles show on a redraw: one per 6 px the pointer moves down or up.
        .on_mouse_move((e, cx) => {
          const b = Math.floor((e.local_position?.y ?? 0) / 6);
          if (b !== this.hoverBand) { this.hoverBand = b; cx.notify(); }
        })
        .on_hover((hovered, cx) => { if (!hovered) { this.hoverBand = null; cx.notify(); } })
        .on_scroll_wheel((e, cx) => {
          const y = e.delta?.y ?? 0;
          // Where the list is scrolled to, as near as known (the list doesn't say): wheel moves it.
          this.scrollTop = Math.max(0, (this.scrollTop ?? 0) - y);
          // Scrolling up to read stops following the newest; back at the bottom follows again.
          if (y > 0 && this.pinned) { this.pinned = false; cx.notify(); }
          if (y < 0 && !this.pinned && this.range && this.range.end >= rows.length) { this.pinned = true; cx.notify(); }
          if (y > 0 && (this.range?.start ?? 9) <= 1) this.loadEarlier(cx);
        })
        .child(v_virtual_list("chat-rows", rows.length, sizes, (i) => rows[i].id, (range) => {
          this.range = range;
          if (rows.length && !(range.end > range.start)) this.blank = true;
          // The first row on screen bounds the scroll position: keep the estimate inside it.
          const top = sizes.slice(0, range.start).reduce((a, b) => a + b, 0);
          if ((this.scrollTop ?? 0) < top || (this.scrollTop ?? 0) >= top + (sizes[range.start] ?? 0)) this.scrollTop = top;
          return rows.slice(range.start, range.end).map((x, j) => {
            const flash = this.flash && (x.id === this.flash.id || String(x.id).startsWith(`${this.flash.id}:`));
            return div().relative().w_full().h(sizes[range.start + j]).when(!x.bar || x.kind === "band", (el) => el.overflow_hidden())
              // Find: rows with matches tinted, the current one more.
              .when(lit.has(x.id), (el) => el.child(div().absolute().inset_0().rounded(10).bg(t.accent + (current?.id === x.id ? "38" : "14"))))
              // Ids carry the width's generation, as the measurer's do: a reply's words keep the
              // width they were first laid out at, so after a resize (a restart's first narrow
              // frames) they'd stay narrow and tall, spilling under the next row.
              .child(this.row(x, t, `v${this.measureGen}-`))
              .when(Boolean(flash), (el) => el.child(div().id(`flash-${x.id}`).absolute().inset_0().rounded(10).bg(t.accent + "26")
                .opacity(this.flash.on ? 1 : 0).transition("opacity", { duration: 1100, easing: "ease-out" })));
          });
        })
          .track_scroll(this.scroll).size_full()
          .on_item_click((key, cx) => this.clickRow(key, rows, cx, sizes)))
        .child(Scrollbar.vertical("chat-rows").absolute().inset_0())
        .child(this.measurer(rows, keys, t))
        // Cards' controls measured (strips.js hit()), and where question cards' keys come in.
        .child(strips.measure(t, rows.filter((r) => r.kind === "cardstrip").map((r) => r.s), this.cardW, (cx) => cx.notify())
          .child(div().id("mw-accept").flex_none().on_size_change((size, cx) => { if (this.cardW.get("accept") !== size.width) { this.cardW.set("accept", size.width); cx.notify(); } })
            .child(this.acceptButton(false))))
        .child(this.cards.sink("own")).child(this.workerCards.sink("worker"))
        .when(!this.pinned, (el) => {
          // Scrolled up: a card waiting below what's shown is pointed to; else the newest.
          const below = rows.map((r, i) => (r.kind === "cardstrip" && r.first && i >= (this.range?.end ?? rows.length) ? i : -1)).filter((i) => i >= 0);
          const label = questionsBelow(below.length);
          return el.child(h_flex().absolute().bottom(10).left(0).right(0).justify_center()
            .child(h_flex().id("chat-latest").h(26).px(10).gap(5).items_center().rounded(13).cursor_pointer()
              .bg(t.popover).border_1().border_color(t.border).shadow_md().text_size(12).text_color(t.muted)
              .hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => {
                if (below.length) this.scroll.scroll_to_item(below[0], "center");
                else { this.pinned = true; this.stick = true; }
                cx.notify();
              })
              .when(below.length > 0, (el) => el.child(div().size(6).flex_none().rounded(3).bg(red())))
              .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none()).child(label)));
        });
    return root
      .when(this.finding, (el) => el.child(this.findBar(t, rows)))
      .child(body)
      .when(Boolean(this.error), (el) => el.child(div().flex_none().px(18).py(4).text_size(12).text_color(t.blocked).truncate().child(this.error)))
      .child(this.statusLine(t, st) ?? div())
      .child(this.callBar(t) ?? div())
      .child(this.queued(t) ?? div())
      .child(this.background(t, st) ?? div())
      .child(this.composer(t, st))
      .child(div().flex_none().h(12));
  }

  // Rows not measured yet, drawn once out of sight at the list's width; their heights go to
  // the list, which then places every row exactly. Those near what is shown go first.
  measurer(rows, keys, t) {
    const near = this.anchor && Date.now() < this.anchor.until
      ? Math.max(0, rows.findIndex((r) => r.id === this.anchor.id))
      : this.range ? this.range.start : rows.length - 1;
    // Rows never measured, nearest first; and, measured again, the rows on screen and those
    // measured in the last few seconds: markdown can lay out a moment after its first frame (a
    // long message first measures as one line), so a height is never taken once and kept.
    const now = Date.now();
    const lo = Math.max(0, (this.range?.start ?? rows.length) - 2), hi = Math.min(rows.length, (this.range?.end ?? 0) + 2);
    const fresh = rows.map((_, i) => i).filter((i) => !this.heights.has(keys[i]))
      .sort((a, b) => Math.abs(a - near) - Math.abs(b - near)).slice(0, 30);
    const again = rows.map((_, i) => i).filter((i) => this.heights.has(keys[i]) && ((i >= lo && i < hi) || now - (this.measuredAt.get(keys[i]) ?? 0) < 4000));
    const order = [...new Set([...fresh, ...again])].slice(0, 60);
    return div().absolute().top(0).left(0).w(this.width).h(0).overflow_hidden().opacity(0)
      .child(v_flex().w_full().children(order.map((i) => div().id(`m${this.measureGen}-${keys[i]}`).flex_none().w_full()
        .on_size_change((size, cx) => {
          if (!this.measuredAt.has(keys[i])) this.measuredAt.set(keys[i], Date.now());
          if (this.heights.get(keys[i]) === size.height) return;
          this.heights.set(keys[i], size.height);
          if (this.pinned) this.stick = true;
          if (this.anchor && Date.now() < this.anchor.until) this.reanchor = true;
          cx.notify();
        })
        .child(this.row(rows[i], t, "m-")))));
  }
}
