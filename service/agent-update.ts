// Update <agent> (core/agent-update.js): which chats run an older CLI than its newest, and the update itself, on the
// machine the chat runs on: the CLI's own update command, then the chat reopened on the same conversation (the
// Stopped card's Restart: Agents.revive). A failed update leaves the chat as it was, never closed.
import type { Hub } from "./hub.ts";
import { exec, sh } from "./model.ts";
import * as AU from "../core/agent-update.js";
import { AGENT_PATH } from "../core/clean-env.js";
import { kindOf } from "../core/chat-reader.js";

const { UPDATERS, versionOf, newer, channelOf, runningVersion, updateTo, doneWords } = AU as any;
const HOUR = 3_600_000, TEN_MIN = 600_000;

type Seen<T> = { at: number; value: T | null };

export class Updates {
  constructor(private hub: Hub, private revive: (addr: string, reader: any) => Promise<string>) {}
  /** told when a check found something new (the chats say it again) */
  onChange: (() => void) | null = null;

  private installed = new Map<string, Seen<{ version: string | null; channel: string }>>();
  private latest = new Map<string, Seen<string>>();
  /** chats being updated now: no second tap starts another */
  private busy = new Set<string>();

  /** what is installed on a machine, and the channel it updates from */
  private async readInstalled(kind: string, machine: string | null) {
    const u = UPDATERS[kind];
    const r = await sh(this.hub, `${AGENT_PATH} "$1" --version 2>/dev/null; echo; cat "$HOME/.claude/settings.json" 2>/dev/null`, ["update", u.update[0]], machine);
    const [first, ...rest] = r.stdout.split("\n");
    return { version: r.code === 0 ? versionOf(first) : null, channel: channelOf(kind, rest.join("\n")) };
  }

  /** the newest version on npm for a package and tag (the same everywhere, so read here) */
  private async readLatest(pkg: string, tag: string) {
    const r = await fetch(`https://registry.npmjs.org/-/package/${pkg}/dist-tags`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const tags: any = await r.json();
    return typeof tags?.[tag] === "string" ? tags[tag] : typeof tags?.latest === "string" ? tags.latest : null;
  }

  /** a value as last read, read again in the background when older than ttl */
  private kept<T>(m: Map<string, Seen<T>>, key: string, ttl: number, read: () => Promise<T | null>): T | null {
    const was = m.get(key);
    if (!was || Date.now() - was.at > ttl) {
      m.set(key, { at: Date.now(), value: was?.value ?? null });
      void read().then((value) => {
        m.set(key, { at: Date.now(), value });
        if (JSON.stringify(value) !== JSON.stringify(was?.value ?? null)) this.onChange?.();
      }, () => undefined);
    }
    return was?.value ?? null;
  }

  /** The version a chat's agent could update to, or null (unknown yet, already newest, or a CLI with no updater).
   *  Never waits: what isn't known yet is read in the background and the chats are told. */
  available(kind: string, t: any, meta: any, machine: string | null): string | null {
    const u = UPDATERS[kind];
    if (!u || !t || t.state !== "live") return null;
    const inst = this.kept(this.installed, `${machine ?? ""}|${kind}`, TEN_MIN, () => this.readInstalled(kind, machine));
    if (!inst) return null;
    const latest = this.kept(this.latest, `${u.pkg}@${inst.channel}`, HOUR, () => this.readLatest(u.pkg, inst.channel));
    return updateTo(runningVersion(meta, t.created_ms, inst.version), latest);
  }

  /** Update the agent at addr: its CLI's own update on its machine, then it reopens on the same conversation.
   *  Resolves with the new agent's address, the version it runs and how many other chats of it there still run the
   *  old one. A busy agent is asked to finish first; a failed update changes nothing. */
  async update(addr: string, reader: any) {
    const t: any = this.hub.terminals.get(addr);
    if (!t || t.state !== "live") throw new Error("That agent isn't running.");
    const kind = kindOf(t) ?? reader?.kind;
    const u = UPDATERS[kind];
    if (!u) throw new Error("This agent can't be updated from here.");
    const state = t.status?.state;
    if (state === "working") throw new Error("It's busy with a turn. Update once it's done, or stop it first.");
    if (state === "blocked") throw new Error("It's waiting on a question. Answer it, then update.");
    if (this.busy.has(addr)) throw new Error("It's updating already.");
    const machine = addr.includes("/") ? addr.split("/")[0] : null;
    this.busy.add(addr);
    try {
      const before = await this.readInstalled(kind, machine);
      const running = runningVersion(reader?.conv?.meta, t.created_ms, before.version);
      // the CLI's own update (its installer, npm or Homebrew, as it was installed); a few minutes at most
      const r = await exec(this.hub, ["sh", "-c", `${AGENT_PATH} "$@" 2>&1`, "update", ...u.update], machine, 300).catch((e) => ({ code: 1, stdout: String(e?.message ?? e), stderr: "" }));
      const after = await this.readInstalled(kind, machine);
      this.installed.set(`${machine ?? ""}|${kind}`, { at: Date.now(), value: after });
      if (!after.version || !newer(after.version, running)) {
        this.onChange?.();
        const said = (r.stdout || r.stderr).trim().split("\n").filter(Boolean).pop();
        throw new Error(r.code !== 0 ? `${u.name} couldn't update${said ? `: ${said.slice(0, 200)}` : "."} It keeps running as it was.` : `${u.name} found no newer version to install. It keeps running as it was.`);
      }
      // reopened on the same CLI, model, level and conversation (the Stopped card's Restart)
      const next = await this.revive(addr, reader);
      const others = [...this.hub.terminals.values()].filter((x: any) => x.address !== addr && x.address !== next && x.state === "live" && kindOf(x) === kind
        && (x.address.includes("/") ? x.address.split("/")[0] : null) === machine).length;
      this.onChange?.();
      return { terminal: next, version: after.version, words: doneWords(u.name, after.version, others) };
    } finally {
      this.busy.delete(addr);
    }
  }
}
