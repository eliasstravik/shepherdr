import { expect, test } from "bun:test";
import { AgentWatch } from "./watch.ts";
import { trustOf } from "../core/screens.js";

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
const agentWatch = (screen = FLIPPED, cli = "claude") => {
  const sent: string[][] = [];
  const terminal = { address: "t7", state: "live", foreground: { name: cli }, created_ms: 0 };
  const hub: any = { terminals: new Map([["t7", terminal]]) };
  const hc = async (args: string[]) => (args[0] === "read" ? { code: 0, stdout: screen } : (sent.push(args), { code: 0, stdout: "" }));
  const watch = new AgentWatch(hub, hc, { watched: () => [], loginWatches: () => ["t7"], changed: () => {} });
  return { watch, sent, hub, show: (text: string) => { screen = text; } };
};
const settle = async (watch: any) => { await watch.tick(); await watch.tick(); };

test("#1441: an unwatched agent at the trust screen gets a trust card", async () => {
  const { watch } = agentWatch();
  await settle(watch);
  const [card] = watch.openCards();
  expect(trustOf(card)).toEqual({ yes: 1, no: 0, folder: "/home/me/dev/shop" });
  expect(card.addr).toBe("t7");
});

test("#1441: a trust card never presses the screen: the person answers in the terminal", async () => {
  const { watch, sent } = agentWatch();
  await settle(watch);
  expect((watch as any).press).toBeUndefined();
  expect(sent).toEqual([]);
});

test("Codex's hook review goes up without an open chat and clears when its terminal is removed", async () => {
  const { watch, sent, hub } = agentWatch([
    "  Hooks need review",
    "  1 hook is new or changed.",
    "  Hooks can run outside the sandbox after you trust them.",
    "",
    "",
    "› 1. Review hooks",
    "  2. Trust all and continue",
    "  3. Continue without trusting (hooks won't run)",
    "",
    "  enter confirm · esc skip",
  ].join("\n"), "codex");
  await settle(watch);
  expect(watch.openCards()).toMatchObject([{ words: expect.stringContaining("Hooks need review"), choices: [
    { label: "Review hooks" }, { label: "Trust all and continue" }, { label: "Continue without trusting (hooks won't run)" },
  ] }]);
  expect(sent).toEqual([]);
  hub.terminals.delete("t7");
  await (watch as any).tick();
  expect(watch.openCards()).toEqual([]);
});

test("a running Claude waiting at its own permission menu gets a terminal-only card", async () => {
  const { watch, sent, hub, show } = agentWatch([
    "Claude Code can't parse this command safely. Do you want to proceed?",
    "",
    " ❯ 1. Yes",
    "   2. No",
    "",
    " Esc to cancel",
  ].join("\n"));
  const terminal = hub.terminals.get("t7");
  Object.assign(terminal, { turn: 3, status: { state: "working" } });
  await settle(watch);
  expect(watch.openCards()).toMatchObject([{ addr: "t7", dialog: true, choices: [{ label: "Yes" }, { label: "No" }] }]);
  show("Work continues.\n\n❯ ");
  await (watch as any).tick();
  expect(watch.openCards()).toEqual([]);
  expect(sent).toEqual([]);
});

test("Codex's in-session confirmation shows once and gives way to an existing card", async () => {
  const { watch, hub, show } = agentWatch("Review required\nPress Enter to continue", "codex");
  const terminal = hub.terminals.get("t7");
  Object.assign(terminal, { turn: 2, status: { state: "working" } });
  await settle(watch);
  expect(watch.openCards()).toMatchObject([{ dialog: true, choices: [{ label: "Continue" }] }]);
  await watch.screens.tick("t7", terminal, Date.now(), true);
  expect(watch.openCards()).toEqual([]);
  show("Output from previous command:\nPress Enter to continue\n\n› ");
  await settle(watch);
  expect(watch.openCards()).toEqual([]);
});
