// The Web page (Shepherdr 3.1): Shepherdr in a browser on phone, tablet and desktop, private to the tailnet. Its link
// and a QR code to open it on a phone, as the service last wrote them (~/.herdr/shepherdr/web.json: the service shares
// /shepherdr with tailscale serve and draws the QR picture under data/). On or off: the Web add-on, under Window.
import { div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { home, readTextFile } from "herdr";
import { button } from "./ui.js";
import { on } from "./addons.js";
// The page's words and its state line: core/settings.js, shared with the web app.
import { WEB, SECTIONS, webState } from "./core/settings.js";

let web = null, readAt = 0, loaded = false;

// What the service says now, read again at most every 5 s while the page shows.
function current(view) {
  if (Date.now() - readAt > 5000) {
    readAt = Date.now();
    readTextFile(`${home()}/.herdr/shepherdr/web.json`).then((s) => { web = JSON.parse(s ?? "null"); }).catch(() => { web = null; })
      .finally(() => { loaded = true; });
  }
  return web;
}

export function webSection(view, t) {
  const w = current(view);
  const off = !on("web");
  const state = webState(off, loaded, w);
  return v_flex()
    .child(view.title(t, SECTIONS.find((s) => s.id === "web").title))
    .child(view.row(t, WEB.title, state, div()))
    .when(Boolean(!off && w?.link && !w?.why), (el) => el
      .child(view.row(t, WEB.link, w.link, button("web-copy", WEB.copy, { onClick: (_e, cx) => cx.write_to_clipboard(w.link) })))
      .when(Boolean(w.qr), (el) => el.child(v_flex().py(12).gap(8)
        .child(div().text_size(13).text_color(t.muted).child(WEB.phone))
        .child(h_flex().child(image(w.qr).size(168).rounded(8))))));
}
