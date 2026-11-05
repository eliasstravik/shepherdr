// A task's chat inside the Tasks panel (the person's decision: drill in, never a side chat).
// The layout's "tasks" stack holds the list ("tasks-list", mod tasks) and this view
// ("tasks-thread", a column): a header ("tasks-thread-head", mod chat with props { panel: true,
// head: true }: ‹ Tasks back to the list, the task, its worker's status, Accept and the main
// chat's Chat / Terminal switch) over a stack ("tasks-thread-body") of the worker's chat
// ("tasks-thread-chat", mod chat with props { panel: true }: a nested Chat made again for each
// worker) and its raw terminal ("tasks-thread-term", a layout terminal block). A task worker has
// no pane or tab, and none is made: the terminal block shows it where it runs.
// Which worker: shared "tasks.thread" = { terminal, task, title, at } (openTaskThread()). The
// Tasks list sends every task this way, with { key: { machine, folder, slug, id } } too: an
// ended task's last agent (its chat read from { log: { path, kind } }, with Resume) or, never
// started (terminal null), a { note } saying why it waits (mods/tasks target()).
// A Ready task (its worker said ready) gets Accept in the header, as its row in the list does:
// the person's one action on tasks (herdr-task accept: merges first when there's something to
// merge, else done). The task's record is read from its list file (its herdr.task label).
// Beside the chat and terminal the body stack holds the task's Files, Changes (against its base)
// and Pull request (mods task-files, task-changes, task-pr), and its Browser (mods/task-browser: a
// live viewer in a terminal block of its own), picked in the header's second row, as Shepherdr's
// task side panel. All are one switcher (only one shows at a time), the main chat's header switch
// (ui.js segmented); Pull request only once the task has one. They show the task the header
// publishes (shared "tasks.thread.where", from its record: lib/taskwhere.js).

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { shared, setShared, run, theme, exec, appHome, home, readTextFile, writeTextFile, notify, layout, openOverlay } from "herdr";
import { terminals, agents } from "./live.js";
import { taskDot, ownProgress, estimated } from "./dot.js";
import { busyAgain, onIt } from "./core/tasks.js";
import { button, segmented, TEXT, RADIUS, toast, plainError } from "./ui.js";
import { on as addonOn } from "./addons.js";

// The task header's shared left edge, and task ids in the Tasks list's monospace (mods/tasks).
const EDGE = 12, ID_FONT = "JetBrains Mono";

export const STACK = "tasks", LIST = "tasks-list", THREAD = "tasks-thread";
export const BODY = "tasks-thread-body", CHAT = "tasks-thread-chat", TERM = "tasks-thread-term";
export const FILES = "tasks-thread-files", CHANGES = "tasks-thread-changes", PR = "tasks-thread-pr";
export const BROWSER = "tasks-thread-browser";

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const hit = find(c, id); if (hit) return hit; }
  return null;
}

// The chat shown inside, for its cleanup: a nested view gets no close() of its own.
export const inner = { chat: null };

// Which task a "tasks.thread" names: its agent's terminal, else its key (one never started).
const wantId = (w) => (w ? w.terminal ?? (w.key ? `${w.key.machine ?? ""}:${w.key.slug}#${w.key.id}` : null) : null);

// Whether the shown layout has the drill-in view (else callers go to the agent instead).
export function hasTaskThread(node) {
  if (!node || typeof node !== "object") return false;
  if (node.id === THREAD) return true;
  return (node.children ?? []).some(hasTaskThread);
}

export function openTaskThread(terminal, task, title) {
  setShared("tasks.thread", { terminal, task: task ?? null, title: title ?? null, at: Date.now() });
  run("layout.select", { stack: "panel-body", child: STACK });
  run("layout.select", { stack: STACK, child: THREAD });
  // A task opens on its chat; the header's switch shows its terminal.
  if (find(layout(), BODY)) run("layout.select", { stack: BODY, child: CHAT });
  run("layout.show", { id: "panel" });
}

