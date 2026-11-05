// The UI building blocks every mod draws with: one size system, one red/green/amber, and the
// few controls the app repeats (buttons, switch, segmented control, menu row, headings, card
// header, dialog footer, hover). lib/UI.md lists them and the rules.
// Shared: the source is lib/ui.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/ui.js, never a mod's copy, then run bin/sync-shared.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { settings, theme, openOverlay, notify, layout, shared, setShared, spaces } from "herdr";

// Sizes -------------------------------------------------------------------
// Buttons: 24 in panels, rows and headers; 32 in dialogs and cards; 20 only inside a row's
// 16 tall second line (a Ready row's Accept), so the row keeps its height.
export const H = { xs: 20, sm: 24, lg: 32 };
// Text: 11 IDs and times, 12 second lines and labels, 13 body and titles, 15 page titles.
export const TEXT = { id: 11, label: 12, body: 13, title: 15 };
// Corners: 6 on controls, 8 on cards (and hovers), 12 on bubbles.
export const RADIUS = { control: 6, card: 8, bubble: 12 };

// Status colors -----------------------------------------------------------
// Shepherdr's own, light and dark, the same as the task dots (dot.js uses these): red needs
// you (and alerts), green ready, amber working.
const dark = () => settings()?.dark !== false;
export const red = () => (dark() ? "#ff6369" : "#e5484d");
export const green = () => (dark() ? "#3dd68c" : "#30a46c");
export const amber = () => (dark() ? "#f5b544" : "#e2a336");
// Text on a red, green or amber fill: white on light's deep fills, black on dark's bright ones
// (Shepherdr's AttentionBadge).
export const onStatus = () => (dark() ? "#000000" : "#ffffff");

// Hover and pointer --------------------------------------------------------
// Only what a click does something on gets the pointer and a hover; everything else gets
// neither. The hover is a rounded 8 background. `el` needs an id.
export function clickable(el, onClick, { radius = RADIUS.card } = {}) {
  const t = theme();
  return el.rounded(radius).cursor_pointer().hover((s) => s.bg(t.hover))
    .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); cx.notify(); });
}

// Buttons -------------------------------------------------------------------
// kind: "primary" (solid; one per panel or dialog), "secondary" (bordered), "plain" (words
// only, a hover behind them). size: "xs" 20 (in a row's second line), "sm" 24 or "lg" 32. Sized
// to its words, never cut.
// opts: { kind, size, icon (an svg path), disabled, onClick }.
export function button(id, label, { kind = "secondary", size = "sm", icon = null, disabled = false, onClick = null } = {}) {
  const t = theme();
  const lg = size === "lg", xs = size === "xs";
  const h = lg ? H.lg : xs ? H.xs : H.sm;
  const iconSize = lg ? 16 : xs ? 12 : 14;
  const pad = lg ? 12 : xs ? 6 : 8;
  const live = !disabled && Boolean(onClick);
  return h_flex().id(id).h(h).flex_none().gap(6).items_center().rounded(RADIUS.control).whitespace_nowrap()
    .text_size(lg ? TEXT.body : TEXT.label).font_medium()
    // An icon's side is padded like its top, so it sits square in the corner.
    .pl(icon ? (h - iconSize) / 2 : pad).pr(pad)
    .when(kind === "primary", (el) => el.bg(t.solid).text_color(t.solid_foreground).when(live, (el) => el.hover((s) => s.opacity(0.88))))
    .when(kind === "secondary", (el) => el.border_1().border_color(t.input).bg(t.background).text_color(t.foreground)
      .when(live, (el) => el.hover((s) => s.bg(t.hover))))
    .when(kind === "plain", (el) => el.text_color(t.muted).when(live, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground))))
    .when(disabled, (el) => el.opacity(0.5))
    .when(live, (el) => el.cursor_pointer().on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); cx.notify(); }))
    .when(Boolean(icon), (el) => el.child(svg(icon).size(iconSize).flex_none()))
    .child(label);
}

// A quiet text link (card headers, "Show all"): muted, foreground on hover, sized to its words.
export function link(id, label, onClick) {
  const t = theme();
  return div().id(id).flex_none().whitespace_nowrap().text_size(TEXT.label).text_color(t.muted).cursor_pointer()
    .hover((s) => s.text_color(t.foreground))
    .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); cx.notify(); })
    .child(label);
}

// Switch ---------------------------------------------------------------------
// On: the accent track, the knob at the right. 36 × 20.
export function toggleSwitch(id, on, onToggle, { disabled = false } = {}) {
  const t = theme();
  return div().id(id).w(36).h(20).flex_none().rounded(10).p(2).flex().bg(on ? t.accent : t.hover)
    .when(on, (el) => el.justify_end())
    .when(disabled, (el) => el.opacity(0.5))
    .when(!disabled, (el) => el.cursor_pointer().on_click((e, cx) => { cx.stop_propagation(); onToggle(!on, e, cx); cx.notify(); }))
    .child(div().w(16).h(16).rounded(8).bg(on ? t.accent_foreground : t.muted));
}

