// The one-time carry-over of the Herdr window's spaces (3.2: the window's layout is gone, the service's own list is THE
// list of spaces: the shared document's "spaces"). Until 3.2 each machine's spaces lived in that machine's herdr-core,
// in its "herdr-app" document. Each machine's are copied into the own list once, keeping their id, name, folder and
// machine, so everything that names a space by its id (its settings, its group, its tasks, its chat) still finds it.
// The marker, shared "spaces.imported", lists the machines already done ("" is this computer): a machine that can't
// be reached yet is done when it first connects, and one that is done is never read again, so a space removed after
// the switch stays removed. Pure: docs in, the own list out.
import { spacesFromDoc } from "../core/spaces.js";

export const IMPORTED = "spaces.imported";
export type OwnSpace = { id: string; name: string; folder: string; machine: string | null; at?: number };

/** own: shared "spaces" now; imported: shared "spaces.imported" now; docs: each machine's "herdr-app" document as just
 *  read (null: this computer's), only the machines that answered (one with no such document: null or {}).
 *  Returns the new list and marker, or null when every machine in docs was done already. */
export function carryOver(own: unknown, imported: unknown, docs: Map<string | null, any>, now = Date.now()): { spaces: OwnSpace[]; imported: string[] } | null {
  const done = new Set<string>(Array.isArray(imported) ? imported.filter((x) => typeof x === "string") : []);
  const spaces: OwnSpace[] = Array.isArray(own) ? [...own] : [];
  const has = (id: string, machine: string | null) => spaces.some((s) => s.id === id && (s.machine ?? null) === machine);
  let changed = false;
  for (const [machine, doc] of docs) {
    const key = machine ?? "";
    if (done.has(key)) continue;
    // nothing there yet (its copy into Shepherdr's session may still be on its way at the switch): looked at again
    // later rather than marked done with its spaces missing; this computer with no window at all has none to wait for
    if (doc == null && machine !== null) continue;
    for (const s of (spacesFromDoc as any)(doc, machine) as { id: string; name: string; folder: string }[]) {
      // the document's ids are bare ("sp1"); spacesFromDoc names another machine's "vm/sp1"
      const id = machine && s.id.startsWith(`${machine}/`) ? s.id.slice(machine.length + 1) : s.id;
      if (!id || has(id, machine)) continue;
      spaces.push({ id, name: s.name, folder: s.folder, machine, at: now });
    }
    done.add(key);
    changed = true;
  }
  return changed ? { spaces, imported: [...done] } : null;
}
