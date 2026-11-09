// Serve from (Shepherdr settings › Web, `shepherdr web serve-from <machine>`): which machine serves the web app, and
// how every machine keeps one truth with it.
// - The host serves the web app and holds the truth: the shared document ("shepherdr": pins, the sidebar, Notify, the
//   Window switches) and the settings file (~/.config/shepherdr/settings.json, the role instructions). Another machine's service
//   reads and writes them there, through herdr-core's link; its window goes on using its own copy, kept in step.
// - Which machine it is: herdr-core document "shepherdr.host" = { id, at } on every machine (id: the host's herdr-core
//   id, the same on every machine). The newest record wins and each service hands it on to the machines it links to,
//   so a machine asleep at the move learns it when it wakes. No record: each machine serves itself (as before 3.1.1).
// - Each service says who it is in "shepherdr.node" = { id, name, os, version, link, links: { name: id }, at }:
//   another machine reads the host's to know its names.
// - Names are each machine's own: the laptop calls the mini "mac-mini", the mini calls the laptop "m3", and the shared
//   data names spaces and machines that way ("mac-mini/sp1" there is "sp1" here). relocate() moves a value from one
//   machine's names to another's through the ids; what the other machine can't name is left out, and keepForeign()
//   keeps what only the host knows when a change comes back.
// Shared core: the source is core/host.js; bin/sync-shared copies it into the mods in lib/COPIES.

export const HOST_DOC = "shepherdr.host";
export const NODE_DOC = "shepherdr.node";
// the web app's link, { link, id } (id: the host's), written by the host here and on every machine it links: an agent on
// a machine with no service of its own (a VM) can still give the person a link (herdr-artifact link, SHEP-99)
export const WEB_DOC = "shepherdr.web";
// a node record older than this: that machine's service is gone (they write theirs every minute)
export const NODE_STALE = 3 * 60_000;

/** The newest valid host record of several (null: none set). */
export function newestHost(records) {
  let best = null;
  for (const r of records) if (r && typeof r.id === "string" && r.id && Number.isFinite(r.at) && (!best || r.at > best.at)) best = r;
  return best;
}

/** Whether a node record says its service runs now. */
export const nodeAlive = (n, now = Date.now()) => Boolean(n?.id && now - (Number(n.at) || 0) < NODE_STALE);

/**
 * A machine name in `from`'s words to `to`'s: null is a machine's own. from and to: { id, links: { name: id } }.
 * undefined: `to` doesn't link that machine.
 */
export function renamer(from, to) {
  return (name) => {
    const id = name === null || name === undefined || name === "" || name === "local" ? from?.id : from?.links?.[name];
    if (!id || !to?.id) return undefined;
    if (id === to.id) return null;
    const hit = Object.entries(to.links ?? {}).find(([, v]) => v === id);
    return hit ? hit[0] : undefined;
  };
}

/** A space, tab or terminal id ("sp1" here, "vm/sp1" there) in other words; undefined: not nameable there. */
export function moveId(id, rename) {
  const s = String(id);
  const cut = s.indexOf("/");
  const m = rename(cut < 0 ? null : s.slice(0, cut));
  if (m === undefined) return undefined;
  const rest = cut < 0 ? s : s.slice(cut + 1);
  return m === null ? rest : `${m}/${rest}`;
}

// a task's pin key (core/tasks.js taskKey): "<machine, empty here>:<folder>#<id>"
function movePin(key, rename) {
  const s = String(key);
  const cut = s.indexOf(":");
  if (cut < 0) return s;
  const m = rename(s.slice(0, cut) || null);
  return m === undefined ? undefined : `${m ?? ""}:${s.slice(cut + 1)}`;
}

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const mapKeys = (o, fn) => {
  const out = {};
  for (const [k, v] of Object.entries(isObj(o) ? o : {})) { const n = fn(k); if (n !== undefined) out[n] = v; }
  return out;
};
const keep = (list, fn) => (Array.isArray(list) ? list.map(fn).filter((x) => x !== undefined) : list);
// a machine key in the sidebar's machines ("" here) and Notify's ("local" here)
const machineKey = (here) => (rename) => (k) => { const m = rename(k === here ? null : k); return m === undefined ? undefined : m ?? here; };

