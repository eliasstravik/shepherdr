import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wrapArgv, shellJoin, unwrap, alreadyWrapped } from "./wrap.ts";
import { appsOn, cli } from "./gateway.ts";

const SELF = "/opt/herdr/bin/herdr-mcp";
function place() {
  const root = mkdtempSync(join(tmpdir(), "wrap-"));
  const home = join(root, "home"), repo = join(root, "repo"), dir = join(root, "data", "mcp-apps", "launch");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(repo, ".claude"), { recursive: true });
  return { root, home, repo, dir, o: { cwd: repo, home, self: SELF, dir } };
}
const json = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v));
// what flowbound init writes: a plain server under the same name as the person's wrapped one, approved in the repo
function flowboundInit(repo: string) {
  json(join(repo, ".mcp.json"), { mcpServers: {
    flowbound: { type: "stdio", command: "npx", args: ["-y", "flowbound", "mcp"], env: { FLOWBOUND_KEY: "${FLOWBOUND_KEY}" } },
    remote: { type: "http", url: "https://mcp.example.com/mcp" },
    old: { command: "sse-thing", type: "sse", url: "https://x.example.com/sse" },
    mine: { command: "herdr-mcp", args: ["mine", "--", "node", "mine.js"] },
  } });
  json(join(repo, ".claude", "settings.json"), { enabledMcpjsonServers: ["flowbound", "remote", "old", "mine"] });
}
const configOf = (argv: string[]) => JSON.parse(readFileSync(argv[argv.indexOf("--mcp-config") + 1], "utf8")).mcpServers;

test("Claude: a folder's .mcp.json server goes behind herdr-mcp, same name, command, args and env", () => {
  const { repo, o, dir } = place();
  flowboundInit(repo);
  const out = wrapArgv(["claude", "--model", "opus", "hello"], o);
  expect(out.slice(0, 3)).toEqual(["claude", "--mcp-config", out[2]]);
  expect(out.slice(3)).toEqual(["--model", "opus", "hello"]);
  expect(out[2].startsWith(dir + "/")).toBe(true);
  // HTTP, SSE and an already wrapped one stay out: the folder's own entries go on for those
  expect(configOf(out)).toEqual({
    flowbound: { type: "stdio", command: SELF, args: ["flowbound", "--", "npx", "-y", "flowbound", "mcp"], env: { FLOWBOUND_KEY: "${FLOWBOUND_KEY}" } },
  });
  // a server's env may hold a key: only the person reads the file
  expect(statSync(out[2]).mode & 0o777).toBe(0o600);
  expect(statSync(dir).mode & 0o777).toBe(0o700);
  // nothing in the person's folder changed
  expect(JSON.parse(readFileSync(join(repo, ".mcp.json"), "utf8")).mcpServers.flowbound.command).toBe("npx");
});

test("Claude: found from a subfolder too, the nearest .mcp.json winning", () => {
  const { repo, o } = place();
  flowboundInit(repo);
  const sub = join(repo, "pkg", "a");
  mkdirSync(join(sub, ".claude"), { recursive: true });
  json(join(sub, ".mcp.json"), { mcpServers: { flowbound: { command: "node", args: ["near.js"] } } });
  expect(configOf(wrapArgv(["claude"], { ...o, cwd: sub })).flowbound.args).toEqual(["flowbound", "--", "node", "near.js"]);
});

test("Claude: a server the person hasn't approved, or disabled, is left for Claude Code to ask about", () => {
  const { repo, home, o } = place();
  flowboundInit(repo);
  json(join(repo, ".claude", "settings.json"), {});
  expect(wrapArgv(["claude"], o)).toEqual(["claude"]);
  // approved for every project server, by the person's own settings
  json(join(home, ".claude", "settings.json"), { enableAllProjectMcpServers: true });
  expect(Object.keys(configOf(wrapArgv(["claude"], o)))).toEqual(["flowbound"]);
  // disabled in the folder's local settings: never
  json(join(repo, ".claude", "settings.local.json"), { disabledMcpjsonServers: ["flowbound"] });
  expect(wrapArgv(["claude"], o)).toEqual(["claude"]);
  // approved in the --settings it starts with
  json(join(home, ".claude", "settings.json"), {});
  json(join(repo, ".claude", "settings.local.json"), {});
  const argv = ["claude", "--settings", JSON.stringify({ enabledMcpjsonServers: ["flowbound"] })];
  expect(Object.keys(configOf(wrapArgv(argv, o)))).toEqual(["flowbound"]);
});

