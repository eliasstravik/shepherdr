// Jump (Ctrl+K, as Shepherdr's ⌘K): one box that finds a space, a task, an artifact or a machine and
// goes there. Opened with mod.open:jump (again closes it), a popup at the top of the window.
// Type to filter: every word typed must be in the item somewhere, any case (Shepherdr's
// matches()). Tasks by id, title, status line, summary and where they ran, Done and archived
// ones too (archived only once something is typed); artifacts by title, the task that made them
// and their folder; spaces by name, folder and machine. Each group newest first, so with nothing
// typed the latest work is on top. ↑/↓ and Enter, or a click, go:
//   space     space.select
//   machine   its first space
//   task      its worker's chat inside the Tasks panel (chat/panel.js's drill-in); a task with no
//             live worker (to do, queued, done, archived): the Tasks list, searched for it. A
//             layout without the Tasks panel switches to ours that has it (TASKS_LAYOUT) first.
//   artifact  the viewer over the focused pane when it's a chat (or the task's chat in the Tasks
//             panel, when the keyboard was there), as a card there opens it (artview.js); else
//             (a terminal, or its place not known yet) the Artifacts sidebar, else the whole window
// Ctrl+Shift+K opens this too: it's the one switcher.
// Tasks and artifacts are read from every machine's ~/.herdr/tasks and ~/.herdr/artifacts once
// as it opens, as the Tasks and Artifacts panels read them.

import { div, svg } from "gpui-kit";
import { View } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, VirtualListScrollHandle, v_virtual_list, Scrollbar } from "gpui-base";
import { machines, layout, layouts, exec, home, run, theme, props, closeOverlay, shared, setShared } from "herdr";
import { spaces, terminals, agents, inRender } from "./live.js";
import { taskDot } from "./dot.js";
import { READ_LISTS, taskLists } from "./core/tasklists.js";
import { busyAgain, onIt } from "./core/tasks.js";
// A space's name as the sidebar (and the web app) says it: never "~" (core/spaces.js).
import { spaceName } from "./core/spaces.js";
import { openViewer, showViewer, chatArea } from "./artview.js";
import { showInSidebar, hasSidebarView } from "./artifact-sidebar.js";
import { TEXT, RADIUS } from "./ui.js";

// Our layout with the Tasks panel, for a task picked where the shown one has none.
const TASKS_LAYOUT = "shepherdr";

const KINDS = ["space", "task", "artifact", "machine"];
const GROUP = { space: "Spaces", task: "Tasks", artifact: "Artifacts", machine: "Machines" };
const SHOWN = 8; // rows a group shows before "Show N more"
const ROW = 48, HEAD = 30, MORE = 32;
// A popup is as tall as what it holds: the list gets its own height, up to this.
const LIST_MAX = 420;
// Task ids in a monospace column (JetBrains Mono: 0.6 em a character), so titles line up.
const ID_FONT = "JetBrains Mono", ID_SIZE = TEXT.id, ID_CHAR = ID_SIZE * 0.6;
const STATUS = { needs: "Needs you", working: "Working", merging: "Merging", ready: "Ready", queued: "Queued", scheduled: "Scheduled", todo: "To do", done: "Done" };

// The Tasks panel's reads (tasklists.js: READ_LISTS, taskLists); every artifact registry the
// same way.
const READ_ARTS = 'cd "$HOME/.herdr/artifacts" 2>/dev/null || exit 0; for f in *.json .*.json; do [ -f "$f" ] && cat "$f" && printf "\\n\\036\\n"; done; true';
// Each folder's git repo (its common .git folder), a line each: "<folder>\t<common dir>", for a space's name.
const READ_REPOS = 'for f in "$@"; do r=$(git -C "$f" rev-parse --path-format=absolute --git-common-dir 2>/dev/null); printf "%s\\t%s\\n" "$f" "$r"; done; true';
// The repo's name from its common .git folder (as the service's model.ts and the sidebar name it).
const repoName = (common) => (common ? (common.endsWith("/.git") ? common.slice(0, -5) : common.replace(/\.git$/, "")).split("/").filter(Boolean).pop() ?? null : null);

