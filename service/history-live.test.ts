import { expect, test } from "bun:test";
import { Live } from "./live.ts";

test("old chat appears before the new session, then stays when its assistant starts", () => {
  const callbacks = new Map<string, Function>();
  const sent: any[] = [];
  const hub: any = { on: () => {} };
  const store: any = { on: () => {} };
  const live = new Live(hub, store, () => null, "test");
  let address: string | null = null;
  live.chats = { watch: (a: string, fn: Function) => callbacks.set(a, fn), unwatch: () => {} } as any;
  live.compat = {
    historyOf: () => "log:|claude|/old.jsonl", addrOf: () => address,
    freshChat: () => ({ key: "p:sp1", messages: [], cli: "claude", fresh: true }),
    chat: (_: string, reader: any) => ({ key: "p:sp1", messages: reader.messages, cli: "claude", top: !reader.earlier, earlier: !!reader.earlier }),
  } as any;
  const ws: any = { data: {}, readyState: 1, send: (text: string) => sent.push(JSON.parse(text)) };
  (live as any).watch(ws, ["p:sp1"]);
  callbacks.get("log:|claude|/old.jsonl")!({ messages: [{ id: "old", who: "you", text: "Before" }] }, null);
  expect(sent.at(-1).chat.messages.map((m: any) => m.id)).toEqual(["old", "history-boundary"]);
  address = "t1";
  (live as any).watch(ws, ["p:sp1"]);
  callbacks.get("t1")!({ messages: [{ id: "new", who: "agent", text: "After" }], earlier: true }, {});
  expect(sent.at(-1).chat.messages.map((m: any) => m.id)).toEqual(["old", "history-boundary", "new"]);
  expect(sent.at(-1).chat.earlier).toBe(true);
  expect(sent.at(-1).chat.top).toBe(false);
});