test("Claude: --strict-mcp-config (a reviewer) and the person's own --mcp-config servers are left alone", () => {
  const { repo, root, o } = place();
  flowboundInit(repo);
  expect(wrapArgv(["claude", "--strict-mcp-config", "--mcp-config", "{}"], o)).toEqual(["claude", "--strict-mcp-config", "--mcp-config", "{}"]);
  json(join(root, "own.json"), { mcpServers: { flowbound: { command: "x" } } });
  expect(wrapArgv(["claude", "--mcp-config", join(root, "own.json")], o)).toEqual(["claude", "--mcp-config", join(root, "own.json")]);
});

test("never twice: a restart's old wrap is taken out before the new one, and MCP Apps off takes it out alone", () => {
  const { repo, o } = place();
  flowboundInit(repo);
  const once = wrapArgv(["claude", "--model", "opus"], o);
  expect(wrapArgv(once, o)).toEqual(once);
  expect(wrapArgv(once, o, false)).toEqual(["claude", "--model", "opus"]);
  expect(wrapArgv(["claude", "--model", "opus"], o, false)).toEqual(["claude", "--model", "opus"]);
  // a folder with no servers: as it was
  const bare = place();
  expect(wrapArgv(["claude", "-c"], bare.o)).toEqual(["claude", "-c"]);
});

test("not an agent's command: as it was", () => {
  const { repo, o } = place();
  flowboundInit(repo);
  expect(wrapArgv(["bash", "-lc", "make"], o)).toEqual(["bash", "-lc", "make"]);
});

// Codex: its own `codex mcp list --json`, as Codex merges user and (trusted) project config
const LIST = [
  { name: "flowbound", enabled: true, transport: { type: "stdio", command: "npx", args: ["-y", "flowbound", "mcp"], env: { A: "1" }, cwd: null } },
  { name: "wrapped", enabled: true, transport: { type: "stdio", command: "herdr-mcp", args: ["wrapped", "--", "node", "w.js"] } },
  { name: "web", enabled: true, transport: { type: "streamable_http", url: "https://mcp.example.com/mcp" } },
  { name: "sleepy", enabled: false, transport: { type: "stdio", command: "node", args: [] } },
  { name: "my.tool", enabled: true, transport: { type: "stdio", command: "/usr/bin/tool", args: ["--x", "it's"] } },
];
function codexRun(list: unknown, seen: { argv?: string[]; cwd?: string } = {}) {
  return (argv: string[], cwd: string) => { seen.argv = argv; seen.cwd = cwd; return { code: 0, stdout: JSON.stringify(list) }; };
}

test("Codex: each stdio server from its project config goes behind herdr-mcp with -c, its env and cwd untouched", () => {
  const { o, repo } = place();
  const seen: { argv?: string[]; cwd?: string } = {};
  const out = wrapArgv(["codex", "--no-daemon", "-c", "model=\"gpt-6.2-sol\"", "-p", "work", "do it"], { ...o, run: codexRun(LIST, seen) });
  // it asked Codex itself, in the folder, with the config the agent starts with
  expect(seen).toEqual({ argv: ["codex", "-c", "model=\"gpt-6.2-sol\"", "-p", "work", "mcp", "list", "--json"], cwd: repo });
  expect(out).toEqual(["codex",
    "-c", `mcp_servers.flowbound.command="${SELF}"`, "-c", `mcp_servers.flowbound.args=["flowbound","--","npx","-y","flowbound","mcp"]`,
    "-c", `mcp_servers."my.tool".command="${SELF}"`, "-c", `mcp_servers."my.tool".args=["my.tool","--","/usr/bin/tool","--x","it's"]`,
    "--no-daemon", "-c", "model=\"gpt-6.2-sol\"", "-p", "work", "do it"]);
  // and again on a restart: the same, not twice
  expect(wrapArgv(out, { ...o, run: codexRun(LIST) })).toEqual(out);
  // off: the old wrap out, the rest kept
  expect(unwrap(out, o.dir)).toEqual(["codex", "--no-daemon", "-c", "model=\"gpt-6.2-sol\"", "-p", "work", "do it"]);
});

