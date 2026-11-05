// A task's Pull request: its PR on GitHub (state, checks, a link), as gh tells it, asked on the
// task's machine. The PR herdr-task opened (the task's record), else the one for its branch.
// Read only. A child of the Tasks panel's task view (taskwhere.js); it asks GitHub only while it
// shows: on showing, then every 30 s. Shepherdr's PrView, the Herdr way.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, shared, setShared } from "herdr";
import { where, shown, PR } from "./taskwhere.js";
// gh's answer in words, as the web app's Pull request reads it (core/worktree.js).
import { PR_FIELDS, prOf, checksLine } from "./core/worktree.js";

const EVERY = 30000;

// Asks gh: { pr } or { why } (nothing to show, and why) or { error }.
async function ask(w) {
  const on = w.machine ?? undefined;
  let r;
  if (w.pr?.number && w.pr?.repo) {
    r = await exec("gh", ["pr", "view", String(w.pr.number), "--repo", w.pr.repo, "--json", PR_FIELDS], { on });
  } else if (w.branch) {
    r = await exec("gh", ["pr", "view", w.branch, "--json", PR_FIELDS], { cwd: w.folder, on }).catch(() => null);
    if (!r) return { why: "This task has no pull request." };
  } else {
    return { why: "This task works in its folder, with no branch of its own, so it has no pull request." };
  }
  if (r.code !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    if (!w.pr && /no pull requests? found|not a git repository|none of the git remotes|no git remotes/i.test(err)) return { why: "This task has no pull request." };
    return { error: err.split("\n")[0] || "GitHub didn't answer." };
  }
  return { pr: prOf(JSON.parse(r.stdout)) };
}

export default class PullRequest extends View {
  init(_props, cx) {
    this.res = null;       // what gh said last, for this.key
    this.key = null;
    this.at = 0;
    this.asking = false;
    cx.timer.every(EVERY, (cx) => this.refresh(cx));
  }

  refresh(cx, force) {
    if (!shown(PR) || this.asking) return;
    const w = where(), key = JSON.stringify(w);
    if (key !== this.key) { this.key = key; this.res = null; this.at = 0; }
    if (!w || (!force && Date.now() - this.at < EVERY - 1000)) return;
    this.asking = true;
    cx.spawn(async (cx) => {
      let res;
      try { res = await ask(w); } catch (e) { res = { error: String(e?.message ?? e) }; }
      this.asking = false;
      if (JSON.stringify(where()) !== key) return cx.notify();
      this.res = res;
      this.at = Date.now();
      // The header's Pull request switch stops looking empty once one is found (a PR the agent
      // opened itself isn't in the task's record).
      const found = res.pr ? { terminal: w.terminal, number: res.pr.number } : null;
      if (JSON.stringify(found) !== JSON.stringify(shared("tasks.thread.pr") ?? null)) setShared("tasks.thread.pr", found);
      cx.notify();
    });
  }

