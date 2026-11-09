// Live updates for web pages: one socket each. The service keeps a few named views ("machines", "state", ...);
// a page gets all of them when it joins, then only the views whose content changed (never the whole lot again).
import type { ServerWebSocket } from "bun";
import type { Hub } from "./hub.ts";
import type { Store } from "./store.ts";
import type { Me } from "./tailscale.ts";

import type { Chats, Watcher } from "./chats.ts";
import type { Compat } from "./compat.ts";

// A page's socket: the chats it follows (by 2.1's chat key), each with the terminal and the watcher it holds.
type WS = ServerWebSocket<{ who: string; keys?: string[]; chats?: Map<string, { addr: string; watcher: Watcher }>; push?: string | null; visible?: boolean; seen?: number }>;

export class Live {
  private pages = new Set<WS>();
  private views = new Map<string, string>();   // name -> its JSON, as last sent
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  chats: Chats | null = null;
  /** told which devices have the app on screen (they get no push) */
  onVisible: ((endpoints: Set<string>) => void) | null = null;
  compat: Compat | null = null;
  private snap: string | null = null;

  constructor(private hub: Hub, private store: Store, private me: () => Me | null, private version: string, private link: () => string | null = () => null) {
    hub.on((e) => {
      if (e.type === "reset") { void this.machines(); this.agents(); }
      else if ("terminal" in e && e.terminal) this.agents();
    });
    store.on((d) => this.put("state", d));
    setInterval(() => void this.machines(), 15_000);
  }

  join(ws: WS) {
    ws.data.seen = Date.now();
    this.pages.add(ws);
    const me = this.me();
    ws.send(JSON.stringify({ type: "hello", version: this.version, login: ws.data.who, machine: me?.host ?? null, link: this.link() }));
    for (const [name, text] of this.views) ws.send(`{"type":"view","name":${JSON.stringify(name)},"value":${text}}`);
    if (this.snap) ws.send(this.snap);
    if (!this.views.has("state")) void this.store.load().then((d) => this.put("state", d));
  }

  /** The terminals web pages show now. */
  watched() { return [...this.pages].flatMap((ws) => [...(ws.data.chats?.values() ?? [])].map((w) => w.addr)); }

  private visibleNow() {
    this.onVisible?.(new Set([...this.pages].filter((w) => w.data.visible && w.data.push).map((w) => w.data.push!)));
  }

  leave(ws: WS) {
    this.pages.delete(ws);
    this.visibleNow();
    for (const w of ws.data.chats?.values() ?? []) this.chats?.unwatch(w.addr, w.watcher);
  }

  /** 2.1's snapshot: everything the screen lists, whole, each time it changes. */
  setSnapshot(snapshot: unknown) {
    // a chat key may map to another terminal now (a task's worker restarted in a new one, SHEP-90): follow it there
    for (const ws of this.pages) if (ws.data.keys) this.watch(ws, ws.data.keys);
    const text = JSON.stringify({ type: "snapshot", snapshot });
    if (text === this.snap) return;
    this.snap = text;
    for (const ws of this.pages) if (ws.getBufferedAmount() < 1 << 20) ws.send(text);
  }

  /** The chats a page has open now (2.1 sends their keys): followed until it closes them. */
  private watch(ws: WS, keys: string[]) {
    const chats = this.chats, compat = this.compat;
    if (!chats || !compat) return;
    ws.data.keys = keys;
    const want = new Map<string, string>();
    for (const k of keys.slice(0, 40)) { const a = compat.addrOf(k); if (a) want.set(k, a); }
    ws.data.chats ??= new Map();
    for (const [k, w] of ws.data.chats) if (want.get(k) !== w.addr) { chats.unwatch(w.addr, w.watcher); ws.data.chats.delete(k); }
    for (const [k, addr] of want) {
      if (ws.data.chats.has(k)) continue;
      let sent = "";
      const watcher: Watcher = (reader, t) => {
        const text = JSON.stringify({ type: "chat", chat: compat.chat(k, reader, t) });
        if (text !== sent && ws.readyState === 1) { sent = text; ws.send(text); }
      };
      ws.data.chats.set(k, { addr, watcher });
      chats.watch(addr, watcher);
    }
  }

  message(ws: WS, text: string) {
    let m: any;
    try { m = JSON.parse(text); } catch { return; }
    // a page in use: it moved, came back on screen or woke (where the person is, for show())
    if (m?.type === "ping" || m?.type === "watch") ws.data.seen = Date.now();
    if (m?.type === "ping") ws.send(JSON.stringify({ type: "pong", at: m.at ?? null }));
    else if (m?.type === "watch" && Array.isArray(m.chats)) {
      this.watch(ws, m.chats.filter((k: unknown) => typeof k === "string" && k.length < 200));
      ws.data.push = typeof m.push === "string" ? m.push : null;
      ws.data.visible = m.visible !== false;
      this.visibleNow();
    }
  }

  /** Shows an artifact where the person is (herdr-artifact open, service/show.ts): the page on screen they used
   *  last opens it. False: no page is on screen. */
  show(artifact: string) {
    let best: WS | null = null;
    for (const ws of this.pages) if (ws.data.visible !== false && ws.readyState === 1 && (!best || (ws.data.seen ?? 0) > (best.data.seen ?? 0))) best = ws;
    if (!best) return false;
    best.send(JSON.stringify({ type: "show", artifact }));
    return true;
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
