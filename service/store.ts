// Shepherdr's shared data (pins, sidebar sections and icons, Notify, switches, artifact answers): one herdr-core
// document, "shepherdr". Writes are versioned, so two writers never undo each other: a write that lost the race reads
// the new version and applies its change again. Every write is a change event both clients hear.
import type { Hub } from "./hub.ts";

export const DOC = "shepherdr";
export type Doc = { version: number; value: Record<string, unknown> };

export class Store {
  doc: Doc = { version: 0, value: {} };
  private listeners = new Set<(d: Doc) => void>();

  constructor(private hub: Hub) {
    hub.on((e) => {
      if (e.type === "reset" || (e.type === "doc" && (e as any).data?.name === DOC && (e as any).data?.version !== this.doc.version)) void this.load();
    });
  }

  on(fn: (d: Doc) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  async load(): Promise<Doc> {
    const d = await this.hub.call<{ value: any; version: number }>("doc.get", { name: DOC });
    const changed = d.version !== this.doc.version;
    this.doc = { version: d.version, value: d.value && typeof d.value === "object" ? d.value : {} };
    if (changed) for (const fn of this.listeners) fn(this.doc);
    return this.doc;
  }

  /** Applies change(value) as a new version. Retries a few times when someone else wrote first. */
  async update(change: (value: Record<string, unknown>) => Record<string, unknown>): Promise<Doc> {
    for (let i = 0; i < 5; i++) {
      const base = await this.load();
      const next = change(structuredClone(base.value));
      try {
        const r = await this.hub.call<{ version: number }>("doc.set", { name: DOC, value: next, version: base.version });
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