test("Codex: a resume keeps its subcommand after the overrides; Codex failing leaves it as it was", () => {
  const { o } = place();
  const out = wrapArgv(["codex", "resume", "abc"], { ...o, run: codexRun([LIST[0]]) });
  expect(out[0]).toBe("codex");
  expect(out.slice(-2)).toEqual(["resume", "abc"]);
  expect(wrapArgv(["codex"], { ...o, run: () => ({ code: 1, stdout: "" }) })).toEqual(["codex"]);
  expect(wrapArgv(["codex"], { ...o, run: () => ({ code: 0, stdout: "not json" }) })).toEqual(["codex"]);
});

test("already wrapped: herdr-mcp as the command, or after env or a shell", () => {
  expect(alreadyWrapped("herdr-mcp", [])).toBe(true);
  expect(alreadyWrapped("/home/x/.local/bin/herdr-mcp", [])).toBe(true);
  expect(alreadyWrapped("env", ["A=1", "herdr-mcp", "x", "--", "y"])).toBe(true);
  expect(alreadyWrapped("sh", ["-c", "exec herdr-mcp x -- y"])).toBe(true);
  expect(alreadyWrapped("npx", ["-y", "flowbound", "mcp"])).toBe(false);
});

test("sh words that eval gives back as they were", () => {
  const words = ["claude", "--settings", `{"a":"it's $HOME"}`, "two words", "plain"];
  const r = Bun.spawnSync(["sh", "-c", `eval "set -- $1"; printf '%s\\n' "$@"`, "sh", shellJoin(words)]);
  expect(r.stdout.toString().trimEnd().split("\n")).toEqual(words);
});

test("herdr-mcp --wrap obeys the switch: the settings' plugins_off and the service's --switch off", async () => {
  const { root, repo } = place();
  flowboundInit(repo);
  const data = join(root, "data"), settings = join(root, "settings.json");
  const env = { HERDR_TASK_SETTINGS: settings };
  expect(appsOn(data, env, root)).toBe(true);
  json(settings, { everywhere: { plugins_off: ["mcp-apps"] } });
  expect(appsOn(data, env, root)).toBe(false);
  json(settings, { everywhere: { plugins_off: ["voice"] } });
  expect(appsOn(data, env, root)).toBe(true);
  const quiet = () => true;
  expect(await cli(["--switch", "off"], data, quiet)).toBe(0);
  expect(appsOn(data, env, root)).toBe(false);
  await cli(["--switch", "on"], data, quiet);
  expect(appsOn(data, env, root)).toBe(true);
  expect(await cli(["--switch", "maybe"], data, quiet)).toBe(2);
});

test("an Assistant's template command: the agent's words through herdr-mcp --wrap, then exec'd", async () => {
  const { wrappedCommand } = await import("../../core/clean-env.js");
  const { startCommand } = await import("../spaces.ts");
  const home = mkdtempSync(join(tmpdir(), "wrap-home-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "claude"), '#!/bin/sh\necho "claude ran $*"\n', { mode: 0o755 });
  writeFileSync(join(bin, "herdr-mcp"), `#!/bin/sh\nshift 2; a=$1; shift; printf "%s --mcp-config '/x/a b.json'" "$a"; for w; do printf " %s" "$w"; done; echo\n`, { mode: 0o755 });
  const sh = (cmd: string) => Bun.spawnSync(["sh", "-c", cmd], { env: { PATH: "/usr/bin:/bin", HOME: home } }).stdout.toString().trim();
  expect(sh(wrappedCommand("exec claude --model 'opus[1m]'"))).toBe("claude ran --mcp-config /x/a b.json --model opus[1m]");
  expect(startCommand("claude --model opus")).toBe(wrappedCommand("claude --model opus"));
  // anything but an agent's own command: as before
  expect(startCommand("my-agent --x")).not.toContain("herdr-mcp");
  // no herdr-mcp there: the agent as it was
  writeFileSync(join(bin, "herdr-mcp"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  expect(sh(wrappedCommand("claude --model opus"))).toBe("claude ran --model opus");
});
