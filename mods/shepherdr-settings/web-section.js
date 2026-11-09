// The Web page (Shepherdr 3.1): Shepherdr in a browser on phone, tablet and desktop, private to the tailnet. Its link
// and a QR code to open it on a phone, as the service last wrote them (~/.local/state/shepherdr/service/web.json: the service shares
// /shepherdr with tailscale serve and draws the QR picture under data/). On or off: the Web add-on, under Window.
// Serve from (core/host.js): the machine that serves it, picked from this computer and every linked one (its line says
// its system, and Offline when it is), then confirmed under the list; the service moves it (shepherdr web serve-from)
// and says how it goes in web.json. The web app's twin: its Settings › Web row and screens/ServeFrom.tsx.
import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { home, appHome, readTextFile } from "herdr";
import { button, menuRow, red, TEXT, RADIUS, H } from "./ui.js";
import { on } from "./addons.js";
import { localService, localToken } from "./local.js";
import { dirsReady } from "./dirs.js";
// The page's words and its state line: core/settings.js and core/host.js, shared with the web app.
import { WEB, SECTIONS, webState } from "./core/settings.js";
import { SERVE } from "./core/host.js";

let web = null, readAt = 0, loaded = false;
// image() takes a path inside the app's folder: the service writes the QR picture's whole path
const inApp = (p) => (p.startsWith(`${appHome()}/`) ? p.slice(appHome().length + 1) : p);
// the list open, the line picked (waiting for Move it), and what the service said to it
let open = false, picked = null, said = "";
// the link was copied a moment ago: its button says so
let copied = false;

// What the service says now, read again at most every 5 s while the page shows (every second while it moves).
function current(view) {
  if (Date.now() - readAt > (web?.serve?.moving ? 1000 : 5000)) {
    readAt = Date.now();
    dirsReady().then((d) => readTextFile(`${d.service}/web.json`)).then((s) => { web = JSON.parse(s ?? "null"); }).catch(() => { web = null; })
      .finally(() => { loaded = true; });
  }
  return web;
}

// Asks this machine's service to move it (the same as the web app's Settings › Web).
async function move(label) {
  const token = await localToken();
  if (!token) return "Shepherdr's service isn't running here.";
  // its port, and that Shepherdr's own service answers there (not another app), before the token goes out
  const svc = await localService().catch(() => null);
  if (!svc) return "Shepherdr's service isn't answering here.";
  try {
    const r = await fetch(`${svc.base}/api/action`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ type: "setting", key: "web.serve", value: label }) });
    const j = await r.json().catch(() => null);
    return j?.ok === false ? j.error ?? "It could not be moved." : "";
  } catch {
    return "Shepherdr's service isn't answering here.";
  }
}

function servePicker(view, t, sv) {
  const now = sv.rows.find((r) => r.serves) ?? sv.rows[0];
  const busy = Boolean(sv.moving);
  const control = h_flex().id("web-serve").h(H.sm).pl(8).pr(6).gap(6).items_center().rounded(RADIUS.control).border_1().border_color(t.input)
    .when(busy, (el) => el.opacity(0.5))
    .when(!busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { open = !open; picked = null; said = ""; cx.notify(); }))
    .child(div().max_w(220).truncate().text_size(TEXT.label).text_color(t.foreground).child(now.label))
    .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none().text_color(t.dim));
  const list = v_flex().p(4).rounded(RADIUS.card).border_1().border_color(t.border).bg(t.background)
    .children(sv.rows.map((r, i) => menuRow(`web-serve-${i}`, r.label, { check: r.serves, disabled: busy || r.state !== "connected",
      onClick: r.serves ? () => { open = false; } : () => { picked = r; said = ""; } })));
  const ask = picked && v_flex().gap(10).p(12).rounded(RADIUS.card).bg(t.hover)
    .child(div().text_size(TEXT.body).font_medium().text_color(t.foreground).child(SERVE.confirm(picked.name, picked.here)))
    .child(div().text_size(TEXT.label).line_height("17px").text_color(t.muted).child(SERVE.detail(picked.name, picked.here)))
    .when(Boolean(said), (el) => el.child(div().text_size(TEXT.label).text_color(red()).child(said)))
    .child(h_flex().gap(8).justify_end()
      .child(button("web-serve-cancel", "Cancel", { kind: "plain", onClick: () => { picked = null; said = ""; } }))
      .child(button("web-serve-go", SERVE.verb, { kind: "primary", onClick: (_e, cx) => {
        const label = picked.label;
        cx.spawn(async (cx) => {
          said = await move(label);
          if (!said) { picked = null; open = false; readAt = 0; }
          cx.notify();
        });
      } })));
  const below = (open || sv.error) && v_flex().gap(8)
    .when(Boolean(sv.error), (el) => el.child(div().text_size(TEXT.label).text_color(red()).child(SERVE.failed(sv.error))))
    .when(open, (el) => el.child(list))
    .when(Boolean(ask), (el) => el.child(ask));
  return view.row(t, SERVE.title, SERVE.about, control, null, below || null);
}

export function webSection(view, t) {
  const w = current(view);
  const off = !on("web");
  const state = webState(off, loaded, w);
  return v_flex()
    .child(view.title(t, SECTIONS.find((s) => s.id === "web").title))
    .child(view.row(t, WEB.title, state, div()))
    .when(Boolean(!off && w?.serve?.rows?.length), (el) => el.child(servePicker(view, t, w.serve)))
    .when(Boolean(!off && w?.link && !w?.why), (el) => el
      .child(view.row(t, WEB.link, w.link, button("web-copy", copied ? WEB.copied : WEB.copy, { onClick: (_e, cx) => {
        cx.write_to_clipboard(w.link);
        copied = true;
        cx.timer.after(1500, (cx) => { copied = false; cx.notify(); });
        cx.notify();
      } })))
      .when(Boolean(w.qr), (el) => el.child(v_flex().py(12).gap(8)
        .child(div().text_size(13).text_color(t.muted).child(WEB.phone))
        .child(h_flex().child(image(inApp(w.qr)).size(168).rounded(8))))));
}
