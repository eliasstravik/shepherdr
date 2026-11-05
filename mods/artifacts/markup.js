// Mark up, laid over every installed artifact by herdr-artifact (copied in as artifact-markup.js
// under a main.js that wraps the artifact's own; the source is mods/artifacts/markup.js).
// The Mark up button (the full-screen viewer's toolbar in mods/chat-image, the sidebar's header in
// mods/artifacts) sets shared "artifacts.markup" = { mod, where: "viewer" | "panel" }; the copies of
// that artifact there lay a layer over it (as Shepherdr's Mark up): click a spot or drag over an
// area, write what should change, and Send gives it to the agent that keeps the artifact
// (`herdr-artifact note`) with the version, the spot in words and a picture of the panel with the
// spot outlined. A note with no spot is about the whole artifact. Esc drops the spot, then ends.
// A custom panel (not a recipe) also leaves its picture for the web app each time it's shown (picture()).

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, shared, setShared, props, exec, appHome, home, agents } from "herdr";
import * as A from "./artifact.js";

const KEY = "artifacts.markup";
const MOD = A.dir.slice("mods/".length);
const CLI = () => `${appHome()}/mods/artifacts/bin/herdr-artifact`;

// In the full-screen viewer (an overlay) or a panel (the sidebar, a tab, a window).
const where = () => (props()?.overlay ? "viewer" : "panel");
const isOn = () => { const s = shared(KEY); return Boolean(s && s.mod === MOD && s.where === where()); };
const stop = () => setShared(KEY, null);

export function markupInit(_cx) {
  const m = { spot: null, press: null, origin: null, size: null, shot: null, sending: false, said: "", failed: false, was: false, pictured: false };
  m.input = InputState.new({ placeholder: "What should change?" });
  m.input.on("submit", (_e, cx) => send(m, cx));
  m.input.on("change", (_e, cx) => { if (m.said && !m.sending) { m.said = ""; m.failed = false; cx.notify(); } });
  return m;
}

export function markupWrap(m, inner, cx) {
  if (!m) return inner;
  const on = isOn();
  if (on && !m.was) cx.timer.after(0, () => m.input.focus());
  if (!on && m.was) Object.assign(m, { spot: null, press: null, shot: null, said: "", failed: false });
  m.was = on;
  return v_flex().id("art-mark-root").relative().size_full()
    .on_size_change((size) => { m.size = size; })
    .when(Boolean(A.custom), (el) => el.on_mouse_move((e, cx) => {
      if (e.local_position) m.origin = { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y };
      picture(m, cx);
    }))
    .child(inner)
    .when(on, (el) => el.child(layer(m, theme())));
}

// ---- a custom panel's picture ---------------------------------------------------------------

// The web app can't run a custom panel: it shows the picture the window last took of it. Once per showing, a moment
// after the pointer first crosses it (its place in the window is known from the pointer only), the window's last
// frame is cut to the panel and kept beside this version (herdr-artifact picture). Not while Mark up lies over it.
function picture(m, cx) {
  if (m.pictured || !m.origin || !m.size || isOn()) return;
  m.pictured = true;
  cx.timer.after(700, () => {
    if (isOn()) { m.pictured = false; return; }
    const o = m.origin, s = m.size;
    const dir = `${home()}/.herdr/artifacts/notes`, file = `${dir}/shot-${Date.now()}.png`;
    exec("sh", ["-c", 'mkdir -p "$1" && exec herdr-app shot "$2"', "shot", dir, file])
      .then((r) => r.code === 0 && exec(CLI(), ["picture", A.id, "--version", String(A.version), "--shot", file,
        "--panel", [o.x, o.y, s.width, s.height].map(Math.round).join(","), "--json", ...(A.machine ? ["--from", A.machine] : [])]))
      .catch(() => {});
  });
}

// ---- the layer ---------------------------------------------------------------------------

const at = (e) => e.local_position ?? { x: 0, y: 0 };
const clampTo = (v, max) => Math.max(0, Math.min(max ?? v, v));

