// The artifact viewer's toolbar (props.artifact; artview.js opens it): its icon,
// title and which version; the version stepper (‹ v3 of 5 ›, as Shepherdr steps back through
// versions; "· Latest ›" when an older one shows); Mark up (mods/artifacts/markup.js draws the
// layer over the artifact while shared "artifacts.markup" names it); Open in the sidebar; close.
// An older version is its own mod (art-<id>--v<n>, herdr-artifact pull --version): stepping
// reopens the viewer on that mod. mods/artifacts/main.js has the sidebar's copy of the stepper
// (mods can't import each other's files; keep the two in step). Colors are the theme's.

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, closeOverlay, shared, setShared, theme } from "herdr";
import { showInSidebar, hasSidebarView } from "./artifact-sidebar.js";
import { artifactCli as cli, showViewer } from "./artview.js";
import { toast, plainError, TEXT, RADIUS } from "./ui.js";

const MARKUP = "artifacts.markup";

export function initArtifactBar(view, cx) {
  const a = props().artifact;
  view.art = { versions: null, busy: false };
  // Its versions (kept: the last 20), for the stepper; the record lives on the artifact's machine.
  cx.spawn(async (cx) => {
    try { view.art.versions = (await cli(a.machine, ["show", a.id])).versions ?? []; } catch { view.art.versions = []; }
    cx.notify();
  });
}

// The newest version: what the Artifacts list last read, else the record, else this one.
function latestOf(a, versions) {
  const base = a.base ?? a.mod;
  const t = (shared("artifacts.titles") ?? {})[base];
  const fromTitles = t ? Number(/· v(\d+)$/.exec(t)?.[1]) : NaN;
  const fromRecord = versions?.length ? versions[versions.length - 1].v : NaN;
  return Math.max(...[fromTitles, fromRecord, a.latest ?? a.version, a.version].filter((n) => Number.isFinite(n)));
}

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
}

// Shows version v (null: the latest) in this viewer: its mod made in this app, then the viewer
// opened again on that mod.
function step(view, a, v, cx) {
  if (view.art.busy) return;
  view.art.busy = true;
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      const out = await cli(null, ["pull", a.id, ...(a.machine ? ["--from", a.machine] : []), ...(v ? ["--version", String(v)] : [])]);
      const latest = latestOf(a, view.art.versions);
      if (shared(MARKUP)?.mod === a.mod) setShared(MARKUP, null);
      closeOverlay(props().overlay);
      showViewer({ ...a, mod: out.mod, base: a.base ?? a.mod, version: v ?? latest, latest });
    } catch (e) {
      toast({ title: "That version didn't open", body: plainError(e), level: "error" });
      view.art.busy = false;
      cx.notify();
    }
  });
}

// ---- drawing ---------------------------------------------------------------------------------

function iconBtn(id, icon, act, t, off = false) {
  return div().id(id).size(32).flex_none().flex().items_center().justify_center().rounded(RADIUS.control)
    .text_color(off ? t.border : t.muted)
    .when(!off, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { cx.stop_propagation(); act(cx); cx.notify(); }))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .child(svg(icon).size(16));
}

function textBtn(id, icon, label, act, on, t) {
  return h_flex().id(id).h(32).flex_none().pl(icon ? 8 : 10).pr(10).gap(6).items_center().rounded(RADIUS.control).cursor_pointer()
    .text_size(TEXT.body).font_medium().text_color(on ? t.foreground : t.muted).when(Boolean(on), (el) => el.bg(t.selected))
    .hover((s) => s.bg(on ? t.selected : t.hover).text_color(t.foreground))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); act(cx); cx.notify(); })
    .when(Boolean(icon), (el) => el.child(svg(icon).size(16).flex_none()))
    .child(label);
}

const rule = (t) => div().w(1).h(18).mx(4).flex_none().bg(t.border);

