// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: its branch. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder. Under each machine, its sections
// (sections.js): the + on its header makes one, spaces drag in and out of them (only by
// dragging; a folded one opens while a space is dragged over it). Above the machines, Pinned
// (Pin / Unpin in a space's menu, or a drag in and out). A machine header's right-click renames
// it: the name and emoji the sidebar shows. A space nobody named reads after where it is
// (nameOf: "Home", its repo, its folder); two with one name on a machine show their folder dim.
// A machine that isn't connected reads "Offline", dimmed and folded, with no + or meter.
// Opened as an overlay (props.view), this mod is instead one of its menus (popups.js), the
// rename and New section dialog (rename.js) or that dialog's icon picker (icon.js).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { machines, run, props, exec, hc, home, theme, shared, setShared, watchFolder, window, layout, nextCommand, readTextFile } from "herdr";
import { panes, spaces as allSpaces, inRender } from "./live.js";
import { countsByTab, readyByTab } from "./inbox.js";
import { spacesWithChats } from "./parked.js";
import { sectionsOf, sectionOf, iconOf, placeSpace, foldSection, prune, data, pin, foldPinned, machineLook, restoreSection } from "./sections.js";
import { Menu, openMenu, rectOf } from "./popups.js";
import { IconPicker } from "./icon.js";
import { Rename } from "./rename.js";
import { unreadSpaces, readShown } from "./unread.js";
import { muted } from "./notify.js";
import { MachinePopup, openMachine, openMachineSettings } from "./machine-popup.js";
import { startPolling, allStats, healthMeters, bars } from "./machines.js";
import { countBadge, red, H, TEXT, RADIUS } from "./ui.js";
import { spaceName, gitTail, tilde, sharedNames } from "./core/spaces.js";
import { coordinatorTab } from "./coordinator.js";

const POPUPS = { add: Menu, space: Menu, section: Menu, icon: IconPicker, rename: Rename, machine: MachinePopup };

// Spaces with agents showing as a chat counted in their status.
const spaces = spacesWithChats;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Checkouts made for work (~/.herdr/worktrees/<repo>/<branch>, on any machine): a coordinator's
// task workers run in them, and a worktree space is made in one.
const WORKTREES = /\/\.herdr\/worktrees\//;
const inside = (path, folder) => path === folder || path.startsWith(`${folder.replace(/\/+$/, "")}/`);

// Where a space is now: its first terminal's live folder, else where it was made. A task
// worker's checkout never speaks for the space (its branch isn't the space's): a terminal
// in ~/.herdr/worktrees counts only inside the space's own folder (a worktree space's).
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  const own = (cwd) => !WORKTREES.test(`${cwd}/`) || (s.folder && inside(cwd, s.folder));
  return ps.find((p) => tabs.has(p.tab) && p.cwd && own(p.cwd))?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
// drag()'s machine for Pinned's places: a space from any machine lands there.
const ANY = "\u0000any";
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// A home folder, here or on another machine (whose home() isn't known here), and a path from it (tilde), and the spaces
// two on one machine share a name with, which show their folder (sharedNames): the shared core's, as the web's rows.
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

// A space's name (or its number on the rail): bold and bright while its Assistant has something
// new (unread.js), as Slack's unread channels. A hidden bold copy holds the width either way, so
// nothing beside it moves when it turns bold.
function nameText(text, fresh, color, t) {
  return div().relative().min_w(0)
    .child(div().invisible().font_semibold().truncate().child(text))
    .child(div().absolute().top(0).left(0).right(0).truncate().text_color(fresh ? t.foreground : color)
      .when(fresh, (el) => el.font_semibold()).child(text));
}

