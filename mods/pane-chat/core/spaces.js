// Spaces as the person knows them: each machine's spaces (Herdr's own layout document, "herdr-app", per
// machine), each with its tabs, its Assistant (the live coordinator terminal labelled for it) and whether that
// Assistant has something new (unread: the core label herdr.chat.read, the same on every device). The window
// gets spaces from Herdr (spaces()); the service and the web app build them here from the same documents.
// Shared core: the source is core/spaces.js; bin/sync-shared copies it into the mods in lib/COPIES.

export const READ = "herdr.chat.read";
export const machineOf = (address) => (String(address).includes("/") ? String(address).split("/")[0] : null);

// The chat pane an agent is parked behind: its core label herdr.chat. Like every label, it holds the id its own
// machine gives the pane (no "<machine>/" in front), so every window and the service read the same pane whatever
// they call that machine. A window that wrote its own "<machine>/<pane>" made another window miss the pane and
// end the agent as one whose chat had closed (#761).
export const CHAT = "herdr.chat";
// What goes in herdr.chat for a chat pane (an app id: "<machine>/<pane>" for another machine's).
export const chatLabel = (pane) => (pane ? String(pane).split("/").pop() : "");
// The chat pane a terminal is parked behind, as this window's app id (null: none). A label an earlier version
// wrote with a machine in front reads the same.
export function chatPane(k) {
  const c = k?.labels?.[CHAT];
  if (!c) return null;
  const m = machineOf(k.address ?? ""), id = chatLabel(c);
  return m ? `${m}/${id}` : id;
}

// A space's Assistant: the live coordinator terminal labelled for it, on the space's machine (labels hold that
// machine's own ids, without the "<machine>/" an app id has).
export function assistantOf(space, ts) {
  const id = String(space.id).split("/").pop();
  return ts.find((k) => k.state === "live" && k.labels?.["herdr.role"] === "coordinator"
    && k.labels?.["herdr.coordinator.space"] === id && machineOf(k.address) === (space.machine ?? null)) ?? null;
}

// The turn last read. Before any mark: the turn the window last saw it done at (its "chat.seen").
export function readTurn(k, seen = {}) {
  const mark = Number(k.labels?.[READ]);
  return Number.isFinite(mark) ? mark : seen[k.address] ?? 0;
}

// Unread, as Slack has it: only an Assistant counts; task chats never make a row bold.
export function isUnread(k, seen = {}, asked = 0) {
  if (!k || k.labels?.["herdr.role"] !== "coordinator") return false;
  return (k.turn ?? 0) > Math.max(readTurn(k, seen), asked);
}

// Every terminal a layout node shows: a terminal block's, or a chat block's agent.
function terminalsIn(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const c = node.content;
  if (c?.terminal) out.push(c.terminal);
  if (c?.props?.terminal) out.push(c.props.terminal);
  for (const ch of node.children ?? []) terminalsIn(ch, out);
  return out;
}

// One machine's spaces from its "herdr-app" document. machine: null here, else its name (ids then read
// "<machine>/<id>", as the window's spaces() has them).
export function spacesFromDoc(doc, machine = null) {
  const at = (id) => (machine ? `${machine}/${id}` : id);
  // a terminal the window already wrote with its machine ("<machine>/t6") keeps it: never "<machine>/<machine>/t6" (#818)
  const atTerm = (id) => (machine && String(id).startsWith(`${machine}/`) ? id : at(id));
  return (Array.isArray(doc?.spaces) ? doc.spaces : []).map((s) => ({
    id: at(s.id),
    machine,
    name: s.name ?? "",
    folder: s.folder ?? "",
    tabs: (s.tabs ?? []).map((t) => ({ id: at(t.id), name: t.name ?? "", terminals: terminalsIn(t.root).map(atTerm) })),
  }));
}

// What a space is called, the same in the window's sidebar and on the web: the name the person gave it, else after
// where it is (`at`): a home folder reads "Home", a repo its name, any other folder its own. Never "~" (as New space
// and the tab bar once named home ones: that counts as unnamed). named: false when Herdr named it itself.
const HOME_AT = /^\/(home\/[^/]+|Users\/[^/]+|root)(?=\/|$)/;
// A folder as the sidebar shows it, from a home folder here or on another machine: "~/dev/app".
export const tilde = (path) => String(path ?? "").replace(HOME_AT, "~");
// Two spaces with one name on one machine (a worktree under its repo aside: its branch shows): each shows its folder.
// rows: [{ id, machine, name, linked }]; the ids whose name another shares.
export function sharedNames(rows) {
  const key = (r) => `${r.machine ?? ""}\u0000${String(r.name).toLowerCase()}`;
  const count = new Map();
  for (const r of rows) if (!r.linked) count.set(key(r), (count.get(key(r)) ?? 0) + 1);
  return new Set(rows.filter((r) => (count.get(key(r)) ?? 0) > 1).map((r) => r.id));
}
export const isHomeFolder = (path, home = null) => { const p = String(path ?? "").replace(/\/+$/, ""); return (!!home && p === home) || (HOME_AT.test(p) && !p.replace(HOME_AT, "")); };
export function spaceName(s, { at = s?.folder, repo = null, home = null, named = true } = {}) {
  if ((named && s?.name && s.name !== "~") || !at) return s?.name && s.name !== "~" ? s.name : "Home";
  return isHomeFolder(at, home) ? "Home" : repo ?? String(at).replace(/\/+$/, "").split("/").pop();
}