/** One shared document key's value in another machine's names (keys that name no machine come back as they are). */
export function relocate(key, value, rename) {
  if (value === null || value === undefined) return value;
  if (key === "tasks.pinned") return keep(value, (k) => movePin(k, rename));
  if (key === "spaces-chat" && isObj(value)) {
    const sections = Array.isArray(value.sections) ? value.sections.flatMap((s) => {
      const m = rename(s?.machine ?? null);
      return m === undefined ? [] : [{ ...s, machine: m, spaces: keep(s.spaces ?? [], (id) => moveId(id, rename)) }];
    }) : value.sections;
    return { ...value, sections, icons: mapKeys(value.icons, (id) => moveId(id, rename)), pinned: keep(value.pinned, (id) => moveId(id, rename)),
      ...(isObj(value.machines) ? { machines: mapKeys(value.machines, machineKey("")(rename)) } : {}),
      // each machine's dragged order of its spaces (core/spaces.js withOrder): its key and its ids
      // the machines' dragged order (core/spaces.js withMachineOrder): "" is this computer, as in machines
      ...(Array.isArray(value.machineOrder) ? { machineOrder: keep(value.machineOrder, machineKey("")(rename)) } : {}),
      ...(isObj(value.order) ? { order: Object.fromEntries(Object.entries(mapKeys(value.order, machineKey("")(rename))).map(([k, ids]) => [k, keep(ids, (id) => moveId(id, rename))])) } : {}) };
  }
  if (key === "notify" && isObj(value)) {
    return { ...value, ...(isObj(value.machines) ? { machines: mapKeys(value.machines, machineKey("local")(rename)) } : {}),
      ...(isObj(value.spaces) ? { spaces: mapKeys(value.spaces, (id) => moveId(id, rename)) } : {}) };
  }
  return value;
}

/** The whole document in other words. */
export const relocateDoc = (doc, rename) => Object.fromEntries(Object.entries(isObj(doc) ? doc : {}).map(([k, v]) => [k, relocate(k, v, rename)]));

/**
 * A key's new value for the host (already in its words), with what the host had for machines the writer can't name
 * put back: back(name in the host's words) is undefined for those.
 */
export function keepForeign(key, next, old, back) {
  if (old === null || old === undefined || next === null || next === undefined) return next;
  const foreignId = (id) => moveId(id, back) === undefined;
  if (key === "tasks.pinned" && Array.isArray(next) && Array.isArray(old)) return [...next, ...old.filter((k) => movePin(k, back) === undefined && !next.includes(k))];
  if (key === "spaces-chat" && isObj(next) && isObj(old)) {
    const out = { ...next };
    if (Array.isArray(old.sections)) out.sections = [...(next.sections ?? []), ...old.sections.filter((s) => back(s?.machine ?? null) === undefined)];
    if (isObj(old.icons)) out.icons = { ...Object.fromEntries(Object.entries(old.icons).filter(([id]) => foreignId(id))), ...(next.icons ?? {}) };
    if (Array.isArray(old.pinned)) out.pinned = [...(next.pinned ?? []), ...old.pinned.filter((id) => foreignId(id) && !(next.pinned ?? []).includes(id))];
    if (isObj(old.machines)) out.machines = { ...Object.fromEntries(Object.entries(old.machines).filter(([k]) => back(k === "" ? null : k) === undefined)), ...(next.machines ?? {}) };
    // the machines the writer can't name keep their place, after the one they followed
    if (Array.isArray(old.machineOrder) && Array.isArray(next.machineOrder)) {
      const mo = [...next.machineOrder];
      for (const [i, k] of old.machineOrder.entries()) {
        if (mo.includes(k) || back(k === "" ? null : k) !== undefined) continue;
        const after = old.machineOrder.slice(0, i).findLast((x) => mo.includes(x));
        mo.splice(after === undefined ? 0 : mo.indexOf(after) + 1, 0, k);
      }
      out.machineOrder = mo;
    }
    if (isObj(old.order)) out.order = { ...Object.fromEntries(Object.entries(old.order).filter(([k]) => back(k === "" ? null : k) === undefined)), ...(next.order ?? {}) };
    return out;
  }
  if (key === "notify" && isObj(next) && isObj(old)) {
    const out = { ...next };
    if (isObj(old.machines)) out.machines = { ...Object.fromEntries(Object.entries(old.machines).filter(([k]) => back(k === "local" ? null : k) === undefined)), ...(next.machines ?? {}) };
    if (isObj(old.spaces)) out.spaces = { ...Object.fromEntries(Object.entries(old.spaces).filter(([id]) => foreignId(id))), ...(next.spaces ?? {}) };
    return out;
  }
  return next;
}

