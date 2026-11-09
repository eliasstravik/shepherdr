// The chat's model menu: a popover above the chat's model button (mods/chat), drawn like
// Herdr's other menus (new-menu-tasks), made for any number of agents with any number of models:
// a tab per installed agent (only when more than one), a search over every agent's models (the
// keys go to it at once; ↑/↓ and Enter pick, Esc closes), the agent's pinned and recent models on
// top (core/agents.js modelSections) with a star to pin one (~/.config/shepherdr/model-picks.json, the web's
// too), one word no model has offered as an id to start on; then Reasoning (that model's levels),
// Fast (where the model has it), Permissions (a small sub-menu), and, only when a choice differs
// from what runs now, one Restart button, said first to start a new conversation when it switches
// agent. The chat does the restart.
// Props (plain data from the chat; this mod reads nothing else about the agent):
//   { pane, current: { agent, model, effort, fast, perm }, select?: { agent, model } (comes chosen), menus: { claude?, codex? }
//     (agent.js menuFor), icons: { <agent>: { icon, tint } }, permDefault, offline (its machine's name
//     when it can't be reached now: said by the Restart button), overlay }
// The overlay is frameless and as tall as the menu at its tallest (the chat counts it with the
// sizes below); the menu sits at its bottom and grows upward, so nothing is ever cut off.
// Restart goes back through shared "chat.restartreq" = { pane, at, pick }.
// Pick mode (for the coordinator settings rows, mods/chat/settings.js): a plain list,
//   props { pick: field, key, options: [{ id, label, icon?, tint? }], current, width, height };
// the choice goes back through shared "newspace.pick" = { key, field, value, at }.
// Settings mode (settings.js settingsButton): the whole menu without Restart; every change
// goes back at once as { key, field: "settings", value: { agent, model, effort, fast, perm } }.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, VirtualListScrollHandle, v_virtual_list, Scrollbar } from "gpui-base";
import { theme, props, setShared, closeOverlay, home, readTextFile, writeTextFile } from "herdr";
import { modelSections, parsePicks, pickKey, withPin, withRecent, PICKS_FILE, permAcross } from "./core/agents.js";
import { dirs } from "./dirs.js";

