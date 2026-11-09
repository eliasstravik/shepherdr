// The card that answers what Claude asks through the PermissionRequest hook (asks.js): a
// permission or a plan (Allow / Deny), or questions (AskUserQuestion: steps, options, "Other…",
// "Chat about this", one Submit). The chat shows it in the conversation where it was asked, as
// strips of the timeline (strips.js). The host does the rest: host.reply(ask, text, cx) sends
// the hook its answer, host.toTerminal(ask, cx) shows the agent's terminal,
// host.chatAbout(ask, cx) goes where the person can write to it.
// Every card the chat shows (these, a secret's, a CLI's start screen) starts with one header
// strip (headStrip()): a red dot, "Claude asks" or "HERD-12 asks", quiet links at the right.
// Every ask's header ends with "Dismiss" (Esc too, once the card is pressed): closed without an
// answer, as Esc in Claude's prompt; the agent hears it was declined and carries on.

import { div } from "gpui-kit";
import { InputState } from "gpui-base";
import { allow, deny, answer, answers, annotationsOf, chatAbout, dismiss, release } from "./core/asks.js";

// A card's first strip. opts: { who ("Claude", "HERD-12"), asks (false: what follows `who`
// instead, e.g. "Kept"), dot (its color; default red), links ([ctl] at the right) }.
export const headStrip = (opts) => ({ key: "head", kind: "head", who: opts.asks === false ? opts.who : `${opts.who ?? "Claude"} asks`, dot: opts.dot, links: opts.links ?? [] });

// A quiet link of a card's header (strips.js ctl).
export const linkCtl = (id, label, fn) => ({ id, label, look: "link", fn });

// A request's detail: every line, wrapped, in a box. Long ones fold to SHORT px with "Show all"
// in the header (open: the set of unfolded ids); unfolded, the whole of it scrolls with the chat.
const SHORT = 180;
const longDetail = (detail) => detail.split("\n").length > 9 || detail.length > 900;

export class AskCards {
  // focus: the handle the question cards' keys come through (sink()).
  constructor(host, focus) {
    this.host = host;
    this.focus = focus;
    this.states = new Map();
    // Asks whose long detail is unfolded ("Show all").
    this.open = new Set();
    // The questions card the keys go to (the last one pressed).
    this.keyed = null;
  }

  // The strips of one ask's card. opts: { who (whose ask: "Claude", "HERD-12"), links (more
  // quiet links at the header's right, e.g. "Open chat"), terminal (the "Answer in terminal"
  // link; default on), chatHint (what "Chat about this" says) }.
  strips(ask, opts = {}) {
    const w = ask.words;
    if (w.kind === "questions" && w.questions.length) return this.questions(ask, opts);
    const id = ask.id;
    const long = Boolean(w.detail) && longDetail(w.detail);
    const open = this.open.has(id);
    const links = [...(opts.links ?? []),
      ...(long ? [linkCtl(`ask-all-${id}`, open ? "Show less" : "Show all", () => { if (open) this.open.delete(id); else this.open.add(id); })] : []),
      ...(opts.terminal !== false ? [this.terminalLink(ask)] : []), this.dismissLink(ask)];
    const out = [headStrip({ who: opts.who, links }), { key: "title", kind: "title", text: w.title }];
    if (w.detail) out.push({ key: "detail", kind: "detail", lines: w.detail.split("\n"), clip: long && !open ? SHORT : null });
    if (w.cut) out.push({ key: "cut", kind: "text", tone: "dim", text: "Some of it is too long for the chat; the terminal shows it all." });
    if (w.kind === "question") {
      // A question's choices, each a whole-width row (a row of buttons could run past the card).
      w.options.forEach((o, i) => out.push({ key: `opt${i}`, kind: "option", gap: i ? 2 : 8, num: i + 1, label: o.label,
        fn: (cx) => this.host.reply(ask, answer(ask.req, o.label), cx) }));
    } else {
      const ctls = [];
      // Always answerable here; only a request the chat couldn't read at all goes to the terminal.
      if (!w.unread) ctls.push({ id: `ask-allow-${id}`, label: w.kind === "plan" ? "Approve" : "Allow", look: "primary", fn: (cx) => this.host.reply(ask, allow(), cx) });
      ctls.push({ id: `ask-deny-${id}`, label: w.kind === "plan" ? "Keep planning" : "Deny", look: "secondary",
        fn: (cx) => this.host.reply(ask, w.kind === "plan" ? deny("The person didn't approve this plan yet. Ask them what to change.") : deny(), cx) });
      out.push({ key: "actions", kind: "controls", align: "start", ctls });
    }
    return out;
  }

  // "Answer in terminal": a quiet link, always at the header's right.
  terminalLink(ask) {
    return linkCtl(`ask-terminal-${ask.id}`, "Answer in terminal", (cx) => { this.drop(ask); this.host.reply(ask, release(), cx); this.host.toTerminal(ask, cx); });
  }

