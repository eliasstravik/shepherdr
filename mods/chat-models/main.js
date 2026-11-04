// The chat's model menu: a popover above the chat's model button (mods/chat), drawn like
// Herdr's other menus (new-menu-tasks). Model (every installed agent's, with its icon; picking
// another agent's model switches agent), Reasoning (that model's levels), Fast (where the model
// has it), Permissions (a small sub-menu), and, only when a choice differs from what runs now,
// one Restart button. The chat does the restart.
// Props (plain data from the chat; this mod reads nothing else about the agent):
//   { pane, current: { agent, model, effort, fast, perm }, select?: { agent, model } (comes chosen), menus: { claude?, codex? }
//     (agent.js menuFor), icons: { <agent>: { icon, tint } }, permDefault, remote, overlay }
// The overlay is frameless and as tall as the menu at its tallest (the chat counts it with the
// sizes below); the menu sits at its bottom and grows upward, so nothing is ever cut off.
// Restart goes back through shared "chat.restartreq" = { pane, at, pick }.
// Pick mode (for the coordinator settings rows, mods/chat/settings.js): a plain list,
//   props { pick: field, key, options: [{ id, label, icon?, tint? }], current, width, height };
// the choice goes back through shared "newspace.pick" = { key, field, value, at }.
// Settings mode (settings.js settingsButton): the whole menu without Restart; every change
// goes back at once as { key, field: "settings", value: { agent, model, effort, fast, perm } }.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, props, setShared, closeOverlay } from "herdr";
import { KINDS } from "./core/kinds.js";

const AGENTS = Object.keys(KINDS);
const LEVEL = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra", none: "None" };
const LONG = { xhigh: "Extra high" };
// Sizes, as the chat counts them for the overlay's height (mods/chat openPicker).
const ROW = 31, HEAD = 26, SEP = 9, SEG = 34, FOOT = 33;