const AGENTS = ["claude", "codex"];
const LEVEL = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra", none: "None" };
// Sizes, as the chat counts them for the overlay's height (mods/chat openPicker): the model list
// scrolls past LIST; NOTE is a quiet line (an offline machine's; a new conversation's, two lines).
export const ROW = 31, HEAD = 26, SEP = 9, SEG = 34, FOOT = 33, TABS = 34, SEARCH = 36, LIST = 8 * 31, NOTE = 20, STAR = 20;
const picksPath = () => dirs()["model-picks"];

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
    this.tab = this.sel.agent;
    this.cursor = 0; // the row ↑/↓ are on, among the list's models
    this.picks = parsePicks("");
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: Object.keys(p.menus ?? {}).length > 1 ? "Search every agent’s models" : "Search models" });
    this.scroll = VirtualListScrollHandle.new();
    this.input.on("change", (_e, cx) => { this.cursor = 0; this.scroll.scroll_to_item(0, "top"); cx.notify(); });
    this.input.on("submit", (_e, cx) => { const r = this.rows()[this.cursor]; if (r) this.pickRow(r); cx.notify(); });
    const focus = () => this.input.focus();
    focus();
    cx.timer.after(0, focus);
    cx.spawn(async (cx) => {
      this.picks = parsePicks(await readTextFile(picksPath()).catch(() => ""));
      cx.notify();
    });
  }

  close() { this.input?.release(); this.scroll?.release(); }

  // The list as shown now: sections of rows (core/agents.js modelSections).
  sections() {
    return modelSections(this.p.menus ?? {}, this.tab, this.picks, this.input?.value() ?? "");
  }
  rows() {
    return this.sections().flatMap((s) => s.rows);
  }

  // A model's row picked (a typed id joins its agent's list, so its levels and Restart know it).
  pickRow(r) {
    if (r.typed) {
      const menu = this.p.menus?.[r.agent];
      if (menu && !menu.models.some((m) => m.id === r.id)) menu.models = [r, ...menu.models];
    }
    this.choose(r);
    this.tab = r.agent;
    this.input.set_value("");
    this.cursor = 0;
  }

  // The star: pinned to the top of its agent's list, or not any more, in the file the web reads too.
  pin(r, cx) {
    cx.spawn(async (cx) => {
      const now = parsePicks(await readTextFile(picksPath()).catch(() => ""));
      this.picks = withPin(now, pickKey(r.agent, r.id));
      cx.notify();
      await writeTextFile(picksPath(), JSON.stringify(this.picks, null, 2)).catch(() => null);
    });
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
      // Another agent: its own permission modes, the nearest to the one chosen.
      next.perm = permAcross(was.perm, m.agent, this.p.permDefault);
      next.fast = false;
    }
    this.sel = next;
  }

  // What would change, in words, or [] when nothing would.
  changes() {
    const s = this.sel, w = this.was, out = [];
    if (s.agent !== w.agent) out.push(this.p.menus?.[s.agent]?.name ?? s.agent);
    if (s.agent !== w.agent || s.model !== w.model) out.push(this.model()?.name ?? s.model);
    if (this.level(s) && this.level(s) !== this.level(w)) out.push(LEVEL[this.level(s)] ?? this.level(s));
    if (s.fast !== w.fast) out.push(s.fast ? "Fast" : "Standard");
    if (s.perm && s.perm !== w.perm) out.push(this.p.menus?.[s.agent]?.perms?.find((x) => x.id === s.perm)?.label ?? s.perm);
    return out;
  }

  restart(cx) {
    const s = this.sel;
    setShared("chat.restartreq", { pane: this.p.pane, at: Date.now(), pick: { agent: s.agent, model: s.model, effort: this.level(s), fast: s.fast, perm: s.perm } });
    // first among the recent ones, here and in the web's menu
    if (s.model) cx.spawn(async () => {
      const now = parsePicks(await readTextFile(picksPath()).catch(() => ""));
      await writeTextFile(picksPath(), JSON.stringify(withRecent(now, pickKey(s.agent, s.model)), null, 2)).catch(() => null);
    });
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

  // That model's levels as one segmented control; the default shows chosen when none is set. Each level is as
  // wide as its word and the room left is shared out, so Extra high reads whole (equal slices cut it).
  levels(t) {
    const m = this.model();
    const on = this.level(this.sel);
    return h_flex().h(SEG).flex_none().px(4).items_center().child(h_flex().w_full().h(28).p(2).gap(2).rounded(7).bg(t.raised)
      .children((m?.efforts ?? []).map((e) => h_flex().id(`level-${e}`).flex_auto().min_w(0).px(4).h_full().justify_center().items_center().rounded(5)
        .text_size(11.5)
        .when(on === e, (el) => el.bg(t.background).text_color(t.foreground).font_medium())
        .when(on !== e, (el) => el.text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.sel = { ...this.sel, effort: e }; cx.notify(); }))
        .child(div().truncate().child(LEVEL[e] ?? e)))));
  }

  // A small switch: on is the accent, the knob slides.
  toggle(t, on, id = "fast-knob") {
    return div().relative().w(28).h(16).flex_none().rounded(8).bg(on ? t.accent : t.input)
      .child(div().id(id).absolute().top(2).left(on ? 14 : 2).size(12).rounded(6).bg(t.background).transition("left", 120));
  }

  // The permission modes, just above the Permissions row. It takes its own presses: the menu's press closes it, and
  // closed before the click, the click fell on the Fast row under it (GitHub #767, #740).
  permMenu(t, bottom) {
    const perms = this.p.menus?.[this.sel.agent]?.perms ?? [];
    return v_flex().id("perm-menu").absolute().right(5).bottom(bottom).w(180).p(5).rounded(8).bg(t.popover).border_1().border_color(t.border).shadow_md()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
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
    const offline = this.p.offline ?? null;
    const m = this.model();
    const menu = this.p.menus?.[this.sel.agent];
    const fast = Boolean(m?.fast);
    const changes = this.settingsMode ? [] : this.changes();
    const perm = menu?.perms?.find((x) => x.id === this.sel.perm);
    const agents = Object.keys(this.p.menus ?? {});
    const sections = this.sections();
    const rows = sections.flatMap((s) => s.rows);
    this.cursor = Math.max(0, Math.min(this.cursor, rows.length - 1));
    const cur = rows[this.cursor];
    const newChat = changes.length > 0 && this.sel.agent !== this.was.agent;
    const quiet = (text, h = NOTE) => div().min_h(h).flex_none().px(9).py(3).text_size(11.5).text_color(t.dim).child(text);
    // The list's items, each its height and how it draws: headings, models, "N more" lines.
    const items = sections.flatMap((s) => [
      ...(s.title ? [{ key: `h-${s.key}`, h: HEAD, draw: () => this.head(t, s.title) }] : []),
      ...s.rows.map((x) => ({ key: `m-${x.agent}:${x.id}`, h: ROW, row: x, draw: () => this.modelRow(t, x, x === cur) })),
      ...(s.more ? [{ key: `more-${s.key}`, h: NOTE, draw: () => quiet(`${s.more} more. Type to narrow.`) }] : []),
    ]);
    const listH = Math.min(LIST, items.reduce((n, x) => n + x.h, 0));
    this.listW = (this.p.width ?? 340) - 12;
    // ↑/↓ keep their row in view (its heading too, going up)
    const show = (i) => {
      const at = items.findIndex((x) => x.row === rows[i]);
      if (at >= 0) this.scroll.scroll_to_item(at > 0 && items[at - 1].row === undefined && i < this.cursor ? at - 1 : at);
    };
    const box = v_flex().id("model-menu").relative().w_full().flex_none().p(5).rounded(8).bg(t.popover).border_1().border_color(t.border).shadow_md()
      .text_size(12.8).text_color(t.foreground)
      .when(agents.length > 1, (el) => el.child(h_flex().h(TABS).flex_none().px(4).pb(4).items_center()
        .child(h_flex().w_full().h(28).p(2).gap(2).rounded(14).bg(t.raised)
          .children(agents.map((a) => h_flex().id(`tab-${a}`).flex_1().min_w(0).h_full().px(8).gap(6).justify_center().items_center().rounded(12)
            .text_size(12)
            .when(this.tab === a, (el) => el.bg(t.background).text_color(t.foreground).font_medium())
            .when(this.tab !== a, (el) => el.text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => { cx.stop_propagation(); this.tab = a; this.input.set_value(""); this.cursor = 0; cx.notify(); }))
            .child(this.icon(a, t))
            .child(div().truncate().child(this.p.menus[a].name)))))))
      .child(h_flex().h(SEARCH).flex_none().px(4).pb(4).items_center()
        .child(h_flex().w_full().h(30).px(10).gap(8).rounded(7).bg(t.raised).items_center()
          .child(svg("mods/workspace-chrome/search.svg").size(13).flex_none().text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))))
      .child(rows.length === 0 ? quiet("No models.", ROW) : div().id("model-list-area").relative().flex_none().h(listH)
        .on_mouse_down("left", (e) => { this.pressX = e.local_position?.x ?? null; })
        .child(v_virtual_list("model-list", items.length, items.map((x) => x.h), (i) => items[i].key,
          (range) => items.slice(range.start, range.end).map((x) => x.draw()))
          .track_scroll(this.scroll).size_full()
          // Rows take no handlers: the list says which was pressed, the press's place whether on its star.
          .on_item_click((key, cx) => {
            const x = items.find((i) => i.key === key);
            if (!x?.row) return;
            if (!x.row.typed && this.pressX !== null && this.pressX > this.listW - STAR - 4) this.pin(x.row, cx);
            else this.pickRow(x.row);
            cx.notify();
          }))
        .child(Scrollbar.vertical("model-list").absolute().inset_0()))
      .child(div().h(SEP).flex_none().py(4).px(4).child(div().h(1).w_full().bg(t.border)))
      .when(Boolean(m?.efforts?.length), (el) => el.child(this.head(t, "Reasoning")).child(this.levels(t)))
      .when(fast, (el) => el.child(this.row(t, "fast", true, () => { this.sel = { ...this.sel, fast: !this.sel.fast }; })
        .child(svg("mods/chat-models/zap.svg").size(14).flex_none().text_color(t.dim))
        .child(div().flex_1().child("Fast"))
        .child(this.toggle(t, this.sel.fast))))
      // its own press too: else the menu's closes it and the click opens it again
      .when(Boolean(menu?.perms?.length), (el) => el.child(this.row(t, "perms", true, () => { this.permOpen = !this.permOpen; })
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .when(this.permOpen, (el) => el.bg(t.selected))
        .child(svg("mods/chat-models/shield.svg").size(14).flex_none().text_color(t.dim))
        .child(div().flex_1().child("Permissions"))
        .child(div().flex_none().text_size(12).text_color(t.dim).child(perm?.label ?? ""))
        .child(svg("mods/workspace-chrome/chevron-right.svg").size(12).flex_none().text_color(t.dim))))
      // another agent can't carry this conversation on: said before the press, not after
      .when(newChat, (el) => el.child(quiet(`${this.p.menus?.[this.sel.agent]?.name ?? "It"} starts a new conversation. This one stays in ${this.p.menus?.[this.was.agent]?.name ?? "its old agent"}’s history.`, 2 * NOTE)))
      // its machine out of reach: said once a change is chosen; the button still tries
      .when(changes.length > 0 && Boolean(offline), (el) => el.child(quiet(`${offline} is offline. Try again once it’s back.`)))
      .when(changes.length > 0, (el) => el.child(div().min_h(FOOT).flex_none().pt(5).child(h_flex().id("restart").w_full().min_h(28).px(10).py(5)
        .justify_center().items_center().rounded(7).cursor_pointer().bg(t.solid).text_color(t.solid_foreground).text_size(12.5).font_medium()
        .hover((s) => s.opacity(0.88))
        .on_click((_e, cx) => { cx.stop_propagation(); this.restart(cx); })
        // its words wrap rather than end in …
        .child(div().text_center().child(`Restart with ${changes.join(" · ")}`)))))
      .when(this.permOpen, (el) => el.child(this.permMenu(t, 5 + (changes.length ? FOOT + (offline ? NOTE : 0) : 0) + (newChat ? 2 * NOTE : 0) + ROW)));
    // The overlay is the menu at its tallest; the menu sits at its bottom, just above the button.
    return v_flex().id("model-menu-area").w(this.p.width ?? 340).h(this.p.height ?? 600).justify_end()
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { cx.stop_propagation(); if (this.permOpen) { this.permOpen = false; cx.notify(); } else closeOverlay(this.p.overlay); return; }
        if (e.key === "down") { const i = Math.min(rows.length - 1, this.cursor + 1); show(i); this.cursor = i; }
        else if (e.key === "up") { const i = Math.max(0, this.cursor - 1); show(i); this.cursor = i; }
        else if (e.key === "tab" && agents.length > 1) { this.tab = agents[(agents.indexOf(this.tab) + (e.modifiers?.shift ? agents.length - 1 : 1)) % agents.length]; this.input.set_value(""); this.cursor = 0; }
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .on_mouse_down("left", (_e, cx) => { if (this.permOpen) { this.permOpen = false; cx.notify(); } })
      .child(box);
  }

  // One model in the list: its agent's mark, its name (a typed id: "Use <id>"), the check on the one
  // chosen, and its star at the right end (bright when pinned, faint else; the list's click on that
  // place pins). No handlers of its own: the virtual list takes the clicks.
  modelRow(t, x, at) {
    const chosen = x.agent === this.sel.agent && x.id === this.sel.model;
    return h_flex().w_full().h(ROW).px(9).gap(10).rounded(7).items_center()
      .text_color(t.foreground)
      .cursor_pointer().hover((s) => s.bg(t.selected))
      .when(at, (el) => el.bg(t.selected))
      .child(this.icon(x.agent, t))
      .child(div().flex_1().min_w(0).truncate().child(x.typed ? `Use ${x.id}` : x.name))
      .when(Boolean(x.typed), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`${this.p.menus?.[x.agent]?.name ?? x.agent} id`)))
      .child(this.check(t, chosen))
      .when(!x.typed, (el) => el.child(div().size(STAR).flex_none().flex().items_center().justify_center()
        .child(svg(x.pinned ? "mods/chat-models/star-on.svg" : "mods/chat-models/star.svg").size(13).text_color(x.pinned ? t.muted : at ? t.dim : t.border))));
  }
}
