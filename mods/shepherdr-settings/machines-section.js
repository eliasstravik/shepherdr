// Settings > Machines (HERD-40), as Shepherdr's Machine settings and its health and plan-limits
// views. Machine-only settings live here as rows (there is no machine scope any more):
// - When new tasks wait, for all machines: start limits ("machine" in Everywhere's layer of
//   ~/.config/shepherdr/settings.json: { start_load (× cores, shown as a percent of all cores),
//   start_memory, start_disk }; herdr-task's tick holds queued tasks by them), and how task agents
//   run (low_priority, worker_memory; HERD-61, herdr-task's machine_option()).
// - Then each machine: its health and what is left of each agent CLI's plan (machines.js), its
//   Home Assistant, and its own limits (machines[key].machine) when it sets any ("Set its own").
// Values a machine set for all its spaces before (agents, tasks: the old machine scope) still
// apply there (herdr-task's settings_for and coordinator.js read them); they show on that
// machine with Reset, and nothing new is written there.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { machines, home, readTextFile, setShared, shared } from "herdr";
import { machinesInOrder, machineOrderOf } from "./core/spaces.js";
import { HOLD, machineDetails, pollNow } from "./machines.js";
import { LOCAL_MACHINE } from "./coordinator.js";
import { TEXT, button, link, toggleSwitch } from "./ui.js";
import { dirsReady } from "./dirs.js";
// The rows' words, a machine block's and Home Assistant's lines: core/settings.js, shared with the web app.
import { MACHINES, OLD_NAMES, SECTIONS, SET_FOR_MACHINE, RESET, SAME_AS_ALL_MACHINES, machinesOwn, homeAbout, machineLabel } from "./core/settings.js";

const pct = (v) => (v == null ? "Off" : `${v}%`);
const words = (field) => MACHINES.limits.find((l) => l.field === field);
const LIMITS = [
  { ...words("start_memory"), step: 5, lo: 10, hi: 100, fmt: pct },
  { ...words("start_load"), step: 0.25, lo: 0.25, hi: 4, fmt: (v) => (v == null ? "Off" : `${Math.round(v * 100)}%`) },
  { ...words("start_disk"), step: 5, lo: 10, hi: 100, fmt: pct },
];
const CAPS = [0, 1, 2, 4, 8, 16, 32];
const OPTION_DEFAULTS = { low_priority: true, worker_memory: 0 };
const FIELDS = [...LIMITS.map((l) => l.field), "low_priority", "worker_memory"];

const toMachine = (key) => (key === LOCAL_MACHINE ? null : key); // machines.js: null is this computer
const label = machineLabel;
// in the sidebar's order (shared "spaces-chat".machineOrder, SHEP-153), as the web app's Settings
const keysNow = () => machinesInOrder([null, ...machines().filter((m) => m.name && !m.temporary).map((m) => m.name)], machineOrderOf(shared("spaces-chat")))
  .map((k) => k || LOCAL_MACHINE);

// Reads plan limits older than a minute the first time the section shows.
function askOnce(view, cx) {
  if (view._machinesAsked) return;
  view._machinesAsked = true;
  cx.spawn(async (cx) => { await pollNow({ limitsOlder: 60000 }); cx.notify(); });
}

// Home Assistant (HERD-51), as Shepherdr's home spaces: a machine's home space (its ~) has an
// Assistant that also looks after the machine; this computer's keeps every machine's overview.
// Per machine in ~/.config/shepherdr/settings.json machines[key].home; unset, on for this computer only.
// What herdr-task's home round last found (~/.local/share/shepherdr/tasks/.home.json) says how each is now.
export const homeOn = (cfg, key) => {
  const v = cfg?.machines?.[key]?.home;
  return typeof v === "boolean" ? v : key === LOCAL_MACHINE;
};
function readHome(view, cx) {
  if (view._homeAt && Date.now() - view._homeAt < 15000) return;
  view._homeAt = Date.now();
  cx.spawn(async (cx) => {
    try { view._home = JSON.parse((await readTextFile(`${(await dirsReady()).tasks}/.home.json`)) ?? "{}") ?? {}; } catch { view._home = {}; }
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
  const about = homeAbout(on, st);
  const missing = on && !st?.space && !st?.error && view._home;
  return view.row(t, MACHINES.home.title, about, h_flex().gap(10).items_center()
    .when(Boolean(missing), (el) => el.child(button(`home-make-${k}`, MACHINES.home.make, { onClick: () => make() })))
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
// how many set their own; on a machine, "Inherited from all machines" or "Set for this machine · Reset".
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
        ? row.child(div().text_color(t.muted).child(SET_FOR_MACHINE)).child(div().text_color(t.dim).child("·"))
          .child(link(`ml-reset-${id(f)}`, RESET, (_e, cx) => write(view, key, f, undefined, cx)))
        : row.child(div().text_color(t.dim).child(SAME_AS_ALL_MACHINES));
    }
    const n = Object.values(view.cfg.machines ?? {}).filter((m) => f in (m?.machine ?? {})).length;
    return n ? row.child(div().text_color(t.dim).child(machinesOwn(n))) : null;
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
    view.row(t, MACHINES.low.title, MACHINES.low.about,
      toggleSwitch(`ml-${id("low")}`, low, (next, _e, cx) => put("low_priority", next, cx)), null, null, line("low_priority")),
    view.row(t, MACHINES.cap.title, MACHINES.cap.about,
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
    .when(!open, (el) => el.child(view.row(t, MACHINES.own.title, MACHINES.own.about,
      button(`ml-own-${k}`, MACHINES.own.button, { onClick: () => { view._machOpen[k] = true; } }))))
    .when(Boolean(open), (el) => el.children(limitRows(view, t, k)))
    .when(oldNames.length > 0, (el) => el.child(view.row(t, MACHINES.old.title, MACHINES.old.about(oldNames),
      button(`ml-old-${k}`, RESET, { onClick: dropOld }))));
}

export function machinesSection(view, t, cx) {
  readHome(view, cx);
  askOnce(view, cx);
  return v_flex()
    .child(view.title(t, SECTIONS.find((s) => s.id === "machines").title))
    .child(view.heading(t, MACHINES.heading))
    .children(limitRows(view, t, null))
    .children(keysNow().map((k) => machineBlock(view, t, k)));
}
