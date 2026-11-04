// Tasks > Base branch, per space (as Shepherdr's space.base): the branch a space's new tasks
// branch from and merge into. herdr-task reads tasks.base when a task is added (captured then, so
// a change touches only new tasks); empty, they take the branch the folder has checked out. The
// branch is checked before it's saved: here, or on origin as git last fetched it.

import { div } from "gpui-kit";
import { v_flex, InputState, Input } from "gpui-base";
import { exec } from "herdr";
import { spaces } from "./live.js";
import { shepherdrFor } from "./coordinator.js";
// The row's words and the branch-name check: core/settings.js, shared with the web app.
import { BASE, branchShape } from "./core/settings.js";

const spaceOf = (id) => spaces().find((s) => s.id === id);

// Made in the window's init (an input needs a live host call).
export function baseInit(view) {
  const b = { box: InputState.new({ placeholder: "" }), scope: undefined, current: {}, err: "", focus: false, setting: false };
  b.box.on("change", (_e, cx) => { if (!b.setting) { b.err = ""; cx.notify(); } });
  b.box.on("focus", (_e, cx) => { b.focus = true; cx.notify(); });
  b.box.on("blur", (_e, cx) => { b.focus = false; save(view, b, cx); });
  b.box.on("submit", (_e, cx) => save(view, b, cx));
  return b;
}

const valueOf = (view) => String(shepherdrFor(view.cfg, view.scope).tasks?.base ?? "").trim();

function git(view, args) {
  const s = spaceOf(view.scope);
  const folder = view.folders[view.scope] ?? s?.folder;
  return exec("git", ["-C", folder, ...args], { on: s?.machine ?? null }).catch(() => null);
}

function save(view, b, cx) {
  const want = b.box.value().trim();
  if (want === valueOf(view)) return cx.notify();
  if (!want) return view.reset("tasks", "base", cx);
  cx.spawn(async (cx) => {
    const ok = branchShape(want) && (await Promise.all([`refs/heads/${want}`, `refs/remotes/origin/${want}`]
      .map((ref) => git(view, ["show-ref", "--verify", "--quiet", ref])))).some((r) => r?.code === 0);
    if (!ok) b.err = BASE.missing(want);
    else { b.err = ""; view.set("tasks", "base", want, cx); }
    cx.notify();
  });
}

// The row, only for a space (a base branch belongs to one repo); null elsewhere.
export function baseRow(view, t) {
  const id = view.scope;
  if (!id || id.startsWith("m:") || !spaceOf(id)) return null;
  const b = view.bb;
  if (b.scope !== id) {
    // Another scope: its value, and the branch its folder has checked out for the empty box.
    b.scope = id;
    b.err = "";
    b.setting = true;
    b.box.set_value(valueOf(view));
    b.setting = false;
    if (!(id in b.current)) {
      b.current[id] = "";
      git(view, ["symbolic-ref", "--short", "HEAD"]).then((r) => { if (r?.code === 0) b.current[id] = r.stdout.trim(); });
    }
  }
  const empty = !b.box.value();
  const now = b.current[id];
  const box = div().relative().w(200)
    .child(Input.new(b.box).w_full().h(30).px(10).rounded(7).border_1().border_color(b.err ? t.blocked : b.focus ? t.accent : t.input)
      .bg(t.background).text_size(13).text_color(t.foreground))
    .when(empty, (el) => el.child(div().absolute().top(6).left(11).right(11).truncate().text_size(13).text_color(t.dim)
      .child(BASE.empty(now))));
  // A branch that isn't there says so under the box, in its words, and isn't saved.
  const control = v_flex().items_end().gap(5).child(box)
    .when(Boolean(b.err), (el) => el.child(div().w(200).text_size(12).line_height("17px").text_color(t.blocked).child(b.err)));
  return view.row(t, BASE.title, BASE.about, control, view.scoped("tasks", "base", (v) => v || BASE.follows));
}
