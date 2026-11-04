// The page around the mods. It places mod copies as the window's layout does (desktop), or one
// or two panels with a bar at the bottom (phone, tablet), and answers the commands mods run that
// are about this screen (which space, tab, panel or overlay it shows). Those never reach the
// window: the page has its own view.
import { state, onState, copies, ready, call, onLink, touch, refusedFns } from "../rt/core.js";
import * as model from "../rt/model.js";
import { hooks } from "../rt/hooks.js";
import { ViewRec } from "../rt/views.js";

const app = document.getElementById("app");
const h = (tag, cls, ...kids) => { const d = document.createElement(tag); if (cls) d.className = cls; for (const k of kids) d.append(k); return d; };
const PHONE = 700, DESK = 1100;
const modeOf = () => (innerWidth < PHONE ? "phone" : innerWidth < DESK ? "tablet" : "desktop");

// ---- mod copies -------------------------------------------------------------------------------
let copyN = 0;
const byPlace = new Map();
function copyFor(place, mod, props = {}) {
  let c = byPlace.get(place);
  const key = JSON.stringify([mod, props]);
  if (c && c.key === key) return c;
  if (c) dropCopy(c);
  const id = `k${++copyN}`;
  c = { id, mod, props, key, place, commands: [], commandWaiters: [], rec: null, host: h("div", "slot") };
  copies.set(id, c);
  byPlace.set(place, c);
  import(`../c/${id}/mods/${mod}/main.js`).then((m) => {
    if (copies.get(id) !== c) return;
    c.rec = new ViewRec(m.default, props, c);
    c.host.appendChild(c.rec.host);
    c.rec.start();
  }).catch((e) => { console.error(`[${mod}] load:`, e); c.host.append(h("div", "term-note", `${mod} could not load: ${e.message}`)); });
  return c;
}
function dropCopy(c) {
  c.rec?.release();
  copies.delete(c.id);
  if (byPlace.get(c.place) === c) byPlace.delete(c.place);
  c.host.remove();
}
function notifyAll() { for (const c of copies.values()) c.rec?.notify(); }

// ---- this screen's layout: the window's tree with the page's own panels on top ----------------
model.view.layoutState ??= { hidden: {}, active: {} };
const ls = model.view.layoutState;
let treeMemo = null;
onState((ks) => { if (ks.has("layout")) treeMemo = null; });
function tree() {
  if (treeMemo) return treeMemo;
  const apply = (n) => {
    const out = { ...n };
    if (n.id in ls.hidden) out.hidden = ls.hidden[n.id];
    if (n.type === "stack" && ls.active[n.id]) out.active = ls.active[n.id];
    if (n.children) out.children = n.children.map(apply);
    return out;
  };
  treeMemo = state.layout ? apply(state.layout) : null;
  return treeMemo;
}
hooks.layout = tree;
const find = (n, id) => { if (!n) return null; if (n.id === id) return n; for (const c of n.children ?? []) { const f = find(c, id); if (f) return f; } return null; };
const activeOf = (stack) => { const n = find(tree(), stack); return n?.active ?? n?.children?.[0]?.id; };

// ---- phone navigation (and the browser's Back) ------------------------------------------------
const nav = { tab: "chat" };
function go(next, push = true) {
  const was = JSON.stringify(nav);
  Object.assign(nav, next);
  if (push && JSON.stringify(nav) !== was) history.pushState({ nav: { ...nav }, thread: activeOf("tasks") }, "");
  draw();
}
history.replaceState({ nav: { ...nav }, thread: "tasks-list" }, "");
addEventListener("popstate", (e) => {
  const s = e.state;
  if (!s) return;
  if (s.thread && activeOf("tasks") !== s.thread) { ls.active.tasks = s.thread; treeMemo = null; model.saveView(); notifyAll(); }
  go(s.nav, false);
});

