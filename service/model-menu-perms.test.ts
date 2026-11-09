// The model menu's Permissions sub-menu (mods/chat-models; Settings › Agents and the chat's model button) takes its own
// clicks (GitHub #767, #740). It sits over the Fast row; the menu's press anywhere closed it, so a press on an option
// closed it before the click, and the click landed on Fast under it: Fast flipped, Permissions stayed.
import { beforeEach, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { built, byId, dispatch, fakeGpuiBase, fakeGpuiKit, handler } from "./fake-gpui";

let p: any;
const none = async () => ({ code: 1, stdout: "", stderr: "" });
mock.module("herdr", () => fakeHerdr({
  props: () => p, theme: () => new Proxy({}, { get: () => "#000000" }), home: () => "/nonexistent-home", exec: none, hc: none,
  readTextFile: async () => null, writeTextFile: async () => {}, setShared: () => {}, closeOverlay: () => {},
}));
mock.module("gpui-kit", () => fakeGpuiKit());
mock.module("gpui-base", () => fakeGpuiBase());

const { default: ModelMenu } = await import("../mods/chat-models/main.js");
const cx: any = new Proxy({ timer: { after: () => {}, every: () => {} } }, { get: (t, k) => (t as any)[k] ?? (() => ({ focus: () => {} })) });
const menus = {
  claude: {
    name: "Claude", models: [{ id: "opus", name: "Opus", efforts: ["high"], fast: true }],
    perms: [{ id: "default", label: "Ask" }, { id: "bypassPermissions", label: "Full access" }],
  },
};

beforeEach(() => {
  built.length = 0;
  p = { mode: "settings", key: "k", current: { agent: "claude", model: "opus", perm: "default", fast: false }, menus, permDefault: { claude: "default" } };
});

const opened = () => {
  const m: any = new ModelMenu();
  m.init({}, cx);
  m.render(cx);
  handler(byId("perms"), "on_click")!({}, cx);
  built.length = 0;
  m.render(cx);
  expect(m.permOpen).toBe(true);
  return m;
};

test("a press on a permission option keeps the sub-menu, and its click sets it, not Fast", () => {
  const m = opened();
  dispatch(byId("perm-bypassPermissions"), "on_mouse_down", cx);
  expect(m.permOpen).toBe(true);
  dispatch(byId("perm-bypassPermissions"), "on_click", cx);
  expect(m.sel.perm).toBe("bypassPermissions");
  expect(m.sel.fast).toBe(false);
  expect(m.permOpen).toBe(false);
});

test("a press elsewhere in the menu still closes the sub-menu", () => {
  const m = opened();
  dispatch(byId("model-menu"), "on_mouse_down", cx);
  expect(m.permOpen).toBe(false);
});

test("a press on Permissions while it's open closes it (the click doesn't open it again)", () => {
  const m = opened();
  dispatch(byId("perms"), "on_mouse_down", cx);
  dispatch(byId("perms"), "on_click", cx);
  expect(m.permOpen).toBe(false);
});
