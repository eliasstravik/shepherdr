// A text prompt (Herdr's prompt, ours: the app's one dialog footer), e.g. Rename tab. Opened as a
// dialog with props { title, label (over the field, default "Name"), value, placeholder, hint,
// verb (the button, default "Save"), command: { name, args } }: the command runs with
// { ...args, name: the text }. Enter saves, Esc cancels.
import { View, div } from "gpui-kit";
import { v_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme } from "herdr";
import { dialogFooter, TEXT, RADIUS, H } from "./ui.js";

export default class Prompt extends View {
  init(_props, cx) {
    this.text = props()?.value ?? "";
    this.input = InputState.new({ value: this.text, placeholder: props()?.placeholder ?? "" });
    if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", () => this.submit());
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  close() { this.input.release(); }

  submit() {
    const p = props();
    closeOverlay(p.overlay);
    run(p.command.name, { ...(p.command.args ?? {}), name: this.text.trim() });
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    return v_flex().id("prompt").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).p(18).bg(t.popover).text_size(TEXT.body).text_color(t.foreground)
      .child(div().text_size(TEXT.title).font_semibold().child(p.title ?? ""))
      .child(div().pt(16).pb(4).text_size(TEXT.label).text_color(t.dim).child(p.label ?? "Name"))
      .child(Input.new(this.input).h(H.lg).px(10).rounded(RADIUS.control).border_1().border_color(this.inputFocused ? t.accent : t.input)
        .bg(t.background).text_size(TEXT.body).text_color(t.foreground))
      .child(div().h(20).pt(4).text_size(TEXT.label).text_color(t.dim).child(p.hint ?? ""))
      .child(div().flex_1().min_h(12))
      .child(dialogFooter({ onCancel: () => closeOverlay(p.overlay),
        primary: { id: "pm-save", label: p.verb ?? "Save", onClick: () => this.submit() } }));
  }
}
