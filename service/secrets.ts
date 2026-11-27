// Which machine keeps the secrets (SecretsHome: core/secrets.js SECRETS_DOC), and, on that machine, every other
// machine's agent asking for one (herdr.secret.want) answered by herdr-secret serve from the vault here, whether or not
// a window is open (the window's tab bar does it too while no service runs: lib/secrets.js serveRemote).
// Secrets from the web: an agent's ask (herdr.secret.ask.<NAME> on its terminal) as 2.1's masked card, a value kept
// in the vault on this machine with herdr-secret set (from stdin: a value is never in a command line, a chat or a log),
// and the agent told by name only (core/secrets.js), as the window's card does. Settings > Secrets lists names only.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { MachineRow } from "./host.ts";
import { join, resolve } from "node:path";
import type { Hub } from "./hub.ts";
import { DATA, HOME, where } from "./paths.ts";
import * as SC from "../core/secrets.js";
import * as HC from "../core/host.js";
import { PY } from "../core/paths.js";
import { spawn } from "./spawn.ts";

const { NAME, ASK, asksIn, keptLine, declinedLine, SECRETS_DOC, secretsRecord, believeRecord, autoKeeper, followTo, COUNT_SCRIPT } = SC as any;
const { HOST_DOC, newestHost } = HC as any;
const VAULT = resolve(process.env.HERDR_SECRET_VAULT || where().vault);
const VAULT_DOC = "shepherdr.secret-vault";
const MARK = where()["secret-remote"];
// herdr-secret beside this service (Shepherdr's own folder, or a checkout), else the installed one. It runs in
// Shepherdr's own herdr-core session, as this service does (session.ts), so both read the same record.
const BIN = [join(import.meta.dir, "..", "bin", "herdr-secret"), join(HOME, ".local", "share", "shepherdr", "bin", "herdr-secret"), join(HOME, ".local", "bin", "herdr-secret")].find(existsSync) ?? "herdr-secret";

/** herdr-secret as installed here. */
export const secretBin = () => BIN;

/** One secret's value for the service's own use (a Mac's Screen Sharing password: service/screens.ts), never shown
 *  nor logged, as the voice key is read (core/voice.js voiceKey): this machine's vault when it keeps the secrets (or
 *  none is named yet), else the keeper's, read over herdr-core's link into memory only. Everywhere's value, or this
 *  machine's own. undefined: none is set, or the keeper can't be asked now. */
