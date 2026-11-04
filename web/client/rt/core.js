// The page's one link to the server: the live state it pushes, the calls mods make, and which
// mod copy is running right now (props(), the copy's own commands).

export const state = {};
const listeners = new Set();
export const onState = (fn) => (listeners.add(fn), () => listeners.delete(fn));

// shared(): the window's shared.json, with this page's own writes on top. A key the page set
// stays the page's (where a list is scrolled, which task is open): the window keeps its own.
export const localShared = new Map();

let ws = null;
let nextId = 1;
const waiting = new Map();
const queue = [];
export const blocked = [];
// The person's own tap that the web can't do yet (the shell says so).
export const refusedFns = new Set();

function connect() {
  const url = new URL("ws", document.baseURI);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(url);
  ws.onopen = () => { for (const m of queue.splice(0)) ws.send(m); setLink(true); };
  ws.onclose = () => { setLink(false); setTimeout(connect, 1500); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === "state") { Object.assign(state, m.state); changed(Object.keys(m.state)); }
    else if (m.t === "set") { state[m.key] = m.value; changed([m.key]); }
    else if (m.t === "reply") {
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      if (m.ok) w.resolve(m.value); else w.reject(new Error(m.error));
    } else if (m.t === "blocked") {
      blocked.push({ at: Date.now(), what: m.what });
      if (blocked.length > 100) blocked.shift();
      console.info("[web] refused:", m.what);
      if (m.mine) for (const f of refusedFns) f(m.what);
    }
  };
}
let linkUp = false;
const linkFns = new Set();
function setLink(up) { linkUp = up; for (const f of linkFns) f(up); }
export const onLink = (fn) => (linkFns.add(fn), fn(linkUp), () => linkFns.delete(fn));

let pending = null;
function changed(keys) {
  pending = pending ? new Set([...pending, ...keys]) : new Set(keys);
  queueMicrotask(() => {
    if (!pending) return;
    const ks = pending;
    pending = null;
    for (const fn of listeners) fn(ks);
  });
}
export const touch = (key) => changed([key]);

// The person's own actions: a call made within a moment of a tap or a key counts as theirs.
// The server still lets through only a short list of them (web/safety.ts).
let lastGesture = 0;
for (const ev of ["pointerup", "keydown"]) addEventListener(ev, () => { lastGesture = Date.now(); }, true);
export const gesture = () => Date.now() - lastGesture < 4000;

export function call(op, ...args) {
  const id = nextId++;
  const msg = JSON.stringify({ t: "call", id, op, args, gesture: gesture() });
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    if (ws?.readyState === 1) ws.send(msg); else queue.push(msg);
  });
}

// The copy whose code runs now (set around init, render, handlers and tasks).
export let current = null;
export function within(copy, fn) {
  const was = current;
  current = copy;
  try { return fn(); } finally { current = was; }
}
export const copies = new Map();

connect();
export const ready = new Promise((resolve) => { const off = onState((ks) => { if (ks.has("docs") || ks.has("terminals")) { off(); resolve(); } }); });
