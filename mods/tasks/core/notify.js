// Notify, as Shepherdr's (shared/alerts.ts): what reaches the person from a space's Assistant.
//   All       every new message from it alerts too
//   Needs me  its questions and alerts (the default)
//   Off       nothing from it; its sidebar row is muted: dimmed, a crossed-out bell, never bold
//             (red and green counts still show)
// Tasks alert as always, whatever it says. The setting s = { everywhere, machines: { [machine]: value },
// spaces: { [space id]: value } } (machine: "local" for this computer, else its name): the most specific one
// set wins. These rules take s as an argument, so the window (lib/notify.js, shared "notify") and the service
// and web app read it the same way.
// Shared core: the source is core/notify.js; bin/sync-shared copies it into the mods in lib/COPIES.

export const NOTIFY = ["All", "Needs me", "Off"];
export const NOTIFY_DEFAULT = "Needs me";
export const NOTIFY_HINT = {
  All: "Every new message from its Assistant.",
  "Needs me": "Its Assistant's questions and alerts.",
  Off: "Nothing from its Assistant. Its row stays quiet.",
};

const valid = (v) => (NOTIFY.includes(v) ? v : null);
export const machineOfSpace = (space) => (String(space).includes("/") ? String(space).split("/")[0] : "local");

export const everywhereOf = (s) => valid(s?.everywhere) ?? NOTIFY_DEFAULT;
// A machine's Notify ("local" or its name), and whether it sets its own.
export const machineLevel = (s, m) => valid(s?.machines?.[m]) ?? everywhereOf(s);
export const machineOwn = (s, m) => Boolean(valid(s?.machines?.[m]));
// A space's Notify (an app space id, "vm/sp3" on another machine), and whether it sets its own.
export const spaceLevel = (s, space) => valid(s?.spaces?.[space]) ?? machineLevel(s, machineOfSpace(space));
export const spaceOwn = (s, space) => Boolean(valid(s?.spaces?.[space]));

// A change, then dropping what now says what it would get anyway: a machine set to Everywhere's, a space set
// to its machine's.
export function tidy(s) {
  const everywhere = valid(s.everywhere) ?? NOTIFY_DEFAULT;
  const machines = Object.fromEntries(Object.entries(s.machines ?? {}).filter(([, v]) => valid(v) && v !== everywhere));
  const spaces = Object.fromEntries(Object.entries(s.spaces ?? {})
    .filter(([id, v]) => valid(v) && v !== (machines[machineOfSpace(id)] ?? everywhere)));
  return { ...s, everywhere, machines, spaces };
}
export const withSpace = (s, space, value) => tidy({ ...s, spaces: { ...(s?.spaces ?? {}), [space]: valid(value) } });
export const withMachine = (s, m, value) => tidy({ ...s, machines: { ...(s?.machines ?? {}), [m]: valid(value) } });
export const withEverywhere = (s, value) => tidy({ ...(s ?? {}), everywhere: valid(value) ?? NOTIFY_DEFAULT });

// The app space id a terminal belongs to: its labels hold its own machine's ids.
export function spaceOfTerminal(k) {
  const l = k?.labels ?? {};
  const id = l["herdr.coordinator.space"] ?? l["herdr.space"] ?? l["herdr.task.space"];
  if (!id) return null;
  const m = String(k.address ?? "").includes("/") ? k.address.split("/")[0] : null;
  return m ? `${m}/${id}` : id;
}

// Does something from this agent reach the person: a task's always; else by its space's Notify.
// kind: "message" (a new reply: only All) or "need" (a question, a permission, an alert).
export function notifiesBy(s, k, kind) {
  if (k?.labels?.["herdr.task"]) return true;
  const space = spaceOfTerminal(k);
  const n = space ? spaceLevel(s, space) : everywhereOf(s);
  return n === "All" || (n === "Needs me" && kind !== "message");
}
