// A window space changed with no Herdr window open (SHEP-13). Herdr keeps each machine's spaces, tabs and splits in
// that machine's herdr-core (its "herdr-app" document); the window reads them from there when it starts. When the
// window doesn't answer (herdr-app do fails), the service makes the same change there itself, as the window would:
// - one write that only lands on the version it read (doc.set's version check), retried on a conflict, so it never
//   overwrites a write it didn't see (a window starting meanwhile, another machine's window);
// - only the space or tab asked for changes; every other space stays as it is, and a document without spaces is
//   never written;
// - on the machine that holds it ("vm/sp1": vm's document, reached through herdr-core's link).
// A close also ends what ran in it (its tabs' terminals, its Assistant, agents parked on its panes), as the window's
// close does, but never a terminal another space still shows.
import { chatLabel } from "../core/spaces.js";

type Call = { call<T = any>(method: string, params?: Record<string, unknown>, timeout?: number): Promise<T>; terminals: Map<string, any> };

const DOC = "herdr-app";

/** "vm/sp1" -> vm's sp1; "sp1" -> this machine's. */
export function splitId(id: string): { machine: string | null; id: string } {
  const i = id.indexOf("/");
  return i < 0 ? { machine: null, id } : { machine: id.slice(0, i), id: id.slice(i + 1) };
}

/** Changes a machine's saved spaces: change gets a copy of the document's value and returns the new one, or null for
 *  nothing to do. Returns what change returned last (null: nothing changed). */
export async function changeSaved(hub: Call, machine: string | null, change: (value: any) => any | null): Promise<any | null> {
  const on = machine ? { on: machine } : {};
  for (let i = 0; i < 5; i++) {
    let d: { value: any; version: number };
    try { d = await hub.call("doc.get", { name: DOC, ...on }, 8000); }
    catch { throw new Error(machine ? `Couldn't reach ${machine}: try again once it's connected.` : "Couldn't read this computer's spaces."); }
    if (!Array.isArray(d?.value?.spaces)) return null;
    const next = change(structuredClone(d.value));
    if (!next) return null;
    try {
      await hub.call("doc.set", { name: DOC, value: next, version: d.version, ...on }, 8000);
      return next;
    } catch (e) {
      if ((e as any)?.kind !== "conflict") throw new Error(machine ? `Couldn't change ${machine}'s spaces: try again once it's connected.` : "Couldn't change this computer's spaces.");
    }
  }
  throw new Error("The spaces kept changing meanwhile: try again.");
}

// A layout node's terminals (a terminal block's, or a chat block's agent) and its blocks' ids (the panes).
function walk(node: any, out = { terminals: [] as string[], panes: [] as string[] }) {
  if (!node || typeof node !== "object") return out;
  if (node.type === "block" && typeof node.id === "string") out.panes.push(node.id);
  const c = node.content;
  if (typeof c?.terminal === "string") out.terminals.push(c.terminal);
  if (typeof c?.props?.terminal === "string") out.terminals.push(c.props.terminal);
  for (const ch of node.children ?? []) walk(ch, out);
  return out;
}
const inSpace = (s: any): { terminals: string[]; panes: string[] } => (s?.tabs ?? []).reduce((o: any, t: any) => walk(t.root, o), { terminals: [], panes: [] });

/** Closes a window space with no window: gone from its machine's saved spaces, then what ran in it ends. Returns the
 *  space as it was (its id, name, folder), or null when it isn't there. */
export async function closeSaved(hub: Call, place: string) {
  const { machine, id } = splitId(place);
  let gone: any = null, left: any[] = [];
  await changeSaved(hub, machine, (v) => {
    gone = v.spaces.find((s: any) => s?.id === id) ?? null;
    if (!gone) return null;
    v.spaces = v.spaces.filter((s: any) => s !== gone);
    left = v.spaces;
    return v;
  });
  if (!gone) return null;
  const at = (a: string) => (machine ? `${machine}/${a}` : a);
  const here = (a: string) => (a.includes("/") ? a.split("/")[0] : null) === machine;
  const mine = inSpace(gone), kept = new Set(left.flatMap((s) => inSpace(s).terminals));
  const panes = new Set<unknown>(mine.panes);
  const end = new Set<string>(mine.terminals.filter((t: string) => !kept.has(t)).map(at));
  for (const t of hub.terminals.values()) {
    if (t.state !== "live" || !here(t.address)) continue;
    const l = t.labels ?? {};
    // its Assistant, and agents parked on one of its panes (the window's sweep ends those once their pane is gone)
    if ((l["herdr.role"] === "coordinator" && l["herdr.coordinator.space"] === id) || panes.has(chatLabel(l["herdr.chat"]))) end.add(t.address);
  }
  for (const a of end) if ((hub.terminals.get(a) as any)?.state === "live") await hub.call("terminal.kill", { terminal: a }).catch(() => null);
  return { id: place, machine, name: gone.name ?? null, folder: gone.folder ?? null };
}

/** Renames a window space or tab (id "sp…"/"tb…", another machine's "vm/…") with no window. Returns its name before,
 *  or null when it isn't there. */
export async function renameSaved(hub: Call, place: string, name: string): Promise<{ was: string | null } | null> {
  const { machine, id } = splitId(place);
  let was: string | null = null;
  const done = await changeSaved(hub, machine, (v) => {
    for (const s of v.spaces) {
      const x = s?.id === id ? s : (s?.tabs ?? []).find((t: any) => t?.id === id);
      if (x) { was = x.name ?? null; x.name = name; return v; }
    }
    return null;
  });
  return done ? { was } : null;
}

/** A machine's spaces in a new order with no window: ids (full ones, as the sidebar has them) first in that order, as
 *  the window's space.move to 1, 2… puts them, the rest after as they were. */
export async function orderSaved(hub: Call, machine: string | null, ids: string[]) {
  const want = ids.map(splitId).filter((x) => x.machine === machine).map((x) => x.id);
  return !!(await changeSaved(hub, machine, (v) => {
    const first = want.map((id) => v.spaces.find((s: any) => s?.id === id)).filter(Boolean);
    const next = [...first, ...v.spaces.filter((s: any) => !first.includes(s))];
    if (next.every((s, i) => s === v.spaces[i])) return null;
    v.spaces = next;
    return v;
  }));
}

/** The sidebar's own data (shared "spaces-chat") without a closed space: out of Pinned, its section and its icon, as
 *  the window's prune does once the space is gone. Unchanged: the same object. */
export function withoutSpace(bar: any, id: string) {
  if (!bar || typeof bar !== "object") return bar;
  const has = (bar.pinned ?? []).includes(id) || (bar.icons && id in bar.icons) || (bar.sections ?? []).some((s: any) => (s.spaces ?? []).includes(id));
  if (!has) return bar;
  const icons = { ...(bar.icons ?? {}) };
  delete icons[id];
  return {
    ...bar, icons,
    ...(Array.isArray(bar.pinned) ? { pinned: bar.pinned.filter((x: string) => x !== id) } : {}),
    ...(Array.isArray(bar.sections) ? { sections: bar.sections.map((s: any) => (s.spaces ?? []).includes(id) ? { ...s, spaces: s.spaces.filter((x: string) => x !== id) } : s) } : {}),
  };
}
