import { expect, test } from "bun:test";
import { Hub } from "./hub.ts";
import { keyBytes, terminalBridge } from "./terminal.ts";

// A terminal bridge over a stand-in core: every attach's input is recorded per attach, and terminal.keys calls too.
function bridge(own = false) {
  const hub = new Hub("hc");
  const typed: string[] = [], calls: [string, any][] = [], attaches: { observe: boolean; size: string; input: string[]; resized: string[]; closed: boolean }[] = [];
  const live = { address: "t1", state: "live", pid: 7, cols: 80, rows: 24 };
  (hub as any).terminals = new Map([["t1", live]]);
  const core = {
    attach: async (_t: string, _receive: unknown, c: number, r: number, options: { observe?: boolean } = {}) => {
      const log = { observe: !!options.observe, size: `${c}x${r}`, input: [] as string[], resized: [] as string[], closed: false };
      attaches.push(log);
      return {
        input: (b: Uint8Array) => { log.input.push(new TextDecoder().decode(b)); typed.push(new TextDecoder().decode(b)); },
        resize: (c: number, r: number) => { log.resized.push(`${c}x${r}`); },
        close() { log.closed = true; },
      };
    },
    call: async (method: string, p: any) => { calls.push([method, p]); return {}; },
  };
  (hub as any).client = core;
  const sent: any[] = [];
  const ws = { send: (d: string) => sent.push(JSON.parse(d)), close() {}, buffered: () => 0 };
  const b = terminalBridge(hub, "t1", ws as any, own);
  let id = 0;
  const say = (m: object) => b.message(JSON.stringify({ ...m, id: ++id }));
  const acked = () => new Promise<void>((done) => {
    const tick = () => (sent.filter((m) => m.type === "ack").length === id ? done() : setTimeout(tick, 1));
    tick();
  });
  return { say, acked, calls, typed, attaches, live, end: () => b.end() };
}

test("keys after typed text go down the same typing stream, in order, with no terminal.keys call", async () => {
  const t = bridge();
  t.say({ type: "open" });
  t.say({ type: "text", text: "hello" });
  t.say({ type: "keys", keys: ["enter"] });
  t.say({ type: "keys", keys: ["ctrl+c"] });
  await t.acked();
  expect(t.typed).toEqual(["hello", "\r", "\x03"]);
  expect(t.calls).toEqual([]);
  t.end();
});

test("a key the bridge doesn't know still goes as herdr's key press", async () => {
  const t = bridge();
  t.say({ type: "open" });
  t.say({ type: "keys", keys: ["f13"] });
  await t.acked();
  expect(t.calls).toEqual([["terminal.keys", { terminal: "t1", keys: ["f13"] }]]);
  t.end();
});

test("the key row's keys map to the bytes a keyboard sends", () => {
  expect(keyBytes(["enter"])).toBe("\r");
  expect(keyBytes(["esc"])).toBe("\x1b");
  expect(keyBytes(["tab"])).toBe("\t");
  expect(keyBytes(["shift+tab"])).toBe("\x1b[Z");
  expect(keyBytes(["up"])).toBe("\x1b[A");
  expect(keyBytes(["ctrl+c"])).toBe("\x03");
  expect(keyBytes(["alt+x"])).toBe("\x1bx");
  expect(keyBytes(["enter", "enter"])).toBe("\r\r");
  expect(keyBytes(["ctrl+["])).toBeNull();
  expect(keyBytes(["f13"])).toBeNull();
  expect(keyBytes(["enter", "f13"])).toBeNull();
});

// An agent's terminal, viewed here, takes the page's size while the page watches; herdr-core gives it back its own
// size when that full attach closes (checked on a real throwaway core: a closed full attach falls back to the one
// under it, or the terminal's own size).
test("an agent's terminal takes the page's size, keeps it while typing, and lets it go when the page leaves", async () => {
  const t = bridge();
  t.say({ type: "open" });
  t.say({ type: "resize", cols: 48, rows: 30 });
  await t.acked();
  const full = t.attaches.filter((a) => !a.observe);
  expect(full.map((a) => a.size)).toEqual(["48x30"]);
  // typing goes down the same attach, and it doesn't end 2 s after the last key, as a plain typing attach does
  t.live.cols = 48; t.live.rows = 30;
  t.say({ type: "text", text: "hi" });
  await t.acked();
  await new Promise((r) => setTimeout(r, 2100));
  expect(t.attaches.filter((a) => !a.observe).length).toBe(1);
  expect(full[0].input).toEqual(["hi"]);
  expect(full[0].closed).toBe(false);
  // a new pane size (rotation, the keyboard) moves the same attach: the agent never sees its old size in between
  t.say({ type: "resize", cols: 100, rows: 40 });
  await t.acked();
  expect(t.attaches.filter((a) => !a.observe).length).toBe(1);
  expect(full[0].resized).toEqual(["100x40"]);
  t.end();
  expect(full[0].closed).toBe(true);
});

test("a typing attach opened before a resize is the one that takes the size", async () => {
  const t = bridge();
  t.say({ type: "open" });
  t.say({ type: "text", text: "a" });
  t.say({ type: "resize", cols: 60, rows: 20 });
  await t.acked();
  const full = t.attaches.filter((a) => !a.observe);
  expect(full.length).toBe(1);
  expect(full[0].resized).toEqual(["60x20"]);
  t.end();
});

test("a resize out of bounds is ignored, not obeyed", async () => {
  const t = bridge();
  t.say({ type: "open" });
  t.say({ type: "resize", cols: 5, rows: 2 });
  await t.acked();
  expect(t.attaches.filter((a) => !a.observe)).toEqual([]);
  t.end();
});
