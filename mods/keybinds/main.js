// Keybinds: every key that does something, in plain words, grouped (Tabs, Spaces, Panes, ...).
// Ours, in place of Herdr's help (app.help), which lists raw command ids. Opened with
// mod.open:keybinds (Ctrl+Shift+/, and the tab bar's menu). Read live from keys(): what the shown
// layout's own section binds replaces the global key; other layouts' sections are left out.
// A name comes from core/keys.js's NAMES, else from the command's own description (commands()).
// Type to filter: every word must be in the name, the keys or the group.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { keys, commands, shared, window, theme } from "herdr";
import { TEXT, RADIUS, H, heading } from "./ui.js";
// The names, groups, key words and filter: core/keys.js (the web app's Keybinds reads the same).
import { grouped as groupedKeys, keyFound, KEYBINDS } from "./core/keys.js";

// The rows, grouped, from Herdr's live keys: what the shown layout's own section binds replaces the
// global key; other layouts' sections are left out.
function grouped() {
  return groupedKeys(keys(), { layout: shared("layout") ?? "", about: new Map(commands().map((c) => [c.name, c.about])), mac: window()?.platform === "macos" });
}

export default class Keybinds extends View {
  init(_props, cx) {
    this.filter = "";
    this.input = InputState.new({ placeholder: KEYBINDS.filter });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); cx.notify(); });
    this.input.on("focus", (_e, cx) => { this.focused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.focused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(0, () => this.input.focus());
  }

  render() {
    const t = theme();
    const groups = grouped().map((g) => ({ ...g, rows: g.rows.filter((r) => keyFound(this.filter, g.group, r)) })).filter((g) => g.rows.length);
    const cap = (text) => div().h(20).px(6).flex_none().flex().items_center().rounded(RADIUS.control).border_1().border_color(t.border)
      .bg(t.background).text_size(TEXT.id).text_color(t.muted).whitespace_nowrap().child(text);
    return v_flex().id("keybinds").size_full().min_h(0).p(18).gap(12).bg(t.popover).text_color(t.foreground)
      .child(div().flex_none().text_size(TEXT.title).font_semibold().child(KEYBINDS.title))
      .child(h_flex().h(H.lg).flex_none().px(10).gap(8).items_center().rounded(RADIUS.control).border_1()
        .border_color(this.focused ? t.accent : t.input).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(14).flex_none().text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(TEXT.body).text_color(t.foreground)))
      .child(v_flex().id("keybinds-list").flex_1().min_h(0).overflow_y_scrollbar().gap(8)
        .when(groups.length === 0, (el) => el.child(div().py(24).text_center().text_size(TEXT.body).text_color(t.dim).child(KEYBINDS.none)))
        .children(groups.map((g) => v_flex().flex_none()
          .child(heading(g.group))
          .children(g.rows.map((r) => h_flex().h(H.lg).flex_none().gap(12).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(TEXT.body).child(r.name))
            .child(h_flex().flex_none().gap(4).items_center().children(r.keys.map(cap))))))));
  }
}
