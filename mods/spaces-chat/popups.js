// The sidebar's own popup menus, drawn as Herdr's (mods/menu): the machine header's + and
// right-click menu, a space's right-click menu (Pin / Unpin too) and a section header's. Each is this mod opened as a popup with
// props { view, ... }. Rename opens the rename dialog (rename.js), where the icon changes too;
// New section opens it empty, as New section.
// Spaces move between sections by dragging only. ↑/↓ move, Enter runs, Esc closes. Rows are the
// app's menu rows (ui.js menuRow, 32 tall); a label ends in "…" when it opens a dialog.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, setShared } from "herdr";
import { spaces } from "./live.js";
import { deleteSection, isPinned, pin, data } from "./sections.js";
import { withMachineOrder } from "./core/spaces.js";
import { assistantOf, markRead } from "./unread.js";
import { NOTIFY, notifyOf, setNotify } from "./notify.js";
import { openRename, openNewSection, openRenameMachine } from "./rename.js";
import { logSpace } from "./spacelog.js";
import { menuRow, segmented, TEXT, openSettings } from "./ui.js";
import { addMenu, spaceMenu, machineMenu, sectionMenu } from "./core/menus.js";
import { requestCoordinator } from "./coordinator.js";

const ROW = 32, PAD = 5, SEP = 9, W = 210;
// The Notify setting (a space's menu): its labeled row, then a small note under it. A menu with it
// is wider, so "Notify" and its three choices fit whole (never truncated).
const SETTING = 32, NOTE = 20, W_SETTING = 270;
// Columns every row shares (ui.js menuRow): the 16 icon at the row's padding, text after icon + gap.
const ROW_X = 8, ICON = 16, ICON_GAP = 8, TEXT_X = ROW_X + ICON + ICON_GAP;
const icon = (name) => (name.includes("/") ? name : `mods/workspace-chrome/${name}.svg`);

// Close a space: our confirm (mods/confirm-chat), its button the verb; then Herdr's close, confirmed.
function closeSpace(id, name) {
  const w = spaces().find((s) => s.id === id);
  openOverlay({ mod: "confirm-chat", kind: "dialog", width: 400, height: 168, props: {
    title: `Close “${name ?? w?.name ?? "this space"}”?`,
    detail: "Its tabs close and every program in them ends.",
    verb: "Close space",
    command: { name: "space.close", args: { id, confirmed: true } } } });
  logSpace("close", id, "spaces-chat: space menu Close (asks in confirm-chat)");
}

export { rectOf } from "./rename.js";

// New space, on `machine` (null: this computer): the New space dialog (mods/newspace) aimed there.
// The tab bar (tabs-tasks) opens it: it knows how tall to make it.
export function newSpace(machine) {
  setShared("newspace.on", { machine: machine ?? null, at: Date.now() });
  run("tabs-tasks.newspace-on");
}

// A popup's height for its items: rows, separators and padding.
const heightOf = (items) => items.reduce((h, it) => h + (it.sep ? SEP : it.notify ? SETTING + NOTE : ROW), PAD * 2);

export function openMenu(view, p, at = "pointer") {
  const items = ITEMS[view](p);
  const width = items.some((it) => it.notify) ? W_SETTING : W;
  openOverlay({ mod: "spaces-chat", kind: "popup", width, height: heightOf(items), at, props: { view, ...p } });
}