export const backToTasks = () => run("layout.select", { stack: STACK, child: LIST });

// Chat / Terminal: which the view shows now (the body stack's child).
export const terminalShown = () => find(layout(), BODY)?.active === TERM;
export const showWorkerChat = () => run("layout.select", { stack: BODY, child: CHAT });
// Asks the header for the worker's terminal (the chat's own "Open terminal", a slash menu): it
// has the timers the swap waits on. Shared "tasks.thread.termreq" = { terminal, at }.
export const requestWorkerTerminal = (terminal) => setShared("tasks.thread.termreq", { terminal, at: Date.now() });

// The terminal block shows the worker: an edit of that one block in the layout's file (a mod
// can't draw a terminal, and a layout block can show any core terminal without giving it a pane;
// not layout.set, as the Artifacts sidebar explains). Only if the file is unchanged since it was
// read; else read again. Then Herdr reads the file (under a second): wait for the block.
async function pointTerm(addr, cx) {
  const path = `${appHome()}/layouts/${shared("layout")}.json`;
  for (let i = 0; ; i++) {
    const text = await readTextFile(path);
    const tree = JSON.parse(text ?? "null"), body = find(tree, BODY);
    if (!body) throw new Error("This layout has no task terminal.");
    const node = { id: TERM, type: "block", content: { terminal: addr } };
    const at = body.children.findIndex((c) => c.id === TERM);
    if (at < 0) body.children.push(node); else body.children[at] = node;
    try { await writeTextFile(path, JSON.stringify(tree, null, 2), text); break; }
    catch (e) { if (i >= 2) throw e; }
  }
  for (let i = 0; i < 30 && find(layout(), TERM)?.content?.terminal !== addr; i++) await new Promise((r) => cx.timer.after(100, () => r()));
  if (find(layout(), TERM)?.content?.terminal !== addr) throw new Error("Herdr didn't load the layout with this terminal.");
}

export class PanelHost {
  // Two copies: the header (head: true) and the body, which holds the nested chat.
  constructor(Chat, head) {
    this.Chat = Chat;
    this.head = head === true;
    this.termReqAt = shared("tasks.thread.termreq")?.at ?? null;
    this.restartReqAt = shared("chat.restartreq")?.at ?? null;
    this.busy = false;     // the header's swap to the terminal, under way
    this.cur = null;
    this.entity = null;
    this.swapping = false;
    this.rec = null;       // the shown worker's task record (its list file's entry), or null
    this.accepting = false;
    this.ticks = 0;
  }

  // The worker's task: { machine, slug, id } from its herdr.task label ("<slug>#<id>"), or null.
  taskOf(addr) {
    const key = terminals().find((k) => k.address === addr)?.labels?.["herdr.task"];
    const [slug, id] = String(key ?? "").split("#");
    return key && slug && id ? { machine: addr.includes("/") ? addr.split("/")[0] : null, slug, id: Number(id) } : null;
  }

  // Reads its task's record again (cheap: one small file; another machine's less often).
  async loadTask(addr, cx) {
    const cur = this.cur;
    // A terminal gone from the core has no labels left: the task's key, as the list sent it.
    const k = (addr && this.taskOf(addr)) || cur?.key || null;
    let rec = null;
    if (k) {
      const text = k.machine
        ? (await exec("sh", ["-c", 'cat "$HOME/.herdr/tasks/$1.json"', "sh", k.slug], { on: k.machine }).catch(() => null))?.stdout
        : await readTextFile(`${home()}/.herdr/tasks/${k.slug}.json`).catch(() => null);
      try {
        const d = JSON.parse(text || "null");
        const t = d?.tasks?.find((x) => x.id === k.id);
        rec = t ? { ...t, folder: d.folder, machine: k.machine, ref: d.prefix ? `${d.prefix}-${t.id}` : String(t.id) } : null;
      } catch {}
    }
    if (this.cur !== cur) return;
    // Where the task's side views look (taskwhere.js): its worktree, else its list's folder.
    if (this.head) {
      const w = rec ? { terminal: addr, ref: rec.ref, folder: rec.worktree || rec.folder || null, machine: rec.machine ?? null,
        branch: rec.branch ?? null, base: rec.base ?? null, start: rec.start ?? null, pr: rec.pr ?? null } : null;
      if (JSON.stringify(w) !== JSON.stringify(shared("tasks.thread.where") ?? null)) setShared("tasks.thread.where", w);
    }
    if (JSON.stringify(rec) !== JSON.stringify(this.rec)) { this.rec = rec; cx.notify(); }
  }