// herdr-task's auto_prefix, for a list from before prefixes (as mods/tasks/main.js).
function autoPrefix(folder) {
  const name = String(folder ?? "").split("/").filter(Boolean).pop() ?? "";
  const ws = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z]+/).filter(Boolean);
  let p = ws.length > 1 ? ws.map((w) => w[0]).join("").slice(0, 5) : (ws[0] ?? "").slice(0, 4);
  if (p.length < 2) p = ws.join("").length >= 2 ? ws.join("").slice(0, 2) : "TASK";
  return p.toUpperCase();
}

// Every word typed is in one of these, any case.
function matches(q, ...fields) {
  const all = fields.filter((f) => f !== undefined && f !== null && f !== "").join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => all.includes(w));
}

const machineOf = (address) => (address?.includes("/") ? address.split("/")[0] : null);
const machineName = (m) => m ?? "This computer";
const tilde = (p) => { const h = home(); return h && p && (p === h || p.startsWith(h + "/")) ? `~${p.slice(h.length)}` : p; };
const capital = (s) => (s && /^[a-z](?![A-Z])/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);

// "now", "5m ago", "3h ago", "2d ago", else the date.
function ago(at) {
  if (!at) return null;
  const m = Math.floor((Date.now() - at) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  if (m < 10080) return `${Math.floor(m / 1440)}d ago`;
  return new Date(at).toLocaleDateString();
}

const find = (node, id) => {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const hit = find(c, id); if (hit) return hit; }
  return null;
};

// A task's worker chat inside the Tasks panel (mods/chat/panel.js openTaskThread).
function openTaskThread(terminal, task, title) {
  setShared("tasks.thread", { terminal, task: task ?? null, title: title ?? null, at: Date.now() });
  run("layout.select", { stack: "panel-body", child: "tasks" });
  run("layout.select", { stack: "tasks", child: "tasks-thread" });
  if (find(layout(), "tasks-thread-body")) run("layout.select", { stack: "tasks-thread-body", child: "tasks-thread-chat" });
  run("layout.show", { id: "panel" });
}

// The Tasks list, searched for one task (mods/tasks/main.js reads shared "tasks.searchreq").
function showInTaskList(q) {
  setShared("tasks.searchreq", { q, at: Date.now() });
  run("layout.select", { stack: "panel-body", child: "tasks" });
  run("layout.select", { stack: "tasks", child: "tasks-list" });
  run("layout.show", { id: "panel" });
}

