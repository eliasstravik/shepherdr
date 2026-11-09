// The window's chat (mods/chat) with Herdr zoomed in (GitHub #759): the window reports sizes and presses in pixels at
// the zoom while the chat lays its rows out at zoom 1. A row's measured height went to the list as it came (blank space
// under every row, ~0.9x it at zoom 1.9), and a press was compared with places worked out at zoom 1 (Show more, a
// card's Submit, Accept: missed). No window runs here, so gpui and herdr are stand-ins that keep the handlers given.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit } from "./fake-gpui";

let zoom = 1;
const handlers: Record<string, ((...a: any[]) => void)[]> = {};
function el(): any {
  const self: any = new Proxy({}, {
    get(_t, k) {
      if (k === "then") return undefined;
      if (k === "when") return (c: unknown, f: (e: any) => any) => (c ? f(self) : self);
      if (k === "on_size_change") return (f: any) => { (handlers.size ??= []).push(f); return self; };
      if (k === "on_mouse_down") return (_b: string, f: any) => { (handlers.down ??= []).push(f); return self; };
      return () => self;
    },
  });
  return self;
}
const theme = new Proxy({}, { get: () => "#000000" });
mock.module("herdr", () => fakeHerdr({
  settings: () => ({ zoom }), theme: () => theme, shared: () => undefined, setShared: () => {}, agents: () => [], panes: () => [],
  terminals: () => [], spaces: () => [], machines: () => [], knownAgents: () => [], props: () => ({}), window: () => ({ platform: "linux" }),
  home: () => "/nonexistent-home", appHome: () => "/nonexistent-app",
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), hc: async () => ({ code: 1, stdout: "", stderr: "" }),
  readTextFile: async () => null, writeTextFile: async () => {}, watchFolder: () => {},
}));
mock.module("gpui-kit", () => fakeGpuiKit({ View: class {}, div: el, svg: el, image: el }));
mock.module("gpui-base", () => fakeGpuiBase({ v_flex: el, h_flex: el, v_virtual_list: el, Scrollbar: el, TextView: { markdown: el } }));
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { default: Chat } = await import("../mods/chat/main.js");
const chat = () => {
  const c: any = Object.create(Chat.prototype);
  Object.assign(c, { heights: new Map(), measuredAt: new Map(), measureGen: 0, width: 600, range: null, pinned: false, cardW: new Map() });
  c.row = () => el();
  return c;
};
const cx: any = { notify: () => {} };

describe("the window's chat at Herdr's zoom (GitHub #759)", () => {
  beforeEach(() => { for (const k of Object.keys(handlers)) delete handlers[k]; });

  for (const z of [1, 1.7]) {
    test(`a row 100 px tall gets 100 px in the list at zoom ${z}`, () => {
      zoom = z;
      const c = chat();
      c.measurer([{ id: "a", kind: "text" }], ["a"], theme);
      handlers.size[0]({ width: 600 * z, height: 100 * z }, cx);
      expect(c.heights.get("a")).toBeCloseTo(100);
    });

    test(`Show more takes a press on its words at zoom ${z}`, () => {
      zoom = z;
      const c = chat();
      let folded = 0;
      c.toggleFold = () => { folded++; };
      // The pane, 1130 px wide at zoom 1, as the window reports it; the press on Show more's words (the column's
      // left edge, the bubble's padding in, 30 px into the words), where it's drawn.
      c.paneSize({ width: 1130 * z, height: 800 * z });
      const pane = 1130, outer = Math.min(pane, 760 + 36), left = (pane - outer) / 2 + 18;
      c.notePress({ local_position: { x: (left + 12 + 30) * z, y: 300 * z } });
      const rows = [{ id: "f", kind: "fold" }];
      c.clickRow("f", rows, cx, [40]);
      expect(folded).toBe(1);
    });
  }

  // #775: a long reply measured with words laid out at an older width overlapped the next row.
  test("the measurer's rows are new ones after a width change", () => {
    zoom = 1;
    const c = chat();
    const seen: string[] = [];
    c.row = (_x: any, _t: any, pre: string) => { seen.push(pre); return el(); };
    c.measurer([{ id: "a", kind: "text" }], ["a"], theme);
    c.measureGen++;
    c.heights.clear();
    c.measurer([{ id: "a", kind: "text" }], ["a"], theme);
    expect(seen[0]).not.toBe(seen[1]);
  });
});
