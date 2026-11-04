// Sections, as Slack's sidebar: a machine's spaces put under named headings, each with its own
// order and fold; spaces in none stay at the top, under the machine. And each space's icon: an
// emoji the person picked, else the "#". Both kept in shared "spaces-chat" (shared.json: it
// survives restarts) = { sections: [{ id, machine, name, folded, spaces: [space ids], icon? (an emoji;
// none: the folder) }], icons: { space: emoji }, pinned: [space ids], pinnedFolded, machines:
// { [machine name, "" for this computer]: { name?, icon? } } }.
// Pinned (as Shepherdr's, Slack's starred): spaces from any machine, in their own order, shown at
// the top of the sidebar instead of under their machine. A pinned space keeps its section, so
// Unpin puts it back where it was. A machine's name and emoji here are only what the sidebar
// shows: its hc name stays.

import { shared, setShared, machines } from "herdr";
import { spaces } from "./live.js";
import { toast } from "./ui.js";
import { DELETED, deletedSection, sectionDeletedToast, withRestoredSection } from "./core/spaces.js";

const KEY = "spaces-chat";

export function data() {
  const d = shared(KEY) ?? {};
  return { ...d, sections: d.sections ?? [], icons: d.icons ?? {}, pinned: d.pinned ?? [], machines: d.machines ?? {} };
}
const save = (d) => setShared(KEY, d);
const same = (a, b) => (a ?? null) === (b ?? null);

export const sectionsOf = (machine) => data().sections.filter((s) => same(s.machine, machine));
export const sectionOf = (space) => data().sections.find((s) => s.spaces.includes(space)) ?? null;
export const iconOf = (space) => data().icons[space] ?? null;

// A name a machine's other sections don't have already (case aside).
export const nameFree = (machine, name, except) =>
  !sectionsOf(machine).some((s) => s.id !== except && s.name.toLowerCase() === name.trim().toLowerCase());

// Puts a space in a section at `at` (its end if missing), or back at the top (section null).
// `at` counts the section's spaces without this one.
export function placeSpace(space, section, at) {
  const d = data();
  const sections = d.sections.map((s) => ({ ...s, spaces: s.spaces.filter((x) => x !== space) }));
  const s = sections.find((x) => x.id === section);
  if (s) s.spaces.splice(Math.min(at ?? s.spaces.length, s.spaces.length), 0, space);
  save({ ...d, sections });
}

// A new section at the end of its machine's; `space` goes straight into it.
export function addSection(machine, name, space) {
  const d = data();
  const id = `sec-${Date.now().toString(36)}`;
  save({ ...d, sections: [...d.sections, { id, machine: machine ?? null, name: name.trim(), folded: false, spaces: [] }] });
  if (space) placeSpace(space, id);
  return id;
}

const change = (id, f) => {
  const d = data();
  save({ ...d, sections: d.sections.map((s) => (s.id === id ? f(s) : s)) });
};
export const renameSection = (id, name) => change(id, (s) => ({ ...s, name: name.trim() }));
export const setSectionIcon = (id, emoji) => change(id, (s) => { const { icon: _, ...rest } = s; return emoji ? { ...rest, icon: emoji } : rest; });
export const foldSection = (id) => change(id, (s) => ({ ...s, folded: !s.folded }));
export const unfoldSection = (id) => change(id, (s) => ({ ...s, folded: false }));

// Its spaces go back to the top; no space closes. A toast offers Undo for a few seconds: its click
// runs spaces-chat.undo-section (main.js), which puts the section back as it was from shared
// "spaces-chat.deleted" = { section, at } (the last one deleted).
// The kept section, its toast's words and the Undo are the shared core's (core/spaces.js): the web's Delete does the same.
export function deleteSection(id) {
  const d = data();
  const gone = deletedSection(d, id);
  if (!gone) return;
  setShared(DELETED, gone);
  save({ ...d, sections: d.sections.filter((s) => s.id !== id) });
  toast({ ...sectionDeletedToast(gone.section.name), level: "info", timeout: 8000, action: { name: "spaces-chat.undo-section" } });
}

// Undo: back in its place, with those of its spaces no other section took meanwhile.
export function restoreSection() {
  const gone = shared(DELETED);
  if (!gone?.section) return;
  setShared(DELETED, null);
  const d = data();
  if (d.sections.some((s) => s.id === gone.section.id)) return;
  save({ ...d, sections: withRestoredSection(d, gone).sections });
}

export function setIcon(space, emoji) {
  const d = data();
  const icons = { ...d.icons };
  if (emoji) icons[space] = emoji;
  else delete icons[space];
  save({ ...d, icons });
}

// Spaces gone from a machine whose layout reads fine leave sections and icons quietly. A machine
// away keeps its own: its spaces are only out of sight. Also keeps a space in one section only.
export function prune() {
  const d = data();
  if (!d.sections.length && !Object.keys(d.icons).length && !d.pinned.length) return;
  const ready = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name ?? ""));
  const live = new Set(spaces().map((s) => s.id));
  // Remote ids are "<machine>/<id>".
  const gone = (id) => !live.has(id) && ready.has(id.includes("/") ? id.split("/")[0] : "");
  const seen = new Set();
  let changed = false;
  const sections = d.sections.map((s) => {
    const kept = s.spaces.filter((id) => !gone(id) && !seen.has(id));
    kept.forEach((id) => seen.add(id));
    if (kept.length !== s.spaces.length) changed = true;
    return kept.length === s.spaces.length ? s : { ...s, spaces: kept };
  });
  const icons = Object.fromEntries(Object.entries(d.icons).filter(([id]) => !gone(id)));
  if (Object.keys(icons).length !== Object.keys(d.icons).length) changed = true;
  const pinned = d.pinned.filter((id) => !gone(id));
  if (pinned.length !== d.pinned.length) changed = true;
  if (changed) save({ ...d, sections, icons, pinned });
}

// Pinned: `space` to its end (or at `at`, counted without it), or out of it (`on` false).
export const isPinned = (space) => data().pinned.includes(space);
export function pin(space, on = true, at) {
  const d = data();
  const pinned = d.pinned.filter((x) => x !== space);
  if (on) pinned.splice(Math.min(at ?? pinned.length, pinned.length), 0, space);
  save({ ...d, pinned });
}
export const foldPinned = () => { const d = data(); save({ ...d, pinnedFolded: !d.pinnedFolded }); };

// A machine (null: this computer) as the sidebar shows it: its own name unless renamed, and an
// emoji or none (its server or monitor icon).
const mkey = (machine) => machine ?? "";
export function machineLook(machine) {
  const m = data().machines[mkey(machine)] ?? {};
  return { name: m.name || (machine ?? "This computer"), named: Boolean(m.name), icon: m.icon ?? null };
}
// "" gives the machine its own name back; no emoji, its icon.
export function setMachineLook(machine, name, icon) {
  const d = data();
  const look = { ...(name.trim() ? { name: name.trim() } : {}), ...(icon ? { icon } : {}) };
  const all = { ...d.machines };
  if (Object.keys(look).length) all[mkey(machine)] = look;
  else delete all[mkey(machine)];
  save({ ...d, machines: all });
}
