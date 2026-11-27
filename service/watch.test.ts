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

// #1441: an agent at its CLI's folder-trust screen whose chat nobody has open still gets its card (Needs you, the
// phone, the watch), and the card opens the terminal for the person to answer; nothing presses the screen. Fake folder.
const FLIPPED = [
  "/home/me/dev/shop",
  "",
  "Quick safety check: Is this a project you created or one you trust?",
  "",
  " ❯ 1. No, exit",
  "   2. Yes, I trust this folder",
  "",
  "Enter to confirm · Esc to cancel",
].join("\n");
const trustWatch = () => {
  const sent: string[][] = [];
  const terminal = { address: "t7", state: "live", foreground: { name: "claude" }, created_ms: 0 };
  const hub: any = { terminals: new Map([["t7", terminal]]) };
  const hc = async (args: string[]) => (args[0] === "read" ? { code: 0, stdout: FLIPPED } : (sent.push(args), { code: 0, stdout: "" }));
  const watch = new AgentWatch(hub, hc, { watched: () => [], changed: () => {} });
  return { watch, sent };
};
const settle = async (watch: any) => { await watch.tick(); await watch.tick(); };

test("#1441: an unwatched agent at the trust screen gets a trust card", async () => {
  const { watch } = trustWatch();
  await settle(watch);
  const [t] = watch.trustCards();
  expect(t.trust).toEqual({ yes: 1, no: 0, folder: "/home/me/dev/shop" });
  expect(t.card.addr).toBe("t7");
});

test("#1441: a trust card never presses the screen: the person answers in the terminal", async () => {
  const { watch, sent } = trustWatch();
  await settle(watch);
  expect((watch as any).press).toBeUndefined();
  expect(sent).toEqual([]);
});
