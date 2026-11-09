// A voice call's screen in the Herdr window (SHEP-51, core/screen.js): the voice agent's fallback for what its
// Shepherdr tools can't do, as the web page's (web/plugins/voice/screen.ts) but with what a mod can reach. A mod can't
// read another mod's drawing, so the window's screen is its frame, read from Herdr: the spaces, the shown space's tabs,
// the side panel's tabs (Files, Changes, Tasks, Artifacts) and an open task's tabs (Chat, Terminal, Pull request,
// Artifacts, Browser), the call's own chat (scrolled
// here), and a few of the window's commands (Settings, Keybinds, Jump, next and previous tab or space). Each is a
// numbered thing the voice agent can click. Not reachable from here (said in the answer): what is drawn inside a
// mod (a list's rows, a dialog's buttons, Settings' pages), closing another mod's overlay, typing into another mod's
// box, and keys.
// A ref stays with its thing for the whole call (reset at its start).

import { run, layout, shared } from "herdr";
import { spaces, panes } from "./live.js";
import { screenText, screenParams, risky } from "./core/screen.js";
import { backToTasks, requestWorkerTerminal, STACK as TASKS, LIST as TASK_LIST, THREAD, BODY, CHAT, TERM, PR, ARTIFACTS, BROWSER } from "./panel.js";

const PANELS = [["files", "Files"], ["changes", "Changes"], [TASKS, "Tasks"], ["artifacts", "Artifacts"]];
const THREAD_TABS = [[CHAT, "Chat"], [TERM, "Terminal"], [PR, "Pull request"], [ARTIFACTS, "Artifacts"], [BROWSER, "Browser"]];
const COMMANDS = [
  ["app.settings", "Settings", null], ["mod.open", "Keybinds", { name: "keybinds" }], ["mod.open", "Jump to a space, task or artifact", { name: "jump" }],
  ["tab.next", "Next tab", null], ["tab.prev", "Previous tab", null], ["space.next", "Next space", null], ["space.prev", "Previous space", null],
];
export const GAPS = "In the window the screen lists its frame only: what is inside a panel or dialog (a list's rows, Settings' pages) can't be read or pressed from a call, a dialog can't be closed, nor keys typed.";

const find = (node, id) => {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const hit = find(c, id); if (hit) return hit; }
  return null;
};

export class CallScreen {
  /** chat: the call's own chat view (its scroll, its name) */
  constructor(chat) { this.chat = chat; this.reset(); }

  reset() { this.seq = 0; this.refs = new Map(); this.things = new Map(); }

  ref(key, thing) {
    let r = this.refs.get(key);
    if (!r) { r = `e${++this.seq}`; this.refs.set(key, r); }
    this.things.set(r, thing);
    return r;
  }

