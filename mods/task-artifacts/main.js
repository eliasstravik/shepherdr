// A task's Artifacts (SHEP-60): what its agent and its helpers made or updated, its proof first (marked Proof), then
// newest first; each with its title (without the task's id in front), how many versions and when. A click opens it in
// the artifact viewer (its versions, Mark up) over the task's chat. A child of the Tasks panel's task view, beside
// Files, Changes and Browser; the header finds them (mods/chat/panel.js loadArts, core/task-artifacts.js, as the web's
// Artifacts tab) into shared "tasks.thread.artifacts" and counts them on its switch. None: a quiet line.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared } from "herdr";
import { openViewer } from "./artview.js";
import { titleInTask } from "./core/task-artifacts.js";
import { TEXT, RADIUS } from "./ui.js";

const ICON = "mods/artifacts/artifacts.svg";

// "just now", "5m ago", "2h ago", "3d ago", as the web and the Artifacts panel say it
function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
}

// The shown task's, once the header has found them (null: not yet).
function mine() {
  const a = shared("tasks.thread.artifacts"), w = shared("tasks.thread");
  return a && w && a.terminal === (w.terminal ?? null) && (w.terminal || a.ref === w.task) ? a : null;
}

export default class TaskArtifacts extends View {
  init(_props, cx) {
    this.opening = null;
    // "2h ago" moves on
    cx.timer.every(60000, (cx) => cx.notify());
  }

  open(a, machine, cx) {
    if (this.opening) return;
    this.opening = a.id;
    cx.notify();
    // over the task's chat when its place is known (as its card there opens), else the whole window
    const area = shared("chat.areas")?.thread?.area ?? null;
    cx.spawn(async (cx) => {
      await openViewer({ id: a.id, title: a.title, version: a.v, latest: a.v, machine }, area);
      this.opening = null;
      cx.notify();
    });
  }

  note(t, title, text) {
    return v_flex().flex_1().items_center().justify_center().px(24).gap(6)
      .child(svg(ICON).size(18).flex_none().text_color(t.dim))
      .child(div().pt(2).text_size(13).font_medium().text_color(t.muted).child(title))
      .when(Boolean(text), (el) => el.child(div().max_w(260).text_center().text_size(TEXT.label).text_color(t.dim).child(text)));
  }

  row(t, a, ref, machine, i) {
    const busy = this.opening === a.id;
    return h_flex().id(`task-art-${i}`).w_full().min_w(0).px(10).py(8).gap(10).items_start().rounded(RADIUS.control).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); this.open(a, machine, cx); })
      .child(div().pt(1).flex_none().child(svg(ICON).size(14).text_color(a.proof ? t.accent : t.dim)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().min_w(0).gap(8).items_center()
          .child(div().min_w(0).truncate().text_size(13).text_color(t.foreground).child(titleInTask(a.title, ref, a.proof)))
          .when(Boolean(a.proof), (el) => el.child(div().flex_none().h(18).px(7).flex().items_center().rounded(9).bg(t.selected)
            .text_size(11).font_medium().text_color(t.muted).child("Proof"))))
        .child(div().min_w(0).truncate().text_size(TEXT.label).text_color(t.dim)
          .child(busy ? "Opening…" : [`${a.v} ${a.v === 1 ? "version" : "versions"}`, a.at ? ago(a.at) : null].filter(Boolean).join(" · "))));
  }

  render(_cx) {
    const t = theme();
    const root = v_flex().id("task-artifacts").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13);
    const w = shared("tasks.thread");
    if (!w) return root.child(this.note(t, "No task open."));
    const a = mine();
    if (!a) return root.child(this.note(t, "Looking for its artifacts…"));
    if (!a.list.length) return root.child(this.note(t, "No artifacts yet", "Reports and proofs this task's agent makes show here."));
    return root.child(v_flex().id("task-artifacts-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(2)
      .children(a.list.map((x, i) => this.row(t, x, a.ref, a.machine, i))));
  }
}
