// herdr-mcp --wrap: an agent's start command with each of its stdio MCP servers put behind herdr-mcp, so MCP Apps views
// show for servers a folder brings too (a project .mcp.json or .codex/config.toml that `flowbound init` and the like
// write, under the same name as the person's own wrapped one, which then wins). Shepherdr's starts (herdr-task's
// tasks, the service's Assistants and restarts) run it on the agent's machine, in its folder, just before the agent
// starts. Only the agents' own documented launch options; no file in the person's folders is changed:
//   - Claude Code: `--mcp-config <file>` with the folder's .mcp.json servers wrapped (a server given there wins over the
//     folder's of the same name; checked with Claude Code 2.1.332). Only servers the person approved (the settings'
//     enabledMcpjsonServers / enableAllProjectMcpServers, never disabledMcpjsonServers): an unapproved one stays for
//     Claude Code to ask about. Never ~/.claude.json (it holds the sign-in too): servers added there with `claude mcp
//     add` stay as the person added them.
//   - Codex: its own `codex mcp list --json` (user and trusted project config, as Codex merges them) for each server,
//     then `-c mcp_servers.<name>.command=… -c mcp_servers.<name>.args=…`: only command and args change, its env, cwd
//     and the rest stay from the config.
// Never twice (a server already behind herdr-mcp stays), never an HTTP or SSE server, the same name (the same tools),
// the same command, args and env behind herdr-mcp. A wrap from an earlier start (a restart keeps the old flags) is
// taken out first. Off (Settings › Plugins › MCP Apps, or `herdr-mcp --switch off` the service sends to other
// machines): the command as it was, without an earlier wrap. Anything that fails: the command as it was.
// Node's own modules only: this ships in web/dist/herdr-mcp.mjs (gateway.ts).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export type WrapOpts = {
  cwd: string;
  home: string;
  /** what the wrapped server runs: this herdr-mcp */
  self: string;
  /** where the --mcp-config files go (0700, each 0600: a server's env may hold a key) */
  dir: string;
  /** runs a command in a folder (codex mcp list): its exit code and output */
  run?: (argv: string[], cwd: string) => { code: number; stdout: string };
};

const NAME = /^\w[\w.-]{0,63}$/;   // herdr-mcp's own rule for a server's name (gateway.ts main)
const isHerdrMcp = (w: unknown) => typeof w === "string" && /^herdr-mcp(\.mjs)?$/.test(basename(w));

/** Whether a server's command already runs herdr-mcp (directly, or after env, a shell or npx) */
export function alreadyWrapped(command: unknown, args: unknown): boolean {
  return isHerdrMcp(command) || (Array.isArray(args) && args.some((a) => isHerdrMcp(a) || (typeof a === "string" && /(^|[\s/])herdr-mcp(\s|$)/.test(a))));
}

/** Where the agent's own word (claude, codex) is: the first word that is no flag and names one (core/agents.js agentAt) */
export function agentAt(argv: string[]): number {
  return argv.findIndex((a, i) => (i === 0 || !String(a).startsWith("-")) && /^(claude|codex)$/.test(basename(String(a))));
}