function layer(m, t) {
  const p = m.press;
  const shown = p?.moved ? box(p) : m.spot;
  return div().id("art-mark-layer").absolute().top(0).left(0).size_full().cursor_crosshair()
    .border_2().border_dashed().border_color(t.accent)
    .on_mouse_move((e, cx) => {
      if (e.local_position) m.origin = { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y };
      if (!m.press) return;
      const q = at(e);
      m.press.x1 = clampTo(q.x, m.size?.width);
      m.press.y1 = clampTo(q.y, m.size?.height);
      if (Math.abs(m.press.x1 - m.press.x0) + Math.abs(m.press.y1 - m.press.y0) > 4) m.press.moved = true;
      cx.notify();
    })
    .on_mouse_down("left", (e, cx) => {
      const q = at(e);
      if (e.local_position) m.origin = { x: e.position.x - q.x, y: e.position.y - q.y };
      m.press = { x0: q.x, y0: q.y, x1: q.x, y1: q.y, moved: false };
      m.said = ""; m.failed = false;
      cx.stop_propagation();
      cx.notify();
    })
    .on_mouse_up("left", (_e, cx) => pick(m, cx))
    .when(Boolean(shown), (el) => el.child(mark(shown, t)))
    // The note box hides while you draw, so the picture taken on release shows the artifact.
    .when(!p, (el) => el.child(card(m, t)));
}

// The press as a rect (any drag direction).
function box(p) {
  return { x: Math.min(p.x0, p.x1), y: Math.min(p.y0, p.y1), w: Math.abs(p.x1 - p.x0), h: Math.abs(p.y1 - p.y0) };
}

// Released: the spot (a point for a click, else the area), and the window as it looked just
// then (the last frame: the spot being drawn, no note box) for the agent's picture.
function pick(m, cx) {
  const p = m.press;
  if (!p) return;
  m.press = null;
  m.spot = p.moved ? box(p) : { x: p.x0, y: p.y0, w: 0, h: 0 };
  const dir = `${home()}/.herdr/artifacts/notes`, file = `${dir}/shot-${Date.now()}.png`;
  m.shot = null;
  exec("sh", ["-c", 'mkdir -p "$1" && exec herdr-app shot "$2"', "shot", dir, file])
    .then((r) => { if (r.code === 0) m.shot = file; })
    .catch(() => {});
  cx.timer.after(0, () => m.input.focus());
  cx.notify();
}

function mark(r, t) {
  const tint = /^#[0-9a-f]{6}$/i.test(t.accent) ? `${t.accent}1f` : "#2f81f71f";
  const badge = (x, y) => div().absolute().left(x).top(y).size(20).rounded(10).flex().items_center().justify_center()
    .bg(t.accent).text_color(t.accent_foreground).text_size(11).font_semibold().child("1");
  if (!r.w && !r.h) return div().absolute().left(0).top(0).size_full().child(badge(r.x - 10, r.y - 10));
  return div().absolute().left(0).top(0).size_full()
    .child(div().absolute().left(r.x).top(r.y).w(r.w).h(r.h).rounded(4).border_2().border_color(t.accent).bg(tint))
    .child(badge(r.x - 10, r.y - 10));
}

// Who gets it: the agent that made it, by its program's name.
function keeperName(address) {
  const a = agents().find((x) => x.address === (address ?? A.agent));
  return a?.program?.name ?? "the agent";
}

