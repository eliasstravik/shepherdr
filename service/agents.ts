// The model menu and restart from the web (2.1's restart sheet): what an agent runs on now and what its CLIs offer
// (core/agents.js, as the window's model menu); another model, level or Fast in place (core/live-switch.js, SHEP-181:
// the CLI's own commands, the same conversation); and a restart for what can't change in place (another CLI or
// permission mode): herdr-task switch for a task's agent, the Assistant's restart.sh for an Assistant, parked behind
// its chat.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Hub } from "./hub.ts";
import { where, writable } from "./paths.ts";
import { sh } from "./model.ts";
import { RESTART } from "./paths.ts";
import * as AG from "../core/agents.js";
import { chatLabel } from "../core/spaces.js";
import { kindOf } from "../core/chat-reader.js";
import { inFront } from "../core/send.js";
import * as LS from "../core/live-switch.js";
import * as SC from "../core/settings.js";
import { spawn } from "./spawn.ts";

const { DEFAULTS, parseDefaults, current, menuFor, rowFor, argvFor, sessionOf, NAMES, line, PICKS_FILE, parsePicks, pickKey, withPin, withRecent, speedOf, speedWordOf } = AG as any;
/** a chat's speed as kept: false, true (Fast) or "ultrafast" */
const fastOf = (f: unknown) => (f === "ultrafast" ? "ultrafast" : !!f);
/** the speeds a CLI's models offer: normal, then fast and ultrafast where one has them (SHEP-258) */
const speedsOf = (models: any[]) => ["normal", ...(models.some((x) => x.fast) ? ["fast"] : []), ...(models.some((x) => x.ultrafast) ? ["ultrafast"] : [])];

