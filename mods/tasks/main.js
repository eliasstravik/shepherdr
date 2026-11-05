// Tasks: named pieces of work with a prompt, one list per folder (the repo root in git, worktrees
// included). Each folder's list is ~/.herdr/tasks/<slug>.json on the machine the folder is on,
// changed only through the herdr-task CLI (bin/herdr-task), which coordinators and agents use.
// This panel only shows them: it reads those files, and a click opens the task in this panel
// (drill in: its chat). A running task's agents carry the label herdr.task=<key>; its status is
// theirs, read live.
// Every list on every machine: this computer's, and each connected machine's (read now and then).
// Grouped by status (Needs you, Ready, Merging, Working, Queued, To do, Done, then Automations),
// space, machine, or machine then space (shared "tasks.groupby", from the header's ⋯:
// mods/tasks-menu; the machine ones only while more than one machine has tasks).
// "Needs you" lists everything that needs the person (inbox.js), here or not.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { machines, exec, readTextFile, watchFolder, appHome, home, run, theme, nextCommand, shared, setShared, openOverlay, layout } from "herdr";
import { spaces, panes, agents, terminals, inRender } from "./live.js";
// What needs the person, from every space and machine (lib/inbox.js, shared; the tab
// bar runs its engine): agents asking or waiting, task problems, failed automations, merges.
import { items as needs, ASKS, toAgent, reasonOf, reqReason, REASONS, fit } from "./inbox.js";
import { words } from "./core/asks.js";
import { taskDot, ownProgress } from "./dot.js";
import { taskMenu } from "./core/menus.js";
// The rules for a task's status, order and words: shared with the web app (core/tasks.js).
import { RANK, STATUS, RANK_OF, ORDER, GROUP_BY, groupBy, machineOf, machineName, refOf, taskKey, autoPrefix, place,
  queueReason, reportOf as report, secondLine, leftOf, order, matches, day, ago, capital, short, autoWhere, fromLine } from "./core/tasks.js";
import { READ_LISTS, taskLists } from "./core/tasklists.js";
import { TEXT, H, RADIUS, red, amber } from "./ui.js";

const CLI = () => `${appHome()}/mods/tasks/bin/herdr-task`;
const DONE_SHOWN = 5; // Done rows a group shows before "Show N more"
// Task ids in monospace, small and dim at the start of a row's second line (Herdr ships JetBrains Mono).
const ID_FONT = "JetBrains Mono", ID_SIZE = TEXT.id;
// Every list in ~/.herdr/tasks on a machine is read with READ_LISTS and kept by taskLists (one
// rule with herdr-task's: tasklists.js).
// Pinned tasks, as Pinned spaces (mods/spaces-chat): a view choice, never a change to the task.
// Shared "tasks.pinned" = ["<machine, empty here>:<folder>#<id>"] (shared.json: survives
// restarts); the task chat's header (mods/chat/panel.js) and a row's right-click menu
// (mods/tasks-menu) pin with the same keys.
const PINS = "tasks.pinned";
const pinnedKeys = () => { const v = shared(PINS); return Array.isArray(v) ? v : []; };

// The space a list's folder is (a space on its machine working there), and its place in the
// sidebar's order: the list goes by that space's name, else its folder's.
// spaces() is read once a render (render() fills this), not once a row.
let spaceAt = null;
function spaceOf(list) {
  if (!spaceAt) { spaceAt = new Map(); for (const [i, s] of spaces().entries()) { const k = `${s.machine ?? ""}:${s.folder}`; if (!spaceAt.has(k)) spaceAt.set(k, { name: s.name, at: i }); } }
  return spaceAt.get(`${list.machine ?? ""}:${list.folder}`) ?? { name: list.name, at: Infinity };
}
const placeName = (list) => spaceOf(list).name;

// herdr-task, here or (through its --on) on the machine that holds the folder. Resolves with its
// JSON output; rejects with its error.
async function cli(machine, [command, ...args], folder) {
  const r = await exec(CLI(), [...(machine ? ["--on", machine] : []), command, "--json", "--folder", folder, ...args]);
  let out = null;
  try { out = JSON.parse(r.stdout || "null"); } catch {}
  if (r.code !== 0 || !out || out.error) throw new Error(out?.error || r.stderr?.trim() || "herdr-task failed");
  return out;
}

export { GROUP_BY };

