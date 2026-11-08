// Our toasts (a clone of Herdr's shipped toast, which only Herdr's notify() reaches): a float over
// the work area, bottom right ({ "floating": [{ "content": { "mod": "toasts" }, "edge": "bottom",
// "align": "end" }] } in the layout). Mods post with toast() from ui.js, which keeps them in
// shared "toasts" (newest last); this draws the last three. Each: a dot (red for an alert or an
// error, amber a warning, green done, the accent otherwise), its title on one line, its body
// wrapped to at most 3 lines, and an X on hover. A click runs its action (going to the agent)
// and closes it. Each goes after its timeout; never while the pointer is on them.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { placement, run, shared, setShared, theme } from "herdr";
import { note } from "./usage.js";
import { TOASTS, TEXT, RADIUS, red, amber, green } from "./ui.js";
// How many, how wide, how long and in which color: core/toasts.js, shared with the web app's toasts.
import { SHOWN, WIDTH, LINES, BODY_MAX, tone, clip, unexpired } from "./core/toasts.js";

const LINE = 18;    // the body's line height: LINES (3) lines at most

const color = (level, t) => ({ red: red(), amber: amber(), green: green() }[tone(level)] ?? t.accent);

export default class Toasts extends View {
  init(_props, cx) {
    this.hovered = null;
    // Usage insights (lib/usage.js): each error toast shown, once (its kind only, never its words).
    this.seen = new Set();
    // Expiry: once a second, and only writes when one goes.
    cx.timer.every(1000, () => {
      const list = shared(TOASTS) ?? [];
      for (const n of list) if (n.level === "error" && !this.seen.has(n.id)) { this.seen.add(n.id); note("error", { type: "toast" }); }
      for (const id of this.seen) if (!list.some((n) => n.id === id)) this.seen.delete(id);
      if (placement()?.hovered) return;
      const left = unexpired(list);
      if (left.length !== list.length) setShared(TOASTS, left);
    });
  }

  dismiss(id) {
    setShared(TOASTS, (shared(TOASTS) ?? []).filter((n) => n.id !== id));
  }

  item(n, first, t) {
    const on = this.hovered === n.id;
    const act = n.action?.name;
    return h_flex().id(`toast-${n.id}`).w_full().pl(12).pr(6).py(10).gap(10).items_start().rounded(RADIUS.card)
      .when(!first, (el) => el.border_t(1).border_color(t.border).rounded(0))
      .on_hover((h, cx) => { this.hovered = h ? n.id : this.hovered === n.id ? null : this.hovered; cx.notify(); })
      .when(Boolean(act), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { cx.stop_propagation(); run(n.action.name, n.action.args ?? {}); this.dismiss(n.id); }))
      .child(div().size(8).mt(5).flex_none().rounded(4).bg(color(n.level, t)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().min_w(0).truncate().text_size(TEXT.body).font_semibold().text_color(t.foreground).child(String(n.title ?? "")))
        .when(Boolean(n.body), (el) => el.child(div().max_h(LINE * LINES).overflow_hidden().line_height(`${LINE}px`)
          .text_size(TEXT.label).text_color(t.muted).child(clip(String(n.body), BODY_MAX)))))
      // The X's place is always kept, so nothing moves when it shows.
      .child(div().id(`toast-x-${n.id}`).size(20).flex_none().flex().items_center().justify_center().rounded(RADIUS.control)
        .when(on, (el) => el.cursor_pointer().text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); this.dismiss(n.id); cx.notify(); })
          .child(svg("mods/workspace-chrome/x.svg").size(14))));
  }

  render() {
    const list = (shared(TOASTS) ?? []).slice(-SHOWN);
    if (!list.length) return div();
    const t = theme();
    return v_flex().id("toasts").w(WIDTH).children(list.map((n, i) => this.item(n, i === 0, t)));
  }
}