export async function secretValue(name: string, hub?: Pick<Hub, "call">): Promise<string | undefined> {
  if (!NAME.test(name)) return undefined;
  const p = spawn([BIN, "where", "--json"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  let w: { here?: boolean; set?: boolean; name?: string | null } | null = null;
  try { w = (await p.exited) === 0 ? JSON.parse(out) : null; } catch {}
  const pick = (text: string) => {
    try {
      const all = (JSON.parse(text)?.secrets ?? []) as any[];
      const e = all.find((x) => x?.name === name && x?.scope === "machine" && !x?.machine) ?? all.find((x) => x?.name === name && x?.scope === "everywhere");
      return typeof e?.value === "string" && e.value ? e.value : undefined;
    } catch { return undefined; }
  };
  if (!w || w.here || !w.set || !w.name || !hub) { try { return pick(readFileSync(VAULT, "utf8")); } catch { return undefined; } }
  // the keeper's Everywhere value, as base64 so no output handling can change it
  const script = `import base64, json, os\n${PY}\ntry:\n    v = json.load(open(SHEP(".herdr/vault.json")))\n    e = next((e for e in v.get("secrets", []) if e.get("name") == ${JSON.stringify(name)} and e.get("scope") == "everywhere" and isinstance(e.get("value"), str)), None)\n    print(base64.b64encode(e["value"].encode()).decode() if e else "")\nexcept Exception:\n    print("")\n`;
  const r = await hub.call<{ code: number; stdout: string }>("machine.exec", { on: w.name, argv: ["python3", "-c", script], timeout: 15 }, 20_000).catch(() => null);
  if (!r || r.code !== 0) return undefined;
  const b64 = Buffer.from(r.stdout ?? "", "base64").toString("utf8").trim();
  return b64 ? Buffer.from(b64, "base64").toString("utf8") : undefined;
}

async function run(args: string[], input?: string) {
  const p = spawn([BIN, ...args], { stdin: input === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });
  if (input !== undefined) { (p.stdin as any).write(input); (p.stdin as any).end(); }
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}
async function hc(args: string[]) {
  const p = spawn([process.env.SHEPHERDR_HC || "hc", ...args], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  return p.exited;
}

/** A level as 2.1 names it (all, m:<machine>, p:<machine>:<space>) as herdr-secret's flags, and its words. */
function scope(level: string): { args: string[]; words: string } {
  if (level === "all") return { args: [], words: "Everywhere" };
  // the machine and the space as the window keeps them: another machine's by its name, its space as "<machine>/<id>"
  const ok = (x: string) => /^[\w.-]*$/.test(x);
  const m = /^m:(.*)$/.exec(level);
  if (m && ok(m[1])) return { args: m[1] ? ["--machine", m[1]] : ["--machine"], words: m[1] || "This computer" };
  // a space by its own id (3.0's Space settings: "sp…", another machine's "<machine>/sp…")
  const own = /^(?:([\w.-]+)\/)?(sp[\w-]+)$/.exec(level);
  if (own) return { args: ["--space", level], words: "this space" };
  const p = /^p:([^:]*):([\w.-]+)$/.exec(level);
  if (p && ok(p[1])) return { args: ["--space", p[1] ? `${p[1]}/${p[2]}` : p[2]], words: "this space" };
  throw new Error("Not a place a secret can be kept.");
}

/** A secret ask that closed without the person keeping or declining it (its agent withdrew it with herdr-secret
 *  cancel, its terminal is gone, or its task finished): a quiet "No longer needed" line where it was asked. */
export type SecretEnd = { id: string; address: string; name: string; why: string; at: number; how: string };
type Seen = { id: string; address: string; name: string; why: string; at: number };
export const NO_LONGER = "No longer needed";

export class Secrets {
  /** each ask seen open, by its id, with when it was first seen (its label holds no time) */
  seen = new Map<string, Seen>();
  /** closed asks, newest last, the last 200 */
  ends: SecretEnd[] = [];
  /** asks the person answered here (kept or declined): those close without a line */
  private answered = new Set<string>();
  /** a newly seen ask's moment, not yet written */
  private unsaved = false;

  /** local: this machine's vault, as a count (tests give their own); file: where seen and ended asks are kept */
  constructor(private hub: Hub, private local = localVault, private file: string | null = join(DATA, "secret-asks.json")) {
    try {
      const j = JSON.parse(readFileSync(this.file!, "utf8"));
      for (const x of j.seen ?? []) this.seen.set(x.id, x);
      this.ends = j.ends ?? [];
    } catch {}
  }

  /** Every agent's waiting asks: [{ address, name, why, at }]. */
  asks(): { address: string; name: string; why: string; id: string; at: number }[] {
    return [...this.hub.terminals.values()].filter((t) => t.state === "live")
      .flatMap((t) => asksIn(t.labels).map((a: any) => {
        const id = `secret:${t.address}:${a.name}`;
        // first seen now: its card keeps this moment, its place in the chat (saved with the next change)
        if (!this.seen.has(id)) { this.seen.set(id, { id, address: t.address, name: a.name, why: a.why, at: Date.now() }); this.unsaved = true; }
        return { address: t.address, ...a, id, at: this.seen.get(id)!.at };
      }));
  }

  /** The closed asks of an agent, for its chat's quiet lines. */
  endsOf(address: string) { return this.ends.filter((e) => e.address === address); }

  /** Closes what no longer waits (every few seconds, from main): an ask whose label is gone (withdrawn, or its
   *  terminal ended) ends as "No longer needed", and so does one whose agent's task finished (done: by address),
   *  its label cleared so Needs you, the badge and the feeds let it go. An ask that comes back opens again. */
  async sweep(done: (address: string) => boolean = () => false) {
    // no terminals at all: herdr-core isn't read yet (a start, a reconnect), not every agent gone
    if (!this.hub.terminals.size) return;
    const now = this.asks();
    let changed = false;
    for (const a of now) {
      if (done(a.address)) { await hc(["label", a.address, `${ASK}${a.name}=`]); continue; }
      if (this.ends.some((e) => e.id === a.id)) { this.ends = this.ends.filter((e) => e.id !== a.id); changed = true; }
    }
    const open = new Set(now.filter((a) => !done(a.address)).map((a) => a.id));
    for (const s of [...this.seen.values()]) {
      if (open.has(s.id)) continue;
      this.seen.delete(s.id);
      changed = true;
      if (this.answered.delete(s.id)) continue;
      this.ends = [...this.ends.filter((e) => e.id !== s.id), { ...s, how: NO_LONGER }].slice(-200);
    }
    if (changed || this.unsaved) this.save();
    return changed;
  }

  private save() {
    if (!this.file) return;
    this.unsaved = false;
    try { writeFileSync(`${this.file}.tmp`, JSON.stringify({ seen: [...this.seen.values()], ends: this.ends })); renameSync(`${this.file}.tmp`, this.file); } catch {}
  }

  /** Every kept secret by name: Everywhere's, and each space's (by its id as the snapshot has it). */
  async names(): Promise<{ name: string; at: number; space: string | null }[]> {
    const r = await run(["names", "--json"]);
    try {
      return (JSON.parse(r.out) as any[]).filter((e) => e.scope === "everywhere" || e.scope === "space")
        .map((e) => ({ name: e.name, at: e.at ?? 0, space: e.scope === "space" ? (e.machine ? `${e.machine}/${e.space}` : e.space) : null }));
    } catch { return []; }
  }

  /** Every kept secret with where it is kept, as the window's Settings › Secrets lists them: Everywhere, a machine
   *  (null: this computer) or a space (its id as the snapshot has it). */
  async entries(): Promise<{ name: string; at: number; scope: "everywhere" | "machine" | "space"; machine: string | null; space: string | null }[]> {
    const r = await run(["names", "--json"]);
    try {
      return (JSON.parse(r.out) as any[]).filter((e) => ["everywhere", "machine", "space"].includes(e.scope)).map((e) => ({
        name: e.name, at: e.at ?? 0, scope: e.scope,
        machine: e.scope === "machine" ? e.machine || null : null,
        space: e.scope === "space" ? (e.machine && !String(e.space).includes("/") ? `${e.machine}/${e.space}` : e.space) : null }));
    } catch { return []; }
  }

  /** Keeps a value (or removes it: null), then tells each agent that asked for it there, by name. */
  async keep(level: string, name: string, value: string | null, card?: { address: string }) {
    if (!NAME.test(name)) throw new Error("Name it like an environment variable: GITHUB_TOKEN.");
    const s = scope(level);
    if (value === null) {
      if (card) { this.answered.add(`secret:${card.address}:${name}`); await hc(["label", card.address, `${ASK}${name}=`]); await this.hub.send(card.address, declinedLine(name)); return; }
      const r = await run(["rm", name, ...s.args]);
      if (r.code !== 0) throw new Error(r.err.trim() || "It wasn't removed.");
      return;
    }
    const v = value.replace(/[\r\n]+$/, "");
    if (!v) throw new Error("Type or paste the value first.");
    const r = await run(["set", name, ...s.args], v);
    if (r.code !== 0) throw new Error(r.err.trim().split("\n").pop() || "It wasn't kept.");
    const prefix = `Kept ${name} in vault `;
    const result = r.out.trimEnd();
    const vault = result.startsWith(prefix) ? result.slice(prefix.length) : "on the machine that keeps secrets";
    // as the window's: every agent waiting for this name hears it's kept
    for (const a of this.asks().filter((x) => x.name === name)) {
      this.answered.add(a.id);
      await hc(["label", a.address, `${ASK}${name}=`]);
      await this.hub.send(a.address, keptLine(name, s.words, vault));
    }
  }
}

/** How many secrets this machine's vault has (never a value), and whether it's marked remote. */
function localVault() {
  let count = 0;
  try { count = (JSON.parse(readFileSync(VAULT, "utf8")).secrets ?? []).length; } catch {}
  return { count, remote: existsSync(MARK) };
}

/** Which machine keeps the secrets, as this service sees it: every 15 s (and when the record changes here) it reads
 *  the record here and on each machine it links, keeps the one to believe (core/secrets.js believeRecord), and hands it
 *  on to the machines that have an older one or none. None anywhere: it picks one (core/secrets.js autoKeeper) from how
 *  many secrets each machine's vault has, and names it as automatic. On that machine, it answers other machines'
 *  requests. */
export class SecretsHome {
  me: { id: string; name: string } | null = null;
  record: { id: string; at: number; by?: string; auto?: boolean } | null = null;
  /** the id of the machine serving the web app (shepherdr.host), which the secrets follow unless the person picked one */
  host: string | null = null;
  machines = new Map<string, { id: string | null; state: string }>();
  private busy = false;
  private served = new Set<string>();
  private listeners = new Set<() => void>();
  private said = "";
  // what each machine's vault had when last asked (id -> { count, remote }): a machine off now is still known
  private vaults = new Map<string, { count: number; remote: boolean }>();

  /** local: this machine's vault, as a count (tests give their own) */
  constructor(private hub: Hub, private local = localVault) {}

  on(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  start() {
    this.hub.on((e: any) => {
      if (e.type === "doc" && e.data?.name === SECRETS_DOC) void this.poll();
      if (e.type === "reset" || e.terminal) this.serve();
    });
    setInterval(() => void this.poll(), 15_000);
    // a request seen before this machine became the one that keeps them is answered after
    setInterval(() => this.serve(), 3000);
    return this.poll();
  }

  /** This machine keeps the secrets: the record names it, or none is named and it isn't marked remote. */
  here() { return this.record ? this.record.id === this.me?.id : !existsSync(MARK); }

  /** The machine that keeps them, by its name here (null: this one; "" when it isn't linked from here). */
  name(): string | null {
    if (this.here()) return null;
    if (!this.record) return "";
    for (const [n, m] of this.machines) if (m.id === this.record.id) return n;
    return "";
  }

  /** The machine serving the web app by its name here (null: this one; "" when not linked or none). */
  hostName(): string | null {
    if (!this.host) return "";
    if (this.host === this.me?.id) return null;
    for (const [n, m] of this.machines) if (m.id === this.host) return n;
    return "";
  }

  /** Secrets following Serve from but kept on another machine, seen from the machine serving the web app: true when
   *  it should move them to itself now (the machine that keeps them is on). */
  shouldFollow() {
    const name = this.name();
    return !!followTo(this.record, this.host, this.me?.id) && !!name && this.machines.get(name)?.state === "connected";
  }

  /** For Settings › Secrets: where they're kept, whether it answers, and the machines they can move to. auto: they
   *  follow Serve from (serve: the machine serving the web app, by its name here, null this one). */
  view(choices: MachineRow[] = []) {
    const name = this.name();
    return { here: this.here(), set: !!this.record, auto: !!this.record?.auto, serve: this.record?.auto ? this.hostName() : "", name, reachable: name === null || (!!name && this.machines.get(name)?.state === "connected"),
      choices: [{ name: this.me?.name ?? "", here: true, state: "connected" }, ...[...this.machines].map(([n, m]) => ({ name: n, here: false, state: m.state }))]
        .filter((c) => c.here || !choices.length || choices.some((x) => x.name === c.name)) };
  }

  /** Each other machine's request, once, from here only (herdr-secret serve also refuses a second answer). */
  serve() {
    if (!this.me || !this.here()) return;
    for (const t of this.hub.terminals.values()) {
      const w = t.labels?.["herdr.secret.want"];
      if (!w || !t.address.includes("/") || this.served.has(w)) continue;
      this.served.add(w);
      void spawn([BIN, "serve", t.address], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).exited.catch(() => {});
    }
    if (this.served.size > 200) this.served.clear();
  }

  /** The machine to keep them when nobody named one (core/secrets.js autoKeeper), from each machine's vault: this
   *  one's read here, a linked one's counted there (a count, never a value), one off now as last seen. */
  private async pick(connected: [string, string][]) {
    this.vaults.set(this.me!.id, this.local());
    await Promise.all(connected.map(async ([n, id]) => {
      const r = await this.hub.call<{ code: number; stdout: string }>("machine.exec", { on: n, argv: ["python3", "-c", COUNT_SCRIPT], timeout: 10 }, 15_000).catch(() => null);
      try {
        const v = r?.code === 0 ? JSON.parse(Buffer.from(r.stdout ?? "", "base64").toString("utf8").trim().split("\n").pop() ?? "") : null;
        if (v && Number.isFinite(v.count)) this.vaults.set(id, { count: v.count, remote: !!v.remote });
      } catch {}
    }));
    const ids = [this.me!.id, ...[...this.machines.values()].map((m) => m.id).filter((x): x is string => !!x)];
    return autoKeeper([...new Set(ids)].map((id) => ({ id, count: this.vaults.get(id)?.count ?? null, remote: this.vaults.get(id)?.remote ?? false })), this.host);
  }

  async poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      const st = await this.hub.call<any>("server.status", {});
      this.me = { id: String(st?.core?.id ?? ""), name: String(st?.core?.name ?? "") };
      // Only this core needs the location. Agents can compare paths without opening either vault.
      const layout = await this.hub.call<{ value: unknown; version: number }>("doc.get", { name: VAULT_DOC }, 8000).catch(() => null);
      if (layout && layout.value !== VAULT)
        await this.hub.call("doc.set", { name: VAULT_DOC, value: VAULT, version: layout.version }).catch(() => {});
      const ml = await this.hub.call<{ machines: any[] }>("machine.list", {});
      this.machines = new Map((ml.machines ?? []).filter((m) => !m.temporary).map((m) => [String(m.name), { id: m.id ? String(m.id) : null, state: String(m.state ?? "") }]));
      const get = (on: string | null) => this.hub.call<{ value: any; version: number }>("doc.get", { name: SECRETS_DOC, ...(on ? { on } : {}) }, 8000).catch(() => null);
      this.host = newestHost([(await this.hub.call<{ value: any }>("doc.get", { name: HOST_DOC }, 8000).catch(() => null))?.value])?.id ?? null;
      const mine = await get(null);
      const connected = [...this.machines].filter(([, m]) => m.state === "connected" && m.id);
      const there = await Promise.all(connected.map(async ([n, m]) => ({ n, id: m.id!, doc: await get(n) })));
      let best = believeRecord(mine?.value, Object.fromEntries(there.map((t) => [t.id, t.doc?.value])));
      // nobody named one anywhere seen: pick one, the same way every machine would
      if (!best && this.me.id) {
        const pick = await this.pick(connected.map(([n, m]) => [n, m.id!]));
        if (pick) best = { id: pick.id, at: Date.now(), by: this.me.id, auto: true };
      }
      if (best && JSON.stringify(best) !== JSON.stringify(secretsRecord(mine?.value)))
        await this.hub.call("doc.set", { name: SECRETS_DOC, value: best, version: mine?.version ?? 0 }).catch(() => {});
      // handed on to each machine it links that has an older record, or none
      if (best) for (const t of there) if (t.doc && (secretsRecord(t.doc.value)?.at ?? 0) < best.at)
        await this.hub.call("doc.set", { name: SECRETS_DOC, value: best, version: t.doc.version ?? 0, on: t.n }).catch(() => {});
      this.record = best;
    } catch (err) {
      console.error(`secrets: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
    this.serve();
    const now = JSON.stringify([this.record, this.name(), [...this.machines]]);
    if (now !== this.said) { this.said = now; for (const fn of this.listeners) try { fn(); } catch {} }
  }
}
