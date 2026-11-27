import { authNotice, signInMenu, type SignInNeed } from "./sign-in-screen.ts";
import { cliOf, readScreen } from "../core/screens.js";
import type { Hub } from "./hub.ts";
import type { CoreTerminal } from "./hc/protocol.ts";

type LogItem = { id: string; kind: string; text?: string };
export type SignInCard = { id: string; addr: string; opened: number; need: SignInNeed; choices?: { label: string; description?: string }[] };
const same = (a: SignInNeed, b: SignInNeed) => a.cli === b.cli && a.connector === b.connector;

/** Which agents need signing in, read from their screen and log. It only reads: the card it makes tells the person
 *  what to run in the agent's own terminal (no keys sent, no codes pasted, no commands run, no key kept). */
export class SignInWatch {
  private cards = new Map<string, SignInCard>();

  // only reads: nothing here runs a command, presses a key or keeps a key
  constructor(private hub: Hub, private changed: () => void, private log: (addr: string) => LogItem[] = () => []) {}

  card(addr: string) { return this.cards.get(addr); }
  needs() { return [...this.cards.values()]; }

  private drop(addr: string) {
    if (this.cards.delete(addr)) this.changed();
  }

  private lastNotice(addr: string, cli: "claude" | "codex") {
    // Only CLI errors and informational records. Arbitrary chat messages may mention /login.
    const last = this.log(addr).findLast((item) => ["error", "heads", "agent", "user"].includes(item.kind));
    if (!last?.text || !["error", "heads"].includes(last.kind)) return null;
    return authNotice(cli, last.text);
  }

  /** Whether the agent's screen is at a sign-in (so no start-screen card offers taps on it). */
  async tick(addr: string, terminal: CoreTerminal | undefined) {
    const cli = terminal?.state === "live" ? this.cli(terminal) : null;
    if (!cli) { this.drop(addr); return false; }
    const read = await this.hub.call<{ text: string }>("terminal.read", { terminal: addr, lines: 0 }, 5000).catch(() => null);
    if (!read || typeof read.text !== "string") return false;
    const menu = signInMenu(cli, read.text);
    const onScreen = menu ?? authNotice(cli, read.text);
    const need = onScreen ?? this.lastNotice(addr, cli);
    if (!need) { this.drop(addr); return false; }
    const was = this.cards.get(addr);
    const choices = menu ? readScreen(read.text, terminal?.cols).choices : undefined;
    if (!was || !same(was.need, need) || JSON.stringify(was.choices) !== JSON.stringify(choices)) {
      const identity = was && same(was.need, need) ? was : { id: `login-${crypto.randomUUID()}`, addr, opened: Date.now() };
      this.cards.set(addr, { ...identity, need, choices });
      this.changed();
    }
    return !!onScreen;
  }

  private cli(t: CoreTerminal): "claude" | "codex" | null {
    return cliOf(t) ?? (t.labels?.["herdr.agent"] === "claude" || t.labels?.["herdr.agent"] === "codex" ? t.labels["herdr.agent"] : null);
  }
}
