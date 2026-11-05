// The voice call bar: while a chat's call (mods/chat) goes on and that chat isn't on screen
// (another tab or space), a slim bar at the top of the work area says who the call is with
// and for how long, with Go back and the red X that hangs up (as the chat's own call row and
// dictation have it). A call that ended on an error says why here
// too, until closed. Floats over the work area: { "floating": [{ "content": { "mod":
// "chat-call" }, "edge": "top", "align": "center" }] }. Draws nothing otherwise.
// Reads shared "chat.calls" = { <chat pane>: { phase, started, beat, name, tab, ... } } and
// "chat.callError" = { text, pane, at }; ends a call with "chat.callreq" = { pane, at, action }.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, spaces, focused, shared, setShared, run, theme } from "herdr";
import { button as uiButton, red, TEXT, RADIUS } from "./ui.js";

// A call the chat hasn't confirmed for this long is gone (Herdr closed mid-call).
const STALE = 45000;

export default class CallBar extends View {
  init(_props, cx) {
    // The call's clock: once a second, and only while the bar shows.
    cx.timer.every(1000, (cx) => { if (this.showing) cx.notify(); });
  }

  // The call whose chat isn't on screen, if there is one: { pane, ...call }.
  away() {
    const calls = shared("chat.calls") ?? {};
    const shown = focused()?.tab;
    for (const [pane, c] of Object.entries(calls)) {
      const p = panes().find((x) => x.pane === pane);
      if (!p || Date.now() - (c.beat ?? 0) > STALE) continue;
      if (p.tab !== shown) return { pane, ...c, tab: p.tab };
    }
    return null;
  }

  goBack(call) {
    const space = spaces().find((s) => s.tabs.some((t) => t.id === call.tab));
    if (space) run("space.select", { id: space.id });
    run("tab.select", { id: call.tab });
    run("pane.focus", { pane: call.pane });
  }

  // Hang up: the chat's red round X (mods/chat round("call-x", ..., "danger")), 24 here.
  hangUp(id, fn) {
    return div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(12).cursor_pointer()
      .bg(red()).text_color("#ffffff").hover((s) => s.opacity(0.85))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); fn(); cx.notify(); })
      .child(svg("mods/chat/x.svg").size(14));
  }

  render(_cx) {
    const t = theme();
    const call = this.away();
    const error = shared("chat.callError");
    this.showing = Boolean(call);
    if (!call && !error?.text) return div();
    if (call) {
      const secs = Math.max(0, Math.floor((Date.now() - (call.started ?? Date.now())) / 1000));
      const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      return h_flex().id("call-bar").h(34).pl(12).pr(5).gap(10).items_center().text_size(TEXT.label)
        .child(svg("mods/chat/audio-lines.svg").size(14).flex_none().text_color(t.accent)
          .loop("opacity", { from: 0.45, to: 1, period: 1400 }))
        .child(div().max_w(360).truncate().text_color(t.foreground).child(`Voice call with ${call.name ?? "the agent"} · ${clock}`))
        .child(uiButton("call-bar-back", "Go back", { kind: "secondary", onClick: () => this.goBack(call) })
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()))
        .child(this.hangUp("call-bar-end", () => setShared("chat.callreq", { pane: call.pane, at: Date.now(), action: "end" })));
    }
    return h_flex().id("call-error").h(34).pl(12).pr(5).gap(10).items_center().text_size(TEXT.label)
      .child(div().max_w(480).truncate().text_color(t.muted).child(`Voice call: ${error.text}`))
      .child(div().id("call-error-x").size(24).flex_none().flex().items_center().justify_center().rounded(RADIUS.control).cursor_pointer().text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); setShared("chat.callError", null); })
        .child(svg("mods/chat/x.svg").size(12)));
  }
}
