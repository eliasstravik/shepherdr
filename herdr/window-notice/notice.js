// Shepherdr 3.1's window views, retired. 3.2 moved Shepherdr into its web app and took its mods out of the Herdr app,
// but a window that was showing them kept them on screen, each with Herdr's red "could not be re-rendered" banner,
// and a space's Assistant tab (a "chat" mod tab, kept by herdr-core) said "chat did not load" even after a restart.
// So the update puts this in each old mod's place, in one swap: the main chat (an Assistant's tab or pane) says where
// Shepherdr went, with a button that opens the web app (at the same space, from an Assistant tab); the rest (the
// sidebar, the tab bar, the Tasks panel and its task's chat, the status bar) draw nothing, so there is one notice. `shepherdr window --remove` takes them out once the window no longer shows them.
// Self-contained: this folder is the whole mod (no shared modules). The source is herdr/window-notice.

import { div, View } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, props, shared } from "herdr";

// Prints the service's web.json: Shepherdr's own state folder first (SHEPHERDR_HOME, XDG_STATE_HOME), else the old path.
const READ = [
  'if [ -n "${SHEPHERDR_HOME:-}" ]; then s="$SHEPHERDR_HOME/state"; else s="${XDG_STATE_HOME:-$HOME/.local/state}/shepherdr"; fi',
  'for f in "$s/service/web.json" "$HOME/.herdr/shepherdr/web.json"; do',
  '  if [ -f "$f" ]; then cat "$f"; exit 0; fi',
  "done",
  "true",
].join("\n");

export const WORDS = {
  title: "Shepherdr now lives in the web app",
  body: "Your spaces, chats and tasks are there, and your agents keep running.",
  open: "Open Shepherdr",
  phone: "On your phone: open the same link (your tailnet), or add it to the home screen.",
  layout: "For Herdr's own layout here: Ctrl+Shift+L.",
  down: "Shepherdr's service isn't running on this computer: run `shepherdr doctor` in a terminal.",
};

/** The web app's link in what the service wrote, or null. */
export function linkOf(text) {
  let w = null;
  try { w = JSON.parse(String(text ?? "").trim() || "null"); } catch { w = null; }
  const link = w && typeof w.link === "string" ? w.link : "";
  return /^https?:\/\//.test(link) ? link : null;
}

/** The link at this view's space (an Assistant tab's props name it), else the link itself. */
export function linkAt(link, p) {
  if (!link) return null;
  const space = p && typeof p.space === "string" && /^[\w./:-]+$/.test(p.space) ? p.space : null;
  return space ? `${link}${link.includes("?") ? "&" : "?"}place=${encodeURIComponent(space)}` : link;
}

/** The window still shows 3.1's Shepherdr layout (it's gone from disk, so Herdr's own comes back on a restart). */
function oldLayout() {
  try { return shared("layout") === "shepherdr"; } catch { return false; }
}

export default function notice(shows) {
  return class Retired extends View {
    init(_props, cx) {
      this.link = null;
      this.loaded = false;
      if (!shows) return;
      cx.spawn(async (cx) => {
        const r = await exec("sh", ["-c", READ]).catch(() => null);
        this.link = linkOf(r?.stdout);
        this.loaded = true;
        cx.notify();
      });
    }

    render(_cx) {
      let p = null;
      try { p = props(); } catch { p = null; }
      if (!shows || p?.panel) return div();
      const t = theme();
      const link = linkAt(this.link, p);
      return v_flex().id("shepherdr-moved").size_full().items_center().justify_center().p(16).bg(t.canvas)
        .child(v_flex().max_w(360).gap(10).text_size(13)
          .child(div().font_semibold().text_size(14).text_color(t.foreground).child(WORDS.title))
          .child(div().text_color(t.muted).child(WORDS.body))
          .when(Boolean(link), (el) => el
            .child(h_flex().id("shepherdr-moved-open").h(32).px(12).items_center().justify_center().rounded(7).font_medium()
              .bg(t.solid).text_color(t.solid_foreground).cursor_pointer().hover((s) => s.opacity(0.88))
              .on_click((_e, cx) => { cx.stop_propagation(); cx.open_url(link); })
              .child(WORDS.open))
            .child(div().text_size(12).text_color(t.muted).child(WORDS.phone)))
          .when(this.loaded && !link, (el) => el.child(div().text_size(12).text_color(t.muted).child(WORDS.down)))
          .when(oldLayout(), (el) => el.child(div().text_size(12).text_color(t.dim ?? t.muted).child(WORDS.layout))));
    }
  };
}
