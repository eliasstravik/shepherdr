// "gpui-base" for mods in the page: rows and columns, text inputs, the virtual list (drawn
// whole, scrolled natively), Markdown text, and scrollbars (the page's own).
import { El } from "./el.js";
import { dispatch, makeCx, safe } from "./views.js";
import { keyEvent } from "./dom.js";
import { owner } from "./views.js";

export const h_flex = () => { const e = new El("div"); Object.assign(e.css, { display: "flex", flexDirection: "row", alignItems: "center" }); return e; };
export const v_flex = () => { const e = new El("div"); Object.assign(e.css, { display: "flex", flexDirection: "column" }); return e; };

// Retained text: the value lives here; the <input>/<textarea> it is drawn into follows it.
class TextState {
  constructor(opts = {}, multi = false) {
    this.v = opts.value ?? "";
    this.placeholder = opts.placeholder ?? "";
    this.multi = multi;
    this.handlers = { change: [], submit: [], focus: [], blur: [], paste_other: [] };
    this.dom = null;
    this.rec = owner();
    this.masked = false;
    this.rows = [1, 1];
  }
  value() { return this.v; }
  content() { return { text: this.v, tokens: [] }; }
  tokens() { return []; }
  set_value(next) { this.v = typeof next === "string" ? next : next?.text ?? ""; if (this.dom && this.dom.value !== this.v) { this.dom.value = this.v; this.grow(); } }
  replace(text) { const d = this.dom; if (!d) { this.v += text; return; } const s = d.selectionStart ?? this.v.length, e = d.selectionEnd ?? s; this.v = this.v.slice(0, s) + text + this.v.slice(e); d.value = this.v; d.setSelectionRange(s + text.length, s + text.length); this.grow(); }
  replace_with_token(t) { this.replace(t.text ?? ""); }
  replace_range_with_token(r, t) { this.v = this.v.slice(0, r.start) + (t.text ?? "") + this.v.slice(r.end); this.set_value(this.v); }
  set_selected_range(r) { this.dom?.setSelectionRange(r.start, r.end); }
  on(ev, fn) { (this.handlers[ev] ??= []).push(fn); return true; }
  set_masked(m) { this.masked = m; if (this.dom && !this.multi) this.dom.type = m ? "password" : "text"; }
  set_loading() {}
  set_step() {} set_min() {} set_max() {}
  set_rows(n) { this.rows = [n, n]; this.grow(); }
  set_auto_grow(a, b) { this.rows = [a, b]; this.grow(); }
  set_soft_wrap() {}
  focus() { if (this.dom?.isConnected) this.dom.focus({ preventScroll: true }); else this.wantFocus = true; }
  release() { return true; }
  emit(ev, arg = {}) {
    const rec = this.dom?.__rec ?? this.rec;
    for (const fn of this.handlers[ev] ?? []) if (rec) safe(rec, () => fn(arg, makeCx(rec))); else fn(arg, {});
  }
  grow() {
    const d = this.dom;
    if (!d || !this.multi) return;
    const lh = parseFloat(getComputedStyle(d).lineHeight) || 20;
    d.style.height = "auto";
    const h = Math.min(Math.max(d.scrollHeight, this.rows[0] * lh), this.rows[1] * lh);
    d.style.height = `${h}px`;
    d.style.overflowY = d.scrollHeight > h + 1 ? "auto" : "hidden";
  }
  bind(dom) {
    if (this.dom !== dom) {
      this.dom = dom;
      dom.value = this.v;
      dom.placeholder = this.placeholder;
      if (!this.multi) dom.type = this.masked ? "password" : "text";
      dom.autocomplete = "off";
      dom.spellcheck = this.multi;
      dom.addEventListener("input", () => { this.v = dom.value; this.grow(); this.emit("change"); });
      dom.addEventListener("focus", () => this.emit("focus"));
      dom.addEventListener("blur", () => this.emit("blur"));
      dom.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.isComposing) return;
        // A newline with Shift (the textarea); Enter submits, as in Herdr's Input and Textarea.
        if (this.multi && e.shiftKey) return;
        // Key handlers around the field go first: they may take Enter (a menu, a hold).
        const ev = keyEvent(e);
        let taken = false;
        dispatch.stopped = false;
        for (let d = dom.parentNode; d && d !== document.body; d = d.parentNode) {
          const fn = d.__el?.on?.keydown;
          if (fn && d.__rec?.alive) { safe(d.__rec, () => fn(ev, makeCx(d.__rec))); if (dispatch.stopped) { taken = true; break; } }
        }
        e.preventDefault();
        e.stopPropagation();
        if (!taken) this.emit("submit", { secondary: e.ctrlKey || e.metaKey, shift: e.shiftKey });
      });
      requestAnimationFrame(() => this.grow());
      if (this.wantFocus) { this.wantFocus = false; requestAnimationFrame(() => dom.focus({ preventScroll: true })); }
    }
  }
}

