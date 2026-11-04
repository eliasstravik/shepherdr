// Coordinator views, by props().view:
//   "close"         dialog: close a coordinator that has live workers ({ tab })
//   "agents"        popup: restart an agent tab as another installed agent ({ terminal })
//   "instructions"  pane: the coordinator template, editable, saved as you type
// Starting, restarting and closing live in coordinator.js and the *.sh scripts beside it.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { props, theme, settings, knownAgents, closeOverlay, home, exec, readTextFile, writeTextFile, watchFolder } from "herdr";
import { terminals, inRender } from "./live.js";
import { coordinatorIn, workersOf, entryFor, restartAgent, closeCoordinator, taskOf, switchTask } from "./coordinator.js";
import { TEXT, H, RADIUS, button as uiButton, heading, dialogFooter } from "./ui.js";
// Switch agent's words: core/menus.js (the web app's Switch agent reads the same).
import { SWITCH_AGENT } from "./core/menus.js";
// The instructions view's words (its note per role, Saved., Done): core/settings.js (the web app's editor reads the same).
import { INSTRUCTIONS } from "./core/settings.js";

// The instructions view edits props.file (default: the assistant template); props.role picks its note.
// Panes saved before the roles became templates name the old files: they open the templates.
const TEMPLATES = () => `${home()}/.config/herdr-core/templates`;
const MOVED = () => ({ [`${TEMPLATES()}/coordinator.md`]: `${TEMPLATES()}/assistant.md`,
  [`${home()}/.herdr/instructions/worker.md`]: `${TEMPLATES()}/worker.md`, [`${home()}/.herdr/instructions/reviewer.md`]: `${TEMPLATES()}/reviewer.md` });
const FILE = () => { const f = props()?.file ?? `${TEMPLATES()}/assistant.md`; return MOVED()[f] ?? f; };
const DIR = () => FILE().split("/").slice(0, -1).join("/");
const NOTES = INSTRUCTIONS.notes;
const NOTE = () => NOTES[props()?.role] ?? NOTES.coordinator;

export default class Coordinator extends View {
  init(_props, cx) {
    const view = props()?.view;
    if (view === "close") {
      this.stop = true;
      this.handle = cx.focus_handle();
      this.handle.focus();
    } else if (view === "agents") {
      this.agents = null;
      this.handle = cx.focus_handle();
      this.handle.focus();
      cx.spawn(async (cx) => {
        try { this.agents = await knownAgents(); } catch { this.agents = []; }
        cx.notify();
      });
    } else if (view === "instructions") {
      this.load(cx);
      // Someone else edited the file (another pane, an editor): show theirs unless we're mid-edit.
      cx.spawn(async (cx) => {
        let w = null;
        for (;;) {
          // At most 5 s per wait, so a reload's old build ends at its next cx use.
          w ??= watchFolder(DIR());
          const changed = await Promise.race([w, cx.sleep(5000)]);
          if (!changed) continue;
          w = null;
          if (!changed.some((p) => p === FILE() || p === DIR()) || this.pending) continue;
          const text = await readTextFile(FILE());
          if (text !== null && text !== this.saved) { this.raw = text; this.saved = text; this.code?.set_value(text); cx.notify(); }
        }
      });
    }
  }

