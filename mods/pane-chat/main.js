// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "pane-chat" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.
//
// Agent panes (Claude Code, Codex) also get a Chat / Terminal switch. Chat puts the `chat`
// mod in the agent pane's exact spot: it splits beside the agent's pane, then the agent's
// terminal is parked (it keeps running, without a pane), so the chat takes the whole slot and
// every other pane stays as it was. Terminal does the reverse: the terminal gets a pane
// beside the chat again and the chat closes. Parking turns core keep off; the chat turns it
// back on. Each swap's last step removes the pane this header is on, so it goes last.
// Which chat shows which agent is the agent's core label herdr.chat=<chat pane>: every screen
// sees it, and the agents list, tab bar, spaces and status bar read it (chat/parked.js).

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, run, theme, home, exec, hc, notify, nextCommand, shared, setShared } from "herdr";
import { panes, terminals, spaces, inRender } from "./live.js";
import { spaceName } from "./core/spaces.js";
import { apSpace, apWatch, apPoll, apGroup, apHeartbeatLink, COMPACT_BELOW } from "./autopilot.js";
import { button as uiButton, segmented, TEXT, RADIUS, toast, plainError } from "./ui.js";
import { on as addonOn } from "./addons.js";
// "End Claude Code?" and its buttons: core/menus.js (the web app's header asks in the same words).
import { endAgent } from "./core/menus.js";

const CHAT = "chat";
const LABEL = "herdr.chat";
// When a toggle last swapped a pane (every copy of this build shares it).
let lastSwap = 0;

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

// Chat reads Claude Code's and Codex's own session logs; other agents have no chat.
const chatty = (p) => Boolean(p?.terminal) && (["claude-code", "codex"].includes(p.app) || ["claude", "codex"].includes(p.program?.key));

const chatPanes = () => new Set(panes().filter((p) => p.mod === CHAT).map((p) => p.pane));
// The chat pane showing a terminal, if one is open.
function chatOf(terminal) {
  const c = terminals().find((x) => x.address === terminal)?.labels?.[LABEL];
  return c && chatPanes().has(c) ? c : null;
}
// A Coordinator tab's chat with no agent yet (mods/coordinator records it in shared
// "coordinator.slots"): it has the switch too; Terminal starts its agent first (mods/chat).
const lazySlot = (pane) => Object.values(shared("coordinator.slots") ?? {}).find((r) => r?.pane === pane) ?? null;

// The agent a chat pane shows.
const agentOf = (chat) => terminals().find((x) => x.labels?.[LABEL] === chat && x.state === "live")?.address ?? null;

// One app command, waited for (the swap's steps must go in order).
async function app(name, args) {
  const r = await exec("herdr-app", ["do", name, ...Object.entries(args).flatMap(([k, v]) => [`--${k}`, typeof v === "string" ? v : JSON.stringify(v)])]);
  let out = {};
  try { out = JSON.parse(r.stdout || "{}"); } catch {}
  if (r.code !== 0 || out.error) throw new Error(out.error || r.stderr.trim() || `${name} failed`);
  return out;
}

