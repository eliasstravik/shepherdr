// Live updates for web pages: one socket each. The service keeps a few named views ("machines", "state", ...);
// a page gets all of them when it joins, then only the views whose content changed (never the whole lot again).
import type { ServerWebSocket } from "bun";
import type { Hub } from "./hub.ts";
import type { Store } from "./store.ts";
import type { Me } from "./tailscale.ts";

type WS = ServerWebSocket<{ who: string }>;

export class Live {
  private pages = new Set<WS>();
  private views = new Map<string, string>();   // name -> its JSON, as last sent
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private hub: Hub, private store: Store, private me: () => Me | null, private version: string) {
    hub.on((e) => {
      if (e.type === "reset") { void this.machines(); this.agents(); }
      else if ("terminal" in e && e.terminal) this.agents();
    });
    store.on((d) => this.put("state", d));
    setInterval(() => void this.machines(), 15_000);
  }

  join(ws: WS) {
    this.pages.add(ws);
    const me = this.me();
    ws.send(JSON.stringify({ type: "hello", version: this.version, login: ws.data.who, machine: me?.host ?? null, link: me ? `https://${me.dns}/shepherdr/` : null }));
    for (const [name, text] of this.views) ws.send(`{"type":"view","name":${JSON.stringify(name)},"value":${text}}`);
    if (!this.views.has("state")) void this.store.load().then((d) => this.put("state", d));
  }

  leave(ws: WS) { this.pages.delete(ws); }

  message(ws: WS, text: string) {
    let m: any;
    try { m = JSON.parse(text); } catch { return; }
    if (m?.type === "ping") ws.send(JSON.stringify({ type: "pong", at: m.at ?? null }));
  }

  /** Sets a view; pages hear about it shortly after, once, if it really changed. */
  put(name: string, value: unknown) {
    const text = JSON.stringify(value);
    if (this.views.get(name) === text) return;
    this.views.set(name, text);
    this.pending.add(name);
    this.timer ??= setTimeout(() => this.flush(), 50);
  }

  private flush() {
    this.timer = null;
    for (const name of this.pending) {
      const msg = `{"type":"view","name":${JSON.stringify(name)},"value":${this.views.get(name)}}`;
      for (const ws of this.pages) if (ws.getBufferedAmount() < 1 << 20) ws.send(msg); else ws.close(1013, "too slow");
    }
    this.pending.clear();
  }

  private async machines() {
    try {
      const r = await this.hub.call<{ machines: any[] }>("machine.list", {});
      const me = this.me();
      const here = { name: me?.host ?? "this machine", here: true, state: "connected" };
      this.put("machines", [here, ...r.machines.map((m) => ({ name: m.name, here: false, state: m.state, version: m.version ?? null }))]);
    } catch {}
  }

  /** How many agents work, need you or are done, per machine. */
  private agents() {
    const by: Record<string, { working: number; blocked: number; done: number; idle: number }> = {};
    for (const t of this.hub.terminals.values()) {
      if (t.state !== "live" || !t.status) continue;
      const m = t.address.includes("/") ? t.address.split("/")[0] : "";
      const c = (by[m] ??= { working: 0, blocked: 0, done: 0, idle: 0 });
      const s = (typeof t.status === "string" ? t.status : t.status.state) as keyof typeof c;
      if (s in c) c[s]++;
    }
    this.put("agents", by);
  }
}
