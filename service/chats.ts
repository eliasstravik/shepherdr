// The chats web pages have open: each followed from the agent's own log with the shared core's ChatReader (the
// same reading as the window's chat), read every second while someone watches, dropped a minute after the last
// page leaves. A page gets the whole conversation when it opens a chat, then the whole again on each change (a
// chat is at most KEEP records).
import type { Hub } from "./hub.ts";
import { sh } from "./model.ts";
import { ChatReader } from "../core/chat-reader.js";

type Watcher = (addr: string, msg: string) => void;

type Followed = { reader: ChatReader; pages: Set<Watcher>; busy: boolean; idleSince: number | null; text: string };

/** What a page draws from a conversation item: the item's own words and marks, nothing of the log's internals. */
function shown(x: any) {
  switch (x.kind) {
    case "tools": return { kind: "tools", id: x.id, steps: x.steps.map((s: any) => ({ kind: s.kind, line: s.line, count: s.count ?? 1, done: s.out != null })) };
    case "ask": return { kind: "ask", id: x.id, text: x.text ?? x.title ?? "", at: x.at ?? null, closed: x.closed ?? null };
    default: return { ...x };
  }
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
    if (!f) this.followed.set(addr, (f = { reader: new ChatReader(this.io, addr), pages: new Set(), busy: false, idleSince: null, text: "" }));
    f.pages.add(page);
    f.idleSince = null;
    if (f.text) page(addr, f.text);
    void this.tick(addr);
  }

  unwatch(addr: string, page: Watcher) {
    const f = this.followed.get(addr);
    if (!f) return;
    f.pages.delete(page);
    if (!f.pages.size) f.idleSince = Date.now();
  }

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
      if (changed || !f.text) this.publish(addr, f);
    } catch (err) {
      console.error(`chat ${addr}: ${(err as Error).message}`);
    } finally {
      f.busy = false;
    }
  }

  private publish(addr: string, f: Followed) {
    const r = f.reader, t: any = this.hub.terminals.get(addr);
    const text = JSON.stringify({
      type: "chat", addr, state: r.state, kind: r.kind, top: r.start === 0, status: t?.status?.state ?? null,
      items: (r.conv?.items ?? []).map(shown),
    });
    if (text === f.text) return;
    f.text = text;
    for (const page of f.pages) page(addr, text);
  }
}
