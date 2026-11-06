// Tasks > Branch names (#570): the pattern a folder's new task branches are named by, Everywhere's or a space's own.
// herdr-task fills it in when it makes a task's worktree ({n}: its number, {key}: its id, {slug}: its title's words);
// empty, task/{n}-{slug}. A task's own --branch wins. Checked before it's saved (core/settings.js branchPattern).

import { div } from "gpui-kit";
import { v_flex, InputState, Input } from "gpui-base";
import { shepherdrFor } from "./coordinator.js";
import { BRANCH, branchPattern } from "./core/settings.js";

// Made in the window's init (an input needs a live host call).
export function branchInit(view) {
  const b = { box: InputState.new({ placeholder: "" }), scope: null, shown: false, err: "", focus: false, setting: false };
  b.box.on("change", (_e, cx) => { if (!b.setting) { b.err = ""; cx.notify(); } });
  b.box.on("focus", (_e, cx) => { b.focus = true; cx.notify(); });
  b.box.on("blur", (_e, cx) => { b.focus = false; save(view, b, cx); });
  b.box.on("submit", (_e, cx) => save(view, b, cx));
  return b;
}

const valueOf = (view) => String(shepherdrFor(view.cfg, view.scope).tasks?.branch ?? "").trim();

function save(view, b, cx) {
  const want = b.box.value().trim();
  if (want === valueOf(view)) return cx.notify();
  b.err = branchPattern(want);
  if (b.err) return cx.notify();
  if (!want) return view.reset("tasks", "branch", cx);
  view.set("tasks", "branch", want, cx);
}

// The row, for Everywhere and a space (not a machine's page).
export function branchRow(view, t) {
  const id = view.scope ?? null;
  if (id && id.startsWith("m:")) return null;
  const b = view.bn;
  if (!b.shown || b.scope !== id) {
    b.shown = true;
    b.scope = id;
    b.err = "";
    b.setting = true;
    b.box.set_value(valueOf(view));
    b.setting = false;
  }
  const empty = !b.box.value();
  const box = div().relative().w(200)
    .child(Input.new(b.box).w_full().h(30).px(10).rounded(7).border_1().border_color(b.err ? t.blocked : b.focus ? t.accent : t.input)
      .bg(t.background).text_size(13).text_color(t.foreground))
    .when(empty, (el) => el.child(div().absolute().top(6).left(11).right(11).truncate().text_size(13).text_color(t.dim)
      .child(BRANCH.pattern)));
  // A pattern that can't be used says why under the box, and isn't saved.
  const control = v_flex().items_end().gap(5).child(box)
    .when(Boolean(b.err), (el) => el.child(div().w(200).text_size(12).line_height("17px").text_color(t.blocked).child(b.err)));
  // Reset: back to Everywhere's, shown in the box at once
  const reset = (cx) => {
    b.err = "";
    b.setting = true;
    b.box.set_value(String(view.inherited("tasks", "branch")?.value ?? "").trim());
    b.setting = false;
    view.reset("tasks", "branch", cx);
  };
  return view.row(t, BRANCH.title, BRANCH.about, control, view.scoped("tasks", "branch", reset));
}