  /** what the window shows now: { head, nodes } for core/screen.js screenText */
  read() {
    this.things = new Map();
    const tree = layout();
    const nodes = [];
    const add = (key, n, act) => nodes.push({ ...n, ref: this.ref(key, { ...n, act }) });
    const shown = spaces().find((s) => s.active);
    nodes.push({ ref: "", role: "heading", name: "Spaces", level: 2 });
    for (const s of spaces().slice(0, 40)) add(`space:${s.id}`, { role: "button", name: `${s.name ?? s.id}${s.machine ? ` on ${s.machine}` : ""}`, selected: !!s.active, depth: 1 }, () => run("space.select", { id: s.id }));
    if (shown) {
      nodes.push({ ref: "", role: "heading", name: `${shown.name ?? shown.id}'s tabs`, level: 2 });
      for (const t of shown.tabs ?? []) {
        const program = panes().find((p) => p.tab === t.id)?.program?.name;
        add(`tab:${t.id}`, { role: "tab", name: t.name || program || "Tab", selected: !!t.active, depth: 1 }, () => run("tab.select", { id: t.id }));
      }
    }
    const panel = find(tree, "panel"), body = find(tree, "panel-body");
    const open = !!panel && !panel.hidden;
    nodes.push({ ref: "", role: "heading", name: `Side panel${open ? "" : " (hidden)"}`, level: 2 });
    for (const [id, name] of PANELS) {
      if (!find(tree, id)) continue;
      add(`panel:${id}`, { role: "tab", name, selected: open && body?.active === id, depth: 1 }, () => { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); });
    }
    add("panel:toggle", { role: "button", name: open ? "Hide the side panel" : "Show the side panel", depth: 1 }, () => run(open ? "layout.hide" : "layout.show", { id: "panel" }));
    if (open && body?.active === TASKS && find(tree, TASKS)?.active === THREAD) {
      add("thread:back", { role: "button", name: "Back to the task list", depth: 1 }, () => backToTasks());
      const shownTab = find(tree, BODY)?.active;
      for (const [id, name] of THREAD_TABS) if (find(tree, id)) add(`thread:${id}`, { role: "tab", name: `Task's ${name}`, selected: shownTab === id, depth: 1 }, () => {
        const term = shared("tasks.thread")?.terminal;
        if (id === TERM && term) requestWorkerTerminal(term);
        run("layout.select", { stack: BODY, child: id });
      });
    }
    if (open && body?.active === "artifacts" && find(tree, "artifacts")?.active === "artifacts-view")
      add("artifact:back", { role: "button", name: "Back to the artifacts list", depth: 1 }, () => run("layout.select", { stack: "artifacts", child: "artifacts-list" }));
    nodes.push({ ref: "", role: "heading", name: "The call's chat", level: 2 });
    add("chat:scroll", { role: "scroll", name: "the call's chat", depth: 1, scroll: this.chat?.scrollWords?.() ?? "" }, null);
    nodes.push({ ref: "", role: "heading", name: "Commands", level: 2 });
    for (const [cmd, name, args] of COMMANDS) add(`cmd:${name}`, { role: "button", name, depth: 1 }, () => (args ? run(cmd, args) : run(cmd)));
    const shows = [shown ? `the ${shown.name ?? shown.id} space` : "", open ? `its ${PANELS.find(([id]) => id === body?.active)?.[1] ?? "side"} panel` : ""].filter(Boolean).join(", ");
    return { head: { app: "the Herdr window", shows }, nodes };
  }

  text(find = "") {
    const { head, nodes } = this.read();
    return `${screenText({ head, nodes, find })}\n${GAPS}`;
  }

  /** one action: { ok, did?, why?, ask?, screen } */
  act(p) {
    const q = screenParams(p);
    const after = (did) => ({ ok: true, did, screen: this.text(q.find) });
    const no = (why) => ({ ok: false, why, screen: this.text(q.find) });
    if (q.error) return no(q.error);
    if (q.do === "look") return { ok: true, screen: this.text(q.find) };
    if (q.do === "back" || q.do === "close") {
      // the panel's own Back first (a task's or artifact's), then (close) the panel itself; an overlay (Settings, a
      // dialog) is another mod's, which a call can't close
      const tree = layout();
      const body = find(tree, "panel-body"), panel = find(tree, "panel");
      if (panel && !panel.hidden && body?.active === TASKS && find(tree, TASKS)?.active === THREAD) { backToTasks(); return after("Back to the task list"); }
      if (panel && !panel.hidden && body?.active === "artifacts" && find(tree, "artifacts")?.active === "artifacts-view") { run("layout.select", { stack: "artifacts", child: "artifacts-list" }); return after("Back to the artifacts list"); }
      if (q.do === "close" && panel && !panel.hidden) { run("layout.hide", { id: "panel" }); return after("Hid the side panel"); }
      return no("nothing is open to close or go back from that the window lets a call reach");
    }
    if (q.do === "scroll") {
      if (q.ref && this.things.get(q.ref)?.role !== "scroll") return no("only the call's chat scrolls from a call in the window");
      const did = this.chat?.scrollBy?.(q.direction);
      return did ? after(did) : no("the call's chat isn't on screen");
    }
    if (q.do === "type" || q.do === "select" || q.do === "key") return no(`the window can't ${q.do === "key" ? "press keys" : q.do} from a call: ${GAPS}`);
    const thing = this.things.get(q.ref) ?? (this.read(), this.things.get(q.ref));
    if (!thing || !thing.act) return no(`${q.ref} isn't on the screen any more: here is what is`);
    if (risky(thing.name) && !q.confirmed) return { ok: false, ask: `Press ${thing.name}?`, screen: "" };
    thing.act();
    return after(`Pressed ${thing.role} "${thing.name}"`);
  }
}
