// A task's Browser (HERD-57, HERD-69): its agent-browser session, watched live in the Tasks panel's
// task view, a child of the view's body stack beside Files, Changes and Pull request (taskwhere.js).
// Each task has one session, driven with bin/herdr-browser (session herdr-<name>, profile
// ~/.local/state/shepherdr/browser/<name>, <name> its herdr.task key made safe).
//
// What it shows is a terminal: bin/herdr-browser-view draws the page's live frames in it (Kitty
// graphics) and sends the person's clicks, scrolls and keys to the same browser (taking it over:
// the agent is told to hold off). A mod can't draw a terminal, so the Browser child is a column
// ("tasks-thread-browser"): this mod's block ("-host", what's going on while there's no viewer)
// and, while a viewer runs, a layout terminal block ("-view") showing it, written into the layout's
// file as the task terminal is (mods/chat/panel.js pointTerm). The viewer starts when the Browser
// view shows a task and is stopped when it hides or another task shows; it has no tab or pane.
// This copy keeps ~/.local/state/shepherdr/browser/<name>.view fresh while it wants the viewer: a viewer whose
// file goes stale (this copy reloaded or gone) ends by itself.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { exec, hc, theme, terminals, appHome, home, shared, layout, readTextFile, writeTextFile } from "herdr";
import { shown, BROWSER } from "./taskwhere.js";
import { dirs } from "./dirs.js";

const HOST = "tasks-thread-browser-host", VIEW = "tasks-thread-browser-view";
const BEAT_MS = 2000;

const nameOf = (key) => key.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-/, "").replace(/-$/, "");
const root = () => dirs().browser;

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const hit = find(c, id); if (hit) return hit; }
  return null;
}

// The Browser column as it should be: the viewer's terminal shown (addr), or this mod alone.
function arrange(tree, addr) {
  const col = find(tree, BROWSER);
  if (!col) throw new Error("This layout has no task browser.");
  const host = { id: HOST, type: "block", content: { mod: "task-browser" }, ...(addr ? { hidden: true } : {}) };
  col.type = "column";
  delete col.content;
  col.children = addr ? [host, { id: VIEW, type: "block", content: { terminal: addr } }] : [host];
}

// One edit of the layout's file, only if it's unchanged since read (else read again); then Herdr
// reads it (under a second).
async function pointView(addr, cx) {
  const path = `${appHome()}/layouts/${shared("layout")}.json`;
  for (let i = 0; ; i++) {
    const text = await readTextFile(path);
    const tree = JSON.parse(text ?? "null");
    const want = addr ?? null, has = find(tree, VIEW)?.content?.terminal ?? null;
    if (has === want && find(tree, BROWSER)?.type === "column") return;
    arrange(tree, addr);
    try { await writeTextFile(path, JSON.stringify(tree, null, 2), text); break; }
    catch (e) { if (i >= 2) throw e; }
  }
  for (let i = 0; i < 30 && (find(layout(), VIEW)?.content?.terminal ?? null) !== (addr ?? null); i++) await new Promise((r) => cx.timer.after(100, () => r()));
}

export default class TaskBrowser extends View {
  init(_props, cx) {
    this.key = null;        // the task whose viewer runs (or is starting)
    this.addr = null;       // the viewer's terminal
    this.state = "idle";    // idle | starting | live | error
    this.why = "";
    this.busy = false;
    this.failedAt = 0;
    cx.timer.every(BEAT_MS, (cx) => this.tick(cx));
  }

  async close() {
    if (this.addr) await hc(["kill", this.addr]).catch(() => {});
  }

  // The shown task's key and worker, or why there's none here. From the shown worker itself
  // (shared "tasks.thread"), not where(), which is briefly empty each time the header reads the task.
  target() {
    const addr = shared("tasks.thread")?.terminal;
    if (!addr) return { why: null };
    if (addr.includes("/")) return { why: `This task runs on ${addr.split("/")[0]}. Its browser can be watched only from that machine's Herdr for now.` };
    const key = terminals().find((k) => k.address === addr)?.labels?.["herdr.task"];
    return key ? { key, worker: addr } : { why: null };
  }

  // Every 2 s, and at once when it shows: the viewer for the shown task, or none.
  tick(cx) {
    const tg = shown(BROWSER) ? this.target() : { why: null };
    if (!tg.key && this.state === "idle" && (tg.why ?? "") !== this.why) { this.why = tg.why ?? ""; cx.notify(); }
    if (this.busy) return;
    if (this.addr && this.key === tg.key) {
      const k = terminals().find((x) => x.address === this.addr);
      if (k && k.state === "live") return void exec("touch", [`${root()}/${nameOf(this.key)}.view`]).catch(() => {});
      // It ended by itself (or failed): started again, not more than every 10 s.
      this.addr = null;
      this.state = "error";
      this.why = "The live view stopped. Starting it again…";
      this.failedAt = Date.now();
      cx.notify();
    }
    if (this.addr || (this.key && !tg.key)) return this.stop(cx);
    if (tg.key && Date.now() - this.failedAt > 10000) this.start(tg, cx);
  }

  start(tg, cx) {
    this.busy = true;
    this.key = tg.key;
    this.state = "starting";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await exec("mkdir", ["-p", root()]);
        await exec("touch", [`${root()}/${nameOf(tg.key)}.view`]);
        const r = await hc(["run", "--bg", "--json", "--cwd", home(), "--label", `herdr.browser-view=${nameOf(tg.key)}`,
          "--", `${appHome()}/bin/herdr-browser-view`, "--task", tg.key, "--worker", tg.worker]);
        const addr = JSON.parse(r.stdout || "{}")?.address;
        if (r.code !== 0 || !addr) throw new Error((r.stderr || r.stdout).trim().split("\n")[0] || "The live view didn't start.");
        this.addr = addr;
        await pointView(addr, cx);
        this.state = "live";
        this.why = "";
      } catch (e) {
        this.state = "error";
        this.why = String(e?.message ?? e);
        this.failedAt = Date.now();
        if (this.addr) { hc(["kill", this.addr]).catch(() => {}); this.addr = null; }
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  // Hidden, or another task shows: the viewer ends and the column shows this mod again.
  stop(cx) {
    const addr = this.addr;
    this.busy = true;
    this.addr = null;
    this.key = null;
    this.state = "idle";
    cx.spawn(async (cx) => {
      try {
        if (addr) { await hc(["kill", addr]).catch(() => {}); hc(["rm", addr]).catch(() => {}); }
        await pointView(null, cx);
      } catch {}
      this.busy = false;
      cx.notify();
    });
  }

  render(cx) {
    const t = theme();
    // Shown now: it looks at once rather than at the next tick.
    if (shown(BROWSER) && !this.addr && !this.busy && !this.kick && this.target().key) {
      this.kick = true;
      cx.timer.after(0, (cx) => { this.kick = false; this.tick(cx); });
    }
    const line = this.state === "starting" ? "Starting the live view…"
      : this.state === "error" ? this.why
      : this.why || "Pick a task to see its browser.";
    return v_flex().id("task-browser").size_full().min_h(0).items_center().justify_center().px(24).gap(10)
      .bg(t.background).text_size(12.5).text_color(t.dim)
      .child(div().text_center().max_w(380).child(line));
  }
}
