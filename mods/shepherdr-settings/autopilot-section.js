// The Autopilot section (DECISIONS.md, "Shepherdr gaps being closed": Autopilot, no sandbox): a
// space's Assistant wakes on a schedule or on task events, and each wake brings it the heartbeat
// (plain text) and its saved progress. Otherwise it's the same regular Assistant.
// One setting for every space, as Tasks is (the person's decision): the heartbeat, the schedule and
// the events, laid out as the Tasks page's rows. A space only switches it on or off, with the switch
// in its Assistant's header (mods/pane-chat/autopilot.js); this page has no switch, no Run now and no
// space's own. herdr-task keeps it (`herdr-task autopilot ... --everywhere`, its scheduler wakes the
// spaces that are on); this shows it and asks herdr-task to change it. The heartbeat is one plain
// text file, edited here in a small box, saved a moment after typing stops and on leaving it.
// Words and picks: core/autopilot.js (the web's too).

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { exec, appHome, home, readTextFile, writeTextFile } from "herdr";
import { TEXT, RADIUS, H, segmented } from "./ui.js";
import * as AP from "./core/autopilot.js";

const CLI = () => `${appHome()}/mods/tasks/bin/herdr-task`;
const CUSTOM = "custom";
const MONO = "JetBrains Mono";
const tilde = (p) => (p && p.startsWith(`${home()}/`) ? `~${p.slice(home().length)}` : p ?? "");

// The section's state, made in the window's init (the boxes need a live host call).
export function autopilotInit(view, cx) {
  const ap = { e: null, every: InputState.new({ placeholder: AP.CUSTOM_PLACEHOLDER }), err: "", custom: false,
    beat: { box: TextareaState.new({ placeholder: "" }), file: null, saved: null, gen: 0, savedAt: 0, focus: false } };
  ap.every.on("submit", (_e, cx) => saveEvery(view, cx));
  ap.every.on("blur", (_e, cx) => saveEvery(view, cx));
  ap.every.on("change", (_e, cx) => { ap.err = ""; cx.notify(); });
  const b = ap.beat;
  b.box.set_auto_grow(4, 12);
  b.box.on("change", (_e, cx) => {
    const gen = ++b.gen;
    cx.notify();
    cx.timer.after(AP.SAVE_AFTER_MS, (cx) => { if (gen === b.gen) saveBeat(view, cx); });
  });
  b.box.on("focus", (_e, cx) => { b.focus = true; cx.notify(); });
  b.box.on("blur", (_e, cx) => { b.focus = false; saveBeat(view, cx); });
  ap.reload = (cx) => cx.spawn(async (cx) => {
    const r = await exec(CLI(), ["autopilot", "show", "--everywhere", "--json"]).catch(() => null);
    try { ap.e = AP.everywhereOf({ everywhere: JSON.parse(r?.stdout ?? "") }); } catch { ap.e ??= AP.everywhereOf(null); }
    cx.notify();
  });
  ap.reload(cx);
  // "Saved" goes again a moment after a save.
  cx.timer.every(1000, (cx) => { if (b.savedAt && Date.now() - b.savedAt < 3000) cx.notify(); });
  // The heartbeat file (made with herdr-task's starter when missing), read once into the box.
  cx.spawn(async (cx) => {
    const r = await exec(CLI(), ["autopilot", "heartbeat", "--json"]).catch(() => null);
    try { b.file = JSON.parse(r?.stdout ?? "").heartbeat ?? null; } catch {}
    if (!b.file) { ap.err = AP.NO_HEARTBEAT; cx.notify(); return; }
    b.saved = (await readTextFile(b.file).catch(() => null)) ?? AP.STARTER;
    b.box.set_value(b.saved);
    cx.notify();
  });
  return ap;
}