  // "Dismiss": a quiet link, the header's last.
  dismissLink(ask) {
    return linkCtl(`ask-dismiss-${ask.id}`, "Dismiss", (cx) => this.dismiss(ask, cx));
  }

  dismiss(ask, cx) {
    this.drop(ask);
    this.host.reply(ask, dismiss(ask.words.kind), cx);
  }

  // ---- questions (AskUserQuestion) ----------------------------------------------------------

  // Per ask: the step shown, each question's picks, its "Other" words (and their box).
  state(ask) {
    let q = this.states.get(ask.id);
    if (!q) {
      q = { step: 0, picks: ask.words.questions.map(() => new Set()), other: ask.words.questions.map(() => null), boxes: [] };
      this.states.set(ask.id, q);
    }
    return q;
  }

  answerOf(ask, q, i) {
    const qq = ask.words.questions[i];
    const other = q.boxes[i]?.value().trim() || q.other[i]?.trim();
    if (q.other[i] !== null && other) return other;
    return [...q.picks[i]].sort((a, b) => a - b).map((k) => qq.options[k].name).join(", ");
  }

  done(ask, q) {
    return ask.words.questions.every((_, i) => this.answerOf(ask, q, i));
  }

  // Forgets an ask's state (its "Other" boxes too): when it's answered or gone.
  drop(ask) {
    const q = this.states.get(ask.id);
    for (const b of q?.boxes ?? []) b?.release();
    this.states.delete(ask.id);
    this.open.delete(ask.id);
    if (this.keyed?.id === ask.id) this.keyed = null;
  }

  // Drops the state of asks no longer there.
  keep(ids) {
    for (const id of [...this.states.keys(), ...this.open]) if (!ids.includes(id)) this.drop({ id });
  }

  // Words written in the chat's box instead of on the card. One question left to answer takes
  // them as its "Other" answer (the others keep their picks); a permission, a plan, or several
  // questions still open are declined with them, so the agent reads what the person said.
  replyWith(ask, text, cx) {
    if (ask.words.kind === "questions") {
      const q = this.state(ask);
      const open = ask.words.questions.filter((_, i) => !this.answerOf(ask, q, i));
      if (open.length === 1) {
        const map = Object.fromEntries(ask.words.questions.map((qq, i) => [qq.text, this.answerOf(ask, q, i) || text]));
        this.drop(ask);
        this.host.reply(ask, answers(ask.req, map), cx);
        return;
      }
    }
    this.drop(ask);
    this.host.reply(ask, deny(`The person didn't use the card and wrote in the chat instead: ${text}`), cx);
  }

  submit(ask, cx) {
    const q = this.state(ask);
    if (!this.done(ask, q)) return;
    const map = Object.fromEntries(ask.words.questions.map((qq, i) => [qq.text, this.answerOf(ask, q, i)]));
    this.drop(ask);
    this.host.reply(ask, answers(ask.req, map, annotationsOf(ask.words, map)), cx);
  }

  // A press on one of this ask's strips: its card takes the keys (Esc; a questions card's arrows,
  // Tab, digits too).
  pressed(ask) {
    this.keyed = ask;
    this.focus.focus();
  }

  // Where the keys come in: out of sight, outside the list (rows take no handlers).
  sink(name) {
    return div().id(`ask-keys-${name}`).absolute().size(0).track_focus(this.focus)
      .on_key_down((e, cx) => { if (this.keyed) this.key(this.keyed, e, cx); });
  }

  key(ask, e, cx) {
    if (e.key === "escape") { cx.stop_propagation(); this.dismiss(ask, cx); cx.notify(); return; }
    if (ask.words.kind !== "questions" || !ask.words.questions.length) return;
    const w = ask.words, q = this.state(ask), n = w.questions.length;
    const last = n > 1 ? n : n - 1, step = Math.min(q.step, last);
    const k = e.key;
    if (k === "right" || k === "tab") { cx.stop_propagation(); this.go(ask, step + 1); }
    else if (k === "left") { cx.stop_propagation(); this.go(ask, step - 1); }
    else if (/^[1-9]$/.test(k) && step < n && Number(k) <= w.questions[step].options.length) { cx.stop_propagation(); this.pick(ask, step, Number(k) - 1); }
    else return;
    cx.notify();
  }

  go(ask, k) {
    const q = this.state(ask), n = ask.words.questions.length;
    q.step = Math.max(0, Math.min(n > 1 ? n : n - 1, k));
  }

  pick(ask, i, k) {
    const w = ask.words, q = this.state(ask), n = w.questions.length, qq = w.questions[i];
    if (qq.multi) { if (q.picks[i].has(k)) q.picks[i].delete(k); else q.picks[i].add(k); }
    else {
      q.picks[i] = new Set([k]); q.other[i] = null;
      // one pick moves on, unless it has previews: it stays to show the one picked (SHEP-139)
      if (qq.options.some((o) => o.preview)) return;
      if (n > 1 && i < n - 1) q.step = i + 1; else if (n > 1) q.step = n;
    }
  }