// ---- commands about this screen ---------------------------------------------------------------
hooks.run = (name, args = {}, from) => {
  console.debug("[web] run", name, JSON.stringify(args), copies.get(from)?.mod);
  const view = model.view;
  const changed = () => { treeMemo = null; model.saveView(); notifyAll(); draw(); };
  switch (name) {
    case "layout.toggle": ls.hidden[args.id] = !(find(tree(), args.id)?.hidden ?? false); return changed();
    case "layout.show": ls.hidden[args.id] = false; if (args.id === "panel" && modeOf() !== "desktop") nav.tab = "tasks"; return changed();
    case "layout.hide": ls.hidden[args.id] = true; if (args.id === "panel" && nav.tab === "tasks") nav.tab = "chat"; return changed();
    case "layout.select": {
      const was = activeOf(args.stack);
      ls.active[args.stack] = args.child;
      if (args.stack === "panel-body" && modeOf() !== "desktop") nav.tab = args.child === "tasks" ? "tasks" : nav.tab;
      treeMemo = null;
      if (args.stack === "tasks" && args.child === "tasks-thread" && was !== "tasks-thread") history.pushState({ nav: { ...nav }, thread: "tasks-thread" }, "");
      return changed();
    }
    case "layout.resize": return;
    case "space.select": {
      const all = model.spaces();
      const s = args.id ? all.find((x) => x.id === args.id) : all[(args.index ?? 1) - 1];
      if (!s) return;
      view.active = s.id;
      touch("view");
      if (modeOf() === "phone" && nav.tab === "spaces") go({ tab: "chat" });
      return changed();
    }
    case "space.next": case "space.prev": {
      const all = model.spaces(); const i = all.findIndex((x) => x.active);
      const s = all[(i + (name === "space.next" ? 1 : all.length - 1)) % all.length];
      if (s) view.active = s.id;
      return changed();
    }
    case "tab.select": {
      const s = model.spaces().find((x) => x.tabs.some((t) => t.id === args.id)) ?? model.spaces().find((x) => x.active);
      const t = args.id ?? s?.tabs[(args.index ?? 1) - 1]?.id;
      if (!s || !t) return;
      view.tabs[s.id] = { ...(view.tabs[s.id] ?? {}), tab: t };
      return changed();
    }
    case "pane.focus": {
      const p = model.panes().find((x) => x.pane === args.pane || (args.terminal && x.terminal === args.terminal));
      if (p) view.tabs[p.tab] = { ...(view.tabs[p.tab] ?? {}), focused: p.pane };
      return changed();
    }
    case "mod.open": hooks.openOverlay({ mod: args.name }, from); return;
    case "overlay.close": hooks.closeOverlay(args.id ?? overlays.at(-1)?.id); return;
  }
  const [ns, cmd] = [name.slice(0, name.indexOf(".")), name.slice(name.indexOf(".") + 1)];
  const targets = [...copies.values()].filter((c) => c.mod === ns);
  if (targets.length && !["space", "tab", "pane", "terminal", "agent", "app", "window", "layout", "mod", "overlay"].includes(ns)) {
    for (const c of targets) { const w = c.commandWaiters.shift(); if (w) w(cmd); else c.commands.push(cmd); }
    return;
  }
  // Everything else changes the window or the machine: the server refuses it and says so.
  call("run", name, args).catch(() => {});
};

