// Rename, for a space, a section or a machine (its emoji and the name the sidebar shows), and New section: one small dialog drawn as New space's
// (mods/newspace: its own panel, frame "none", centered). Its icon button sits left of the name field: a click opens
// the emoji picker (icon.js), whose pick comes back through shared "spaces-chat.iconpick" and
// shows here until Save. The name field starts focused with its text selected.
// Enter saves, Esc cancels. A space's name goes through space.rename ("" gives Herdr's own name
// back); a section needs a name its machine's other sections don't have. New section makes one
// at the end of its machine's, with the icon picked (none: the folder).
// Opened as a dialog: props { view: "rename", space }, { view: "rename", section } or
// { view: "rename", new: "section", machine } or { view: "rename", renameMachine: true, machine }.
// A space's `name`: what the sidebar shows for it (main.js nameOf), its field's placeholder.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay, openOverlay, run, shared, spaces } from "herdr";
import { data, iconOf, setIcon, setSectionIcon, renameSection, addSection, nameFree, machineLook, setMachineLook } from "./sections.js";
import { logSpace } from "./spacelog.js";
import { dialogFooter, TEXT, RADIUS, H } from "./ui.js";

// As New space's (tabs-tasks/coordinator.js NEWSPACE): the app's one dialog footer (ui.js), 32 tall.
const K = { pad: 18, title: 20, label: 16, gap: 4, field: H.lg, buttons: H.lg, section: 16 };
export const RENAME = { width: 380, height: K.pad * 2 + K.title + K.section + K.label + K.gap + K.field + K.section + K.buttons };
export const PICK = "spaces-chat.iconpick";

// Where an element is, in the window, from a press on it.
export const rectOf = (e) => ({ x: e.position.x - (e.local_position?.x ?? 0), y: e.position.y - (e.local_position?.y ?? 0),
  width: e.bounds?.width ?? 0, height: e.bounds?.height ?? 0 });

export function openRename(of) {
  openOverlay({ mod: "spaces-chat", kind: "dialog", frame: "none", width: RENAME.width, height: RENAME.height, props: { view: "rename", ...of } });
}

// New section, on `machine` (null: this computer): the same dialog, empty.
export const openNewSection = (machine) => openRename({ new: "section", machine: machine ?? null });

// A machine (null: this computer): what the sidebar calls it, and its emoji.
export const openRenameMachine = (machine) => openRename({ renameMachine: true, machine: machine ?? null });

export class Rename {
  init(cx) {
    const p = props() ?? {};
    this.p = p;
    this.isSection = Boolean(p.section || p.new === "section");
    this.isMachine = Boolean(p.renameMachine);
    const look = this.isMachine ? machineLook(p.machine) : null;
    this.sec = p.section ? data().sections.find((s) => s.id === p.section) ?? null : null;
    const w = p.space ? spaces().find((s) => s.id === p.space) : null;
    this.icon = look ? look.icon : this.sec ? this.sec.icon ?? null : iconOf(p.space);
    this.picked = shared(PICK)?.at ?? 0;
    this.error = "";
    // A space nobody named shows Herdr's name as the placeholder: saving it empty keeps that.
    // A machine's too: its own name (hc's, or "This computer").
    // A space named "~" (as our New space once named home ones) counts as unnamed.
    const value = look ? (look.named ? look.name : "") : this.sec ? this.sec.name : w?.named && w.name !== "~" ? w.name : "";
    const placeholder = this.isMachine ? p.machine ?? "This computer" : this.isSection ? "Section name" : p.name ?? w?.name ?? "Space name";
    this.input = InputState.new({ placeholder, value });
    this.input.on("submit", (_e, cx) => { this.save(); cx.notify(); });
    this.input.on("change", (_e, cx) => { if (this.error) { this.error = ""; cx.notify(); } });
    this.input.on("focus", (_e, cx) => { this.focused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.focused = false; cx.notify(); });
    const focus = () => { this.input.focus(); this.input.set_selected_range({ start: 0, end: value.length }); };
    // Again once the menu that opened it has let the keyboard go (as New space does).
    focus();
    cx.timer.after(120, focus);
    cx.timer.after(300, () => { if (!this.focused) focus(); });
  }

  close() { this.input.release(); }

  cancel() { closeOverlay(this.p.overlay); }

