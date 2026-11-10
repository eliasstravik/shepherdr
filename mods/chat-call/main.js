// The voice call's note at the top of the work area: a call that ended on an error says why here, until closed.
// A call going on has no bar: the sidebar's Shepherdr row is the call card (mods/spaces-chat voiceRow, SHEP-105: Mute,
// End), and the chat it runs in has the call in its box too. Floats over the work area:
// { "floating": [{ "content": { "mod": "chat-call" }, "edge": "top", "align": "center" }] }. Draws nothing otherwise.
// Reads shared "chat.callError" = { text, pane, at }. SHEP-173: Call again starts a call in that pane's chat again
// (shared "chat.callreq", as the sidebar's call button does); a text that starts "Call ended:" is said as it is.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared, setShared, theme } from "herdr";
import { TEXT, RADIUS } from "./ui.js";

export default class CallBar extends View {
  render(_cx) {
    const t = theme();
    const error = shared("chat.callError");
    if (!error?.text) return div();
    return h_flex().id("call-error").h(34).pl(12).pr(5).gap(10).items_center().text_size(TEXT.label)
      .child(div().max_w(480).truncate().text_color(t.muted).child(/^Call ended:/.test(error.text) ? error.text : `Voice call: ${error.text}`))
      .when(Boolean(error.pane), (el) => el.child(div().id("call-error-again").h(24).px(10).flex_none().flex().items_center().rounded(RADIUS.control).cursor_pointer()
        .text_color(t.foreground).bg(t.hover).hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); setShared("chat.callError", null); setShared("chat.callreq", { pane: error.pane, at: Date.now(), action: "start" }); })
        .child("Call again")))
      .child(div().id("call-error-x").size(24).flex_none().flex().items_center().justify_center().rounded(RADIUS.control).cursor_pointer().text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); setShared("chat.callError", null); })
        .child(svg("mods/chat/x.svg").size(12)));
  }
}