  load(cx) {
    cx.spawn(async (cx) => {
      // A file not there yet is made on the first save (expected: null).
      this.raw = await readTextFile(FILE()).catch(() => null);
      this.saved = this.raw ?? "";
      const t = theme();
      this.code = EditorState.new({
        language: "markdown", value: this.saved, soft_wrap: true, line_numbers: false,
        font_family: settings().font_family, font_size: 12.5,
        syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 },
      });
      // Saved shortly after typing stops, not on every key.
      this.code.on("change", (_e, cx) => {
        this.pending?.cancel();
        this.pending = cx.timer.after(600, (cx) => this.save(cx));
      });
      cx.notify();
    });
  }

  save(cx) {
    this.pending = null;
    const text = this.code.value();
    if (text === this.saved) return;
    cx.spawn(async (cx) => {
      try {
        if (this.raw === null) await exec("mkdir", ["-p", DIR()]);
        await writeTextFile(FILE(), text, this.raw === null ? null : this.saved);
        this.raw = text;
        this.saved = text;
        this.error = null;
        this.status = INSTRUCTIONS.saved;
      } catch (e) {
        this.error = INSTRUCTIONS.notSaved(e?.message ?? e);
      }
      cx.notify();
    });
  }

  async close(cx) {
    if (this.pending && this.code && this.code.value() !== this.saved) await writeTextFile(FILE(), this.code.value(), this.raw === null ? null : this.saved).catch(() => {});
  }

  // One copy of Herdr's live lists for the whole render (live.js): past ~50 ms Herdr stops it.
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw(cx) {
    const view = props()?.view;
    if (view === "close") return this.closeDialog();
    if (view === "agents") return this.agentMenu();
    return this.instructions();
  }

  // As a pane, or as a dialog over Settings (props.overlay, props.title): then a title and Done.
  instructions() {
    const t = theme();
    const p = props();
    return v_flex().size_full().min_h(0).bg(t.background)
      .when(Boolean(p?.overlay), (el) => el.child(h_flex().flex_none().h(44).pl(16).pr(8).gap(12).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(TEXT.body).font_semibold().text_color(t.foreground).child(p.title ?? INSTRUCTIONS.title))
        .child(uiButton("instructions-done", INSTRUCTIONS.done, { kind: "primary", onClick: () => closeOverlay(p.overlay) }))))
      .child(this.code
        ? div().flex_1().min_h(0).px(6).pt(6).child(Editor.new(this.code))
        : div().flex_1())
      .child(h_flex().flex_none().px(12).py(8).gap(12).items_start().border_t(1).border_color(t.border).text_size(12)
        .child(div().flex_1().min_w(0).text_color(t.dim).child(NOTE()))
        .when(Boolean(this.error || this.status), (el) => el.child(div().flex_none().text_color(this.error ? t.blocked : t.dim).child(this.error ?? this.status))));
  }

  // Restart this tab's agent as another installed one.
  agentMenu() {
    const t = theme();
    const p = props();
    const k = terminals().find((x) => x.address === p.terminal);
    const list = (this.agents ?? []).filter((a) => a.installed);
    const current = k && entryFor(k, list);
    const pick = (a) => {
      closeOverlay(p.overlay);
      if (!k || a === current) return;
      // A task's agent switches through herdr-task, which keeps the task's tab and folder.
      if (taskOf(k)) switchTask(k, a.key);
      else restartAgent(k, a.run);
    };
    return v_flex().id("agents").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(TEXT.body)
      .on_key_down((e) => {
        if (e.key === "escape") closeOverlay(p.overlay);
        const a = /^[1-9]$/.test(e.key) ? list[Number(e.key) - 1] : null;
        if (a) pick(a);
      })
      .child(div().px(8).child(heading(SWITCH_AGENT.title)))
      .when(this.agents === null, (el) => el.child(div().px(8).py(6).text_color(t.dim).child(SWITCH_AGENT.loading)))
      .children(list.map((a, i) => {
        const on = a === current;
        return h_flex().id(`agent-${a.key}`).h(H.lg).px(8).gap(8).rounded(RADIUS.control).items_center().flex_none()
          .text_color(on ? t.dim : t.foreground)
          .when(!on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => pick(a)))
          .child(div().size(16).flex_none().flex().items_center().justify_center()
            .child(a.tint ? svg(a.icon).size(14).flex_none().text_color(on ? t.dim : t.foreground) : image(a.icon).size(14).flex_none()))
          .child(div().flex_1().min_w(0).truncate().child(a.name))
          .child(div().flex_none().text_size(TEXT.label).text_color(t.dim).child(on ? SWITCH_AGENT.current : i < 9 ? String(i + 1) : ""));
      }));
  }

  // Close a coordinator that still has workers: stop them, or let them finish on their own.
  closeDialog() {
    const t = theme();
    const p = props();
    const coord = coordinatorIn(p.tab);
    const n = workersOf(coord).length;
    const confirm = () => {
      closeOverlay(p.overlay);
      if (coord) closeCoordinator(p.tab, coord, n && this.stop ? "stop" : "keep");
    };
    const choice = (id, stop, title, detail) => {
      const on = this.stop === stop;
      return h_flex().id(id).gap(10).p(10).items_start().rounded(RADIUS.card).border(1).border_color(on ? t.accent : t.border)
        .when(on, (el) => el.bg(t.selected)).cursor_pointer().hover((s) => s.bg(on ? t.selected : t.hover))
        .on_click((_e, cx) => { this.stop = stop; cx.notify(); })
        .child(div().mt(2).size(14).flex_none().rounded(7).border(1.5).border_color(on ? t.accent : t.input).flex().items_center().justify_center()
          .when(on, (el) => el.child(div().size(6).rounded(3).bg(t.accent))))
        .child(v_flex().gap(2).flex_1().min_w(0)
          .child(div().font_medium().text_color(t.foreground).child(title))
          .child(div().text_size(12).text_color(t.muted).child(detail)));
    };
    return v_flex().id("close-coordinator").track_focus(this.handle).size_full().min_h(0).p(18).gap(12).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "enter") confirm();
        else if (e.key === "escape") closeOverlay(p.overlay);
        else if (e.key === "up" || e.key === "down") this.stop = !this.stop;
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(div().text_size(TEXT.title).font_semibold().text_color(t.foreground).child("Close the Assistant?"))
      .child(div().text_size(TEXT.body).text_color(t.muted).child(n
        ? `It has ${n} worker${n > 1 ? "s" : ""} running. Their branches and worktrees stay either way.`
        : "It has no workers running."))
      .when(n > 0, (el) => el
        .child(choice("stop", true, "Stop its workers", "Ends the agents it started and closes their tabs."))
        .child(choice("keep", false, "Let them finish", "Workers keep running in their own tabs, on their own.")))
      .child(div().flex_1())
      .child(dialogFooter({ onCancel: () => closeOverlay(p.overlay), primary: { id: "confirm", label: "Close Assistant", onClick: confirm } }));
  }
}
