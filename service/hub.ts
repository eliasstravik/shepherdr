// The service's one link to herdr-core (hc connect): calls, plus the live event stream. When the core goes away
// the link comes back by itself (0.5 s, 1, 2, then every 5 s) and everyone listening hears "reset".
import { CoreClient } from "./hc/client.ts";
import type { CoreNotification, CoreTerminal } from "./hc/protocol.ts";

type Listener = (e: { type: string; terminal?: string; data?: any } | { type: "reset" }) => void;

export class Hub {
  private client: CoreClient | null = null;
  private waiting: Promise<CoreClient> | null = null;
  private listeners = new Set<Listener>();
  terminals = new Map<string, CoreTerminal>();
  up = false;

  constructor(private binary = process.env.SHEPHERDR_HC || "hc") {}

  on(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  private emit(e: Parameters<Listener>[0]) { for (const fn of this.listeners) try { fn(e); } catch (err) { console.error(err); } }

  /** The connected client, connecting (and subscribing) first when needed. */
  core(): Promise<CoreClient> {
    if (this.client) return Promise.resolve(this.client);
    if (!this.waiting) this.waiting = this.connect().finally(() => { this.waiting = null; });
    return this.waiting;
  }

  async call<T = any>(method: string, params: Record<string, unknown> = {}, timeout?: number): Promise<T> {
    return (await this.core()).call<T>(method, params, timeout);
  }

  /** The person's words into a terminal, as hc send pastes them, but with no caller: hc send names its parent process
   *  as the sender, and another machine's core wraps a message from one in <hc from="<core>/ppid:…"> ("Another agent").
   *  Sent with none, it lands as plain input from the person, here and on any machine. -> hc send's own result shape:
   *  code 0, else its error ({ error: { kind, message } }) on stderr, for core/send.js's refusal(). */
  async send(terminal: string, text: string): Promise<{ code: number; stdout: string; stderr: string }> {
    const fail = (kind: string | null, message: string) => ({ code: 1, stdout: "", stderr: JSON.stringify({ error: { kind, message } }) });
    if (!this.client) return fail("unavailable", "herdr-core isn't answering here.");
    // it waits for a person to pause typing there (~3 s), so longer than a plain call
    try { return { code: 0, stdout: JSON.stringify(await this.call("terminal.send", { terminal, text }, 120_000)), stderr: "" }; }
    catch (e: any) { return fail(e?.kind ?? null, e?.message ?? String(e)); }
  }

  private async connect(): Promise<CoreClient> {
    let delay = 500;
    for (;;) {
      try {
        const c = await CoreClient.endpoint({ binary: this.binary });
        const snap = await c.subscribe((n) => this.event(n));
        this.terminals = new Map(snap.terminals.map((t) => [t.address, t]));
        c.onDisconnect(() => { if (this.client === c) { this.client = null; this.up = false; this.emit({ type: "reset" }); void this.core(); } });
        this.client = c;
        this.up = true;
        this.emit({ type: "reset" });
        return c;
      } catch (err) {
        console.error(`herdr-core: ${(err as Error).message}`);
        await Bun.sleep(delay);
        delay = Math.min(delay * 2, 5000);
      }
    }
  }

  // As 2.1's session.ts: one combined sequence, and a missed notification carries the whole list again.
  private event(n: CoreNotification) {
    const p = n.params;
    if (n.method === "missed") {
      if (Array.isArray(p.terminals)) this.terminals = new Map(p.terminals.map((t) => [t.address, t]));
      this.emit({ type: "reset" });
      return;
    }
    if (n.method !== "event" || !p.type) return;
    const t = p.terminal, data: any = p.data ?? {};
    const old = t ? this.terminals.get(t) : undefined;
    if (t) switch (p.type) {
      case "created": case "restarted": this.terminals.set(t, data); break;
      case "removed": this.terminals.delete(t); break;
      case "labels":
        if (data.record) this.terminals.set(t, data.record);
        else if (old) this.terminals.set(t, { ...old, labels: data.labels });
        break;
      case "finished": if (old) this.terminals.set(t, { ...old, ...data, state: "finished" }); break;
      case "lost": if (old) this.terminals.set(t, { ...old, ...data, pid: null }); break;
      case "turn": if (old) this.terminals.set(t, { ...old, turn: data.turn }); break;
      case "status": case "size": case "title": case "keep": if (old) this.terminals.set(t, { ...old, ...data }); break;
      // the program in front changed (a relaunched agent, a shell's command): its log is found by this pid (SHEP-87)
      case "foreground": if (old) this.terminals.set(t, { ...old, foreground: p.data ?? null }); break;
    }
    this.emit({ type: p.type, terminal: t, data });
  }
}
