// The window's Spaces sidebar (mods/spaces-chat) draws with no voice row (GitHub #869, SHEP-158): voiceRow() is null on
// a wide sidebar and with the voice add-on off, and herdr-app's child() throws on null, which blanked the whole sidebar.
// No window runs here, so gpui and herdr are stand-ins: an element's child()/children() refuse what herdr-app refuses.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit } from "./fake-gpui";

const EL = Symbol("element");
const ok = (v: unknown) => typeof v === "string" || typeof v === "number" || (v !== null && typeof v === "object" && (v as any)[EL]);
function el(): any {
  const self: any = new Proxy({ [EL]: true }, {
    get(target, k) {
      if (k === EL) return true;
      if (k === "child") return (v: unknown) => {
        if (!ok(v)) throw new TypeError(`child(value) expects an element, a string, or an entity from cx.new(Class, props); got ${v}`);
        return self;
      };
      if (k === "children") return (vs: unknown[]) => {
        for (const v of vs) if (!ok(v)) throw new TypeError(`children() got ${v}`);
        return self;
      };
      if (k === "when") return (c: unknown, f: (e: any) => any) => (c ? f(self) : self);
      if (k === "then") return undefined;
      return (target as any)[k] ?? (() => self);
    },
  });
  return self;
}

const shared = new Map<string, unknown>();
let sidebarPx = 260;
const space = (id: string, active = false) => ({ id, name: id, active, machine: null, tabs: [], folder: "/tmp/x" });
const theme = new Proxy({}, { get: () => "#000000" });
const herdr = {
  agents: () => [], panes: () => [], terminals: () => [], spaces: () => [space("s1", true), space("s2")],
  appHome: () => "/nonexistent-app", home: () => "/nonexistent-home",
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), hc: async () => ({ code: 1, stdout: "", stderr: "" }),
  run: () => {}, openOverlay: () => {}, closeOverlay: () => {}, notify: () => {}, playSound: () => {},
  shared: (k: string) => shared.get(k), setShared: (k: string, v: unknown) => { shared.set(k, v); },
  machines: () => [], focused: () => null, knownAgents: () => [], settings: () => ({}),
  readTextFile: async () => null, writeTextFile: async () => {}, watchFolder: () => {},
  props: () => ({}), theme: () => theme, window: () => ({ platform: "linux" }), nextCommand: () => null,
  layout: () => ({ id: "root", children: [{ id: "sidebar", size: { px: sidebarPx } }] }),
};
mock.module("herdr", () => fakeHerdr(herdr));
mock.module("gpui-kit", () => fakeGpuiKit({ View: class {}, div: el, svg: el, image: el }));
mock.module("gpui-base", () => fakeGpuiBase({
  v_flex: el, h_flex: el, Input: el, InputState: class {}, VirtualListScrollHandle: class {}, v_virtual_list: el, Scrollbar: el,
}));
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { default: Spaces } = await import("../mods/spaces-chat/main.js");
const cx: any = new Proxy({ timer: { every: () => {}, after: () => {} } }, { get: (t, k) => (t as any)[k] ?? (() => {}) });
const sidebar = () => { const s: any = new Spaces(); s.init({}, cx); return s.render(cx); };

describe("Spaces sidebar without a voice row (GitHub #869)", () => {
  beforeEach(() => { shared.clear(); sidebarPx = 260; });

  test("wide sidebar, voice on: no voice row, still draws", () => {
    expect(sidebar()[EL]).toBe(true);
  });

  test("voice add-on off: no voice row, wide or narrow", () => {
    shared.set("addons.off", ["voice"]);
    expect(sidebar()[EL]).toBe(true);
    sidebarPx = 100;
    expect(sidebar()[EL]).toBe(true);
  });

  test("the narrow rail keeps its voice button", () => {
    sidebarPx = 100;
    const s: any = new Spaces(); s.init({}, cx);
    expect(s.voiceRow(theme, true)?.[EL]).toBe(true);
    expect(s.render(cx)[EL]).toBe(true);
  });
});