  save() {
    const name = this.input.value().trim();
    if (this.p.new === "section") {
      const machine = this.p.machine ?? null;
      if (!name) { this.error = "A section needs a name."; return; }
      if (!nameFree(machine, name)) { this.error = "Another section here has this name."; return; }
      const id = addSection(machine, name);
      if (this.icon) setSectionIcon(id, this.icon);
    } else if (this.isMachine) {
      setMachineLook(this.p.machine ?? null, name, this.icon);
    } else if (this.p.section) {
      if (!this.sec) return this.cancel();
      if (!name) { this.error = "A section needs a name."; return; }
      if (!nameFree(this.sec.machine, name, this.sec.id)) { this.error = "Another section here has this name."; return; }
      if (name !== this.sec.name) renameSection(this.sec.id, name);
      setSectionIcon(this.sec.id, this.icon);
    } else {
      const w = spaces().find((s) => s.id === this.p.space);
      if (w && name !== (w.named && w.name !== "~" ? w.name : "") || w?.name === "~" && !name) {
        logSpace("rename", w.id, "spaces-chat: Rename dialog", { to: name });
        run("space.rename", { id: w.id, name });
      }
      setIcon(this.p.space, this.icon);
    }
    this.cancel();
  }

  // The picker, under the icon button; its pick is for this dialog only.
  pick(at) {
    openOverlay({ mod: "spaces-chat", kind: "popup", width: 360, height: 420, at: at ? { x: at.x, y: at.y + at.height + 4 } : "pointer",
      props: { view: "icon", for: this.p.overlay, current: this.icon, section: this.isSection,
        machine: this.isMachine ? (this.p.machine ? "server" : "monitor") : null, width: 360, height: 420 } });
  }

  render(cx) {
    const t = theme();
    const rq = shared(PICK);
    if (rq?.for === this.p.overlay && rq.at > this.picked) {
      this.picked = rq.at;
      this.icon = rq.emoji ?? null;
      cx.timer.after(0, () => this.input.focus());
    }
    // What stands for it in the sidebar: the emoji, else "#" (a space), the folder (a section) or
    // the server / monitor (a machine).
    const mark = this.icon
      ? div().text_size(16).child(this.icon)
      : this.isMachine
        ? svg(`mods/workspace-chrome/${this.p.machine ? "server" : "monitor"}.svg`).size(14).text_color(t.muted)
      : this.isSection
        ? svg("mods/workspace-chrome/folder.svg").size(14).text_color(t.muted)
        : div().text_size(16).text_color(t.muted).child("#");
    const panel = v_flex().id("rename").w_full().flex_none().p(K.pad).rounded(10).border(1).border_color(t.border).bg(t.popover).shadow_lg().text_size(TEXT.body)
      .on_key_down((e) => { if (e.key === "escape") this.cancel(); })
      .child(div().h(K.title).flex_none().text_size(TEXT.title).font_semibold().text_color(t.foreground).child(this.p.new ? "New section" : this.isMachine ? "Rename machine" : this.p.section ? "Rename section" : "Rename space"))
      .child(div().h(K.section).flex_none())
      .child(div().h(K.label).flex_none().text_size(TEXT.label).text_color(t.dim).child("Icon and name"))
      .child(div().h(K.gap).flex_none())
      .child(h_flex().h(K.field).flex_none().gap(8).items_center()
        .child(h_flex().id("icon").size(K.field).flex_none().justify_center().items_center().rounded(RADIUS.control).border(1).border_color(t.input).bg(t.background)
          .cursor_pointer().hover((s) => s.bg(t.hover))
          .on_mouse_down("left", (e) => { this.at = rectOf(e); })
          .on_click(() => this.pick(this.at))
          .child(mark))
        .child(Input.new(this.input).flex_1().h(K.field).px(10).items_center().rounded(RADIUS.control).border(1)
          .border_color(this.error ? t.blocked : this.focused ? t.accent : t.input).bg(t.background).text_color(t.foreground)))
      .child(div().h(K.section).flex_none())
      .child(dialogFooter({ onCancel: () => this.cancel(), note: this.error, error: true,
        primary: { id: "save", label: this.p.new ? "Create section" : "Save", onClick: () => this.save() } }));
    return v_flex().size_full().justify_center().child(panel);
  }
}
