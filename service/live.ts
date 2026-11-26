// Live updates for web pages: one socket each. A page gets the snapshot and its open chats whole when it joins, then
// only what changed (web/shared/patch.ts, #1468). A page that isn't on screen (a background tab, a locked phone) gets
// nothing but the count of what needs the person, for its title and icon; it catches up when it shows again.
import type { ServerWebSocket } from "bun";
import type { Hub } from "./hub.ts";
import type { Store } from "./store.ts";
import type { Me } from "./tailscale.ts";

import type { Chats, Watcher } from "./chats.ts";
import type { Compat } from "./compat.ts";
import type { Chat, Snapshot } from "../web/shared/types.ts";
import { cut, diff, chatDiff, type Cut } from "../web/shared/patch.ts";
import { needsCount } from "../web/shared/view.ts";

// A page's socket: the chats it follows (by 2.1's chat key), each with the terminal and the watcher it holds.
type WS = ServerWebSocket<{ who: string; keys?: string[]; chats?: Map<string, { addr: string; watcher: Watcher }>; push?: string | null; visible?: boolean; seen?: number; from?: string | null;
  /** the fresh chats it was sent (an Assistant that hasn't started), as sent; when a followed chat's agent went; the timer that looks again */
  history?: Map<string, { addr: string; watcher: Watcher; chat?: Chat }>; current?: Map<string, Chat>; fresh?: Map<string, string>; left?: Map<string, number>; freshTimer?: ReturnType<typeof setTimeout> | null;
  /** the snapshot it has (the next goes as a patch from it); each chat it has, by key, with its messages' JSON; the
   *  needs count it was told while hidden */
  base?: Cut | null; sent?: Map<string, { msgs: string[] }>; needs?: number }>;

/** how long an Assistant must be gone before its chat says what a new one would start on: a restart ends one and
 *  starts another a moment later, and the chat shouldn't flicker in between */
export const FRESH_AFTER_MS = 5000;

/** how long a wake word (or an open, SHEP-246) waits for a page of its device to show up */
export const WAKE_HELD_MS = 15_000;

/** a page on screen whose socket dropped (a phone's network blinking) still counts as on screen this long (SHEP-338) */
export const LOOK_GRACE_MS = 15_000;

/** With no page open, what only pages show (other machines' task lists, artifacts, health) is read this seldom, not
 *  every few seconds: each read starts processes on that machine (#1325). Task lists still come this often for alerts. */
export const IDLE_READ_MS = 120_000;
/** Is a read due: always while a page is open, else once IDLE_READ_MS passed since the last. */
export const readDue = (watched: boolean, last: number, now = Date.now(), idle = IDLE_READ_MS) => watched || now - last >= idle;

export class Live {
  private pages = new Set<WS>();

  chats: Chats | null = null;
  /** told which devices have the app on screen (they get no push) */
  onVisible: ((endpoints: Set<string>) => void) | null = null;
  /** told which tailnet device a push subscription is on (a page knows both): push.ts nodeOf */
  onPushDevice: ((endpoint: string, device: string) => void) | null = null;
  compat: Compat | null = null;
  private snap: Cut | null = null;
  private needs = 0;
  /** a wake word or an open no page of its device had on screen yet (voiceWake, go): the next one that shows up takes it */
  private wake: { from: string; at: number; msg: string } | null = null;
  /** device -> when its last page on screen went away without saying it was hidden */
  private lookedAt = new Map<string, number>();
  /** the web app's build this service serves (webbuild.ts): each page hears it, and again when it changes */
  private build = "";
  web: (() => { id: string; version: string }) | null = null;

  constructor(private hub: Hub, private store: Store, private me: () => Me | null, private version: string, private link: () => string | null = () => null) {
    // the shared document changed: a choice for an Assistant that hasn't started may be one of them
    store.on(() => this.refresh());
    setInterval(() => this.newBuild(), 20_000);
  }

  private buildText() {
    const b = this.web?.();
    this.build = b?.id ?? "";
    // a web app from before it said its version: the service's own
    return this.build ? JSON.stringify({ type: "build", id: this.build, version: b?.version || this.version }) : "";
  }

  /** a new web app put in place while the service runs: every page hears of it */
  private newBuild() {
    const was = this.build;
    const text = this.buildText();
    if (!text || this.build === was) return;
    for (const ws of this.pages) if (ws.readyState === 1) ws.send(text);
  }

