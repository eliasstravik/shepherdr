// Settings > Machines (HERD-40), as Shepherdr's Machine settings and its health and plan-limits
// views. Machine-only settings live here as rows (there is no machine scope any more):
// - When new tasks wait, for all machines: start limits ("machine" in Everywhere's layer of
//   ~/.herdr/shepherdr.json: { start_load (× cores, shown as a percent of all cores),
//   start_memory, start_disk }; herdr-task's tick holds queued tasks by them), and how task agents
//   run (low_priority, worker_memory; HERD-61, herdr-task's machine_option()).
// - Then each machine: its health and what is left of each agent CLI's plan (machines.js), its
//   Home Assistant, and its own limits (machines[key].machine) when it sets any ("Set its own").
// Values a machine set for all its spaces before (agents, tasks: the old machine scope) still
// apply there (herdr-task's settings_for and coordinator.js read them); they show on that
// machine with Reset, and nothing new is written there.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { machines, home, readTextFile, setShared } from "herdr";
import { HOLD, machineDetails, pollNow } from "./machines.js";
import { LOCAL_MACHINE } from "./coordinator.js";
import { TEXT, button, link, toggleSwitch } from "./ui.js";

const pct = (v) => (v == null ? "Off" : `${v}%`);
const LIMITS = [
  { field: "start_memory", title: "Memory busy above", about: "New tasks there wait while more memory is in use.",
    step: 5, lo: 10, hi: 100, fmt: pct },
  { field: "start_load", title: "CPU busy above", about: "The 1-minute load, as a share of all its cores.",
    step: 0.25, lo: 0.25, hi: 4, fmt: (v) => (v == null ? "Off" : `${Math.round(v * 100)}%`) },
  { field: "start_disk", title: "Disk busy above", about: "Its home or /tmp, whichever is fuller.",
    step: 5, lo: 10, hi: 100, fmt: pct },
];
const CAPS = [0, 1, 2, 4, 8, 16, 32];
const OPTION_DEFAULTS = { low_priority: true, worker_memory: 0 };
const FIELDS = [...LIMITS.map((l) => l.field), "low_priority", "worker_memory"];
// What the old machine scope could hold, as the person knows it.
const OLD_NAMES = { coordinator: "Assistant", worker: "Workers", reviewer: "Reviewer", backup: "Backup agent",
  automations: "Run automations", merge: "Merge", review_rounds: "Review", must_fix: "Must fix", proof: "Proof",
  max_running: "Tasks at once", archive_after: "Archive Done after", worktrees: "Worktrees",
  start_notes: "When a task starts", finish_notes: "When a task finishes", base: "Base branch" };

const toMachine = (key) => (key === LOCAL_MACHINE ? null : key); // machines.js: null is this computer
const label = (key) => (key === LOCAL_MACHINE ? "This computer" : key);
const keysNow = () => [LOCAL_MACHINE, ...machines().filter((m) => m.name && !m.temporary).map((m) => m.name)];

// Reads plan limits older than a minute the first time the section shows.
function askOnce(view, cx) {
  if (view._machinesAsked) return;
  view._machinesAsked = true;
  cx.spawn(async (cx) => { await pollNow({ limitsOlder: 60000 }); cx.notify(); });
}

// Home Assistant (HERD-51), as Shepherdr's home spaces: a machine's home space (its ~) has an
// Assistant that also looks after the machine; this computer's keeps every machine's overview.
// Per machine in ~/.herdr/shepherdr.json machines[key].home; unset, on for this computer only.
// What herdr-task's home round last found (~/.herdr/tasks/.home.json) says how each is now.
export const homeOn = (cfg, key) => {
  const v = cfg?.machines?.[key]?.home;
  return typeof v === "boolean" ? v : key === LOCAL_MACHINE;
};
function readHome(view, cx) {
  if (view._homeAt && Date.now() - view._homeAt < 15000) return;
  view._homeAt = Date.now();
  cx.spawn(async (cx) => {
    try { view._home = JSON.parse((await readTextFile(`${home()}/.herdr/tasks/.home.json`)) ?? "{}") ?? {}; } catch { view._home = {}; }
    cx.notify();
  });
}
function homeRow(view, t, k) {
  const on = homeOn(view.cfg, k), st = view._home?.machines?.[k];
  const make = () => setShared("home.makereq", { machine: toMachine(k), at: Date.now() });
  const set = (_next, _e, cx) => {
    view.change((next) => {
      const layer = ((next.machines ??= {})[k] ??= {});
      // Kept only where it differs from the default (on for this computer only).
      if (!on === (k === LOCAL_MACHINE)) delete layer.home;
      else layer.home = !on;
      if (!Object.keys(layer).length) delete next.machines[k];
    }, cx);
    if (!on) make();
    view._homeAt = 0;
  };
  const about = !on ? "Off: nobody watches its disk, load and processes."
    : st?.assistant ? "Its home space's Assistant watches its disk, load and processes."
    : st?.space ? "Its home Assistant starts when you first write to it."
    : st?.error ? "Couldn't read it now. Trying again every minute."
    : "No home space there.";
  const missing = on && !st?.space && !st?.error && view._home;
  return view.row(t, "Home Assistant", about, h_flex().gap(10).items_center()
    .when(Boolean(missing), (el) => el.child(button(`home-make-${k}`, "Make home space", { onClick: () => make() })))
    .child(toggleSwitch(`home-${k}`, on, set)));
}