// Each menu's items: { label, icon, hint, act }, or { sep: true }: core/menus.js's lists (the web app builds its menus
// from the same ones), each item done here.
const MENU_ICON = { "check-check": "mods/spaces-chat/check-check.svg", "arrow-up": "mods/spaces-chat/arrow-up.svg", "arrow-down": "mods/spaces-chat/arrow-down.svg", "trash-2": "mods/spaces-chat/trash-2.svg", network: "mods/coordinator/network.svg" };
const built = (list, acts) => list.map((it) => (it.sep ? it : it.setting ? { ...acts[it.id], note: it.note } : { label: it.label, icon: MENU_ICON[it.icon] ?? it.icon, act: acts[it.id] }));
const ITEMS = {
  // The machine header's +.
  add: (p) => built(addMenu(), { "new-space": () => newSpace(p.machine), "new-section": () => openNewSection(p.machine) }),
  space: (p) => built(spaceMenu({ unread: p.unread, pinned: isPinned(p.space), git: p.git, assistant: p.assistant !== false }), {
    // No Assistant's tab yet (on any machine): the tab bar opens it, on the space's machine, taking
    // one already running there (coordinator.js openCoordinator); the view goes to it.
    assistant: () => requestCoordinator({ id: p.space }),
    // Its Assistant's Notify (notify.js), as Shepherdr's: picked in place, the menu stays open.
    notify: { notify: p.space },
    read: () => markRead(assistantOf({ id: p.space, machine: p.machine })),
    pin: () => pin(p.space), unpin: () => pin(p.space, false),
    rename: () => openRename({ space: p.space, name: p.name }),
    // Its own settings: the Settings window, scoped to this space.
    settings: () => openSettings({ space: p.space }),
    "worktree-new": () => worktree(p.space, "new"), "worktree-open": () => worktree(p.space, "open"), "worktree-remove": () => worktree(p.space, "remove"),
    close: () => closeSpace(p.space, p.name),
  }),
  // A machine header's right-click: its name and emoji (rename.js), and its place among the machines (p.order: as they
  // show; shared "spaces-chat".machineOrder, as the web app's Move up / Move down).
  machine: (p) => {
    const order = Array.isArray(p.order) ? p.order : [], i = order.indexOf(p.machine ?? null);
    const step = (by) => {
      const next = order.filter((k) => k !== (p.machine ?? null));
      next.splice(i + by, 0, p.machine ?? null);
      setShared("spaces-chat", withMachineOrder(data(), next));
    };
    return built(machineMenu({ first: i <= 0, last: i < 0 || i >= order.length - 1 }), { rename: () => openRenameMachine(p.machine), up: () => step(-1), down: () => step(1) });
  },
  // Delete is at once; its toast offers Undo (sections.js).
  section: (p) => built(sectionMenu(), { rename: () => openRename({ section: p.section }), delete: () => deleteSection(p.section) }),
};

function worktree(space, action) {
  openOverlay({ mod: "worktree", kind: "dialog", ...(action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: { space, action } });
}

// One menu: plain object, driven by the mod's View (main.js) while it is a popup.
export class Menu {
  init(cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i) {
    const p = props();
    const it = ITEMS[p.view](p).filter((x) => !x.sep && !x.notify)[i];
    if (!it) return;
    closeOverlay(p.overlay);
    it.act();
  }

  render() {
    const t = theme();
    const p = props();
    const all = ITEMS[p.view](p);
    const count = all.filter((x) => !x.sep && !x.notify).length;
    const space = all.find((x) => x.notify)?.notify;
    let n = -1;
    return v_flex().id("menu").track_focus(this.handle).w_full().min_h(0).p(PAD).bg(t.popover).text_size(TEXT.body)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % count;
        else if (e.key === "up") this.at = (this.at + count - 1) % count;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(p.overlay);
        // ←/→ step through Notify's choices.
        else if (space && (e.key === "left" || e.key === "right")) {
          const at = NOTIFY.indexOf(notifyOf(space)) + (e.key === "right" ? 1 : -1);
          if (at >= 0 && at < NOTIFY.length) setNotify(space, NOTIFY[at]);
        }
        else return;
        cx.notify();
      })
      .children(all.map((it, k) => {
        if (it.sep) return div().id(`sep-${k}`).mx(7).my(4).h(1).flex_none().bg(t.border);
        if (it.notify) return notifySetting(it.notify, t, it.note);
        const i = ++n;
        return menuRow(`mi-${i}`, it.label, { icon: it.icon ? icon(it.icon) : null, hint: it.hint, onClick: () => this.choose(i) })
          .when(i === this.at, (el) => el.bg(t.selected));
      }));
  }
}

// Notify: its bell (crossed out when Off) in the icon column, "Notify" in the text column, and its
// choices at the right (ui.js segmented: each as wide as its words, never cut; the picked one a soft
// pill). Under it, on the text column, a quiet note. Picked in place: the menu stays open.
// A pick that is what Everywhere gives goes back to following it.
function notifySetting(space, t, note) {
  const now = notifyOf(space);
  return v_flex().id("notify").flex_none()
    .child(h_flex().h(SETTING).px(ROW_X).gap(ICON_GAP).items_center().text_size(TEXT.body).text_color(t.foreground)
      .child(svg(`mods/spaces-chat/${now === "Off" ? "bell-off" : "bell"}.svg`).size(ICON).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).child("Notify"))
      .child(segmented("notify", NOTIFY.map((v) => [v, v]), now, (v) => setNotify(space, v))))
    .child(h_flex().h(NOTE).pl(TEXT_X).pr(ROW_X).pb(4).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(TEXT.id).text_color(t.dim).child(note)));
}
