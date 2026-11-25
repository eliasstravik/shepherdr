// What a chat watches on an agent besides its log, for the chats web pages have open (and an open Assistant chat's
// task workers):
// - a CLI stopped on its own start screen (trust, theme, sign in): a card with its choices (core/screens.js), pressed
//   only on the screen it was drawn from.
// - any agent still before its session (a task's, an Assistant, a reviewer) whose chat nobody has open too, so a
//   folder-trust screen reaches Needs you, the phone and the watch (#1441: an agent sat 80 minutes at one).
// - a session that is gone ("No conversation found"): show a note and wait for the person to restart it.
import type { Hub } from "./hub.ts";
import * as SC from "../core/screens.js";
import * as CV from "../core/chat-view.js";
import * as AG from "../core/agents.js";

const { ScreenWatch, starting, cliOf, readScreen, screenText, pressKeys, SCREEN, trustOf } = SC as any;
const { LOST } = CV as any;
const { freshArgv } = AG as any;
type Run = (args: string[]) => Promise<{ code: number; stdout: string; stderr?: string }>;
/** an agent to watch: its address, and its task's id when it is a task's worker */
export type Watched = { addr: string; ref?: string | null };

export class AgentWatch {
  /** the service's own start-screen cards, by agent */
  private own = new Map<string, any[]>();
  screens: any;
  /** a note under an agent's chat ("Earlier session was gone, starting a new one…"), by agent */
  notes = new Map<string, { text: string; at: number }>();
  private tried = new Set<string>();
  private busy = false;

  constructor(private hub: Hub, private hc: Run, private o: { watched: () => Watched[]; changed: () => void }) {
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
      for (const w of watched) {
        const k: any = this.hub.terminals.get(w.addr);
        if (!k) continue;
        if (starting(k) || this.screens.open(w.addr)) await this.screens.tick(w.addr, k).catch(() => undefined);
        if (this.lostCandidate(k)) await this.checkLost(w).catch(() => undefined);
      }
      // the rest: only their start screens, while they are starting (or a card of theirs is still open)
      for (const [addr, k] of this.hub.terminals as Map<string, any>) {
        if (seen.has(addr) || !(starting(k) || this.screens.open(addr))) continue;
        await this.screens.tick(addr, k).catch(() => undefined);
      }
    } finally { this.busy = false; }
  }

  /** A press on a start screen's choice, through the shared watch (only on the screen its card was drawn from). */
  async press(id: string, choice: number): Promise<string | null> {
    const addr = [...this.own.keys()].find((a) => this.cardsOf(a).some((c) => c.id === id));
    const card = addr ? this.cardsOf(addr).find((c) => c.id === id) : null;
    if (!card || card.state !== "open") return SCREEN.gone;
    // a folder-trust card shows two buttons of its own (0: trust, 1: no): each presses the screen's own choice
    const t = trustOf(card);
    if (t) {
      if (choice !== 0 && choice !== 1) return SCREEN.gone;
      return this.screens.press(card, choice === 0 ? t.yes : t.no);
    }
    return this.screens.press(card, choice);
  }

  /** The open folder-trust card of each agent waiting on one: [{ card, trust }]. */
  trustCards(): { card: any; trust: { yes: number; no: number; folder: string | null } }[] {
    const out: any[] = [];
    for (const addr of this.own.keys()) {
      const card = this.openCard(addr), trust = card ? trustOf(card) : null;
      if (card && trust) out.push({ card, trust });
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
