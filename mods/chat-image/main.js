// The chat's image viewer (mods/chat): a backdrop in the theme's colors over the chat pane, the
// image large in the middle, a toolbar on top (name and size; zoom out, the zoom % (a click:
// fit / actual size), zoom in; copy, open, show in folder; close), and when there are several, previous / next at the sides
// and "2 / 3" below. Zoom: the buttons, + - 0 1, the wheel (at the pointer; a trackpad pans
// when zoomed and zooms with ctrl), a double-click (fit <-> 100% at that spot). A zoomed image
// is dragged to pan. Left / Right step, Esc or a click beside the image closes.
// Opened as a frameless popup over the chat pane, at its size: props { images: [{ rel, w, h,
// name, path }], index, width, height }; `rel` is a path in the app's folder (attach.js
// viewable()), `path` the original file.
// Or an artifact (mods/artifacts), the same shell over the same chat pane (the whole window when
// it isn't opened from a chat): artview.js opens a layout overlay whose top block is this mod with props { artifact: { mod, id, title, version, machine } } (its toolbar,
// artifact-bar.js: title, version stepper, Mark up, Open in the sidebar, close) over the
// artifact's own mod, on the same backdrop.

import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, props, closeOverlay, readTextFile, settings, exec, appHome, window as win } from "herdr";
import { initArtifactBar, artifactBar, closeArtifactBar } from "./artifact-bar.js";
import { toast, TEXT, RADIUS } from "./ui.js";

const BAR = 48;                      // the toolbar's height
const MARGIN = 24;                   // room around a fitted image
const SIDE = 64;                     // room for the previous / next buttons
const STEP = 1.25;                   // one zoom step (buttons, keys)
const MAX = 8;                       // 800%
// The theme's own colors: its background, nearly opaque, behind; its text and hover on top.
const backdrop = (t) => `${t.background}f2`;

export default class ImageViewer extends View {
  init(_props, cx) {
    this.images = props()?.images ?? [];
    this.i = Math.min(Math.max(0, props()?.index ?? 0), Math.max(0, this.images.length - 1));
    this.size = { width: props()?.width ?? 800, height: props()?.height ?? 600 };
    this.reset();
    this.handle = cx.focus_handle();
    cx.timer.after(0, () => this.handle.focus());
    // Or a pasted text file, to read: props { textPath, title }.
    if (props()?.textPath) cx.spawn(async (cx) => { this.text = (await readTextFile(props().textPath).catch(() => null)) ?? "(can't read it)"; cx.notify(); });
    // Or an artifact's toolbar (artifact-bar.js): its versions, Mark up.
    if (props()?.artifact) initArtifactBar(this, cx);
  }

  async close() { if (props()?.artifact) closeArtifactBar(props().artifact); }

  // Back to fitted, centred.
  reset() { this.fit = true; this.scale = 1; this.ox = 0; this.oy = 0; }

