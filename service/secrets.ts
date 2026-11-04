// Secrets from the web: an agent's ask (herdr.secret.ask.<NAME> on its terminal) as 2.1's masked card, a value kept
// in the vault on this machine with herdr-secret set (from stdin: a value is never in a command line, a chat or a log),
// and the agent told by name only (core/secrets.js), as the window's card does. Settings > Secrets lists names only.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Hub } from "./hub.ts";
import { HOME } from "./paths.ts";
import * as SC from "../core/secrets.js";

const { NAME, ASK, asksIn, keptLine, declinedLine } = SC as any;
const APP = process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app");
const BIN = [join(APP, "bin", "herdr-secret"), join(HOME, ".local", "share", "shepherdr", "bin", "herdr-secret"), join(HOME, ".local", "bin", "herdr-secret")].find(existsSync) ?? "herdr-secret";

async function run(args: string[], input?: string) {
  const p = Bun.spawn([BIN, ...args], { stdin: input === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });
  if (input !== undefined) { (p.stdin as any).write(input); (p.stdin as any).end(); }
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}
async function hc(args: string[]) {
  const p = Bun.spawn([process.env.SHEPHERDR_HC || "hc", ...args], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  return p.exited;
}

/** A level as 2.1 names it (all, m:<machine>, p:<machine>:<space>) as herdr-secret's flags, and its words. */
function scope(level: string): { args: string[]; words: string } {
  if (level === "all") return { args: [], words: "Everywhere" };
  // the machine and the space as the window keeps them: another machine's by its name, its space as "<machine>/<id>"
  const ok = (x: string) => /^[\w.-]*$/.test(x);
  const m = /^m:(.*)$/.exec(level);
  if (m && ok(m[1])) return { args: m[1] ? ["--machine", m[1]] : ["--machine"], words: m[1] || "This computer" };
  const p = /^p:([^:]*):([\w.-]+)$/.exec(level);
  if (p && ok(p[1])) return { args: ["--space", p[1] ? `${p[1]}/${p[2]}` : p[2]], words: "this space" };
  throw new Error("Not a place a secret can be kept.");
}

export class Secrets {
  constructor(private hub: Hub) {}

  /** Every agent's waiting asks: [{ address, name, why }]. */
  asks() {
    return [...this.hub.terminals.values()].filter((t) => t.state === "live")
      .flatMap((t) => asksIn(t.labels).map((a: any) => ({ address: t.address, ...a })));
  }

  async names(): Promise<{ name: string; at: number }[]> {
    const r = await run(["names", "--json"]);
    try { return (JSON.parse(r.out) as any[]).filter((e) => e.scope === "everywhere").map((e) => ({ name: e.name, at: e.at ?? 0 })); } catch { return []; }
  }

  /** Keeps a value (or removes it: null), then tells each agent that asked for it there, by name. */
  async keep(level: string, name: string, value: string | null, card?: { address: string }) {
    if (!NAME.test(name)) throw new Error("Name it like an environment variable: GITHUB_TOKEN.");
    const s = scope(level);
    if (value === null) {
      if (card) { await hc(["label", card.address, `${ASK}${name}=`]); await hc(["send", card.address, declinedLine(name)]); return; }
      const r = await run(["rm", name, ...s.args]);
      if (r.code !== 0) throw new Error(r.err.trim() || "It wasn't removed.");
      return;
    }
    const v = value.replace(/[\r\n]+$/, "");
    if (!v) throw new Error("Type or paste the value first.");
    const r = await run(["set", name, ...s.args], v);
    if (r.code !== 0) throw new Error(r.err.trim().split("\n").pop() || "It wasn't kept.");
    // as the window's: every agent waiting for this name hears it's kept
    for (const a of this.asks().filter((x) => x.name === name)) {
      await hc(["label", a.address, `${ASK}${name}=`]);
      await hc(["send", a.address, keptLine(name, s.words)]);
    }
  }
}
