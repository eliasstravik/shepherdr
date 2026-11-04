// The model menu and restart from the web (2.1's restart sheet): what an agent runs on now and what its CLIs offer
// (core/agents.js, as the window's model menu), and restarting it on another model, effort or speed the window's way:
// herdr-task switch for a task's agent, the Assistant's restart.sh for an Assistant, parked behind its chat.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Hub } from "./hub.ts";
import { HOME } from "./paths.ts";
import { sh } from "./model.ts";
import * as AG from "../core/agents.js";
import { kindOf } from "../core/chat-reader.js";

const { DEFAULTS, defaultsArgs, parseDefaults, current, menuFor, rowFor, argvFor, sessionOf, NAMES, line, AGENTS, installedOf, permDefault } = AG as any;
const APP = process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app");

async function run(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

export class Agents {
  constructor(private hub: Hub) {}

  private async defaults(kind: string, machine: string | null) {
    const r = await sh(this.hub, DEFAULTS, defaultsArgs(kind), machine).catch(() => null);
    return parseDefaults(kind, r?.stdout ?? "");
  }

  /** Every kind's own settings on a machine (lib/kinds.json's kinds: Claude Code's and Codex's settings; for the others
   *  whether the command is there), by kind. */
  private async allDefaults(machine: string | null): Promise<Record<string, any>> {
    const each = await Promise.all((AGENTS as string[]).map((k) => this.defaults(k, machine)));
    return Object.fromEntries((AGENTS as string[]).map((k, i) => [k, each[i]]));
  }

  /** A CLI's own settings on a machine as last read (the chat's model button reads them on every change, as the
   *  window's chat keeps them: this.dflt), read again in the background at most once a minute. */
  private known = new Map<string, { at: number; value: any }>();
  cached(kind: string, machine: string | null) {
    const k = `${machine ?? ""}|${kind}`, was = this.known.get(k);
    if (!was || Date.now() - was.at > 60_000) {
      this.known.set(k, { at: Date.now(), value: was?.value ?? null });
      void this.defaults(kind, machine).then((value) => this.known.set(k, { at: Date.now(), value }), () => undefined);
    }
    return was?.value ?? null;
  }

  /** The window's model menu (mods/chat openPicker → mods/chat-models) for the agent at addr: what it runs on, each
   *  installed CLI's models, levels, Fast and permission modes; remote: why it can't restart from here */
  async menu(addr: string, reader: any) {
    const t: any = this.hub.terminals.get(addr);
    if (!t) throw new Error("That agent isn't here any more.");
    const machine = addr.includes("/") ? addr.split("/")[0] : null;
    const kind = kindOf(t) ?? reader?.kind ?? "claude";
    const [dflts, have] = await Promise.all([this.allDefaults(machine),
      sh(this.hub, 'for c in "$@"; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done', ["agents", "claude", "codex"], machine).then((r: any) => new Set(String(r?.stdout ?? "").split("\n").filter(Boolean)), () => null)]);
    const { claude } = dflts;
    // installed: Claude Code and Codex when found on PATH (have), the other kinds as their defaults say
    const installed: Record<string, boolean> = installedOf(null, dflts);
    if (have) for (const k of ["claude", "codex"]) installed[k] = have.has(k);
    let meta = reader?.conv?.meta ?? {};
    // a resumed conversation's log names the model it ran on before: until this process writes, its arguments say
    if (t.created_ms && meta.at && meta.at < t.created_ms) meta = { used: meta.used, window: meta.window };
    const c = current(kind, t.foreground?.argv ?? t.argv ?? [], meta, dflts[kind]);
    const row = rowFor(kind, c);
    const menus = Object.fromEntries((AGENTS as string[]).filter((k) => k === kind || installed[k]).map((k) => [k, menuFor(k, dflts[k], k === kind ? row : null)]));
    return { current: { agent: kind, model: row, effort: c.effort ?? null, fast: !!c.fast, perm: c.perm ?? null }, menus,
      permDefault: Object.fromEntries((AGENTS as string[]).map((k) => [k, permDefault(k, dflts[k])])), remote: machine && !t.labels?.["herdr.task"] ? "This computer only" : null };
  }

  /** Each CLI's own settings here (Settings › Agents' model menu: core/settings.js choicesFrom). */
  async ownDefaults() {
    return this.allDefaults(null);
  }

  /** What an unset role runs, in the window's words ("Opus 5.5 · 1M · High"): each CLI's own defaults here. */
  async defaultLines(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const k of AGENTS as string[]) {
      const d: any = await this.defaults(k, null).catch(() => null);
      if (d) out[k] = line({ agent: k, model: d.model, effort: d.effort ?? d.per?.[String(d.model ?? "").replace(/\[1m\]$/, "")] ?? null, fast: d.fast }).split(" · ").slice(1).join(" · ");
    }
    return out;
  }

  /** What each CLI offers on a machine (null: here), as the restart sheet lists them. */
  async choices(machine: string | null) {
    const dflt: any = await this.allDefaults(machine);
    // Claude Code and Codex always (as before); the other kinds when their command is on that machine
    const installed = { ...installedOf(null, dflt), claude: true, codex: true };
    return (AGENTS as string[]).filter((k) => installed[k]).map((k) => {
      const m = menuFor(k, dflt[k], null);
      // its permission modes, and the one a new agent gets unless picked (the CLI's own: Claude Code's settings mode)
      return { kind: k, name: NAMES[k], models: m.models.map((x: any) => ({ id: x.id, label: x.name, efforts: x.efforts, ...(x.defaultEffort ? { defaultEffort: x.defaultEffort } : {}) })),
        speeds: m.models.some((x: any) => x.fast) ? ["normal", "fast"] : ["normal"], perms: m.perms ?? [], permDefault: permDefault(k, dflt[k]) };
    });
  }

  /** What the restart sheet shows for the agent at addr (log: its reader, for the session and what the log says). */
  async info(addr: string, reader: any) {
    const t: any = this.hub.terminals.get(addr);
    if (!t) throw new Error("That agent isn't here any more.");
    const machine = addr.includes("/") ? addr.split("/")[0] : null;
    const kind = kindOf(t) ?? "claude";
    const dflt: any = await this.allDefaults(machine);
    // Claude Code and Codex always (as before), the one running, and the other kinds whose command is on that machine
    const installed = { ...installedOf(null, dflt), claude: true, codex: true };
    const c = current(kind, t.foreground?.argv ?? t.argv ?? [], reader?.conv?.meta ?? {}, dflt[kind]);
    const clis = (AGENTS as string[]).filter((k) => k === kind || installed[k]).map((k) => {
      const m = menuFor(k, dflt[k], k === kind ? c.model : null);
      return { kind: k, name: NAMES[k], models: m.models.map((x: any) => ({ id: x.id, label: x.name, efforts: x.efforts, ...(x.defaultEffort ? { defaultEffort: x.defaultEffort } : {}) })),
        speeds: m.models.some((x: any) => x.fast) ? ["normal", "fast"] : ["normal"] };
    });
    const on = { kind, model: rowFor(kind, c) ?? undefined, effort: c.effort ?? undefined, speed: c.fast ? "fast" : "normal" };
    return { role: t.labels?.["herdr.task"] ? "task" : "coordinator", on, onKnown: true, onWords: line(c), want: on, clis, working: t.status?.state === "working" };
  }

  /** Restarts it on the picked CLI, model, effort and speed; resolves with the new agent's address. */
  async restart(addr: string, reader: any, pick: { kind: string; model?: string; effort?: string; speed?: string; perm?: string }) {
    const t: any = this.hub.terminals.get(addr);
    if (!t || t.state !== "live") throw new Error("That agent isn't running.");
    const kind = kindOf(t) ?? "claude";
    const old = { agent: kind, argv: t.foreground?.argv ?? t.argv ?? [], session: sessionOf(kind, reader?.path ?? null) };
    const built = argvFor({ agent: pick.kind, model: pick.model, effort: pick.effort, fast: pick.speed === "fast", perm: pick.perm ?? current(kind, old.argv, {}, {}).perm }, old);
    const pane = t.labels?.["herdr.chat"] ?? "";
    const task = t.labels?.["herdr.task"];
    if (task) {
      const r = await run(["herdr-task", "switch", task, "--folder", t.foreground?.cwd ?? t.cwd, "--argv", JSON.stringify(built.base), "--json"]);
      let out: any = {};
      try { out = JSON.parse(r.out || "{}"); } catch {}
      if (r.code !== 0 || !out.terminal) throw new Error((r.err || r.out).trim() || "herdr-task switch failed");
      if (pane) await run(["hc", "label", out.terminal, `herdr.chat=${pane}`, `herdr.chat.origin=${t.labels?.["herdr.chat.origin"] || addr}`]);
      await run(["herdr-app", "do", "terminal.park", "--terminal", out.terminal]);
      return out.terminal as string;
    }
    const script = join(APP, "mods", "coordinator", "restart.sh");
    if (!existsSync(script)) throw new Error("Restarting an Assistant needs Shepherdr's window layout installed.");
    const p = Bun.spawn(["bash", script, addr, JSON.stringify(built.argv)], { stdout: "pipe", stderr: "pipe", stdin: "ignore",
      env: { ...process.env, HERDR_RESTART_CHAT: pane, ...(built.resume ? { HERDR_RESTART_RESUME: "1" } : {}) } });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const next = out.trim().split("\n").pop();
    if ((await p.exited) !== 0 || !next) throw new Error(err.trim() || "The agent didn't restart.");
    return next;
  }
}