  // A secondary button: the line's colour, a thin outline, its icon then its words.
  button(id, icon, label, t, fn) {
    return h_flex().id(id).h(28).pl(8).pr(10).gap(6).flex_none().items_center().rounded(7).cursor_pointer()
      .border_1().border_color(t.border).text_size(12.5).text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); fn(cx); })
      .child(svg(icon).size(14).flex_none())
      .child(label);
  }

  note(text, t, error) {
    return v_flex().flex_1().items_center().justify_center().px(24).gap(8)
      .child(svg("mods/task-pr/git-pull-request.svg").size(18).flex_none().text_color(t.dim))
      .child(div().max_w(300).text_center().text_size(12.5).text_color(error ? t.ansi1 : t.dim).child(text));
  }

  render(cx) {
    const t = theme();
    if (shown(PR) && (this.key !== JSON.stringify(where()) || Date.now() - this.at >= EVERY)) cx.timer.after(0, (cx) => this.refresh(cx));
    const res = this.key === JSON.stringify(where()) ? this.res : null;
    const root = v_flex().id("task-pr").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13);
    if (!where()) return root.child(this.note("No task open.", t));
    if (!res) return root.child(this.note("Asking GitHub…", t));
    if (!res.pr) return root.child(this.note(res.why ?? `GitHub didn't answer: ${res.error}`, t, Boolean(res.error)));
    const pr = res.pr;
    // A state is a soft tint with its word in the colour (red is for what needs you, so Closed is grey).
    const tone = { open: ["Open", t.ansi2], draft: ["Draft", t.muted], merged: ["Merged", t.ansi5], closed: ["Closed", t.muted] }[pr.state];
    // Each state's word stays beside its mark: the web's checks say it (core/worktree.js CHECK_WORDS).
    const icon = { pass: ["mods/workspace-chrome/circle-check.svg", t.ansi2, "Passed"], fail: ["mods/task-pr/circle-x.svg", t.ansi1, "Failed"],
      pending: ["mods/workspace-chrome/clock.svg", t.working, "Running"], skip: ["mods/task-pr/circle-minus.svg", t.dim, "Skipped"] };
    return root
      // The bar the other views have: its state and number, the size of the change.
      .child(h_flex().h(34).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
        .child(div().h(20).px(8).flex().flex_none().items_center().rounded(10).bg(tone[1] + "24").text_color(tone[1]).font_medium().child(tone[0]))
        .child(div().flex_none().text_color(t.muted).child(`#${pr.number}`))
        .child(div().flex_1())
        .child(div().flex_none().text_color(t.dim).child(`${pr.files} ${pr.files === 1 ? "file" : "files"}`))
        .when(pr.add > 0, (e) => e.child(div().flex_none().text_color(t.ansi2).child(`+${pr.add.toLocaleString()}`)))
        .when(pr.del > 0, (e) => e.child(div().flex_none().text_color(t.ansi1).child(`−${pr.del.toLocaleString()}`))))
      .child(v_flex().id("task-pr-body").flex_1().min_h(0).overflow_y_scrollbar().p(16).gap(16)
        .child(v_flex().gap(8)
          .child(div().text_size(14).font_semibold().child(pr.title))
          .child(h_flex().gap(6).items_center().text_size(12).text_color(t.dim)
            .child(svg("mods/workspace-chrome/git-branch.svg").size(12).flex_none())
            .child(div().min_w(0).truncate().child(`${pr.head} → ${pr.base}`)))
          .child(h_flex().gap(6).pt(4)
            .child(this.button("task-pr-open", "mods/chat-image/external-link.svg", "Open on GitHub", t, (cx) => cx.open_url(pr.url)))
            .child(this.button("task-pr-copy", "mods/chat-image/copy.svg", this.copied === pr.url ? "Copied" : "Copy link", t, (cx) => {
              cx.write_to_clipboard(pr.url);
              this.copied = pr.url;
              cx.timer.after(1500, (cx) => { this.copied = null; cx.notify(); });
              cx.notify();
            }))))
        .child(v_flex().gap(4)
          .child(h_flex().gap(8).items_center().justify_between().text_size(12)
            .child(div().font_medium().text_color(t.muted).child("Checks"))
            .when(pr.checks.length > 0, (e) => e.child(div().min_w(0).truncate().text_color(t.dim).child(checksLine(pr.checks)))))
          .when(!pr.checks.length, (e) => e.child(div().text_size(12).text_color(t.dim).child("No checks on it.")))
          .children(pr.checks.map((c, i) => {
            const [ic, color] = icon[c.state];
            return h_flex().id(`task-pr-check-${i}`).h(30).mx(-8).px(8).gap(8).items_center().rounded(7)
              .when(Boolean(c.url), (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => cx.open_url(c.url)))
              .child(svg(ic).size(14).flex_none().text_color(color))
              .child(div().flex_1().min_w(0).truncate().child(c.name))
              .when(Boolean(c.url), (e) => e.child(svg("mods/chat-image/external-link.svg").size(12).flex_none().text_color(t.dim)));
          }))));
  }
}
