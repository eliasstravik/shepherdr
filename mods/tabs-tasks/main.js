import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, run, openOverlay, theme, window, shared, setShared, layout, settings, nextCommand, readTextFile, appHome, home } from "herdr";
import { spacesWithChats as spaces, sweep } from "./parked.js";
import { agentIn, isCoordinatorTab, closeTab, watchNewSpaces, newSpace, openCoordinator, renameTab, renameSpace } from "./coordinator.js";
import { startTick, tickOnChange } from "./tick.js";
import { startInbox, count as inboxCount, countsByTab, readyCount, readyByTab, showInbox, toAlert } from "./inbox.js";
import { serveRemote } from "./secrets.js";
import { watchService } from "./service.js";
import { startBridge } from "./bridge.js";
import { countBadge, H, TEXT, RADIUS } from "./ui.js";
import { on as addonOn } from "./addons.js";
import { watchViews } from "./usage.js";
// A tab's name (what runs in it while Herdr named it): core/menus.js, as the web app's tab bar names it.
import { tabName } from "./core/menus.js";
import { inRender } from "./live.js";
import { dirsReady } from "./dirs.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    // Agents parked behind a chat whose tab or space closed end, as their pane would have (the
    // Agents list did this; the layout has none now).
    cx.timer.every(5000, () => sweep());
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    // Shepherdr's service, which does the background work while it runs (lib/service.js).
    watchService(cx);
    // The person's pins, sidebar sections, icons and Notify, in step with the web app (lib/bridge.js).
    startBridge(cx);
    // Tasks' queue and merge watcher (mods/tasks owns it): left to the service while it runs.
    startTick(cx);
    // What needs the person, for Tasks' "Needs you" and the red counts (inbox.js).
    startInbox(cx);
    // Usage insights (lib/usage.js, the insights add-on): the space and tab shown, and the time on each.
    watchViews(cx);
    // The add-ons switched off (lib/addons.js): Everywhere's "off" in ~/.config/shepherdr/settings.json, as
    // the settings window last saved it (or pushed it here), into shared state the mods read.
    dirsReady().then((d) => readTextFile(d.settings)).then((s) => {
      const list = JSON.parse(s ?? "{}")?.everywhere?.off;
      const want = Array.isArray(list) ? list : [];
      if (JSON.stringify(want) !== JSON.stringify(shared("addons.off") ?? [])) setShared("addons.off", want);
    }).catch(() => {});
    // Ctrl+Shift+W comes here so a coordinator with live workers asks first, like its x.
    // At most 5 s per wait (one pending nextCommand), so a reload's old build ends at its next
    // cx use instead of staying in memory.
    cx.spawn(async (cx) => {
      let cmd = null;
      for (;;) {
        cmd ??= nextCommand();
        const c = await Promise.race([cmd, cx.sleep(5000)]);
        if (c === undefined) continue;
        cmd = null;
        const tab = spaces().find(s => s.active)?.tabs.find(t => t.active);
        if (c === "close" && tab) closeTab(tab.id);
        // F2 / Shift+F2 (keys.json): our Rename dialogs for the shown tab and space.
        if (c === "rename-tab" && tab) renameTab(tab);
        if (c === "rename-space") { const sp = spaces().find(s => s.active); if (sp) renameSpace(sp.id); }
        // Ctrl+Shift+N: the New space dialog, on the shown space's machine.
        if (c === "newspace") newSpace(spaces().find(s => s.active));
        // This computer's + in the Spaces sidebar: the dialog here, whatever space is shown.
        if (c === "newspace-local") newSpace(null);
        // A machine's New space in the Spaces sidebar: the dialog there (shared "newspace.on" =
        // { machine, at }, null machine: this computer). A script's way: data/newspace-on.json
        // ({ machine }).
        if (c === "newspace-on") {
          let on = shared("newspace.on");
          if (!on || Date.now() - on.at >= 10000) {
            try { on = { ...JSON.parse(await readTextFile(`${appHome()}/data/newspace-on.json`) ?? "null"), at: Date.now() }; } catch { on = null; }
          }
          newSpace(on?.machine ? { machine: on.machine } : null);
        }
        // A space's coordinator tab, opened (a script's way to the + menu's Coordinator): the space
        // in data/coordinator-openreq.json ({ space }), else the shown one.
        if (c === "coordinator") {
          let id = null;
          try { id = JSON.parse(await readTextFile(`${appHome()}/data/coordinator-openreq.json`) ?? "null")?.space ?? null; } catch {}
          const s = spaces().find(s => (id ? s.id === id : s.active));
          if (s) openCoordinator(s, true);
        }
        // A toast's "needs you": the Tasks panel, on its Active tab.
        if (c === "inbox") showInbox();
        // An agent's alert (herdr-task alert), clicked: "alert-<terminal>" ("~" for "/"), to that agent (inbox.js).
        if (c.startsWith("alert-")) toAlert({ terminal: c.slice(6).replace(/~/g, "/") });
      }
    });
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        // The Inbox panel is gone: a space that had it open shows Tasks, where its items are.
        const stored = this.panels[space.id] === "inbox" ? "tasks" : this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  // One copy of Herdr's live lists for the whole render (live.js): past ~50 ms Herdr stops it.
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw(cx) {
    // Another machine's agent using a secret: answered from here (secrets.js, bin/herdr-secret serve).
    serveRemote();
    tickOnChange(cx);
    watchNewSpaces(spaces());
    const t = theme();
    const space = spaces().find(p => p.active);
    // A coordinator's tab is pinned first.
    const shown = [...(space?.tabs ?? [])].sort((a, b) => isCoordinatorTab(b.id) - isCoordinatorTab(a.id));
    // The tab menu's height: Rename, Close, and the rows the tab gets (menu-tasks): a coordinator
    // tab's Edit instructions, an agent's Switch agent and Restart.
    const menuHeight = (id) => 19 + 32 * (2 + (isCoordinatorTab(id) ? 1 : 0) + (agentIn(id) && !agentIn(id).address.includes("/") ? 2 : 0));
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(H.sm).flex_none().flex().items_center().justify_center().rounded(RADIUS.control).cursor_pointer().text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    // What needs the person, per tab (the Inbox's items), and Tasks' Ready: a red and a green
    // count on the tab. Shepherdr settings' "Red counts" off (shared "counts.red" false): none
    // here, nor on Tasks.
    const counts = shared("counts.red") !== false, greens = shared("counts.green") !== false;
    const needs = counts ? countsByTab() : new Map(), readies = greens ? readyByTab() : new Map();
    // Its "Tab bar" off (shared "tabbar.tabs" false): the bar keeps +, the panels and the window's
    // buttons (and its background work), without the tabs.
    const tabsShown = shared("tabbar.tabs") !== false;
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = tabName(c.name, program?.name);
      return h_flex().id(`tab-${c.id}`).h(H.sm).px(8).gap(6).rounded(RADIUS.control).items_center().flex_none().text_size(TEXT.body)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) renameTab(c); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu-tasks", kind: "popup", width: 236, height: menuHeight(c.id), props: { tab: "tab", target: { id: c.id, space: space.id }, right: this.right } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(needs.get(c.id) > 0 || readies.get(c.id) > 0, el => el.child(countBadge(needs.get(c.id), readies.get(c.id), c.active ? t.raised : t.chrome)))
        .when(!(needs.get(c.id) > 0 || readies.get(c.id) > 0) && (c.status === "blocked" || c.status === "done"), el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).cursor_pointer().text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); closeTab(c.id); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    // Tasks and Artifacts are offered (Artifacts unless its add-on is off), beside whichever of
    // Files and Changes are on.
    const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "tasks", ...(addonOn("artifacts") ? ["artifacts"] : [])];
    this.syncPanel(space, panel, body, enabled);
    // The side panels' buttons, one style for all: icon first; the label when the bar has room
    // (the open one keeps its label); a count after the icon (Tasks': what needs the person, red,
    // and what's Ready, green: [need, ready]).
    const roomy = (this.width ?? 0) >= 1100;
    const panelButton = (id, label, icon, [need, ready] = [0, 0]) => {
      const badge = need + ready;
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(H.sm).pl(5).pr(roomy || on || badge ? 8 : 5).gap(5).flex_none().items_center().rounded(RADIUS.control)
        .text_size(TEXT.label).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .cursor_pointer().hover(s => s.bg(on ? t.selected : t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14).flex_none())
        .when(roomy || on, el => el.child(label))
        .when(badge > 0, el => el.child(countBadge(need, ready, on ? t.selected : t.chrome)));
    };
    return h_flex().id("tabs-bar").size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_size_change((size, cx) => { this.width = size.width; cx.notify(); })
      .on_mouse_up("left", () => { this.pressed = null; })
      // The bar runs to the window's right edge: menus opened from it place their submenus by it.
      .on_mouse_move((e) => { this.right = e.position.x - e.local_position.x + e.bounds.width; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(tabsShown ? shown.map(item) : []))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu-tasks", kind: "popup", width: 250, height: 543, props: { right: this.right } })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .child(panelButton("tasks", "Tasks", "mods/tasks/tasks.svg", [counts ? inboxCount() : 0, greens ? readyCount() : 0]))
      .when(enabled.includes("artifacts"), el => el.child(panelButton("artifacts", "Artifacts", "mods/artifacts/artifacts.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs-tasks/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs-tasks/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs-tasks/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