function card(m, t) {
  const text = m.input.value().trim();
  const line = m.said || (m.spot ? (m.spot.w || m.spot.h ? "A note on the marked area." : "A note on the marked spot.")
    : `Click a spot or drag over an area, or write to ${keeperName()} about all of it.`);
  return v_flex().id("art-mark-card").absolute().left(10).right(10).bottom(10).p(8).gap(6).rounded(10)
    .bg(t.popover).border_1().border_color(t.border).shadow_lg().cursor_default().text_size(12)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
    .on_key_down((e, cx) => {
      if (e.keystroke !== "escape" && e.key !== "escape") return;
      cx.stop_propagation();
      if (m.spot) { m.spot = null; m.shot = null; cx.notify(); } else stop();
    })
    // The hint wraps, so it's never cut at a narrow width.
    .child(h_flex().min_h(16).gap(8).items_start().px(2)
      .child(div().flex_1().min_w(0).text_color(m.failed ? t.blocked : t.muted).child(line))
      .when(Boolean(m.spot) && !m.said, (el) => el.child(div().id("art-mark-clear").flex_none().cursor_pointer().font_medium()
        .text_color(t.accent).hover((s) => s.underline())
        .on_click((_e, cx) => { m.spot = null; m.shot = null; cx.notify(); })
        .child("Clear spot"))))
    .child(h_flex().gap(6).items_center()
      .child(Input.new(m.input).flex_1().min_w(0).h(32).px(10).rounded(8).border_1().border_color(t.input).bg(t.background)
        .text_size(13).text_color(t.foreground))
      .child(div().id("art-mark-send").size(32).flex_none().flex().items_center().justify_center().rounded(8)
        .bg(t.solid).text_color(t.solid_foreground)
        .when(!text || m.sending, (el) => el.opacity(0.45))
        .when(Boolean(text) && !m.sending, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)))
        .on_click((_e, cx) => send(m, cx))
        .child(svg("mods/artifacts/send.svg").size(16))));
}

// ---- sending -------------------------------------------------------------------------------

const REGION_Y = ["top", "middle", "bottom"], REGION_X = ["left", "center", "right"];

// The spot in words, for the agent: "the 180×80 px area at x 120–300, y 80–160 of the 720×540
// panel (near the top left)".
function describe(s, size) {
  const W = Math.round(size?.width ?? 0), H = Math.round(size?.height ?? 0);
  const r = (v) => Math.round(v);
  const third = (v, n) => Math.min(2, Math.max(0, Math.floor((v / Math.max(1, n)) * 3)));
  const yx = [REGION_Y[third(s.y + s.h / 2, H)], REGION_X[third(s.x + s.w / 2, W)]];
  const near = yx[0] === "middle" && yx[1] === "center" ? "the middle" : yx[0] === "middle" ? `the middle ${yx[1]}` : yx[1] === "center" ? `the ${yx[0]} center` : `the ${yx[0]} ${yx[1]}`;
  const of = W && H ? ` of the ${W}×${H} panel` : "";
  return s.w || s.h
    ? `the ${r(s.w)}×${r(s.h)} px area at x ${r(s.x)}–${r(s.x + s.w)}, y ${r(s.y)}–${r(s.y + s.h)}${of} (near ${near})`
    : `the point at x ${r(s.x)}, y ${r(s.y)}${of} (near ${near})`;
}

function send(m, cx) {
  const text = m.input.value().trim();
  if (!text || m.sending) return;
  const args = ["note", A.id, "--text", text, "--version", String(A.version), "--json"];
  if (m.spot) {
    args.push("--spot", describe(m.spot, m.size));
    if (m.shot && m.origin && m.size) {
      const o = m.origin, s = m.spot;
      args.push("--shot", m.shot, "--panel", [o.x, o.y, m.size.width, m.size.height].join(","), "--area", [o.x + s.x, o.y + s.y, s.w, s.h].join(","));
    }
  }
  if (A.machine) args.push("--from", A.machine);
  m.sending = true;
  m.said = "Sending…";
  m.failed = false;
  cx.notify();
  cx.spawn(async (cx) => {
    let out = null, err = null;
    try {
      const r = await exec(CLI(), args);
      try { out = JSON.parse(r.stdout.trim().split("\n").pop() || "null"); } catch {}
      if (r.code !== 0 || !out || out.error) err = out?.error || r.stderr.trim() || "That didn't go through. Try again.";
    } catch (e) { err = String(e?.message ?? e); }
    m.sending = false;
    if (err) { m.said = err; m.failed = true; }
    else {
      m.said = `Sent to ${keeperName(out.to)}. A new version shows here when it's in.`;
      m.input.set_value("");
      m.spot = null;
      m.shot = null;
    }
    cx.notify();
  });
}