// Writes one machine setting: for all machines (key null) or one machine's own; undefined drops it.
function write(view, key, field, value, cx) {
  view.change((next) => {
    const layer = key ? ((next.machines ??= {})[key] ??= {}) : (next.everywhere ??= {});
    const m = { ...(layer.machine ?? {}) };
    if (value === undefined) delete m[field];
    else m[field] = value;
    if (Object.keys(m).length) layer.machine = m;
    else delete layer.machine;
    if (key && !Object.keys(layer).length) delete next.machines[key];
  }, cx);
}

// The five rows, for all machines (key null) or one machine's own. Under each: on all machines,
// how many set their own; on a machine, "Same as all machines" or "Changed here · Reset".
function limitRows(view, t, key) {
  const every = view.cfg.everywhere?.machine ?? {};
  const own = key ? view.cfg.machines?.[key]?.machine ?? {} : every;
  const base = (f) => (f in every ? every[f] : f in HOLD ? HOLD[f] : OPTION_DEFAULTS[f]);
  const valueOf = (f) => (f in own ? own[f] : base(f));
  const id = (f) => `${key ?? "all"}-${f}`;
  const line = (f) => {
    const row = h_flex().gap(6).items_center().text_size(TEXT.label);
    if (key) {
      return f in own
        ? row.child(div().text_color(t.muted).child("Changed here")).child(div().text_color(t.dim).child("·"))
          .child(link(`ml-reset-${id(f)}`, "Reset", (_e, cx) => write(view, key, f, undefined, cx)))
        : row.child(div().text_color(t.dim).child("Same as all machines"));
    }
    const n = Object.values(view.cfg.machines ?? {}).filter((m) => f in (m?.machine ?? {})).length;
    return n ? row.child(div().text_color(t.dim).child(n === 1 ? "1 machine uses its own" : `${n} machines use their own`)) : null;
  };
  // Set to what it would be anyway: on a machine, it follows all machines again.
  const put = (f, v, cx) => write(view, key, f, key && JSON.stringify(v) === JSON.stringify(base(f)) ? undefined : v, cx);
  const rows = LIMITS.map((l) => {
    const v = valueOf(l.field);
    const step = (d) => (_e, cx) => put(l.field, Math.round(Math.max(l.lo, Math.min(l.hi, (v ?? HOLD[l.field]) + d)) * 100) / 100, cx);
    return view.row(t, l.title, l.about, view.stepper(t, `ml-${id(l.field)}`, l.fmt(v), step(-l.step), step(l.step)), null, null, line(l.field));
  });
  const low = valueOf("low_priority") !== false;
  const cap = Number(valueOf("worker_memory")) || 0;
  const capStep = (d) => (_e, cx) => put("worker_memory", CAPS[Math.max(0, Math.min(CAPS.length - 1, CAPS.findIndex((c) => c >= cap) + d))], cx);
  rows.push(
    view.row(t, "Workers run at low priority", "Task agents start below the Assistant and your apps, and are ended first when memory runs out.",
      toggleSwitch(`ml-${id("low")}`, low, (next, _e, cx) => put("low_priority", next, cx)), null, null, line("low_priority")),
    view.row(t, "Memory cap per worker", "A worker over it is slowed down, not ended. Applies to tasks started after a change.",
      view.stepper(t, `ml-${id("cap")}`, cap ? `${cap} GB` : "Off", capStep(-1), capStep(1)), null, null, line("worker_memory")));
  return rows;
}

// One machine: its health and plans, its Home Assistant, its own limits, and what it set before.
function machineBlock(view, t, k) {
  const layer = view.cfg.machines?.[k] ?? {};
  const ownLimits = FIELDS.some((f) => f in (layer.machine ?? {}));
  view._machOpen ??= {};
  const open = ownLimits || view._machOpen[k];
  const old = Object.entries(layer).filter(([key]) => !["machine", "home"].includes(key))
    .flatMap(([key, v]) => (["tasks", "automations"].includes(key) && v && typeof v === "object" ? Object.keys(v).map((f) => (key === "automations" ? key : f)) : [key]));
  const oldNames = [...new Set(old.map((x) => OLD_NAMES[x] ?? x))];
  const dropOld = (_e, cx) => view.change((next) => {
    const l = next.machines?.[k];
    if (!l) return;
    for (const key of Object.keys(l)) if (!["machine", "home"].includes(key)) delete l[key];
    if (!Object.keys(l).length) delete next.machines[k];
  }, cx);
  return v_flex().id(`mach-${k}`)
    .child(div().pt(26).pb(10).text_size(TEXT.body).font_semibold().text_color(t.foreground).child(label(k)))
    .child(div().pb(12).border_b(1).border_color(t.border).child(machineDetails(t, toMachine(k))))
    .child(homeRow(view, t, k))
    .when(!open, (el) => el.child(view.row(t, "Limits", "Same as all machines.",
      button(`ml-own-${k}`, "Set its own", { onClick: () => { view._machOpen[k] = true; } }))))
    .when(Boolean(open), (el) => el.children(limitRows(view, t, k)))
    .when(oldNames.length > 0, (el) => el.child(view.row(t, "Set before for its spaces",
      `${oldNames.join(", ")}. These still apply to its spaces unless a space sets its own.`,
      button(`ml-old-${k}`, "Reset", { onClick: dropOld }))));
}

export function machinesSection(view, t, cx) {
  readHome(view, cx);
  askOnce(view, cx);
  return v_flex()
    .child(view.title(t, "Machines"))
    .child(view.heading(t, "When new tasks wait, on every machine"))
    .children(limitRows(view, t, null))
    .children(keysNow().map((k) => machineBlock(view, t, k)));
}
