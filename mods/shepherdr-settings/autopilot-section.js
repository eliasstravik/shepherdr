// The Autopilot section (DECISIONS.md, "Shepherdr gaps being closed": Autopilot, no sandbox): a
// space's Assistant wakes on a schedule or on task events, and each wake brings it the heartbeat
// (plain text) and its saved progress. Otherwise it's the same regular Assistant.
// Everywhere's page sets it for every space on this computer: its switch, heartbeat, schedule and
// events, each with "N spaces use their own" under it, then the spaces by name with what applies
// there; a row opens that space's own settings (the same window, scoped to it), where each row says
// "Same as everywhere" or "Changed here · Reset", as the other pages do, with Run now and how its
// wakes went. herdr-task keeps it (`herdr-task autopilot ...`, its scheduler wakes it); this shows it
// and asks herdr-task to change it. Words, picks and the inherit rule: core/autopilot.js (the web's).

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, exec, appHome, home } from "herdr";
import { TEXT, RADIUS, H, button, clickable, segmented, toggleSwitch } from "./ui.js";
import * as AP from "./core/autopilot.js";
import { spaceName } from "./core/spaces.js";

const CLI = () => `${appHome()}/mods/tasks/bin/herdr-task`;
const local = () => spaces().filter((s) => !s.machine && !s.id.includes("/"));
const CUSTOM = "custom";

// What applies in a space: herdr-task's view of it, else Everywhere's (a space it has no record of yet).
const pilotOf = (ap, space) => ap.list.spaces[space] ?? AP.pilotFor({ everywhere: ap.list.everywhere }, space);
// A space as the sidebar calls it (never "~"); its task folder names its repo.
const nameOf = (ap, s) => {
  const folder = ap.list?.spaces[s.id]?.folder;
  return spaceName(s, { home: home(), named: Boolean(s.named), repo: folder ? folder.replace(/\/+$/, "").split("/").pop() : null });
};
// herdr-task's words for where a change goes: this space, or Everywhere.
const target = (view) => (view.scope ? ["--space", view.scope] : ["--everywhere"]);

// The section's state, made in the window's init (the box needs a live host call).
export function autopilotInit(view, cx) {
  const ap = { list: null, every: InputState.new({ placeholder: AP.CUSTOM_PLACEHOLDER }), everyFor: undefined, err: "", busy: false, custom: false };
  ap.every.on("submit", (_e, cx) => saveEvery(view, cx));
  ap.every.on("blur", (_e, cx) => saveEvery(view, cx));
  ap.every.on("change", (_e, cx) => { ap.err = ""; cx.notify(); });
  ap.reload = (cx) => cx.spawn(async (cx) => {
    const r = await exec(CLI(), ["autopilot", "list", "--json"]).catch(() => null);
    try {
      const out = JSON.parse(r?.stdout ?? "");
      ap.list = { everywhere: { ...AP.everywhereOf({ everywhere: out.everywhere }), heartbeat: out.everywhere?.heartbeat },
        spaces: Object.fromEntries((out.spaces ?? []).map((v) => [v.space, AP.pilotFor({ spaces: [v] }, v.space)])) };
    } catch { ap.list ??= { everywhere: AP.everywhereOf(null), spaces: {} }; }
    cx.notify();
  });
  ap.reload(cx);
  // Next and last wake change on their own (the scheduler): looked at again while shown.
  cx.timer.every(4000, (cx) => { if (view.section === "autopilot") ap.reload(cx); });
  return ap;
}

// herdr-task autopilot <args> for this scope (Everywhere's or the space's); its refusal shows under
// the settings. Everywhere's change reaches every space, so all of it is read again.
function act(view, args, cx) {
  const ap = view.ap;
  ap.busy = true;
  cx.spawn(async (cx) => {
    const r = await exec(CLI(), ["autopilot", ...args, ...target(view), "--json"]).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
    let out = null;
    try { out = JSON.parse(r.stdout); } catch {}
    ap.err = r.code === 0 ? "" : (out?.error ?? (r.stderr || "herdr-task failed").replace(/^herdr-task: /, "").trim());
    ap.busy = false;
    ap.reload(cx);
  });
}

function saveEvery(view, cx) {
  const ap = view.ap, key = view.scope ?? "";
  if (!ap.list || ap.everyFor !== key) return;
  const v = ap.every.value().trim();
  const a = view.scope ? pilotOf(ap, view.scope) : ap.list.everywhere;
  if (v === (a.every ?? "")) return;
  act(view, ["set", "--every", v], cx);
}

