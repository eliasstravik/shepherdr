// The Autopilot section (DECISIONS.md, "Shepherdr gaps being closed": Autopilot, no sandbox): per
// space, its Assistant wakes on a schedule or on task events, and each wake brings it the space's
// heartbeat (plain text) and its saved progress. Otherwise it's the same regular Assistant.
// herdr-task keeps it (`herdr-task autopilot ...`, its scheduler wakes it); this only shows it and
// asks herdr-task to change it. Everywhere lists the spaces; a row opens that space's own
// settings (the same window, scoped to it), where its switch, heartbeat and schedule are.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, exec, appHome } from "herdr";
import { TEXT, RADIUS, H, button, clickable, segmented, toggleSwitch } from "./ui.js";

const CLI = () => `${appHome()}/mods/tasks/bin/herdr-task`;
const EVENTS = [["added", "Added"], ["ready", "Ready"], ["failed", "Failed"], ["needs-you", "Needs you"], ["merged", "Merged"], ["stalled", "Stalled"]];
const local = () => spaces().filter((s) => !s.machine && !s.id.includes("/"));

function when(ms) {
  if (!ms) return "";
  const d = new Date(ms), today = new Date();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === today.toDateString()) return `Today ${hm}`;
  return `${d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })} ${hm}`;
}
const reasonWords = (r) => (r === "schedule" ? "Schedule" : r === "run now" ? "Run now" : String(r ?? "").replace(/^event:(\S+)/, (_m, e) => `Event: ${e}`));

// The section's state, made in the window's init (the box needs a live host call).
export function autopilotInit(view, cx) {
  const ap = { list: null, every: InputState.new({ placeholder: "Every 2 hours on weekdays" }), everyFor: undefined, err: "", busy: false, custom: false };
  ap.every.on("submit", (_e, cx) => saveEvery(view, cx));
  ap.every.on("blur", (_e, cx) => saveEvery(view, cx));
  ap.every.on("change", (_e, cx) => { ap.err = ""; cx.notify(); });
  ap.reload = (cx) => cx.spawn(async (cx) => {
    const r = await exec(CLI(), ["autopilot", "list", "--json"]).catch(() => null);
    try { ap.list = Object.fromEntries(JSON.parse(r?.stdout ?? "[]").map((v) => [v.space, v])); } catch { ap.list ??= {}; }
    cx.notify();
  });
  ap.reload(cx);
  // Next and last wake change on their own (the scheduler): looked at again while shown.
  cx.timer.every(4000, (cx) => { if (view.section === "autopilot") ap.reload(cx); });
  return ap;
}

// herdr-task autopilot <args> for a space; its refusal shows under the settings.
function act(view, space, args, cx) {
  const ap = view.ap;
  ap.busy = true;
  cx.spawn(async (cx) => {
    const r = await exec(CLI(), ["autopilot", ...args, "--space", space, "--json"]).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
    let out = null;
    try { out = JSON.parse(r.stdout); } catch {}
    ap.err = r.code === 0 ? "" : (out?.error ?? (r.stderr || "herdr-task failed").replace(/^herdr-task: /, "").trim());
    if (out && !out.error) ap.list = { ...(ap.list ?? {}), [space]: out };
    ap.busy = false;
    cx.notify();
  });
}

function saveEvery(view, cx) {
  const space = view.scope, ap = view.ap;
  if (!space || ap.everyFor !== space) return;
  const v = ap.every.value().trim();
  if (v === (ap.list?.[space]?.every ?? "")) return;
  act(view, space, ["set", "--every", v], cx);
}

// `view`: the settings window (its title, row and stepper pieces).
export function autopilotSection(view, t, cx) {
  const ap = view.ap;
  if (!ap.list) return v_flex().child(view.title(t, "Autopilot")).child(div().text_size(TEXT.label).text_color(t.dim).child("Loading…"));
  return view.scope ? spaceSettings(view, t, cx) : overview(view, t);
}

const ABOUT = "Its Assistant wakes on a schedule or when something happens to its tasks, and works from the heartbeat.";
// The schedule's presets (herdr-task's --every words); anything else is Custom.
const PRESETS = [["", "Off"], ["every 30 minutes", "Every 30 min"], ["every 60 minutes", "Every hour"], ["weekdays 9:00", "Weekdays 9:00"]];
const CUSTOM = "custom";

// Everywhere: each space on this computer, how its Autopilot is; a row opens that space's.
function overview(view, t) {
  const ap = view.ap;
  return v_flex()
    .child(view.title(t, "Autopilot"))
    .child(div().pb(8).text_size(TEXT.label).line_height("17px").text_color(t.dim).child(`Per space. ${ABOUT}`))
    .children(local().map((s) => {
      const a = ap.list[s.id];
      const on = Boolean(a?.on);
      const sub = on ? ["On", a.trigger, a.next_run ? `Next ${when(a.next_run)}` : null].filter(Boolean).join(" · ") : "Off";
      return clickable(h_flex().id(`ap-open-${s.id}`).w_full().px(10).py(10).gap(12).items_center()
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().text_size(TEXT.body).font_medium().text_color(t.foreground).child(s.name))
          .child(div().truncate().text_size(TEXT.label).text_color(on ? t.muted : t.dim).child(sub)))
        .child(svg("mods/workspace-chrome/chevron-right.svg").size(14).flex_none().text_color(t.dim)),
        (_e, cx) => view.pickScope(s.id, cx));
    }));
}