  // "Other…": its box, made here (never in render), then the keyboard in it.
  openOther(ask, i, cx) {
    const q = this.state(ask);
    q.other[i] = q.other[i] ?? "";
    if (!ask.words.questions[i].multi) q.picks[i] = new Set();
    if (!q.boxes[i]) { q.boxes[i] = InputState.new({ placeholder: "Your answer" }); q.boxes[i].on("change", (_e, cx) => cx.notify()); }
    const box = q.boxes[i];
    cx.timer.after(0, () => box.focus());
  }

  // One card for the whole ask: steps when there are several questions (and a last one to
  // check the answers), options as rows (one, or several), "Other…" to write one, "Chat about
  // this" to talk instead; one Submit. Arrows or Tab move between steps, digits pick.
  questions(ask, opts) {
    const w = ask.words, q = this.state(ask), id = ask.id;
    const n = w.questions.length, many = n > 1;
    const last = many ? n : n - 1;
    const step = Math.min(q.step, last);
    const links = [...(opts.links ?? []), ...(opts.terminal !== false ? [this.terminalLink(ask)] : []), this.dismissLink(ask)];
    const out = [headStrip({ who: opts.who, links })];
    if (many) {
      out.push({ key: "title", kind: "title", text: `${n} questions` });
      out.push({ key: "steps", kind: "controls", align: "start", ctls: [...w.questions.map((qq, i) => ({ label: qq.header || `Question ${i + 1}`, i })), { label: "Submit", i: n }]
        .map(({ label, i }) => ({ id: `q-step-${id}-${i}`, label, look: "pill", on: i === step, done: i < n && Boolean(this.answerOf(ask, q, i)), fn: () => this.go(ask, i) })) });
    }
    if (step === n) {
      // The answers to check, each opening its question again.
      w.questions.forEach((qq, i) => {
        const a = this.answerOf(ask, q, i);
        out.push({ key: `review${i}`, kind: "review", gap: i ? 4 : 8, label: qq.header || qq.text, answer: a || "Not answered", missing: !a, fn: () => this.go(ask, i) });
      });
    } else {
      const qq = w.questions[step];
      out.push({ key: `q${step}`, kind: "title", text: qq.text });
      if (qq.multi) out.push({ key: `multi${step}`, kind: "text", tone: "dim", gap: 2, text: "Pick any that apply." });
      qq.options.forEach((o, k) => out.push({ key: `q${step}-${k}`, kind: "option", gap: k ? 2 : 6, on: q.picks[step].has(k), multi: qq.multi,
        label: o.name, desc: o.description, tag: o.recommended ? "Recommended" : null, fn: () => this.pick(ask, step, k) }));
      // The picked option's preview (else the first one's), as Claude's prompt shows the one in focus (SHEP-139).
      const shown = !qq.multi && q.picks[step].size === 1 && qq.options[[...q.picks[step]][0]]?.preview ? [...q.picks[step]][0] : qq.options.findIndex((o) => o.preview);
      if (!qq.multi && shown >= 0) {
        out.push({ key: `q${step}-preview-label`, kind: "text", tone: "dim", gap: 6, text: `Preview · ${qq.options[shown].name}` });
        out.push({ key: `q${step}-preview`, kind: "detail", gap: 2, lines: qq.options[shown].preview.split("\n"), clip: null });
      }
      out.push({ key: `q${step}-other`, kind: "option", gap: 2, on: q.other[step] !== null, multi: qq.multi, label: "Other…", fn: (cx) => this.openOther(ask, step, cx) });
      if (q.other[step] !== null) out.push({ key: `q${step}-box`, kind: "input", gap: 2, indent: 32, state: q.boxes[step] ?? null, placeholder: "Your answer" });
      out.push({ key: `q${step}-chat`, kind: "option", gap: 2, label: "Chat about this", desc: opts.chatHint ?? "Or type your answer below.",
        fn: (cx) => { this.drop(ask); this.host.reply(ask, chatAbout(), cx); this.host.chatAbout(ask, cx); } });
      if (many && (step < n - 1 || shown >= 0)) out.push({ key: `next${step}`, kind: "controls", align: "end", gap: 4, ctls: [{ id: `q-next-${id}-${step}`, label: "Next", look: "plain", fn: () => this.go(ask, step + 1) }] });
    }
    if (!many || step === n) {
      const ready = this.done(ask, q);
      out.push({ key: "submit", kind: "controls", align: "end", ctls: [{ id: `q-submit-${id}`, label: "Submit", look: "primary", disabled: !ready, fn: ready ? (cx) => this.submit(ask, cx) : null }] });
    }
    return out;
  }
}