// `view`: the settings window (its title, row, scope line and stepper pieces).
export function autopilotSection(view, t, cx) {
  const ap = view.ap;
  if (!ap.list) return v_flex().child(view.title(t, AP.TITLE)).child(div().text_size(TEXT.label).text_color(t.dim).child("Loading…"));
  const space = view.scope, at = space ? "space" : "all";
  const a = space ? pilotOf(ap, space) : ap.list.everywhere;
  const views = local().map((s) => ({ ...pilotOf(ap, s.id), name: nameOf(ap, s) }));
  // Under each row: in a space, "Same as everywhere" or "Changed here · Reset"; on Everywhere, the
  // spaces that set their own.
  const sc = (field) => space
    ? { id: `ap-${field}`, mine: Boolean(a.own?.[field]), from: AP.SAME, reset: (cx) => act(view, ["reset", "--only", field], cx) }
    : { id: `ap-${field}`, others: AP.ownIn(views, field, (v) => v.name) };
  const on = Boolean(a.on);

  // The Custom box shows this scope's rule: after a switch of scope, and when the saved rule
  // changes (a save here, or the Assistant's); never while it's only being typed in.
  const key = `${space ?? ""}|${a.every ?? ""}`;
  if (ap.everyKey !== key) {
    ap.everyKey = key;
    ap.custom = false;
    ap.err = "";
    cx.timer.after(0, (cx) => { ap.everyFor = space ?? ""; ap.every.set_value(a.every ?? ""); cx.notify(); });
  }
  const saved = String(a.every ?? "").trim().toLowerCase();
  const preset = ap.custom ? CUSTOM : AP.presetOf(saved) ?? CUSTOM;
  const pick = (v, _e, cx) => {
    if (v === CUSTOM) { ap.custom = true; ap.everyFor = space ?? ""; ap.every.focus(); return; }
    ap.custom = false;
    if (v !== saved) act(view, ["set", "--every", v], cx);
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
        act(view, ["set", "--on", AP.eventsIn(next).join(",")], cx);
      })
      .child(label);
  };
  const customBox = preset === CUSTOM ? v_flex().gap(6)
    .child(div().w_full().h(H.lg).px(9).flex().items_center().rounded(RADIUS.control).border_1().border_color(ap.err ? t.blocked : t.input).bg(t.background)
      .child(Input.new(ap.every).w_full().text_size(TEXT.body).text_color(t.foreground)))
    .child(div().text_size(TEXT.label).line_height("17px").text_color(ap.err ? t.blocked : t.dim).child(ap.err || AP.CUSTOM_HINT)) : null;
  // The heartbeat: Everywhere's, or this space's own; a space that follows Everywhere's makes its own.
  const beat = !space || a.own?.heartbeat
    ? button("ap-heartbeat", AP.HEARTBEAT_EDIT, { onClick: (_e, cx) => editHeartbeat(view, space, false, cx) })
    : button("ap-heartbeat", AP.SET_OWN, { onClick: (_e, cx) => editHeartbeat(view, space, true, cx) });

  return v_flex()
    .child(view.title(t, AP.TITLE))
    .child(div().pb(8).text_size(TEXT.label).line_height("17px").text_color(t.dim).child(space ? AP.ABOUT : AP.EVERYWHERE_ABOUT))
    .child(view.row(t, AP.ROWS.on.label, AP.ROWS.on[at], toggleSwitch("ap-on", on, (_next, _e, cx) => act(view, [on ? "off" : "on"], cx)), sc("on")))
    .child(view.row(t, AP.ROWS.heartbeat.label, AP.ROWS.heartbeat[at], beat, sc("heartbeat")))
    .child(view.row(t, AP.ROWS.every.label, AP.ROWS.every[at],
      segmented("ap-every", [...AP.PRESETS, [CUSTOM, AP.CUSTOM]], preset, pick), sc("every"), customBox))
    .child(view.row(t, AP.ROWS.events.label, AP.ROWS.events[at], null, sc("events"),
      h_flex().gap(6).flex_wrap().children(AP.EVENTS.map(chip))))
    .when(Boolean(ap.err) && preset !== CUSTOM, (el) => el.child(div().pt(6).text_size(TEXT.label).text_color(t.blocked).child(ap.err)))
    .when(Boolean(space), (el) => el
      .child(view.row(t, AP.ROWS.run.label, on ? AP.ROWS.run.on : AP.ROWS.run.off,
        button("ap-run", AP.ROWS.run.label, { disabled: !on, onClick: (_e, cx) => act(view, ["run-now"], cx) })))
      .child(v_flex().pt(14).children(AP.facts(a).map(([label, value]) => fact(t, label, value)))))
    .when(!space, (el) => el.child(spacesList(view, t, views)));
}

const fact = (t, label, value) => h_flex().gap(16).py(6).items_start()
  .child(div().w(96).flex_none().text_size(TEXT.body).font_medium().text_color(t.foreground).child(label))
  .child(div().flex_1().min_w(0).text_size(TEXT.body).line_height("19px").text_color(t.muted).child(value));

// Everywhere's page, under its rows: each space on this computer, by its name, how its Autopilot is
// and what it sets itself; a row opens that space's own settings.
function spacesList(view, t, views) {
  return v_flex()
    .child(view.heading(t, AP.SPACES))
    .child(div().pb(4).text_size(TEXT.label).line_height("17px").text_color(t.dim).child(views.length ? AP.SPACES_HINT : AP.NO_SPACES))
    .children(views.map((v) => clickable(h_flex().id(`ap-open-${v.space}`).w_full().px(10).py(10).gap(12).items_center()
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_size(TEXT.body).font_medium().text_color(t.foreground).child(v.name))
        .child(div().truncate().text_size(TEXT.label).text_color(v.on ? t.muted : t.dim).child(AP.summary(v))))
      .child(div().flex_none().text_size(TEXT.label).text_color(t.dim).child(AP.ownWords(v)))
      .child(svg("mods/workspace-chrome/chevron-right.svg").size(14).flex_none().text_color(t.dim)),
    (_e, cx) => view.pickScope(v.space, cx))));
}

// Opens the heartbeat that applies here as Instructions does: Everywhere's, or this space's own
// (own: made from Everywhere's words when it has none). herdr-task makes a missing file with a starter.
function editHeartbeat(view, space, own, cx) {
  cx.spawn(async (cx) => {
    const args = ["autopilot", "heartbeat", ...(space ? ["--space", space] : ["--everywhere"]), ...(own ? ["--own"] : []), "--json"];
    const r = await exec(CLI(), args).catch(() => null);
    let file = null;
    try { file = JSON.parse(r?.stdout ?? "").heartbeat; } catch {}
    if (!file) { view.ap.err = AP.NO_HEARTBEAT; cx.notify(); return; }
    view.edit({ id: "heartbeat", file, title: AP.ROWS.heartbeat.label });
    view.ap.reload(cx);
  });
}
