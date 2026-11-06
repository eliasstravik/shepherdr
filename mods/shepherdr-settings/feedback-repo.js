// Agents > Feedback offers and Feedback repo (herdr-task's feedback.py, SHEP-78): when Shepherdr
// itself misbehaves, an agent offers once to file it as a GitHub issue, filed only on the person's
// yes. The switch is per scope (as Reactions); the repo it files to is Everywhere's only (one box:
// owner/name, a github.com link made one, empty for Shepherdr's own repo).

import { div } from "gpui-kit";
import { v_flex, InputState, Input } from "gpui-base";
import { toggleSwitch } from "./ui.js";
import { shepherdrFor } from "./coordinator.js";
// The rows' words and the repo check: core/settings.js, shared with the web app.
import { FEEDBACK, feedbackRepo } from "./core/settings.js";

// Made in the window's init (an input needs a live host call).
export function feedbackInit(view) {
  const f = { box: InputState.new({ placeholder: "" }), shown: undefined, err: "", focus: false, setting: false };
  f.box.on("change", (_e, cx) => { if (!f.setting) { f.err = ""; cx.notify(); } });
  f.box.on("focus", (_e, cx) => { f.focus = true; cx.notify(); });
  f.box.on("blur", (_e, cx) => { f.focus = false; save(view, f, cx); });
  f.box.on("submit", (_e, cx) => save(view, f, cx));
  return f;
}

const repoNow = (view) => String(view.cfg?.everywhere?.agents?.feedback_repo ?? "").trim();

function save(view, f, cx) {
  const want = feedbackRepo(f.box.value());
  if (want === null) { f.err = FEEDBACK.bad; return cx.notify(); }
  f.err = "";
  if (want === repoNow(view)) return cx.notify();
  if (!want) return view.reset("agents", "feedback_repo", cx);
  f.setting = true;
  f.box.set_value(want);
  f.setting = false;
  view.set("agents", "feedback_repo", want, cx);
}

// The switch, in every scope.
export function feedbackRow(view, t) {
  const on = shepherdrFor(view.cfg, view.scope).agents.feedback !== false;
  return view.row(t, FEEDBACK.title, FEEDBACK.about,
    toggleSwitch("feedback", on, (next, _e, cx) => view.set("agents", "feedback", next, cx)), view.scoped("agents", "feedback"));
}

// The repo box, on Everywhere only; null in a space.
export function feedbackRepoRow(view, t) {
  if (view.scope) return null;
  const f = view.fr;
  const now = repoNow(view);
  if (f.shown !== now && !f.focus) {
    f.shown = now;
    f.setting = true;
    f.box.set_value(now);
    f.setting = false;
  }
  const box = div().relative().w(220)
    .child(Input.new(f.box).w_full().h(30).px(10).rounded(7).border_1().border_color(f.err ? t.blocked : f.focus ? t.accent : t.input)
      .bg(t.background).text_size(13).text_color(t.foreground))
    .when(!f.box.value(), (el) => el.child(div().absolute().top(6).left(11).right(11).truncate().text_size(13).text_color(t.dim)
      .child(FEEDBACK.repo)));
  const control = v_flex().items_end().gap(5).child(box)
    .when(Boolean(f.err), (el) => el.child(div().w(220).text_size(12).line_height("17px").text_color(t.blocked).child(f.err)));
  return view.row(t, FEEDBACK.repoTitle, FEEDBACK.repoAbout, control, null);
}
