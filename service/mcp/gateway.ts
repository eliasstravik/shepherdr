// herdr-mcp: an MCP server for an agent that passes everything to the real one, so Shepherdr can show the views of
// MCP Apps (spec 2026-01-26) in its chat. The agent starts it from its own documented MCP config:
//   claude mcp add flowbound -- herdr-mcp flowbound -- npx -y flowbound mcp
//   codex mcp add flowbound -- herdr-mcp flowbound -- npx -y flowbound mcp
// It changes nothing the agent sends or gets, except what the spec asks of a host:
//   - its initialize says the host shows views (capabilities.extensions["io.modelcontextprotocol/ui"])
//   - tools/list leaves out the tools only a view may call (visibility without "model")
// and it keeps each call to a tool that has a view (records.ts), with the view's HTML (resources/read on the same
// link). A view's own calls (tools/call, resources/read) come from the page through the service to this gateway's
// socket and go to the server on the agent's link, as the spec's "same server connection".
// No agent's sign-in, token or setting is read or used: the agent talks to this program as to any MCP server.
// herdr-mcp --wrap (wrap.ts) is how Shepherdr's starts put a folder's own MCP servers behind it too, with the agents'
// documented launch options; --switch on|off is how the service tells another machine whether MCP Apps is on.
// It is also how the Shepherdr service on another machine reads the calls kept here, over herdr-core's machine link
// (service/mcp/remote.ts): herdr-mcp --list, --get, --html and --call (cli()).
// It ships to every machine as one file (web/dist/herdr-mcp.mjs from cli.ts, built by `bun run build`, synced by herdr-task) that
// runs on Bun or Node: only Node's own modules and core/paths.js here, nothing of Bun's.
import { spawn, type ChildProcess } from "node:child_process";
import { connect, createServer, type Server, type Socket } from "node:net";
import { existsSync, mkdirSync, rmSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import * as P from "../../core/paths.js";
import { wrapArgv, shellJoin } from "./wrap.ts";
import { EXTENSION, MIME, newId, saveCall, saveHtml, viewOf, visibilityOf, prune, appsDir, readCall, readHtml, listCalls, type CallRecord } from "./records.ts";

/** the service's folder on this machine, as service/paths.ts DATA (that file needs Bun) */
export function dataDir(env: Record<string, string | undefined> = process.env, home = homedir()): string {
  if (env.SHEPHERDR_DATA) return env.SHEPHERDR_DATA;
  return shepPaths(env, home).service;
}
function shepPaths(env: Record<string, string | undefined>, home: string): any {
  const r = (P as any).roots(home, env, process.platform === "darwin");
  let layout = "";
  try { layout = readFileSync(join(r.data, "LAYOUT"), "utf8"); } catch {}
  return (P as any).pathsFrom(home, r, (P as any).isMigrated(layout, existsSync(join(home, (P as any).LEGACY, (P as any).ROLLBACK))));
}

/** Whether MCP Apps is on for this machine's agents: not off in its settings file (Settings › Plugins, plugins_off), nor
 *  switched off by the service that reaches it (`herdr-mcp --switch off`: <data>/mcp-apps/off) */
export function appsOn(data = DATA, env: Record<string, string | undefined> = process.env, home = homedir()): boolean {
  if (existsSync(join(appsDir(data), "off"))) return false;
  const file = env.HERDR_TASK_SETTINGS || shepPaths(env, home).settings;
  try {
    const off = JSON.parse(readFileSync(file, "utf8"))?.everywhere?.plugins_off;
    return !(Array.isArray(off) && off.includes("mcp-apps"));
  } catch { return true; }
}
const DATA = dataDir();

type Msg = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: any; result?: any; error?: any };

