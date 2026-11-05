// Shepherdr's background work that doesn't hang on what a window shows, run here once for every client:
// - the task tick (herdr-task tick: queued tasks start, merged ones are done) every 15 s and 2 s after a task's agent
//   changes, and about once a minute the automations scheduler's check, here and on other machines with tasks: every
//   service ticks its own machine; the machine that serves the web app (Serve from, service/host.ts tickOn) ticks the
//   others that have no service of their own (and those running an Assistant: their tick brings agents back after a
//   crash), and another service does that only while the host can't be reached (herdr-task's own lock keeps two ticks
//   of one machine from ever running at once);
// - a chat open on a web page: the question hook's flag (data/chat-asks/open/<terminal>), so its cards come to the page
//   (another machine's agent: its flag there, through herdr-core).
// The window sees this service running (GET /api/health: jobs) and leaves the same work to it (lib/service.js), and
// takes it back when the service is gone: one runs it at a time. While the installed window can't do that yet (a
// 3.0 layout), the service runs none of it.
import { existsSync, readdirSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Hub } from "./hub.ts";
import type { Host } from "./host.ts";
import { HOME } from "./paths.ts";

const APP = process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app");
const ASKS = join(APP, "data", "chat-asks", "open");

/** A helper by its installed path (systemd's PATH has no ~/.local/bin). */
function tool(name: string, inApp: string) {
  for (const p of [join(APP, inApp), join(HOME, ".local", "bin", name)]) if (existsSync(p)) return p;
  return name;
}

async function run(cmd: string[]) {
  try {
    const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
    return (await p.exited) === 0;
  } catch {
    return false;
  }
}

/** Whether the window installed here leaves this work to the service: no Shepherdr window at all, or one whose tab bar
 *  asks first. */
export function windowLeavesIt() {
  if (process.env.SHEPHERDR_JOBS === "off") return false;
  if (process.env.SHEPHERDR_JOBS === "on") return true;
  // no Shepherdr layout installed here (no Herdr at all, or Herdr's own mods only): no window here does it
  if (!existsSync(join(APP, "data", "shepherdr", "installed.json"))) return true;
  return existsSync(join(APP, "mods", "tabs-tasks", "service.js"));
}

/** Other machines with a live Assistant or an agent that comes back after a crash (label herdr.resume). */
export function agentMachines(terminals: Iterable<any>): string[] {
  const out = new Set<string>();
  for (const k of terminals) {
    const at = String(k?.address ?? "").indexOf("/");
    if (at > 0 && k.state === "live" && (k.labels?.["herdr.role"] === "coordinator" || k.labels?.["herdr.resume"])) out.add(k.address.slice(0, at));
  }
  return [...out];
}

export class Jobs {
  readonly on = windowLeavesIt();
  private ticking = false;
  private rounds = 0;
  private soon: ReturnType<typeof setTimeout> | null = null;
  private seen = "";
  /** terminals a web page shows now (service/live.ts tells) */
  watched: () => string[] = () => [];
  private flagged = new Map<string, number>();

  constructor(private hub: Hub, private host: Host | null = null) {}

  start() {
    if (!this.on) { console.log("background work: left to the window (its layout predates the service)"); return; }
    console.log("background work: here");
    setInterval(() => void this.tick(), 15_000);
    void this.tick();
    this.hub.on((e) => {
      if (e.type === "reset" || ("terminal" in e && e.terminal)) this.onChange();
    });
    setInterval(() => this.flags(), 4000);
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const cli = tool("herdr-task", "mods/tasks/bin/herdr-task");
      const ensure = this.rounds++ % 4 === 0;
      await run([cli, "tick", "--json"]);
      if (ensure) await run([cli, "scheduler", "--ensure", "--json"]);
      let remote: string[] = [];
      if (this.host) remote = this.host.tickOn();
      else try { remote = readdirSync(join(HOME, ".herdr", "tasks", ".remote")).filter((x) => /^[\w.-]+$/.test(x) && !x.endsWith(".secret")); } catch {}
      // and those running an Assistant with no tasks yet: their tick brings it back after a crash (herdr-task revive.py)
      if (!this.host || this.host.serving() || !this.host.reachable()) {
        const own = this.host?.participants() ?? new Set<string>();
        remote = [...new Set([...remote, ...agentMachines(this.hub.terminals.values())])].filter((m) => !own.has(m)
          && (!this.host || this.host.machines.get(m)?.state === "connected"));
      }
      for (const m of remote) {
        await run([cli, "--on", m, "tick", "--json"]);
        if (ensure) await run([cli, "--on", m, "scheduler", "--ensure", "--json"]);
      }
    } finally {
      this.ticking = false;
    }
  }

  /** A task's agent that finishes, stops or ends: a tick two seconds later (as the window's tickOnChange). */
  private onChange() {
    const now = [...this.hub.terminals.values()].filter((k) => k.labels?.["herdr.task"])
      .map((k) => `${k.address}:${k.state}:${typeof k.status === "object" ? k.status?.state : k.status}`).join(",");
    if (now === this.seen) return;
    const first = !this.seen;
    this.seen = now;
    if (first || this.soon) return;
    this.soon = setTimeout(() => { this.soon = null; void this.tick(); }, 2000);
  }

  /** The hook asks a chat only while its flag is fresh (ask-hook.sh: 15 s): a page showing a local Claude agent's chat
   *  keeps it so. */
  private flags() {
    const now = new Date();
    for (const a of new Set(this.watched())) {
      const t: any = this.hub.terminals.get(a);
      if (!t || !/^([\w.-]+\/)?[\w.-]+$/.test(a) || t.state !== "live") continue;
      if ((t.status?.app ?? t.foreground?.name) !== "claude" && t.status?.app !== "claude-code") continue;
      if (a.includes("/")) {
        // another machine's agent: its flag there, every 8 s at most
        const [m, id] = a.split("/");
        if (Date.now() - (this.flagged.get(a) ?? 0) < 8000) continue;
        this.flagged.set(a, Date.now());
        void this.hub.call("machine.exec", { on: m, argv: ["sh", "-c", 'd="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/data/chat-asks/open"; mkdir -p "$d" && touch "$d/$1"', "sh", id], timeout: 10 }, 15_000).catch(() => {});
        continue;
      }
      try {
        mkdirSync(ASKS, { recursive: true });
        const f = join(ASKS, a);
        if (existsSync(f)) utimesSync(f, now, now); else writeFileSync(f, "");
      } catch {}
    }
  }
}
