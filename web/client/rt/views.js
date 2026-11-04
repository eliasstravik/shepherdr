// Views as GPUI runs them: init once, render when notified, and the `cx` each call gets.
// A copy is one mod placed somewhere (a layout block, an overlay); its root view and the
// entities it makes (cx.new) each draw into their own host element.
import { within } from "./core.js";
import { patch, mount } from "./dom.js";
import * as model from "./model.js";

let rendering = null;
export const owner = () => rendering;

// The event being delivered (stop_propagation marks it).
export const dispatch = { stopped: false };

export class ViewRec {
  constructor(Class, props, copy, parent = null) {
    this.copy = copy;
    this.parent = parent;
    this.props = props;
    this.host = document.createElement("div");
    this.host.className = "view";
    this.host.__rec = this;
    this.el = null;
    this.dom = null;
    this.alive = true;
    this.tasks = new Set();
    this.error = null;
    this.view = within(copy, () => { const v = new Class(props); return v; });
  }
  start() {
    const cx = makeCx(this);
    try { within(this.copy, () => this.view.init?.(this.props, cx)); } catch (e) { this.fail(e, "init"); }
    this.notify();
  }
  notify() { if (this.alive) { dirty.add(this); schedule(); } }
  fail(e, where) { console.error(`[${this.copy.mod}] ${where}: ${e?.stack ?? e}`); this.error = `${where}: ${e?.message ?? e}`; }
  draw() {
    if (!this.alive) return;
    const cx = makeCx(this, "render");
    let tree;
    const was = rendering;
    rendering = this;
    try { tree = within(this.copy, () => this.view.render(cx)); this.error = null; } catch (e) {
      this.fail(e, "render");
      // As Herdr: a render that fails keeps the last frame; only a first one shows the error.
      if (this.dom) return;
      tree = errorBox(this.error);
    } finally { rendering = was; }
    if (typeof tree === "string" || typeof tree === "number") tree = { text: String(tree) };
    if (!this.dom) { this.dom = mount(tree, this); this.host.appendChild(this.dom); }
    else this.dom = patch(this.dom, this.el, tree, this);
    this.el = tree;
  }
  release() {
    this.alive = false;
    for (const t of this.tasks) t.cancel();
    dirty.delete(this);
  }
}

function errorBox(msg) {
  return { text: `This view could not be drawn here: ${msg}`, error: true };
}

const dirty = new Set();
let queued = false;
function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(flush);
}
function flush() {
  queued = false;
  const list = [...dirty];
  dirty.clear();
  for (const rec of list) {
    const t = performance.now();
    rec.draw();
    const ms = performance.now() - t;
    if (ms > 60) console.debug(`[web] ${rec.copy.mod} render ${ms.toFixed(0)} ms`);
  }
}

export class Entity {
  constructor(rec) { this.rec = rec; }
  set_props(p) { this.rec.props = p; try { this.rec.view.update?.(p); } catch (e) { this.rec.fail(e, "update"); } this.rec.notify(); }
  release() { this.rec.release(); return true; }
}

class Task {
  constructor(rec) { this.rec = rec; this.done = false; this.cancelled = false; this.timers = []; rec.tasks.add(this); }
  cancel() { this.cancelled = true; for (const t of this.timers) clearTimeout(t), clearInterval(t); this.rec.tasks.delete(this); }
  is_done() { return this.done || this.cancelled; }
}

let focusN = 0;
export class FocusHandle {
  constructor() { this.id = `f${++focusN}`; this.dom = null; }
  focus() { const d = this.dom; if (d?.isConnected) (d.querySelector("textarea,input") ?? d).focus({ preventScroll: true }); else this.pending = true; }
  is_focused() { return Boolean(this.dom && this.dom.contains(document.activeElement)); }
  release() { return true; }
}

export function makeCx(rec, phase = "event") {
  const cx = {
    notify(target) {
      if (phase === "render") return;
      (target?.rec ?? rec).notify();
    },
    stop_propagation() { dispatch.stopped = true; },
    propagate() { dispatch.stopped = false; },
    phase: () => phase,
    theme() { const t = model.theme(); return { ...t, colors: t }; },
    open_url(url) { if (/^https?:\/\//.test(url)) window.open(url, "_blank", "noopener"); },
    read_from_clipboard: () => undefined,
    write_to_clipboard(text) { navigator.clipboard?.writeText(String(text)).catch(() => {}); },
    focus_handle: () => new FocusHandle(),
    new(Class, props) {
      const child = new ViewRec(Class, props, rec.copy, rec);
      child.start();
      return new Entity(child);
    },
    bind_keys: () => 0,
    spawn(body) {
      const task = new Task(rec);
      const acx = makeCx(rec, "task");
      Promise.resolve().then(() => within(rec.copy, () => body(acx))).catch((e) => { if (!task.cancelled) console.error(`[${rec.copy.mod}] task:`, e); }).finally(() => { task.done = true; rec.tasks.delete(task); });
      return task;
    },
    sleep: (ms = 0) => new Promise((r) => setTimeout(r, ms)),
    timer: {
      after(ms, fn) {
        const task = new Task(rec);
        task.timers.push(setTimeout(() => { task.done = true; if (rec.alive) safe(rec, () => fn(makeCx(rec, "task"))); }, ms));
        return task;
      },
      every(ms, fn) {
        const task = new Task(rec);
        task.timers.push(setInterval(() => { if (rec.alive) safe(rec, () => fn(makeCx(rec, "task"))); else task.cancel(); }, Math.max(ms, 16)));
        return task;
      },
    },
    window: {
      viewport_size: () => ({ width: innerWidth, height: innerHeight }),
      rem_size: () => 16, line_height: () => 20, appearance: () => (model.isDark() ? "dark" : "light"),
      is_window_active: () => document.hasFocus(), refresh: () => rec.notify(),
    },
  };
  return cx;
}

export function safe(rec, fn) {
  try {
    const r = within(rec.copy, fn);
    if (r && typeof r.catch === "function") r.catch((e) => console.error(`[${rec.copy.mod}]`, e));
    return r;
  } catch (e) { console.error(`[${rec.copy.mod}]`, e); }
}
