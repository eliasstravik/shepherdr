import { expect, test } from "bun:test";
import { Live } from "./live.ts";
import { chatApply } from "../web/shared/patch.ts";

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
  // a chat goes whole once, then as what changed (#1468): rebuilt here as the page does
  const ws: any = { data: {}, readyState: 1, send: (text: string) => {
    const m = JSON.parse(text);
    if (m.type === "chatp") return sent.push({ type: "chat", chat: chatApply(sent.at(-1)?.chat, m) });
    sent.push(m);
  } };
  (live as any).watch(ws, ["p:sp1"]);
  callbacks.get("log:|claude|/old.jsonl")!({ messages: [{ id: "old", who: "you", text: "Before" }] }, null);
  expect(sent.at(-1).chat.messages.map((m: any) => m.id)).toEqual(["h:old", "history-boundary"]);
  address = "t1";
  (live as any).watch(ws, ["p:sp1"]);
  callbacks.get("t1")!({ messages: [{ id: "new", who: "agent", text: "After" }], earlier: true }, {});
  expect(sent.at(-1).chat.messages.map((m: any) => m.id)).toEqual(["h:old", "history-boundary", "new"]);
  expect(sent.at(-1).chat.earlier).toBe(true);
  expect(sent.at(-1).chat.top).toBe(false);
});

test("#1537: two sessions' messages with the same id stay apart", () => {
  const callbacks = new Map<string, Function>();
  const sent: any[] = [];
  const live = new Live({ on: () => {} } as any, { on: () => {} } as any, () => null, "test");
  live.chats = { watch: (a: string, fn: Function) => callbacks.set(a, fn), unwatch: () => {} } as any;
  live.compat = {
    historyOf: () => "log:|claude|/old.jsonl", addrOf: () => "t1", freshChat: () => null,
    chat: (_: string, reader: any) => ({ key: "p:sp1", messages: reader.messages, cli: "claude" }),
  } as any;
  const ws: any = { data: {}, readyState: 1, send: (text: string) => sent.push(JSON.parse(text)) };
  (live as any).watch(ws, ["p:sp1"]);
  callbacks.get("log:|claude|/old.jsonl")!({ messages: [{ id: "a120", who: "you", text: "Old" }, { id: "a300", who: "agent", text: "Re", reply: { id: "a120", text: "Old" } }] }, null);
  callbacks.get("t1")!({ messages: [{ id: "a120", who: "you", text: "New" }] }, {});
  const msgs = sent.at(-1).chat.messages;
  expect(new Set(msgs.map((m: any) => m.id)).size).toBe(msgs.length);
  expect(msgs[1].reply.id).toBe("h:a120");
});