/** Words for sh, each single-quoted when it needs it: `eval "set -- $(herdr-mcp --wrap -- "$@")"` takes them back */
export function shellJoin(words: string[]): string {
  return words.map((w) => (/^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`)).join(" ");
}

/** The command with any wrap an earlier start added taken out (a restart keeps the agent's old flags) */
export function unwrap(argv: string[], dir: string): string[] {
  const at = agentAt(argv);
  if (at < 0) return argv;
  const head = argv.slice(0, at + 1), rest = argv.slice(at + 1);
  const ours = (v: string) => resolve(v).startsWith(resolve(dir) + "/");
  if (basename(argv[at]) === "claude") {
    const out: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--mcp-config" && i + 1 < rest.length && ours(rest[i + 1])) { i++; continue; }
      if (rest[i].startsWith("--mcp-config=") && ours(rest[i].slice(13))) continue;
      out.push(rest[i]);
    }
    return [...head, ...out];
  }
  // codex: -c mcp_servers.<name>.command="…herdr-mcp…" and that name's -c mcp_servers.<name>.args=[…]
  const key = (v: string) => v.match(/^mcp_servers\.("[^"]*"|[\w-]+)\.(command|args)=/);
  const names = new Set<string>();
  for (let i = 0; i < rest.length - 1; i++) {
    const m = (rest[i] === "-c" || rest[i] === "--config") ? key(rest[i + 1]) : null;
    if (m && m[2] === "command" && /herdr-mcp/.test(rest[i + 1])) names.add(m[1]);
  }
  if (!names.size) return argv;
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const m = (rest[i] === "-c" || rest[i] === "--config") && i + 1 < rest.length ? key(rest[i + 1]) : null;
    if (m && names.has(m[1])) { i++; continue; }
    out.push(rest[i]);
  }
  return [...head, ...out];
}

function readJson(path: string): any {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** A flag's values in argv (--x v and --x=v) */
function values(argv: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && i + 1 < argv.length) out.push(argv[++i]);
    else if (argv[i].startsWith(flag + "=")) out.push(argv[i].slice(flag.length + 1));
  }
  return out;
}

/** The folder's .mcp.json servers, as Claude Code finds them: from the folder up, the nearest file's entry winning */
export function projectServers(cwd: string): Record<string, any> {
  const out: Record<string, any> = {};
  for (let d = resolve(cwd); ; d = dirname(d)) {
    const s = readJson(join(d, ".mcp.json"))?.mcpServers;
    if (s && typeof s === "object") for (const [k, v] of Object.entries(s)) if (!(k in out)) out[k] = v;
    if (dirname(d) === d) break;
  }
  return out;
}

/** Which of the folder's .mcp.json servers the person approved, from Claude Code's settings files (user, then the
 *  folder's and its parents' .claude/settings.json and settings.local.json) and the --settings it starts with */
export function approval(cwd: string, home: string, argv: string[]): (name: string) => boolean {
  const all: any[] = [readJson(join(home, ".claude", "settings.json"))];
  for (let d = resolve(cwd); ; d = dirname(d)) {
    all.push(readJson(join(d, ".claude", "settings.json")), readJson(join(d, ".claude", "settings.local.json")));
    if (dirname(d) === d) break;
  }
  for (const s of values(argv, "--settings")) {
    try { all.push(JSON.parse(s)); } catch { all.push(readJson(resolve(cwd, s.replace(/^~(?=\/)/, home)))); }
  }
  const on = new Set<string>(), off = new Set<string>();
  let every = false;
  for (const s of all) {
    if (!s || typeof s !== "object") continue;
    if (s.enableAllProjectMcpServers === true) every = true;
    for (const n of strings(s.enabledMcpjsonServers)) on.add(n);
    for (const n of strings(s.disabledMcpjsonServers)) off.add(n);
  }
  return (name) => !off.has(name) && (every || on.has(name));
}

/** The servers the person gave the agent themselves (--mcp-config files or JSON): left as they are */
function ownConfigNames(argv: string[], cwd: string): Set<string> {
  const out = new Set<string>();
  for (const v of values(argv, "--mcp-config")) {
    let j: any = null;
    try { j = JSON.parse(v); } catch { j = readJson(resolve(cwd, v)); }
    for (const k of Object.keys(j?.mcpServers ?? {})) out.add(k);
  }
  return out;
}

function wrapClaude(argv: string[], at: number, o: WrapOpts): string[] {
  if (argv.includes("--strict-mcp-config")) return argv;   // only the servers it was given (a reviewer)
  const mine = ownConfigNames(argv, o.cwd), ok = approval(o.cwd, o.home, argv);
  const servers: Record<string, any> = {};
  for (const [name, s] of Object.entries(projectServers(o.cwd))) {
    if (!s || typeof s !== "object" || !NAME.test(name) || mine.has(name) || !ok(name)) continue;
    if ((s.type ?? "stdio") !== "stdio" || typeof s.command !== "string" || !s.command) continue;
    if (alreadyWrapped(s.command, s.args)) continue;
    servers[name] = { ...s, command: o.self, args: [name, "--", s.command, ...strings(s.args)] };
  }
  if (!Object.keys(servers).length) return argv;
  const text = JSON.stringify({ mcpServers: servers }, null, 2) + "\n";
  mkdirSync(o.dir, { recursive: true, mode: 0o700 });
  try { chmodSync(o.dir, 0o700); } catch {}
  const file = join(o.dir, `${createHash("sha256").update(text).digest("hex").slice(0, 32)}.json`);
  if (!existsSync(file)) writeFileSync(file, text, { mode: 0o600 });
  return [...argv.slice(0, at + 1), "--mcp-config", file, ...argv.slice(at + 1)];
}

/** A TOML key part: bare when it can be */
const tomlKey = (k: string) => (/^[\w-]+$/.test(k) ? k : JSON.stringify(k));

function wrapCodex(argv: string[], at: number, o: WrapOpts): string[] {
  const rest = argv.slice(at + 1);
  // the config it starts with: its own -c and --profile, and -C's folder
  const flags: string[] = [];
  let cwd = o.cwd;
  for (let i = 0; i < rest.length - 1; i++) {
    if (["-c", "--config", "-p", "--profile"].includes(rest[i])) flags.push(rest[i], rest[++i]);
    else if (rest[i] === "-C" || rest[i] === "--cd") cwd = resolve(o.cwd, rest[++i]);
  }
  const run = o.run ?? ((a: string[], c: string) => {
    const r = spawnSync(a[0], a.slice(1), { cwd: c, env: process.env, encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] });
    return { code: r.status ?? 1, stdout: r.stdout ?? "" };
  });
  const r = run([argv[at], ...flags, "mcp", "list", "--json"], cwd);
  if (r.code !== 0) return argv;
  let list: any[] = [];
  try { list = JSON.parse(r.stdout); } catch { return argv; }
  const add: string[] = [];
  for (const s of Array.isArray(list) ? list : []) {
    const name = s?.name, t = s?.transport;
    if (typeof name !== "string" || !NAME.test(name) || s.enabled === false || t?.type !== "stdio" || typeof t.command !== "string" || !t.command) continue;
    if (alreadyWrapped(t.command, t.args)) continue;
    const k = `mcp_servers.${tomlKey(name)}`;
    add.push("-c", `${k}.command=${JSON.stringify(o.self)}`, "-c", `${k}.args=${JSON.stringify([name, "--", t.command, ...strings(t.args)])}`);
  }
  return add.length ? [...argv.slice(0, at + 1), ...add, ...argv.slice(at + 1)] : argv;
}

/** The agent's start command with its stdio MCP servers behind herdr-mcp (on: true), or without an earlier wrap (off) */
export function wrapArgv(argv: string[], o: WrapOpts, on = true): string[] {
  const clean = unwrap(argv, o.dir);
  if (!on) return clean;
  const at = agentAt(clean);
  if (at < 0) return clean;
  try {
    return basename(clean[at]) === "claude" ? wrapClaude(clean, at, o) : wrapCodex(clean, at, o);
  } catch {
    return clean;
  }
}
