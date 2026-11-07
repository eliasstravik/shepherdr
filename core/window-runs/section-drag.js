// The window's sidebar drags a section by its header. Herdr's window can't run here, so this loads the
// real mod (mods/spaces-chat/main.js) with "herdr" and GPUI's builders stood in for: an element records its children
// and handlers, and the test presses, moves and lets go through those handlers as GPUI would call them. Run by
// core/section-drag.test.js in a bun of its own: a module mock here would clash with the other window tests' in one run.
import { expect, test, mock, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";

const store = {};
const noop = () => undefined;
const el = () => {
  const me = { kids: [], on: {}, id: null, calls: [] };
  const p = new Proxy(me, {
    get(_t, k) {
      if (k === "me") return me;
      if (k === "then") return undefined;
      return (...a) => {
        if (k === "when") { if (a[0]) a[1](p); return p; }
        if (k === "child") { me.kids.push(a[0]); return p; }
        if (k === "children") { me.kids.push(...a[0]); return p; }
        if (k === "id") { me.id = a[0]; return p; }
        if (String(k).startsWith("on_")) { me.on[typeof a[0] === "string" ? `${String(k)}:${a[0]}` : String(k)] = a.at(-1); return p; }
        me.calls.push([k, ...a]);
        return p;
      };
    },
  });
  return p;
};
// every name the mod's files import (a module mock needs each by name)
const NAMES = "agents appHome closeOverlay exec focused hc home knownAgents layout machines nextCommand notify openOverlay panes playSound props readTextFile run setShared settings shared spaces terminals theme watchFolder window writeTextFile".split(" ");
const herdr = {
  ...Object.fromEntries(NAMES.map((n) => [n, noop])),
  shared: (k) => store[k], setShared: (k, v) => { store[k] = v; }, machines: () => [], spaces: () => ["s0", "s1", "s2"].map((id) => ({ id, machine: null, name: id, tabs: [] })), panes: () => [],
  agents: () => [], terminals: () => [], knownAgents: () => [], props: () => null, layout: () => null, focused: () => null,
  theme: () => new Proxy({}, { get: () => "#000" }), settings: () => ({}), home: () => "/h", appHome: () => "/a",
};
mock.module("herdr", () => herdr);
mock.module("gpui-kit", () => ({ View: class {}, div: el, svg: el }));
mock.module("gpui-base", () => ({ v_flex: el, h_flex: el, Input: class {}, InputState: class {}, Scrollbar: class {}, VirtualListScrollHandle: class {}, v_virtual_list: el }));

let Spaces;
beforeAll(async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: noop };
  ({ default: Spaces } = await import("../../mods/spaces-chat/main.js"));
});

const T = new Proxy({}, { get: () => "#000" });
const cx = { notify: noop, stop_propagation: noop };
function sidebar() {
  const v = Object.create(Spaces.prototype);
  Object.assign(v, { pressed: null, over: null, peek: null, lifted: null, target: null, liftMoved: false, unread: new Set(), pilots: new Map(), dup: null });
  return v;
}
const row = (id, machine = null) => ({ w: { id, machine, tabs: [], active: false }, name: id });
const all = (e, out = []) => { if (e?.me) { out.push(e.me); for (const k of e.me.kids) all(k, out); } return out; };
const byId = (rows, id) => rows.map((r) => r.me).find((x) => x.id === id);
const lines = (x) => all({ me: x }).filter((k) => k.calls.some(([c]) => c === "h") && k.calls.some(([c, a]) => c === "h" && a === 2));
const draw = (v) => v.sectioned(null, [row("s0"), row("s1"), row("s2")], T);
const order = () => store["spaces-chat"].sections.map((s) => s.id);
const reset = () => {
  store["spaces-chat"] = { pinned: [], icons: {}, machines: {}, sections: [
    { id: "a", machine: null, name: "A", folded: false, spaces: ["s1"] }, { id: "v", machine: "vm", name: "V", folded: false, spaces: [] },
    { id: "b", machine: null, name: "B", folded: false, spaces: [] }, { id: "c", machine: null, name: "C", folded: true, spaces: ["s2"] },
  ] };
};

test("the window's sidebar is no virtual list, so its section headers may carry handlers (gpui-kit.d.ts)", () => {
  expect(readFileSync(new URL("../../mods/spaces-chat/main.js", import.meta.url), "utf8")).not.toContain("v_virtual_list");
});

test("a section dragged down by its header: the line under the target's last row, then it takes that place", () => {
  reset();
  const v = sidebar();
  byId(draw(v), "section-a").on["on_mouse_down:left"]({}, cx);
  // over C's header (folded, nothing under it): the line under C's header
  byId(draw(v), "section-c").on.on_mouse_move({}, cx);
  expect(v.target).toBe("c");
  const rows = draw(v);
  expect(lines(byId(rows, "section-c")).length).toBe(1);
  expect(byId(rows, "section-a").calls).toContainEqual(["opacity", 0.5]);
  // the click GPUI sends when the press ends on the header folds nothing after a drag
  byId(rows, "section-a").on.on_click({}, cx);
  expect(store["spaces-chat"].sections.find((s) => s.id === "a").folded).toBe(false);
  v.release(cx);
  expect(order()).toEqual(["b", "v", "c", "a"]);   // vm's section stays where it was
  expect(v.lifted).toBeNull();
});

test("dragged up over a section with spaces, or a space in it: the line over that header; let go, before it", () => {
  reset();
  const v = sidebar();
  byId(draw(v), "section-b").on["on_mouse_down:left"]({}, cx);
  byId(draw(v), "space-s1").on.on_mouse_move({}, cx);   // A's space
  expect(v.target).toBe("a");
  expect(lines(byId(draw(v), "section-a")).length).toBe(1);
  v.release(cx);
  expect(order()).toEqual(["b", "v", "a", "c"]);
});

test("over the machine's spaces in no section or its header: first; over another machine's: nowhere", () => {
  reset();
  const v = sidebar();
  byId(draw(v), "section-c").on["on_mouse_down:left"]({}, cx);
  byId(draw(v), "space-s0").on.on_mouse_move({}, cx);
  expect(v.target).toBe("a");
  v.liftOver("v", "vm", cx);
  expect(v.target).toBeNull();
  v.release(cx);
  expect(order()).toEqual(["a", "v", "b", "c"]);
  v.liftOver(null, null, cx);   // nothing lifted: nothing happens
  expect(v.target).toBeNull();
});

test("a click without a drag still folds; a right-click still opens its menu; spaces still drag into sections", () => {
  reset();
  const v = sidebar();
  const a = byId(draw(v), "section-a");
  expect(Object.keys(a.on)).toEqual(expect.arrayContaining(["on_click", "on_mouse_down:left", "on_mouse_down:right", "on_mouse_move"]));
  a.on["on_mouse_down:left"]({}, cx);
  a.on.on_mouse_move({}, cx);
  a.on.on_click({}, cx);
  v.release(cx);
  expect(store["spaces-chat"].sections.find((s) => s.id === "a").folded).toBe(true);
  expect(order()).toEqual(["a", "v", "b", "c"]);
  // a space pressed and let go over B's header goes into B, as before
  byId(draw(v), "space-s0").on["on_mouse_down:left"]({}, cx);
  byId(draw(v), "section-b").on.on_mouse_move({}, cx);
  expect(v.over).toBe("section:b");
  expect(v.target).toBeNull();
  v.release(cx);
  expect(store["spaces-chat"].sections.find((s) => s.id === "b").spaces).toEqual(["s0"]);
  expect(order()).toEqual(["a", "v", "b", "c"]);
});