// The sidebar's own data (mods/spaces-chat: sections, icons, Pinned): { sections, icons, pinned }.
export function sidebarOf(s) {
  return {
    sections: Array.isArray(s?.sections) ? s.sections : [],
    icons: s?.icons && typeof s.icons === "object" ? s.icons : {},
    pinned: Array.isArray(s?.pinned) ? s.pinned : [],
  };
}

// ---- the sidebar's own data, changed (shared "spaces-chat", mods/spaces-chat/sections.js's format) ----
const tidyBar = (d) => ({ ...(d ?? {}), sections: (d?.sections ?? []).map((s) => ({ ...s, spaces: [...(s.spaces ?? [])] })), icons: { ...(d?.icons ?? {}) },
  pinned: [...(d?.pinned ?? [])], machines: { ...(d?.machines ?? {}) } });

// A space moved: into Pinned, a section (its id), or back to its machine's top (null); before: the space it goes in
// front of. A pinned space keeps its section (Unpin puts it back), as in the window.
export function withMove(d, space, to, before = null) {
  const x = tidyBar(d);
  const put = (list) => { const i = before ? list.indexOf(before) : -1; list.splice(i < 0 ? list.length : i, 0, space); };
  if (to === "pinned") { x.pinned = x.pinned.filter((s) => s !== space); put(x.pinned); return x; }
  x.pinned = x.pinned.filter((s) => s !== space);
  for (const s of x.sections) s.spaces = s.spaces.filter((id) => id !== space);
  const sec = to ? x.sections.find((s) => s.id === to) : null;
  if (sec) put(sec.spaces);
  return x;
}

export function withSection(d, { id, name, machine = null, icon = null }) {
  const x = tidyBar(d);
  x.sections.push({ id, machine, name, folded: false, spaces: [], ...(icon ? { icon } : {}) });
  return x;
}

export function withoutSection(d, id) {
  const x = tidyBar(d);
  x.sections = x.sections.filter((s) => s.id !== id);
  return x;
}

// A section deleted (its menu's Delete, at once): what to keep for its Undo (shared "spaces-chat.deleted"), and its toast.
export const DELETED = "spaces-chat.deleted";
export function deletedSection(d, id) {
  const at = (d?.sections ?? []).findIndex((s) => s.id === id);
  return at < 0 ? null : { section: d.sections[at], at };
}
export const sectionDeletedToast = (name) => ({ title: `Deleted the section “${name}”`, body: "Its spaces moved up to the machine. Click to undo." });
// Undo: back in its place, with those of its spaces no other section took meanwhile.
export function withRestoredSection(d, gone) {
  const x = tidyBar(d);
  if (!gone?.section || x.sections.some((s) => s.id === gone.section.id)) return x;
  const filed = new Set(x.sections.flatMap((s) => s.spaces ?? []));
  x.sections.splice(Math.min(gone.at, x.sections.length), 0, { ...gone.section, spaces: (gone.section.spaces ?? []).filter((s) => !filed.has(s)) });
  return x;
}

export function withSectionName(d, id, name, icon) {
  const x = tidyBar(d);
  for (const s of x.sections) if (s.id === id) { s.name = name; if (icon !== undefined) { if (icon) s.icon = icon; else delete s.icon; } }
  return x;
}

// Only what's unusual after a space's name in the sidebar: "herdr · spike". The repo or branch goes when the name
// already says it (a worktree is named after its branch), and master/main go: nearly every space is on one.
// g: { name (repo), branch }; tree: nested under its repo; tag: its machine, in Pinned.
export function gitTail(g, { name = "", tree = false, tag = null } = {}) {
  const raw = g?.branch ?? "detached";
  const same = (a) => String(a ?? "").toLowerCase() === String(name).toLowerCase();
  const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
  const repo = tree || same(g?.name) ? "" : g?.name ?? "";
  return { where: [tag, repo, branch].filter(Boolean).join(" \u00b7 ") };
}

