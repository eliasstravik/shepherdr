// Stand-ins for herdr-app's "gpui-kit" and "gpui-base" modules in bun tests of window mods. As with fake-herdr.ts,
// bun's mock.module is one per process: the first test file to mock a module fixes its export names, so every test
// goes through here and each stand-in has every name the mods import.
// element() is a stand-in element: every builder call returns it and is kept in `calls` (name and arguments), so a
// test can ask what was built; child()/children() refuse what herdr-app refuses (null and the like).

export const EL = Symbol("element");
const ok = (v: unknown) => typeof v === "string" || typeof v === "number" || (v !== null && typeof v === "object" && (v as any)[EL]);

export type Call = [string, unknown[]];
export type Element = any;

// Every element built since the last reset, in order.
export const built: Element[] = [];

export function element(kind = "div"): Element {
  const calls: Call[] = [];
  const kids: Element[] = [];
  const self: Element = new Proxy({ [EL]: true }, {
    get(target, k) {
      if (k === EL) return true;
      if (k === "kind") return kind;
      if (k === "calls") return calls;
      if (k === "kids") return kids;
      if (k === "then") return undefined;
      if (typeof k === "symbol") return (target as any)[k];
      if (k === "child") return (v: unknown) => {
        if (!ok(v)) throw new TypeError(`child(value) expects an element, a string, or an entity from cx.new(Class, props); got ${v}`);
        calls.push(["child", [v]]); kids.push(v);
        return self;
      };
      if (k === "children") return (vs: unknown[]) => {
        for (const v of vs) if (!ok(v)) throw new TypeError(`children() got ${v}`);
        calls.push(["children", [vs]]); kids.push(...vs);
        return self;
      };
      if (k === "when") return (c: unknown, f: (e: Element) => Element) => (c ? f(self) : self);
      return (...args: unknown[]) => { calls.push([k, args]); return self; };
    },
  });
  built.push(self);
  return self;
}

// The element whose id() is `id`, among those built.
export const byId = (id: string): Element | undefined => built.find((e) => e.calls.some(([n, a]: Call) => n === "id" && a[0] === id));

// The handler an element was given for `name` (on_click, on_mouse_down …): its last argument.
export const handler = (e: Element, name: string): ((...a: any[]) => any) | undefined =>
  e.calls.filter(([n]: Call) => n === name).map(([, a]: Call) => a[a.length - 1]).pop();

// A state or handle (InputState, VirtualListScrollHandle …): any method does nothing.
const inert = (): any => new Proxy({}, { get: (_t, k) => (k === "then" ? undefined : () => undefined) });
class Stub { constructor(..._a: unknown[]) {} static new(..._a: unknown[]) { return inert(); } }

// A mouse event at `target` as gpui sends it: its handlers for `name` from it up through its parents, until one calls
// cx.stop_propagation(). Returns the elements whose handler ran.
export function dispatch(target: Element, name: string, cx: any = {}): Element[] {
  let stopped = false;
  const ran: Element[] = [];
  const ecx = new Proxy(cx, { get: (t, k) => (k === "stop_propagation" ? () => { stopped = true; } : t[k] ?? (() => undefined)) });
  for (let e: Element | undefined = target; e && !stopped; e = built.find((p) => p.kids.includes(e))) {
    const f = handler(e, name);
    if (f) { ran.push(e); f({ position: { x: 0, y: 0 } }, ecx); }
  }
  return ran;
}
const factory = (kind: string) => Object.assign((..._a: unknown[]) => element(kind), { new: (..._a: unknown[]) => element(kind), vertical: (..._a: unknown[]) => element(kind) });

export function fakeGpuiKit(given: Record<string, unknown> = {}): Record<string, unknown> {
  return { View: Stub, div: factory("div"), svg: factory("svg"), image: factory("image"), ...given };
}

export function fakeGpuiBase(given: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Editor: factory("Editor"), EditorState: Stub, Input: factory("Input"), InputState: Stub, Popup: factory("Popup"),
    Scrollbar: factory("Scrollbar"), TextView: factory("TextView"), Textarea: factory("Textarea"), TextareaState: Stub,
    VirtualListScrollHandle: Stub, h_flex: factory("h_flex"), v_flex: factory("v_flex"), v_virtual_list: factory("v_virtual_list"),
    ...given,
  };
}