/** where a gateway listens: in the service's folder, or /tmp/shepherdr-<uid> when that path is too long for a socket */
export function sockFor(data: string, pid = process.pid, uid = process.getuid?.() ?? 0): string {
  const own = join(appsDir(data), "s", String(pid));
  if (Buffer.byteLength(own) < 100) return own;
  const tmp = join("/tmp", `shepherdr-${uid}`);
  try { mkdirSync(tmp, { mode: 0o700 }); } catch {}
  try { const st = lstatSync(tmp); if (st.isDirectory() && !st.isSymbolicLink() && st.uid === uid && (st.mode & 0o077) === 0) return join(tmp, `mcp-${pid}`); } catch {}
  return own;
}

/** The upstream link: lines of JSON-RPC both ways (stdio today). */
export interface Upstream {
  send(m: Msg): void;
  onmessage: (m: Msg) => void;
  onclose: () => void;
  close(): void;
}

/** a server on stdio: its stderr stays the agent's (agents show it in their MCP logs) */
export function stdioUpstream(cmd: string[], env = process.env): Upstream {
  const child: ChildProcess = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "pipe", "inherit"], env });
  const up: Upstream = {
    send: (m) => { child.stdin?.write(JSON.stringify(m) + "\n"); },
    onmessage: () => {},
    onclose: () => {},
    close: () => { try { child.stdin?.end(); child.kill("SIGTERM"); } catch {} },
  };
  createInterface({ input: child.stdout! }).on("line", (l) => {
    if (!l.trim()) return;
    let m: Msg;
    try { m = JSON.parse(l); } catch { return; }
    up.onmessage(m);
  });
  child.on("exit", () => up.onclose());
  child.on("error", (e) => { process.stderr.write(`herdr-mcp: ${e.message}\n`); up.onclose(); });
  return up;
}

export type GatewayOptions = {
  name: string;
  upstream: Upstream;
  /** to the agent */
  toAgent: (m: Msg) => void;
  data?: string;
  terminal?: string | null;
  now?: () => number;
};

/** the gateway's logic, without stdio (tests drive it) */
export class Gateway {
  tools = new Map<string, any>();
  /** the agent's requests on their way: id -> what was asked (and the call record, for a tool with a view) */
  asked = new Map<string, { method: string; params: any; rec?: CallRecord }>();
  /** our own requests to the server (a view's, a resource read): id -> answer */
  own = new Map<string, (m: Msg) => void>();
  views = new Map<string, Promise<{ sha?: string; meta?: any; error?: string }>>();
  n = 0;
  sock = "";
  data: string;
  private now: () => number;

  constructor(public o: GatewayOptions) {
    this.data = o.data ?? DATA;
    this.now = o.now ?? Date.now;
    o.upstream.onmessage = (m) => this.fromServer(m);
  }

  key = (id: unknown) => JSON.stringify(id);

  /** a message from the agent */
  fromAgent(m: Msg) {
    if (m.method && m.id !== undefined && m.id !== null) {
      let params = m.params;
      if (m.method === "initialize") {
        // the spec's client capability: this host shows text/html;profile=mcp-app views
        const caps = params?.capabilities ?? {};
        params = { ...params, capabilities: { ...caps, extensions: { ...(caps.extensions ?? {}), [EXTENSION]: { mimeTypes: [MIME] } } } };
      }
      const entry: { method: string; params: any; rec?: CallRecord } = { method: m.method, params };
      if (m.method === "tools/call") entry.rec = this.started(params) ?? undefined;
      this.asked.set(this.key(m.id), entry);
      this.o.upstream.send({ ...m, params });
      return;
    }
    // a notification, or the agent's answer to the server's own request (roots, sampling, elicitation)
    this.o.upstream.send(m);
  }

  /** a message from the server */
  fromServer(m: Msg) {
    if (m.id !== undefined && m.id !== null && !m.method) {
      const mine = this.own.get(this.key(m.id));
      if (mine) {
        this.own.delete(this.key(m.id));
        mine(m);
        return;
      }
      const a = this.asked.get(this.key(m.id));
      this.asked.delete(this.key(m.id));
      if (a?.method === "tools/list" && Array.isArray(m.result?.tools)) {
        for (const t of m.result.tools) if (t?.name) this.tools.set(String(t.name), t);
        // a tool only a view may call is not the agent's (spec: Visibility)
        m = { ...m, result: { ...m.result, tools: m.result.tools.filter((t: any) => visibilityOf(t).includes("model")) } };
      }
      if (a?.rec) this.finished(a.rec, m);
    }
    this.o.toAgent(m);
  }