// ---- overlays ---------------------------------------------------------------------------------
const overlays = [];
let ovN = 0;
let lastPointer = { x: innerWidth / 2, y: innerHeight / 3 };
addEventListener("pointerdown", (e) => { lastPointer = { x: e.clientX, y: e.clientY }; }, true);
const modJson = new Map();
async function overlaySize(mod) {
  if (!modJson.has(mod)) modJson.set(mod, fetch(`c/x/mods/${mod}/mod.json`).then((r) => r.json()).catch(() => ({})));
  return (await modJson.get(mod)).overlay ?? {};
}
hooks.openOverlay = (spec, _from) => {
  const id = `ov${++ovN}`;
  const kind = spec.kind ?? "popup";
  const scrim = h("div", `scrim${kind === "dialog" ? " dim" : ""}`);
  const box = h("div", `overlay${spec.frame === "none" ? " bare" : ""}`);
  const o = { id, spec, scrim, box, copy: null };
  overlays.push(o);
  if (spec.key) for (const x of overlays.filter((x) => x !== o && x.spec.key === spec.key)) hooks.closeOverlay(x.id);
  if (kind !== "window") {
    scrim.addEventListener("pointerdown", (e) => { if (e.target === scrim && !spec.modal) { e.stopPropagation(); hooks.closeOverlay(id); } });
    document.body.append(scrim);
  }
  document.body.append(box);
  if (spec.mod) {
    o.copy = copyFor(`overlay:${id}`, spec.mod, { ...(spec.props ?? {}), overlay: id });
    box.append(o.copy.host);
  } else box.append(h("div", "term-note", "This overlay is not drawn in the web yet."));
  overlaySize(spec.mod).then((size) => {
    const vw = innerWidth, vh = innerHeight;
    const dim = (v, total, fallback) => { const x = v ?? fallback; return x <= 1 ? x * total : x; };
    const w = Math.min(dim(spec.width ?? size.width, vw, kind === "dialog" ? 480 : 220), vw - 16);
    const hh = Math.min(dim(spec.height ?? size.height, vh, kind === "dialog" ? 400 : 260), vh - 16);
    box.style.width = `${w}px`;
    box.style.height = `${hh}px`;
    let x, y;
    if (kind === "dialog" || (kind === "window" && !spec.at)) { x = (vw - w) / 2; y = Math.max(8, (vh - hh) / 2); }
    else { const at = spec.at && spec.at !== "pointer" ? spec.at : lastPointer; x = at.x; y = at.y; }
    box.style.left = `${Math.max(8, Math.min(x, vw - w - 8))}px`;
    box.style.top = `${Math.max(8, Math.min(y, vh - hh - 8))}px`;
  });
  return id;
};
hooks.closeOverlay = (id) => {
  const i = overlays.findIndex((o) => o.id === id);
  if (i < 0) return;
  const [o] = overlays.splice(i, 1);
  if (o.copy) dropCopy(o.copy);
  o.scrim.remove();
  o.box.remove();
};
addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  const top = overlays.findLast((o) => (o.spec.kind ?? "popup") !== "window");
  if (top) hooks.closeOverlay(top.id);
});

// ---- drawing the layout ------------------------------------------------------------------------
const nodeDoms = new Map();
function layoutNode(n, parentType, last) {
  const d = h("div", `node ${n.type ?? "block"}`);
  nodeDoms.set(n.id, d);
  const sz = n.size;
  if (parentType === "row" && sz?.px) Object.assign(d.style, { width: `${sz.px}px`, flex: "none" });
  else if (parentType === "column" && sz?.px) Object.assign(d.style, { height: `${sz.px}px`, flex: "none" });
  else d.style.flex = `${sz?.weight ?? 1} 1 0`;
  if (n.hidden) d.classList.add("hidden");
  const div = state.layout?.divider;
  if (div && !last && (parentType === "row" || parentType === "column")) d.classList.add(parentType === "row" ? "divider-r" : "divider-b");
  if (n.type === "row" || n.type === "column") {
    const kids = (n.children ?? []).filter((c) => !c.hidden);
    for (const c of n.children ?? []) d.append(layoutNode(c, n.type, c === kids.at(-1)));
  } else if (n.type === "stack") {
    d.classList.add("column");
    const act = n.active ?? n.children?.[0]?.id;
    for (const c of n.children ?? []) { const x = layoutNode(c, "stack", true); if (c.id !== act) x.classList.add("hidden"); d.append(x); }
  } else d.append(block(n));
  return d;
}

