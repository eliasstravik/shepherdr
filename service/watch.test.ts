import { expect, test } from "bun:test";
import { AgentWatch } from "./watch.ts";

test("a lost session is reported without starting a replacement", async () => {
  const calls: string[][] = [];
  const terminal = { address: "t1", state: "live", argv: ["claude", "--resume", "old"], labels: { "herdr.role": "coordinator" } };
  const hub: any = { terminals: new Map([["t1", terminal]]), send: () => { throw new Error("must not send to the shell"); } };
  const hc = async (args: string[]) => {
    calls.push(args);
    return { code: 0, stdout: args[0] === "get" ? JSON.stringify(terminal) : "No conversation found" };
  };
  const watch = new AgentWatch(hub, hc, { watched: () => [], changed: () => {} });
  await (watch as any).checkLost({ addr: "t1" });
  expect(calls.map((a) => a[0])).toEqual(["get", "read"]);
  expect(watch.notes.get("t1")?.text).toContain("Restart");
});
