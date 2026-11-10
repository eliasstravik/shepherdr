// What the window's chat watches on an agent besides its log, done here for the chats web pages have open (and an
// open Assistant chat's task workers, as the window's Assistant chat watches them):
// - a CLI stopped on its own start screen (trust, theme, sign in): a card with its choices (core/screens.js, the
//   window's own reading), pressed only on the screen it was drawn from. The window's cards (shared "chat.screens")
//   show too; a screen both saw shows once.
// - a session that is gone ("No conversation found"): a new one starts with a short handover, once, as the window's
//   chat does (core/chat-view.js lostMessage). The window does it first when it watches the agent: this waits a
//   little, then acts only when the window hasn't (its shared "chat.lost" says so, or a CLI runs there again).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hub } from "./hub.ts";
import { HOME } from "./paths.ts";
import * as SC from "../core/screens.js";
import * as CV from "../core/chat-view.js";
import * as AG from "../core/agents.js";
import { layoutScript } from "./layout-scripts.ts";

const { ScreenWatch, starting, cliOf, readScreen, screenText, pressKeys, SCREEN } = SC as any;
const { LOST, lostMessage, shellWord, WORDS, sessionStarted, sessionFailed } = CV as any;
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

  constructor(private hub: Hub, private hc: Run, private o: { watched: () => Watched[]; windowCards: () => Record<string, any[]>; windowLost: () => Record<string, number>; changed: () => void }) {
    this.screens = new ScreenWatch({ hc: (a: string[]) => this.hc(a), cards: (a: string) => this.own.get(a) ?? [], save: (a: string, list: any[]) => { this.own.set(a, list); this.o.changed(); } }, () => this.o.changed());
  }

  start() { setInterval(() => void this.tick(), 2500); }

  /** An agent's start-screen cards, the window's and these, a screen both saw once (the window's), oldest first. */
  cardsOf(addr: string): any[] {
    const win = this.o.windowCards()?.[addr] ?? [];
    const mine = (this.own.get(addr) ?? []).filter((c) => !win.some((w: any) => w.seen === c.seen && w.state === c.state));
    return [...win.map((c: any) => ({ ...c, window: true })), ...mine].sort((a, b) => a.opened - b.opened);
  }
  openCard(addr: string) { const c = this.cardsOf(addr).filter((x) => x.state === "open").at(-1); return c ?? null; }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const w of this.o.watched()) {
        const k: any = this.hub.terminals.get(w.addr);
        if (!k) continue;
        if (starting(k) || this.screens.open(w.addr)) await this.screens.tick(w.addr, k).catch(() => undefined);
        if (this.lostCandidate(k)) await this.checkLost(w).catch(() => undefined);
      }
    } finally { this.busy = false; }
  }

  /** A press on a start screen's choice: the service's card through the shared watch; the window's checked the same way. */
  async press(id: string, choice: number): Promise<string | null> {
    const addr = [...this.own.keys(), ...Object.keys(this.o.windowCards() ?? {})].find((a) => this.cardsOf(a).some((c) => c.id === id));
    const card = addr ? this.cardsOf(addr).find((c) => c.id === id) : null;
    if (!card || card.state !== "open") return SCREEN.gone;
    if (!card.window) return this.screens.press(card, choice);
    const r = await this.hc(["read", card.addr]);
    const s = r.code === 0 ? readScreen(r.stdout, Infinity) : null;
    if (!s || screenText(r.stdout) !== card.all || JSON.stringify(s.choices) !== JSON.stringify(card.choices)) return SCREEN.changedNothing;
    const k = await this.hc(["keys", card.addr, ...pressKeys(s.at, choice)]);
    return k.code === 0 ? null : SCREEN.failed;
  }

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
    // the window's chat starts it when it watches this agent: give it the time, then only if it hasn't
    const done = () => Date.now() - (this.o.windowLost()?.[addr] ?? 0) < 120_000;
    if (done()) return;
    await Bun.sleep(20_000);
    const now: any = this.hub.terminals.get(addr);
    if (done() || (now?.state === "live" && cliOf(now))) return;
    this.note(addr, WORDS.sessionGone);
    try {
      const named = /^([a-z][a-z0-9]*)-(\d+)(?:-|$)/.exec(t.name ?? "");
      const ref = w.ref ?? (t.labels?.["herdr.task"] && named ? `${named[1].toUpperCase()}-${named[2]}` : null);
      const tplFile = join(HOME, ".config", "herdr-core", "templates", "assistant.md");
      const template = t.labels?.["herdr.role"] === "coordinator" && !addr.includes("/") && existsSync(tplFile) ? readFileSync(tplFile, "utf8") : null;
      const msg = lostMessage({ ref, template });
      if (t.state === "live") {
        // hc send pastes the line into the shell and presses Enter
        const r = await this.hub.send(addr, [...fresh, msg].map(shellWord).join(" "));
        if (r.code !== 0) throw new Error((r.stderr ?? "").trim() || "It didn't go through.");
      } else {
        // herdr-task would resume the same gone session again: its task starts it anew
        if (t.labels?.["herdr.task"]) throw new Error("ask the Assistant to resume its task.");
        const pane = t.labels?.["herdr.chat"];
        const script = layoutScript("restart.sh");
        if (!pane || !script) throw new Error("its chat isn't open in the Herdr window.");
        const p = Bun.spawn(["bash", script, addr, JSON.stringify([...fresh, msg])], { stdout: "pipe", stderr: "pipe", stdin: "ignore",
          env: { ...process.env, HERDR_RESTART_CHAT: pane, HERDR_RESTART_RESUME: "1" } });
        const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
        if ((await p.exited) !== 0 || !out.trim()) throw new Error(err.trim() || "The agent didn't restart.");
      }
      this.note(addr, sessionStarted);
    } catch (e) {
      this.note(addr, sessionFailed((e as Error).message));
    }
    // the window's note goes after 8 s
    setTimeout(() => { this.notes.delete(addr); this.o.changed(); }, 8000);
  }

  private note(addr: string, text: string) {
    this.notes.set(addr, { text, at: Date.now() });
    this.o.changed();
  }
}