export default class Tasks extends View {
  init(_props, cx) {
    this.lists = [];       // [{ folder, name, kind, slug, prefix, machine, tasks }]: every machine's
    this.byMachine = new Map(); // "" (this computer) or a machine's name -> its lists, as read
    this.raw = new Map();       // the same -> what was read last, to skip unchanged reads
    this.reads = new Map();     // machines being read now -> whether to read again after (a change came meanwhile)
    this.ready = false;         // this computer's lists were read once
    this.error = null;          // why this computer's lists couldn't be read
    // Folded headings and groups showing all their Done rows, by group key: remembered.
    const saved = (k) => { try { const v = JSON.parse(localStorage.getItem(k) ?? "[]"); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); } };
    this.shutKeys = saved("shut");
    // The filter row's choice: "all" (grouped) or one status, flat.
    try { this.filter = localStorage.getItem("filter") ?? "all"; } catch { this.filter = "all"; }
    this.filterAt = shared("tasks.filterreq")?.at ?? 0;
    this.searchAt = shared("tasks.searchreq")?.at ?? 0;
    if (shared("tasks.menuopen")) setShared("tasks.menuopen", null); // left over if the app quit with More open
    this.allDone = saved("alldone");
    this.asks = new Map(); // an ask's id -> its words (asks.js), read from the hook's request
    this.reading = new Set();
    this.prefixes = new Map(); // another folder's list (not loaded here): "<machine> <slug>" -> its prefix (null: none found)
    // A toast asks for Needs you (shared "tasks.show"): only asks made from now on.
    this.shownAt = shared("tasks.show")?.at ?? 0;
    // The search field (Shepherdr's "Filter tasks"): filters as you type, Done and archived tasks
    // too. Esc clears it; F gets to it while the list holds the keyboard.
    this.query = InputState.new({ placeholder: "Filter tasks" });
    this.query.on("change", (_e, cx) => cx.notify());
    this.query.on("focus", (_e, cx) => { this.searching = true; cx.notify(); });
    this.query.on("blur", (_e, cx) => { this.searching = false; cx.notify(); });
    this.listFocus = cx.focus_handle();
    bindSearchKeys(cx, "tasks_search");
    // The Archived view (the "Archived" row at the bottom): this list's archived tasks instead.
    this.archivedOpen = false;
    // Keys: tasks.status, tasks.space, tasks.machine, tasks.machine-space group the list that way;
    // tasks.filter-<status>; tasks.search goes to the search field.
    // At most 5 s per wait (one pending nextCommand), so a reload's old build ends at its next
    // cx use instead of staying in memory.
    cx.spawn(async (cx) => {
      let cmd = null;
      for (;;) {
        cmd ??= nextCommand();
        const c = await Promise.race([cmd, cx.sleep(5000)]);
        if (c === undefined) continue;
        cmd = null;
        if (c === "search") this.query.focus();
        else if (GROUP_BY.includes(c) || c === "folder") setShared("tasks.groupby", groupBy(c));
        // tasks.filter-all, tasks.filter-needs, ...: the filter row's chip.
        else if (c.startsWith("filter-") && (c === "filter-all" || ORDER.includes(c.slice(7)))) {
          this.pickFilter(c.slice(7));
        }
        cx.notify();
      }
    });
    // This computer's lists, read again whenever ~/.herdr/tasks changes; every other machine's
    // (their files can't be watched) now and then.
    cx.spawn(async (cx) => this.load(cx, null));
    this.watch(cx);
    this.loadRemote(cx);
    cx.timer.every(10000, (cx) => this.loadRemote(cx));
    // Times like "4m" and "2h ago" move on by the minute.
    cx.timer.every(60000, (cx) => cx.notify());
  }

  // ~/.herdr/tasks here changes: read again. One watch for the panel's life.
  watch(cx) {
    if (this.watching) return;
    this.watching = true;
    cx.spawn(async (cx) => {
      try {
        let w = null;
        for (;;) {
          // At most 5 s per wait, as the commands above.
          w ??= watchFolder(`${home()}/.herdr/tasks`).then(() => true);
          if (!(await Promise.race([w, cx.sleep(5000)]))) continue;
          w = null;
          await this.load(cx, null);
        }
      } catch {}
      this.watching = false;
    });
  }

  // Every connected machine's lists (not one Herdr can't reach now: its last lists stay). A machine
  // no longer in machines() takes its lists with it.
  loadRemote(cx) {
    const ms = machines().map((m) => m.name).filter(Boolean);
    for (const m of [...this.byMachine.keys()]) if (m && !ms.includes(m)) { this.byMachine.delete(m); this.raw.delete(m); this.merge(); cx.notify(); }
    for (const m of machines()) if (m.name && m.layout !== "unavailable") cx.spawn(async (cx) => this.load(cx, m.name));
  }

  // One machine's lists (null: this computer's).
  async load(cx, machine = null) {
    const k = machine ?? "";
    if (this.reads.has(k)) { this.reads.set(k, true); return; }
    this.reads.set(k, false);
    let text;
    try { text = (await exec("sh", ["-c", READ_LISTS], { on: machine ?? undefined })).stdout; }
    catch (e) {
      // Another machine out of reach keeps its last lists, quietly.
      if (!machine) { this.error = `Couldn't read the task lists: ${e?.message ?? e}`; this.ready = true; cx.notify(); }
      return;
    } finally {
      const again = this.reads.get(k);
      this.reads.delete(k);
      if (again) cx.spawn(async (cx) => this.load(cx, machine));
    }
    if (!machine) { this.ready = true; this.error = null; }
    if (this.raw.get(k) === text) { cx.notify(); return; }
    this.raw.set(k, text);
    this.byMachine.set(k, taskLists(text)
      .map((d) => ({ ...d, machine, prefix: d.prefix || autoPrefix(d.folder), tasks: Array.isArray(d.tasks) ? d.tasks : [] })));
    this.merge();
    cx.notify();
  }

  // Every machine's lists as one: this computer's first, then the machines' in the sidebar's order.
  merge() {
    const order = [null, ...machines().map((m) => m.name).filter(Boolean)];
    this.lists = [...this.byMachine.entries()].sort(([a], [b]) => order.indexOf(a || null) - order.indexOf(b || null)).flatMap(([, ls]) => ls);
  }

  // A task's agents now: live terminals labelled with its key, on the folder's machine.
  live(list, task) {
    const key = `${list.slug}#${task.id}`;
    const m = list.machine ?? null;
    const f = this.frame ?? {};
    const shown = f.agents ??= new Map(agents().map((a) => [a.address, a]));
    return (f.terminals ??= terminals()).filter((k) => k.state === "live" && k.labels?.["herdr.task"] === key && machineOf(k.address) === m)
      .filter((k) => k.program?.key !== "shell" && !k.program?.shell)
      .map((k) => {
        // agents() knows when someone looked at a finished agent (done -> idle), as Herdr shows it.
        const a = shown.get(k.address);
        // No report yet: starting (counts as working).
        const st = a?.status ?? (RANK[k.status] ? k.status : null);
        const tab = k.labels?.["herdr.tab"];
        // Where it shows: its own pane, else the chat pane it's parked behind (mods/chat).
        const chat = k.labels?.["herdr.chat"];
        const pane = (f.panes ??= panes()).find((p) => p.terminal === k.address)?.pane ?? (chat ? (m ? `${m}/${chat}` : chat) : null);
        return { address: k.address, status: st, program: a?.program ?? k.program, tab: tab && m ? `${m}/${tab}` : tab, pane,
          role: k.labels?.["herdr.role"] ?? "worker", turn: k.turn };
      });
  }

  // A task's status (its section), why it needs the person, and its live agents: core/tasks.js's
  // place(), with what Herdr knows live (its agents now, whether its machine has loaded).
  place(list, task) {
    const st = task.state;
    const live = st === "running" || st === "ready" ? this.live(list, task) : [];
    const loaded = machines().find((m) => (m.name ?? null) === (list.machine ?? null))?.layout !== "loading";
    return place(list, task, { live, loaded });
  }

  // Why a queued task waits (core/tasks.js): the tasks it comes after, else the folder is full.
  queueReason(list, task) {
    return queueReason(list, task, list.tasks.filter((x) => x.state === "running" && this.live(list, x).length).length);
  }

  // Herdr cuts off a render that takes too long ("interrupted"): one render reads terminals(),
  // agents(), panes() and each space's coordinator tab once (this.frame, live.js), not once per row.
  render(cx) {
    this.frame = {};
    try { return inRender(() => this.draw(cx)); } finally { this.frame = null; }
  }

  draw(cx) {
    spaceAt = null;
    const t = theme();
    // A toast's "needs you" (inbox.js showInbox): Needs you opens.
    const show = shared("tasks.show");
    if (show?.at && show.at !== this.shownAt) { this.shownAt = show.at; this.fold("needs", false); }
    // A pick from the filter row's More (mods/tasks-menu).
    const fq = shared("tasks.filterreq");
    if (fq?.at && fq.at !== this.filterAt) { this.filterAt = fq.at; this.pickFilter(fq.key); }
    // Ctrl+K's jump (mods/jump) to a task with no chat to open: the list, searched for it, all statuses.
    const sq = shared("tasks.searchreq");
    if (sq?.at && sq.at !== this.searchAt) { this.searchAt = sq.at; this.pickFilter("all"); this.archivedOpen = false; this.query.set_value(String(sq.q ?? "")); }
    let placed = this.lists.flatMap((l) => l.tasks.map((task) => this.place(l, task)));
    // Archived tasks (herdr-task: Done ones archive themselves after a while) leave every list and
    // count: only the Archived view and a search show them, the latest archived first.
    const archived = placed.filter((p) => this.shelved(p)).sort((a, b) => (b.task.archived ?? 0) - (a.task.archived ?? 0));
    placed = placed.filter((p) => !archived.includes(p));
    this.prunePins(placed, cx);
    // Needs you: asks, stuck agents, problems, failed automations (a task ready to merge is in Ready).
    let inbox = needs();
    this.readAsks(inbox, cx);
    this.readPrefixes(inbox, cx);
    // What the search field holds: only what matches it shows, in its group, every Done one too.
    const q = this.query.value().trim();
    if (q) {
      placed = placed.filter((p) => this.found(p, q));
      inbox = inbox.filter((x) => this.needFound(x, q));
    }
    const found = q ? archived.filter((p) => this.found(p, q)) : archived;
    // Pinned (the person's pins, shared "tasks.pinned"): at the top of the grouped list, and in no
    // other group there, Needs you included (its item for a pinned task shows as that task's row).
    const pinSet = this.pins();
    const isPin = (p) => pinSet.has(taskKey(p.list, p.task));
    const pinned = placed.filter(isPin);
    const pinNamed = new Set(pinned.map((p) => `${p.list.machine ?? ""}:${p.list.folder}:${refOf(p.list, p.task)}`));
    const pinLive = new Set(pinned.flatMap((p) => p.live.map((a) => a.address)));
    const pinNeed = (x) => pinNamed.has(`${x.machine ?? ""}:${x.folder}:${x.ref}`) || Boolean(x.terminal && pinLive.has(x.terminal));
    // In the sidebar's order: each list as its space, a list no space works in after its machine's
    // spaces, by name.
    const lists = [...this.lists].sort((a, b) => spaceOf(a).at - spaceOf(b).at || this.lists.indexOf(a) - this.lists.indexOf(b));
    // Group by (the ⋯ menu): by machine only while more than one machine has tasks; Machine › Space
    // is then by space.
    const multi = new Set(this.lists.filter((l) => l.tasks.length || l.automations?.length).map((l) => l.machine ?? "")).size > 1;
    this.multi = multi;
    const chosen = groupBy(shared("tasks.groupby"));
    const by = multi || !chosen.startsWith("machine") ? chosen : chosen === "machine" ? "status" : "space";
    this.names = { machine: true, space: true };

    // Needs you: everything that needs the person (inbox.js), from every space and machine. A task
    // in it isn't shown again further down.
    const named = new Set(inbox.filter((x) => x.ref && x.folder).map((x) => `${x.machine ?? ""}:${x.folder}:${x.ref}`));
    const asking = new Set(inbox.filter((x) => x.terminal).map((x) => x.terminal));
    const inNeeds = (p) => named.has(`${p.list.machine ?? ""}:${p.list.folder}:${refOf(p.list, p.task)}`) || p.live.some((a) => asking.has(a.address));
    // A task Herdr saw go wrong that the list hasn't caught up with yet shows as itself.
    const extra = placed.filter((p) => p.section === "needs" && !inNeeds(p)).sort(order("needs"));
    placed = placed.filter((p) => p.section !== "needs" && !inNeeds(p));
    const sorted = (ps) => [...ps].sort((a, b) => RANK_OF[a.section] - RANK_OF[b.section] || order(a.section)(a, b));

    const needList = [...inbox.map((x) => ({ row: this.needRow(x, t), pin: pinNeed(x) })),
      ...extra.map((p) => ({ row: this.row(p, t), pin: isPin(p) }))].filter((n) => n.row);
    const needRows = needList.map((n) => n.row);
    // Each status's tasks, in its order (Done newest first), and the automations.
    const tasksOf = {};
    for (const s of ORDER.slice(1, -1)) tasksOf[s] = sorted(placed.filter((p) => p.section === s));
    const autos = lists.flatMap((l) => (l.automations ?? []).filter((a) => !q || matches(q, a.title, placeName(l), l.name, l.machine))
      .map((a) => [l, a]));
    // The filter row: All, then a chip for each status that holds something now.
    const count = (k) => (k === "needs" ? needRows.length : k === "automations" ? autos.length : tasksOf[k].length);
    // Shepherdr settings' "Status filters" off (shared "tasks.filters" false): no row, all shown.
    const filters = shared("tasks.filters") !== false;
    // A chip picked stays picked while searching, even with nothing matching (its list says so).
    const keep = filters && Boolean(q) && ORDER.includes(this.filter);
    const chips = ORDER.filter((k) => count(k) || (keep && k === this.filter));
    const filter = filters && chips.includes(this.filter) ? this.filter : "all";
    // What rows say of where they are: all of it in a flat list or by status; by machine, the
    // space; by space, nothing (the headings say it).
    this.names = filter !== "all" || by === "status" ? { machine: true, space: true }
      : by === "machine" ? { machine: false, space: true } : { machine: false, space: false };
    // Shepherdr settings' "Where on task rows" off (shared "tasks.place" false): rows say none.
    if (shared("tasks.place") === false) this.names = { machine: false, space: false };
    // A status's rows, made only when shown (by status, or its chip).
    const rowsOf = { needs: needRows, automations: autos.map(([l, a]) => this.autoRow(l, a, placed, t)) };
    const rowsFor = (s) => (rowsOf[s] ??= tasksOf[s].map((p) => this.row(p, t)));
    // Searching, every group shows whole and open (folded or not).
    const open = Boolean(q);
    const note = (text) => div().px(18).py(28).text_center().text_size(TEXT.label).text_color(t.dim).child(text);
    const body = [];
    if (this.archivedOpen) { this.names = { machine: true, space: true }; body.push(this.archivedView(found, q, t)); }
    else if (filter !== "all") {
      const rows = rowsFor(filter);
      const what = filter === "needs" ? "tasks that need you" : filter === "automations" ? "automations" : `${STATUS[filter]} tasks`;
      body.push(rows.length ? v_flex().flex_none().gap(1).children(rows) : note(`No ${what} match “${q}”.`));
    }
    else {
      // Pinned first, whatever the grouping, in status order; every one shows (Done ones too).
      if (pinned.length) body.push(this.group("pinned", "Pinned", sorted(pinned).map((p) => this.row(p, t)), t, { open }));
      const ownNeeds = needList.filter((n) => !n.pin).map((n) => n.row);
      if (ownNeeds.length) body.push(this.group("needs", STATUS.needs, ownNeeds, t, { open }));
      const rest = placed.filter((p) => !isPin(p));
      if (by === "status") {
        for (const s of ORDER.slice(1, -1)) {
          const ps = tasksOf[s].filter((p) => !isPin(p));
          // A group shows only when it holds something (To do too).
          if (!ps.length) continue;
          body.push(this.group(s, STATUS[s], ps.map((p) => this.row(p, t)), t, { open, done: s === "done" ? ps.length : 0 }));
        }
      } else {
        const before = body.length;
        // A space's group: its tasks in status order. By space across machines, the machine
        // quiet after its name (Shepherdr's note).
        const spaceGroup = (l, note) => {
          const ps = sorted(rest.filter((p) => p.list === l));
          return ps.length ? this.group(`folder:${l.machine ?? ""}:${l.folder}`, placeName(l), ps.map((p) => this.row(p, t)), t, { open, note, done: ps.filter((p) => p.section === "done").length }) : null;
        };
        const machinesOf = [...new Set(this.lists.map((l) => l.machine ?? null))];
        if (by === "space") body.push(...lists.map((l) => spaceGroup(l, multi ? machineName(l.machine) : null)).filter(Boolean));
        else for (const [i, mc] of machinesOf.entries()) {
          const ps = sorted(rest.filter((p) => (p.list.machine ?? null) === mc));
          if (!ps.length) continue;
          const key = `machine:${mc ?? ""}`;
          if (by === "machine") body.push(this.group(key, machineName(mc), ps.map((p) => this.row(p, t)), t, { open,
            done: ps.filter((p) => p.section === "done").length, machine: true, first: body.length === before }));
          else {
            body.push(this.group(key, machineName(mc), [], t, { open, machine: true, first: body.length === before, count: ps.length }));
            if (open || !this.shut(key)) body.push(...lists.filter((l) => (l.machine ?? null) === mc).map((l) => spaceGroup(l, null)).filter(Boolean));
          }
        }
      }
      // Automations: their own group, last.
      if (rowsOf.automations.length) body.push(this.group("automations", "Automations", rowsOf.automations, t, { open }));
      // Nothing at all to show: say so once (never "yet").
      if (!body.length && this.ready && !q) body.push(note(this.emptyLine()));
      // Searching, the archived tasks that match come last, as a group; else a row opens them.
      if (q && found.length) { this.names = { machine: true, space: true }; body.push(this.group("archived", "Archived", found.map((p) => this.row(p, t)), t, { open })); }
      else if (!q && archived.length) body.push(this.archivedLink(archived.length, t));
      if (q && !body.length && this.ready) body.push(note(`No tasks match “${q}”.`));
    }

    return v_flex().id("tasks").size_full().min_h(0).on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } }).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().pl(14).pr(8).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Tasks"))
        .child(div().flex_1())
        .child(h_flex().id("task-more").size(H.sm).flex_none().items_center().justify_center().rounded(RADIUS.control).cursor_pointer().text_color(t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          // Its menu (mods/tasks-menu): a 28 heading, then 32 rows (ui.js menuRow).
          .on_click(() => openOverlay({ mod: "tasks-menu", kind: "popup", at: "pointer", width: 200, height: 8 + 28 + (multi ? 4 : 2) * 32, props: { menu: "group", machines: multi } }))
          .child(svg("mods/tasks/more.svg").size(14).flex_none())))
      .child(this.searchField(t))
      .when(!this.archivedOpen && filters, (el) => el.child(this.filterRow(chips, count, filter, t)))
      // A press in the list gives it the keyboard: F then goes to the search field.
      .child(v_flex().id("task-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(6)
        .track_focus(this.listFocus)
        .on_mouse_down("left", () => this.listFocus.focus())
        .on_key_down((e, cx) => {
          if (e.keystroke === "f" && !this.searching) { cx.stop_propagation(); this.query.focus(); cx.notify(); }
          else if (e.keystroke === "escape" && this.archivedOpen) { cx.stop_propagation(); this.archivedOpen = false; cx.notify(); }
        })
        .when(Boolean(this.error), (el) => el.child(h_flex().m(6).p(10).gap(8).items_start().rounded(RADIUS.card).bg(t.surface).border_1().border_color(t.border)
          .child(div().size(8).mt(5).flex_none().rounded(4).bg(red()))
          .child(div().flex_1().text_size(TEXT.label).text_color(t.muted).child(this.error))))
        .when(!this.ready && !this.error, (el) => el.child(div().px(18).py(28).text_center().text_size(TEXT.label).text_color(t.dim).child("Reading tasks…")))
        .children(body));
  }

  // The filter row: All statuses (not the header's All, which is folders), a chip for each status that wants a look (Needs you, Working, Ready) as
  // far as the panel's width allows, and the rest (and any that don't fit) behind More, a menu.
  // It never wraps and never scrolls. Widths are estimated: about 7px a character at 12px.
  filterRow(chips, count, filter, t) {
    const label = (k) => (k === "automations" ? "Automations" : STATUS[k]);
    const est = (text, n) => 16 + text.length * 7 + (n > 0 ? 5 + String(n).length * 7 : 0) + 2;
    const MORE = 62;
    let room = (this.width ?? 360) - 12 - est("All statuses", 0);
    const shown = [];
    const primary = ["needs", "working", "ready"].filter((k) => chips.includes(k));
    const others = chips.length > primary.length;
    for (const [i, k] of primary.entries()) {
      const w = est(label(k), count(k));
      // Room for More too, unless this is the last chip and nothing else goes in it.
      if (w + (others || i < primary.length - 1 ? MORE : 0) > room) break;
      shown.push(k);
      room -= w;
    }
    const inMore = chips.filter((k) => !shown.includes(k));
    const picked = inMore.includes(filter) ? filter : null;
    const items = inMore.map((k) => ({ key: k, label: label(k), count: count(k) }));
    return h_flex().id("task-filter").flex_none().px(6).pt(6).gap(2).overflow_hidden()
      .child(this.chip("all", "All statuses", 0, filter, t))
      .children(shown.map((k) => this.chip(k, label(k), count(k), filter, t)))
      .when(inMore.length > 0, (el) => el.child(this.moreChip(picked, picked ? label(picked) : "More", picked ? count(picked) : 0, items, filter, t)));
  }

  // The More chip: a chip like the others with a chevron. Its menu (mods/tasks-menu) opens under it, left edges
  // lined up; while it's open (shared "tasks.menuopen", kept by the menu) the chip sits on the hover background.
  moreChip(picked, text, n, items, filter, t) {
    const open = Boolean(shared("tasks.menuopen"));
    const lit = picked ? t.selected : open ? t.hover : t.background;
    return h_flex().id("chip-more").h(H.sm).pl(8).pr(6).gap(4).flex_none().items_center().rounded(RADIUS.control).cursor_pointer().text_size(TEXT.label)
      .bg(lit).text_color(picked || open ? t.foreground : t.muted)
      .hover((s) => s.bg(picked ? t.selected : t.hover).text_color(t.foreground))
      .on_mouse_down("left", (e) => { this.moreAt = e.bounds; })
      .on_click((_e, cx) => {
        const b = this.moreAt;
        openOverlay({ mod: "tasks-menu", kind: "popup", width: 168, height: 8 + items.length * 32,
          at: b ? { x: b.x, y: b.y + b.height + 4 } : "pointer", props: { menu: "filter", items, current: filter } });
      })
      .child(text)
      .when(n > 0, (el) => el.child(div().text_color(t.dim).child(String(n))))
      .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none().text_color(open ? t.muted : t.dim));
  }

  // A filter chip: a status and how many hold it; the chosen one sits on a soft background.
  chip(key, label, n, filter, t) {
    const on = key === filter;
    return h_flex().id(`chip-${key}`).h(H.sm).px(8).gap(5).flex_none().items_center().rounded(RADIUS.control).cursor_pointer().text_size(TEXT.label)
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
      .hover((s) => s.bg(on ? t.selected : t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { this.pickFilter(key); cx.notify(); })
      .child(label)
      .when(n > 0, (el) => el.child(div().text_color(t.dim).child(String(n))));
  }

  pickFilter(key) {
    this.filter = key;
    try { localStorage.setItem("filter", key); } catch {}
  }

  // A row's second line (row()): Needs you and Merging, why; Working, what its agent says it's
  // doing (or a provider retry's line); Queued, what it waits for; Ready, when it got there (its
  // summary is the Accept card's, never this line's).
  statusLine(p, w = reportOf(p.task, p.section, p.live)) {
    return secondLine(p, w, p.section === "queued" ? this.queueReason(p.list, p.task) : null);
  }

  // Archived (herdr-task's archive_pass), unless its agent works or asks again: someone wrote to
  // it, and it's back (herdr-task's next tick makes that stick).
  shelved(p) {
    if (!p.task.archived || p.task.state !== "done") return false;
    return !this.live(p.list, p.task).some((a) => a.status === "working" || a.status === "blocked");
  }

  // A task the search finds: by its id, title, status line or summary (and its pull request's
  // number), or where it is: its space, folder and machine.
  found(p, q) {
    return matches(q, refOf(p.list, p.task), p.task.title, this.statusLine(p), p.task.summary, p.task.pr?.number ? `#${p.task.pr.number}` : null,
      placeName(p.list), p.list.name, machineName(p.list.machine));
  }

  // A Needs-you item the search finds: its task's id and title (or the agent's name) and why, or
  // where it is: its folder or space, and machine.
  needFound(x, q) {
    const ref = x.ref ?? (x.terminal ? this.taskRef(x.terminal) : null);
    const title = x.title ?? (x.terminal ? this.taskTitle(x.terminal) ?? agentName(x.terminal) : null);
    const space = x.terminal ? agents().find((a) => a.address === x.terminal)?.space_name : null;
    return matches(q, ref, title, reasonOf(x), x.kind === "ask" ? this.asks.get(x.id)?.reason : null,
      x.name, space, machineName(x.machine ?? machineOf(x.terminal)));
  }

  // The search field, as Shepherdr's FilterBox: a magnifier, the box, and at its end F (its key)
  // while empty, or an X that clears it.
  searchField(t) {
    const q = this.query.value();
    return div().flex_none().px(6).pt(6)
      .child(h_flex().id("task-search").h(30).pl(9).pr(4).gap(7).items_center().rounded(8).border_1()
        .border_color(this.searching ? t.accent : t.input).bg(t.background)
        .key_context("tasks_search")
        .on_action("tasks_search_clear", (_e, cx) => { cx.stop_propagation(); this.clearSearch(cx); })
        .child(svg("mods/workspace-chrome/search.svg").size(14).flex_none().text_color(t.dim))
        .child(Input.new(this.query).flex_1().min_w(0).text_size(13).text_color(t.foreground))
        .when(Boolean(q), (el) => el.child(h_flex().id("task-search-x").size(H.sm - 2).flex_none().items_center().justify_center().rounded(RADIUS.control)
          .cursor_pointer().text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.query.set_value(""); cx.notify(); })
          .child(svg("mods/workspace-chrome/x.svg").size(13).flex_none())))
        .when(!q && !this.searching, (el) => el.child(searchKey(t))));
  }

  // Esc: clears the field; with nothing in it, the keyboard goes back to the list.
  clearSearch(cx) {
    if (this.query.value()) this.query.set_value("");
    else this.listFocus.focus();
    cx.notify();
  }

  // At the very bottom of the list, once it has archived tasks: "Archived", how many, and a
  // chevron; it opens them (Shepherdr's ArchivedLink). A button that opens a view, not a task.
  archivedLink(n, t) {
    return div().flex_none().pt(6).border_t(1).border_color(t.border)
      .child(h_flex().id("task-archived").h(32).px(8).gap(10).items_center().rounded(RADIUS.card).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.archivedOpen = true; cx.notify(); })
        .child(h_flex().w(14).h(14).flex_none().items_center().justify_center()
          .child(svg("mods/workspace-chrome/archive.svg").size(14).flex_none().text_color(t.dim)))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child("Archived"))
        .child(div().flex_none().text_size(TEXT.label).text_color(t.dim).child(String(n)))
        .child(svg("mods/workspace-chrome/chevron-right.svg").size(12).flex_none().text_color(t.dim)));
  }

  // The Archived view: back to the tasks, its heading and count, then the archived tasks, the
  // latest archived first (the search narrows them too).
  archivedView(ps, q, t) {
    const note = (text) => div().px(8).py(8).text_size(TEXT.label).text_color(t.dim).child(text);
    return v_flex().flex_none().gap(1)
      .child(h_flex().h(30).pl(2).pr(8).gap(6).items_center().text_size(TEXT.label)
        .child(h_flex().id("task-archived-back").size(H.sm).flex_none().items_center().justify_center().rounded(RADIUS.control).cursor_pointer()
          .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { this.archivedOpen = false; cx.notify(); })
          .child(svg("mods/workspace-chrome/chevron-left.svg").size(14).flex_none()))
        .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.dim).child("Archived"))
        .child(div().flex_none().text_color(t.dim).child(ps.length ? String(ps.length) : "")))
      .children(ps.map((p) => this.row(p, t)))
      .when(!ps.length, (el) => el.child(note(q ? `No archived tasks match “${q}”.` : "No archived tasks. Done tasks come here on their own.")))
      .child(note("Archived tasks keep their chat and summary. Search finds them too."));
  }

  // The list's line when it shows nothing at all: how tasks come, unless there are some (all
  // archived, say).
  emptyLine() {
    return this.lists.some((l) => l.tasks.length) ? "Nothing to do." : "No tasks on any machine. Ask an Assistant to plan some.";
  }

  // Folded headings ("<group key>"), remembered.
  shut(key) { return this.shutKeys.has(key); }
  fold(key, shut) {
    if (shut) this.shutKeys.add(key); else this.shutKeys.delete(key);
    try { localStorage.setItem("shut", JSON.stringify([...this.shutKeys])); } catch {}
  }

  // A group: a heading that folds it (a chevron, its label and count; no icon: icons go on rows
  // only), then its rows. Done rows past the newest few wait behind "Show N more".
  // open (searching): every row shows, folded or not, and the heading is just a heading.
  // note: quiet after the label (by space across machines, the machine). machine: a machine's
  // heading (by machine, or over its spaces' groups: count, theirs), a step above the others: its
  // name brighter and larger, and a hairline over it but the first (Shepherdr's MachineHeading).
  group(key, label, rows, t, { done = 0, open = false, note = null, machine = false, first = false, count = rows.length } = {}) {
    const shut = !open && this.shut(key);
    const all = open || this.allDone.has(key);
    const cut = !all && done > DONE_SHOWN ? done - DONE_SHOWN : 0;
    const shown = cut ? rows.slice(0, rows.length - cut) : rows;
    return v_flex().flex_none().gap(1)
      .when(machine && !first, (el) => el.mt(4).pt(6).border_t(1).border_color(t.border))
      // a step of room over each group, so groups read as sections (as the web's)
      .when(!machine, (el) => el.pt(6))
      // As Shepherdr's: the whole heading is the button; the chevron in the rows' icon column
      // (brighter on hover), the label small, its count right by it ("Ready 2"), not across the panel.
      .child(h_flex().id(`head-${key}`).h(28).px(8).gap(12).items_center().rounded(RADIUS.card).text_size(TEXT.label)
        .when(!open, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
          .on_hover((on, cx) => { this.hoverHead = on ? key : this.hoverHead === key ? null : this.hoverHead; cx.notify(); })
          .on_click((_e, cx) => { this.fold(key, !shut); cx.notify(); }))
        .child(h_flex().w(14).h(14).flex_none().items_center().justify_center()
          .child(svg(`mods/workspace-chrome/chevron-${shut ? "right" : "down"}.svg`).size(12).flex_none()
            .text_color(this.hoverHead === key ? t.foreground : t.dim)))
        .child(h_flex().id(`head-${key}-label`).flex_1().min_w(0).gap(6).items_center()
          .child(div().min_w(0).truncate().when(machine, (el) => el.text_size(TEXT.body).font_semibold().text_color(t.muted))
            .when(!machine, (el) => el.font_medium().text_color(t.muted)).child(label))
          .when(Boolean(note), (el) => el.child(div().flex_none().text_color(t.dim).child(`· ${note}`)))
          .when(Boolean(count), (el) => el.child(div().flex_none().text_color(t.dim).child(String(count))))))
      .when(!shut, (el) => el.children(shown)
        .when(cut > 0 || (!open && all && done > DONE_SHOWN), (el) => el.child(h_flex().id(`more-${key}`).h(28).pl(32).pr(8).items_center().rounded(RADIUS.card).cursor_pointer()
          .text_size(TEXT.label).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => {
            if (all) this.allDone.delete(key); else this.allDone.add(key);
            try { localStorage.setItem("alldone", JSON.stringify([...this.allDone])); } catch {}
            cx.notify();
          })
          .child(all ? "Show less" : `Show ${cut} more`))));
  }

  // A row's status mark: Shepherdr's task dot (dot.js); a Working row's pie shows its % done.
  glyph(p, w) {
    return taskDot(p.section, { pct: w?.done });
  }

  // An automation (herdr-task auto), by its name (no id), and on the right when it runs next
  // ("Didn't start" in red). A click opens its last task.
  autoRow(list, a, placed, t) {
    const last = list.tasks.find((x) => `${list.prefix}-${x.id}` === a.last_task);
    const p = last && (placed.find((q) => q.task === last) ?? this.place(list, last));
    const go = p ? this.target(p) : null;
    const err = a.last_error?.message;
    // Why it won't run as planned goes on the second line, as every reason does; when it runs next stays on the right.
    // One set off by another folder's task events (--from) says by what and where, unless something is wrong.
    const src = a.from?.folder ? { machine: a.from.machine ?? list.machine ?? null, folder: a.from.folder } : null;
    const from = src ? fromLine(a.on, `${machineName(src.machine)} · ${spaceOf(src).name ?? String(src.folder).split("/").filter(Boolean).pop()}`) : null;
    const sub = err ? "Didn't start" : a.paused ? "Paused" : from;
    const when = !err && !a.paused && a.next_run ? day(a.next_run) : null;
    // Where it is: its machine (with more than one) and space whatever the grouping, as the Automations group sits
    // under no machine or space heading; none with "Where on task rows" off.
    const where = shared("tasks.place") === false ? null : autoWhere(machineName(list.machine), placeName(list), this.multi);
    return this.line(`auto-${list.machine ?? ""}:${list.folder}#${a.id}`, {
      go, glyph: svg("mods/tasks/repeat.svg").size(14).flex_none().text_color(err ? red() : t.dim),
      ref: null, title: a.title, dim: a.paused, sub, meta: when, where,
    }, t);
  }

  // A "Needs you" item: which task (or agent) on its first line, and on the second why, in at
  // most 40 characters (inbox.js reasonOf: a standard reason or its own question, cut to fit).
  needRow(x, t) {
    // Where it is: a task's folder, an agent's space (and its machine, when not this computer).
    const at = this.whereOf(x.machine ?? machineOf(x.terminal), x.name ?? (x.terminal ? agents().find((a) => a.address === x.terminal)?.space_name : null), true);
    const v = (glyph, title, go, ref = x.ref, sub = reasonOf(x)) => this.line(`need-${x.key}`, { glyph, ref, title, go, where: at, sub }, t);
    // An agent's item: its task's title when it works on one, else its name.
    const who = (address) => this.taskTitle(address) ?? agentName(address);
    switch (x.kind) {
      case "ask": {
        const w = this.asks.get(x.id);
        return v(needDot(), who(x.terminal), () => this.toWorker(x.terminal), this.taskRef(x.terminal), w?.reason ?? reasonOf(x));
      }
      case "blocked": return v(needDot(), who(x.terminal), () => this.toWorker(x.terminal), this.taskRef(x.terminal));
      case "provider": return v(needDot(), who(x.terminal), () => this.toWorker(x.terminal), this.taskRef(x.terminal));
      // A task's own item: the task opens, as its row anywhere does.
      case "check": return v(needDot(), x.title ?? x.ref, () => this.openNeed(x));
      case "waiting":
      case "stopped": return v(needDot(), x.title ?? x.ref, () => this.openNeed(x));
      // An automation goes by its name, with no id.
      case "auto": return v(svg("mods/tasks/repeat.svg").size(14).flex_none().text_color(red()),
        x.title ?? x.ref, () => this.fold("automations", false), null, x.error?.kind === "fire" ? "Didn't run" : "Didn't start its task");
    }
    return null;
  }

  // A task's Needs-you item (check, waiting, stopped): the task itself opens, as its row in any
  // group would; its list not read yet, its live agent's chat.
  openNeed(x) {
    const list = this.lists.find((l) => (l.machine ?? null) === (x.machine ?? null) && l.folder === x.folder);
    const task = list?.tasks.find((y) => refOf(list, y) === x.ref);
    const go = task ? this.target(this.place(list, task)) : null;
    if (go) go();
    else if (x.live?.[0]) this.toWorker(x.live[0], x);
  }

  // To an agent: a task's worker (a reviewer too) opens inside this panel (drill in); any other
  // agent (an Assistant asking) goes to its chat (inbox.js).
  toWorker(address, x = null) {
    const k = terminals().find((y) => y.address === address);
    const m = machineOf(address);
    if (threads() && k?.labels?.["herdr.task"]) {
      const [slug, id] = k.labels["herdr.task"].split("#");
      const list = this.listOf(slug, m);
      const task = list?.tasks.find((y) => String(y.id) === id);
      return openThread({ terminal: address, task: x?.ref ?? this.taskRef(address), title: x?.title ?? task?.title ?? "",
        key: list ? { machine: m, folder: list.folder, slug, id: Number(id) } : null });
    }
    toAgent(address);
  }

  // The task an agent works on (its herdr.task label), as its id, when its list is loaded.
  taskRef(address) {
    const key = terminals().find((k) => k.address === address)?.labels?.["herdr.task"];
    const [slug, id] = String(key ?? "").split("#");
    const list = key && this.listOf(slug, machineOf(address));
    if (list) return refOf(list, { id });
    // Another folder's task: its list's prefix (readPrefixes).
    const pre = key && id ? this.prefixes.get(`${machineOf(address) ?? ""} ${slug}`) : null;
    return pre ? `${pre}-${id}` : null;
  }

  // The prefix of each list an agent's task (its herdr.task label) is in, when that list isn't
  // loaded here (another folder's, without All): read once from its file, so its row has its id.
  readPrefixes(list, cx) {
    for (const it of list) {
      const key = it.terminal && terminals().find((k) => k.address === it.terminal)?.labels?.["herdr.task"];
      const slug = String(key ?? "").split("#")[0];
      const m = machineOf(it.terminal), at = `${m ?? ""} ${slug}`;
      if (!slug || this.prefixes.has(at) || this.listOf(slug, m)) continue;
      this.prefixes.set(at, null);
      cx.spawn(async (cx) => {
        const text = await readTextFile(`${home()}/.herdr/tasks/${slug}.json`, { on: m }).catch(() => null);
        let d = null;
        try { d = JSON.parse(text || "null"); } catch {}
        if (d?.folder) { this.prefixes.set(at, d.prefix || autoPrefix(d.folder)); cx.notify(); }
      });
    }
  }

  // A machine's list, by its slug (the herdr.task label's first part).
  listOf(slug, machine) {
    return this.lists.find((l) => l.slug === slug && (l.machine ?? null) === (machine ?? null)) ?? null;
  }

  // What a row says of where it is, on its right, as far as its group doesn't say it already
  // (this.names, set by render()): its machine (not this computer) and its space or folder.
  // need: a Needs you row, under no grouping but status.
  whereOf(machine, name, need = false) {
    const n = need ? { machine: true, space: true } : this.names ?? { machine: true, space: true };
    return [n.machine ? machine : null, n.space ? name : null].filter(Boolean).join(" · ") || null;
  }

  // The title of the task an agent works on (its herdr.task label), when its list is loaded.
  taskTitle(address) {
    const key = terminals().find((k) => k.address === address)?.labels?.["herdr.task"];
    const [slug, id] = String(key ?? "").split("#");
    return (key && this.listOf(slug, machineOf(address))?.tasks.find((x) => String(x.id) === id)?.title) || null;
  }

  // Reads what each ask asks, once (the hook's request file; the chat shows the same card).
  readAsks(list, cx) {
    for (const it of list) {
      if (it.kind !== "ask" || this.asks.has(it.id) || this.reading.has(it.id)) continue;
      this.reading.add(it.id);
      cx.spawn(async (cx) => {
        const text = await readTextFile(`${ASKS()}/req/${it.id}.json`).catch(() => null);
        let req = null;
        try { req = JSON.parse(text ?? ""); } catch {}
        this.asks.set(it.id, req ? { ...words(req), reason: reqReason(req) } : null);
        this.reading.delete(it.id);
        cx.notify();
      });
    }
    for (const id of [...this.asks.keys()]) if (!list.some((x) => x.id === id)) this.asks.delete(id);
  }

  // Where a click on a task goes: always into it, inside this panel (drill in; never a tab, a
  // peek or the Assistant's box). Its worker while one runs (the one asking first; a reviewer
  // alone too); else its last agent's conversation, read from that agent's own log, with Resume
  // (mods/chat); a task that never started says why it waits. Nowhere in a layout without the view.
  target(p) {
    if (!threads()) return null;
    const { list, task } = p;
    const m = list.machine ?? null;
    const key = { machine: m, folder: list.folder, slug: list.slug, id: task.id };
    const open = (terminal, more = {}) => () => openThread({ terminal, task: refOf(list, task), title: task.title, key, ...more });
    const worker = p.live.find((x) => x.role !== "reviewer" && x.status === "blocked") ?? p.live.find((x) => x.role !== "reviewer") ?? p.live[0];
    if (worker) return open(worker.address);
    const last = task.agents?.[task.agents.length - 1];
    if (last?.address) return open(m ? `${m}/${last.address}` : last.address, { log: last.log ? { path: last.log, kind: last.agent ?? null } : null });
    return open(null, { note: p.section === "queued" ? capital(this.queueReason(list, task)) : "This task hasn't started." });
  }

  row(p, t) {
    const { list, task, live, section } = p;
    const shown = this.frame ? (this.frame.agents ??= new Map(agents().map((a) => [a.address, a]))) : new Map(agents().map((a) => [a.address, a]));
    const focused = live.some((a) => shown.get(a.address)?.focused);
    // The second line, as Shepherdr's: Working, what its agent says it's doing (herdr-task status),
    // its time left short under the glyph, or a provider retry's line while Herdr waits; Needs you,
    // why; Queued, what it waits for ("after HERD-3"); Merging, why it waits. The id leads it.
    const w = reportOf(task, section, live);
    const sub = this.statusLine(p, w);
    // Scheduled (SHEP-38): its time until it starts under its calendar ("6h"), where a working row's time left goes, in grey.
    const left = leftOf(p, w);
    // Pin / Unpin in its right-click menu (not an archived task's: archived ones drop out of Pinned).
    const key = taskKey(list, task);
    return this.line(`task-${key}`, {
      go: this.target(p), glyph: this.glyph(p, w), ref: refOf(list, task), title: task.title, sub, left, leftColor: section === "scheduled" ? t.dim : null,
      dim: section === "done", selected: focused, where: this.whereOf(list.machine, placeName(list)),
      action: section === "ready" ? this.acceptButton(p, t) : null,
      pin: this.shelved(p) ? null : { key, on: this.pins().has(key), status: section, machine: list.machine ?? null, folder: list.folder,
        ref: refOf(list, task), sub: section === "scheduled" ? sub : null },
    }, t);
  }

  // The person's pinned tasks (shared "tasks.pinned": task keys), once a render.
  pins() {
    if (!this.frame) return new Set(pinnedKeys());
    return (this.frame.pins ??= new Set(pinnedKeys()));
  }

  // A pinned task that's archived or deleted drops out, once its list is read (a list not read yet,
  // on a machine out of reach or caught mid-write, keeps its pins).
  prunePins(placed, cx) {
    const pins = pinnedKeys();
    if (!pins.length) return;
    const have = new Set(placed.map((p) => taskKey(p.list, p.task)));
    const read = new Set(this.lists.map((l) => `${l.machine ?? ""}:${l.folder}`));
    const gone = new Set(pins.filter((k) => !have.has(k) && read.has(k.slice(0, k.lastIndexOf("#")))));
    if (gone.size) cx.timer.after(0, () => setShared(PINS, pinnedKeys().filter((k) => !gone.has(k))));
  }

  // The row's right-click menu (mods/tasks-menu): Pin / Unpin, at the pointer. Rows show no pin of
  // their own: a pinned task sits in the Pinned group.
  // A task not started yet also starts later (SHEP-38): a few times, and a scheduled one Start now and Unschedule
  // (core/menus.js taskMenu; the web's Other time… types any time, here the Assistant does).
  rowMenu(pin) {
    const items = taskMenu({ pinned: pin.on, status: pin.status }).filter((x) => !x.typed);
    // As tasks-menu draws it: a section per line or heading, 4 apart; a heading 28, a row 32.
    let height = 8, first = true;
    for (const x of items) {
      if ((x.sep || x.heading) && !first) height += 4;
      height += x.sep ? 0 : x.heading ? 28 : 32;
      first = false;
    }
    openOverlay({ mod: "tasks-menu", kind: "popup", at: "pointer", width: 220, height, props: { menu: "row", key: pin.key, on: pin.on,
      status: pin.status, machine: pin.machine, folder: pin.folder, ref: pin.ref, sub: pin.sub } });
  }

  // Ready = "looks done, your call": Review (opens the Accept card) is the person's one action here, at the row's end. It merges first when there is something to merge (herdr-task accept follows the merge
  // settings), else it's done. "Accepting…" while the Accept card's accept runs (shared
  // "tasks.accepting", accepting()).
  acceptButton(p, t) {
    const key = `${p.list.machine ?? ""}:${p.list.folder}:${refOf(p.list, p.task)}`;
    const busy = accepting(key);
    // Soft, as the chat header's Review: there is one per Ready row, so never the solid look.
    return h_flex().id(`accept-${key}`).h(24).px(10).flex_none().items_center().rounded(12).whitespace_nowrap()
      .text_size(TEXT.label).font_medium().text_color(t.foreground).bg(t.hover)
      .when(busy, (el) => el.opacity(0.6))
      .when(!busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.selected))
        .on_click((_e, cx) => { cx.stop_propagation(); this.accept(p); cx.notify(); }))
      .child(busy ? "Accepting…" : "Review");
  }

  // Accept shows what you approve first: the Accept card (mods/accept-card) runs herdr-task
  // accept from its own Accept; the list reads the change as it reads any.
  accept(p, _cx) {
    openOverlay({ mod: "accept-card", kind: "dialog", modal: true, width: 640, height: 640,
      props: { ref: refOf(p.list, p.task), folder: p.list.folder, machine: p.list.machine ?? null, title: p.task.title } });
  }

  // One row (as Shepherdr's web Tasks list), three parts with one job each:
  // - the glyph, level with the title, and under it, level with the second line, the time left
  //   ("2h", "<1m": short, in the working color, centred on the glyph; wider than it, it overflows
  //   evenly, so the column and the titles never move);
  // - the text: the title owns the first line, cut only at its own end; under it one quiet line read
  //   left to right, never pushed apart: the task's id (dim, monospace), what it says now (why it
  //   needs you or what its agent does: at most 40 characters, cut at a word), then where it is after
  //   a dot (it gives way first);
  // - the end, centred on the row: the one thing to act on or watch: Review or an automation's next
  //   run (`meta`).
  // A row with nothing under its title is one line. Nothing shows on hover: no tooltips (SHEP-25).
  // `pin`: { key, on }: Pin / Unpin in the row's right-click menu.
  line(id, { go, glyph, ref, title, sub, left, leftColor, dim, selected, meta, metaColor, where, action, pin }, t) {
    // Every second line is at most 40 characters (herdr-task cuts an agent's own; this catches the
    // derived ones: a long queue, a check's message).
    const said = sub ? capital(sub) : null;
    const shown = said ? fit(said) : null;
    const two = Boolean(ref) || Boolean(shown) || Boolean(where);
    const end = action ?? (meta ? div().flex_none().whitespace_nowrap().text_size(TEXT.label).text_color(metaColor ?? t.dim).child(meta) : null);
    const row = h_flex().id(id).relative().flex_none().px(8).gap(12).items_center().rounded(RADIUS.card)
      .when(Boolean(selected), (el) => el.bg(t.selected))
      .when(Boolean(pin), (el) => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.rowMenu(pin); }))
      .when(Boolean(go), (el) => el.cursor_pointer().hover((s) => s.bg(selected ? t.selected : t.hover)).on_click((_e, cx) => { go(); cx.notify(); }));
    const mark = h_flex().w(14).h(20).flex_none().items_center().justify_center().child(glyph);
    const head = div().id(`${id}-title`).min_w(0).truncate().text_color(dim ? t.muted : t.foreground).child(title);
    if (!two) return row.h(32).child(mark).child(head.flex_1()).when(Boolean(end), (el) => el.child(end));
    // The words keep their room: where it is takes only what is left after them, and gives way first.
    const second = h_flex().h(16).min_w(0).gap(6).items_center().text_size(TEXT.label)
      .when(Boolean(ref), (el) => el.child(div().flex_none().font_family(ID_FONT).text_size(ID_SIZE).text_color(t.dim).child(ref)))
      .when(Boolean(shown), (el) => el.child(div().id(`${id}-sub`).flex_shrink_1().min_w(0).truncate().text_color(t.muted).child(shown)))
      .when(Boolean(where), (el) => el.child(div().flex_shrink(1000).min_w(0).truncate().text_color(t.dim)
        .child(ref || shown ? `· ${where}` : where)));
    // The time left as tall as the second line (16), 2 under the glyph as the line is under the title.
    return row.py(8)
      .child(v_flex().w(14).flex_none().self_start().gap(2).child(mark)
        .when(Boolean(left), (el) => el.child(h_flex().w(14).h(16).items_center().justify_center().whitespace_nowrap()
          .font_family(ID_FONT).text_size(ID_SIZE).font_semibold().text_color(leftColor ?? amber()).child(left))))
      .child(v_flex().flex_1().min_w(0).gap(2).child(h_flex().h(20).min_w(0).items_center().child(head.flex_1())).child(second))
      .when(Boolean(end), (el) => el.child(end));
  }

}