// ---- the settings file ----------------------------------------------------------------------------------------
// { version, everywhere, machines: { "local" | name: {...} }, spaces: { id | "m/id": { name, machine, folder, ... } } }:
// a machine's own file has no "pushed_from" (herdr-task's push to other machines leaves an own file alone).

/** The settings file in another machine's words: an own file there (never a pushed copy). */
export function relocateSettings(file, rename) {
  const f = isObj(file) ? file : {};
  const { pushed_from: _p, here: _h, ...rest } = f;
  const spaces = {};
  for (const [id, v] of Object.entries(isObj(f.spaces) ? f.spaces : {})) {
    const n = moveId(id, rename);
    if (n === undefined) continue;
    const m = isObj(v) && typeof v.machine === "string" ? rename(v.machine) : null;
    spaces[n] = isObj(v) && "machine" in v ? (m ? { ...v, machine: m } : (({ machine: _m, ...o }) => o)(v)) : v;
  }
  return { ...rest, machines: mapKeys(f.machines, machineKey("local")(rename)), spaces };
}

// Every leaf of a settings file as path -> JSON (a three-way merge compares these).
function leaves(o, at = [], out = new Map()) {
  if (isObj(o) && Object.keys(o).length) { for (const [k, v] of Object.entries(o)) leaves(v, [...at, k], out); }
  else if (at.length) out.set(JSON.stringify(at), JSON.stringify(o));
  return out;
}
function put(o, path, v) {
  let t = o;
  for (const k of path.slice(0, -1)) { if (!isObj(t[k])) t[k] = {}; t = t[k]; }
  if (v === undefined) delete t[path[path.length - 1]]; else t[path[path.length - 1]] = v;
}
// empty objects a removal left behind
function prune(o) {
  for (const [k, v] of Object.entries(o)) if (isObj(v)) { prune(v); if (!Object.keys(v).length) delete o[k]; }
  return o;
}

/**
 * Two copies changed since they were last the same (base): each leaf takes the side that changed it, the host's when
 * both did. All three in the same words. Returns the merged file.
 */
export function merge3(base, mine, theirs) {
  const b = leaves(base ?? {}), m = leaves(mine ?? {}), t = leaves(theirs ?? {});
  const out = JSON.parse(JSON.stringify(theirs ?? {}));
  for (const k of new Set([...b.keys(), ...m.keys(), ...t.keys()])) {
    const bv = b.get(k), mv = m.get(k), tv = t.get(k);
    if (mv === bv || mv === tv || tv !== bv) continue; // only mine changed it: mine goes in
    put(out, JSON.parse(k), mv === undefined ? undefined : JSON.parse(mv));
  }
  return prune(out);
}

// ---- Settings › Web's Serve from ------------------------------------------------------------------------------
export const SERVE = {
  title: "Serve from",
  about: "The machine that serves the web app. An always-on one keeps it up while this computer sleeps.",
  here: "This computer",
  moving: (m) => `Moving the web app to ${m}…`,
  failed: (why) => `Couldn't move it: ${why}`,
  offline: "Offline",
  elsewhere: (m) => `On, served from ${m} and private to your tailnet. This computer stays in step with it.`,
  unreachable: (m) => `Served from ${m}, which can't be reached now. This computer keeps its own copy until it's back.`,
  // the pick, confirmed (the window's inline confirm, the web's dialog)
  confirm: (m, here) => (here ? "Serve the web app from this computer?" : `Serve the web app from ${m}?`),
  detail: (m, here) => (here
    ? "Its link moves here and the other machine stops sharing it. Pins and settings come along."
    : `Shepherdr's web service is installed or updated on ${m}, its link moves there and this computer stops sharing it. Pins and settings come along.`),
  verb: "Move it",
};

/** A machine's line in the picker: "mac-mini · macOS", "vm-demo · Linux · Offline". */
export function serveChoice(m) {
  const os = m.os === "darwin" ? "macOS" : m.os === "linux" ? "Linux" : m.os || null;
  return [m.here ? SERVE.here : m.name, os, m.state && m.state !== "connected" ? SERVE.offline : null].filter(Boolean).join(" · ");
}