  /** a call to a tool with a view: kept as running, its view fetched */
  started(params: any): CallRecord | null {
    const name = String(params?.name ?? "");
    const def = this.tools.get(name);
    const uri = viewOf(def);
    if (!uri) return null;
    const rec: CallRecord = {
      id: newId(), server: this.o.name, tool: name, def, args: params?.arguments ?? {}, state: "running", at: this.now(),
      terminal: this.o.terminal ?? null, view: { uri }, gateway: { pid: process.pid, sock: this.sock },
    };
    this.save(rec);
    void this.view(uri).then((v) => {
      rec.view = { uri, ...v };
      this.save(rec);
    });
    return rec;
  }

  finished(rec: CallRecord, m: Msg) {
    rec.end = this.now();
    if (m.error) { rec.state = "error"; rec.error = String(m.error?.message ?? "The tool failed."); }
    else { rec.state = "done"; rec.result = m.result; }
    this.save(rec);
  }

  save(rec: CallRecord) {
    try { saveCall(this.data, rec); } catch (e) { process.stderr.write(`herdr-mcp: couldn't keep a call (${(e as Error).message})\n`); }
  }

  /** a request of our own to the server, on the agent's link */
  request(method: string, params: any, timeout = 120_000): Promise<Msg> {
    const id = `herdr-mcp-${process.pid}-${++this.n}`;
    return new Promise((done) => {
      const t = setTimeout(() => { this.own.delete(this.key(id)); done({ jsonrpc: "2.0", id, error: { code: -32001, message: "The server didn't answer in time." } }); }, timeout);
      this.own.set(this.key(id), (m) => { clearTimeout(t); done(m); });
      this.o.upstream.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** a view's HTML (resources/read), once per address on this link */
  view(uri: string) {
    let p = this.views.get(uri);
    if (!p) {
      p = this.request("resources/read", { uri }).then((m) => {
        const c = (m.result?.contents ?? []).find((x: any) => x?.uri === uri) ?? m.result?.contents?.[0];
        if (!c) return { error: m.error?.message ?? "The server has no such view." };
        if (c.mimeType && !String(c.mimeType).toLowerCase().startsWith("text/html")) return { error: `The view is ${c.mimeType}, not HTML.` };
        const html = typeof c.text === "string" ? c.text : typeof c.blob === "string" ? Buffer.from(c.blob, "base64").toString("utf8") : null;
        if (html === null) return { error: "The view came without its HTML." };
        return { sha: saveHtml(this.data, html), meta: c._meta?.ui ?? undefined };
      });
      this.views.set(uri, p);
      // one that failed is asked again next time
      void p.then((v) => { if (v.error) this.views.delete(uri); });
    }
    return p;
  }

  /** a view's own request, from the page through the service: only what the spec lets a view ask, and a tool only
   *  when it is one a view may call (visibility has "app") */
  async fromView(method: string, params: any): Promise<Msg> {
    const no = (message: string) => ({ jsonrpc: "2.0" as const, id: null, error: { code: -32602, message } });
    if (method === "tools/call") {
      const t = this.tools.get(String(params?.name ?? ""));
      if (!t) return no(`This server has no tool "${params?.name}".`);
      if (!visibilityOf(t).includes("app")) return no(`A view may not call "${params?.name}".`);
      return this.request("tools/call", { name: t.name, arguments: params?.arguments ?? {} });
    }
    if (method === "resources/read") return this.request("resources/read", { uri: String(params?.uri ?? "") });
    return no(`A view may not ask ${method}.`);
  }

  /** the socket the service reaches this gateway on: one JSON line asked, one answered */
  listen(): Promise<Server> {
    const path = sockFor(this.data);
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    if (existsSync(path)) rmSync(path, { force: true });
    this.sock = path;
    return new Promise((ok, fail) => {
      const srv = createServer((s: Socket) => {
        createInterface({ input: s }).on("line", async (l) => {
          let q: any;
          try { q = JSON.parse(l); } catch { return s.end(); }
          const a = await this.fromView(String(q?.method ?? ""), q?.params);
          s.end(JSON.stringify({ result: a.result, error: a.error }) + "\n");
        });
        s.on("error", () => {});
      });
      srv.on("error", fail);
      srv.listen(path, () => ok(srv));
    });
  }
}

/** whether the gateway that made a call still runs (its view's own calls go through it) */
export function liveGateway(r: Pick<CallRecord, "gateway">): boolean {
  const g = r.gateway;
  if (!g?.pid || !g.sock || !existsSync(g.sock)) return false;
  try { process.kill(g.pid, 0); return true; } catch { return false; }
}

/** one request to a gateway's socket -> { result } | { error } */
export function askGateway(sock: string, method: string, params: unknown, timeout = 130_000): Promise<{ result?: any; error?: { code?: number; message: string } }> {
  return new Promise((done) => {
    let buf = "", over = false;
    const end = (v: any) => { if (!over) { over = true; clearTimeout(t); s.destroy(); done(v); } };
    const s = connect(sock);
    const t = setTimeout(() => end({ error: { message: "The MCP server didn't answer in time." } }), timeout);
    s.on("connect", () => s.write(JSON.stringify({ method, params }) + "\n"));
    s.on("data", (d) => {
      buf += d.toString();
      const i = buf.indexOf("\n");
      if (i < 0) return;
      try { end(JSON.parse(buf.slice(0, i))); } catch { end({ error: { message: "The gateway's answer wasn't readable." } }); }
    });
    s.on("error", () => end({ error: { message: "The agent's link to this MCP server is closed." } }));
    s.on("close", () => end({ error: { message: "The agent's link to this MCP server closed." } }));
  });
}

/** a call as another machine's service reads it: no paths of this machine, and whether its gateway still runs */
export function callThere(r: CallRecord) {
  const { gateway: _g, terminal: _t, ...rest } = r;
  return { ...rest, live: liveGateway(r) };
}

/** What another machine's service asks of the calls kept here, over herdr-core's machine link (remote.ts):
 *    --list [<since ms>]   the calls started since then, one JSON array (what matching uses: no results)
 *    --get <id>            a call (callThere), or {"error"}
 *    --html <id>           its view's HTML, as it is (exit 1 when there is none)
 *    --call <id> <b64>     a view's own request ({method, params}, base64 JSON) to the call's gateway: its answer
 *  Only the view's calls the spec allows go on (Gateway.fromView checks again); the person's yes was asked there.
 *  -> exit code, or null when argv is no such command */
export async function cli(argv: string[], data = DATA, out = (s: string) => process.stdout.write(s)): Promise<number | null> {
  const [cmd, a, b] = argv;
  if (cmd === "--wrap") {
    // herdr-mcp --wrap [--json] -- <agent command…>: that command with its stdio MCP servers behind herdr-mcp (wrap.ts),
    // as sh words (`eval "set -- $(herdr-mcp --wrap -- "$@")"`) or a JSON array. Run in the agent's folder.
    const sep = argv.indexOf("--");
    const words = sep >= 0 ? argv.slice(sep + 1).map(String) : [];
    if (!words.length) { process.stderr.write("usage: herdr-mcp --wrap [--json] -- <agent command…>\n"); return 2; }
    let next = words;
    try {
      next = wrapArgv(words, { cwd: process.cwd(), home: homedir(), self: process.env.HERDR_MCP_SELF || "herdr-mcp", dir: join(appsDir(data), "launch") }, appsOn(data));
    } catch {}
    out((argv.slice(1, sep).includes("--json") ? JSON.stringify(next) : shellJoin(next)) + "\n");
    return 0;
  }
  if (cmd === "--switch") {
    // herdr-mcp --switch on|off: the service that reaches this machine says whether MCP Apps is on (its Settings)
    if (a !== "on" && a !== "off") { process.stderr.write("usage: herdr-mcp --switch on|off\n"); return 2; }
    const f = join(appsDir(data), "off");
    if (a === "off") { mkdirSync(appsDir(data), { recursive: true }); writeFileSync(f, ""); } else rmSync(f, { force: true });
    out(`${a}\n`);
    return 0;
  }
  if (cmd === "--list") {
    const since = Number(a) || 0;
    out(JSON.stringify(listCalls(data).filter((c) => c.at >= since)) + "\n");
    return 0;
  }
  if (cmd !== "--get" && cmd !== "--html" && cmd !== "--call") return null;
  const r = readCall(data, String(a ?? ""));
  if (!r) { out(JSON.stringify({ error: "No such view." }) + "\n"); return 1; }
  if (cmd === "--get") { out(JSON.stringify(callThere(r)) + "\n"); return 0; }
  if (cmd === "--html") {
    const html = r.view?.sha ? readHtml(data, r.view.sha) : null;
    if (html === null) { out(JSON.stringify({ error: r.view?.error ?? "The view isn't here yet." }) + "\n"); return 1; }
    out(html);
    return 0;
  }
  let q: any = null;
  try { q = JSON.parse(Buffer.from(String(b ?? ""), "base64").toString("utf8")); } catch {}
  const method = String(q?.method ?? "");
  if (method !== "tools/call" && method !== "resources/read") { out(JSON.stringify({ error: { code: -32601, message: `A view may not ask ${method}.` } }) + "\n"); return 0; }
  if (!liveGateway(r)) { out(JSON.stringify({ closed: true, error: { code: -32000, message: "The agent that made this view has closed its link to the MCP server." } }) + "\n"); return 0; }
  out(JSON.stringify(await askGateway(r.gateway.sock, method, q?.params ?? {})) + "\n");
  return 0;
}

/** herdr-mcp <name> -- <command> [args…] */
export async function main(argv = process.argv.slice(2)) {
  const done = await cli(argv);
  // not process.exit: a big answer (a view's HTML) must reach a pipe whole first
  if (done !== null) { process.exitCode = done; return; }
  const sep = argv.indexOf("--");
  const name = argv[0];
  const cmd = sep >= 0 ? argv.slice(sep + 1) : [];
  if (!name || sep !== 1 || !cmd.length || !/^\w[\w.-]{0,63}$/.test(name)) {
    process.stderr.write("usage: herdr-mcp <name> -- <command> [args…]\n  e.g. claude mcp add flowbound -- herdr-mcp flowbound -- npx -y flowbound mcp\n");
    process.exit(2);
  }
  const up = stdioUpstream(cmd);
  const gw = new Gateway({ name, upstream: up, toAgent: (m) => process.stdout.write(JSON.stringify(m) + "\n"), terminal: process.env.HC_TERMINAL_ID || null });
  let srv: Server | null = null;
  try { srv = await gw.listen(); } catch (e) { process.stderr.write(`herdr-mcp: views can't call back (${(e as Error).message})\n`); }
  try { prune(gw.data); } catch {}
  const bye = () => {
    try { srv?.close(); if (gw.sock) rmSync(gw.sock, { force: true }); } catch {}
    up.close();
    process.exit(0);
  };
  up.onclose = bye;
  createInterface({ input: process.stdin }).on("line", (l) => {
    if (!l.trim()) return;
    let m: Msg;
    try { m = JSON.parse(l); } catch { return; }
    gw.fromAgent(m);
  }).on("close", bye);
  process.on("SIGTERM", bye);
  process.on("SIGINT", bye);
}