function spaceSettings(view, t, cx) {
  const ap = view.ap, space = view.scope;
  const a = ap.list[space] ?? { on: false, events: [], every: null };
  const on = Boolean(a.on);
  // The Custom box shows this space's rule: after a switch of space, and when the saved rule
  // changes (a save here, or the Assistant's); never while it's only being typed in.
  const key = `${space}|${a.every ?? ""}`;
  if (ap.everyKey !== key) {
    ap.everyKey = key;
    ap.custom = false;
    cx.timer.after(0, (cx) => { ap.everyFor = space; ap.every.set_value(a.every ?? ""); cx.notify(); });
  }
  const saved = String(a.every ?? "").trim().toLowerCase();
  const preset = ap.custom ? CUSTOM : PRESETS.some(([v]) => v === saved) ? saved : CUSTOM;
  const pick = (v, _e, cx) => {
    if (v === CUSTOM) { ap.custom = true; ap.everyFor = space; ap.every.focus(); return; }
    ap.custom = false;
    if (v !== saved) act(view, space, ["set", "--every", v], cx);
  };
  const events = new Set(a.events ?? []);
  const chip = ([id, label]) => {
    const picked = events.has(id);
    return h_flex().id(`ap-ev-${id}`).h(H.sm).px(8).items_center().rounded(RADIUS.control).text_size(TEXT.label).cursor_pointer()
      .border_1().border_color(picked ? t.input : t.border)
      .when(picked, (el) => el.bg(t.selected).text_color(t.foreground))
      .when(!picked, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => {
        const next = picked ? [...events].filter((e) => e !== id) : [...events, id];
        act(view, space, ["set", "--on", next.join(",")], cx);
      })
      .child(label);
  };
  const fact = (label, value) => h_flex().gap(16).py(6).items_start()
    .child(div().w(96).flex_none().text_size(TEXT.body).font_medium().text_color(t.foreground).child(label))
    .child(div().flex_1().min_w(0).text_size(TEXT.body).line_height("19px").text_color(t.muted).child(value));
  const last = a.last_wake;
  const pending = a.pending;
  const customBox = preset === CUSTOM ? v_flex().gap(6)
    .child(div().w_full().h(H.lg).px(9).flex().items_center().rounded(RADIUS.control).border_1().border_color(ap.err ? t.blocked : t.input).bg(t.background)
      .child(Input.new(ap.every).w_full().text_size(TEXT.body).text_color(t.foreground)))
    .child(div().text_size(TEXT.label).line_height("17px").text_color(ap.err ? t.blocked : t.dim)
      .child(ap.err || "Like \"every 2 hours on weekdays from 8:00 to 18:00\". Saved when you leave the box.")) : null;
  return v_flex()
    .child(view.title(t, "Autopilot"))
    .child(view.row(t, "Autopilot", ABOUT, toggleSwitch("ap-on", on, (_next, _e, cx) => act(view, space, [on ? "off" : "on"], cx))))
    .child(view.row(t, "Heartbeat", "What it works from: direction, priorities, limits and when to stop.",
      button("ap-heartbeat", "Edit", { onClick: (_e, cx) => editHeartbeat(view, space, cx) })))
    .child(view.row(t, "Schedule", "When it wakes by itself.",
      segmented("ap-every", [...PRESETS, [CUSTOM, "Custom…"]], preset, pick), null, customBox))
    .when(Boolean(ap.err) && preset !== CUSTOM, (el) => el.child(div().pt(6).text_size(TEXT.label).text_color(t.blocked).child(ap.err)))
    .child(view.row(t, "Events", "These wake it at once when they happen to this space's tasks.", null, null,
      h_flex().gap(6).flex_wrap().children(EVENTS.map(chip))))
    .child(view.row(t, "Run now", on ? "Wakes it now, or as soon as it's idle." : "Turn Autopilot on first.",
      button("ap-run", "Run now", { disabled: !on, onClick: (_e, cx) => act(view, space, ["run-now"], cx) })))
    .child(v_flex().pt(14)
      .child(fact("Next wake", !on ? "Off." : pending ? `Waiting: ${pending.note ?? "goes when its Assistant is idle"}.`
        : a.next_run ? `${when(a.next_run)} · Schedule` : events.size ? "On events only." : "Only on Run now."))
      .child(fact("Last wake", last ? `${when(last.at)} · ${reasonWords(last.reason)} · ${last.outcome}` : "Never."))
      .child(fact("Progress", a.progress ? `${a.progress.text} (${when(a.progress.at)})` : "None. The Assistant saves it after each wake.")));
}

// Makes the file when it's missing (with a starter), then opens it as Instructions does.
function editHeartbeat(view, space, cx) {
  cx.spawn(async (cx) => {
    const r = await exec(CLI(), ["autopilot", "heartbeat", "--space", space, "--json"]).catch(() => null);
    let file = null;
    try { file = JSON.parse(r?.stdout ?? "").heartbeat; } catch {}
    if (!file) { view.ap.err = "Couldn't make the heartbeat file."; cx.notify(); return; }
    view.edit({ id: "heartbeat", file, title: "Heartbeat" });
  });
}