export default class ModelMenu extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.p = p;
    if (p.pick) { this.handle = cx.focus_handle(); cx.timer.after(0, () => this.handle.focus()); return; }
    const c = p.current ?? {};
    this.was = { agent: c.agent, model: c.model, effort: c.effort ?? null, fast: Boolean(c.fast), perm: c.perm ?? null };
    this.sel = { ...this.was };
    // Typed as /model <name> in the chat: that model comes chosen, Restart ready.
    const pre = p.select && this.models().find((m) => m.agent === p.select.agent && m.id === p.select.model);
    if (pre) this.choose(pre);
    this.preset = Boolean(pre);
    this.permOpen = false;
    this.settingsMode = p.mode === "settings";
    this.handle = cx.focus_handle();
    cx.timer.after(0, () => this.handle.focus());
  }

  models() {
    return AGENTS.flatMap((a) => (this.p.menus?.[a]?.models ?? []).map((m) => ({ ...m, agent: a })));
  }

  model(s = this.sel) {
    return this.p.menus?.[s.agent]?.models?.find((m) => m.id === s.model) ?? null;
  }

  // The level that applies: the chosen one, else the model's default.
  level(s) {
    return s.effort ?? this.model(s)?.defaultEffort ?? null;
  }

  choose(m) {
    const was = this.sel;
    const next = { ...was, agent: m.agent, model: m.id };
    if (next.effort && !m.efforts.includes(next.effort)) next.effort = null;
    if (!m.fast) next.fast = false;
    if (m.agent !== was.agent) {
      // Another agent: its own permission modes; full access stays full access.
      const full = was.perm === "bypassPermissions" || was.perm === "full";
      const fullId = m.agent === "claude" ? "bypassPermissions" : "full";
      next.perm = full && this.p.menus?.[m.agent]?.perms?.some((x) => x.id === fullId) ? fullId : this.p.permDefault?.[m.agent] ?? null;
      next.fast = Boolean(this.p.menus?.[m.agent]?.fastLocked && m.fast);
    }
    this.sel = next;
  }

  // What would change, in words, or [] when nothing would.
  changes() {
    const s = this.sel, w = this.was, out = [];
    if (s.agent !== w.agent || s.model !== w.model) out.push(this.model()?.name ?? s.model);
    if (this.level(s) && this.level(s) !== this.level(w)) out.push(LONG[this.level(s)] ?? LEVEL[this.level(s)] ?? this.level(s));
    if (s.fast !== w.fast) out.push(s.fast ? "Fast" : "Standard");
    if (s.perm && s.perm !== w.perm) out.push(this.p.menus?.[s.agent]?.perms?.find((x) => x.id === s.perm)?.label ?? s.perm);
    return out;
  }

  restart() {
    const s = this.sel;
    setShared("chat.restartreq", { pane: this.p.pane, at: Date.now(), pick: { agent: s.agent, model: s.model, effort: this.level(s), fast: s.fast, perm: s.perm } });
    closeOverlay(this.p.overlay);
  }

  icon(agent, t) {
    const ic = this.p.icons?.[agent];
    if (!ic?.icon) return div().size(14).flex_none();
    return ic.tint ? svg(ic.icon).size(14).flex_none().text_color(t.foreground) : image(ic.icon).size(14).flex_none();
  }

  head(t, label) {
    return div().h(HEAD).flex_none().px(9).pt(8).text_size(11).text_color(t.dim).child(label);
  }

  row(t, id, enabled, fn) {
    return h_flex().id(id).h(ROW).flex_none().px(9).gap(10).rounded(7).items_center()
      .text_color(enabled ? t.foreground : t.dim)
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.selected))
        .on_click((_e, cx) => { cx.stop_propagation(); fn(); cx.notify(); }));
  }

  check(t, on) {
    return div().size(14).flex_none().when(on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).text_color(t.foreground)));
  }

  // That model's levels as one segmented control; the default shows chosen when none is set.
  levels(t) {
    const m = this.model();
    const on = this.level(this.sel);
    const off = Boolean(this.p.remote);
    return h_flex().h(SEG).flex_none().px(4).items_center().child(h_flex().w_full().h(28).p(2).gap(2).rounded(7).bg(t.raised)
      .when(off, (el) => el.opacity(0.5))
      .children((m?.efforts ?? []).map((e) => h_flex().id(`level-${e}`).flex_1().min_w(0).h_full().justify_center().items_center().rounded(5)
        .text_size(11.5)
        .when(on === e, (el) => el.bg(t.background).text_color(t.foreground).font_medium())
        .when(on !== e, (el) => el.text_color(t.muted).when(!off, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.sel = { ...this.sel, effort: e }; cx.notify(); })))
        .child(div().truncate().child(LEVEL[e] ?? e)))));
  }

  // A small switch: on is the accent, the knob slides.
  toggle(t, on, id = "fast-knob") {
    return div().relative().w(28).h(16).flex_none().rounded(8).bg(on ? t.accent : t.input)
      .child(div().id(id).absolute().top(2).left(on ? 14 : 2).size(12).rounded(6).bg(t.background).transition("left", 120));
  }

  // The permission modes, just above the Permissions row.
  permMenu(t, bottom) {
    const perms = this.p.menus?.[this.sel.agent]?.perms ?? [];
    return v_flex().absolute().right(5).bottom(bottom).w(180).p(5).rounded(8).bg(t.popover).border_1().border_color(t.border).shadow_md()
      .children(perms.map((x) => this.row(t, `perm-${x.id}`, true, () => { this.sel = { ...this.sel, perm: x.id }; this.permOpen = false; })
        .child(div().flex_1().child(x.label))
        .child(this.check(t, this.sel.perm === x.id))));
  }

  // Pick mode: one list, the current one checked.
  pickList(t) {
    const p = this.p;
    const pick = (o) => {
      setShared("newspace.pick", { key: p.key, field: p.pick, value: o.id, at: Date.now() });
      closeOverlay(p.overlay);
    };
    return v_flex().id("pick-list").w(p.width ?? 260).h(p.height ?? 200).p(5).bg(t.popover).text_size(12.8).text_color(t.foreground)
      .track_focus(this.handle)
      .children((p.options ?? []).map((o) => this.row(t, `pick-${o.id}`, true, () => pick(o))
        .when(Boolean(o.icon), (el) => el.child(o.tint ? svg(o.icon).size(14).flex_none().text_color(t.foreground) : image(o.icon).size(14).flex_none()))
        .child(div().flex_1().min_w(0).truncate().child(o.label))
        .child(this.check(t, o.id === p.current))));
  }

  // Settings mode: the choice goes back as soon as it changes.
  tell() {
    if (!this.settingsMode) return;
    const s = this.sel;
    setShared("newspace.pick", { key: this.p.key, field: "settings", value: { agent: s.agent, model: s.model, effort: s.effort, fast: s.fast, perm: s.perm }, at: Date.now() });
  }

  render(cx) {
    const t = theme();
    if (this.p.pick) return this.pickList(t);
    // Settings mode: a change goes back right after the render that shows it.
    if (this.settingsMode && this.told !== JSON.stringify(this.sel)) {
      // A preset choice (select) goes back at once too.
      const first = this.told === undefined && !this.preset;
      this.told = JSON.stringify(this.sel);
      if (!first) cx.timer.after(0, () => this.tell());
    }
    const remote = this.p.remote ?? null;
    const m = this.model();
    const menu = this.p.menus?.[this.sel.agent];
    const fast = Boolean(m?.fast) && !menu?.fastLocked;
    const changes = remote || this.settingsMode ? [] : this.changes();
    const perm = menu?.perms?.find((x) => x.id === this.sel.perm);
    const box = v_flex().id("model-menu").relative().w_full().flex_none().p(5).rounded(8).bg(t.popover).border_1().border_color(t.border).shadow_md()
      .text_size(12.8).text_color(t.foreground)
      .child(this.head(t, "Model"))
      .children(this.models().map((x) => this.row(t, `model-${x.agent}-${x.id}`, !remote, () => this.choose(x))
        .child(this.icon(x.agent, t))
        .child(div().flex_1().min_w(0).truncate().child(x.name))
        .when(Boolean(remote), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(remote)))
        .child(this.check(t, x.agent === this.sel.agent && x.id === this.sel.model))))
      .child(div().h(SEP).flex_none().py(4).px(4).child(div().h(1).w_full().bg(t.border)))
      .child(this.head(t, "Reasoning"))
      .child(this.levels(t))
      .when(fast, (el) => el.child(this.row(t, "fast", !remote, () => { this.sel = { ...this.sel, fast: !this.sel.fast }; })
        .child(svg("mods/chat-models/zap.svg").size(14).flex_none().text_color(t.dim))
        .child(div().flex_1().child("Fast"))
        .child(this.toggle(t, this.sel.fast))))
      .when(Boolean(menu?.perms?.length), (el) => el.child(this.row(t, "perms", !remote, () => { this.permOpen = !this.permOpen; })
        .when(this.permOpen, (el) => el.bg(t.selected))
        .child(svg("mods/chat-models/shield.svg").size(14).flex_none().text_color(t.dim))
        .child(div().flex_1().child("Permissions"))
        .child(div().flex_none().text_size(12).text_color(t.dim).child(perm?.label ?? ""))
        .child(svg("mods/workspace-chrome/chevron-right.svg").size(12).flex_none().text_color(t.dim))))
      .when(changes.length > 0, (el) => el.child(div().h(FOOT).flex_none().pt(5).child(h_flex().id("restart").w_full().h(28).px(10)
        .justify_center().items_center().rounded(7).cursor_pointer().bg(t.solid).text_color(t.solid_foreground).text_size(12.5).font_medium()
        .hover((s) => s.opacity(0.88))
        .on_click((_e, cx) => { cx.stop_propagation(); this.restart(); })
        .child(div().truncate().child(`Restart with ${changes.join(" · ")}`)))))
      .when(this.permOpen, (el) => el.child(this.permMenu(t, 5 + (changes.length ? FOOT : 0) + ROW)));
    // The overlay is the menu at its tallest; the menu sits at its bottom, just above the button.
    return v_flex().id("model-menu-area").w(300).h(this.p.height ?? 600).justify_end()
      .track_focus(this.handle)
      .on_mouse_down("left", (_e, cx) => { if (this.permOpen) { this.permOpen = false; cx.notify(); } })
      .child(box);
  }
}
