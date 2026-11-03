// The Tasks panel's small menus (mods/tasks), as popups at the pointer in the look of Herdr's
// own menu. props().menu:
//   "group"   the header's ⋯: group the list by status, space, machine, or machine then space
//             (shared "tasks.groupby", kept); the machine ones only when props().machines (more
//             than one machine has tasks)
//   "filter"  the filter row's More: the statuses that don't get a chip of their own;
//             props().items = [{ key, label, count }], props().current. A pick goes to the
//             panel as shared "tasks.filterreq" = { key, at }.
//   "row"     a task row's right-click: Pin or Unpin (props().on) the task props().key, in shared
//             "tasks.pinned" (mods/tasks keeps the same list).
// ↑/↓ move, Enter picks, Esc closes.

import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared } from "herdr";
import { menuRow, heading, TEXT } from "./ui.js";

// Shepherdr's GROUP_WORDS. "folder" was Space's old key.
const GROUPS = [{ key: "status", label: "Status" }, { key: "space", label: "Space" },
  { key: "machine", label: "Machine" }, { key: "machine-space", label: "Machine › Space" }];

// The menu's sections, each a title (or none), its items, which is checked and what a pick does.
function sections() {
  const p = props() ?? {};
  if (p.menu === "row") return [{ title: null, checks: false, current: null,
    items: [{ key: "pin", label: p.on ? "Unpin" : "Pin", icon: `mods/workspace-chrome/${p.on ? "pin-off" : "pin"}.svg` }],
    pick: () => {
      const v = shared("tasks.pinned");
      const rest = (Array.isArray(v) ? v : []).filter((k) => k !== p.key);
      setShared("tasks.pinned", p.on ? rest : [...rest, p.key]);
    } }];
  if (p.menu === "filter") return [{ title: null, items: p.items ?? [], current: p.current,
    pick: (key) => setShared("tasks.filterreq", { key, at: Date.now() }) }];
  const items = GROUPS.filter((g) => p.machines || !g.key.startsWith("machine"));
  // What the list shows now: by machine with one machine is by status, Machine › Space by space.
  const by = shared("tasks.groupby") === "folder" ? "space" : shared("tasks.groupby");
  const current = items.some((g) => g.key === by) ? by : by === "machine-space" ? "space" : "status";
  return [{ title: "Group by", items, current, pick: (key) => setShared("tasks.groupby", key) }];
}

// Every item in order, with its section: ↑/↓ run through all of them.
const flat = () => sections().flatMap((s) => s.items.map((x) => ({ ...x, s })));

export default class TasksMenu extends View {
  init(_props, cx) {
    const s0 = sections()[0];
    this.at = Math.max(0, flat().findIndex((x) => x.s.title === s0.title && x.key === s0.current));
    this.keyed = false; // the ↑/↓ highlight shows only once a key moved it: opening lights no row
    // The filter row draws More as open while this names an open More menu.
    if (props()?.menu === "filter") setShared("tasks.menuopen", props()?.overlay ?? true);
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  async close() {
    if (shared("tasks.menuopen") === props()?.overlay) setShared("tasks.menuopen", null);
  }

  choose(i) {
    const x = flat()[i];
    if (x) x.s.pick(x.key);
    closeOverlay(props()?.overlay);
  }

  render(cx) {
    const t = theme();
    const n = flat().length;
    let i = 0;
    return v_flex().id("tasks-menu").track_focus(this.handle).w_full().min_h(0).p(4).bg(t.popover).text_size(TEXT.body)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % n;
        else if (e.key === "up") this.at = (this.at + n - 1) % n;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(props()?.overlay);
        else return;
        this.keyed = true;
        cx.notify();
      })
      .children(sections().map((s, si) => v_flex().flex_none().when(si > 0, (el) => el.mt(4))
        .when(Boolean(s.title), (el) => el.child(div().px(8).child(heading(s.title))))
        .children(s.items.map((x) => this.item(x, s, i++, t)))));
  }

  // A 32 row (ui.js menuRow): its icon, the label, its count as the hint, a check on the current
  // pick (none in an action menu: checks false).
  item(x, s, i, t) {
    return menuRow(`tm-${x.key}`, x.label, { icon: x.icon ?? null, hint: x.count > 0 ? String(x.count) : null,
      check: s.checks === false ? null : x.key === s.current,
      onClick: () => this.choose(i) })
      .when(this.keyed && i === this.at, (el) => el.bg(t.hover));
  }
}
