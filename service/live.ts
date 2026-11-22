// Live updates for web pages: one socket each. The service keeps a few named views ("machines", "state", ...);
// a page gets all of them when it joins, then only the views whose content changed (never the whole lot again).
import type { ServerWebSocket } from "bun";
import type { Hub } from "./hub.ts";
import type { Store } from "./store.ts";
import type { Me } from "./tailscale.ts";

import type { Chats, Watcher } from "./chats.ts";
import type { Compat } from "./compat.ts";
import type { Chat } from "../web/shared/types.ts";

// A page's socket: the chats it follows (by 2.1's chat key), each with the terminal and the watcher it holds.
type WS = ServerWebSocket<{ who: string; keys?: string[]; chats?: Map<string, { addr: string; watcher: Watcher }>; push?: string | null; visible?: boolean; seen?: number; from?: string | null;
  /** the fresh chats it was sent (an Assistant that hasn't started), as sent; when a followed chat's agent went; the timer that looks again */
  history?: Map<string, { addr: string; watcher: Watcher; chat?: Chat }>; current?: Map<string, Chat>; fresh?: Map<string, string>; left?: Map<string, number>; freshTimer?: ReturnType<typeof setTimeout> | null }>;

/** how long an Assistant must be gone before its chat says what a new one would start on: a restart ends one and
 *  starts another a moment later, and the chat shouldn't flicker in between */
export const FRESH_AFTER_MS = 5000;

/** how long a wake word (or an open, SHEP-246) waits for a page of its device to show up */
export const WAKE_HELD_MS = 15_000;

export class Live {
  private pages = new Set<WS>();
  private views = new Map<string, string>();   // name -> its JSON, as last sent
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  chats: Chats | null = null;
  /** told which devices have the app on screen (they get no push) */
  onVisible: ((endpoints: Set<string>) => void) | null = null;
  /** told which tailnet device a push subscription is on (a page knows both): push.ts nodeOf */
  onPushDevice: ((endpoint: string, device: string) => void) | null = null;
  compat: Compat | null = null;
  private snap: string | null = null;
  /** a wake word or an open no page of its device had on screen yet (voiceWake, go): the next one that shows up takes it */
  private wake: { from: string; at: number; msg: string } | null = null;