const searchKey = (t) => h_flex().h(18).px(5).mr(3).flex_none().items_center().rounded(4).border_1().border_color(t.border)
  .font_family(ID_FONT).text_size(TEXT.id).text_color(t.dim).child("F");

// Esc in a search field (key context `context`) clears it: the "<context>_clear" action.
const boundSearch = new Set();
function bindSearchKeys(cx, context) {
  if (boundSearch.has(context)) return;
  boundSearch.add(context);
  try { cx.bind_keys([{ keystroke: "escape", action: `${context}_clear`, context: `${context} > Input` }]); } catch {}
}

// An agent's name: the one it was given (hc --name), else its program's.
function agentName(address) {
  const k = terminals().find((x) => x.address === address);
  return k?.name || k?.program?.name || address;
}

// Task threads: a click drills into the task inside this panel (the layout's "tasks" stack: this
// list is "tasks-list", the task "tasks-thread", mods/chat/panel.js), never a side chat. Only
// where the shown layout has that view. Shared "tasks.thread" = { terminal (its agent, live or its
// last one; null: never started), task (its id), title, key ({ machine, folder, slug, id }), log
// ({ path, kind }: an ended agent's own log), note (why one never started waits), at }.
const hasThread = (n) => Boolean(n && typeof n === "object") && (n.id === "tasks-thread" || (n.children ?? []).some(hasThread));
const threads = () => hasThread(layout());
function openThread({ terminal = null, task = null, title = null, key = null, log = null, note = null }) {
  setShared("tasks.thread", { terminal, task, title, key, log, note, at: Date.now() });
  run("layout.select", { stack: "tasks", child: "tasks-thread" });
}

// The Accept card's accept under way (shared "tasks.accepting" = { "<machine>:<folder>:<ref>": at },
// mods/accept-card): its row says "Accepting…". One older than 10 minutes was left by a quit.
function accepting(key) {
  const at = shared("tasks.accepting")?.[key];
  return typeof at === "number" && Date.now() - at < 600000;
}

// Needs you's mark, whatever is needed: Shepherdr's red dot. What is needed shows in the row's words only.
const needDot = () => taskDot("needs");

// What a task's agent last said (core/tasks.js reportOf), with the progress its own terminal reports.
export function reportOf(task, section, live = []) {
  return report(task, section, ownProgress(live.map((a) => a.address)));
}
