import { expect, test } from "bun:test";
import { authNotice, loginInput, loginScreen } from "./sign-in-screen.ts";
import { SignInWatch } from "./sign-in.ts";
import type { CoreTerminal } from "./hc/protocol.ts";
import type { Hub } from "./hub.ts";

const CLAUDE_METHODS = [
  " Select login method:",
  "",
  " ❯ 1. Claude account with subscription · Individual, Team, or Enterprise",
  "   2. Anthropic Console account · API usage billing",
  "   3. 3rd-party platform · Bedrock, Microsoft Foundry, Google Vertex AI",
].join("\n");
const CLAUDE_CODE = [
  " Browser didn't open? Use the URL below to sign in (c to copy)",
  "",
  "https://claude.ai/oauth/authorize?state=one",
  "",
  " Paste code here if prompted",
].join("\n");
const CODEX_DEVICE = [
  "  Finish signing in via your browser",
  "  1. Open this link in your browser and sign in",
  "  https://auth.openai.com/codex/device",
  "  2. Enter this one-time code after you are signed in (expires in 15 minutes)",
  "",
  "  X1YZ-123AB",
].join("\n");
const SERVERS = [
  "  MCP servers",
  "  1 server",
  "",
  "    Other MCPs",
  "  ❯ ⚠ fixture   needs sign-in",
  "",
  "  Enter to view · Esc to close",
].join("\n");
const DETAIL = [
  "  fixture",
  "  MCP server",
  "",
  "  Status:           ⚠ needs sign-in",
  "  ❯ Authenticate",
  "    Disable in this project",
  "    Back",
  "",
  "  ↑/↓ to navigate · Enter to select · Esc to go back",
].join("\n");
const redirect = "http://localhost:12345/callback";
const authorization = "https://login.example.test/oauth/authorize?state=fixture&redirect_uri=" + encodeURIComponent(redirect);
const CLAUDE_CONNECTOR = [
  "  Authenticate with fixture",
  "  Browser didn't open? Use the URL below to sign in (c to copy)",
  "",
  authorization.slice(0, 80),
  authorization.slice(80),
  "",
  "  If the redirect page shows a connection error, paste the URL from your browser's address bar",
  "  Enter to submit · Esc to go back",
].join("\n");
const CODEX_CONNECTOR = [
  "Authorize the MCP server by opening this URL in your browser:",
  authorization,
  "",
  "After signing in, copy the full URL from your browser's address bar.",
  "If the callback page cannot load, paste that URL here anyway.",
  "Callback URL (input hidden):",
].join("\n");

test("native Claude and Codex account screens expose the provider's choices and browser prompts", () => {
  expect(loginScreen("claude", CLAUDE_METHODS, 120)?.options?.map((o) => o.label)).toEqual([
    "Claude subscription", "Anthropic Console", "Bedrock, Microsoft Foundry or Google Vertex AI",
  ]);
  expect(loginScreen("claude", CLAUDE_CODE, 120)).toMatchObject({ stage: "browser", input: "code", url: "https://claude.ai/oauth/authorize?state=one" });
  expect(loginScreen("claude", CLAUDE_CODE.replace("claude.ai", "claude.ai.example.test"), 120)).toBeNull();
  expect(loginScreen("codex", CODEX_DEVICE, 120)).toMatchObject({ stage: "browser", deviceCode: "X1YZ-123AB" });
  expect(authNotice("codex", "Your access token could not be refreshed because your refresh token was already used.")).toMatchObject({ stage: "methods" });
  expect(authNotice("claude", "Not logged in · Please run /login")).toMatchObject({ stage: "start" });
});

test("connector menus include a lone server, and wrapped callback links carry the full redirect", () => {
  expect(authNotice("claude", "Fixture needs you to sign in again (run /mcp to re-authenticate)")).toMatchObject({ connector: "", stage: "start" });
  expect(loginScreen("claude", SERVERS, 80)?.options).toEqual([{ keys: 0, label: "fixture" }]);
  const detail = loginScreen("claude", DETAIL, 80);
  expect(detail).toMatchObject({ connector: "fixture", stage: "methods", options: [{ keys: 0, label: "Sign in to this connector" }] });
  const claude = loginScreen("claude", CLAUDE_CONNECTOR, 80, detail!);
  expect(claude).toMatchObject({ input: "callback", connector: "fixture", url: authorization });
  const codex = loginScreen("codex", CODEX_CONNECTOR, 200, { cli: "Codex", stage: "waiting", connector: "fixture" }, true);
  expect(codex).toMatchObject({ input: "callback", connector: "fixture", url: authorization });
  expect(loginInput(codex!, redirect + "?code=fixture&state=fixture")).toBe(redirect + "?code=fixture&state=fixture");
  expect(loginInput(codex!, redirect + "?code=fixture&state=another")).toBeNull();
  expect(loginInput(codex!, redirect.replace("12345", "23456") + "?code=fixture&state=fixture")).toBeNull();
  expect(loginInput(codex!, redirect + "?code=fixture&state=fixture\nexit")).toBeNull();
});

