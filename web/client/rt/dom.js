// Draws a view's element tree as DOM and keeps it up to date (a keyed diff, ids as keys), and
// delivers pointer and key events the way GPUI does: to every handler from the element out,
// until one stops it. Touch: a tap is a click (and shows hover), a long press is a right click.
import { Entity, dispatch, makeCx, safe } from "./views.js";
import { renderMarkdown } from "./markdown.js";

const sheet = document.head.appendChild(document.createElement("style")).sheet;
const classes = new Map();
const cssText = (css) => Object.entries(css).map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${v}`).join(";");
function classFor(rule, css) {
  const body = cssText(css).replace(/;/g, " !important;") + " !important";
  const key = `${rule}|${body}`;
  let c = classes.get(key);
  if (!c) {
    c = `c${classes.size}`;
    classes.set(key, c);
    try { sheet.insertRule(rule.replace(/&/g, `.${c}`) + `{${body}}`); } catch {}
  }
  return c;
}

export const appPath = (p) => (p?.startsWith("/") ? `file?path=${encodeURIComponent(p)}` : `app/${p}`);

const kindOf = (c) => (c instanceof Entity ? "entity" : typeof c === "string" || typeof c === "number" ? "text" : c?.text !== undefined && !c.tag ? "text" : "el");
const textOf = (c) => (typeof c === "object" ? c.text : String(c));

export function mount(c, rec) {
  const kind = kindOf(c);
  if (kind === "text") return document.createTextNode(textOf(c));
  if (kind === "entity") { if (!c.rec.dom) c.rec.draw(); return c.rec.host; }
  const tag = c.tag === "input" ? "input" : c.tag === "textarea" ? "textarea" : c.tag === "img" ? "img" : "div";
  const dom = document.createElement(tag);
  apply(dom, null, c, rec);
  if (!["input", "textarea", "md", "img"].includes(c.tag)) for (const k of kidsOf(c, rec)) dom.appendChild(mount(k, rec));
  return dom;
}

export function patch(dom, old, c, rec) {
  const kind = kindOf(c);
  if (kind !== kindOf(old) || (kind === "el" && (old.tag !== c.tag || old.x.state !== c.x.state)) || (kind === "entity" && old !== c)) {
    const fresh = mount(c, rec);
    unmount(dom);
    dom.replaceWith(fresh);
    return fresh;
  }
  if (kind === "text") { const t = textOf(c); if (dom.nodeValue !== t) dom.nodeValue = t; return dom; }
  if (kind === "entity") return dom;
  apply(dom, old, c, rec);
  if (!["input", "textarea", "md", "img"].includes(c.tag)) patchKids(dom, kidsOf(old, rec, true), kidsOf(c, rec), rec);
  return dom;
}

// A virtual list draws all its rows (the page scrolls them natively).
function kidsOf(c, rec, old = false) {
  if (c.tag !== "list") return c.kids;
  if (old) return c.x.rows ?? [];
  const cx = makeCx(rec, "render");
  c.x.rows = c.x.render({ start: 0, end: c.x.count }, cx) ?? [];
  c.x.rows.forEach((r, i) => { if (r && typeof r === "object" && !(r instanceof Entity) && r.key == null) r.key = `row:${c.x.key(i)}`; });
  return c.x.rows;
}

const keyOf = (c, i) => (c instanceof Entity ? `e:${c.rec.host.dataset.k ??= Math.random()}` : c && typeof c === "object" && c.key != null ? `k:${c.key}` : `i:${i}`);

function patchKids(dom, oldKids, kids, rec) {
  const olds = new Map();
  const nodes = [...dom.childNodes].filter((n) => !n.__overlay);
  oldKids.forEach((k, i) => { let key = keyOf(k, i); while (olds.has(key)) key += "+"; olds.set(key, { el: k, node: nodes[i] }); });
  const next = [];
  const used = new Set();
  kids.forEach((k, i) => {
    let key = keyOf(k, i);
    while (used.has(key)) key += "+";
    used.add(key);
    const o = olds.get(key);
    if (o?.node) { olds.delete(key); next.push(patch(o.node, o.el, k, rec)); }
    else next.push(mount(k, rec));
  });
  for (const o of olds.values()) if (o.node) { unmount(o.node); o.node.remove(); }
  let at = dom.firstChild;
  for (const n of next) {
    if (n === at) { at = at.nextSibling; continue; }
    dom.insertBefore(n, at);
  }
}

function unmount(node) {
  if (node.__ro) node.__ro.disconnect();
  if (node.nodeType === 1) for (const c of node.querySelectorAll("[data-ro]")) c.__ro?.disconnect();
}

function apply(dom, old, c, rec) {
  dom.__el = c;
  dom.__rec = c.owner ?? rec;
  const css = { ...c.css };
  if (c.tag === "svg") {
    const url = `url("${appPath(c.x.src)}")`;
    Object.assign(css, { WebkitMaskImage: url, maskImage: url, WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center", maskPosition: "center", backgroundColor: "currentColor", flexShrink: css.flexShrink ?? "0" });
  }
  if (c.tag === "none") css.display = "none";
  if (c.tag === "list") { css.overflowY ??= "auto"; css.display ??= "flex"; css.flexDirection ??= "column"; }
  const style = cssText(css);
  if (dom.__style !== style) { dom.style.cssText = style; dom.__style = style; }
  const cls = ["e"];
  if (c.tag === "div" && !css.display) cls.push("blk");
  if (c.hov) cls.push(classFor("&:hover", c.hov));
  if (c.act) cls.push(classFor("&:active", c.act));
  if (c.groupName) cls.push(`g-${c.groupName.replace(/\W/g, "_")}`);
  for (const [g, gcss] of c.groupHov ?? []) cls.push(classFor(`.g-${g.replace(/\W/g, "_")}:hover &`, gcss));
  if (c.x.selectable) cls.push("sel");
  if (c.tag === "md") cls.push("md");
  if (c.tag === "list") cls.push("lst");
  const className = cls.join(" ");
  if (dom.className !== className) dom.className = className;
  if (c.tip) dom.title = c.tip; else if (dom.title) dom.removeAttribute("title");
  if (c.key != null) dom.dataset.id = c.key;
  if (c.tag === "img") { const src = appPath(c.x.src); if (dom.getAttribute("src") !== src) dom.src = src; dom.style.objectFit ||= "contain"; dom.draggable = false; }
  if (c.tag === "md" && (!old || old.x.text !== c.x.text)) dom.innerHTML = renderMarkdown(c.x.text);
  if (c.x.focus) { c.x.focus.dom = dom; if (!dom.hasAttribute("tabindex") && c.tag !== "input" && c.tag !== "textarea") dom.tabIndex = -1; if (c.x.focus.pending) { c.x.focus.pending = false; requestAnimationFrame(() => c.x.focus.focus()); } }
  if (c.x.scroll) c.x.scroll.attach(dom);
  if (c.x.state) c.x.state.bind(dom, c);
  if (c.on?.mdo) dom.dataset.mdo = "1"; else delete dom.dataset.mdo;
  if (c.on?.hover && !dom.__hoverOn) {
    dom.__hoverOn = true;
    dom.addEventListener("pointerenter", () => fire(dom, "hover", true));
    dom.addEventListener("pointerleave", () => fire(dom, "hover", false));
  }
  if (c.on?.size && !dom.__ro) {
    dom.dataset.ro = "1";
    let last = "";
    dom.__ro = new ResizeObserver(([e]) => {
      const size = { width: Math.round(e.contentRect.width + pad(dom, "x")), height: Math.round(e.contentRect.height + pad(dom, "y")) };
      const k = `${size.width}x${size.height}`;
      if (k === last) return;
      last = k;
      fire(dom, "size", size);
    });
    dom.__ro.observe(dom);
  }
}
const pad = (d, axis) => { const s = getComputedStyle(d); return axis === "x" ? parseFloat(s.paddingLeft) + parseFloat(s.paddingRight) + parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth) : parseFloat(s.paddingTop) + parseFloat(s.paddingBottom) + parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth); };

function fire(dom, kind, arg) {
  const fn = dom.__el?.on?.[kind];
  const rec = dom.__rec;
  if (!fn || !rec?.alive) return;
  safe(rec, () => fn(arg, makeCx(rec)));
}

// ---- events, delivered from the element out -------------------------------------------------
const mods = (e) => ({ shift: e.shiftKey, control: e.ctrlKey, alt: e.altKey, platform: e.metaKey, function: false });
const BUTTON = ["left", "middle", "right"];
function bounds(d) { const r = d.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }

function deliver(start, pick, makeEvent) {
  dispatch.stopped = false;
  let n = 0;
  for (let d = start; d && d !== document.body; d = d.parentNode) {
    const fn = d.__el && pick(d.__el);
    if (!fn) continue;
    const rec = d.__rec;
    if (!rec?.alive) continue;
    n++;
    safe(rec, () => fn(makeEvent(d), makeCx(rec)));
    if (dispatch.stopped) break;
  }
  return n;
}
const pointerEvent = (e, button) => (d) => {
  const b = bounds(d);
  return { button, click_count: e.detail || 1, position: { x: e.clientX, y: e.clientY }, local_position: { x: e.clientX - b.x, y: e.clientY - b.y }, bounds: b, modifiers: mods(e) };
};

let longPress = null;
let suppressClick = false;
const inField = (t) => t?.closest?.("input,textarea,.sel");

addEventListener("pointerdown", (e) => {
  const button = BUTTON[e.button] ?? "left";
  // Presses outside an element that listens for them (menus close so).
  for (const d of document.querySelectorAll("[data-mdo]")) {
    if (!d.contains(e.target)) { const fn = d.__el?.on?.mdo; const rec = d.__rec; if (fn && rec?.alive) safe(rec, () => fn(pointerEvent(e, button)(d), makeCx(rec))); }
  }
  if (e.pointerType === "touch") {
    const x = e.clientX, y = e.clientY, target = e.target;
    clearTimeout(longPress?.timer);
    longPress = { x, y, timer: setTimeout(() => {
      longPress = null;
      suppressClick = true;
      navigator.vibrate?.(10);
      deliver(target, (el) => el.on?.down?.right, pointerEvent({ clientX: x, clientY: y, detail: 1, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }, "right"));
    }, 500) };
  }
  deliver(e.target, (el) => el.on?.down?.[button], pointerEvent(e, button));
}, true);
addEventListener("pointermove", (e) => {
  if (longPress && Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > 10) { clearTimeout(longPress.timer); longPress = null; }
  if (e.pointerType === "mouse") deliver(e.target, (el) => el.on?.mousemove, (d) => { const b = bounds(d); return { position: { x: e.clientX, y: e.clientY }, local_position: { x: e.clientX - b.x, y: e.clientY - b.y }, bounds: b, modifiers: mods(e) }; });
}, { passive: true });
for (const end of ["pointerup", "pointercancel"]) addEventListener(end, (e) => {
  if (longPress) { clearTimeout(longPress.timer); longPress = null; }
  if (end === "pointerup") deliver(e.target, (el) => el.on?.up?.[BUTTON[e.button] ?? "left"], pointerEvent(e, BUTTON[e.button] ?? "left"));
}, true);
addEventListener("click", (e) => {
  if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
  if (e.target.closest?.("a[href]")) return;
  deliver(e.target, (el) => el.on?.click, (d) => ({ ...pointerEvent(e, "left")(d), click_count: e.detail || 1 }));
});
addEventListener("contextmenu", (e) => { if (!inField(e.target)) e.preventDefault(); });
addEventListener("wheel", (e) => {
  deliver(e.target, (el) => el.on?.wheel, (d) => { const b = bounds(d); return { delta: { x: -e.deltaX, y: -e.deltaY }, touch_phase: "moved", position: { x: e.clientX, y: e.clientY }, local_position: { x: e.clientX - b.x, y: e.clientY - b.y }, bounds: b, modifiers: mods(e) }; });
}, { passive: true });

const KEYS = { Enter: "enter", Escape: "escape", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Backspace: "backspace", Delete: "delete", Tab: "tab", " ": "space", Home: "home", End: "end", PageUp: "pageup", PageDown: "pagedown" };
export function keyEvent(e) {
  const key = KEYS[e.key] ?? e.key.toLowerCase();
  const parts = [e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && key.length > 1 && "shift", e.metaKey && "cmd", key].filter(Boolean);
  return { key, keystroke: parts.join("-"), key_char: e.key.length === 1 ? e.key : undefined, modifiers: mods(e), is_held: e.repeat };
}
addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  const ev = keyEvent(e);
  const start = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  if (!start) return;
  dispatch.stopped = false;
  deliver(start, (el) => el.on?.keydown, () => ev);
  if (dispatch.stopped) e.preventDefault();
});