// herdr-task autopilot <args> --everywhere; its refusal shows under the settings.
function act(view, args, cx) {
  const ap = view.ap;
  cx.spawn(async (cx) => {
    const r = await exec(CLI(), ["autopilot", ...args, "--everywhere", "--json"]).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
    let out = null;
    try { out = JSON.parse(r.stdout); } catch {}
    ap.err = r.code === 0 ? "" : (out?.error ?? (r.stderr || "herdr-task failed").replace(/^herdr-task: /, "").trim());
    if (out && !out.error) ap.e = AP.everywhereOf({ everywhere: out });
    cx.notify();
  });
}

function saveEvery(view, cx) {
  const ap = view.ap;
  if (!ap.e) return;
  const v = ap.every.value().trim();
  if (v === (ap.e.every ?? "")) return;
  act(view, ["set", "--every", v], cx);
}

// The heartbeat's words, written when they changed since last saved.
function saveBeat(view, cx) {
  const b = view.ap.beat;
  const v = b.box.value();
  if (!b.file || b.saved === null || v === b.saved) return;
  b.saved = v;
  cx.spawn(async (cx) => {
    try { await writeTextFile(b.file, v); b.savedAt = Date.now(); }
    catch (e) { view.ap.err = String(e?.message ?? e); }
    cx.notify();
  });
}

// `view`: the settings window (its title and row pieces).
export function autopilotSection(view, t, cx) {
  const ap = view.ap, a = ap.e;
  if (!a) return v_flex().child(view.title(t, AP.TITLE)).child(div().text_size(TEXT.label).text_color(t.dim).child("Loading…"));

  // The Custom box shows the saved rule: when it changes (a save here, or an Assistant's); never
  // while it's only being typed in.
  const key = a.every ?? "";
  if (ap.everyKey !== key) {
    ap.everyKey = key;
    ap.custom = false;
    cx.timer.after(0, (cx) => { ap.every.set_value(a.every ?? ""); cx.notify(); });
  }
  const saved = String(a.every ?? "").trim().toLowerCase();
  const preset = ap.custom ? CUSTOM : AP.presetOf(saved) ?? CUSTOM;
  const pick = (v, _e, cx) => {
    if (v === CUSTOM) { ap.custom = true; ap.every.focus(); return; }
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
  // The heartbeat: its file small on top ("Saved" a moment after a save), the words in a small
  // monospace box that grows a little.
  const b = ap.beat;
  const beatBox = v_flex().w_full().gap(6)
    .child(h_flex().gap(8).items_center().text_size(TEXT.label)
      .child(div().flex_1().min_w(0).truncate().font_family(MONO).text_color(t.dim).child(tilde(b.file)))
      .when(Date.now() - b.savedAt < 2000, (el) => el.child(div().flex_none().text_color(t.dim).child(AP.SAVED))))
    .child(Textarea.new(b.box).w_full().px(10).py(8).rounded(RADIUS.control).border(1)
      .border_color(b.focus ? t.accent : t.input).bg(t.background)
      .font_family(MONO).text_size(TEXT.label).line_height("18px").text_color(t.foreground));

  return v_flex()
    .child(view.title(t, AP.TITLE))
    .child(div().pb(8).text_size(TEXT.label).line_height("17px").text_color(t.dim).child(AP.ABOUT))
    .child(view.row(t, AP.ROWS.heartbeat.label, AP.ROWS.heartbeat.about, null, null, beatBox))
    .child(view.row(t, AP.ROWS.every.label, AP.ROWS.every.about,
      segmented("ap-every", [...AP.PRESETS, [CUSTOM, AP.CUSTOM]], preset, pick), null, customBox))
    .child(view.row(t, AP.ROWS.events.label, AP.ROWS.events.about, null, null,
      h_flex().gap(6).flex_wrap().children(AP.EVENTS.map(chip))))
    .when(Boolean(ap.err) && preset !== CUSTOM, (el) => el.child(div().pt(6).text_size(TEXT.label).text_color(t.blocked).child(ap.err)));
}

// Closing the window: the heartbeat's last words are saved (resolves once written).
export function autopilotFlush(view) {
  const b = view.ap?.beat;
  if (!b?.file || b.saved === null || b.box.value() === b.saved) return Promise.resolve();
  b.saved = b.box.value();
  return writeTextFile(b.file, b.saved).catch(() => {});
}
