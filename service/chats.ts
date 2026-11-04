// The chats web pages have open: each followed from the agent's own log with the shared core's ChatReader (the
// same reading as the window's chat), read every second while someone watches, dropped a minute after the last
// page leaves. A page is told when it opens a chat and on each change (it sends what it shows: compat.ts).
import type { Hub } from "./hub.ts";
import { sh } from "./model.ts";
import { ChatReader } from "../core/chat-reader.js";

/** A page following a chat: told the reader (and the terminal now) each time the conversation changes. */
export type Watcher = (reader: ChatReader, terminal: any) => void;

type Followed = { reader: ChatReader; pages: Set<Watcher>; busy: boolean; idleSince: number | null; ready: boolean };

/** "log:<machine>|<kind>|<path>": an ended agent's own log (compat.ts names a finished task's chat so). */
function readerFor(io: any, addr: string) {
  if (!addr.startsWith("log:")) return new ChatReader(io, addr);
  const [m, kind, ...path] = addr.slice(4).split("|");
  return new ChatReader(io, m ? `${m}/log` : "log").fixed(path.join("|"), kind || "claude");
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

  /** The reader of a chat someone follows now, else null. */
  reader(addr: string) { return this.followed.get(addr)?.reader ?? null; }

  async earlier(addr: string) {
    const f = this.followed.get(addr);
    if (f && (await f.reader.earlier())) this.publish(addr, f);
  }

  private async tick(addr: string) {
    const f = this.followed.get(addr);
    if (!f || f.busy) return;
    if (!f.pages.size && f.idleSince && Date.now() - f.idleSince > 60_000) { this.followed.delete(addr); return; }
    f.busy = true;
    try {
      const t = this.hub.terminals.get(addr);
      let changed = await f.reader.locate(t);
      if (await f.reader.pull()) changed = true;
      if (changed || !f.ready) this.publish(addr, f);
    } catch (err) {
      console.error(`chat ${addr}: ${(err as Error).message}`);
    } finally {
      f.busy = false;
    }
  }

  private publish(addr: string, f: Followed) {
    f.ready = true;
    const t = this.hub.terminals.get(addr);
    for (const page of f.pages) page(f.reader, t);
  }
}