  constructor(private hub: Hub, private store: Store, private me: () => Me | null, private version: string, private link: () => string | null = () => null) {
    hub.on((e) => {
      if (e.type === "reset") { void this.machines(); this.agents(); }
      else if ("terminal" in e && e.terminal) this.agents();
    });
    // the shared document changed: a choice for an Assistant that hasn't started may be one of them
    store.on((d) => { this.put("state", d); this.refresh(); });
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
    for (const w of ws.data.history?.values() ?? []) this.chats?.unwatch(w.addr, w.watcher);
    if (ws.data.freshTimer) clearTimeout(ws.data.freshTimer);
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

  private combined(ws: WS, key: string, chat: Chat): Chat {
    const old = ws.data.history?.get(key)?.chat;
    if (!old?.messages.length) return chat;
    return { ...chat, messages: [...old.messages, { id: "history-boundary", who: "agent", newSession: true }, ...chat.messages],
      top: !!old.top && !!chat.top, earlier: !!old.earlier || !!chat.earlier };
  }

  private sendChat(ws: WS, key: string, chat: Chat) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: "chat", chat: this.combined(ws, key, chat) }));
  }

  /** The chats a page has open now (2.1 sends their keys): followed until it closes them. */
  private watch(ws: WS, keys: string[]) {
    const chats = this.chats, compat = this.compat;
    if (!chats || !compat) return;
    ws.data.keys = keys;
    ws.data.history ??= new Map();
    ws.data.current ??= new Map();
    const histories = new Map(keys.slice(0, 40).map((k) => [k, compat.historyOf(k)]).filter((x): x is [string, string] => !!x[1]));
    for (const [k, h] of ws.data.history) if (histories.get(k) !== h.addr) { chats.unwatch(h.addr, h.watcher); ws.data.history.delete(k); }
    for (const [k, addr] of histories) if (!ws.data.history.has(k)) {
      const watcher: Watcher = (reader, t) => {
        const h = ws.data.history?.get(k);
        if (!h) return;
        h.chat = compat.chat(k, reader, t);
        const current = ws.data.current?.get(k) ?? compat.freshChat(k);
        if (current) this.sendChat(ws, k, current);
      };
      ws.data.history.set(k, { addr, watcher });
      chats.watch(addr, watcher);
    }
    const want = new Map<string, string>();
    for (const k of keys.slice(0, 40)) { const a = compat.addrOf(k); if (a) want.set(k, a); }
    ws.data.chats ??= new Map();
    for (const [k, w] of ws.data.chats) if (want.get(k) !== w.addr) {
      chats.unwatch(w.addr, w.watcher); ws.data.chats.delete(k); ws.data.current?.delete(k);
      if (!want.has(k)) (ws.data.left ??= new Map()).set(k, Date.now());
    }
    this.fresh(ws, keys.slice(0, 40).filter((k) => !want.has(k)));
    for (const [k, addr] of want) {
      if (ws.data.chats.has(k)) continue;
      let sent = "";
      const watcher: Watcher = (reader, t) => {
        const chat = compat.chat(k, reader, t);
        ws.data.current!.set(k, chat);
        const text = JSON.stringify(this.combined(ws, k, chat));
        if (text !== sent && ws.readyState === 1) { sent = text; this.sendChat(ws, k, chat); }
      };
      ws.data.chats.set(k, { addr, watcher });
      chats.watch(addr, watcher);
    }
  }

  /** The open chats with no agent: a space's Assistant that hasn't started gets its fresh chat (compat.freshChat: what
   *  its first message starts it on), sent again only when it changed. One whose Assistant just went waits a moment. */
  private fresh(ws: WS, keys: string[]) {
    const compat = this.compat as any, sent = (ws.data.fresh ??= new Map());
    for (const k of [...sent.keys()]) if (!keys.includes(k)) sent.delete(k);
    for (const k of keys) {
      if (!k.startsWith("p:")) continue;
      const left = ws.data.left?.get(k) ?? 0, wait = left + FRESH_AFTER_MS - Date.now();
      if (wait > 0) {
        ws.data.freshTimer ??= setTimeout(() => { ws.data.freshTimer = null; if (this.pages.has(ws) && ws.data.keys) this.watch(ws, ws.data.keys); }, wait + 50);
        continue;
      }
      ws.data.left?.delete(k);
      const chat = compat?.freshChat?.(k);
      if (!chat) { sent.delete(k); continue; }
      const text = JSON.stringify({ type: "chat", chat: this.combined(ws, k, chat) });
      if (sent.get(k) !== text && ws.readyState === 1) { sent.set(k, text); ws.send(text); }
    }
  }

  /** What the pages' open chats show may have changed without a new snapshot (a choice kept, a machine's CLIs read). */
  refresh() {
    for (const ws of this.pages) if (ws.data.keys) this.watch(ws, ws.data.keys);
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
      if (ws.data.push && ws.data.from) this.onPushDevice?.(ws.data.push, ws.data.from);
      if (this.wake && ws.data.from === this.wake.from && ws.data.visible && Date.now() - this.wake.at < WAKE_HELD_MS) {
        const msg = this.wake.msg;
        this.wake = null;
        ws.send(msg);
      }
    }
  }

  /** A wake word was heard on device `from` (POST /api/voice/wake, SHEP-240): that device's page on screen, the one used
   *  last, starts a voice call (or shows the one on: never hangs up). Pages of other devices never hear it. None on
   *  screen yet (a phone bringing Shepherdr forward or starting it): the first that shows up within 15 s does. True: a
   *  page got it now. */
  voiceWake(from: string) { return this.toDevice(from, JSON.stringify({ type: "voice" })); }

  /** Open an alert's link on device `from` (POST /api/open, SHEP-246): its page on screen used last goes there in place,
   *  as a tap on the alert does, without reloading. None on screen yet: the first that shows up within 15 s does. */
  go(from: string, url: string) { return this.toDevice(from, JSON.stringify({ type: "go", url })); }

  /** one message to device `from`'s page on screen it used last, or held for its first page within 15 s */
  private toDevice(from: string, msg: string) {
    let best: WS | null = null;
    for (const ws of this.pages)
      if (ws.data.from === from && ws.data.visible !== false && ws.readyState === 1 && (!best || (ws.data.seen ?? 0) > (best.data.seen ?? 0))) best = ws;
    if (!best) { this.wake = { from, at: Date.now(), msg }; return false; }
    this.wake = null;
    best.send(msg);
    return true;
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
