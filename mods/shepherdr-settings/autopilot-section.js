// The Autopilot section (DECISIONS.md, "Shepherdr gaps being closed": Autopilot, no sandbox): a
// space's Assistant wakes on a schedule or on task events, and each wake brings it the heartbeat
// (plain text) and its saved progress. Otherwise it's the same regular Assistant.
// Set as Tasks is: Everywhere's heartbeat, schedule and events, and a space's own of any of them
// (its rows say "Set for this space · Reset" or "Inherited from Everywhere"), kept in Shepherdr
// settings with the rest ("autopilot" in ~/.herdr/shepherdr.json: main.js set/scoped/reset, so they
// go to every machine). A space switches it on or off with the switch in its Assistant's header
// (mods/pane-chat/autopilot.js); this page has no switch and no Run now. herdr-task reads them
// (its scheduler wakes the spaces that are on) and checks a Custom schedule's words before they're
// kept. What Everywhere had before Settings kept it (herdr-task's .autopilot.json "everywhere" and
// the heartbeat file everywhere.md) is what Everywhere inherits: ap.base. The heartbeat is edited
// here in a small box, saved a moment after typing stops and on leaving it.
// Words and picks: core/autopilot.js (the web's too).

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { exec, appHome, home, readTextFile } from "herdr";
import { TEXT, RADIUS, H, segmented } from "./ui.js";
import * as AP from "./core/autopilot.js";

const CLI = () => `${appHome()}/mods/tasks/bin/herdr-task`;
const STATE = () => `${home()}/.herdr/tasks/.autopilot.json`;
const OLD_BEAT = () => `${home()}/.config/herdr-core/autopilot/everywhere.md`;
const CUSTOM = "custom";
const MONO = "JetBrains Mono";

// The section's state, made in the window's init (the boxes need a live host call).
export function autopilotInit(view, cx) {
  const ap = { base: null, every: InputState.new({ placeholder: AP.CUSTOM_PLACEHOLDER }), err: "", custom: false,
    dir: InputState.new({ placeholder: AP.DIRECTION_PLACEHOLDER }),
    beat: { box: TextareaState.new({ placeholder: "" }), saved: null, gen: 0, savedAt: 0, focus: false } };
  ap.every.on("submit", (_e, cx) => saveEvery(view, cx));
  ap.every.on("blur", (_e, cx) => saveEvery(view, cx));
  ap.every.on("change", (_e, cx) => { ap.err = ""; cx.notify(); });
  ap.dir.on("submit", (_e, cx) => saveDirection(view, cx));
  ap.dir.on("blur", (_e, cx) => saveDirection(view, cx));
  const b = ap.beat;
  b.box.set_auto_grow(4, 12);
  b.box.on("change", (_e, cx) => {
    const gen = ++b.gen;
    cx.notify();
    cx.timer.after(AP.SAVE_AFTER_MS, (cx) => { if (gen === b.gen) saveBeat(view, cx); });
  });
  b.box.on("focus", (_e, cx) => { b.focus = true; cx.notify(); });
  b.box.on("blur", (_e, cx) => { b.focus = false; saveBeat(view, cx); });
  // Everywhere's from before: what Everywhere inherits where Settings sets none.
  cx.spawn(async (cx) => {
    let old = null;
    try { old = JSON.parse((await readTextFile(STATE())) ?? "{}"); } catch {}
    const e = AP.everywhereOf(old);
    ap.base = { every: e.every ?? "", events: e.events, heartbeat: AP.currentBeat((await readTextFile(OLD_BEAT()).catch(() => null)) ?? AP.STARTER) };
    cx.notify();
  });
  // "Saved" goes again a moment after a save.
  cx.timer.every(1000, (cx) => { if (b.savedAt && Date.now() - b.savedAt < 3000) cx.notify(); });
  return ap;
}

// What applies at the window's level now: { every, events, heartbeat, direction } (an earlier version's starter as today's).
const now = (view) => {
  const a = Object.fromEntries(AP.FIELDS.map((f) => [f, view.chain("autopilot", f).find((x) => x.value !== undefined)?.value]));
  return { ...a, heartbeat: a.heartbeat == null ? a.heartbeat : AP.currentBeat(a.heartbeat) };
};

// A space's Direction: one line, kept when you leave the box; empty, it has none again.
function saveDirection(view, cx) {
  if (!view.scope || view.scope !== view.ap.dirScope) return; // the box still shows another space's
  const v = AP.directionOf(view.ap.dir.value());
  if (v === AP.directionOf(now(view).direction)) return;
  if (v) view.set("autopilot", "direction", v, cx);
  else view.reset("autopilot", "direction", cx);
}

// A Custom schedule: herdr-task knows its words first (its refusal shows under the box), then it's kept.
function saveEvery(view, cx) {
  const ap = view.ap;
  if (!ap.base) return;
  const v = ap.every.value().trim();
  if (v === String(now(view).every ?? "").trim()) return;
  cx.spawn(async (cx) => {
    const r = await exec(CLI(), ["autopilot", "check", "--every", v, "--json"]).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
    let out = null;
    try { out = JSON.parse(r.stdout); } catch {}
    if (r.code !== 0 || !out || out.error) {
      ap.err = out?.error ?? (r.stderr || "herdr-task failed").replace(/^herdr-task: /, "").trim();
    } else {
      ap.err = "";
      view.set("autopilot", "every", out.every ?? "", cx);
    }
    cx.notify();
  });
}