// Segmented control ----------------------------------------------------------
// options: [[value, label, { disabled }?], ...]. Every segment is as wide as its words and
// never cut; `fill` stretches the segments over the row (still never narrower than their words).
// A disabled segment is dim and takes no click.
// opts: { size: "sm" 24 | "lg" 32, disabled, fill }.
export function segmented(id, options, value, onPick, { size = "sm", disabled = false, fill = false } = {}) {
  const t = theme();
  return h_flex().h(size === "lg" ? H.lg : H.sm).flex_none().p(2).gap(2).rounded(RADIUS.control).bg(t.raised)
    .when(fill, (el) => el.w_full())
    .when(disabled, (el) => el.opacity(0.5))
    .children(options.map(([v, label, o]) => {
      const on = v === value, off = disabled || Boolean(o?.disabled);
      return h_flex().id(`${id}-${v}`).h_full().px(8).justify_center().items_center().rounded(RADIUS.control - 2)
        .whitespace_nowrap().text_size(TEXT.label)
        .when(fill, (el) => el.flex_1())
        .when(!fill, (el) => el.flex_none())
        .when(on, (el) => el.bg(t.background).text_color(t.foreground).font_medium())
        .when(!on && Boolean(o?.disabled), (el) => el.text_color(t.dim).opacity(0.6))
        .when(!on && !o?.disabled, (el) => el.text_color(t.muted))
        .when(!on && !off, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((e, cx) => { cx.stop_propagation(); onPick(v, e, cx); cx.notify(); }))
        .child(label);
    }));
}

// Menu row -------------------------------------------------------------------
// A popup menu's row, 32 tall (Shepherdr's MenuItem): a 16 icon (or its empty slot, so labels
// line up), the label, a dim hint, and a check at the right when `check` is true (a choice
// list; false keeps the check's slot). opts: { icon, hint, check, danger, disabled, onClick }.
export function menuRow(id, label, { icon = null, hint = null, check = null, danger = false, disabled = false, onClick = null } = {}) {
  const t = theme();
  const live = !disabled && Boolean(onClick);
  return h_flex().id(id).h(32).w_full().flex_none().px(8).gap(8).items_center().rounded(RADIUS.control)
    .text_size(TEXT.body).text_color(disabled ? t.dim : danger ? red() : t.foreground)
    .when(live, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); cx.notify(); }))
    .child(div().size(16).flex_none().flex().items_center().justify_center()
      .when(Boolean(icon), (el) => el.child(svg(icon).size(16).text_color(danger ? red() : t.muted))))
    .child(div().flex_1().min_w(0).truncate().child(label))
    .when(Boolean(hint), (el) => el.child(div().flex_none().pl(8).text_size(TEXT.label).text_color(t.dim).child(hint)))
    .when(check !== null, (el) => el.child(div().size(16).flex_none()
      .when(check, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(16).text_color(t.foreground)))));
}

// Headings -----------------------------------------------------------------------
// A small dim heading over a group (Shepherdr's Section): 12, medium, sentence case, never
// uppercase. `right` (an element, e.g. a count) sits at the far right.
export function heading(text, right = null) {
  const t = theme();
  return h_flex().h(28).flex_none().gap(8).items_center().justify_between().text_size(TEXT.label).font_medium().text_color(t.dim)
    .child(div().min_w(0).truncate().child(text))
    .when(Boolean(right), (el) => el.child(div().flex_none().child(right)));
}

// A card's header: the title at the left (13, medium), its links or small buttons at the right.
// `title` may be text or an element; `actions` is a list of elements (link(), button()).
export function cardHeader(title, actions = []) {
  const t = theme();
  return h_flex().w_full().flex_none().gap(12).items_center()
    .child(div().flex_1().min_w(0).truncate().text_size(TEXT.body).font_medium().text_color(t.foreground).child(title))
    .when(actions.length > 0, (el) => el.child(h_flex().flex_none().gap(12).items_center().children(actions)));
}

// A dialog's footer, 32 tall: an optional dim note at the left (`error` turns it red), then a
// plain Cancel and the one solid primary. No "Esc" hint: Esc closing a dialog goes unsaid.
// opts: { onCancel, primary: { id, label, onClick, disabled }, cancelLabel, note, error }.
export function dialogFooter({ onCancel, primary, cancelLabel = "Cancel", note = "", error = false }) {
  const t = theme();
  return h_flex().h(H.lg).w_full().flex_none().gap(8).items_center()
    .child(div().flex_1().min_w(0).truncate().text_size(TEXT.label).text_color(error ? red() : t.dim).child(note || ""))
    .child(button("dialog-cancel", cancelLabel, { kind: "plain", size: "lg", onClick: onCancel }))
    .when(Boolean(primary), (el) => el.child(button(primary.id ?? "dialog-primary", primary.label,
      { kind: "primary", size: "lg", disabled: primary.disabled, onClick: primary.onClick })));
}

