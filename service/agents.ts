// The model menu and restart from the web (2.1's restart sheet): what an agent runs on now and what its CLIs offer
// (core/agents.js, as the window's model menu), and restarting it on another model, effort or speed the window's way:
// herdr-task switch for a task's agent, the Assistant's restart.sh for an Assistant, parked behind its chat.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";
import type { Hub } from "./hub.ts";
import { HOME, appHome, writable } from "./paths.ts";
import { sh } from "./model.ts";
import * as AG from "../core/agents.js";
import { kindOf } from "../core/chat-reader.js";

const { DEFAULTS, parseDefaults, current, menuFor, rowFor, argvFor, sessionOf, NAMES, line, PICKS_FILE, parsePicks, pickKey, withPin, withRecent } = AG as any;

async function run(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

export class Agents {
  constructor(private hub: Hub) {}

  /** The person's pinned and recent models (core/agents.js PICKS_FILE), as the window's model menu keeps them here */
  private picksPath = join(HOME, PICKS_FILE);
  picks() {
    try { return parsePicks(readFileSync(this.picksPath, "utf8")); } catch { return parsePicks(""); }
  }
  private savePicks(p: unknown) {
    mkdirSync(dirname(writable(this.picksPath)), { recursive: true });
    writeFileSync(this.picksPath, JSON.stringify(p, null, 2));
  }
  /** the star on a model's row: pinned to the top of its agent's list, or not any more */
  pin(agent: string, model: string) {
    const p = withPin(this.picks(), pickKey(agent, model));
    this.savePicks(p);
    return p;
  }

  private async defaults(kind: string, machine: string | null) {
    const r = await sh(this.hub, DEFAULTS, ["defaults", kind], machine).catch(() => null);
    return parseDefaults(kind, r?.stdout ?? "");
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
   *  installed CLI's models, levels, Fast and permission modes, the person's pinned and recent ones; offline: the
   *  machine it runs on when that machine can't be reached now (a restart there waits for it) */
  async menu(addr: string, reader: any) {
    const t: any = this.hub.terminals.get(addr);
    if (!t) throw new Error("That agent isn't here any more.");
    const machine = addr.includes("/") ? addr.split("/")[0] : null;
    const kind = kindOf(t) ?? reader?.kind ?? "claude";
    const [claude, codex, cursor, have] = await Promise.all([this.defaults("claude", machine), this.defaults("codex", machine), this.defaults("cursor", machine),
      sh(this.hub, 'for c in "$@"; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done', ["agents", "claude", "codex", "cursor-agent"], machine).then((r: any) => new Set(String(r?.stdout ?? "").split("\n").filter(Boolean)), () => null)]);
    const dflts: any = { claude, codex, cursor };
    let meta = reader?.conv?.meta ?? {};
    // a resumed conversation's log names the model it ran on before: until this process writes, its arguments say
    if (t.created_ms && meta.at && meta.at < t.created_ms) meta = { used: meta.used, window: meta.window };
    const c = current(kind, t.foreground?.argv ?? t.argv ?? [], meta, dflts[kind]);
    const row = rowFor(kind, c);
    const menus = Object.fromEntries(["claude", "codex", "cursor"].filter((k) => k === kind || !have || have.has(k === "cursor" ? "cursor-agent" : k)).map((k) => [k, menuFor(k, dflts[k], k === kind ? row : null)]));
    return { current: { agent: kind, model: row, effort: c.effort ?? null, fast: !!c.fast, perm: c.perm ?? null }, menus,
      permDefault: { claude: claude?.mode ?? "manual", codex: "auto", cursor: "auto" }, picks: this.picks(), offline: machine && !(await this.reachable(machine)) ? machine : null };
  }

  /** whether another machine answers now (hc machine ls: connected) */
  private async reachable(machine: string) {
    const r = await run([process.env.SHEPHERDR_HC || "hc", "machine", "ls", "--json"]).catch(() => null);
    try { return (JSON.parse(r?.out ?? "{}").machines ?? []).some((m: any) => m.name === machine.split("/")[0] && m.state === "connected"); } catch { return true; }
  }

  /** Each CLI's own settings here (Settings › Agents' model menu: core/settings.js choicesFrom). */
  async ownDefaults() {
    const [claude, codex, cursor] = await Promise.all([this.defaults("claude", null), this.defaults("codex", null), this.defaults("cursor", null)]);
    return { claude, codex, cursor };
  }

  /** What an unset role runs, in the window's words ("Opus 5.5 · 1M · High"): each CLI's own defaults here. */
  async defaultLines(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const k of ["claude", "codex", "cursor"]) {
      const d: any = await this.defaults(k, null).catch(() => null);
      if (d) out[k] = line({ agent: k, model: d.model, effort: d.effort ?? d.per?.[String(d.model ?? "").replace(/\[1m\]$/, "")] ?? null, fast: d.fast }).split(" · ").slice(1).join(" · ");
    }
    return out;
  }

  /** What each CLI offers on a machine (null: here), as the restart sheet lists them. */
  async choices(machine: string | null) {
    const [claude, codex, cursor] = await Promise.all([this.defaults("claude", machine), this.defaults("codex", machine), this.defaults("cursor", machine)]);
    const dflt: any = { claude, codex, cursor };
    return ["claude", "codex", "cursor"].filter((k) => k !== "cursor" || cursor.installed).map((k) => {
      const m = menuFor(k, dflt[k], null);
      // its permission modes, and the one a new agent gets unless picked (the CLI's own: Claude Code's settings mode)
      return { kind: k, name: NAMES[k], models: m.models.map((x: any) => ({ id: x.id, label: x.name, efforts: x.efforts, ...(x.defaultEffort ? { defaultEffort: x.defaultEffort } : {}) })),
        speeds: m.models.some((x: any) => x.fast) ? ["normal", "fast"] : ["normal"], perms: m.perms ?? [], permDefault: k === "claude" ? dflt.claude?.mode ?? "manual" : "auto" };
    });
  }

  /** What the restart sheet shows for the agent at addr (log: its reader, for the session and what the log says). */
  async info(addr: string, reader: any) {
    const t: any = this.hub.terminals.get(addr);
    if (!t) throw new Error("That agent isn't here any more.");
    const machine = addr.includes("/") ? addr.split("/")[0] : null;
    const kind = kindOf(t) ?? "claude";
    const [claude, codex, cursor] = await Promise.all([this.defaults("claude", machine), this.defaults("codex", machine), this.defaults("cursor", machine)]);
    const dflt: any = { claude, codex, cursor };
    const c = current(kind, t.foreground?.argv ?? t.argv ?? [], reader?.conv?.meta ?? {}, dflt[kind]);
    const clis = ["claude", "codex", "cursor"].filter((k) => k === kind || k !== "cursor" || cursor.installed).map((k) => {
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
    const built = argvFor({ agent: pick.kind, model: pick.model, effort: pick.effort, fast: pick.speed === "fast", perm: pick.perm ?? (pick.kind === kind ? current(kind, old.argv, {}, {}).perm : pick.kind === "claude" ? "manual" : "auto") }, old);
    const pane = t.labels?.["herdr.chat"] ?? "";
    const task = t.labels?.["herdr.task"];
    if (task) {
      const r = await run(["herdr-task", "switch", task, "--folder", t.foreground?.cwd ?? t.cwd, "--argv", JSON.stringify(built.base), "--json"]);
      let out: any = {};
      try { out = JSON.parse(r.out || "{}"); } catch {}
      if (r.code !== 0 || !out.terminal) throw new Error((r.err || r.out).trim() || "herdr-task switch failed");
      if (pane) await run(["hc", "label", out.terminal, `herdr.chat=${pane}`, `herdr.chat.origin=${t.labels?.["herdr.chat.origin"] || addr}`]);
      await run(["herdr-app", "do", "terminal.park", "--terminal", out.terminal]);
      this.used(pick);
      return out.terminal as string;
    }
    const script = join(appHome(), "mods", "coordinator", "restart.sh");
    if (!existsSync(script)) throw new Error("Restarting an Assistant needs BossGoat's window layout installed.");
    const p = Bun.spawn(["bash", script, addr, JSON.stringify(built.argv)], { stdout: "pipe", stderr: "pipe", stdin: "ignore",
      env: { ...process.env, HERDR_RESTART_CHAT: pane, ...(built.resume ? { HERDR_RESTART_RESUME: "1" } : {}) } });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const next = out.trim().split("\n").pop();
    if ((await p.exited) !== 0 || !next) throw new Error(err.trim() || "The agent didn't restart.");
    this.used(pick);
    return next;
  }

  /** restarted on a model: first among the recent ones */
  private used(pick: { kind: string; model?: string }) {
    if (pick.model) try { this.savePicks(withRecent(this.picks(), pickKey(pick.kind, pick.model))); } catch {}
  }
}
