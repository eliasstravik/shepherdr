// MCP Apps views from agents on another machine: the herdr-mcp gateway there keeps its calls there, in that machine's
// own folder. This service reads them over herdr-core's machine link (machine.exec, the same link other machines'
// artifacts and tasks come over: the tailnet, private), by running herdr-mcp there (gateway.ts cli()):
//   herdr-mcp --list <since>   the calls started since then: the chats of that machine's agents match their MCP steps
//   herdr-mcp --get <id>       a call, --html <id> its view, --call <id> <b64> a view's own request to that gateway
// A view's tool calls still ask the person here first (mcp-apps.ts): only a yes goes to that machine.
import type { Hub } from "../hub.ts";

export type CallIndexRow = { id: string; server: string; tool: string; args: Record<string, unknown>; at: number; terminal?: string | null };

export const MACHINE = /^[\w.-]{1,64}$/;
const KEEP_MS = 30 * 86400_000;
// hc exec has a bare PATH there: herdr-mcp in ~/.local/bin, Bun in ~/.bun/bin
const SH = 'PATH="$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; exec herdr-mcp "$@"';

export type Exec = (machine: string, argv: string[], timeout: number) => Promise<{ code: number; out: Buffer; err: string }>;

/** herdr-core's machine.exec, its output as bytes */
export function hubExec(hub: () => Hub | null): Exec {
  return async (machine, argv, timeout) => {
    const h = hub();
    if (!h) throw new Error("Not connected.");
    const r = await h.call<{ code: number; stdout: string; stderr: string }>("machine.exec", { argv, on: machine, timeout }, (timeout + 5) * 1000);
    return { code: r.code, out: Buffer.from(r.stdout ?? "", "base64"), err: Buffer.from(r.stderr ?? "", "base64").toString("utf8") };
  };
}

export class RemoteCalls {
  /** each machine's calls (index rows), newest read since its last `at` */
  private there = new Map<string, CallIndexRow[]>();
  private reading = new Set<string>();
  private listeners = new Set<() => void>();
  /** machines whose herdr-mcp isn't there (or fails): not asked again for a while */
  private off = new Map<string, number>();
  machines: () => string[] = () => [];
  watched: () => boolean = () => true;
  /** every linked machine, and whether MCP Apps is on (Settings › Plugins): the switch each machine's herdr-mcp --wrap
   *  obeys, so agents started there put their MCP servers behind herdr-mcp only while it is on */
  allMachines: () => string[] = () => [];
  appsOn: () => boolean = () => true;
  /** what each machine was last told (herdr-mcp --switch), so only a change goes again */
  private told = new Map<string, "on" | "off">();

  constructor(private exec: Exec, private now = Date.now) {}

  on(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  start(every = 10_000) {
    setInterval(() => { if (this.watched()) void this.read(); }, every);
    setTimeout(() => void this.read(), 3_000);
    setInterval(() => void this.tell(), 60_000);
    setTimeout(() => void this.tell(), 5_000);
  }

  /** each machine told whether MCP Apps is on, when it changed since it was last told (one that can't be reached now:
   *  again next round) */
  async tell() {
    const want = this.appsOn() ? "on" : "off";
    await Promise.all(this.allMachines().filter((m) => MACHINE.test(m) && this.told.get(m) !== want).map(async (m) => {
      try { if ((await this.run(m, ["--switch", want], 20)).code === 0) this.told.set(m, want); } catch {}
    }));
  }

  /** a machine's calls, for matching (CallIndex.list's shape) */
  of(machine: string): CallIndexRow[] { return this.there.get(machine) ?? []; }

  run(machine: string, args: string[], timeout = 30) {
    if (!MACHINE.test(machine)) throw new Error("Not a machine.");
    return this.exec(machine, ["sh", "-c", SH, "sh", ...args], timeout);
  }

  /** every connected machine's new calls; a change tells the listeners (the chats match again) */
  async read() {
    const now = this.machines();
    for (const m of [...this.there.keys()]) if (!now.includes(m)) this.there.delete(m);
    let changed = false;
    await Promise.all(now.map(async (m) => {
      if (this.reading.has(m) || (this.off.get(m) ?? 0) > this.now()) return;
      this.reading.add(m);
      try {
        const had = this.there.get(m) ?? [];
        const since = had.reduce((x, c) => Math.max(x, c.at), 0);
        const r = await this.run(m, ["--list", String(since)]);
        if (r.code !== 0) { this.off.set(m, this.now() + 5 * 60_000); return; }
        const got = JSON.parse(r.out.toString("utf8"));
        if (!Array.isArray(got)) return;
        const ids = new Set(had.map((c) => c.id));
        const fresh = got.filter((c: any) => c?.id && !ids.has(c.id));
        const keep = had.filter((c) => this.now() - c.at < KEEP_MS);
        if (fresh.length || keep.length !== had.length) {
          this.there.set(m, [...keep, ...fresh].sort((a, b) => b.at - a.at));
          changed = true;
        } else if (!this.there.has(m)) this.there.set(m, []);
      } catch {} finally { this.reading.delete(m); }
    }));
    if (changed) for (const fn of this.listeners) fn();
  }

  /** one call there (gateway.ts callThere) or null */
  async get(machine: string, id: string): Promise<any | null> {
    const r = await this.run(machine, ["--get", id]).catch(() => null);
    if (!r || r.code !== 0) return null;
    try { const v = JSON.parse(r.out.toString("utf8")); return v?.id === id ? v : null; } catch { return null; }
  }

  /** its view's HTML, or null */
  async html(machine: string, id: string): Promise<string | null> {
    const r = await this.run(machine, ["--html", id]).catch(() => null);
    return r && r.code === 0 ? r.out.toString("utf8") : null;
  }

  /** a view's own request to that machine's gateway (the person's yes was asked here) */
  async call(machine: string, id: string, method: string, params: unknown): Promise<{ result?: any; error?: { code?: number; message: string }; closed?: boolean }> {
    const b64 = Buffer.from(JSON.stringify({ method, params })).toString("base64");
    const r = await this.run(machine, ["--call", id, b64], 130).catch((e) => ({ code: -1, out: Buffer.from(""), err: String(e?.message ?? e) }));
    if (r.code !== 0) return { error: { message: `That machine couldn't pass the call on${r.err ? ` (${r.err.trim().split("\n").pop()})` : ""}.` } };
    try { return JSON.parse(r.out.toString("utf8")); } catch { return { error: { message: "That machine's answer wasn't readable." } }; }
  }
}
