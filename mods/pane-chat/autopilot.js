// Autopilot in an Assistant's header (DECISIONS.md, "Shepherdr gaps being closed": a plain on/off
// switch on the left, right after the agent name and folder). herdr-task keeps it (`herdr-task
// autopilot ...`, its scheduler wakes the Assistant) in ~/.local/share/shepherdr/tasks/.autopilot.json; this reads
// that file and asks herdr-task to change it. Another machine's space ("vm/sp1") the same, from
// that machine's file: herdr-task here hands its switch to herdr-task there, whose scheduler wakes
// it (its Assistant runs there).
//
// The switch: "Autopilot", and when on its next wake dim after it. No menu: the heartbeat, the
// schedule and the events, Everywhere's or this space's own, live in Shepherdr settings › Autopilot
// (core/autopilot.js pilotFor: this space's switch, its own or Everywhere's rest, from
// ~/.config/shepherdr/settings.json). It always turns on when clicked; while its heartbeat is still empty a
// "Write a heartbeat" link after it opens that page, on this space. The switch, its words and Run
// now are one group (apGroup) on a quiet pill as tall as Chat | Terminal, as the web app's header.

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { link, TEXT, H, RADIUS, openSettings, toast, plainError } from "./ui.js";
import { theme, home, appHome, exec, readTextFile, notify, shared, setShared } from "herdr";
import { terminals } from "./live.js";
import { pilotFor, headerDetail, flipped } from "./core/autopilot.js";
import { SH } from "./core/paths.js";
import { dirs } from "./dirs.js";

const FILE = () => `${dirs().tasks}/.autopilot.json`;
const SETTINGS = () => dirs().settings;
const CLI = () => `${appHome()}/mods/tasks/bin/herdr-task`;
// A narrow header shows the switch and Run now's ▶ only.
export const COMPACT_BELOW = 480;

// The space whose Assistant runs in this terminal (or waits in this lazy slot), else null; another
// machine's as "vm/sp1".
export function apSpace(address, lazy) {
  if (lazy) return lazy.space ? String(lazy.space) : null;
  if (!address) return null;
  const l = terminals().find((x) => x.address === address)?.labels ?? {};
  if (l["herdr.role"] !== "coordinator") return null;
  // As herdr-task finds an Assistant's own space (my_space): its label is its id on its own machine.
  const sp = l["herdr.space"] ?? l["herdr.coordinator.space"];
  const m = address.includes("/") ? address.slice(0, address.indexOf("/")) : null;
  return !sp ? null : m ? `${m}/${sp.split("/").pop()}` : sp.includes("/") ? null : sp;
}

// Another machine's space: (its machine, its id there); null for this computer's.
const remoteOf = (space) => (space.includes("/") ? { machine: space.slice(0, space.indexOf("/")), id: space.slice(space.indexOf("/") + 1) } : null);
// Its machine's file, read there each third poll (about every 12 s): herdr-core asks it over the link.
const READ = SH + 'cat "$SHEP_TASKS/.autopilot.json" 2>/dev/null || true';
async function fileOf(view, space) {
  const r = remoteOf(space);
  if (!r) return JSON.parse((await readTextFile(FILE())) ?? "{}");
  if (view.apFile && view.apFile.space === space && (view.apTick = (view.apTick ?? 0) + 1) % 3) return view.apFile.file;
  const out = (await exec("sh", ["-c", READ], { on: r.machine })).stdout;
  const d = JSON.parse(out || "{}");
  // Named as this computer names it, so this space's own settings here (by "vm/sp1") apply.
  const file = { ...d, spaces: { [space]: d?.spaces?.[r.id] ?? {} } };
  view.apFile = { space, file };
  return file;
}

// What the header shows, its words too: "Next in 7 min" counts down between reads (each poll looks again).
const sig = (a) => JSON.stringify([a?.on, a?.next_run, Boolean(a?.pending), Boolean(a?.inflight), a?.every, a?.events, headerDetail(a)]);

// Reads this header's space from the file; redraws only when what the switch shows changed.
export function apPoll(view, cx) {
  const space = view.apFor;
  if (!space || view.apBusy) return;
  cx.spawn(async (cx) => {
    let a = null;
    // What applies here: the space's own, else Everywhere's (core/autopilot.js, herdr-task's rule).
    let cfg = null;
    try { cfg = JSON.parse((await readTextFile(SETTINGS())) ?? "{}"); } catch {}
    try { a = pilotFor(await fileOf(view, space), space, cfg); } catch { a = view.ap ?? { on: false }; }
    if (view.apFor !== space || view.apBusy) return;
    // On with its heartbeat maybe empty: looked at now and then (about every 30 s) until written.
    if (a.on && view.apBlank !== false && (view.apBeat = (view.apBeat ?? 0) + 1) % 8 === 1) checkBlank(view, space, cx);
    if (!a.on) view.apBlank = null;
    if (view.ap && sig(a) === sig(view.ap)) return;
    view.ap = a;
    cx.notify();
  });
}

// Whether this space's heartbeat is still empty (view.apBlank); redraws when that changes.
function checkBlank(view, space, cx) {
  cx.spawn(async (cx) => {
    let blank = null;
    try { blank = Boolean((await ap(["show"], space)).blank); } catch {}
    if (view.apFor !== space || blank === null || blank === view.apBlank) return;
    view.apBlank = blank;
    cx.notify();
  });
}

