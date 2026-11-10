// The emoji pickers (a space's icon in Rename, a message's reaction) pick the emoji pressed at any zoom (GitHub #751).
// Rows take no handlers, so the picker finds the column from the press's place, which the window reports in pixels at
// Herdr's zoom while the cells are laid out at zoom 1: at zoom 1.7 a press picked two cells right, or nothing past the
// middle. No window runs here: gpui and herdr are stand-ins.
import { describe, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit } from "./fake-gpui";

let zoom = 1;
function el(): any {
  const self: any = new Proxy({}, {
    get(_t, k) {
      if (k === "then") return undefined;
      if (k === "when") return (c: unknown, f: (e: any) => any) => (c ? f(self) : self);
      return () => self;
    },
  });
  return self;
}
// Every list a mod reads is empty, not missing: another test file in the same run may draw with these same modules.
mock.module("herdr", () => fakeHerdr({
  settings: () => ({ zoom }), theme: () => new Proxy({}, { get: () => "#000000" }), props: () => ({}), shared: () => undefined, setShared: () => {},
  agents: () => [], panes: () => [], terminals: () => [], spaces: () => [], machines: () => [], knownAgents: () => [], focused: () => null,
  home: () => "/nonexistent-home", appHome: () => "/nonexistent-app", window: () => ({ platform: "linux" }),
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), hc: async () => ({ code: 1, stdout: "", stderr: "" }),
  readTextFile: async () => null, writeTextFile: async () => {}, watchFolder: () => {},
  layout: () => ({ id: "root", children: [{ id: "sidebar", size: { px: 260 } }] }),
}));
mock.module("gpui-kit", () => fakeGpuiKit({ View: class {}, div: el, svg: el, image: el }));
mock.module("gpui-base", () => fakeGpuiBase({ v_flex: el, h_flex: el, v_virtual_list: el, Scrollbar: el, Input: el }));

const pickers = {
  "Rename's icon picker": (await import("../mods/spaces-chat/icon.js")).columnAt,
  "the reaction picker": (await import("../mods/chat-react/main.js")).columnAt,
};
// Where column c's middle is drawn in the list's area (its 6 px padding, 36 px cells), as the window reports it.
const PAD = 6, CELL = 36;
const pressOn = (c: number, z: number) => (PAD + c * CELL + CELL / 2) * z;

describe("emoji pickers pick the emoji pressed (GitHub #751)", () => {
  for (const [name, columnAt] of Object.entries(pickers)) {
    for (const z of [1, 1.3, 1.7, 1.9]) {
      test(`${name}, every column at zoom ${z}`, () => {
        zoom = z;
        expect([...Array(9).keys()].map((c) => columnAt(pressOn(c, z)))).toEqual([...Array(9).keys()]);
      });
    }
    test(`${name}: a press beside the cells picks nothing`, () => {
      zoom = 1;
      expect(columnAt(2)).toBe(-1);
      expect(columnAt(PAD + 9 * CELL + 4)).toBe(-1);
      expect(columnAt(null)).toBe(-1);
    });
  }
});
