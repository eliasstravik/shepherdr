// The New space dialog's folder list scrolls past its 8th folder (GitHub #842). overflow_y_scrollbar() wraps the list in
// gpui-shell's scroll box, which takes the list's width and height but not its max_h: with only a max_h the box was
// the capped list, had nothing to scroll and cut the rest off. The list now has a definite height.
import { beforeEach, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { built, byId, fakeGpuiBase, fakeGpuiKit, type Call } from "./fake-gpui";

const none = async () => ({ code: 1, stdout: "", stderr: "" });
// The props and the shared icon pick each test sets (the window's answer to a pick, or none).
let overlayProp: string | undefined = "o1";
let pick: unknown = undefined;
mock.module("herdr", () => fakeHerdr({
  props: () => ({ overlay: overlayProp }), theme: () => new Proxy({}, { get: () => "#000000" }), home: () => "/nonexistent-home", exec: none, hc: none,
  shared: (k: string) => (k === "spaces-chat.iconpick" ? pick : undefined), setShared: () => {}, machines: () => [], focused: () => null, spaces: () => [], agents: () => [], panes: () => [], terminals: () => [],
}));
mock.module("gpui-kit", () => fakeGpuiKit());
mock.module("gpui-base", () => fakeGpuiBase());

const { default: NewSpace } = await import("../mods/newspace/main.js");
const { NEWSPACE: K } = await import("../mods/newspace/coordinator.js");
const cx: any = new Proxy({ timer: { after: () => {}, every: () => {} } }, { get: (t, k) => (t as any)[k] ?? (() => {}) });

beforeEach(() => { built.length = 0; overlayProp = "o1"; pick = undefined; });

// The dialog browsing a folder of `n` subfolders on another machine.
const browsing = (n: number) => {
  const d: any = Object.create(NewSpace.prototype);
  Object.assign(d, {
    machine: "vmb", machineOpen: false, listOpen: true, hi: -1, picked: 0, text: "~/code", icon: null, extra: [], recent: [],
    exists: new Map(), repo: new Map(), makeRepo: true, busy: false, error: "", input: {},
    browse: { dir: "/nonexistent-home/code", rows: Array.from({ length: n }, (_, i) => ({ path: `/nonexistent-home/code/p${i}` })) },
  });
  d.draw(cx);
  return byId("folder-rows");
};
const sizes = (e: any) => Object.fromEntries(e.calls.filter(([n]: Call) => ["h", "max_h", "overflow_y_scrollbar"].includes(n)).map(([n, a]: Call) => [n, a[0] ?? true]));

test("12 folders: all 12 in a list 8 rows tall that scrolls", () => {
  const list = browsing(12);
  expect(list.kids.length).toBe(12);
  expect(sizes(list)).toEqual({ h: K.row * 8 + 8, overflow_y_scrollbar: true });
});

test("3 folders: as tall as its rows", () => {
  expect(sizes(browsing(3))).toEqual({ h: K.row * 3 + 8, overflow_y_scrollbar: true });
});

// The icon pick reply (spaces-chat rename's picker, GitHub #917 / SHEP-197): read only when it answers this dialog.
// With no overlay prop and no reply, `rq.for` and the prop were both undefined, so `rq.at` threw in draw().
const dialog = (picked = 0) => {
  const d: any = Object.create(NewSpace.prototype);
  Object.assign(d, {
    machine: "vmb", machineOpen: false, listOpen: false, hi: -1, picked, text: "~/code", icon: null, extra: [], recent: [],
    exists: new Map(), repo: new Map(), makeRepo: true, busy: false, error: "", input: {}, browse: null, focused: false,
  });
  return d;
};

test("no overlay prop and no pick reply: draws without reading a pick", () => {
  overlayProp = undefined;
  const d = dialog();
  expect(() => d.draw(cx)).not.toThrow();
  expect(d.icon).toBe(null);
});

test("a reply with no overlay prop to match does not set the icon", () => {
  overlayProp = undefined;
  pick = { at: 7, emoji: "🚀" };
  const d = dialog();
  expect(() => d.draw(cx)).not.toThrow();
  expect(d.icon).toBe(null);
  expect(d.picked).toBe(0);
});

test("a reply for this dialog's overlay sets the icon once", () => {
  pick = { for: "o1", at: 7, emoji: "🚀" };
  const d = dialog();
  d.draw(cx);
  expect(d.icon).toBe("🚀");
  expect(d.picked).toBe(7);
  d.icon = null;
  d.draw(cx);
  expect(d.icon).toBe(null);
});

test("a reply for another overlay is ignored", () => {
  pick = { for: "o2", at: 7, emoji: "🚀" };
  const d = dialog();
  d.draw(cx);
  expect(d.icon).toBe(null);
  expect(d.picked).toBe(0);
});
