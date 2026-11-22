// Open Shepherdr: Shepherdr's one piece inside the Herdr app (3.2). A small popup with one button that opens
// Shepherdr's web app in the browser, at its private Tailscale link. Opened with mod.open:open-shepherdr
// (Ctrl+Shift+O when that key was free at install; again closes it). Nothing else of Shepherdr runs in the window.
// The link is the one Shepherdr's service last wrote in its web.json (~/.local/state/shepherdr/service, or the old
// ~/.herdr/shepherdr on a machine not moved yet); with no link there, a plain line says the service isn't running.
// Self-contained: this folder is the whole mod (no shared modules).

import { div } from "gpui-kit";
import { View } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, theme, props, closeOverlay } from "herdr";

// Prints the service's web.json: Shepherdr's own state folder first (SHEPHERDR_HOME, XDG_STATE_HOME), else the old path.
const READ = [
  'if [ -n "${SHEPHERDR_HOME:-}" ]; then s="$SHEPHERDR_HOME/state"; else s="${XDG_STATE_HOME:-$HOME/.local/state}/shepherdr"; fi',
  'for f in "$s/service/web.json" "$HOME/.herdr/shepherdr/web.json"; do',
  '  if [ -f "$f" ]; then cat "$f"; exit 0; fi',
  "done",
  "true",
].join("\n");

const NOT_RUNNING = "Shepherdr's service isn't running on this computer.";

/** The web app's link in what the service wrote, or null. */
function linkOf(text) {
  let w = null;
  try { w = JSON.parse(String(text ?? "").trim() || "null"); } catch { w = null; }
  const link = w && typeof w.link === "string" ? w.link : "";
  return /^https?:\/\//.test(link) ? link : null;
}

export default class OpenShepherdr extends View {
  init(_props, cx) {
    this.link = null;
    this.loaded = false;
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", READ]).catch(() => null);
      this.link = linkOf(r?.stdout);
      this.loaded = true;
      cx.notify();
    });
  }

  render(_cx) {
    const t = theme();
    const live = Boolean(this.link);
    return v_flex().id("open-shepherdr").w_full().p(16).gap(12).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
      })
      .child(div().font_semibold().text_color(t.foreground).child("Shepherdr"))
      .child(h_flex().id("open-shepherdr-button").h(32).px(12).items_center().justify_center().rounded(7).font_medium()
        .bg(t.solid).text_color(t.solid_foreground)
        .when(!live, (el) => el.opacity(0.5))
        .when(live, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => {
          cx.stop_propagation();
          cx.open_url(this.link);
          closeOverlay(props().overlay);
        }))
        .child("Open Shepherdr"))
      .when(this.loaded && !live, (el) => el.child(div().text_size(12).text_color(t.muted).child(NOT_RUNNING)));
  }
}