function block(n) {
  const c = n.content ?? {};
  if (c.mod) return copyFor(`block:${n.id}`, c.mod, c.props ?? {}).host;
  if (c.tab === "active") return activeTab(c.pane ?? {});
  if (c.terminal) return terminalView(c.terminal);
  return h("div", "slot");
}

// The shown space's shown tab: its panes, each with the layout's pane header.
function activeTab(paneLook) {
  const wrap = h("div", "panes");
  const s = model.spaces().find((x) => x.active);
  const tab = s?.tabs.find((t) => t.active);
  const ps = model.panes().filter((p) => p.tab === tab?.id);
  if (!ps.length) wrap.append(h("div", "term-note", s ? "Nothing open in this tab." : "No spaces yet."));
  for (const p of ps) {
    const pane = h("div", "pane");
    if (paneLook.header?.content?.mod) {
      const head = h("div", "head");
      head.append(copyFor(`head:${p.pane}`, paneLook.header.content.mod, { ...(paneLook.header.content.props ?? {}), pane: p.pane }).host);
      pane.append(head);
    }
    const body = h("div", "body");
    body.append(p.mod ? copyFor(`pane:${p.pane}`, p.mod, p.props ?? {}).host : terminalView(p.terminal));
    pane.append(body);
    wrap.append(pane);
  }
  return wrap;
}

// A terminal: its screen as text, read now and then (typing into it isn't in the PoC).
const termText = new Map();
function terminalView(addr) {
  const d = h("div", "term");
  d.append(h("div", "term-note", `Terminal ${addr ?? ""}: shown read-only in the web.`), h("div", null, termText.get(addr) ?? ""));
  if (addr && !termText.has(addr)) refreshTerm(addr);
  return d;
}
async function refreshTerm(addr) {
  termText.set(addr, "");
  try { const r = await call("hc", ["read", addr]); termText.set(addr, r.stdout.split("\n").slice(-200).join("\n")); draw(); } catch {}
  setTimeout(() => termText.delete(addr), 5000);
}

// ---- the screen ------------------------------------------------------------------------------
const linkNote = h("div", "link", "Reconnecting…");
linkNote.hidden = true;
onLink((up) => { linkNote.hidden = up; });
// A tap whose action only the window can do (for now).
const toast = h("div", "link", "Only in the Herdr window for now");
toast.hidden = true;
let toastT = null;
refusedFns.add(() => { toast.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { toast.hidden = true; }, 2500); });

const ICONS = {
  spaces: "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18",
  chat: "M21 12a9 9 0 0 1-13.4 7.9L3 21l1.1-4.6A9 9 0 1 1 21 12z",
  tasks: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
  back: "M15 18l-6-6 6-6",
};
const mask = (d) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='${d}'/></svg>`)}")`;
const icon = (cls, name) => { const i = h("i", cls); i.style.setProperty("--m", mask(ICONS[name])); return i; };

function bar(mode) {
  const b = h("nav", "bar");
  const tabs = mode === "phone" ? [["spaces", "Spaces"], ["chat", "Chat"], ["tasks", "Tasks"]] : [["chat", "Chat"], ["tasks", "Tasks"]];
  const red = Number(state.shared?.["counts.red"] ?? 0) || 0;
  for (const [id, label] of tabs) {
    const btn = h("button", null, h("span", "ico", icon(null, id)), label);
    if (nav.tab === id) btn.setAttribute("aria-current", "page");
    if (id === "tasks" && red > 0) { const badge = h("span", "badge", String(red)); badge.style.background = "#e5484d"; btn.append(badge); }
    btn.addEventListener("click", () => {
      if (id === "tasks") { ls.hidden.panel = false; ls.active["panel-body"] = "tasks"; treeMemo = null; model.saveView(); notifyAll(); }
      go({ tab: id });
    });
    b.append(btn);
  }
  return b;
}