// A parked agent, shown in a chat pane: what the header shows for it.
function parked(terminal) {
  const k = terminals().find((x) => x.address === terminal);
  if (!k) return null;
  const st = ["working", "blocked", "done", "idle"].includes(k.status) ? k.status : null;
  return { program: k.program, status: st, cwd: k.foreground?.cwd ?? k.cwd ?? null, title: k.title ?? "" };
}

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    // An Assistant's header: its Autopilot, looked at again now and then (the scheduler changes it).
    cx.timer.every(4000, (cx) => apPoll(this, cx));
    this.opening = false;
    // A copy just started (the swap's new pane) may still be handed the toggle that made it:
    // it would swap straight back. Toggles go to copies at least 2 s old, one swap per 3 s.
    this.born = Date.now();
    // "pane-chat.toggle" (a key, or `herdr-app do`): the focused pane switches.
    // At most 5 s per wait (one pending nextCommand), so a reload's old build ends at its next
    // cx use instead of staying in memory.
    cx.spawn(async (cx) => {
      let cmd = null;
      for (;;) {
        cmd ??= nextCommand();
        const c = await Promise.race([cmd, cx.sleep(5000)]);
        if (c === undefined) continue;
        cmd = null;
        const self = this.me();
        if (c !== "toggle" || !self?.focused) continue;
        if (Date.now() - this.born < 2000 || Date.now() - lastSwap < 3000) continue;
        lastSwap = Date.now();
        if (self.mod === CHAT) { if (agentOf(self.pane)) this.toTerminal(self.pane, cx); }
        else if (chatty(self)) this.toChat(self, cx);
      }
    });
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  // A 24 px icon button (split, zoom, close).
  button(t, id, icon, command, args, fn = null) {
    return h_flex()
      .id(id)
      .size(24)
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(RADIUS.control)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (fn) fn(cx); else run(command, args);
        cx.notify();
      })
      .child(svg(`mods/pane-chat/${icon}.svg`).size(14));
  }

  // Terminal → Chat: the chat takes this agent pane's spot.
  toChat(p, cx) {
    const open = chatOf(p.terminal);
    if (open) { run("pane.focus", { pane: open }); return; }
    if (this.busy) return;
    this.busy = true;
    const terminal = p.terminal;
    cx.spawn(async (cx) => {
      try {
        const out = await app("pane.split", { direction: "right", pane: p.pane, mod: CHAT, props: { terminal } });
        if (!out.pane) throw new Error("Herdr didn't open the chat");
        // The agent knows its chat: if that pane goes with its tab or space, the agents list
        // ends the agent (parked.js sweep), as closing its own pane would have.
        await hc(["label", terminal, `${LABEL}=${out.pane}`]);
        run("pane.focus", { pane: out.pane });
        // Last: parking removes this pane, and this header with it. The chat turns core keep
        // back on once the park has gone through (mods/chat).
        await app("terminal.park", { terminal });
      } catch (e) {
        toast({ title: "Chat didn't open", body: plainError(e), level: "error" });
      }
      this.busy = false;
      cx.notify();
    });
  }

  // Chat → Terminal: the agent's terminal gets a pane beside the chat, then the chat closes,
  // so the terminal is back in the same spot.
  toTerminal(chat, cx) {
    const terminal = agentOf(chat);
    const live = Boolean(terminal);
    // Not running, or still in a pane of its own (a chat opened beside it): just close the chat.
    const own = live && panes().find((x) => x.terminal === terminal);
    if (!live || own) {
      const zoomed = panes().find((x) => x.pane === chat)?.zoomed;
      run("pane.close", { pane: chat });
      if (terminal) hc(["label", terminal, `${LABEL}=`]);
      if (own) { if (zoomed && own.zoomed) run("pane.zoom", { pane: own.pane }); run("pane.focus", { pane: own.pane }); }
      return;
    }
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await app("pane.focus", { pane: chat });
        const out = await app("terminal.keep", { terminal, place: "right" });
        await hc(["label", terminal, `${LABEL}=`]);
        if (out.pane) run("pane.focus", { pane: out.pane });
        // Last: closing the chat removes this header too.
        await app("pane.close", { pane: chat });
      } catch (e) {
        toast({ title: "Terminal didn't come back", body: plainError(e), level: "error" });
      }
      this.busy = false;
      cx.notify();
    });
  }

  // A chat pane's ✕ does what an agent pane's does: ends the agent, and the pane goes. It asks
  // first, in the header itself ("End Claude Code?" End agent / Cancel): this.ending.
  closeChat(chat) {
    this.ending = false;
    const terminal = agentOf(chat);
    if (terminal) run("terminal.kill", { terminal });
    run("pane.close", { pane: chat });
  }

  // Chat | Terminal: the shared switch (ui.js segmented), as the task view's header has it.
  switcher(t, id, chatMode, onChat, onTerminal) {
    return segmented(id, [["chat", "Chat"], ["terminal", "Terminal"]], chatMode ? "chat" : "terminal",
      (v, _e, cx) => (v === "chat" ? onChat(cx) : onTerminal(cx)));
  }

  // One copy of Herdr's live lists for the whole render (live.js): past ~50 ms Herdr stops it.
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw(cx) {
    const t = theme();
    const self = this.me();
    if (!self) return div();
    // A chat pane wears its agent's header: same name, folder and status.
    const chatMode = self.mod === CHAT;
    const agent = chatMode ? agentOf(self.pane) : null;
    const entry = agent ? { terminal: agent } : null;
    const p = (entry && parked(entry.terminal)) ?? self;
    const lazy = chatMode && !entry && lazySlot(self.pane);
    // An artifact (mods/artifacts: mod "art-<id>") shows its title and version.
    const art = self.mod?.startsWith("art-") ? shared("artifacts.titles")?.[self.mod] ?? self.title : null;
    const prog = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "Shell";
    // An Assistant reads as its space ("tor-gameboy"), never its role or what it runs (SHEP-36: the composer's model
    // menu says which agent): the space's name, then its folder, quieter.
    const isAssistant = Boolean(lazy) || terminals().find((x) => x.address === (agent ?? self.terminal))?.labels?.["herdr.role"] === "coordinator";
    const space = isAssistant ? spaces().find((s) => s.tabs?.some((x) => x.id === self.tab)) : null;
    const name = art ?? (isAssistant ? spaceName(space, { home: home() }) : chatMode && p === self ? "Chat" : prog);
    const pic = art !== null ? svg("mods/artifacts/artifacts.svg").size(14).flex_none().text_color(t.dim) : icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = self.pane;
    const canSwitch = chatMode ? Boolean(entry) || Boolean(lazy) : chatty(self);
    // An Assistant (chat or terminal): its Autopilot switch on the right, before the hover buttons (none while the
    // Autopilot add-on is off).
    const apFor = addonOn("autopilot") ? apSpace(agent ?? (chatMode ? null : self.terminal), lazy || null) : null;
    apWatch(this, apFor, cx);
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(TEXT.label)
      .on_hover((hovered, cx) => { this.hovered = hovered; if (!hovered) this.ending = false; cx.notify(); })
      .on_size_change((size, cx) => { if (Math.round(size.width) !== this.width) { this.width = Math.round(size.width); cx.notify(); } })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().max_w(260).min_w(0).truncate().font_medium().text_color(t.foreground).child(name))
      // The folder gives way first; the switch keeps its width; the gap after pushes the rest right.
      .child(div().flex_shrink_1().min_w(0).truncate().text_color(t.dim).child(folder(p.cwd)))
      .child(div().flex_1())
      // The status in words, right-aligned with the controls: "Working…" with its spinner, "Needs you", nothing at
      // rest (done is the normal state, no mark).
      .when(st === "working", el => el.child(h_flex().flex_none().gap(6).items_center().text_color(t.muted)
        .child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900))
        .when((this.width ?? Infinity) >= COMPACT_BELOW, el => el.child(div().whitespace_nowrap().child("Working…")))))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(RADIUS.control).bg(t.blocked + "26").text_size(TEXT.id).font_semibold().text_color(t.blocked).child("Needs you")))
      // Autopilot sits with the other controls on the right, not mid-bar after the folder.
      .when(Boolean(apFor), (el) => el.child(apGroup(this, t, apFor, pane, (this.width ?? Infinity) < COMPACT_BELOW))
        .child(apHeartbeatLink(this, apFor, pane) ?? div()))
      // Ending a chat's agent asks first, in place of the hover buttons.
      .when(Boolean(entry) && this.ending === true, el => el
        .child(div().flex_none().whitespace_nowrap().text_color(t.foreground).child(endAgent(prog).ask))
        .child(uiButton(`ph-end-no-${pane}`, endAgent(prog).cancel, { kind: "plain", onClick: () => { this.ending = false; } }))
        .child(uiButton(`ph-end-${pane}`, endAgent(prog).verb, { kind: "primary", onClick: () => this.closeChat(pane) })))
      // Hover buttons come before the switch so Chat | Terminal never moves.
      .when(this.hovered && !(entry && this.ending === true), el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, self.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .when(!entry, el => el.child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })))
        .when(Boolean(entry), el => el.child(this.button(t, `ph-x-${pane}`, "close", null, null, () => { this.ending = true; }))))
      .when(canSwitch, (el) => el.child(this.switcher(t, `ph-mode-${pane}`, chatMode,
        (cx) => this.toChat(self, cx),
        // No agent yet: the chat starts it (no first message) and then shows its terminal.
        (cx) => (lazy && !agentOf(pane) ? setShared("chat.startreq", { pane, at: Date.now() }) : this.toTerminal(pane, cx)))));
  }
}
