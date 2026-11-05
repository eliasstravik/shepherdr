// Spaces as the person knows them: each machine's spaces (Herdr's own layout document, "herdr-app", per
// machine), each with its tabs, its Assistant (the live coordinator terminal labelled for it) and whether that
// Assistant has something new (unread: the core label herdr.chat.read, the same on every device). The window
// gets spaces from Herdr (spaces()); the service and the web app build them here from the same documents.
// Shared core: the source is core/spaces.js; bin/sync-shared copies it into the mods in lib/COPIES.

export const READ = "herdr.chat.read";
export const machineOf = (address) => (String(address).includes("/") ? String(address).split("/")[0] : null);

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
  return (Array.isArray(doc?.spaces) ? doc.spaces : []).map((s) => ({
    id: at(s.id),
    machine,
    name: s.name ?? "",
    folder: s.folder ?? "",
    tabs: (s.tabs ?? []).map((t) => ({ id: at(t.id), name: t.name ?? "", terminals: terminalsIn(t.root).map(at) })),
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