  // Ready and nothing in the way (as the list's Ready group): not asking, no problem, not already merging, not
  // back at work.
  acceptable(st, addr) {
    const r = this.rec;
    return Boolean(r && r.state === "ready" && !r.attention && st !== "blocked" && !r.merge_requested && !(r.auto_merge && r.pr && !r.merged))
      && !this.again(st, addr);
  }

  // Its worker took up work again since it said ready (core/tasks.js busyAgain()): Working, no Accept.
  again(st, addr) {
    const r = this.rec, k = addr ? terminals().find((x) => x.address === addr) : null;
    return Boolean(r && k) && busyAgain(r, [{ address: addr, status: st, turn: k.turn, role: k.labels?.["herdr.role"] ?? "worker" }]);
  }

  // Accept shows what you approve first: the Accept card (mods/accept-card) runs herdr-task
  // accept from its own Accept; the header reads the task again on its timer.
  accept(_cx) {
    const r = this.rec;
    openOverlay({ mod: "accept-card", kind: "dialog", modal: true, width: 640, height: 640,
      props: { ref: r.ref, folder: r.folder, machine: r.machine ?? null, title: r.title } });
  }

  // Another worker asked for: the old chat is closed and released, a new one made for it.
  async swap(want, cx) {
    const old = this.entity, oldChat = inner.chat;
    this.entity = null;
    inner.chat = null;
    if (old) {
      try { await oldChat?.close(cx); } catch {}
      old.release();
    }
    this.cur = want;
    this.rec = null;
    this.loadTask(want?.terminal, cx);
    if (want?.terminal) this.entity = cx.new(this.Chat, { inner: true, thread: true, terminal: want.terminal, task: want.task, title: want.title,
      log: want.log ?? null, key: want.key ?? null });
    this.swapping = false;
    cx.notify();
  }

  async close(cx) {
    if (!this.head) await inner.chat?.close(cx);
  }

  // The task's status dot, by the Tasks list's rules (mods/tasks place()): its record, then its
  // worker's own status. Nothing (an empty spot the dot's size) until its record is read.
  dot(st, addr) {
    const r = this.rec;
    if (!r) return div();
    const live = terminals().find((x) => x.address === addr)?.state === "live";
    const last = r.agents?.[r.agents.length - 1];
    const starting = !last?.ended && Date.now() - Math.max(0, ...[r.started, last?.at].filter((x) => typeof x === "number")) < 90000;
    // A problem (failing checks) its worker is on (core/tasks.js onIt()): Working; nobody on it: Needs you.
    const k = addr ? terminals().find((x) => x.address === addr) : null;
    const fixing = r.attention && onIt(r, live ? [{ address: addr, status: st, turn: k?.turn, role: k?.labels?.["herdr.role"] ?? "worker" }] : []);
    const s = ["todo", "queued", "scheduled", "done"].includes(r.state) ? r.state
      : (r.attention && !fixing) || st === "blocked" || r.retry?.over ? "needs"
      : fixing ? "working"
      : r.state === "ready" && !this.again(st, addr) ? ((r.merge_requested && live) || (r.auto_merge && r.pr && !r.merged) ? "merging" : "ready")
      : st === "working" || r.retry || starting ? "working" : "needs";
    return taskDot(s, { pct: ownProgress([addr])?.pct ?? r.progress?.done, halo: true });
  }