export default class Spaces extends View {
  init(_props, cx) {
    const Popup = POPUPS[props()?.view];
    if (Popup) {
      this.popup = new Popup();
      this.popup.init(cx);
      return;
    }
    this.git = {}; // where() -> { name, branch, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null; // the space being dragged (its id)
    this.over = null; // where it would land: "space:<id>", "section:<id>" (its end) or "top:<machine>"
    this.peek = null; // a folded section opened while a space is dragged over it
    this.unread = new Set(); // spaces whose Assistant has something new (unread.js)
    this.machines = [];
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.openOffline = new Set(); // offline machines opened anyway (they start folded)
    this.machinesRead = false; // hc machine ls answered once: a machine missing from it is offline
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // Each of this computer's spaces on Autopilot (herdr-task's ~/.herdr/tasks/.autopilot.json): "on", or "waking"
    // while a wake runs or waits for its Assistant; its row shows a mark (row()). Read every 5 s.
    this.pilots = new Map();
    this.readPilots(cx);
    cx.timer.every(5000, (cx) => this.readPilots(cx));
    // Each machine's health and plan limits (machines.js): read every 45 s / 10 min, not per render.
    startPolling(cx);
    // spaces-chat.machine (a key, or `herdr-app do`): the details of the shown space's machine.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        // Beside the sidebar, near the top: no meter was pressed to put it under.
        if (c === "machine") openMachine(allSpaces().find((s) => s.active)?.machine ?? null, { x: 250, y: 40, width: 320, height: 0 });
        // spaces-chat.machine-limits: Settings > Machines, as the details' last row opens it.
        if (c === "machine-limits") openMachineSettings();
        // The Deleted section toast's click (sections.js deleteSection).
        if (c === "undo-section") restoreSection();
        cx.notify();
      }
    });
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  readPilots(cx) {
    cx.spawn(async (cx) => {
      let d = null;
      try { d = JSON.parse((await readTextFile(`${home()}/.herdr/tasks/.autopilot.json`)) ?? "{}"); } catch { return; }
      const next = new Map(Object.entries(d?.spaces ?? {}).filter(([, a]) => a?.on).map(([id, a]) => [id, a.inflight || a.pending ? "waking" : "on"]));
      if (JSON.stringify([...next]) === JSON.stringify([...this.pilots])) return;
      this.pilots = next;
      cx.notify();
    });
  }

  // A space's Autopilot mark after its name (SHEP-5): a small rocket, as its chat's wake lines have, dim while on, in
  // the working colour and breathing while a wake runs or waits. This computer's spaces only (another machine's file
  // is read where its header shows).
  pilotMark(w, t) {
    const p = w.machine ? null : this.pilots?.get(w.id);
    if (!p) return null;
    return div().id(`pilot-${w.id}`).flex_none().text_color(p === "waking" ? t.working : t.dim)
      .when(p === "waking", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1200 }))
      .child(svg("mods/spaces-chat/rocket.svg").size(12).flex_none());
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane] && keys.has(at[spaceOf[p.tab].id])) due.add(at[spaceOf[p.tab].id]);
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) { this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); this.machinesRead = true; }
      } catch {}
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: its branch and repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      // The repo's own .git folder names it; a worktree's top differs from it.
      const r = await exec("git", ["rev-parse", "--show-toplevel", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      const [top, repo] = r.stdout.split("\n").map((l) => l.trim());
      // its branch; none: detached
      const head = await exec("git", ["symbolic-ref", "--short", "-q", "HEAD"], { cwd, on });
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      this.git[key] = { name, branch: head.code === 0 ? head.stdout.trim() || null : null, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        let w = null;
        while (this.watching.has(repo)) {
          // At most 5 s per wait, so a reload's old build ends at its next cx use.
          w ??= watchFolder(repo).then(() => true);
          if (!(await Promise.race([w, cx.sleep(5000)]))) continue;
          w = null;
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  // The space's own menu (popups.js).
  menu(w, g, name, e) {
    openMenu("space", { space: w.id, name, machine: w.machine ?? null, git: g ? (g.linked ? "linked" : "main") : null, unread: this.unread.has(w.id),
      assistant: Boolean(coordinatorTab(w)), row: rectOf(e) });
  }

  // What a space is called: the name the person gave it, else after where it is now (`at`), as
  // Herdr names it but never "~": a home folder reads "Home", a repo its name, any other folder its
  // own (a space in /tmp/488b3d00 is "488b3d00", not its Assistant's "~"). A space named "~" (as
  // our New space and the tab bar once named home ones) counts as unnamed.
  nameOf(w, g, at) {
    if (!at) return w.name;
    return spaceName(w, { at, repo: g?.name ?? null, home: home(), named: Boolean(w.named) });
  }

  // The spaces shown, in Herdr's order, each with its git, where it is and its name: { w, i, g, at, name }.
  visible() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    return sp.filter((w) => this.shown.has(w.id)).map((w) => {
      const g = this.git[where(w, ps)] ?? null, at = place(w, ps);
      return { w, i: sp.indexOf(w), g, at, name: this.nameOf(w, g, at) };
    });
  }

  // `list` in order, each worktree space moved under its main checkout's when both are in it.
  // Shepherdr settings' "Worktrees in the sidebar" off (shared "sidebar.worktrees" false): those
  // nested worktree spaces aren't listed, except the one being looked at.
  ordered(list = this.visible()) {
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const hide = shared("sidebar.worktrees") === false;
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    list = list.filter((r) => !hide || !nested(r) || r.w.active);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    return out;
  }

  // The rows, under a header per machine once one isn't this computer.
  // Pinned spaces (sections.js) sit in Pinned at the top instead (not on the rail).
  grouped(t, collapsed) {
    const visible = this.visible();
    // Names two spaces on one machine share (a worktree under its repo aside: its branch shows).
    this.dup = sharedNames(visible.map((r) => ({ id: r.w.id, machine: r.w.machine, name: r.name, linked: Boolean(r.g?.linked) })));
    const pins = collapsed ? [] : data().pinned;
    const all = visible.filter((r) => !pins.includes(r.w.id));
    const rows = this.ordered(all);
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    // A machine's spaces: those in no section first, then its sections (the rail has none).
    const body = (m, mine) => (collapsed ? mine.map(draw) : this.sectioned(m, all.filter((r) => (r.w.machine ?? null) === m), t));
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).flex().items_center().text_size(TEXT.label).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    const pinned = this.pinned(visible, pins, Boolean(remote.length), t);
    if (!remote.length) return [...pinned, ...(loading(null) && !rows.length && !pinned.length ? [loadingRow(null)] : body(null, rows))];
    const machineNames = [null, ...remote];
    return [...pinned, ...machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const machine = this.machines.find(k => k.name === m);
      // Not known yet (hc hasn't answered): neither connected nor offline.
      const state = !m ? "connected" : machine?.state ?? (this.machinesRead ? "unreachable" : null);
      const connected = state === "connected";
      const offline = state !== null && !connected;
      // Offline, it starts folded; a click opens it for now.
      const folded = offline ? !this.openOffline.has(m) : this.folded.has(m);
      const health = this.stats?.[m ?? ""];
      // A space dropped on its machine's header leaves its section, for the top.
      const out = this.pressed && (sectionOf(this.pressed) || data().pinned.includes(this.pressed)) && this.over === `top:${m}`;
      // The machine's header: its group's title (12, medium, the text color), above its sections
      // and spaces. Connected: its + (New space, New section) and its meter; a red dot only when its
      // health couldn't be read. Offline: the word, dimmed, nothing else.
      const head = h_flex().relative().id(`machine-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 2 : 8).gap(7).items_center()
        .rounded(RADIUS.card).text_size(TEXT.label).font_medium().text_color(offline ? t.dim : t.foreground)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (offline) this.openOffline.has(m) ? this.openOffline.delete(m) : this.openOffline.add(m);
          else {
            folded ? this.folded.delete(m) : this.folded.add(m);
            localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          }
          cx.notify();
        })
        .on_mouse_move((_e, cx) => this.drag(`top:${m}`, m, cx))
        .on_mouse_down("right", (e) => openMenu("machine", { machine: m, row: rectOf(e) }))
        .when(out, el => el.child(this.line(t, "bottom")))
        // Its emoji, or the server / monitor; and the name it was given (Rename), else its own.
        .child(machineLook(m).icon
          ? div().w(14).flex_none().flex().justify_center().text_size(12).when(offline, el => el.opacity(0.5)).child(machineLook(m).icon)
          : svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(14).flex_none().text_color(offline ? t.dim : t.muted))
        .when(!collapsed, el => el.child(div().flex_1().min_w(0).truncate().child(machineLook(m).name))
          .when(offline, el => el.child(div().flex_none().font_normal().child(state === "connecting" ? "Connecting\u2026" : "Offline")))
          // + (New space or New section, there) hugging its one meter. HERD-70.
          .when(connected, el => el.child(h_flex().flex_none().gap(2).items_center()
            .child(div().id(`machine-add-${m ?? "local"}`).size(20).flex_none().flex().items_center().justify_center().rounded(RADIUS.control)
              .text_color(t.muted).cursor_pointer().hover(s => s.bg(t.raised).text_color(t.foreground))
              .on_mouse_down("left", (e) => { this.addAt = rectOf(e); })
              .on_click((_e, cx) => { cx.stop_propagation(); this.addMenu(m); })
              .child(svg("mods/workspace-chrome/plus.svg").size(14)))
            .child(this.meter(m, t))))
          .when(connected && Boolean(health?.error), el => el.child(div().id(`machine-dot-${m ?? "local"}`).size(6).rounded(3).flex_none().bg(red())))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(12).flex_none().text_color(t.dim)));
      const own = !collapsed && sectionsOf(m).length;
      // An empty machine is just its header: its + makes a space.
      return [head, ...(folded ? [] : mine.length || own ? body(m, mine) : loading(m) ? [loadingRow(m)] : [])];
    })];
  }

  // A machine's health (CPU, memory, disk) as one set of thin bars, amber while new tasks wait
  // there, red past its alert limit. No % beside it (HERD-70): numbers and plan left are in
  // the details a click opens (machine-popup.js). HERD-40, HERD-62.
  // `this.stats`: read once per render (render()), as each read copies every machine's numbers.
  meter(m, t) {
    const s = this.stats?.[m ?? ""];
    const id = `machine-meter-${m ?? "local"}`;
    if (!s?.health) return div().id(id);
    const meters = healthMeters(s);
    return h_flex().id(id).flex_none().h(20).px(4).gap(4).items_center().rounded(RADIUS.control).cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .on_mouse_down("left", (e) => { this.meterAt = rectOf(e); })
      .on_click((_e, cx) => { cx.stop_propagation(); openMachine(m, this.meterAt); })
      .child(bars(t, meters, 11, `${id}-health`));
  }

  // Pinned, as Shepherdr's: a heading like a section's (its pin, no menu), shown while it holds
  // any, then its spaces in their own order, each with its machine after its name once there
  // are several. Folded, it still shows the space you're in and its unread ones.
  pinned(list, pins, many, t) {
    const byId = new Map(list.map((r) => [r.w.id, r]));
    const members = pins.map((id) => byId.get(id)).filter(Boolean);
    if (!members.length) return [];
    const open = !data().pinnedFolded || (this.pressed !== null && this.peek === "pinned");
    const needs = open ? 0 : members.reduce((n, r) => n + this.needs(r.w), 0);
    const ready = open ? 0 : members.reduce((n, r) => n + this.readyIn(r.w), 0);
    const head = this.groupHead("section-pinned", t)
      .on_click(() => foldPinned())
      .on_mouse_move((_e, cx) => this.drag("pinned", ANY, cx))
      .child(div().w(18).flex_none().flex().justify_center().child(svg("mods/workspace-chrome/pin.svg").size(14)))
      .child(div().flex_1().min_w(0).truncate().child("Pinned"))
      .when(needs > 0 || ready > 0, (el) => el.child(countBadge(needs, ready, t.chrome)))
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none())
      .when(this.pressed !== null && this.over === "pinned" && !open, (el) => el.child(this.line(t, "bottom")));
    const shown = open ? members : members.filter((r) => r.w.active || this.unread.has(r.w.id));
    return [head, ...shown.map((r, n) => this.row({ ...r, tree: null, pinned: true, tag: many ? machineLook(r.w.machine ?? null).name : null,
      end: open && n === shown.length - 1 ? "pinned" : null }, t))];
  }

  // The + menu under its button: its right edge at the button's.
  addMenu(m) {
    const r = this.addAt;
    openMenu("add", { machine: m }, r ? { x: Math.max(8, r.x + r.width - 210), y: r.y + r.height + 4 } : "pointer");
  }

  // One machine's rows (`list`: its shown spaces, in Herdr's order): the spaces in no
  // section, then each section's header and, unless folded, its spaces in its order.
  sectioned(m, list, t) {
    const sections = sectionsOf(m);
    const byId = new Map(list.map((r) => [r.w.id, r]));
    const filed = new Set(sections.flatMap((s) => s.spaces));
    const out = this.ordered(list.filter((r) => !filed.has(r.w.id))).map((r) => this.row(r, t));
    for (const s of sections) {
      const members = s.spaces.map((id) => byId.get(id)).filter(Boolean);
      const open = !s.folded || (this.pressed !== null && this.peek === s.id);
      out.push(this.sectionHead(s, members, t, open));
      // Folded, it still shows the space you're in and its unread ones, as Slack does.
      const shown = this.ordered(open ? members : members.filter((r) => r.w.active || this.unread.has(r.w.id)));
      // Dropped on the header, a space goes to the section's end: the line shows under its last row.
      shown.forEach((r, n) => out.push(this.row({ ...r, end: open && n === shown.length - 1 ? `section:${s.id}` : null }, t)));
      if (open && !members.length) out.push(this.emptySection(s, t));
    }
    return out;
  }

  sectionHead(s, members, t, open) {
    const needs = open ? 0 : members.reduce((n, r) => n + this.needs(r.w), 0);
    const ready = open ? 0 : members.reduce((n, r) => n + this.readyIn(r.w), 0);
    // Over it, the line shows where the space lands: under the section's last row ("Drag spaces
    // here" when empty), or under the header while it's folded.
    const line = this.pressed !== null && this.over === `section:${s.id}` && !open;
    return this.groupHead(`section-${s.id}`, t)
      .on_click(() => foldSection(s.id))
      .on_mouse_down("right", (e) => openMenu("section", { section: s.id, row: rectOf(e) }))
      .on_mouse_move((_e, cx) => this.drag(`section:${s.id}`, s.machine, cx))
      // Its icon in the spaces' "#" column: the folder, or the emoji picked for it.
      .child(div().w(18).flex_none().flex().justify_center()
        .child(s.icon ? div().text_size(13).child(s.icon) : svg("mods/workspace-chrome/folder.svg").size(14)))
      .child(div().flex_1().min_w(0).truncate().child(s.name))
      .when(needs > 0 || ready > 0, (el) => el.child(countBadge(needs, ready, t.chrome)))
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none())
      .when(line, (el) => el.child(this.line(t, "bottom")));
  }

  // A section's or Pinned's heading, inside its machine: its icon in the spaces' "#" column and its
  // name where theirs start (so it reads as one of the machine's), 12, medium, dim.
  groupHead(id, t) {
    return h_flex().relative().id(id).h(28).flex_none().px(8).gap(9).items_center().rounded(RADIUS.card)
      .text_size(TEXT.label).font_medium().text_color(t.dim).cursor_pointer().hover((st) => st.bg(t.hover));
  }

  emptySection(s, t) {
    return h_flex().relative().id(`section-empty-${s.id}`).h(28).flex_none().px(8).gap(9).items_center().text_size(TEXT.label).text_color(t.dim)
      .on_mouse_move((_e, cx) => this.drag(`section:${s.id}`, s.machine, cx))
      .child(div().w(18).flex_none())
      .child("Drag spaces here")
      .when(this.pressed && this.over === `section:${s.id}`, (el) => el.child(this.line(t, "top")));
  }

  // Where a dragged space would land.
  line(t, edge) {
    return div().absolute().left(0).right(0).h(2).bg(t.accent).when(edge === "top", (l) => l.top(0)).when(edge === "bottom", (l) => l.bottom(0));
  }

  // The pointer, with a space pressed, over a place for it: on its own machine only, but
  // Pinned (machine ANY) takes any machine's.
  drag(over, machine, cx) {
    if (this.pressed === null) return;
    const from = spaces().find((s) => s.id === this.pressed);
    const next = from && (machine === ANY || (from.machine ?? null) === (machine ?? null)) ? over : null;
    // Over a folded section's header, it opens until the drop; over another section, that one does.
    const sec = next === "pinned" ? "pinned" : next?.startsWith("section:") ? next.slice(8) : null;
    const shut = sec === "pinned" ? data().pinnedFolded : sectionsOf(machine).find((s) => s.id === sec)?.folded;
    const peek = sec && shut ? sec : sec ? null : this.peek;
    if (this.over !== next || this.peek !== peek) {
      this.over = next;
      this.peek = peek;
      cx.notify();
    }
  }

  // Released: a press without a move selects the space; else it goes where the line shows.
  release(cx) {
    const from = this.pressed, over = this.over;
    this.pressed = null;
    this.over = null;
    this.peek = null;
    if (from !== null && over === `space:${from}`) run("space.select", { id: from });
    else if (from !== null && over) this.drop(from, over);
    cx.notify();
  }

  // Which edge of a space's row a dragged one lands on: below it when coming from above it
  // in the same list, else above it.
  edge(from, to) {
    const pins = data().pinned;
    if (pins.includes(to)) {
      const a = pins.indexOf(from);
      return a >= 0 && a < pins.indexOf(to) ? "bottom" : "top";
    }
    const sec = sectionOf(to);
    if (sec) {
      const a = sec.spaces.indexOf(from);
      return a >= 0 && a < sec.spaces.indexOf(to) ? "bottom" : "top";
    }
    // At the top, Herdr's order decides (space.move).
    const sp = spaces();
    return sp.findIndex((s) => s.id === from) < sp.findIndex((s) => s.id === to) ? "bottom" : "top";
  }

  // Into Pinned (its heading, among its spaces), or out of it to anywhere else.
  drop(from, over) {
    if (over === "pinned") return pin(from);
    const cut = over.indexOf(":");
    const kind = over.slice(0, cut), id = over.slice(cut + 1);
    const pins = data().pinned;
    if (kind === "space" && pins.includes(id)) {
      if (id === from) return;
      const at = pins.filter((x) => x !== from).indexOf(id);
      return pin(from, true, this.edge(from, id) === "bottom" ? at + 1 : at);
    }
    if (pins.includes(from)) pin(from, false);
    if (kind === "section") placeSpace(from, id);
    else if (kind === "top") placeSpace(from, null);
    else if (kind === "space" && id !== from) {
      const sec = sectionOf(id);
      if (sec) {
        const at = sec.spaces.filter((x) => x !== from).indexOf(id);
        placeSpace(from, sec.id, this.edge(from, id) === "bottom" ? at + 1 : at);
      } else {
        if (sectionOf(from)) placeSpace(from, null);
        // space.move takes the target's place, counted from 1: the rest shift toward where it was.
        const i = spaces().findIndex((s) => s.id === id);
        if (i >= 0) run("space.move", { id: from, index: i + 1 });
      }
    }
  }

  // What needs the person in a space, for its red count, and its tasks in Ready, for its green
  // count (none while Shepherdr settings' "Red counts" / "Green counts" is off: shared
  // "counts.red" / "counts.green" false).
  needs(w) {
    if (shared("counts.red") === false) return 0;
    const m = countsByTab();
    return w.tabs.reduce((n, tab) => n + (m.get(tab.id) ?? 0), 0);
  }

  readyIn(w) {
    if (shared("counts.green") === false) return 0;
    const m = readyByTab();
    return w.tabs.reduce((n, tab) => n + (m.get(tab.id) ?? 0), 0);
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  gitTail(g, tree, name, t, tag) {
    // the words are the shared core's (the web's row says the same)
    const { where } = gitTail(g, { name, tree: Boolean(tree), tag });
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(TEXT.label)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)));
  }

  // `pinned`: in Pinned, `tag` its machine there; `end`: the drag key (a section's, Pinned) a
  // drop under this last row goes to.
  row({ w, i, g, tree, end, pinned, tag, at, name }, t) {
    const on = w.active;
    // Another space here has its name: its folder, dim, says which.
    const label = [tag, this.dup?.has(w.id) && at ? tilde(at) : null].filter(Boolean).join(" \u00b7 ") || null;
    const fresh = this.unread.has(w.id);
    // Notify Off (notify.js): muted, as Slack's muted channels: dimmed, a crossed-out bell; its
    // counts still show.
    const quiet = muted(w.id);
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(RADIUS.card)
      .cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === w.id && this.over !== `space:${w.id}`, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.pressed !== w.id && this.over === `space:${w.id}`, (el) => el.child(this.line(t, this.edge(this.pressed, w.id))))
      .when(this.pressed !== null && end && this.over === end, (el) => el.child(this.line(t, "bottom")))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = `space:${w.id}`;
      })
      .on_mouse_move((_e, cx) => this.drag(`space:${w.id}`, pinned ? ANY : w.machine, cx))
      .on_mouse_down("right", (e) => this.menu(w, g, name, e))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim)))
          // Slack's channels: a quiet # and the name, bright when it's the shown space.
          // Or the emoji picked for it (Change icon), in the same slot so names stay aligned.
          .when(!tree, el => el.child(div().w(18).flex_none().text_center().text_size(iconOf(w.id) ? 14 : 15).text_color(fresh ? t.foreground : w.active && !quiet ? t.muted : t.dim)
            .when(quiet && Boolean(iconOf(w.id)), (el) => el.opacity(0.5)).child(iconOf(w.id) ?? "#")))
          .child(nameText(name, fresh, quiet ? t.dim : w.active ? t.foreground : t.muted, t))
          .when(Boolean(this.pilotMark(w, t)), (el) => el.child(this.pilotMark(w, t)))
          .child(g ? this.gitTail(g, tree, name, t, label) : h_flex().flex_1().min_w(0).justify_end().text_size(TEXT.label).text_color(t.dim)
            .when(Boolean(label), (el) => el.child(div().min_w(0).truncate().child(label))))
          .when(quiet, (el) => el.child(svg("mods/spaces-chat/bell-off.svg").size(13).flex_none().text_color(t.dim)))
          // What needs the person in this space (the Inbox's items in its tabs), red, and its
          // tasks in Ready, green.
          .when(this.needs(w) > 0 || this.readyIn(w) > 0, el => el.child(countBadge(this.needs(w), this.readyIn(w), on ? t.selected : t.chrome))),
      );
  }

  compact({ w, i }, t) {
    return h_flex()
      .id(`space-${w.id}`)
      .h(26)
      .flex_none()
      .justify_center()
      .gap(4)
      .rounded(RADIUS.card)
      .cursor_pointer()
      .when(w.active, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(nameText(String(i + 1), this.unread.has(w.id), muted(w.id) ? t.dim : w.active ? t.foreground : t.muted, t))
      .child(div().text_color(tone(t, w.status)).child(glyph(w.status)));
  }

  close() { this.popup?.close?.(); }

  // One copy of Herdr's live lists for the whole render (live.js): past ~50 ms Herdr stops it.
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw(cx) {
    if (this.popup) return this.popup.render(cx);
    const t = theme();
    const collapsed = narrow();
    this.stats = collapsed ? null : allStats();
    prune();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    // Assistants with something new; any on screen is read now.
    readShown();
    // Shepherdr settings' "Bold unread spaces" off (shared "sidebar.unread" false): none.
    this.unread = shared("sidebar.unread") === false ? new Set() : unreadSpaces(sp);
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(TEXT.label).font_medium().text_color(t.dim)
        .when(!collapsed, el => el.child("Spaces"))
        // As a machine's +: New space, New section, on the shown space's machine.
        .child(div().id("space-new").size(H.sm).flex_none().flex().items_center().justify_center().rounded(RADIUS.control).cursor_pointer()
          .hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (e) => { this.addAt = rectOf(e); })
          .on_click(() => this.addMenu(sp.find(s => s.active)?.machine ?? null))
          .child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => this.release(cx))
        .children(this.grouped(t, collapsed)));
  }
}