function top(mode) {
  if (mode !== "phone") return null;
  const t = h("header", "top");
  const thread = nav.tab === "tasks" && activeOf("tasks") === "tasks-thread";
  if (nav.tab !== "spaces" || thread) {
    const back = h("button", null, icon("ico", "back"));
    back.setAttribute("aria-label", "Back");
    back.addEventListener("click", () => {
      if (thread) { hooks.run("layout.select", { stack: "tasks", child: "tasks-list" }); return; }
      go({ tab: "spaces" });
    });
    t.append(back);
  }
  const s = model.spaces().find((x) => x.active);
  t.append(h("div", "title", nav.tab === "spaces" ? "Spaces" : nav.tab === "tasks" ? (thread ? "Task" : "Tasks") : s?.name ?? "Chat"));
  return t;
}

let lastMode = null;
let drawQueued = false;
function draw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; drawNow(); });
}
let lastSig = "";
function drawNow(force = false) {
  const t = tree();
  if (!t) return;
  const mode = modeOf();
  // Only when what is placed changes: a redraw moves the copies (and the typing focus).
  const s = model.spaces().find((x) => x.active);
  const tab = s?.tabs.find((x) => x.active);
  const sig = JSON.stringify([mode, nav, ls, s?.id, tab?.id, model.panes().filter((p) => p.tab === tab?.id).map((p) => [p.pane, p.mod, p.terminal]), mode !== "desktop" && state.shared?.["counts.red"], [...termText.values()].map((x) => x.length)]);
  if (!force && sig === lastSig) return;
  lastSig = sig;
  if (mode !== "desktop" && nav.tab === "spaces" && mode === "tablet") nav.tab = "chat";
  lastMode = mode;
  // Keep the copies' hosts: re-placing moves them, never rebuilds them.
  nodeDoms.clear();
  const focusEl = document.activeElement;
  const scroll = [...app.querySelectorAll("*")].filter((e) => e.scrollTop > 0).map((e) => [e, e.scrollTop]);
  const parts = [];
  if (mode === "desktop") parts.push(layoutNode(t, null, true));
  else {
    const m = h("div", "mobile");
    const side = find(t, "sidebar"), panel = find(t, "panel"), main = find(t, "main");
    const sideCol = h("div", "col side", side ? layoutNode({ ...side, size: null, hidden: false }, null, true) : "");
    const work = h("div", "col work");
    if (nav.tab === "tasks" && panel) work.append(layoutNode({ ...panel, size: null, hidden: false }, null, true));
    else if (main) work.append(layoutNode({ ...main, size: null }, null, true));
    if (mode === "phone") { sideCol.classList.toggle("hide", nav.tab !== "spaces"); work.classList.toggle("hide", nav.tab === "spaces"); sideCol.classList.remove("side"); }
    m.append(sideCol, work);
    const tp = top(mode);
    if (tp) parts.push(tp);
    parts.push(m, bar(mode));
  }
  app.replaceChildren(...parts, linkNote, toast);
  for (const [e, y] of scroll) if (e.isConnected) e.scrollTop = y;
  if (focusEl?.isConnected && document.activeElement !== focusEl) focusEl.focus({ preventScroll: true });
}

// Theme colors as the page's own.
function themeVars() {
  const th = model.theme();
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(th)) root.setProperty(`--${k}`, v);
  document.body.style.background = th[state.layout?.background ?? "canvas"] ?? th.canvas;
  document.querySelector('meta[name="theme-color"]').content = th.chrome ?? "#101114";
}

// ---- start --------------------------------------------------------------------------------------
await ready;
themeVars();
drawNow();
onState((ks) => {
  if (ks.has("settings") || ks.has("themes")) themeVars();
  if (ks.has("layout")) treeMemo = null;
  notifyAll();
  if (ks.has("docs") || ks.has("layout") || ks.has("view") || (ks.has("shared") && modeOf() !== "desktop")) draw();
});
let resizeT = null;
addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (modeOf() !== lastMode) draw(); }, 100); });
window.__web = { copies, model, state, overlays };
