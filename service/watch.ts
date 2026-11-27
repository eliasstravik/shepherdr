// What a chat watches on an agent besides its log, for the chats web pages have open (and an open Assistant chat's
// task workers):
// - a CLI stopped on its own start screen (trust, theme, sign in): a card with its choices (core/screens.js).
// - any agent still before its session (a task's, an Assistant, a reviewer) whose chat nobody has open too, so a
//   start screen reaches Needs you, the phone and the watch.
// - a session that is gone ("No conversation found"): show a note and wait for the person to restart it.
import { SignInWatch } from "./sign-in.ts";
import type { Hub } from "./hub.ts";
import * as SC from "../core/screens.js";
import * as CV from "../core/chat-view.js";
import * as AG from "../core/agents.js";

const { ScreenWatch, starting, mayHaveDialog, cliOf, SCREEN } = SC as any;
const { LOST } = CV as any;
const { freshArgv } = AG as any;
type Run = (args: string[]) => Promise<{ code: number; stdout: string; stderr?: string }>;
/** an agent to watch: its address, and its task's id when it is a task's worker */
export type Watched = { addr: string; ref?: string | null };

export class AgentWatch {
  /** the service's own start-screen cards, by agent */
  private own = new Map<string, any[]>();
  screens: any;
  login: SignInWatch;
  private logins = new Set<string>();
  /** a note under an agent's chat ("Earlier session was gone, starting a new one…"), by agent */
  notes = new Map<string, { text: string; at: number }>();
  private tried = new Set<string>();
  private busy = false;

  constructor(private hub: Hub, private hc: Run, private o: { watched: () => Watched[]; changed: () => void;
    loginWatches?: () => string[]; alreadyCarded?: (addr: string) => boolean;
    log?: (addr: string) => { id: string; kind: string; text?: string }[]; }) {
    this.login = new SignInWatch(hub, o.changed, o.log);
    this.screens = new ScreenWatch({ hc: (a: string[]) => this.hc(a), cards: (a: string) => this.own.get(a) ?? [], save: (a: string, list: any[]) => { this.own.set(a, list); this.o.changed(); } }, () => this.o.changed());
  }

  start() { setInterval(() => void this.tick(), 2500); }

  /** An agent's start-screen cards, oldest first. */
  cardsOf(addr: string): any[] {
    return [...(this.own.get(addr) ?? [])].sort((a, b) => a.opened - b.opened);
  }
  openCard(addr: string) { const c = this.cardsOf(addr).filter((x) => x.state === "open").at(-1); return c ?? null; }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const watched = this.o.watched(), seen = new Set(watched.map((w) => w.addr));
      const now = new Set([...seen, ...(this.o.loginWatches?.() ?? []), ...[...this.hub.terminals].filter(([, k]) => starting(k)).map(([addr]) => addr)]);
      const inspecting = new Set([...this.logins, ...now]);
      const login = new Set<string>();
      const addrs = [...inspecting];
      for (let i = 0; i < addrs.length; i += 8) {
        await Promise.all(addrs.slice(i, i + 8).map(async (addr) => {
          const k = now.has(addr) ? this.hub.terminals.get(addr) : undefined;
          if (await this.login.tick(addr, k).catch(() => false)) {
            login.add(addr);
            const open = this.screens.open(addr);
            if (open) this.screens.close(open, SCREEN.changed);
          }
        }));
      }
      this.logins = now;
      const screens = [...this.hub.terminals].filter(([addr, k]) => !login.has(addr) &&
        (starting(k) || this.screens.open(addr) || (now.has(addr) && mayHaveDialog(k))));
      for (let i = 0; i < screens.length; i += 8) {
        await Promise.all(screens.slice(i, i + 8).map(([addr, k]) =>
          this.screens.tick(addr, k, Date.now(), this.o.alreadyCarded?.(addr)).catch(() => undefined)));
      }
      for (const w of watched) {
        if (this.lostCandidate(this.hub.terminals.get(w.addr))) await this.checkLost(w).catch(() => undefined);
      }
      for (const card of this.openCards()) {
        if (!this.hub.terminals.has(card.addr)) await this.screens.tick(card.addr, undefined);
      }
    } finally { this.busy = false; }
  }

  /** The open start-screen card of each agent waiting on one. */
  openCards(): any[] {
    const out = [];
    for (const addr of this.own.keys()) {
      const card = this.openCard(addr);
      if (card) out.push(card);
    }
    return out;
  }
  /** The card with this id, open or not. */
  card(id: string) { for (const addr of this.own.keys()) { const c = this.cardsOf(addr).find((x) => x.id === id); if (c) return c; } return null; }

  // At its shell after a resume (its CLI no longer runs there), or ended with an error: looked at once.
  private lostCandidate(k: any) {
    if (!k || this.tried.has(k.address)) return false;
    const st = typeof k.status === "string" ? k.status : k.status?.state ?? null;
    return (k.state === "live" && !cliOf(k) && !st) || (k.state !== "live" && k.exit_code != null && k.exit_code !== 0);
  }

  private async checkLost(w: Watched) {
    const addr = w.addr;
    this.tried.add(addr);
    let t: any = null;
    try { t = JSON.parse((await this.hc(["get", addr, "--json"])).stdout || "null"); } catch {}
    const kind = cliOf({ agent: (t?.argv ?? []).map((a: string) => String(a).split("/").pop()).find((a: string) => /^(claude|codex)$/.test(a)) });
    const fresh = kind ? freshArgv(kind, t?.argv) : null;
    if (!fresh || !t) return;
    if (t.state !== "live" && (t.exit_code ?? 1) === 0) return;
    const screen = (await this.hc(["read", addr, "--lines", "40"]).catch(() => null))?.stdout ?? "";
    if (!LOST.test(screen.split("\n").slice(-30).join("\n"))) return;
    // A lost session needs the person's decision. Never start a replacement behind their back.
    this.note(addr, "The session could not be found. Restart it to continue.");
  }

  private note(addr: string, text: string) {
    this.notes.set(addr, { text, at: Date.now() });
    this.o.changed();
  }
}
