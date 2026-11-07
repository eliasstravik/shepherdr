// Shepherdr's shared data (pins, sidebar sections and icons, Notify, switches, artifact answers): one herdr-core
// document, "shepherdr", on the machine that serves the web app (Serve from: service/host.ts). Here when this machine
// serves; else the host's, read and written through herdr-core's link and moved between the two machines' names
// (core/host.js), so everything above this sees it in this machine's words. Writes are versioned, so two writers never
// undo each other: a write that lost the race reads the new version and applies its change again. Every write is a
// change event both clients hear (the host's: read again every 3 s, as no event comes from there).
import type { Hub } from "./hub.ts";
import type { Host } from "./host.ts";
import * as HC from "../core/host.js";

const { relocate, relocateDoc, keepForeign } = HC as any;

export const DOC = "shepherdr";
export type Doc = { version: number; value: Record<string, unknown> };

export class Store {
  doc: Doc = { version: 0, value: {} };
  private listeners = new Set<(d: Doc) => void>();
  /** the host's document as it is there (its words), when another machine serves */
  private raw: Doc | null = null;
  private where: string | null = null;

  constructor(private hub: Hub, private host: Host | null = null) {
    hub.on((e) => {
      if (e.type === "reset" || (e.type === "doc" && (e as any).data?.name === DOC && !this.remote() && (e as any).data?.version !== this.doc.version)) void this.load().catch(() => {});
    });
    host?.on(() => void this.load().catch(() => {}));
    setInterval(() => { if (this.remote()) void this.load().catch(() => {}); }, 3000);
  }

  on(fn: (d: Doc) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  private remote() { return !!this.host && !this.host.serving(); }

  /** Where the document is now: null here, else the host's name. Throws while the host can't be reached. */
  private at(): string | null {
    if (!this.remote()) return null;
    const name = this.host!.hubName();
    if (typeof name !== "string" || !this.host!.reachable()) throw Object.assign(new Error("The machine that serves BossGoat can't be reached now."), { kind: "unreachable" });
    return name;
  }

  async load(): Promise<Doc> {
    const on = this.at();
    const d = await this.hub.call<{ value: any; version: number }>("doc.get", { name: DOC, ...(on ? { on } : {}) });
    const value = d.value && typeof d.value === "object" ? d.value : {};
    // another machine's version numbers aren't this one's: a move starts the count again
    const changed = d.version !== this.doc.version || on !== this.where;
    this.where = on;
    this.raw = on ? { version: d.version, value } : null;
    this.doc = { version: d.version, value: on ? relocateDoc(value, this.host!.fromHost()) : value };
    if (changed) for (const fn of this.listeners) fn(this.doc);
    return this.doc;
  }

  /** Applies change(value) as a new version. Retries a few times when someone else wrote first. */
  async update(change: (value: Record<string, unknown>) => Record<string, unknown>): Promise<Doc> {
    for (let i = 0; i < 5; i++) {
      const base = await this.load();
      const next = change(structuredClone(base.value));
      const on = this.where, raw = this.raw;
      // the host's words: only the keys this change touched, with what only the host can name kept
      let value = next;
      if (on && raw) {
        const to = this.host!.toHost(), back = this.host!.fromHost();
        value = structuredClone(raw.value);
        for (const k of new Set([...Object.keys(base.value), ...Object.keys(next)])) {
          if (JSON.stringify(base.value[k]) === JSON.stringify(next[k])) continue;
          if (next[k] === undefined) delete value[k];
          else value[k] = keepForeign(k, relocate(k, next[k], to), raw.value[k], back);
        }
      }
      try {
        const r = await this.hub.call<{ version: number }>("doc.set", { name: DOC, value, version: base.version, ...(on ? { on } : {}) });
        this.raw = on ? { version: r.version, value } : null;
        this.doc = { version: r.version, value: next };
        for (const fn of this.listeners) fn(this.doc);
        return this.doc;
      } catch (err) {
        if ((err as any).kind !== "conflict") throw err;
      }
    }
    throw new Error("the shared data kept changing; try again");
  }

  /** Sets one top-level key (null removes it). */
  set(key: string, value: unknown) {
    return this.update((v) => { if (value === null) delete v[key]; else v[key] = value; return v; });
  }
}
