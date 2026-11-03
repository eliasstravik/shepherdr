// Notify, as Shepherdr's (shared/alerts.ts): what reaches the person from a space's Assistant.
//   All       every new message from it alerts too
//   Needs me  its questions and alerts (the default)
//   Off       nothing from it; its sidebar row is muted: dimmed, a crossed-out bell, never bold
//             (red and green counts still show)
// Tasks alert as always, whatever it says. Kept in shared "notify" = { everywhere, machines: {
// [machine]: value }, spaces: { [space id]: value } } (machine: "local" for this computer, else
// its name): the most specific one set wins. A space row's menu sets the space's
// (mods/spaces-chat), Shepherdr settings' Notify any of them (mods/shepherdr-settings). Picking
// what it would get anyway goes back to following.
// Shared: the source is lib/notify.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/notify.js, never a mod's copy, then run bin/sync-shared.

import { shared, setShared } from "herdr";

export const NOTIFY = ["All", "Needs me", "Off"];
export const NOTIFY_DEFAULT = "Needs me";
export const NOTIFY_HINT = {
  All: "Every new message from its Assistant.",
  "Needs me": "Its Assistant's questions and alerts.",
  Off: "Nothing from its Assistant. Its row stays quiet.",
};

const valid = (v) => (NOTIFY.includes(v) ? v : null);
const stored = () => shared("notify") ?? {};

export const notifyEverywhere = () => valid(stored().everywhere) ?? NOTIFY_DEFAULT;
const machineOf = (space) => (String(space).includes("/") ? String(space).split("/")[0] : "local");

// A machine's Notify ("local" or its name), and whether it sets its own.
export const notifyMachine = (m) => valid(stored().machines?.[m]) ?? notifyEverywhere();
export const notifyMachineOwn = (m) => Boolean(valid(stored().machines?.[m]));

// A space's Notify (an app space id, "vm/sp3" on another machine), and whether it sets its own.
export const notifyOf = (space) => valid(stored().spaces?.[space]) ?? notifyMachine(machineOf(space));
export const notifyOwn = (space) => Boolean(valid(stored().spaces?.[space]));
export const muted = (space) => notifyOf(space) === "Off";

// Writes a change, then drops what now says what it would get anyway: a machine set to
// Everywhere's, a space set to its machine's.
function save(s) {
  const everywhere = valid(s.everywhere) ?? NOTIFY_DEFAULT;
  const machines = Object.fromEntries(Object.entries(s.machines ?? {}).filter(([, v]) => valid(v) && v !== everywhere));
  const spaces = Object.fromEntries(Object.entries(s.spaces ?? {})
    .filter(([id, v]) => valid(v) && v !== (machines[machineOf(id)] ?? everywhere)));
  setShared("notify", { ...s, everywhere, machines, spaces });
}

export function setNotify(space, value) {
  const s = stored();
  save({ ...s, spaces: { ...(s.spaces ?? {}), [space]: valid(value) } });
}

export function setNotifyMachine(m, value) {
  const s = stored();
  save({ ...s, machines: { ...(s.machines ?? {}), [m]: valid(value) } });
}

export function setNotifyEverywhere(value) {
  save({ ...stored(), everywhere: valid(value) ?? NOTIFY_DEFAULT });
}

// The app space id a terminal belongs to: its labels hold its own machine's ids.
export function spaceOfTerminal(k) {
  const l = k?.labels ?? {};
  const id = l["herdr.coordinator.space"] ?? l["herdr.space"] ?? l["herdr.task.space"];
  if (!id) return null;
  const m = String(k.address ?? "").includes("/") ? k.address.split("/")[0] : null;
  return m ? `${m}/${id}` : id;
}

const isTask = (k) => Boolean(k?.labels?.["herdr.task"]);

// Does something from this agent reach the person: a task's always; else by its space's Notify.
// kind: "message" (a new reply: only All) or "need" (a question, a permission, an alert).
export function notifies(k, kind) {
  if (isTask(k)) return true;
  const space = spaceOfTerminal(k);
  const n = space ? notifyOf(space) : notifyEverywhere();
  return n === "All" || (n === "Needs me" && kind !== "message");
}
