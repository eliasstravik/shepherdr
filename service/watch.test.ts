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
// phone, the watch), and the card's two buttons press the screen's own Yes or No, wherever its cursor is. Fake folder.
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

test("#1441: Trust this folder and start presses the screen's Yes", async () => {
  const { watch, sent } = trustWatch();
  await settle(watch);
  const [t] = watch.trustCards();
  expect(await watch.press(t.card.id, 0)).toBeNull();
  expect(sent).toEqual([["keys", "t7", "down", "enter"]]);
});

test("#1441: No presses the screen's No", async () => {
  const { watch, sent } = trustWatch();
  await settle(watch);
  const [t] = watch.trustCards();
  expect(await watch.press(t.card.id, 1)).toBeNull();
  expect(sent).toEqual([["keys", "t7", "enter"]]);
  expect(watch.trustCards()).toEqual([]);
});