async function run(cmd: string[]) {
  const p = spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

export class Agents {
  constructor(private hub: Hub) {}

  /** The person's pinned and recent models (core/agents.js PICKS_FILE), as the window's model menu keeps them here */
  private picksPath = where()["model-picks"];
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

  /** which of the CLIs are installed on a machine (null: it couldn't be asked, so both are offered) */
  private have(machine: string | null): Promise<Set<string> | null> {
    return sh(this.hub, 'for c in "$@"; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done', ["agents", "claude", "codex"], machine)
      .then((r: any) => new Set(String(r?.stdout ?? "").split("\n").filter(Boolean)), () => null);
  }

  /** What the CLIs on a machine offer a new Assistant (core/settings.js choicesFrom: menus, permission defaults and
   *  the first installed CLI's own defaults), as the window's chat reads it before its first message (loadChoice). */
  private async readOffer(machine: string | null) {
    const [claude, codex, have] = await Promise.all([this.defaults("claude", machine), this.defaults("codex", machine), this.have(machine)]);
    const value = (SC as any).choicesFrom({ claude, codex }, { claude: !have || have.has("claude"), codex: !have || have.has("codex") });
    const k = machine ?? "", was = this.offers.get(k)?.value;
    this.offers.set(k, { at: Date.now(), value });
    if (JSON.stringify(was ?? null) !== JSON.stringify(value)) this.onOffer?.();
    return value;
  }
  private offers = new Map<string, { at: number; value: any }>();
  /** told when a machine's offer was read and differs from what was known (the fresh chats' buttons say it again) */
  onOffer: (() => void) | null = null;
  /** a machine's offer as last read, read again in the background at most once a minute; null until first read */
  private offer(machine: string | null) {
    const k = machine ?? "", was = this.offers.get(k);
    if (!was || Date.now() - was.at > 60_000) {
      this.offers.set(k, { at: Date.now(), value: was?.value ?? null });
      void this.readOffer(machine).catch(() => undefined);
    }
    return was?.value ?? null;
  }

  /** An Assistant that hasn't started (SHEP-263): what its first message starts it on, as the window's chat says it
   *  on its model button before then. pick: the choice kept for its space, else Shepherdr settings' Assistant
   *  ({ agent, model, effort, fast, perm }), else null: the CLI's own. sel is that with what the machine offers;
   *  words the button's ("GPT-6.2 Sol · High · Ultrafast"). Until the machine's CLIs were read, the pick as it is. */
  fresh(machine: string | null, pick: any) {
    const offer = this.offer(machine) ?? (SC as any).choicesFrom({}, { claude: true, codex: true });
    const sel = (SC as any).freshSel(pick, offer);
    const m = offer.menus?.[sel.agent]?.models?.find((x: any) => x.id === sel.model) ?? null;
    return { sel, words: (SC as any).modelLabel(offer.menus, sel) as string, label: (m?.name ?? sel.model ?? null) as string | null, effort: (sel.effort ?? m?.defaultEffort ?? null) as string | null };
  }

  /** The model menu for an Assistant that hasn't started: the same menu, its choice what it will start on. */
  async freshMenu(machine: string | null, pick: any) {
    const offer = await this.readOffer(machine);
    const sel = (SC as any).freshSel(pick, offer);
    return { current: { agent: sel.agent, model: sel.model ?? null, effort: sel.effort ?? null, fast: fastOf(sel.fast), perm: sel.perm ?? null }, menus: offer.menus,
      permDefault: offer.permDefault, picks: this.picks(), offline: machine && !(await this.reachable(machine)) ? machine : null, fresh: true };
  }

  /** The window's model menu (mods/chat openPicker → mods/chat-models) for the agent at addr: what it runs on, each
   *  installed CLI's models, levels, Fast and permission modes, the person's pinned and recent ones; offline: the
   *  machine it runs on when that machine can't be reached now (a restart there waits for it) */
  async menu(addr: string, reader: any) {
    const t: any = this.hub.terminals.get(addr);
    if (!t) throw new Error("That agent isn't here any more.");
    const machine = addr.includes("/") ? addr.split("/")[0] : null;
    const kind = kindOf(t) ?? reader?.kind ?? "claude";
    const [claude, codex, have] = await Promise.all([this.defaults("claude", machine), this.defaults("codex", machine), this.have(machine)]);
    const dflts: any = { claude, codex };
    let meta = reader?.conv?.meta ?? {};
    // a resumed conversation's log names the model it ran on before: until this process writes, its arguments say
    if (t.created_ms && meta.at && meta.at < t.created_ms) meta = { used: meta.used, window: meta.window };
    const c = current(kind, t.foreground?.argv ?? t.argv ?? [], meta, dflts[kind]);
    const row = rowFor(kind, c);
    const menus = Object.fromEntries(["claude", "codex"].filter((k) => k === kind || !have || have.has(k)).map((k) => [k, menuFor(k, dflts[k], k === kind ? row : null)]));
    return { current: { agent: kind, model: row, effort: c.effort ?? null, fast: fastOf(c.fast), perm: c.perm ?? null }, menus,
      permDefault: { claude: claude?.mode ?? "manual", codex: "auto" }, picks: this.picks(), offline: machine && !(await this.reachable(machine)) ? machine : null };
  }

  /** whether another machine answers now (hc machine ls: connected) */
  private async reachable(machine: string) {
    const r = await run([process.env.SHEPHERDR_HC || "hc", "machine", "ls", "--json"]).catch(() => null);
    try { return (JSON.parse(r?.out ?? "{}").machines ?? []).some((m: any) => m.name === machine.split("/")[0] && m.state === "connected"); } catch { return true; }
  }

  /** Each CLI's own settings here (Settings › Agents' model menu: core/settings.js choicesFrom). */
  async ownDefaults() {
    const [claude, codex] = await Promise.all([this.defaults("claude", null), this.defaults("codex", null)]);
    return { claude, codex };
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
      // its permission modes, and the one a new agent gets unless picked (the CLI's own: Claude Code's settings mode)
      return { kind: k, name: NAMES[k], models: m.models.map((x: any) => ({ id: x.id, label: x.name, efforts: x.efforts, ...(x.defaultEffort ? { defaultEffort: x.defaultEffort } : {}), ...(x.fast ? { fast: true } : {}), ...(x.ultrafast ? { ultrafast: true } : {}) })),
        speeds: speedsOf(m.models), perms: m.perms ?? [], permDefault: k === "claude" ? dflt.claude?.mode ?? "manual" : "auto" };
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
      return { kind: k, name: NAMES[k], models: m.models.map((x: any) => ({ id: x.id, label: x.name, efforts: x.efforts, ...(x.defaultEffort ? { defaultEffort: x.defaultEffort } : {}), ...(x.fast ? { fast: true } : {}), ...(x.ultrafast ? { ultrafast: true } : {}) })),
        speeds: speedsOf(m.models) };
    });
    const on = { kind, model: rowFor(kind, c) ?? undefined, effort: c.effort ?? undefined, speed: speedWordOf(c.fast) };
    return { role: t.labels?.["herdr.task"] ? "task" : "coordinator", on, onKnown: true, onWords: line(c), want: on, clis, working: t.status?.state === "working" };
  }

  /** The model menu's pick: in place when only the model, level or Fast changes (the same agent, its conversation
   *  on), else a restart. Resolves with { live } or { terminal } (the restarted agent's address). */
  async change(addr: string, reader: any, pick: { kind: string; model?: string; effort?: string; speed?: string; perm?: string }) {
    const t: any = this.hub.terminals.get(addr);
    if (!t || t.state !== "live") throw new Error("That agent isn't running.");
    const machine = addr.includes("/") ? addr.split("/")[0] : null;
    const kind = kindOf(t) ?? reader?.kind ?? "claude";
    const dflt = await this.defaults(kind, machine);
    let meta = reader?.conv?.meta ?? {};
    if (t.created_ms && meta.at && meta.at < t.created_ms) meta = { used: meta.used, window: meta.window };
    const c = current(kind, t.foreground?.argv ?? t.argv ?? [], meta, dflt);
    const from = { agent: kind, model: rowFor(kind, c) ?? "", effort: c.effort ?? "", fast: fastOf(c.fast), perm: c.perm ?? "" };
    const to = { agent: pick.kind, model: pick.model ?? "", effort: pick.effort ?? "", fast: speedOf(pick.speed), perm: pick.perm ?? "" };
    if (!LS.liveOK(from, to)) return { terminal: await this.restart(addr, reader, pick) };
    const state = t.status?.state;
    if (state === "working") throw new Error("It's busy with a turn. Switch once it's done, or stop it first.");
    if (state === "blocked") throw new Error("It's waiting on a question. Answer it, then switch.");
    const hc = (args: string[]) => run([process.env.SHEPHERDR_HC || "hc", ...args]);
    // a send returns once a turn starts or ~5 s pass, and a command starts none: its answer on screen is what counts,
    // so each is waited for only as long as a refusal takes (it comes at once), not for the rest
    const io = {
      send: async (text: string) => {
        const p = this.hub.send(addr, text);
        const r = await Promise.race([p, Bun.sleep(800).then(() => null)]);
        if (r && r.code !== 0) throw new Error("It couldn't be reached to switch.");
      },
      keys: async (...keys: string[]) => { await hc(["keys", addr, ...keys]); },
      screen: async () => (await hc(["read", addr, "--lines", "2000"])).out,
      readFile: async (rel: string) => {
        const r = await sh(this.hub, 'cat "$HOME/$1"', ["read", rel], machine);
        if (r.code !== 0) throw new Error("no file");
        return r.stdout;
      },
      writeFile: async (rel: string, text: string) => {
        await sh(this.hub, 'printf %s "$2" > "$HOME/$1"', ["write", rel, text], machine);
      },
      sleep: (ms: number) => Bun.sleep(ms),
    };
    const names = Object.fromEntries(menuFor(kind, dflt, from.model || null).models.map((m: any) => [m.id, m.name]));
    await LS.switchLive(io, kind, from, to, { names });
    this.known.delete(`${machine ?? ""}|${kind}`);
    this.used(pick);
    return { live: true };
  }

  /** Restarts it on the picked CLI, model, effort and speed; resolves with the new agent's address. */
  async restart(addr: string, reader: any, pick: { kind: string; model?: string; effort?: string; speed?: string; perm?: string }) {
    const t: any = this.hub.terminals.get(addr);
    if (!t) throw new Error("That agent isn't here any more.");
    // a plain shell in front: its agent exited (SHEP-324), so the shell says nothing of how it ran
    const fg = inFront(t) === "shell" ? null : t.foreground;
    const kind = (fg ? kindOf(t) : null) ?? reader?.kind ?? kindOf(t) ?? "claude";
    // (reader.argv: how an agent that ended ran, from its record: revive())
    const old = { agent: kind, argv: fg?.argv ?? reader?.argv ?? t.argv ?? [], session: sessionOf(kind, reader?.path ?? null) };
    const built = argvFor({ agent: pick.kind, model: pick.model, effort: pick.effort, fast: speedOf(pick.speed), perm: pick.perm ?? current(kind, old.argv, {}, {}).perm }, old);
    const pane = t.labels?.["herdr.chat"] ?? "";
    const task = t.labels?.["herdr.task"];
    if (task) {
      const r = await run(["herdr-task", "switch", task, "--folder", fg?.cwd ?? t.cwd, "--argv", JSON.stringify(built.base), "--json"]);
      let out: any = {};
      try { out = JSON.parse(r.out || "{}"); } catch {}
      if (r.code !== 0 || !out.terminal) throw new Error((r.err || r.out).trim() || "herdr-task switch failed");
      if (pane) await run([process.env.SHEPHERDR_HC || "hc", "label", out.terminal, `herdr.chat=${chatLabel(pane)}`, `herdr.chat.origin=${t.labels?.["herdr.chat.origin"] || addr}`]);
      this.used(pick);
      return out.terminal as string;
    }
    const p = spawn(["bash", RESTART, addr, JSON.stringify(built.argv)], { stdout: "pipe", stderr: "pipe", stdin: "ignore",
      env: { ...process.env, HERDR_RESTART_CHAT: pane, ...(built.resume ? { HERDR_RESTART_RESUME: "1" } : {}) } });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const next = out.trim().split("\n").pop();
    if ((await p.exited) !== 0 || !next) throw new Error(err.trim() || "The agent didn't restart.");
    this.used(pick);
    return next;
  }

  /** A space's Assistant that ended (killed, crashed, exited), started again for the person's next message
   *  (SHEP-297), as the Stopped card's Restart does: on the same CLI, model, level, speed and permission mode, resuming
   *  its own conversation when its log is known. A finished terminal has no foreground or status left, so its kind,
   *  session and flags come from its chat's reader, else its herdr.resume record (herdr-task's revive.py), else its
   *  argv. Resolves with the new agent's address. */
  async revive(addr: string, reader: any) {
    const t: any = this.hub.terminals.get(addr);
    if (!t) throw new Error("That agent isn't here any more.");
    let rec: any = null;
    try { rec = JSON.parse(t.labels?.["herdr.resume"] || "null"); } catch {}
    const known = (k: unknown) => (k === "claude" || k === "codex" ? k : null);
    const argv: string[] = Array.isArray(rec?.argv) && rec.argv.length ? rec.argv : t.argv ?? [];
    const named = (t.argv ?? []).join(" ").match(/(?:^|[\s/])(claude|codex)(?=\s|$)/)?.[1];
    const kind = kindOf(t) ?? known(reader?.kind) ?? known(rec?.kind) ?? known(named) ?? "claude";
    const path = reader?.kind === kind && reader?.path ? reader.path : known(rec?.kind) === kind && typeof rec?.log === "string" && rec.log.startsWith("/") ? rec.log : null;
    const machine = addr.includes("/") ? addr.split("/")[0] : null;
    const c = current(kind, argv, reader?.conv?.meta ?? {}, await this.defaults(kind, machine).catch(() => null));
    const pick = { kind, model: rowFor(kind, c) ?? undefined, effort: c.effort ?? undefined, speed: speedWordOf(c.fast), perm: c.perm ?? undefined };
    return this.restart(addr, { kind, path, argv }, pick);
  }

  /** restarted on a model: first among the recent ones */
  private used(pick: { kind: string; model?: string }) {
    if (pick.model) try { this.savePicks(withRecent(this.picks(), pickKey(pick.kind, pick.model))); } catch {}
  }
}