export default class Jump extends View {
  init(_props, cx) {
    this.openedAt = Date.now(); // a chat's box letting go of the keyboard about now had it (chatArea())
    this.lists = new Map(); // "" (this computer) or a machine -> its task lists
    this.arts = new Map();  // the same -> its artifacts, each with { machine, folder }
    this.repos = new Map(); // "<machine>|<folder>" -> its git repo's name (null: not a repo)
    this.loading = new Set();
    this.more = new Set();  // groups showing every row
    this.sel = null;        // the selected row's key
    this.input = InputState.new({ placeholder: "Search spaces, tasks, artifacts" });
    this.input.on("change", (_e, cx) => { this.sel = null; this.more.clear(); this.scroll.scroll_to_item(0, "top"); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(this.current, cx));
    this.scroll = VirtualListScrollHandle.new();
    this.input.focus();
    cx.timer.after(0, () => this.input.focus());
    cx.timer.after(600, () => this.input.focus());
    for (const m of [null, ...machines().filter((x) => x.name && x.layout !== "unavailable").map((x) => x.name)]) {
      cx.spawn(async (cx) => this.read(cx, m));
    }
  }

  close() { this.input.release(); this.scroll.release(); }

  // One machine's task lists and artifacts (null: this computer's).
  async read(cx, machine) {
    const k = machine ?? "", on = machine ? { on: machine } : {};
    this.loading.add(k);
    try {
      const folders = [...new Set(spaces().filter((s) => (s.machine ?? null) === machine && s.folder).map((s) => s.folder))];
      const [lists, arts, repos] = await Promise.all([exec("sh", ["-c", READ_LISTS], on), exec("sh", ["-c", READ_ARTS], on),
        folders.length ? exec("sh", ["-c", READ_REPOS, "repos", ...folders], on).catch(() => null) : null]);
      for (const line of (repos?.stdout ?? "").split("\n")) {
        const [f, common] = line.split("\t");
        if (f) this.repos.set(`${k}|${f}`, repoName(common));
      }
      this.lists.set(k, taskLists(lists.stdout)
        .map((d) => ({ ...d, machine, prefix: d.prefix || autoPrefix(d.folder), tasks: Array.isArray(d.tasks) ? d.tasks : [] })));
      const found = [];
      for (const part of arts.stdout.split("\x1e")) {
        try { const reg = JSON.parse(part); for (const a of reg.artifacts ?? []) found.push({ ...a, machine, regFolder: reg.folder, regName: reg.name }); } catch {}
      }
      this.arts.set(k, found);
    } catch {
      // A machine out of reach: its items just aren't listed.
    }
    this.loading.delete(k);
    cx.notify();
  }

  // What a space is called, as the sidebar says it: its own name, else its repo's or its folder's, "Home" at home.
  nameOf(s) {
    const repo = this.repos.get(`${s.machine ?? ""}|${s.folder}`) ?? null;
    return spaceName(s, { repo, home: s.machine ? null : home(), named: Boolean(s.named) });
  }

  // The space working in a folder on a machine, by name.
  spaceAt(machine, folder) {
    return spaces().find((s) => (s.machine ?? null) === (machine ?? null) && s.folder === folder) ?? null;
  }

  // A task's live agents: terminals labelled with its key on its folder's machine.
  live(list, task) {
    const key = `${list.slug}#${task.id}`, m = list.machine ?? null;
    const shown = new Map(agents().map((a) => [a.address, a]));
    return terminals().filter((k) => k.state === "live" && k.labels?.["herdr.task"] === key && machineOf(k.address) === m)
      .filter((k) => k.program?.key !== "shell" && !k.program?.shell)
      .map((k) => ({ address: k.address, status: shown.get(k.address)?.status ?? k.status, turn: k.turn, role: k.labels?.["herdr.role"] ?? "worker" }));
  }

  // A task's status as the Tasks panel names it, in short (its full rules: tasks/main.js place()).
  status(task, live) {
    const st = task.state;
    if (["todo", "queued", "scheduled", "done"].includes(st)) return st;
    // A problem (failing checks) its agent is on (core/tasks.js onIt()): Working; nobody on it: Needs you.
    const fixing = task.attention && onIt(task, live);
    if ((task.attention && !fixing) || live.some((a) => a.status === "blocked")) return "needs";
    if (fixing) return "working";
    // Back at work after it said ready (core/tasks.js busyAgain()): Working.
    if (st === "ready" && !busyAgain(task, live)) return task.merge_requested && live.length ? "merging" : "ready";
    if (live.some((a) => a.status === "working")) return "working";
    const last = task.agents?.[task.agents.length - 1];
    const started = Math.max(0, ...[task.started, last?.at].filter((x) => typeof x === "number"));
    if (!last?.ended && Date.now() - started < 90000) return "working";
    return "needs";
  }

  items(q) {
    const out = [];
    const icons = shared("spaces-chat")?.icons ?? {};
    const remote = machines().some((m) => m.name);
    for (const s of spaces()) {
      const where = [remote ? machineName(s.machine) : null, tilde(s.folder) || "~"].filter(Boolean).join(" · ");
      const name = this.nameOf(s);
      if (q && !matches(q, name, s.folder, tilde(s.folder), machineName(s.machine))) continue;
      const at = Math.max(0, ...s.tabs.map((t) => t.changed_at ?? 0));
      out.push({ kind: "space", key: `s:${s.id}`, id: s.id, icon: icons[s.id] ?? "#", label: name, sub: where, at, active: s.active, status: s.status });
    }
    for (const [, lists] of this.lists) for (const list of lists) for (const task of list.tasks) {
      if (task.archived && !q) continue;
      const ref = `${list.prefix}-${task.id}`;
      const space = this.spaceAt(list.machine, list.folder);
      const place = [space ? this.nameOf(space) : list.name, remote ? machineName(list.machine) : null].filter(Boolean).join(" · ");
      const live = task.state === "running" || task.state === "ready" ? this.live(list, task) : [];
      const status = this.status(task, live);
      const line = status === "working" ? task.progress?.text : status === "needs" ? task.waits ?? task.attention : task.summary;
      if (q && !matches(q, ref, task.title, task.progress?.text, task.summary, task.waits, task.attention, space ? this.nameOf(space) : null, list.name, machineName(list.machine))) continue;
      const at = Math.max(0, ...[task.archived, task.done_at, task.ready_at, task.progress?.at, task.started, task.created].filter((x) => typeof x === "number"));
      out.push({ kind: "task", key: `t:${list.machine ?? ""}:${list.slug}#${task.id}`, ref, label: task.title, live, status, pct: task.progress?.done,
        sub: [task.archived ? "Archived" : STATUS[status], line && capital(String(line).split("\n")[0]), place].filter(Boolean).join(" · "), at });
    }
    for (const [, arts] of this.arts) for (const a of arts) {
      const space = this.spaceAt(a.machine, a.folder ?? a.regFolder);
      const place = space ? this.nameOf(space) : a.regName ?? tilde(a.folder);
      if (q && !matches(q, a.title, a.id, a.task, place, tilde(a.folder), remote ? machineName(a.machine) : null)) continue;
      out.push({ kind: "artifact", key: `a:${a.machine ?? ""}:${a.id}`, art: a, label: a.title || a.id,
        sub: [a.task, place, remote ? machineName(a.machine) : null, `v${a.version ?? 1}`, ago(a.at)].filter(Boolean).join(" · "), at: a.at ?? 0 });
    }
    if (remote) for (const m of machines()) {
      const n = spaces().filter((s) => (s.machine ?? null) === (m.name ?? null)).length;
      if (q && !matches(q, machineName(m.name))) continue;
      out.push({ kind: "machine", key: `m:${m.name ?? ""}`, name: m.name, label: machineName(m.name),
        sub: [`${n} space${n === 1 ? "" : "s"}`, m.layout === "unavailable" ? "Offline" : null].filter(Boolean).join(" · "), at: 0 });
    }
    // Newest first in each group; spaces with no news keep the sidebar's order (a stable sort).
    return out.sort((a, b) => b.at - a.at);
  }

  // The list as drawn: each non-empty group's heading, its rows, and "Show N more".
  rows(q) {
    const all = this.items(q);
    const rows = [];
    for (const kind of KINDS) {
      const mine = all.filter((x) => x.kind === kind);
      if (!mine.length) continue;
      rows.push({ kind: "head", key: `h:${kind}`, label: GROUP[kind], count: mine.length });
      const shown = this.more.has(kind) ? mine : mine.slice(0, SHOWN);
      rows.push(...shown);
      if (mine.length > shown.length) rows.push({ kind: "more", key: `more:${kind}`, group: kind, count: mine.length - shown.length });
    }
    return rows;
  }

  go(r, cx) {
    if (!r) return;
    if (r.kind === "more") {
      this.more.add(r.group);
      this.sel = null;
      cx?.notify();
      return;
    }
    closeOverlay(props().overlay);
    if (r.kind === "space") run("space.select", { id: r.id });
    else if (r.kind === "machine") {
      const s = spaces().find((x) => (x.machine ?? null) === (r.name ?? null));
      if (s) run("space.select", { id: s.id });
      else run("app.settings", { section: "machines" });
    } else if (r.kind === "task") this.openTask(r);
    else if (r.kind === "artifact") this.openArtifact(r.art);
  }

  // Its worker's chat in the Tasks panel (a worker asking first); else the Tasks list, searched
  // for it. Where the shown layout has no Tasks panel, ours that has one shows first.
  openTask(r) {
    if (!find(layout(), "tasks-list") && layouts().includes(TASKS_LAYOUT)) run("layout.switch", { name: TASKS_LAYOUT });
    const workers = r.live.filter((a) => a.role !== "reviewer");
    const w = workers.find((a) => a.status === "blocked") ?? workers[0] ?? r.live[0];
    if (w) return openTaskThread(w.address, r.ref, r.label);
    showInTaskList(`${r.ref} ${r.label}`);
  }

  // Over the chat the keyboard was in, as its card opens it; else in the Artifacts sidebar.
  openArtifact(a) {
    const area = chatArea(this.openedAt);
    const show = area || !hasSidebarView() ? showViewer : (v) => showInSidebar(v) || showViewer(v);
    openViewer({ id: a.id, title: a.title, version: a.version, machine: a.machine ?? null }, area, show);
  }

  mark(r, t) {
    if (r.kind === "task") return taskDot(r.status, { pct: r.pct });
    if (r.kind === "artifact") return svg("mods/artifacts/artifacts.svg").size(14).flex_none().text_color(t.muted);
    if (r.kind === "machine") return svg("mods/workspace-chrome/server.svg").size(14).flex_none().text_color(t.muted);
    return div().w(14).flex_none().text_center().text_size(r.icon === "#" ? 15 : 13).text_color(t.muted).child(r.icon);
  }

  row(r, on, t) {
    if (r.kind === "head") {
      return h_flex().w_full().h(HEAD).px(14).pt(10).gap(6).items_center().text_size(TEXT.label).font_medium().text_color(t.dim)
        .child(r.label).child(div().text_color(t.dim).child(String(r.count)));
    }
    if (r.kind === "more") {
      return h_flex().w_full().h(MORE).px(6).child(
        h_flex().flex_1().h_full().px(8).items_center().rounded(RADIUS.card).text_size(TEXT.label).text_color(t.accent).cursor_pointer()
          .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
          .child(`Show ${r.count} more`));
    }
    return h_flex().w_full().h(ROW).px(6).child(
      h_flex().flex_1().min_w(0).h_full().px(8).gap(10).items_center().rounded(RADIUS.card).cursor_pointer()
        .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
        .child(this.mark(r, t))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().min_w(0).gap(8).items_center()
            .when(r.kind === "task", (el) => el.child(div().flex_none().w(this.idWidth).font_family(ID_FONT).text_size(ID_SIZE).text_color(t.dim).child(r.ref)))
            .child(div().flex_1().min_w(0).truncate().text_size(TEXT.body).text_color(t.foreground).when(Boolean(r.active), (d) => d.font_semibold()).child(r.label)))
          .when(Boolean(r.sub), (el) => el.child(div().min_w(0).truncate().text_size(TEXT.label).text_color(t.dim).child(r.sub)))));
  }

  // One copy of Herdr's live lists for the whole render (live.js): past ~50 ms Herdr stops it.
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw(cx) {
    const t = theme();
    const q = this.input.value().trim();
    const rows = this.rows(q);
    this.idWidth = Math.ceil(Math.max(0, ...rows.map((r) => r.ref?.length ?? 0)) * ID_CHAR) + 1;
    const pickable = rows.filter((r) => r.kind !== "head");
    const at = Math.max(0, pickable.findIndex((r) => r.key === this.sel));
    const cur = (this.current = pickable[at] ?? null);
    const move = (d, cx) => {
      if (!pickable.length) return;
      const next = pickable[Math.max(0, Math.min(pickable.length - 1, at + d))];
      this.sel = next.key;
      const i = rows.indexOf(next);
      // The group's heading stays in view over its first row.
      this.scroll.scroll_to_item(rows[i - 1]?.kind === "head" && d < 0 ? i - 1 : i);
      cx.notify();
    };
    const loading = this.loading.size > 0;
    const empty = !rows.length
      ? v_flex().h(120).items_center().justify_center().gap(4).text_size(13).text_color(t.dim)
        .child(loading ? "Reading tasks and artifacts…" : q ? "Nothing found. Try fewer words." : "Nothing here.")
      : null;
    const sizes = rows.map((r) => (r.kind === "head" ? HEAD : r.kind === "more" ? MORE : ROW));
    const listH = Math.min(LIST_MAX, sizes.reduce((a, b) => a + b, 0));
    return v_flex().id("jump").w_full().bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); return; }
        if (e.key === "down" || (e.key === "n" && e.modifiers.control)) move(1, cx);
        else if (e.key === "up" || (e.key === "p" && e.modifiers.control)) move(-1, cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().h(48).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/workspace-chrome/search.svg").size(15).flex_none().text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(14).text_color(t.foreground)))
      .child(empty ?? div().relative().h(listH + 8).py(4)
        .child(v_virtual_list("jump-list", rows.length, sizes,
          (i) => rows[i].key, (range) => rows.slice(range.start, range.end).map((r) => this.row(r, r === cur, t)))
          .track_scroll(this.scroll).size_full()
          // Rows take no handlers: the list says which one was pressed.
          .on_item_click((key, cx) => this.go(this.rows(this.input.value().trim()).find((r) => r.key === key && r.kind !== "head"), cx)))
        .child(Scrollbar.vertical("jump-list").absolute().inset_0()));
  }
}