  // A text file in a readable panel, its title on top.
  textView(t) {
    const w = Math.min(860, (props()?.width ?? 800) - 48), h = (props()?.height ?? 600) - 48;
    return v_flex().id("viewer").w(props()?.width ?? 800).h(props()?.height ?? 600).items_center().justify_center().bg(t.background + "e6")
      .track_focus(this.handle)
      .on_click(() => closeOverlay(props()?.overlay))
      .child(v_flex().id("text-panel").w(w).h(h).rounded(10).bg(t.popover).border_1().border_color(t.border).shadow_md().overflow_hidden()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => cx.stop_propagation())
        .child(h_flex().h(36).flex_none().px(14).items_center().border_b(1).border_color(t.border)
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_medium().text_color(t.foreground).child(props()?.title ?? "Pasted text")))
        .child(div().id("text-body").flex_1().min_h(0).p(14).overflow_y_scrollbar()
          .font_family(settings().font_family ?? "JetBrains Mono").text_size(12.5).text_color(t.foreground)
          .children(String(this.text ?? "").split("\n").slice(0, 5000).map((l) => div().min_h(18).child(l || " ")))));
  }

  // ---- geometry --------------------------------------------------------------------------

  img() { return this.images[this.i]; }
  many() { return this.images.length > 1; }

  // The stage: everything under the toolbar.
  stage() { return { w: Math.max(100, this.size.width), h: Math.max(100, this.size.height - BAR) }; }

  // The scale that fits the image in the stage (beside the arrows), never above 100%.
  fitScale() {
    const img = this.img(), s = this.stage();
    if (!img) return 1;
    const roomW = s.w - 2 * (this.many() ? SIDE : MARGIN), roomH = s.h - 2 * MARGIN - (this.many() ? 28 : 0);
    return Math.min(1, Math.max(40, roomW) / img.w, Math.max(40, roomH) / img.h);
  }

  shownScale() { return this.fit ? this.fitScale() : this.scale; }
  minScale() { return Math.min(this.fitScale(), 1) / 4; }

  // The image's drawn rect in the stage.
  rect() {
    const img = this.img(), s = this.stage(), k = this.shownScale();
    const w = img.w * k, h = img.h * k;
    return { w, h, left: s.w / 2 + this.ox - w / 2, top: s.h / 2 + this.oy - h / 2 };
  }

  // Keep a zoomed image covering the stage on each axis it overflows; centred on the others.
  clamp() {
    const img = this.img(), s = this.stage(), k = this.shownScale();
    if (!img) return;
    const lim = (size, room) => Math.max(0, (size - room) / 2);
    const lx = lim(img.w * k, s.w), ly = lim(img.h * k, s.h);
    this.ox = Math.max(-lx, Math.min(lx, this.ox));
    this.oy = Math.max(-ly, Math.min(ly, this.oy));
  }

  canPan() {
    const img = this.img(), s = this.stage(), k = this.shownScale();
    return Boolean(img) && (img.w * k > s.w + 0.5 || img.h * k > s.h + 0.5);
  }

  // Zoom to `to`, keeping the stage point `at` (default: its middle) still under the pointer.
  zoomTo(to, at) {
    if (!this.img()) return;
    const s = this.stage(), from = this.shownScale();
    const next = Math.max(this.minScale(), Math.min(MAX, to));
    const px = (at?.x ?? s.w / 2) - s.w / 2, py = (at?.y ?? s.h / 2) - s.h / 2;
    this.ox = px - (px - this.ox) * (next / from);
    this.oy = py - (py - this.oy) * (next / from);
    this.fit = false;
    this.scale = next;
    this.clamp();
  }

  zoomBy(f, at) { this.zoomTo(this.shownScale() * f, at); }

  // Fit <-> 100% (the toolbar's button, "1" / "0", a double-click at `at`).
  toggleActual(at) {
    if (this.fit && Math.abs(this.fitScale() - 1) > 0.001) this.zoomTo(1, at);
    else this.reset();
  }

  step(d) {
    if (!this.many()) return;
    this.i = (this.i + d + this.images.length) % this.images.length;
    this.reset();
  }

  // ---- actions on the file ---------------------------------------------------------------

  file() {
    const img = this.img();
    return img?.path ?? (img ? `${appHome()}/${img.rel}` : null);
  }

  copy(cx) {
    const p = this.file();
    if (!p) return;
    const os = win()?.platform;
    const run = os === "macos"
      ? exec("osascript", ["-e", `set the clipboard to (read (POSIX file "${p.replace(/"/g, '\\"')}") as «class PNGf»)`])
      : os === "windows"
        ? exec("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Clipboard]::SetImage([Drawing.Image]::FromFile($args[0]))`, p])
        // wl-copy stays behind to serve the clipboard: its output must not hold exec open.
        : exec("sh", ["-c", 'if [ -n "$WAYLAND_DISPLAY" ] && command -v wl-copy >/dev/null; then wl-copy < "$1" >/dev/null 2>&1; else xclip -selection clipboard -t "$(file -b --mime-type "$1")" -i "$1" >/dev/null 2>&1; fi', "copy", p]);
    run.then((r) => {
      if (r?.code && r.code !== 0) throw new Error(r.stderr || "copy failed");
      this.copied = true;
      cx.notify();
      cx.timer.after(1400, (cx) => { this.copied = false; cx.notify(); });
    }).catch(() => toast({ title: "Couldn't copy the image", level: "error" }));
  }

  openFile() {
    const p = this.file();
    if (!p) return;
    const os = win()?.platform;
    (os === "macos" ? exec("open", [p]) : os === "windows" ? exec("cmd", ["/c", "start", "", p]) : exec("xdg-open", [p])).catch(() => {});
  }

  // The file's folder in the file manager, the file selected where the system can.
  reveal() {
    const p = this.file();
    if (!p) return;
    const os = win()?.platform;
    if (os === "macos") return exec("open", ["-R", p]).catch(() => {});
    if (os === "windows") return exec("explorer", [`/select,${p}`]).catch(() => {});
    exec("sh", ["-c", 'dbus-send --session --print-reply --dest=org.freedesktop.FileManager1 /org/freedesktop/FileManager1 org.freedesktop.FileManager1.ShowItems array:string:"file://$1" string:"" >/dev/null 2>&1 || xdg-open "$(dirname "$1")"', "reveal", p]).catch(() => {});
  }

  // ---- input -----------------------------------------------------------------------------

  key(e, cx) {
    const k = e.key, mod = e.modifiers?.control || e.modifiers?.platform;
    if (k === "left") this.step(-1);
    else if (k === "right") this.step(1);
    else if (k === "=" || k === "+") this.zoomBy(STEP);
    else if (k === "-") this.zoomBy(1 / STEP);
    else if (k === "0") this.reset();
    else if (k === "1") this.zoomTo(1);
    else if (k === "c" && mod) return this.copy(cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  down(e, cx) {
    const at = e.local_position;
    const img = this.img();
    if (!img || !at) return;
    const r = this.rect();
    const on = at.x >= r.left && at.x <= r.left + r.w && at.y >= r.top && at.y <= r.top + r.h;
    if (on && e.click_count === 2) { this.press = null; this.toggleActual(at); cx.notify(); return; }
    this.press = { x: e.position.x, y: e.position.y, ox: this.ox, oy: this.oy, on, moved: false };
    if (on && this.canPan()) { this.dragging = true; cx.notify(); }
  }

  move(e, cx) {
    const p = this.press;
    if (!p) return;
    const dx = e.position.x - p.x, dy = e.position.y - p.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
    if (!this.dragging) return;
    this.ox = p.ox + dx;
    this.oy = p.oy + dy;
    this.clamp();
    cx.notify();
  }

  up(cx) {
    const p = this.press;
    this.press = null;
    if (this.dragging) { this.dragging = false; cx.notify(); }
    // A click on the backdrop (not a drag, not on the image) closes.
    if (p && !p.on && !p.moved) closeOverlay(props()?.overlay);
  }

  wheel(e, cx) {
    if (!this.img()) return;
    const at = e.local_position;
    const lines = e.delta_lines && (e.delta_lines.x || e.delta_lines.y);
    const zoomKey = e.modifiers?.control || e.modifiers?.platform;
    if (zoomKey || lines) {
      // A wheel's notch (lines) or a pinch / ctrl-scroll (pixels): zoom at the pointer.
      const dy = lines ? e.delta_lines.y * 40 : e.delta.y;
      if (!dy) return;
      this.zoomBy(Math.exp(Math.max(-1, Math.min(1, dy * 0.004))), at);
    } else if (this.canPan()) {
      // A trackpad's two-finger scroll pans a zoomed image.
      this.ox += e.delta.x;
      this.oy += e.delta.y;
      this.clamp();
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  // ---- drawing ---------------------------------------------------------------------------

  // A toolbar button: an icon, its own press (so the backdrop never sees it).
  btn(id, icon, act, t) {
    return div().id(id).size(32).flex_none().flex().items_center().justify_center().rounded(RADIUS.control).cursor_pointer()
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); act(cx); cx.notify(); })
      .child(svg(`mods/chat-image/${icon}.svg`).size(16));
  }

  rule(t) { return div().w(1).h(18).mx(4).flex_none().bg(t.border); }

  toolbar(img, t) {
    const pct = `${Math.round(this.shownScale() * 100)}%`;
    return h_flex().id("bar").w_full().h(BAR).flex_none().pl(16).pr(8).gap(2).items_center()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(h_flex().flex_1().min_w(0).gap(8).items_baseline().text_size(TEXT.body)
        .child(div().min_w(0).truncate().font_medium().text_color(t.foreground).child(img?.name ?? "Image"))
        .when(Boolean(img), (el) => el.child(div().flex_none().text_size(TEXT.label).text_color(t.muted).child(`${img.w} × ${img.h}`))))
      .when(Boolean(img), (el) => el
        .child(this.btn("zoom-out", "zoom-out", () => this.zoomBy(1 / STEP), t))
        // The zoom, and the one fit / actual size switch.
        .child(div().id("pct").w(52).h(32).flex_none().flex().items_center().justify_center().rounded(RADIUS.control).cursor_pointer()
          .text_size(TEXT.label).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); this.toggleActual(); cx.notify(); })
          .child(pct))
        .child(this.btn("zoom-in", "zoom-in", () => this.zoomBy(STEP), t))
        .child(this.rule(t))
        .child(this.btn("copy", this.copied ? "check" : "copy", (cx) => this.copy(cx), t))
        .child(this.btn("open", "external-link", () => this.openFile(), t))
        .child(this.btn("reveal", "folder-open", () => this.reveal(), t))
        .child(this.rule(t)))
      .child(this.btn("close", "x", () => closeOverlay(props()?.overlay), t));
  }

  arrow(id, icon, d, side, t) {
    const s = this.stage();
    return div().id(id).absolute().top(s.h / 2 - 20).when(side === "left", (el) => el.left(14)).when(side === "right", (el) => el.right(14))
      .size(40).flex().items_center().justify_center().rounded(20).cursor_pointer()
      .bg(t.raised).border_1().border_color(t.border).text_color(t.foreground).hover((st) => st.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.step(d); cx.notify(); })
      .child(svg(`mods/chat-image/${icon}.svg`).size(18));
  }

  render() {
    const t = theme();
    if (props()?.artifact) return artifactBar(this, props().artifact, this.handle);
    if (props()?.textPath) return this.textView(t);
    const img = this.img();
    const s = this.stage();
    if (img && !this.fit) this.clamp();
    const r = img ? this.rect() : null;
    const grab = img && this.canPan();
    return v_flex().id("viewer").w(props()?.width ?? this.size.width).h(props()?.height ?? this.size.height)
      .bg(backdrop(t))
      .track_focus(this.handle)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_move((e, cx) => this.move(e, cx))
      .on_mouse_up("left", (_e, cx) => this.up(cx))
      .child(this.toolbar(img, t))
      .child(div().id("stage").relative().w_full().flex_1().min_h(0).overflow_hidden()
        .when(Boolean(grab), (el) => (this.dragging ? el.cursor_grabbing() : el.cursor_grab()))
        .on_mouse_down("left", (e, cx) => this.down(e, cx))
        .on_scroll_wheel((e, cx) => this.wheel(e, cx))
        .when(Boolean(img), (el) => el.child(div().absolute().left(Math.round(r.left)).top(Math.round(r.top))
          .w(Math.round(r.w)).h(Math.round(r.h)).rounded(this.fit ? 4 : 0).overflow_hidden().shadow_lg()
          .child(image(img.rel).size_full())))
        .when(!img, (el) => el.child(div().size_full().flex().items_center().justify_center().text_size(TEXT.body).text_color(t.muted).child("Can't show this image.")))
        .when(this.many(), (el) => el
          .child(this.arrow("prev", "chevron-left", -1, "left", t))
          .child(this.arrow("next", "chevron-right", 1, "right", t))
          .child(div().absolute().bottom(14).left(s.w / 2 - 32).w(64).h(24).flex().items_center().justify_center().rounded(12)
            .bg(t.raised).text_size(TEXT.label).text_color(t.foreground).child(`${this.i + 1} / ${this.images.length}`))));
  }
}