export function artifactBar(view, a, handle) {
  const t = theme();
  const titles = shared("artifacts.titles") ?? {};
  const title = (titles[a.base ?? a.mod] ?? a.title ?? "Artifact").split(" · ")[0];
  const vs = view.art?.versions ?? [];
  const latest = latestOf(a, vs);
  const shown = a.version ?? latest;
  const older = shown < latest;
  const kept = vs.map((x) => x.v);
  const prev = kept.filter((v) => v < shown).pop() ?? null;
  const next = kept.find((v) => v > shown) ?? null;
  const me = vs.find((x) => x.v === shown);
  const stepper = kept.length > 1 || older;
  const marking = shared(MARKUP)?.mod === a.mod && shared(MARKUP)?.where === "viewer";
  const busy = view.art?.busy;
  // In a modal (opened from a dialog) the bar sits on the modal's own surface, without "Open in
  // the sidebar": the dialog under it covers the sidebar.
  return h_flex().id("bar").size_full().pl(16).pr(8).gap(2).items_center().bg(a.modal ? t.popover : `${t.background}f2`)
    .track_focus(handle)
    .child(h_flex().flex_1().min_w(0).gap(8).items_center().text_size(TEXT.body)
      .child(svg("mods/artifacts/artifacts.svg").size(14).flex_none().text_color(t.muted))
      .child(div().min_w(0).truncate().font_medium().text_color(t.foreground).child(title))
      // One version only: which and when. Several: the stepper says it.
      .when(busy || !stepper, (el) => el.child(div().flex_none().text_size(TEXT.label).text_color(t.muted)
        .child(busy ? "Opening…" : `v${shown}${me?.at ? ` · ${ago(me.at)}` : ""}`))))
    .when(stepper, (el) => el
      .child(iconBtn("v-prev", "mods/chat-image/chevron-left.svg", (cx) => step(view, a, prev, cx), t, !prev || busy))
      .child(div().id("v-label").h(32).px(4).flex_none().flex().items_center().text_size(TEXT.label).text_color(older ? t.foreground : t.muted)
        .child(`v${shown} of ${latest}`))
      .child(iconBtn("v-next", "mods/chat-image/chevron-right.svg", (cx) => step(view, a, next === latest ? null : next, cx), t, !next || busy))
      // An older one: "v2 of 5 · Latest ›".
      .when(older && !busy, (el) => el.child(div().px(2).text_size(TEXT.label).text_color(t.dim).child("·"))
        .child(textBtn("latest", null, "Latest ›", (cx) => step(view, a, null, cx), false, t)))
      .child(rule(t)))
    // Mark up / Done, as the sidebar's (artifacts/main.js) and the web's: a pointer clicking a spot; while marking, Done
    // with a tick, tinted the accent of the frame round what you mark
    .child(h_flex().id("markup").h(32).flex_none().pl(8).pr(10).gap(6).items_center().rounded(RADIUS.control).cursor_pointer()
      .text_size(TEXT.body).font_medium().text_color(marking ? t.foreground : t.muted).when(marking, (el) => el.bg(`${t.accent}24`))
      .hover((s) => s.bg(marking ? `${t.accent}33` : t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); setShared(MARKUP, marking ? null : { mod: a.mod, where: "viewer", at: Date.now() }); cx.notify(); })
      .child(marking ? svg("mods/chat-image/check.svg").size(16).flex_none().text_color(t.accent) : svg("mods/chat-image/markup.svg").size(16).flex_none())
      .child(marking ? "Done" : "Mark up"))
    .child(rule(t))
    .when(!a.modal && hasSidebarView(), (el) => el
      .child(iconBtn("sidebar", "mods/chat-image/panel-right.svg", () => {
        if (marking) setShared(MARKUP, null);
        const done = showInSidebar({ ...a, latest });
        if (done) done.then(() => closeOverlay(props()?.overlay));
      }, t))
      .child(rule(t)))
    .child(iconBtn("close", "mods/chat-image/x.svg", () => closeOverlay(props()?.overlay), t));
}

// The viewer going away ends its Mark up.
export function closeArtifactBar(a) {
  const m = shared(MARKUP);
  if (m && m.mod === a.mod && m.where === "viewer") setShared(MARKUP, null);
}
