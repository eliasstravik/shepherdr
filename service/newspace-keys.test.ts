// The New space dialog keeps the keyboard while it is open (GitHub #752): Herdr still counts the pane under a dialog as
// focused, and the Assistant chat there gave its box the keyboard back whenever it redrew (a message, its agent
// restarting), so typing in the dialog's field went to the chat. The dialog now holds the keyboard (keyholder.js), the
// chat takes nothing back while it does, and closing gives it back. No window runs here: gpui and herdr are stand-ins.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit } from "./fake-gpui";

const shared = new Map<string, any>();
const timers: ((cx: any) => void)[] = [];
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
const theme = new Proxy({}, { get: () => "#000000" });
class InputState {
  static new() { return new InputState(); }
  on() {}
  focus() {}
  value() { return "~/demo"; }
}
mock.module("herdr", () => fakeHerdr({
  shared: (k: string) => shared.get(k), setShared: (k: string, v: unknown) => { shared.set(k, v); },
  props: () => ({ overlay: "o1", recent: [], home: "/nonexistent-home" }), theme: () => theme, home: () => "/nonexistent-home",
  exec: async () => ({ code: 1, stdout: "", stderr: "" }), hc: async () => ({ code: 1, stdout: "", stderr: "" }),
  closeOverlay: () => {}, openOverlay: () => {}, machines: () => [], spaces: () => [], agents: () => [], panes: () => [],
  terminals: () => [], focused: () => null, settings: () => ({}), readTextFile: async () => null, writeTextFile: async () => {},
  watchFolder: () => {}, knownAgents: () => [], window: () => ({ platform: "linux" }), appHome: () => "/nonexistent-app",
}));
mock.module("gpui-kit", () => fakeGpuiKit({ View: class {}, div: el, svg: el, image: el }));
mock.module("gpui-base", () => fakeGpuiBase({ v_flex: el, h_flex: el, Input: el, Popup: el, InputState }));
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { default: NewSpace } = await import("../mods/newspace/main.js");
const K = await import("../mods/chat/keyholder.js");
const cx: any = new Proxy({ timer: { every: (_ms: number, f: any) => timers.push(f), after: () => {} }, notify: () => {} },
  { get: (t, k) => (t as any)[k] ?? (() => {}) });

describe("New space keeps the keyboard (GitHub #752)", () => {
  beforeEach(() => { shared.clear(); timers.length = 0; });

  test("open, the dialog holds the keyboard: the chat behind it takes nothing back", () => {
    shared.set(K.KEY_HOLDER, { who: "p3", at: Date.now() }); // the Assistant chat's box had it
    const d: any = new NewSpace();
    d.init({}, cx);
    const h = shared.get(K.KEY_HOLDER);
    expect(h.who).toBe("dialog:newspace");
    expect(K.dialogHolds(h)).toBe(true);
    expect(K.keysElsewhere(K.liveHolder(h), "p3")).toBe(true);
  });

  test("open for a long time, it keeps holding it", () => {
    const d: any = new NewSpace();
    d.init({}, cx);
    const old = Date.now() - K.DIALOG_FRESH + 500; // about to go stale
    shared.set(K.KEY_HOLDER, { who: "dialog:newspace", at: old });
    for (const f of timers) f(cx); // its every-2 s renewal
    expect(shared.get(K.KEY_HOLDER).at).toBeGreaterThan(old);
    expect(K.dialogHolds(shared.get(K.KEY_HOLDER), Date.now() + 2000)).toBe(true);
  });

  test("closed, the chat gets the keyboard back", () => {
    const d: any = new NewSpace();
    d.init({}, cx);
    d.close();
    expect(K.keysElsewhere(K.liveHolder(shared.get(K.KEY_HOLDER)), "p3")).toBe(false);
    for (const f of timers) f(cx);
    expect(shared.get(K.KEY_HOLDER)?.who ?? null).toBe(null);
  });

  test("a dialog gone without closing stops holding it soon", () => {
    const h = { who: "dialog:newspace", at: Date.now() - K.DIALOG_FRESH - 1 };
    expect(K.dialogHolds(h)).toBe(false);
    expect(K.liveHolder(h)).toBe(null);
  });

  test("the Assistant chat behind it doesn't take the keyboard while it's open, and does once it closes", async () => {
    const { default: Chat } = await import("../mods/chat/main.js");
    let focused = 0;
    const chat: any = Object.create(Chat.prototype);
    Object.assign(chat, { box: { focus: () => { focused++; } }, wasFocused: true, hadBox: false, focused: false, press: null, call: null });
    chat.areaKey = () => "p3";
    const now: any = { timer: { after: (_ms: number, f: any) => f(now) }, notify: () => {} };
    const d: any = new NewSpace();
    d.init({}, cx);
    chat.refocus(true, true, now); // its agent restarted: the box comes back
    chat.hadBox = true;
    chat.refocus(true, true, now); // a message arrived: a redraw
    expect(focused).toBe(0);
    d.close();
    chat.refocus(true, true, now);
    expect(focused).toBe(1);
  });
});