const field = (tag) => (state) => { const e = new El(tag); e.x.state = state; Object.assign(e.css, tag === "textarea" ? { resize: "none" } : {}); return e; };
export const InputState = { new: (opts) => new TextState(opts, false) };
export const TextareaState = { new: (opts) => new TextState(opts, true) };
export const EditorState = TextareaState;
export const Input = { new: field("input") };
export const Textarea = { new: field("textarea") };
export const Editor = Textarea;
export const NumberInput = Input;

// Rich text: Markdown (HTML is drawn as text).
export const TextView = {
  markdown(id, text) { const e = new El("md"); e.key = String(id); e.x.text = String(text ?? ""); return e; },
  html(id, text) { const e = new El("md"); e.key = String(id); e.x.text = String(text ?? ""); return e; },
};

// A list of rows: all drawn, keyed, in a native scroller.
export function v_virtual_list(id, count, _sizes, getKey, render) {
  const e = new El("list");
  e.key = String(id);
  e.x.count = count;
  e.x.key = getKey;
  e.x.render = render;
  return e;
}
export const h_virtual_list = (id, count, sizes, getKey, render) => { const e = v_virtual_list(id, count, sizes, getKey, render); e.css.flexDirection = "row"; return e; };

class ScrollHandle {
  constructor() { this.dom = null; this.want = null; }
  attach(dom) {
    if (this.dom !== dom) this.dom = dom;
    if (this.want) { const w = this.want; this.want = null; requestAnimationFrame(() => this.go(w)); }
  }
  go(w) {
    const d = this.dom;
    if (!d?.isConnected) { this.want = w; return; }
    if (w.bottom) d.scrollTop = d.scrollHeight;
    else { const item = d.children[w.index]; if (item) item.scrollIntoView({ block: w.strategy === "center" ? "center" : "nearest" }); }
  }
  scroll_to_bottom() { this.want = { bottom: true }; requestAnimationFrame(() => { if (this.want) { const w = this.want; this.want = null; this.go(w); } }); }
  scroll_to_item(index, strategy) { this.want = { index, strategy }; requestAnimationFrame(() => { if (this.want) { const w = this.want; this.want = null; this.go(w); } }); }
  release() { return true; }
}
export const VirtualListScrollHandle = { new: () => new ScrollHandle() };

// The page scrolls natively and draws its own bars.
export const Scrollbar = { vertical: () => new El("none"), horizontal: () => new El("none"), new: () => new El("none") };

// A list anchored under its trigger (the New space folder list): the trigger, then the list.
export const Popup = { new: (_id, trigger) => { const e = new El("div"); e.css.position = "relative"; e.kids.push(trigger); return e; } };

const plain = () => ({ new: () => new El("div") });
export const Button = plain(), Link = plain(), Checkbox = plain(), Switch = plain();
export function set_theme() {}
