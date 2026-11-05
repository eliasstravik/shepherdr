// The artifact ids a task's chat logs say were published (SHEP-60): the fallback that finds an older artifact that
// names no task, for its task's Artifacts tab (core/task-artifacts.js). This machine's logs only. Each log is read in
// the background, once, then only what was added to it; a log that gives a new id rebuilds the snapshot.
import { open, stat } from "node:fs/promises";
import { publishedIds } from "../core/task-artifacts.js";

const CHUNK = 1 << 20;
// a word cut at a chunk's end is read again with the next one
const OVERLAP = 200;

export class TaskLogs {
  private seen = new Map<string, { size: number; ids: string[] }>();
  private reading = new Set<string>();
  onChange: (() => void) | null = null;

  /** What a log is known to say now (none yet: it is being read). */
  ids(path: string | null | undefined): string[] {
    if (!path) return [];
    void this.read(path);
    return this.seen.get(path)?.ids ?? [];
  }

  private async read(path: string) {
    if (this.reading.has(path)) return;
    this.reading.add(path);
    try {
      const was = this.seen.get(path) ?? { size: 0, ids: [] };
      const size = (await stat(path).catch(() => null))?.size ?? 0;
      if (size === was.size) return;
      const from = size < was.size ? 0 : Math.max(0, was.size - OVERLAP);
      const ids = new Set(size < was.size ? [] : was.ids);
      const f = await open(path, "r");
      try {
        const buf = Buffer.alloc(CHUNK + OVERLAP);
        for (let at = from; at < size; at += CHUNK) {
          const { bytesRead } = await f.read(buf, 0, Math.min(CHUNK + OVERLAP, size - at), at);
          for (const id of publishedIds(buf.toString("utf8", 0, bytesRead))) ids.add(id);
        }
      } finally {
        await f.close();
      }
      const now = [...ids];
      this.seen.set(path, { size, ids: now });
      if (now.length !== was.ids.length) this.onChange?.();
    } catch {
      // gone or unreadable: nothing from it
    } finally {
      this.reading.delete(path);
    }
  }
}