// A machine's own name and emoji in the sidebar (machines[""] is this computer's): empty name goes back to its own.
export function withMachineLook(d, machine, name, icon) {
  const x = tidyBar(d), k = machine ?? "";
  const m = { ...(x.machines[k] ?? {}) };
  if (name) m.name = name; else delete m.name;
  if (icon !== undefined) { if (icon) m.icon = icon; else delete m.icon; }
  if (Object.keys(m).length) x.machines[k] = m; else delete x.machines[k];
  return x;
}

export function withIcon(d, space, icon) {
  const x = tidyBar(d);
  if (icon) x.icons[space] = icon; else delete x.icons[space];
  return x;
}

// ---- the order the person dragged each machine's spaces into (SHEP-130) ----
// Kept in the sidebar's own data (shared "spaces-chat".order: { [machine name, "" for this computer]: [space ids] }),
// so it holds on every device and for every space, those Herdr doesn't keep too (a space the service made with no
// window is never in Herdr's list, and was always last). The web, the service and the window all show it; spaces it
// doesn't name keep Herdr's place among the rest (after the one before them there).
export const orderKey = (machine) => machine ?? "";

// ids in a new order, the ones `was` has that ids lacks put back after the one they followed there (first: at the top).
export function keptOrder(was, ids) {
  const out = [...new Set(ids)];
  for (const [i, id] of was.entries()) {
    if (out.includes(id)) continue;
    const after = was.slice(0, i).findLast((x) => out.includes(x));
    out.splice(after === undefined ? 0 : out.indexOf(after) + 1, 0, id);
  }
  return out;
}

// list (any machines', in Herdr's order) with each machine's spaces in the saved order; each machine's spaces keep the
// slots they had in list, so the machines stay as they were.
export function inOrder(list, order, idOf = (s) => s.id, machineOf = (s) => s.machine ?? null) {
  if (!order || typeof order !== "object" || !Object.keys(order).length) return list;
  const by = new Map();
  for (const x of list) {
    const k = orderKey(machineOf(x));
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(x);
  }
  const sorted = new Map();
  for (const [k, xs] of by) {
    const want = Array.isArray(order[k]) ? order[k] : [];
    const ids = xs.map(idOf);
    const of = new Map(xs.map((x) => [idOf(x), x]));
    sorted.set(k, keptOrder(ids, want.filter((id) => of.has(id))).map((id) => of.get(id)));
  }
  const at = new Map();
  return list.map((x) => {
    const k = orderKey(machineOf(x)), n = at.get(k) ?? 0;
    at.set(k, n + 1);
    return sorted.get(k)[n];
  });
}

// The sidebar's data with machine's spaces in a new order: ids as they show (some may be in sections or hidden),
// `now` the machine's spaces as they show now, all of them; the rest stay where they were among them.
export function withOrder(d, machine, ids, now = []) {
  const x = tidyBar(d);
  const order = x.order && typeof x.order === "object" && !Array.isArray(x.order) ? { ...x.order } : {};
  order[orderKey(machine)] = keptOrder(now, ids);
  return { ...x, order };
}

// ---- the order the person dragged the machines into (SHEP-153) ----
// Kept beside the spaces' order (shared "spaces-chat".machineOrder: [machine names, "" for this computer]), so the
// sidebar on every device, the window and the task lists show the machines alike. None saved: this computer first, then
// the rest as they come. A machine it doesn't name (new) goes at the end; one gone simply isn't shown.
export const machineOrderOf = (d) => (Array.isArray(d?.machineOrder) ? d.machineOrder.filter((k) => typeof k === "string") : []);

// keys ("" this computer, else names; null reads as "") in the saved order, the rest after them as they came.
export function machinesInOrder(keys, saved) {
  const all = [...new Set(keys.map(orderKey))];
  const first = [...new Set(saved ?? [])].filter((k) => all.includes(k));
  return [...first, ...all.filter((k) => !first.includes(k))];
}

// list (anything with a machine) in the machines' order, each machine's own in the order they had.
export function byMachineOrder(list, saved, machineOf = (x) => x.machine ?? null) {
  if (!saved?.length) return list;
  const keys = machinesInOrder(list.map(machineOf), saved);
  const at = (x) => keys.indexOf(orderKey(machineOf(x)));
  return list.map((x, i) => [x, i]).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map(([x]) => x);
}

// The sidebar's data with the machines in a new order: keys as they show ("" this computer); those it had that keys
// lacks (a machine offline elsewhere, or unknown here) stay after the one they followed.
export function withMachineOrder(d, keys) {
  const x = tidyBar(d);
  return { ...x, machineOrder: keptOrder(machineOrderOf(d), keys.map(orderKey)) };
}