  status(addr) {
    const a = agents().find((x) => x.address === addr);
    if (a) return a.status;
    const k = terminals().find((x) => x.address === addr);
    return ["working", "blocked", "done", "idle"].includes(k?.status) ? k.status : null;
  }

  // Chat → Terminal: the body stack shows the worker's terminal block, pointed at it first, and
  // the keyboard goes to it (typing reaches the worker, as in the main chat's Terminal).
  toTerminal(addr, cx) {
    if (this.busy) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (find(layout(), TERM)?.content?.terminal !== addr) await pointTerm(addr, cx);
        run("layout.select", { stack: BODY, child: TERM });
        run("pane.focus", { terminal: addr });
      } catch (e) {
        toast({ title: "Terminal didn't open", body: plainError(e), level: "error" });
      }
      this.busy = false;
      cx.notify();
    });
  }

  // Pin / Unpin the task: a view choice in shared "tasks.pinned", keyed as the Tasks list keys it
  // ("<machine, empty here>:<folder>#<id>", mods/tasks). Pinned, it sits pressed in.
  pinButton(t) {
    const r = this.rec, key = `${r.machine ?? ""}:${r.folder}#${r.id}`;
    const pins = Array.isArray(shared("tasks.pinned")) ? shared("tasks.pinned") : [];
    const on = pins.includes(key);
    return h_flex().id("thread-pin").size(24).flex_none().items_center().justify_center().rounded(RADIUS.control).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).text_color(on ? t.foreground : t.dim)
      .hover((s) => s.bg(on ? t.selected : t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        const now = shared("tasks.pinned");
        const rest = (Array.isArray(now) ? now : []).filter((k) => k !== key);
        setShared("tasks.pinned", on ? rest : [...rest, key]);
        cx.notify();
      })
      .child(svg("mods/workspace-chrome/pin.svg").size(14).flex_none());
  }

  // Chat | Terminal | Files | Changes | Pull request | Browser: the main chat's header switch
  // (ui.js segmented, as mods/pane-chat). segs: { key, label, on, dead (can't open now), fn }.
  switcher(t, segs) {
    return segmented("thread-mode", segs.map((x) => [x.key, x.label, { disabled: x.dead }]),
      segs.find((x) => x.on)?.key ?? null, (v, _e, cx) => segs.find((x) => x.key === v)?.fn(cx));
  }

  render(cx) {
    return this.head ? this.renderHead(cx) : this.renderBody(cx);
  }

  // The body: the worker's chat (its terminal is the layout's own block beside it).
  renderBody(cx) {
    const want = shared("tasks.thread") ?? null;
    if (wantId(want) !== wantId(this.cur) && !this.swapping) {
      this.swapping = true;
      cx.timer.after(0, (cx) => cx.spawn(async (cx) => this.swap(want, cx)));
    }
    // The model picker's Restart (shared "chat.restartreq"): a nested view isn't drawn again
    // when shared state changes, so the chat is asked to; it checks whether it's for it.
    const rr = shared("chat.restartreq");
    if (this.entity && rr?.at && rr.at !== this.restartReqAt) {
      this.restartReqAt = rr.at;
      const e = this.entity;
      cx.timer.after(0, (cx) => cx.notify(e));
    }
    const t = theme();
    return this.entity
      ? v_flex().id("task-thread").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13).child(this.entity)
      : v_flex().id("task-thread").size_full().items_center().justify_center().px(18).bg(t.background).text_size(TEXT.label).text_color(t.dim)
        .child(want?.note ?? (want ? "Opening…" : "Pick a task to see its chat."));
  }

  // The worker's report (herdr-task status) or a provider retry's line, under the title (as its
  // Tasks row): the words give way first, so the minutes never get cut off. While it waits on the
  // person it's frozen, its % at the end instead.
  reportLine(st, t) {
    const r = this.rec, addr = this.cur?.terminal;
    if (!r || r.state !== "running") return null;
    let text = null, end = null, paused = false;
    if (r.retry && r.retry.address === addr && !r.retry.over && st !== "blocked") {
      text = r.retry.due ? `${r.retry.reason} · Retry in ${Math.max(1, Math.ceil((r.retry.due - Date.now()) / 60000))}m` : `${r.retry.reason} · Retrying`;
    } else if (r.progress?.text) {
      const p = r.progress;
      text = p.text;
      paused = st !== "working";
      if (paused) end = typeof p.done === "number" ? `${p.done}%` : null;
      else if (estimated(p)) {
        const rem = Math.max(0, p.left - ((p.paused_at ?? Date.now()) - (p.at ?? Date.now())));
        const n = rem < 60000 ? 0 : Math.ceil(rem / 60000);
        end = n < 1 ? "<1 min" : n < 60 ? `~${n} min` : `~${Math.round(n / 60)} h`;
      }
    }
    if (!text) return null;
    return h_flex().id("thread-report").w_full().min_w(0).gap(4).items_center().text_size(TEXT.label).text_color(paused ? t.dim : t.muted)
      .child(div().min_w(0).truncate().child(text))
      .when(Boolean(end), (el) => el.child(div().flex_none().text_color(t.dim).child(`· ${end}`)));
  }

  renderHead(cx) {
    const want = shared("tasks.thread") ?? null;
    if (wantId(want) !== wantId(this.cur)) {
      this.cur = want;
      this.rec = null;
      cx.timer.after(0, (cx) => cx.spawn(async (cx) => this.loadTask(want?.terminal, cx)));
    }
    // The task's record, again every 3 s while a worker shows (12 s on another machine).
    if (!this.polling) {
      this.polling = true;
      cx.timer.every(3000, (cx) => {
        const addr = this.cur?.terminal, key = this.cur?.key;
        const remote = addr ? addr.includes("/") : Boolean(key?.machine);
        if ((addr || key) && (!remote || ++this.ticks % 4 === 0)) cx.spawn(async (cx) => this.loadTask(addr, cx));
        // Its minutes left count down: a redraw every 30 s while it reports some.
        if (this.rec?.progress && (this.redraws = (this.redraws ?? 0) + 1) % 10 === 0) cx.notify();
      });
    }
    const t = theme();
    const addr = want?.terminal ?? null;
    const k = addr ? terminals().find((x) => x.address === addr) : null;
    const st = addr ? this.status(addr) : null;
    const live = k?.state === "live";
    const term = terminalShown();
    // The worker ended (or none shows) while its terminal was up: back to its chat, which stays to read.
    if (term && !live && !this.busy) cx.timer.after(0, () => showWorkerChat());
    // The chat's own way to the terminal (requestWorkerTerminal()).
    const rq = shared("tasks.thread.termreq");
    if (rq && rq.at !== this.termReqAt && rq.terminal === addr && live && Date.now() - rq.at < 5000) {
      this.termReqAt = rq.at;
      cx.timer.after(0, (cx) => this.toTerminal(addr, cx));
    }
    // The second row, one switcher: Chat, Terminal (dim when the worker has ended), then the task's own views.
    const shownNow = this.busy ? TERM : find(layout(), BODY)?.active ?? CHAT;
    const pick = (child) => () => run("layout.select", { stack: BODY, child });
    const hasPr = Boolean(this.rec?.pr) || (addr && shared("tasks.thread.pr")?.terminal === addr);
    // Pull request only once the task has one; shown while it lost it, back to its chat.
    if (shownNow === PR && !hasPr && this.rec) cx.timer.after(0, () => showWorkerChat());
    const segs = [
      { key: "chat", label: "Chat", on: shownNow === CHAT, fn: () => showWorkerChat() },
      { key: "term", label: "Terminal", on: shownNow === TERM, dead: !live, fn: (cx) => this.toTerminal(addr, cx) },
      { key: "files", label: "Files", on: shownNow === FILES, fn: pick(FILES) },
      { key: "changes", label: "Changes", on: shownNow === CHANGES, fn: pick(CHANGES) },
      ...(hasPr ? [{ key: "pr", label: "Pull request", on: shownNow === PR, fn: pick(PR) }] : []),
      // The task's own browser, watched live (mods/task-browser), when the layout has it.
      ...(find(layout(), BROWSER) && addonOn("browser") ? [{ key: "browser", label: "Browser", on: shownNow === BROWSER, fn: pick(BROWSER) }] : []),
    ];
    // Three rows on one left edge (EDGE): a slim bar (‹ Tasks; base, Pin, Accept), the task (its
    // dot, id and title, and under them what its agent is doing), then the switcher.
    // Their height is the "tasks-thread-head" block's size in layouts/shepherdr.json (127): keep them in step.
    return v_flex().id("thread-head-rows").size_full().pt(8).pb(12).gap(12).bg(t.background).border_b(1).border_color(t.border)
      .child(v_flex().flex_none().gap(8)
        .child(this.barRow(t, st, addr))
        .child(this.taskBlock(t, { want, st, addr })))
      .child(h_flex().id("thread-views").flex_none().px(EDGE).overflow_x_scroll()
        .child(this.switcher(t, segs)));
  }

  // The slim bar: ‹ Tasks back to the list on the left (its chevron on the shared edge, its hover
  // reaching past it), and on the right the task's base, Pin and Accept.
  barRow(t, st, addr) {
    return h_flex().id("thread-bar").h(24).flex_none().pl(EDGE - 6).pr(EDGE).gap(4).items_center()
      .child(h_flex().id("thread-back").h(24).pl(2).pr(8).gap(2).flex_none().items_center().rounded(RADIUS.control).cursor_pointer()
        .text_size(TEXT.label).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); backToTasks(); })
        .child(svg("mods/workspace-chrome/chevron-left.svg").size(14).flex_none())
        .child("Tasks"))
      .child(div().flex_1())
      // A task's own base (herdr-task add --base), where it merges into; the folder's default isn't shown.
      .when(Boolean(this.rec?.base_set && this.rec?.base), (el) => el.child(div().id("thread-base").flex_none().max_w(160).truncate().pr(4)
        .text_size(TEXT.label).text_color(t.muted).child(`→ ${this.rec.base}`)))
      // Pin / Unpin, as the task's row in the list (not an archived task's).
      .when(Boolean(this.rec && !(this.rec.archived && this.rec.state === "done")), (el) => el.child(this.pinButton(t)))
      // Review: the header's one primary button, opens the Accept card (its Accept merges first when there's something to merge).
      .when(this.acceptable(st, addr), (el) => el.child(button("thread-accept", this.accepting ? "Accepting…" : "Review",
        { kind: "primary", disabled: this.accepting, onClick: (_e, cx) => this.accept(cx) })));
  }

  // The task: its status dot (as its Tasks row, Needs you with its halo) beside the title line,
  // the id (the list's monospace) and title; under them what its agent says it's doing, with the
  // minutes left ("Fixing the two failing tests · ~6 min"), on the title's left edge. No agent
  // logo or name: the chat input's model button says which agent it is. Both lines always keep
  // their height, so nothing jumps as reports come and go.
  taskBlock(t, { want, st, addr }) {
    const report = this.reportLine(st, t);
    const title = want?.title ?? this.rec?.title ?? "";
    return h_flex().id("thread-task").flex_none().px(EDGE).gap(8).items_start().text_color(t.foreground)
      .child(h_flex().w(16).h(22).flex_none().items_center().justify_center().child(this.dot(st, addr)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().h(22).min_w(0).gap(8).items_center()
          .when(Boolean(want?.task), (el) => el.child(div().flex_none().font_family(ID_FONT).text_size(TEXT.label).text_color(t.dim).child(want.task)))
          .child(div().id("thread-title").flex_1().min_w(0).truncate().text_size(TEXT.title).font_medium().child(title)))
        .child(h_flex().h(16).min_w(0).items_center()
          .child(div().flex_1().min_w(0).when(Boolean(report), (el) => el.child(report)))));
  }
}