  /** Is any page open now: the reads only pages show run while one is (#1325). */
  anyone() { return this.pages.size > 0; }
  /** told when the first page opens after none: what was read seldom is read again at once */
  private firstPage = new Set<() => void>();
  onFirstPage(fn: () => void) { this.firstPage.add(fn); }

  join(ws: WS) {
    ws.data.seen = Date.now();
    const first = this.pages.size === 0;
    this.pages.add(ws);
    if (first) for (const fn of this.firstPage) try { fn(); } catch {}
    const me = this.me();
    ws.send(JSON.stringify({ type: "hello", version: this.version, login: ws.data.who, machine: me?.host ?? null, link: this.link() }));
    const build = this.buildText();
    if (build) ws.send(build);
    this.sendSnap(ws);
  }

  /** The snapshot to a page on screen: whole the first time, then what changed since the one it has. */
  private sendSnap(ws: WS) {
    const now = this.snap;
    if (!now || ws.readyState !== 1 || ws.data.base === now) return;
    // a page that can't keep up gets the next one (from the snapshot it has)
    if (ws.getBufferedAmount() >= 1 << 20) return;
    const p = ws.data.base ? diff(ws.data.base, now) : null;
    ws.send(p ? JSON.stringify({ type: "patch", patch: p }) : `{"type":"snapshot","snapshot":${now.json}}`);
    ws.data.base = now;
  }

  /** A page off screen: only what its title and icon count, when that changed. */
  private sendNeeds(ws: WS) {
    if (ws.readyState !== 1 || ws.data.needs === this.needs) return;
    ws.data.needs = this.needs;
    ws.send(JSON.stringify({ type: "needs", n: this.needs }));
  }

  /** A page went off screen: it follows no chats until it shows again (each would be read and sent for nothing). */
  private pause(ws: WS) {
    for (const w of ws.data.chats?.values() ?? []) this.chats?.unwatch(w.addr, w.watcher);
    for (const w of ws.data.history?.values() ?? []) this.chats?.unwatch(w.addr, w.watcher);
    ws.data.chats?.clear(); ws.data.history?.clear(); ws.data.current?.clear(); ws.data.fresh?.clear();
    if (ws.data.freshTimer) clearTimeout(ws.data.freshTimer);
    ws.data.freshTimer = null;
  }

  /** The terminals web pages show now. */
  watched() { return [...this.pages].flatMap((ws) => [...(ws.data.chats?.values() ?? [])].map((w) => w.addr)); }

  private visibleNow() {
    this.onVisible?.(new Set([...this.pages].filter((w) => w.data.visible && w.data.push).map((w) => w.data.push!)));
  }

  /** Is the app on screen on tailnet device D now (SHEP-338): a page of it says it is visible, or one that was dropped
   *  while visible less than 15 s ago. That device then shows no system notification: no web push, and its phone app's
   *  own (Shepherdr Wake) hears the new alert as seen (glance.ts). */
  looking(device: string | null | undefined) {
    if (!device) return false;
    for (const w of this.pages) if (w.data.from === device && w.data.visible && w.readyState === 1) return true;
    const at = this.lookedAt.get(device);
    return at !== undefined && Date.now() - at < LOOK_GRACE_MS;
  }

  leave(ws: WS) {
    this.pages.delete(ws);
    if (ws.data.visible && ws.data.from) this.lookedAt.set(ws.data.from, Date.now());
    this.visibleNow();
    for (const w of ws.data.chats?.values() ?? []) this.chats?.unwatch(w.addr, w.watcher);
    for (const w of ws.data.history?.values() ?? []) this.chats?.unwatch(w.addr, w.watcher);
    if (ws.data.freshTimer) clearTimeout(ws.data.freshTimer);
  }

  /** 2.1's snapshot: everything the screen lists, each time it changes; pages on screen get what changed. */
  setSnapshot(snapshot: unknown) {
    // a chat key may map to another terminal now (a task's worker restarted in a new one, SHEP-90): follow it there
    for (const ws of this.pages) if (ws.data.keys) this.watch(ws, ws.data.keys);
    const next = cut(snapshot);
    if (next.json === this.snap?.json) return;
    this.snap = next;
    try { this.needs = needsCount(snapshot as Snapshot); } catch {}
    for (const ws of this.pages) if (ws.data.visible === false) this.sendNeeds(ws); else this.sendSnap(ws);
  }