// Count badge ------------------------------------------------------------------------------
// The count badge on Tasks, tabs and spaces, as Shepherdr's AttentionBadge: Needs you alone a red
// dot, Ready alone a green one, both one oval split down the middle (red Needs you left, green
// Ready right, a 1px line between in `line`, the color behind the badge). Always 16 tall, so a
// row never jumps when the badge changes kind; each count stops at 9+. 11px digits are an even
// number of pixels tall, so they centre; a lone "1" is narrow with its flag on the left, so it
// moves right a pixel to look centred.
export function countBadge(need, ready, line) {
  const num = (n) => div().line_height("16px").when(n === 1, (el) => el.ml(1)).child(n > 9 ? "9+" : String(n));
  const part = (n, bg) => div().h(16).flex().items_center().justify_center().bg(bg).child(num(n));
  const badge = h_flex().h(16).flex_none().text_color(onStatus()).text_size(TEXT.id).font_semibold();
  if (need > 0 && ready > 0)
    return badge.child(part(need, red()).w(need > 9 ? 19 : 15).rounded_l(8)).child(div().w(1).h(16).bg(line))
      .child(part(ready, green()).w(ready > 9 ? 19 : 15).rounded_r(8));
  const n = need || ready;
  return badge.child(part(n, need ? red() : green()).min_w(16).px(n > 9 ? 4 : 0).rounded(8));
}

// Settings ---------------------------------------------------------------------------------
// The one Settings window (mods/shepherdr-settings): most of the window's height, at most 900
// (it draws its own frame inside, centred). p: { space?: that space's own settings, section? }.
export function openSettings(p = {}) {
  return openOverlay({ mod: "shepherdr-settings", kind: "dialog", frame: "none", width: 860, height: 0.92, props: p });
}

// Toasts -------------------------------------------------------------------------------------
// Everything that reaches the person as a toast goes through toast(): our own float draws it
// (mods/toasts: the body wraps to 3 lines, an X on hover, alerts red), one title format for what
// an agent says ("HERD-4 · what", "~ Assistant · what"). Where the shown layout has no toasts
// float (another layout), Herdr's notify() shows it instead. Kept in shared "toasts", newest last.
// n: { title, body, level: "info" | "success" | "warning" | "error" | "alert", action: { name,
// args }, timeout (ms) }. "alert" is an agent saying it can't wait, or needing the person: red.
export const TOASTS = "toasts";
const hasToasts = (n) => Boolean(n && typeof n === "object")
  && (n.content?.mod === TOASTS || [...(n.children ?? []), ...(n.floating ?? [])].some(hasToasts));
export function toast(n) {
  if (!hasToasts(layout())) return notify({ ...n, level: n.level === "alert" ? "error" : n.level ?? "info" });
  const at = Date.now();
  const id = `${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const kept = (shared(TOASTS) ?? []).filter((x) => at - x.at < 120000).slice(-4);
  setShared(TOASTS, [...kept, { ...n, level: n.level ?? "info", id, at }]);
  return id;
}

// Who a toast is from, its title's first half ("HERD-4 · what", "~ Assistant · what"): a task's
// agent by its task (herdr-task names it "herd-4-fix-login"; on another machine "HERD-4 on vm", as
// core/toasts.js taskWho), an Assistant by its space, anything else by its program. k: a terminal
// (terminals()); task: a task ref when known.
export function toastWho(k, task = null) {
  const l = k?.labels ?? {};
  const m = String(k?.address ?? "").includes("/") ? k.address.split("/")[0] : null;
  const ref = task ?? (l["herdr.task"] ? (/^([a-z][a-z0-9]*-\d+)/.exec(k?.name ?? "")?.[1] ?? "").toUpperCase() : "");
  if (ref) return m ? `${ref} on ${m}` : ref;
  if (l["herdr.role"] === "coordinator") {
    const id = l["herdr.coordinator.space"] ?? l["herdr.space"];
    const name = id && spaces().find((s) => s.id === (m ? `${m}/${id}` : id))?.name;
    return name ? `${name} Assistant` : "Assistant";
  }
  return k?.program?.name ?? "Agent";
}

// An error in plain words, for a toast's body (its title says what failed): the last line,
// without a program's name or "Error:", as a sentence. A bare "<tool> failed" or an exit code
// says nothing, so it gives "" (the toast then has no body).
export function plainError(e) {
  let s = String(e?.message ?? e ?? "").trim().split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
  s = s.replace(/^(uncaught\s+)?(\w*error|herdr-[\w-]+|hc|fatal)\s*:\s*/i, "").trim();
  // Hints for agents ("`herdr-artifact list` shows them.") aren't for the person.
  s = s.split(/(?<=[.!?])\s+/).filter((x) => !x.includes("`")).join(" ").trim();
  if (!s || /^[\w. -]+ failed\.?$/i.test(s) || /^(exit(ed)?( with)?( code| status)?|status|code)\s*:?\s*\d+\.?$/i.test(s)) return "";
  if (/timed? ?out|no answer within/i.test(s)) return "It didn't answer in time. Try again.";
  if (/connection refused|unreachable|cannot reach|could not resolve|no route to host/i.test(s)) return "Couldn't reach that machine. Check that it's on, then try again.";
  if (/permission denied|EACCES/i.test(s)) return "Herdr isn't allowed to do that there.";
  s = s[0].toUpperCase() + s.slice(1);
  return /[.!?…]$/.test(s) ? s : `${s}.`;
}