// The heartbeat's words, kept at this level when they changed since last saved (the same as what it
// inherits: it follows again).
function saveBeat(view, cx) {
  const b = view.ap.beat;
  const v = b.box.value();
  if (b.saved === null || v === b.saved) return;
  b.saved = v;
  b.savedAt = Date.now();
  view.set("autopilot", "heartbeat", v, cx);
}

// `view`: the settings window (its title, row pieces and the level's values).
export function autopilotSection(view, t, cx) {
  const ap = view.ap;
  if (!ap.base) return v_flex().child(view.title(t, AP.TITLE)).child(div().text_size(TEXT.label).text_color(t.dim).child("Loading…"));
  const a = now(view);

  // The boxes show what applies at this level: when it changes (a save, a Reset, another level, an
  // Assistant's change); never while they're being typed in.
  const key = `${view.scope ?? ""}|${a.every ?? ""}`;
  if (ap.everyKey !== key) {
    ap.everyKey = key;
    ap.custom = false;
    ap.err = "";
    cx.timer.after(0, (cx) => { ap.every.set_value(a.every ?? ""); cx.notify(); });
  }
  const dirKey = `${view.scope ?? ""}|${a.direction ?? ""}`;
  if (ap.dirKey !== dirKey) {
    ap.dirKey = dirKey;
    ap.dirScope = view.scope;
    cx.timer.after(0, (cx) => { ap.dir.set_value(AP.directionOf(a.direction)); cx.notify(); });
  }
  const b = ap.beat;
  const beatKey = `${view.scope ?? ""}|${a.heartbeat ?? ""}`;
  if (b.key !== beatKey && !b.focus) {
    b.key = beatKey;
    b.saved = a.heartbeat ?? "";
    cx.timer.after(0, (cx) => { b.box.set_value(b.saved); cx.notify(); });
  }
  const saved = String(a.every ?? "").trim().toLowerCase();
  const preset = ap.custom ? CUSTOM : AP.presetOf(saved) ?? CUSTOM;
  const pick = (v, _e, cx) => {
    if (v === CUSTOM) { ap.custom = true; ap.every.focus(); return; }
    ap.custom = false;
    if (v !== saved) view.set("autopilot", "every", v, cx);
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
        view.set("autopilot", "events", AP.eventsIn(next), cx);
      })
      .child(label);
  };
  const customBox = preset === CUSTOM ? v_flex().gap(6)
    .child(div().w_full().h(H.lg).px(9).flex().items_center().rounded(RADIUS.control).border_1().border_color(ap.err ? t.blocked : t.input).bg(t.background)
      .child(Input.new(ap.every).w_full().text_size(TEXT.body).text_color(t.foreground)))
    .child(div().text_size(TEXT.label).line_height("17px").text_color(ap.err ? t.blocked : t.dim).child(ap.err || AP.CUSTOM_HINT)) : null;
  // The heartbeat: "Saved" a moment after a save, the words in a small monospace box that grows a little.
  const beatBox = Textarea.new(b.box).w_full().px(10).py(8).rounded(RADIUS.control).border(1)
    .border_color(b.focus ? t.accent : t.input).bg(t.background)
    .font_family(MONO).text_size(TEXT.label).line_height("18px").text_color(t.foreground);
  const savedWord = Date.now() - b.savedAt < 2000 ? div().text_size(TEXT.label).text_color(t.dim).child(AP.SAVED) : null;

  return v_flex()
    .child(view.title(t, AP.TITLE))
    .child(div().pb(8).text_size(TEXT.label).line_height("17px").text_color(t.dim).child(AP.ABOUT))
    // a space's Direction: the one line it steers toward (Everywhere has none: each space works out its own)
    .when(Boolean(view.scope), (el) => el.child(view.row(t, AP.ROWS.direction.label, AP.ROWS.direction.about, null, null,
      div().w_full().h(H.lg).px(9).flex().items_center().rounded(RADIUS.control).border_1().border_color(t.input).bg(t.background)
        .child(Input.new(ap.dir).w_full().text_size(TEXT.body).text_color(t.foreground)))))
    .child(view.row(t, AP.ROWS.heartbeat.label, AP.ROWS.heartbeat.about, savedWord, view.scoped("autopilot", "heartbeat"), beatBox))
    .child(view.row(t, AP.ROWS.every.label, AP.ROWS.every.about,
      segmented("ap-every", [...AP.PRESETS, [CUSTOM, AP.CUSTOM]], preset, pick), view.scoped("autopilot", "every"), customBox))
    .child(view.row(t, AP.ROWS.events.label, AP.ROWS.events.about, null, view.scoped("autopilot", "events"),
      h_flex().gap(6).flex_wrap().children(AP.EVENTS.map(chip))));
}

// Leaving this level or closing the window: the heartbeat's last words are kept (resolves once written).
export function autopilotFlush(view) {
  const b = view.ap?.beat;
  if (!b || b.saved === null || b.box.value() === b.saved) return Promise.resolve();
  b.saved = b.box.value();
  const scope = view.scope;
  const follows = !scope ? false : b.saved === view.inherited("autopilot", "heartbeat")?.value;
  return view.apply((next) => {
    if (follows) return view.drop(view.layerOf(next, scope), "autopilot", "heartbeat");
    const tg = view.target(next, scope);
    tg.autopilot = { ...(tg.autopilot ?? {}), heartbeat: b.saved };
  }).catch(() => {});
}