  private combined(ws: WS, key: string, chat: Chat): Chat {
    const old = ws.data.history?.get(key)?.chat;
    if (!old?.messages.length) return chat;
    // #1537: ids are byte offsets in each session's own log, so two sessions can share one: the older session's get
    // their own (a reply quote's too), or the page's rows mix them up
    const prior = old.messages.map((m) => ({ ...m, id: `h:${m.id}`, ...(m.reply?.id ? { reply: { ...m.reply, id: `h:${m.reply.id}` } } : {}) }));
    return { ...chat, messages: [...prior, { id: "history-boundary", who: "agent", newSession: true }, ...chat.messages],
      top: !!old.top && !!chat.top, earlier: !!old.earlier || !!chat.earlier };
  }

  private sendChat(ws: WS, key: string, chat: Chat) {
    this.out(ws, this.combined(ws, key, chat));
  }

  /** A chat to a page: whole the first time, then the messages after the ones it already has. */
  private out(ws: WS, chat: Chat) {
    if (ws.readyState !== 1) return;
    const sent = (ws.data.sent ??= new Map());
    if (!Array.isArray(chat.messages)) { sent.delete(chat.key); return ws.send(JSON.stringify({ type: "chat", chat })); }
    const msgs = chat.messages.map((m) => JSON.stringify(m));
    const was = sent.get(chat.key);
    const d = was ? chatDiff(was, chat, msgs) : null;
    sent.delete(chat.key);
    sent.set(chat.key, { msgs });
    // a long-open page that saw many chats: the oldest it hasn't seen lately goes whole next time
    if (sent.size > 100) sent.delete(sent.keys().next().value!);
    if (!d) return ws.send(JSON.stringify({ type: "chat", chat }));
    const { messages: _, ...rest } = chat;
    ws.send(JSON.stringify({ type: "chatp", key: chat.key, keep: d.keep, add: d.add, chat: rest }));
  }

  /** The chats a page has open now (2.1 sends their keys): followed until it closes them. */
  private watch(ws: WS, keys: string[]) {
    const chats = this.chats, compat = this.compat;
    if (!chats || !compat) return;
    ws.data.keys = keys;
    if (ws.data.visible === false) return this.pause(ws);
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
   *  its first message starts it on), a task whose agent hasn't started its brief, sent again only when it changed. One whose Assistant just went waits a moment. */
  private fresh(ws: WS, keys: string[]) {
    const compat = this.compat as any, sent = (ws.data.fresh ??= new Map());
    for (const k of [...sent.keys()]) if (!keys.includes(k)) sent.delete(k);
    for (const k of keys) {
      // a space's Assistant not started, a task whose agent hasn't started (its brief, waiting: SHEP-330)
      if (!k.startsWith("p:") && !k.endsWith("/worker")) continue;
      const left = ws.data.left?.get(k) ?? 0, wait = left + FRESH_AFTER_MS - Date.now();
      if (wait > 0) {
        ws.data.freshTimer ??= setTimeout(() => { ws.data.freshTimer = null; if (this.pages.has(ws) && ws.data.keys) this.watch(ws, ws.data.keys); }, wait + 50);
        continue;
      }
      ws.data.left?.delete(k);
      const chat = compat?.freshChat?.(k);
      if (!chat) { sent.delete(k); continue; }
      const full = this.combined(ws, k, chat);
      const text = JSON.stringify(full);
      if (sent.get(k) !== text && ws.readyState === 1) { sent.set(k, text); this.out(ws, full); }
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
    else if (m?.type === "resync") {
      // the page couldn't apply a patch (it lacked what it builds on): everything whole again
      ws.data.base = null;
      ws.data.sent = new Map();
      this.pause(ws);
      if (ws.data.visible !== false) { this.sendSnap(ws); if (ws.data.keys) this.watch(ws, ws.data.keys); }
    }
    else if (m?.type === "watch" && Array.isArray(m.chats)) {
      const was = ws.data.visible !== false;
      ws.data.visible = m.visible !== false;
      // back on screen: what changed while it was off, then its chats as they are now
      if (ws.data.visible && !was) { ws.data.needs = undefined; this.sendSnap(ws); }
      if (!ws.data.visible && was) ws.data.needs = undefined, this.sendNeeds(ws);
      this.watch(ws, m.chats.filter((k: unknown) => typeof k === "string" && k.length < 200));
      ws.data.push = typeof m.push === "string" ? m.push : null;
      // hidden on purpose: no grace for its device
      if (!ws.data.visible && ws.data.from) this.lookedAt.delete(ws.data.from);
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
}
