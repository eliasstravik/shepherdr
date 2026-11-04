// The chats web pages have open: each followed from the agent's own log with the shared core's ChatReader (the
// same reading as the window's chat), dropped a minute after the last page leaves. Read again the moment its terminal
// draws something (a watch-only stream: the CLI took a message, wrote a reply, moved on; on another machine too, where
// no file can be watched from here) or its status changes, and every second anyway. A page is told when it opens a
// chat and on each change (it sends what it shows: compat.ts).
import type { Hub } from "./hub.ts";
import { sh } from "./model.ts";
import { ChatReader } from "../core/chat-reader.js";
import { reportMsg } from "../core/chat-view.js";

/** A page following a chat: told the reader (and the terminal now) each time the conversation changes. */
export type Watcher = (reader: ChatReader, terminal: any) => void;

type Followed = { reader: ChatReader; pages: Set<Watcher>; busy: boolean; idleSince: number | null; ready: boolean;
  /** a change came while it was being read: read once more after */
  again?: boolean;
  /** its terminal's watch-only stream, and a read it asked for soon */
  stream?: { close(): void } | null; soon?: ReturnType<typeof setTimeout> | null; last?: number;
  /** what its CLI said it does when last told (the working line's words while no call is open in its log) */
  said?: string };

/** a screen that keeps drawing (a spinner) asks for a read at most this often */
const NUDGE = 200;

/** "log:<machine>|<kind>|<path>": an ended agent's own log (compat.ts names a finished task's chat so). */
function readerFor(io: any, addr: string) {
  if (!addr.startsWith("log:")) return new ChatReader(io, addr);
  const [m, kind, ...path] = addr.slice(4).split("|");
  return new ChatReader(io, m ? `${m}/log` : "log").fixed(path.join("|"), kind || "claude");
}

/** Another machine's terminal as the live list has it lacks its foreground program (the log is found by its pid):
 *  hc get has it, asked at most every 10 s per terminal. */
const fg = new Map<string, { at: number; foreground: any }>();
async function withForeground(addr: string, t: any) {
  if (!t || t.foreground?.pid || !addr.includes("/") || t.state !== "live") return t;
  let c = fg.get(addr);
  if (!c || Date.now() - c.at > 10_000) {
    let foreground = null;
    try {
      const p = Bun.spawn([process.env.SHEPHERDR_HC || "hc", "get", addr, "--json"], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
      foreground = JSON.parse(await new Response(p.stdout).text())?.foreground ?? null;
    } catch {}
    fg.set(addr, (c = { at: Date.now(), foreground }));
  }
  return c.foreground ? { ...t, foreground: c.foreground } : t;
}

export class Chats {
  private followed = new Map<string, Followed>();

  constructor(private hub: Hub) {
    const io = { sh: (script: string, args: string[], on: string | null) => sh(hub, script, args, on) };
    this.io = io;
    hub.on((e) => { if ("terminal" in e && e.terminal && this.followed.has(e.terminal)) void this.tick(e.terminal); });
    setInterval(() => { for (const a of this.followed.keys()) void this.tick(a); }, 1000);
  }
  private io: { sh: (script: string, args: string[], on: string | null) => Promise<{ code: number; stdout: string }> };

  watch(addr: string, page: Watcher) {
    let f = this.followed.get(addr);
    if (!f) this.followed.set(addr, (f = { reader: readerFor(this.io, addr), pages: new Set(), busy: false, idleSince: null, ready: false }));
    f.pages.add(page);
    f.idleSince = null;
    if (f.ready) page(f.reader, this.hub.terminals.get(addr));
    void this.tick(addr);
  }

  unwatch(addr: string, page: Watcher) {
    const f = this.followed.get(addr);
    if (!f) return;
    f.pages.delete(page);
    if (!f.pages.size) f.idleSince = Date.now();
  }

  /** Tells every page its chats again (what they show changed outside the logs: an ask). */
  refreshAll() { for (const [addr, f] of this.followed) if (f.ready) this.publish(addr, f); }

  /** The agents whose chats pages follow now (a page open on them). */
  addresses() { return [...this.followed].filter(([, f]) => f.pages.size).map(([a]) => a); }

  /** The reader of a chat someone follows now, else null. */
  reader(addr: string) { return this.followed.get(addr)?.reader ?? null; }

  async earlier(addr: string) {
    const f = this.followed.get(addr);
    if (f && (await f.reader.earlier())) this.publish(addr, f);
  }

  /** Its terminal drew something: read its log soon (at once, else NUDGE after the last read). */
  private nudge(addr: string) {
    const f = this.followed.get(addr);
    if (!f || f.soon) return;
    f.soon = setTimeout(() => { f.soon = null; void this.tick(addr); }, Math.max(0, (f.last ?? 0) + NUDGE - Date.now()));
  }

  /** A watch-only stream on a live terminal someone follows (it moves no size), opened again after a restart. */
  private async stream(addr: string, f: Followed) {
    const t: any = this.hub.terminals.get(addr);
    // (null: on its way)
    if (f.stream !== undefined) return;
    if (addr.startsWith("log:") || !t || t.state !== "live" || !f.pages.size) return;
    f.stream = null;
    try {
      const core = await this.hub.core();
      let s: { close(): void } | undefined;
      s = await core.attach(addr, { data: () => this.nudge(addr), close: () => { if (f.stream === s) f.stream = undefined; } }, t.cols || 80, t.rows || 24, { observe: true });
      if (this.followed.get(addr) !== f || !f.pages.size) { s.close(); f.stream = undefined; return; }
      f.stream = s;
    } catch { f.stream = undefined; }
  }

  private async tick(addr: string) {
    const f = this.followed.get(addr);
    if (!f) return;
    if (f.busy) { f.again = true; return; }
    if (!f.pages.size && f.idleSince && Date.now() - f.idleSince > 60_000) {
      this.followed.delete(addr);
      if (f.soon) clearTimeout(f.soon);
      f.stream?.close();
      return;
    }
    // no page on it now: its stream goes (it comes back with the next page)
    if (!f.pages.size && f.stream) { f.stream.close(); f.stream = undefined; }
    else void this.stream(addr, f);
    f.busy = true;
    f.again = false;
    f.last = Date.now();
    try {
      const t = await withForeground(addr, this.hub.terminals.get(addr));
      let changed = await f.reader.locate(t);
      if (await f.reader.pull()) changed = true;
      if (await f.reader.lookJobs()) changed = true;
      // its CLI says it does something else now (a status change, no new line in its log): told too
      const said = reportMsg(t);
      if (said !== f.said) { f.said = said; changed = true; }
      if (changed || !f.ready) this.publish(addr, f);
    } catch (err) {
      console.error(`chat ${addr}: ${(err as Error).message}`);
    } finally {
      f.busy = false;
      if (f.again) this.nudge(addr);
    }
  }

  private publish(addr: string, f: Followed) {
    f.ready = true;
    const t = this.hub.terminals.get(addr);
    for (const page of f.pages) page(f.reader, t);
  }
}