// Called from render: a new space (or a nudge after a flip) reads the file again.
export function apWatch(view, space, cx) {
  const bump = shared("autopilot.at") ?? 0;
  if (space === view.apFor && bump === view.apBump) return;
  if (space !== view.apFor || bump !== view.apBump) view.apFile = null;
  if (space !== view.apFor) { view.ap = null; view.apBlank = null; view.apBeat = 0; }
  view.apFor = space;
  view.apBump = bump;
  if (space) cx.timer.after(0, (cx) => apPoll(view, cx));
}

// What follows "Autopilot" while on (core/autopilot.js, the web's header too).
const detail = (a) => headerDetail(a);

// The switch as Shepherdr settings draws its toggles, header-sized; the knob slides.
function knob(t, on, pane) {
  return div().relative().w(28).h(16).flex_none().rounded(8).bg(on ? t.accent : t.hover)
    .child(div().id(`ap-knob-${pane}`).absolute().top(2).left(on ? 14 : 2).size(12).rounded(6)
      .bg(on ? t.accent_foreground : t.muted).transition("left", 120));
}

// The group: on a pill as tall as Chat | Terminal (ui.js segmented: H.sm, raised). While on, what it waits for and Run now
// (apRunNow) come first, on the switch's LEFT, then the switch and "Autopilot" (SHEP-81): the pill grows
// leftwards and the switch never moves, on or off. Compact: Run now's ▶ and the switch only.
export function apGroup(view, t, space, pane, compact) {
  const run = apRunNow(view, t, space, pane, compact);
  const a = view.ap;
  const words = !compact && a?.on ? detail(a) : "";
  return h_flex().id(`ap-group-${pane}`).flex_none().h(H.sm).p(2).gap(7).items_center()
    .pr(compact ? 6 : 10).pl(words ? 10 : run ? 2 : 6)
    .rounded(RADIUS.control).bg(t.raised).text_size(TEXT.label)
    .when(Boolean(words), (el) => el.child(div().flex_none().whitespace_nowrap().text_color(t.dim)
      .when(Boolean(a?.inflight), (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1200 }))
      .child(words)))
    .when(Boolean(run), (el) => el.child(run))
    .child(apChip(view, t, space, pane, compact));
}

function apChip(view, t, space, pane, compact) {
  const on = Boolean(view.ap?.on);
  return h_flex().id(`ap-${pane}`).flex_none().gap(7).items_center().cursor_pointer()
    .on_click((_e, cx) => { cx.stop_propagation(); apToggle(view, space, cx); })
    .child(knob(t, on, pane))
    .when(!compact, (el) => el.child(div().flex_none().font_medium().text_color(on ? t.foreground : t.muted).child("Autopilot")));
}

// herdr-task autopilot <args> --space <space>: its JSON, or throws with its words.
async function ap(args, space) {
  const r = await exec(CLI(), ["autopilot", ...args, "--space", space, "--json"]).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  let out = null;
  try { out = JSON.parse(r.stdout); } catch {}
  if (r.code !== 0 || !out || out.error) throw new Error(out?.error ?? (r.stderr || "herdr-task failed").replace(/^herdr-task: /, "").trim());
  return out;
}

// Settings › Autopilot on this space: its own, and what it inherits from Everywhere.
const openAutopilot = (space) => openSettings({ space, section: "autopilot" });

// Run now (herdr-task autopilot run-now): the group's start while it's on; queued until the Assistant is idle, which
// the switch's words then say ("Queued", "Waking"). Dim and still while one is already queued or running. Like a
// segment: hovered, it lifts as a picked one does. Compact: its ▶ alone.
function apRunNow(view, t, space, pane, compact) {
  const a = view.ap;
  if (!a?.on || view.apBusy) return null;
  const busy = Boolean(view.apRunning || a.pending || a.inflight);
  const words = view.apRunning && !a.pending && !a.inflight ? "Queuing…" : "Run now";
  return h_flex().id(`ap-run-${pane}`).flex_none().h_full().px(compact ? 5 : 7).gap(4).items_center()
    .rounded(RADIUS.control - 2).whitespace_nowrap().text_color(busy ? t.dim : t.muted)
    .when(busy, (el) => el.opacity(0.6))
    .when(!busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.background).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); apRun(view, space, cx); }))
    .child(svg("mods/pane-chat/play.svg").size(11).flex_none())
    .when(!compact, (el) => el.child(words));
}

function apRun(view, space, cx) {
  if (view.apRunning) return;
  view.apRunning = true;
  cx.notify();
  cx.spawn(async (cx) => {
    try { view.ap = await ap(["run-now"], space); }
    catch (e) { toast({ title: "Autopilot didn't wake", body: plainError(e), level: "error" }); }
    view.apRunning = false;
    setShared("autopilot.at", Date.now());
    cx.notify();
  });
}

// "Write a heartbeat": before the group while it's on and its heartbeat is still empty.
export function apHeartbeatLink(view, space, pane) {
  return view.ap?.on && view.apBlank === true ? link(`ap-beat-${pane}`, "Write a heartbeat", () => openAutopilot(space)) : null;
}

// Flips it. On with an empty heartbeat still turns on; the header then offers "Write a heartbeat".
function apToggle(view, space, cx) {
  const was = view.ap;
  if (!was || view.apBusy) return;
  const on = !was.on;
  view.apBusy = true;
  // It flips at once ("Waking" when on: it wakes at once); herdr-task's answer then says the rest.
  view.ap = flipped(was, on);
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      view.ap = await ap([on ? "on" : "off"], space);
      if (on) checkBlank(view, space, cx);
    } catch (e) {
      view.ap = was;
      toast({ title: `Autopilot didn't turn ${on ? "on" : "off"}`, body: plainError(e), level: "error" });
    }
    view.apBusy = false;
    setShared("autopilot.at", Date.now());
    cx.notify();
  });
}
