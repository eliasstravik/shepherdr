import { expect, test } from "bun:test";
import { Hub } from "./hub.ts";
import { refusal } from "../core/send.js";

// The person's words go with no caller: hc send would name the service as the sender, and another machine's core
// would wrap them in <hc from="<core>/ppid:…"> ("Another agent").
function linked(answer: (method: string, p: any) => any) {
  const hub = new Hub("hc"), calls: [string, any][] = [];
  (hub as any).client = { call: async (method: string, p: any) => { calls.push([method, p]); return answer(method, p); } };
  return { hub, calls };
}

test("send goes as the person: no caller, hc send's result", async () => {
  const { hub, calls } = linked(() => ({ started: true, status: "done", turn: 3 }));
  const r = await hub.send("mac-mini/t7", "hello?");
  expect(calls).toEqual([["terminal.send", { terminal: "mac-mini/t7", text: "hello?" }]]);
  expect(r.code).toBe(0);
});

test("a refusal reads as hc send's", async () => {
  const { hub } = linked(() => { throw Object.assign(new Error("t7 is asking something"), { kind: "blocked" }); });
  const r = await hub.send("t7", "hi");
  expect(r.code).not.toBe(0);
  expect(refusal(r)).toEqual({ kind: "blocked", message: "t7 is asking something" });
});

test("no core: it says so at once", async () => {
  const r = await new Hub("hc").send("t7", "hi");
  expect(refusal(r).kind).toBe("unavailable");
});