function watchFixture(cli: "claude" | "codex", initial: string) {
  const addr = "remote/t7";
  const terminal = { address: addr, state: "live", pid: 37, cols: 200, rows: 36, argv: [cli], cwd: "/project", foreground: { argv: [cli], pid: 37, name: cli } } as unknown as CoreTerminal;
  const state = { screen: initial, input: [] as string[], calls: [] as string[][] };
  const terminals = new Map([[addr, terminal]]);
  const hub = {
    terminals,
    front: async () => "agent",
    call: async (method: string, { terminal: target }: { terminal: string }) => method === "terminal.read" ? { text: state.screen } : terminals.get(target),
    core: async () => ({ attach: async (target: string) => ({ input: (value: Uint8Array) => state.input.push(target + ": " + new TextDecoder().decode(value)), close() {} }) }),
  } as unknown as Hub;
  const hc = async (args: string[]) => {
    state.calls.push(args);
    return { code: 0, stdout: JSON.stringify({ address: "remote/t8" }) };
  };
  const log: { id: string; kind: string; text?: string }[] = [];
  const watch = new SignInWatch(hub, hc, () => {}, () => log);
  return { addr, terminal, terminals, log, state, watch, tick: async () => { await watch.tick(addr, terminal); await watch.tick(addr, terminal); } };
}

test("a stale or malformed code cannot reach the agent, and a CLI rejection offers a retry", async () => {
  const { watch, addr, state, tick } = watchFixture("claude", CLAUDE_CODE);
  await tick();
  const old = watch.card(addr)!;
  state.screen = CLAUDE_CODE.replace("state=one", "state=two");
  await expect(watch.act(addr, old.id, { input: "fixture" })).rejects.toThrow("latest card");
  await tick();
  const card = watch.card(addr)!;
  await expect(watch.act(addr, card.id, { input: "fixture\r\nexit" })).rejects.toThrow("code Claude gave you");
  expect(state.input).toEqual([]);
  await watch.act(addr, card.id, { input: "fixture#fixture" });
  expect(state.input).toEqual(["remote/t7: fixture#fixture\r"]);
  state.screen = " ✘ OAuth error: That code wasn't accepted.\n\n Press Enter to retry (Esc to continue without logging in)";
  await tick();
  expect(watch.needs()[0]?.step.stage).toBe("retry");
});

test("a Codex connector uses the named remote machine and reports success only after its command exits successfully", async () => {
  const { watch, addr, terminal, terminals, state, tick, log } = watchFixture("codex", " idle");
  log.push({ id: "one", kind: "agent", text: "MCP: Run codex mcp login fixture" });
  await tick();
  expect(watch.card(addr)).toBeUndefined();
  log.push({ id: "two", kind: "error", text: "MCP: Run codex mcp login fixture" });
  await tick();
  await tick();
  expect(watch.needs()).toHaveLength(1);
  await watch.act(addr, watch.card(addr)!.id, { choice: 0 });
  expect(state.calls[0]).toEqual(["run", "--bg", "--json", "--no-parent", "--no-notify", "--on", "remote", "--cwd", "/project", "--", "codex", "mcp", "login", "fixture", "--no-browser"]);
  terminals.set("remote/t8", { ...terminal, address: "remote/t8", pid: 38 });
  state.screen = CODEX_CONNECTOR;
  await tick();
  await watch.act(addr, watch.card(addr)!.id, { input: redirect + "?code=fixture&state=fixture" });
  expect(state.input[0]).toBe("remote/t8: " + redirect + "?code=fixture&state=fixture\r");
  expect(watch.card(addr)?.step.stage).toBe("waiting");
  terminals.set("remote/t8", { ...terminal, address: "remote/t8", pid: 38, state: "finished", exit_code: 0 });
  await tick();
  expect(watch.card(addr)?.step).toMatchObject({ stage: "signed", restart: true });
  expect(watch.needs()).toEqual([]);
});
