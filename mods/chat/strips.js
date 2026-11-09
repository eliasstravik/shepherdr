// A card in the conversation (DECISIONS, Chat: question/permission/plan/secret cards sit in
// the timeline where they appeared and scroll with it). The timeline is a virtual list, whose
// rows take no handlers, so a card is drawn as a run of strips, one list row each, that look
// like one card (the first has its top edge, the last its bottom). A strip is one line of
// things to press at most: the list says which strip was pressed (on_item_click) and the press
// says where along it (hit()), with each control's drawn width measured outside the list
// (measure()). A strip: { key, kind, gap (px above it), ... }:
//   head: { who, dot, tone (who's color), links: [ctl] }   who asks, quiet links at the right
//   title / text: { text, tone ("dim" | "muted" | "red" | "fg") }
//   detail: { lines, clip (px it folds to, or null) }      what is asked for, in a box
//   controls: { align ("start" | "end"), lead (words before), ctls: [ctl] }
//   option: { on, multi, num, label, tag, desc, fn }       a whole-width choice
//   review: { label, answer, missing, fn }                 an answer to check, opens its question
//   input: { state, indent, placeholder }                  a box to type in (native: no handler)
// A ctl: { id, label, look ("primary" | "secondary" | "plain" | "pill" | "link"), on, done,
// disabled, fn }. fn(cx) runs on a press.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import { button, red, RADIUS, TEXT } from "./ui.js";

const PAD = 12, LINK_GAP = 12;
const GAPS = { controls: 6, pill: 4 };

// A control as drawn, in a strip and in measure() alike: the shared button (ui.js) with the
// pointer and hover its click would give it, a pill, or a quiet link.
export function ctlEl(t, c, pre = "") {
  const live = !c.disabled && Boolean(c.fn);
  if (c.look === "link") return div().id(`${pre}${c.id}`).flex_none().whitespace_nowrap().text_size(TEXT.label).text_color(t.muted)
    .when(live, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground))).child(c.label);
  if (c.look === "pill") return h_flex().id(`${pre}${c.id}`).h(24).px(9).gap(5).flex_none().items_center().rounded(12).whitespace_nowrap().text_size(TEXT.label)
    .when(Boolean(c.on), (el) => el.bg(t.selected).text_color(t.foreground).font_medium())
    .when(!c.on, (el) => el.text_color(t.muted).when(live, (el) => el.hover((s) => s.bg(t.hover))))
    .when(live, (el) => el.cursor_pointer())
    .when(Boolean(c.done), (el) => el.child(svg("mods/chat/check.svg").size(11).flex_none().text_color(t.dim)))
    .child(c.label);
  return button(`${pre}${c.id}`, c.label, { kind: c.look ?? "secondary", disabled: Boolean(c.disabled) })
    .when(live, (el) => el.cursor_pointer().hover((s) => (c.look === "primary" ? s.opacity(0.88)
      : c.look === "plain" ? s.bg(t.hover).text_color(t.foreground) : s.bg(t.hover))));
}

const tone = (t, k) => ({ dim: t.dim, muted: t.muted, red: red(), fg: t.foreground })[k] ?? t.muted;

// What a strip's height depends on (main.js key()).
export function sig(s) {
  const n = (v) => String(v ?? "").length;
  return `${s.kind}.${s.gap ?? ""}.${n(s.text)}.${n(s.who)}.${(s.links ?? []).length}.${s.lines?.length ?? ""}.${s.clip ?? ""}.${n(s.label)}.${n(s.desc)}.${n(s.answer)}.${s.tag ? 1 : 0}.${(s.ctls ?? []).length}`;
}

// One strip, in the card's frame. first / last: whether it draws the card's top / bottom edge.
export function strip(t, s, first, last, pre = "") {
  const frame = v_flex().w_full().bg(t.surface).border_1().border_color(t.border).px(PAD)
    .pt(first ? 10 : s.gap ?? 8).pb(last ? 10 : 0)
    .when(!first, (el) => el.border_t(0)).when(!last, (el) => el.border_b(0))
    .when(first, (el) => el.rounded_t(RADIUS.card)).when(last, (el) => el.rounded_b(RADIUS.card));
  return frame.child(body(t, s, pre));
}

