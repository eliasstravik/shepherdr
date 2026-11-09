// The Tasks panel's small menus (mods/tasks), as popups at the pointer in the look of Herdr's
// own menu. props().menu:
//   "group"   the header's ⋯: group the list For you, by space or by status (shared "tasks.group",
//             kept; props().current, the panel's grouping now: core/tasks.js groupNow)
//   "filter"  the filter row's More: the statuses that don't get a chip of their own;
//             props().items = [{ key, label, count }], props().current. A pick goes to the
//             panel as shared "tasks.filterreq" = { key, at }.
//   "row"     a task row's right-click: Pin or Unpin (props().on) the task props().key, in shared
//             "tasks.pinned" (mods/tasks keeps the same list). A task not started yet (props().status
//             todo, queued or scheduled) also starts later (SHEP-38): herdr-task edit --in / --at on
//             props().machine, folder and ref; a scheduled one Start now and Unschedule. What herdr-task
//             refuses shows as a toast.
// ↑/↓ move, Enter picks, Esc closes.

import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared, exec, appHome } from "herdr";
import { menuRow, heading, toast, TEXT } from "./ui.js";
import { taskMenu } from "./core/menus.js";

// Shepherdr's GROUP_WORDS (core/tasks.js GROUP_BY).
const GROUPS = [{ key: "you", label: "For you" }, { key: "space", label: "Space" }, { key: "status", label: "Status" }];

// The menu's sections, each a title (or none), its items, which is checked and what a pick does.
function sections() {
  const p = props() ?? {};
  if (p.menu === "row") return rowSections(p);
  if (p.menu === "filter") return [{ title: null, items: p.items ?? [], current: p.current,
    pick: (key) => setShared("tasks.filterreq", { key, at: Date.now() }) }];
  const current = GROUPS.some((g) => g.key === p.current) ? p.current : "you";
  return [{ title: "Group by", items: GROUPS, current, pick: (key) => setShared("tasks.group", key) }];
}

// A row's menu (core/menus.js taskMenu, the web's too): its sections between the lines, a heading
// over Start later's times. Other time… is the web's (a typed time): here the Assistant does that.
function rowSections(p) {
  const out = [];
  let cur = null;
  for (const it of taskMenu({ pinned: p.on, status: p.status ?? null })) {
    if (it.typed) continue;
    if (it.sep || it.heading || !cur) out.push(cur = { title: it.heading ? (p.status === "scheduled" && p.sub ? `${it.heading} · ${p.sub}` : it.heading) : null,
      checks: false, current: null, items: [], pick: (key) => rowPick(p, key) });
    if (it.sep || it.heading) continue;
    cur.items.push({ key: `${it.id}:${cur.items.length}`, label: it.label, at: it.at, in: it.in, id: it.id,
      icon: it.icon === "play" ? "mods/tasks/play.svg" : `mods/workspace-chrome/${it.icon}.svg` });
  }
  return out.filter((s) => s.items.length);
}

function rowPick(p, key) {
  const it = rowSections(p).flatMap((s) => s.items).find((x) => x.key === key);
  if (!it) return;
  if (it.id === "pin" || it.id === "unpin") {
    const v = shared("tasks.pinned");
    const rest = (Array.isArray(v) ? v : []).filter((k) => k !== p.key);
    setShared("tasks.pinned", p.on ? rest : [...rest, p.key]);
    return;
  }
  const args = it.id === "start-now" ? ["start", p.ref, "--now"] : it.id === "unschedule" ? ["edit", p.ref, "--at", ""]
    : ["edit", p.ref, ...(it.in ? ["--in", it.in] : ["--at", it.at])];
  // herdr-task, here or (--on) on the folder's machine; the list shows the change on its next read.
  exec(`${appHome()}/mods/tasks/bin/herdr-task`, [...(p.machine ? ["--on", p.machine] : []), ...args, "--json", "--folder", p.folder])
    .then((r) => {
      let out = null;
      try { out = JSON.parse(r.stdout || "null"); } catch {}
      if (r.code !== 0 || !out || out.error) toast({ level: "error", title: `Couldn't schedule ${p.ref}`, body: out?.error || r.stderr?.trim() || "herdr-task refused it." });
    })
    .catch((e) => toast({ level: "error", title: `Couldn't schedule ${p.ref}`, body: String(e?.message ?? e) }));
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
