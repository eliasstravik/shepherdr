// A task's Changes (cloned from Herdr's changes): what the open task changed against where it
// left its base, committed or not, new files included: its files with lines added and taken out,
// and each file's diff. Read only (the Tasks panel is). A child of the Tasks panel's task view
// (taskwhere.js); it reads git only while it shows.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { exec, readTextFile, watchFolder, theme, settings } from "herdr";
import { where, shown, CHANGES } from "./taskwhere.js";
import { green, amber, red, RADIUS, TEXT } from "./ui.js";
// The fork point and the changed files, as the web app's Diff reads them (core/worktree.js).
import { READ, against, changedFiles } from "./core/worktree.js";

// A file's change as a colored dot: added green, changed amber, deleted red
// (a merge conflict red too).
const KIND = { A: ["Added", green], M: ["Changed", amber], D: ["Deleted", red], U: ["Conflict", red] };

function location() {
  const w = where();
  return { cwd: w?.folder ?? null, on: w?.machine ?? null, base: w?.base ?? null, start: w?.start ?? null, task: w?.terminal ?? null };
}
const key = () => JSON.stringify(location());
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: line.slice(1) || " " };
    if (kind === "+") return { kind, number: next++, text: line.slice(1) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: line.slice(1) || " " }; }
    return { kind: "", text: line };
  });
}

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.rows = []; this.diffWidth = 0;
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (!shown(CHANGES)) { this.stale = true; return; }
    if (this.loading) return;
    this.stale = false;
    const loc = location(), { cwd, on } = loc, context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.open = null; this.vs = null;
      this.setLines([]); this.error = null; this.note = null; this.watched = null; this.closed = false; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        if (key() !== context) return;
        if (top?.code !== 0) { this.root = null; this.files = []; this.setLines([]); this.open = null; this.error = top ? "This task's folder isn't a git repository." : "This task's folder can't be read. It may have been removed after the task finished."; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const vs = await against(git, loc);
        if (!vs) { this.root = root; this.files = []; this.error = "This repository has no commits."; return; }
        const [names, nums, fresh] = await Promise.all([
          git(["diff", vs.rev, "--name-status", "-z", "--no-renames"]),
          git(["diff", vs.rev, "--numstat", "-z", "--no-renames"]),
          git(["ls-files", "--others", "--exclude-standard", "-z"]),
        ]);
        for (const r of [names, nums, fresh]) if (r.code !== 0) throw new Error(r.stderr);
        const files = changedFiles(names.stdout, nums.stdout, fresh.stdout);
        if (key() !== context) return;
        this.limited = files.length > 1000;
        this.root = root; this.on = on; this.vs = vs; this.files = files.slice(0, 1000); this.error = null;
        this.watch(root, cx);
        if (this.open && !this.files.some((f) => f.path === this.open)) { this.open = null; this.setLines([]); }
        // The first file's diff shows until you pick another.
        if (!this.open && !this.closed && this.files.length) this.open = this.files[0].path;
        if (this.open) {
          try { await this.load(this.open, context); }
          catch { if (key() === context) this.setLines(["Can't preview this diff. It's too large or unreadable."]); }
        }
      } catch (e) { if (key() === context) this.error = String(e?.message ?? e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async load(path, context) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    if (!file) return;
    let lines;
    if (file.fresh) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Can't preview this file. It's binary, too large or unreadable."];
      else if (text.includes("\0")) lines = ["Binary file · No text diff"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map(l => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...READ, "diff", this.vs.rev, "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (key() === context && this.open === path) this.setLines(lines.slice(0, 1500).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...lines.map(line => line.length * 7 + 50));
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]); this.note = null;
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); }
      catch (e) { if (key() === context && this.open === path) this.note = "Can't preview this diff. It's too large or unreadable."; }
      cx.notify();
    });
    cx.notify();
  }

  diffRow({ kind, number, text }, t) {
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  // The empty list's words: why there's nothing, or that it's loading.
  empty() {
    if (this.error) return this.error;
    if (this.loading || (!this.root && location().cwd)) return "Loading changes…";
    if (!this.root) return "No folder for this task";
    return this.vs?.label ? `No changes against ${this.vs.label}` : "No uncommitted changes";
  }

  render(cx) {
    if ((this.stale || key() !== this.context) && shown(CHANGES)) this.refresh(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const n = this.files.length;
    // The header above says Changes: this bar sums them up and says against what.
    return v_flex().id("changes").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(34).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).text_size(TEXT.label)
        .when(Boolean(this.vs), (e) => e.child(div().flex_none().text_color(t.muted).child(`${n.toLocaleString()} ${n === 1 ? "file" : "files"}`)))
        .when(add > 0, (e) => e.child(div().flex_none().text_color(t.ansi2).child(`+${add.toLocaleString()}`)))
        .when(del > 0, (e) => e.child(div().flex_none().text_color(t.ansi1).child(`−${del.toLocaleString()}`)))
        .child(div().flex_1())
        .when(Boolean(this.vs), (e) => e.child(h_flex().id("changes-vs").min_w(0).gap(4).items_center().text_color(t.dim)
          .child(svg("mods/workspace-chrome/git-compare.svg").size(12).flex_none())
          .child(div().min_w(0).truncate().child(this.vs.label ? `Against ${this.vs.label}` : "Uncommitted")))))
      .child(v_flex().id("changes-list").flex_none().h(Math.min(200, Math.max(44, n * 28 + 12))).overflow_y_scrollbar().p(6).border_b(1).border_color(t.border).children(this.files.map((f) => {
        const parts = f.path.split("/"), name = parts.pop();
        const [, color] = KIND[f.status] ?? KIND.M;
        return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(RADIUS.card).cursor_pointer().when(this.open === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(f.path, cx))
          .child(h_flex().id(`change-kind-${f.path}`).w(14).h(28).flex_none().items_center().justify_center()
            .child(div().size(8).rounded(4).bg(color())))
          .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
          .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
      })).when(!n, (e) => e.child(div().p(8).text_color(t.dim).child(this.empty()))))
      .when(this.limited, el => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("changes-diff", this.rows.length, 20, (i) => String(i),
            (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
        .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())
        .when(!this.open && n > 0, (e) => e.child(div().absolute().top(6).px(12).text_color(t.dim).child("Select a file to see its changes."))))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)));
  }
}
