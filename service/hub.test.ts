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
  expect(calls.filter(([m]) => m === "terminal.send")).toEqual([["terminal.send", { terminal: "mac-mini/t7", text: "hello?" }]]);
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

// SHEP-324: herdr-core lost the agent (or it exited) and left a plain shell: nothing is typed, the sender is told why.
const SHELL_T = { address: "t7", state: "live", labels: { "herdr.agent": "claude" }, foreground: { name: "bash", argv: ["/bin/bash"], pid: 9 } };
const CLAUDE_T = { ...SHELL_T, foreground: { name: "claude", argv: ["claude", "--resume", "x"], pid: 10 } };

test("a plain shell in front: nothing typed, refused as no_agent in plain words", async () => {
  const { hub, calls } = linked((m) => (m === "terminal.get" ? SHELL_T : { started: true }));
  const r = await hub.send("t7", "rm -rf build && say hi");
  expect(calls.map(([m]) => m)).toEqual(["terminal.get"]);
  expect(refusal(r).kind).toBe("no_agent");
  expect(refusal(r).message).toContain("plain shell");
});

test("the live list can lag: herdr-core's answer now decides", async () => {
  const { hub, calls } = linked((m) => (m === "terminal.get" ? SHELL_T : { started: true }));
  hub.terminals.set("t7", CLAUDE_T as any);
  expect((await hub.send("t7", "hi")).code).not.toBe(0);
  expect(calls.some(([m]) => m === "terminal.send")).toBe(false);
});

test("another program in front of a Claude Code terminal: nothing typed", async () => {
  const { hub, calls } = linked((m) => (m === "terminal.get" ? { ...SHELL_T, foreground: { name: "vim", argv: ["vim"] } } : { started: true }));
  expect(refusal(await hub.send("t7", "hi")).kind).toBe("no_agent");
  expect(calls.some(([m]) => m === "terminal.send")).toBe(false);
});

test("its agent in front (and fish running it, #780): the words go", async () => {
  for (const t of [CLAUDE_T, { ...SHELL_T, foreground: { name: "fish", argv: ["fish", "-ic", "claude; exec fish -i"] } }]) {
    const { hub, calls } = linked((m) => (m === "terminal.get" ? t : { started: true }));
    expect((await hub.send("t7", "hi")).code).toBe(0);
    expect(calls.map(([m]) => m)).toEqual(["terminal.get", "terminal.send"]);
  }
});
