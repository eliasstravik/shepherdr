// gpui-kit's element builder for the page: a chain of GPUI style and event calls recorded on
// one object, drawn as DOM by dom.js. GPUI lengths: a bare number is pixels.
import { owner } from "./views.js";

const px = (v) => (typeof v === "number" ? `${v}px` : v === "auto" ? "auto" : String(v));
const warned = new Set();

// Tailwind's spacing scale as GPUI has it (1 = 0.25 rem = 4 px).
const scale = (s) => (s === "full" ? "100%" : s === "auto" ? "auto" : s === "px" ? "1px" : /^\d+_\d+$/.test(s) ? `${(100 * +s.split("_")[0]) / +s.split("_")[1]}%` : `${parseFloat(s.replace("p", ".")) * 4}px`);
const SIDES = {
  p: ["padding"], px: ["paddingLeft", "paddingRight"], py: ["paddingTop", "paddingBottom"], pt: ["paddingTop"], pb: ["paddingBottom"], pl: ["paddingLeft"], pr: ["paddingRight"],
  m: ["margin"], mx: ["marginLeft", "marginRight"], my: ["marginTop", "marginBottom"], mt: ["marginTop"], mb: ["marginBottom"], ml: ["marginLeft"], mr: ["marginRight"],
  w: ["width"], h: ["height"], size: ["width", "height"], min_w: ["minWidth"], min_h: ["minHeight"], max_w: ["maxWidth"], max_h: ["maxHeight"],
  gap: ["gap"], gap_x: ["columnGap"], gap_y: ["rowGap"], top: ["top"], left: ["left"], right: ["right"], bottom: ["bottom"], inset: ["top", "right", "bottom", "left"],
};
const BORDER = { border: ["borderWidth"], border_t: ["borderTopWidth"], border_b: ["borderBottomWidth"], border_l: ["borderLeftWidth"], border_r: ["borderRightWidth"], border_x: ["borderLeftWidth", "borderRightWidth"], border_y: ["borderTopWidth", "borderBottomWidth"] };
const RADII = { rounded: ["borderRadius"], rounded_t: ["borderTopLeftRadius", "borderTopRightRadius"], rounded_b: ["borderBottomLeftRadius", "borderBottomRightRadius"], rounded_l: ["borderTopLeftRadius", "borderBottomLeftRadius"], rounded_r: ["borderTopRightRadius", "borderBottomRightRadius"], rounded_tl: ["borderTopLeftRadius"], rounded_tr: ["borderTopRightRadius"], rounded_bl: ["borderBottomLeftRadius"], rounded_br: ["borderBottomRightRadius"] };
const RADIUS_NAMED = { none: 0, xs: 2, sm: 4, md: 6, lg: 8, xl: 12, "2xl": 16, "3xl": 24, full: 9999 };
const TEXT = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30 };
const WEIGHT = { thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
const SHADOW = {
  shadow_none: "none", shadow_xs: "0 1px 2px rgba(0,0,0,.05)", shadow_sm: "0 1px 3px rgba(0,0,0,.1),0 1px 2px -1px rgba(0,0,0,.1)",
  shadow_md: "0 4px 6px -1px rgba(0,0,0,.1),0 2px 4px -2px rgba(0,0,0,.1)", shadow_lg: "0 10px 15px -3px rgba(0,0,0,.25),0 4px 6px -4px rgba(0,0,0,.2)",
  shadow_xl: "0 20px 25px -5px rgba(0,0,0,.3),0 8px 10px -6px rgba(0,0,0,.2)", shadow_2xl: "0 25px 50px -12px rgba(0,0,0,.4)",
};
const set = (keys) => (el, v) => { for (const k of keys) el.css[k] = v; };

// Fixed styles: a method name and the CSS it sets.
const FIXED = {
  flex: { display: "flex" }, block: { display: "block" }, hidden: { display: "none" }, grid: { display: "grid" },
  flex_row: { flexDirection: "row" }, flex_col: { flexDirection: "column" }, flex_row_reverse: { flexDirection: "row-reverse" }, flex_col_reverse: { flexDirection: "column-reverse" },
  flex_wrap: { flexWrap: "wrap" }, flex_nowrap: { flexWrap: "nowrap" }, flex_wrap_reverse: { flexWrap: "wrap-reverse" },
  flex_1: { flex: "1 1 0%" }, flex_auto: { flex: "1 1 auto" }, flex_initial: { flex: "0 1 auto" }, flex_none: { flex: "none" },
  flex_grow: { flexGrow: "1" }, flex_grow_0: { flexGrow: "0" }, flex_shrink: { flexShrink: "1" }, flex_shrink_0: { flexShrink: "0" },
  items_start: { alignItems: "flex-start" }, items_center: { alignItems: "center" }, items_end: { alignItems: "flex-end" }, items_baseline: { alignItems: "baseline" }, items_stretch: { alignItems: "stretch" },
  justify_start: { justifyContent: "flex-start" }, justify_center: { justifyContent: "center" }, justify_end: { justifyContent: "flex-end" }, justify_between: { justifyContent: "space-between" }, justify_around: { justifyContent: "space-around" }, justify_evenly: { justifyContent: "space-evenly" },
  content_start: { alignContent: "flex-start" }, content_center: { alignContent: "center" }, content_end: { alignContent: "flex-end" }, content_between: { alignContent: "space-between" }, content_stretch: { alignContent: "stretch" },
  self_start: { alignSelf: "flex-start" }, self_center: { alignSelf: "center" }, self_end: { alignSelf: "flex-end" }, self_stretch: { alignSelf: "stretch" }, self_baseline: { alignSelf: "baseline" },
  absolute: { position: "absolute" }, relative: { position: "relative" },
  inset_0: { top: "0", right: "0", bottom: "0", left: "0" },
  size_full: { width: "100%", height: "100%" }, w_full: { width: "100%" }, h_full: { height: "100%" },
  overflow_hidden: { overflow: "hidden" }, overflow_x_hidden: { overflowX: "hidden" }, overflow_y_hidden: { overflowY: "hidden" },
  overflow_scroll: { overflow: "auto" }, overflow_x_scroll: { overflowX: "auto" }, overflow_y_scroll: { overflowY: "auto" },
  overflow_x_scrollbar: { overflowX: "auto" }, overflow_y_scrollbar: { overflowY: "auto" }, overflow_visible: { overflow: "visible" },
  truncate: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, text_ellipsis: { textOverflow: "ellipsis" },
  whitespace_nowrap: { whiteSpace: "nowrap" }, whitespace_normal: { whiteSpace: "normal" },
  text_left: { textAlign: "left" }, text_center: { textAlign: "center" }, text_right: { textAlign: "right" },
  italic: { fontStyle: "italic" }, not_italic: { fontStyle: "normal" }, underline: { textDecoration: "underline" }, line_through: { textDecoration: "line-through" }, no_underline: { textDecoration: "none" },
  invisible: { visibility: "hidden" }, visible: { visibility: "visible" },
  border_dashed: { borderStyle: "dashed" }, border_solid: { borderStyle: "solid" },
  cursor_pointer: { cursor: "pointer" }, cursor_default: { cursor: "default" }, cursor_text: { cursor: "text" }, cursor_grab: { cursor: "grab" }, cursor_grabbing: { cursor: "grabbing" },
  cursor_crosshair: { cursor: "crosshair" }, cursor_move: { cursor: "move" }, cursor_not_allowed: { cursor: "not-allowed" }, cursor_ew_resize: { cursor: "ew-resize" }, cursor_ns_resize: { cursor: "ns-resize" },
  cursor_col_resize: { cursor: "col-resize" }, cursor_row_resize: { cursor: "row-resize" },
  aspect_square: { aspectRatio: "1" }, mx_auto: { marginLeft: "auto", marginRight: "auto" }, my_auto: { marginTop: "auto", marginBottom: "auto" },
  ml_auto: { marginLeft: "auto" }, mr_auto: { marginRight: "auto" }, mt_auto: { marginTop: "auto" }, mb_auto: { marginBottom: "auto" },
  ...SHADOW && Object.fromEntries(Object.entries(SHADOW).map(([k, v]) => [k, { boxShadow: v }])),
  ...Object.fromEntries(Object.entries(WEIGHT).map(([k, v]) => [`font_${k}`, { fontWeight: String(v) }])),
  ...Object.fromEntries(Object.entries(TEXT).map(([k, v]) => [`text_${k}`, { fontSize: `${v}px` }])),
  ...Object.fromEntries(Object.entries(RADIUS_NAMED).map(([k, v]) => [`rounded_${k}`, { borderRadius: `${v}px` }])),
};
// Things that draw nothing in the page (yet), kept so a chain goes on.
const NOOP = new Set(["occlude", "debug", "transition", "key_context", "on_action", "bind_keys", "role", "aria_label", "on_drag", "on_drag_move",
  "on_drop", "drag_over", "can_drop", "block_mouse_except_scroll", "occlude_mouse", "priority", "anchor", "close_delay", "open_delay", "snap_to_window",
  "on_mouse_down_out_capture", "accessibility_label", "label", "z_index", "on_any_mouse_down", "debug_selector", "on_modifiers_changed"]);

// Valued styles: name -> (el, value).
const VALUED = {
  bg: (el, v) => { el.css.background = typeof v === "object" && v?.css ? v.css : v; },
  text_color: (el, v) => { el.css.color = v; },
  text_size: (el, v) => { el.css.fontSize = px(v); },
  font_family: (el, v) => { el.css.fontFamily = `"${v}", ${/mono/i.test(v) ? "ui-monospace, monospace" : "system-ui, sans-serif"}`; },
  font_weight: (el, v) => { el.css.fontWeight = String(v); },
  line_height: (el, v) => { el.css.lineHeight = typeof v === "number" ? String(v) : px(v); },
  border_color: (el, v) => { el.css.borderColor = v; },
  opacity: (el, v) => { el.css.opacity = String(v); },
  flex_basis: (el, v) => { el.css.flexBasis = px(v); },
  aspect_ratio: (el, v) => { el.css.aspectRatio = String(v); },
  line_clamp: (el, v) => { Object.assign(el.css, { display: "-webkit-box", WebkitLineClamp: String(v), WebkitBoxOrient: "vertical", overflow: "hidden" }); },
  ...Object.fromEntries(Object.entries(SIDES).map(([k, keys]) => [k, (el, v) => set(keys)(el, px(v))])),
  ...Object.fromEntries(Object.entries(BORDER).map(([k, keys]) => [k, (el, v) => { set(keys)(el, px(v ?? 1)); el.css.borderStyle ??= "solid"; }])),
  ...Object.fromEntries(Object.entries(RADII).map(([k, keys]) => [k, (el, v) => set(keys)(el, px(v))])),
};

let ids = 0;
export class El {
  constructor(tag = "div") {
    this.tag = tag;
    this.css = {};
    this.kids = [];
    this.on = null;
    this.key = null;
    this.tip = null;
    this.hov = null;
    this.act = null;
    this.groupName = null;
    this.groupHov = null;
    this.x = {};
    this.owner = owner();
    this.n = ++ids;
    return new Proxy(this, HANDLER);
  }
}
const HANDLER = {
  get(t, k, r) {
    if (k in t || typeof k === "symbol") return Reflect.get(t, k, r);
    const fixed = FIXED[k];
    if (fixed) return () => { Object.assign(t.css, fixed); return r; };
    const valued = VALUED[k];
    if (valued) return (v) => { valued(t, v); return r; };
    // Tailwind-style names: p_2, w_full, gap_1p5, border_b_1, rounded_lg, top_neg_1...
    let m = /^(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|size|min_w|min_h|max_w|max_h|gap|gap_x|gap_y|top|left|right|bottom|inset)_(neg_)?(\d+(?:p5)?|full|auto|px|\d+_\d+)$/.exec(k);
    if (m) return () => { set(SIDES[m[1]])(t, (m[2] ? "-" : "") + scale(m[3])); return r; };
    m = /^(border(?:_[tblrxy])?)_(\d+)$/.exec(k);
    if (m) return () => { set(BORDER[m[1]])(t, `${m[2]}px`); t.css.borderStyle ??= "solid"; return r; };
    if (NOOP.has(k)) return () => r;
    if (!warned.has(k)) { warned.add(k); console.debug("[web] not drawn yet:", k); }
    return () => r;
  },
};
const P = El.prototype;
P.id = function (name) { this.key = String(name); return this; };
P.child = function (c) { if (c !== null && c !== undefined && c !== false && c !== true) this.kids.push(c); return this; };
P.children = function (cs) { for (const c of cs ?? []) this.child(c); return this; };
P.when = function (cond, fn) { return cond ? fn(this) ?? this : this; };
P.when_some = function (v, fn) { return v !== null && v !== undefined ? fn(this, v) ?? this : this; };
P.when_none = function (v, fn) { return v === null || v === undefined ? fn(this) ?? this : this; };
P.map = function (fn) { return fn(this); };
const styleOnly = (fn) => { const e = new El("div"); fn(e); return e.css; };
P.hover = function (fn) { this.hov = { ...(this.hov ?? {}), ...styleOnly(fn) }; return this; };
P.active = function (fn) { this.act = { ...(this.act ?? {}), ...styleOnly(fn) }; return this; };
P.focus = function (fn) { if (typeof fn === "function") this.x.focusCss = styleOnly(fn); return this; };
P.group = function (name) { this.groupName = String(name); return this; };
P.group_hover = function (name, fn) { (this.groupHov ??= []).push([String(name), styleOnly(fn)]); return this; };
P.tooltip = function (text) { this.tip = String(text ?? ""); return this; };
const handle = (kind) => function (fn) { (this.on ??= {})[kind] = fn; return this; };
P.on_click = handle("click");
P.on_hover = handle("hover");
P.on_mouse_move = handle("mousemove");
P.on_key_down = handle("keydown");
P.on_key_up = handle("keyup");
P.on_scroll_wheel = handle("wheel");
P.on_mouse_down_out = handle("mdo");
P.on_size_change = handle("size");
P.on_mouse_down = function (button, fn) { ((this.on ??= {}).down ??= {})[button] = fn; return this; };
P.on_mouse_up = function (button, fn) { ((this.on ??= {}).up ??= {})[button] = fn; return this; };
P.track_focus = function (h) { this.x.focus = h; return this; };
P.track_scroll = function (h) { this.x.scroll = h; return this; };
P.selectable = function (v = true) { this.x.selectable = v; return this; };
P.content = function (el) { this.x.content = el; return this; };
P.trigger = function (el) { this.x.trigger = el; return this; };

export const div = () => new El("div");
export const svg = (path) => { const e = new El("svg"); e.x.src = path; return e; };
export const image = (path) => { const e = new El("img"); e.x.src = path; return e; };
