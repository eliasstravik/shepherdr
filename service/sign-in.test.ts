import { expect, test } from "bun:test";
import { authNotice, signInScreen, signInWords } from "./sign-in-screen.ts";
import { SignInWatch } from "./sign-in.ts";
import type { CoreTerminal } from "./hc/protocol.ts";
import type { Hub } from "./hub.ts";

const CLAUDE_METHODS = " Select login method:\n\n ❯ 1. Claude account with subscription\n   2. Anthropic Console account\n";
const CODEX_WELCOME = "  Welcome to Codex\n\n  › 1. Sign in with ChatGPT\n    2. Provide your own API key\n";

test("an agent's own sign-in screen or notice is a need, in its own words", () => {
  expect(signInScreen("claude", CLAUDE_METHODS)).toEqual({ cli: "Claude Code" });
  expect(signInScreen("codex", CODEX_WELCOME)).toEqual({ cli: "Codex" });
  expect(signInScreen("claude", " ❯ fix the button")).toBeNull();
  expect(authNotice("claude", "Not logged in · Please run /login")).toEqual({ cli: "Claude Code" });
  expect(authNotice("claude", "fixture needs you to sign in again (run /mcp to re-authenticate)")).toEqual({ cli: "Claude Code", connector: "fixture" });
  expect(authNotice("codex", "Your access token could not be refreshed because your refresh token was already used.")).toEqual({ cli: "Codex" });
  expect(authNotice("codex", "MCP: Run codex mcp login fixture")).toEqual({ cli: "Codex", connector: "fixture" });
  expect(signInWords({ cli: "Claude Code" })).toEqual({ title: "Claude Code needs you to sign in", how: "Open its terminal and run /login." });
  expect(signInWords({ cli: "Claude Code", connector: "" }).how).toBe("Open its terminal and run /mcp.");
  expect(signInWords({ cli: "Codex" }).how).toBe("Open its terminal and run codex login (or codex login --device-auth on a machine without a browser).");
});

test("the watch only reads: a card while the screen or log says so, gone after, and nothing typed or run", async () => {
  const addr = "remote/t7";
  const terminal = { address: addr, state: "live", pid: 37, argv: ["claude"], foreground: { argv: ["claude"], pid: 37, name: "claude" } } as unknown as CoreTerminal;
  const state = { screen: CLAUDE_METHODS, calls: [] as string[] };
  const hub = {
    call: async (method: string) => { state.calls.push(method); return { text: state.screen }; },
    core: async () => { throw new Error("nothing attaches to type"); },
  } as unknown as Hub;
  const hc = async () => { throw new Error("nothing runs"); };
  const log: { id: string; kind: string; text?: string }[] = [];
  const watch = new SignInWatch(hub, () => {}, () => log);
  expect(await watch.tick(addr, terminal)).toBe(true);
  const id = watch.card(addr)!.id;
  expect(watch.card(addr)?.choices).toEqual([
    { label: "Claude account with subscription" },
    { label: "Anthropic Console account" },
  ]);
  await watch.tick(addr, terminal);
  expect(watch.card(addr)?.id).toBe(id);
  state.screen = " ❯ ";
  expect(await watch.tick(addr, terminal)).toBe(false);
  expect(watch.needs()).toEqual([]);
  log.push({ id: "one", kind: "agent", text: "Run /login when you can" });
  await watch.tick(addr, terminal);
  expect(watch.card(addr)).toBeUndefined();
  log.push({ id: "two", kind: "error", text: "Not logged in · Please run /login" });
  expect(await watch.tick(addr, terminal)).toBe(false);
  expect(watch.card(addr)?.need).toEqual({ cli: "Claude Code" });
  expect(watch.card(addr)?.choices).toBeUndefined();
  expect(state.calls.every((m) => m === "terminal.read")).toBe(true);
});
