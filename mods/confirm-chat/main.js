// Asks before something destructive, e.g. "Close space?" (Herdr's confirm, ours: the app's one
// dialog footer). Opened as a dialog with props { title, detail, verb (the button, e.g. "Close
// space"), danger (default true), command: { name, args } }. The button says what it does, never
// "Confirm". On a destructive ask Enter does nothing (only a click runs it); otherwise Enter runs
// it. Esc cancels. openConfirm sizes it.

import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { run, props, closeOverlay, theme } from "herdr";
import { dialogFooter, TEXT } from "./ui.js";

export default class Confirm extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  yes() {
    const p = props();
    closeOverlay(p.overlay);
    run(p.command.name, p.command.args ?? {});
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const danger = p.danger !== false;
    return v_flex()
      .id("confirm")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "enter" && !danger) this.yes();
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
      })
      .size_full()
      .min_h(0)
      .p(18)
      .gap(8)
      .bg(t.popover)
      .text_size(TEXT.body)
      .child(div().text_size(TEXT.title).font_semibold().text_color(t.foreground).child(p.title ?? "Are you sure?"))
      .child(div().flex_1().min_h(0).text_color(t.muted).child(p.detail ?? ""))
      .child(div().h(8).flex_none())
      .child(dialogFooter({ onCancel: () => closeOverlay(props().overlay),
        primary: { id: "yes", label: p.verb ?? "OK", onClick: () => this.yes() } }));
  }
}