function body(t, s, pre) {
  switch (s.kind) {
    case "head":
      return h_flex().w_full().min_h(18).gap(LINK_GAP).items_center()
        .child(h_flex().flex_1().min_w(0).gap(8).items_center()
          .child(div().size(8).flex_none().rounded(4).bg(s.dot ?? red()))
          .child(div().min_w(0).truncate().text_size(TEXT.label).font_medium().text_color(s.dot ? t.muted : red()).child(s.who)))
        .when((s.links ?? []).length > 0, (el) => el.child(h_flex().flex_none().gap(LINK_GAP).items_center().children(s.links.map((c) => ctlEl(t, c, pre)))));
    case "title":
      return div().min_w(0).text_size(TEXT.body).font_medium().text_color(t.foreground).child(s.text);
    case "text":
      return div().min_w(0).text_size(TEXT.label).line_height("18px").text_color(tone(t, s.tone)).child(s.text);
    case "detail":
      return div().w_full().px(8).py(6).rounded(RADIUS.control).bg(t.background).overflow_hidden()
        .when(s.clip != null, (el) => el.max_h(s.clip))
        .text_size(TEXT.label).text_color(t.muted).children(s.lines.map((l) => div().min_w(0).child(l || " ")));
    case "controls":
      return h_flex().w_full().gap(s.ctls.every((c) => c.look === "pill") ? GAPS.pill : GAPS.controls).items_center()
        .when(s.align === "end", (el) => el.justify_end())
        .when(Boolean(s.lead), (el) => el.child(div().flex_none().pr(2).text_size(TEXT.label).text_color(t.dim).child(s.lead)))
        .children(s.ctls.map((c) => ctlEl(t, c, pre)));
    case "option": {
      const mark = s.num != null
        ? h_flex().w(18).h(19).flex_none().items_center().justify_center().rounded(5).bg(t.raised).text_size(TEXT.id).font_medium().text_color(t.muted).child(String(s.num))
        : div().size(14).flex_none().flex().items_center().justify_center().border_1().rounded(s.multi ? 3 : 7)
          .border_color(s.on ? t.accent : t.input).when(Boolean(s.on), (el) => el.bg(t.accent))
          .when(Boolean(s.on) && Boolean(s.multi), (el) => el.child(svg("mods/chat/check.svg").size(10).text_color(t.background)))
          .when(Boolean(s.on) && !s.multi, (el) => el.child(div().size(6).rounded(3).bg(t.background)));
      return h_flex().w_full().px(8).py(6).gap(10).items_start().rounded(RADIUS.card)
        .when(Boolean(s.disabled), (el) => el.opacity(0.6))
        .when(!s.disabled, (el) => el.cursor_pointer().hover((st) => st.bg(s.on ? t.selected : t.hover)))
        .when(Boolean(s.on), (el) => el.bg(t.selected))
        .child(div().pt(s.num != null ? 0 : 2).child(mark))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().gap(6).items_center().child(div().min_w(0).text_color(t.foreground).child(s.label))
            .when(Boolean(s.tag), (el) => el.child(div().px(6).h(16).flex_none().flex().items_center().rounded(4).bg(t.raised).text_size(TEXT.id).text_color(t.muted).child(s.tag))))
          .when(Boolean(s.desc), (el) => el.child(div().text_size(TEXT.label).text_color(t.dim).child(s.desc))));
    }
    case "review":
      return h_flex().w_full().px(8).py(6).gap(10).rounded(RADIUS.card).cursor_pointer().hover((st) => st.bg(t.hover))
        .child(div().w(150).flex_none().truncate().text_size(TEXT.label).text_color(t.dim).child(s.label))
        .child(div().flex_1().min_w(0).text_color(s.missing ? red() : t.foreground).child(s.answer));
    case "input":
      return div().w_full().pl(s.indent ?? 0).child(div().h(32).px(8).flex().items_center().rounded(RADIUS.control)
        .border_1().border_color(t.input).bg(t.background)
        .child(s.state ? Input.new(s.state).w_full().text_size(TEXT.body).text_color(t.foreground)
          : div().text_size(TEXT.body).text_color(t.dim).child(s.placeholder ?? "")));
    default:
      return div();
  }
}

// The controls a press at x (in the pane) lands on, or null. inner: the card's inside edges in
// the pane ({ left, right }); widths: measured control widths by id.
export function hit(s, x, inner, widths) {
  if (x == null) return null;
  if (s.kind === "option" || s.kind === "review") return s.disabled || !s.fn ? null : s;
  if (s.kind === "input") return s;
  const w = (c) => widths.get(c.id) ?? String(c.label).length * 7 + 18;
  const run = (ctls, gap, end, from) => {
    if (end) {
      let r = from;
      for (const c of [...ctls].reverse()) { const l = r - w(c); if (x >= l - 2 && x <= r + 2) return c; r = l - gap; }
    } else {
      let l = from;
      for (const c of ctls) { const r = l + w(c); if (x >= l - 2 && x <= r + 2) return c; l = r + gap; }
    }
    return null;
  };
  let c = null;
  if (s.kind === "head") c = run(s.links ?? [], LINK_GAP, true, inner.right);
  if (s.kind === "controls") {
    const gap = s.ctls.every((k) => k.look === "pill") ? GAPS.pill : GAPS.controls;
    if (s.align === "end") c = run(s.ctls, gap, true, inner.right);
    else c = run(s.ctls, gap, false, inner.left + (s.lead ? (widths.get(`lead:${s.lead}`) ?? s.lead.length * 7 + 2) + gap : 0));
  }
  return c && !c.disabled && c.fn ? c : null;
}

// The card's inside edges, given the column's (main.js edges()): its border and padding in.
export const innerOf = ({ left, right }) => ({ left: left + 1 + PAD, right: right - 1 - PAD });

// Every control of these strips drawn once out of sight, each reporting its width (for hit()).
// Built in render, outside the list, where handlers are allowed.
export function measure(t, strips, widths, onChange, unzoom = (px) => px) {
  const ctls = [];
  for (const s of strips) {
    if (s.kind === "head") ctls.push(...(s.links ?? []));
    if (s.kind === "controls") {
      ctls.push(...s.ctls);
      if (s.lead) ctls.push({ id: `lead:${s.lead}`, lead: s.lead });
    }
  }
  return div().absolute().top(0).left(0).h(0).overflow_hidden().opacity(0)
    .child(h_flex().items_start().children(ctls.map((c) => div().id(`mwb-${c.id}`).flex_none()
      .on_size_change((size, cx) => { const w = unzoom(size.width); if (widths.get(c.id) !== w) { widths.set(c.id, w); onChange?.(cx); } })
      .child(c.lead ? div().flex_none().pr(2).text_size(TEXT.label).child(c.lead) : ctlEl(t, c, "mw-")))));
}
