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

const { DEFAULTS, parseDefaults, current, menuFor, rowFor, argvFor, sessionOf, NAMES, line } = AG as any;
const APP = process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app");

async function run(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

export class Agents {
  constructor(private hub: Hub) {}

  private async defaults(kind: string, machine: string | null) {
    const r = await sh(this.hub, DEFAULTS, ["defaults", kind], machine).catch(() => null);
    return parseDefaults(kind, r?.stdout ?? "");
  }

  /** What an unset role runs, in the window's words ("Opus 5.5 · 1M · High"): each CLI's own defaults here. */
  async defaultLines(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const k of ["claude", "codex"]) {
      const d: any = await this.defaults(k, null).catch(() => null);
      if (d) out[k] = line({ agent: k, model: d.model, effort: d.effort ?? d.per?.[String(d.model ?? "").replace(/\[1m\]$/, "")] ?? null, fast: d.fast }).split(" · ").slice(1).join(" · ");
    }
    return out;
  }

  /** What each CLI offers on a machine (null: here), as the restart sheet lists them. */
  async choices(machine: string | null) {
    const [claude, codex] = await Promise.all([this.defaults("claude", machine), this.defaults("codex", machine)]);
    const dflt: any = { claude, codex };
    return ["claude", "codex"].map((k) => {
      const m = menuFor(k, dflt[k], null);
      return { kind: k, name: NAMES[k], models: m.models.map((x: any) => ({ id: x.id, label: x.name, efforts: x.efforts, ...(x.defaultEffort ? { defaultEffort: x.defaultEffort } : {}) })),
        speeds: m.models.some((x: any) => x.fast) ? ["normal", "fast"] : ["normal"] };
    });
  }

  /** What the restart sheet shows for the agent at addr (log: its reader, for the session and what the log says). */
  async info(addr: string, reader: any) {
    const t: any = this.hub.terminals.get(addr);
    if (!t) throw new Error("That agent isn't here any more.");
    const machine = addr.includes("/") ? addr.split("/")[0] : null;
    const kind = kindOf(t) ?? "claude";
    const [claude, codex] = await Promise.all([this.defaults("claude", machine), this.defaults("codex", machine)]);
    const dflt: any = { claude, codex };
    const c = current(kind, t.foreground?.argv ?? t.argv ?? [], reader?.conv?.meta ?? {}, dflt[kind]);
    const clis = ["claude", "codex"].map((k) => {
      const m = menuFor(k, dflt[k], k === kind ? c.model : null);
      return { kind: k, name: NAMES[k], models: m.models.map((x: any) => ({ id: x.id, label: x.name, efforts: x.efforts, ...(x.defaultEffort ? { defaultEffort: x.defaultEffort } : {}) })),
        speeds: m.models.some((x: any) => x.fast) ? ["normal", "fast"] : ["normal"] };
    });
    const on = { kind, model: rowFor(kind, c) ?? undefined, effort: c.effort ?? undefined, speed: c.fast ? "fast" : "normal" };
    return { role: t.labels?.["herdr.task"] ? "task" : "coordinator", on, onKnown: true, onWords: line(c), want: on, clis, working: t.status?.state === "working" };
  }

  /** Restarts it on the picked CLI, model, effort and speed; resolves with the new agent's address. */
  async restart(addr: string, reader: any, pick: { kind: string; model?: string; effort?: string; speed?: string }) {
    const t: any = this.hub.terminals.get(addr);
    if (!t || t.state !== "live") throw new Error("That agent isn't running.");
    const kind = kindOf(t) ?? "claude";
    const old = { agent: kind, argv: t.foreground?.argv ?? t.argv ?? [], session: sessionOf(kind, reader?.path ?? null) };
    const built = argvFor({ agent: pick.kind, model: pick.model, effort: pick.effort, fast: pick.speed === "fast", perm: current(kind, old.argv, {}, {}).perm }, old);
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
