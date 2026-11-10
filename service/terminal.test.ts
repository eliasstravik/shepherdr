import { expect, test } from "bun:test";
import { Hub } from "./hub.ts";
import { keyBytes, terminalBridge } from "./terminal.ts";

// A terminal bridge over a stand-in core: every attach's input is recorded per attach, and terminal.keys calls too.
function bridge() {
  const hub = new Hub("hc");
  const typed: string[] = [], calls: [string, any][] = [], attaches: { observe: boolean; input: string[] }[] = [];
  const live = { address: "t1", state: "live", pid: 7, cols: 80, rows: 24 };
  (hub as any).terminals = new Map([["t1", live]]);
  const core = {
    attach: async (_t: string, _receive: unknown, _c: number, _r: number, options: { observe?: boolean } = {}) => {
      const log = { observe: !!options.observe, input: [] as string[] };
      attaches.push(log);
      return { input: (b: Uint8Array) => { log.input.push(new TextDecoder().decode(b)); typed.push(new TextDecoder().decode(b)); }, close() {} };
    },
    call: async (method: string, p: any) => { calls.push([method, p]); return {}; },
  };
  (hub as any).client = core;
  const sent: any[] = [];
  const ws = { send: (d: string) => sent.push(JSON.parse(d)), close() {}, buffered: () => 0 };
  const b = terminalBridge(hub, "t1", ws as any);
  let id = 0;
  const say = (m: object) => b.message(JSON.stringify({ ...m, id: ++id }));
  const acked = () => new Promise<void>((done) => {
    const tick = () => (sent.filter((m) => m.type === "ack").length === id ? done() : setTimeout(tick, 1));
    tick();
  });
  return { say, acked, calls, typed, attaches, end: () => b.end() };
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
