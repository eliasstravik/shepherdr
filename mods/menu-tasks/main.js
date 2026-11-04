// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "global", target }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// a command "worktree" opens the worktree dialog instead.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, exec, knownAgents, window } from "herdr";
import { terminals, spaces, panes, inRender } from "./live.js";
import { TEXT, menuRow } from "./ui.js";
import { tabMenu, appMenu } from "./core/menus.js";
import { rectOf, besideRow, agentIn, coordinatorIn, isCoordinator, isCoordinatorTab, entryFor, restartAgent, closeTab, taskOf, switchTask, renameTab, renameSpace, closeSpace } from "./coordinator.js";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

function items(p, git, known) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      return [
        ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
        ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
        ["Zoom", "pane.zoom", { pane: tg.pane }],
        ...(term
          ? [
              toProgram
                ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
                : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
            ]
          : []),
        ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        ["Close pane", "pane.close", { pane: tg.pane }],
      ];
    }
    case "tab": {
      // An agent tab can restart, or switch to another agent; a coordinator's also edits its role.
      // Restarting goes through this machine's core: agents here only.
      const agent = agentIn(tg.id)?.address.includes("/") ? null : agentIn(tg.id);
      const coord = coordinatorIn(tg.id);
      // A coordinator tab, with its agent or still waiting for the person's first message.
      const coordTab = isCoordinatorTab(tg.id);
      const restartable = agent && (taskOf(agent) || (coord ? !agent.labels?.["herdr.agent"] || entryFor(agent, known ?? []) : entryFor(agent, known ?? [])));
      // Its rows and words: core/menus.js's tabMenu (the web app's tab menu reads the same list).
      const does = {
        rename: ["tab.rename", { id: tg.id }],
        instructions: ["coordinator.edit", { tab: tg.id, terminal: coord?.address }],
        switch: ["coordinator.switch", { terminal: agent?.address }],
        restart: ["coordinator.restart", { terminal: agent?.address }],
        close: ["tab.close", { id: tg.id }],
      };
      return tabMenu({ assistant: coordTab, switchable: Boolean(agent && known?.some((a) => a.installed)), restartable: Boolean(restartable) })
        .filter((it) => !it.sep).map((it) => [it.label, ...does[it.id]]);
    }
    case "space":
      return [
        ["Rename\u2026", "space.rename", { id: tg.id }],
        ...(git ? [["New worktree", "worktree", { space: tg.id, action: "new" }], ["Open worktree", "worktree", { space: tg.id, action: "open" }]] : []),
        ...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []),
        ["Close\u2026", "space.close", { id: tg.id }],
      ];
    default:
      // Its rows and words: core/menus.js's appMenu (the web app's tab bar offers the same, but the themes).
      return appMenu().filter((it) => !it.sep).map((it) =>
        // The New space dialog (mods/newspace) on the shown space's machine, through the tab bar; our own keys list
        // (mods/keybinds): plain names, grouped (Herdr's help shows raw ids); Herdr's themes.
        it.id === "new-space" ? [it.label, "tabs-tasks.newspace", {}] : it.id === "keybinds" ? [it.label, "mod.open", { name: "keybinds" }] : [it.label, "app.theme", { name: it.theme }]);
  }
}

function menuIcon(command) {
  const own = { "mod.open": "mods/keybinds/keyboard.svg", "coordinator.edit": "mods/workspace-chrome/file-text.svg", "coordinator.switch": "mods/coordinator/arrow-left-right.svg", "coordinator.restart": "mods/coordinator/rotate-ccw.svg" }[command];
  if (own) return own;
  const name = command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command.endsWith(".new") || command === "tabs-tasks.newspace" ? "plus" : command === "worktree" ? "git-branch" : command === "app.help" ? "terminal" : command === "app.theme" ? "settings" : command === "pane.split" ? "panel-right" : command === "pane.zoom" ? "square" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  if (name === "coordinator.switch") return "\u203a";
  // Bound in this layout's keys, on the key New space has everywhere else.
  if (name === "tabs-tasks.newspace") return shortcut("space.new");
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? keyText(k.keys) : "";
}

// keys.json's "ctrl-shift-t" as the person reads it: "Ctrl+Shift+T" (⌃⇧T on macOS), as new-menu-tasks shows it.
function keyText(keys) {
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return keys.trim().split(/\s+/).map((stroke) => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map((m) => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter((m) => held.has(m)).map((m) => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.known = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    if (p?.tab === "tab")
      cx.spawn(async (cx) => {
        this.known = await knownAgents().catch(() => []);
        cx.notify();
      });
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i, cx) {
    const it = items(props(), this.git, this.known)[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    if (it[1].startsWith("coordinator.") || it[1] === "tab.close") this.agentAction(it[1], it[2]);
    // Our dialogs (the app's one footer), not Herdr's prompt and confirm.
    else if (it[1] === "tab.rename") renameTab(spaces().flatMap((s) => s.tabs).find((x) => x.id === it[2].id));
    else if (it[1] === "space.rename") renameSpace(it[2].id);
    else if (it[1] === "space.close") closeSpace(it[2].id);
    else if (it[1] === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    else run(it[1], it[2]);
  }

  agentAction(command, args) {
    const k = terminals().find((x) => x.address === args.terminal);
    if (command === "tab.close") closeTab(args.id);
    else if (command === "coordinator.edit") {
      // Beside the coordinator: the open instructions pane if there is one, else a new one.
      const open = panes().find((p) => p.tab === args.tab && p.mod === "coordinator");
      // An agent in Chat mode, or none yet: beside the tab's chat pane.
      const beside = panes().find((p) => p.terminal && p.terminal === args.terminal) ?? panes().find((p) => p.tab === args.tab && p.mod === "chat");
      if (open) run("pane.focus", { pane: open.pane });
      else run("pane.split", { direction: "right", pane: beside?.pane, mod: "coordinator", props: { view: "instructions" } });
    } else if (command === "coordinator.switch") {
      const n = (this.known ?? []).filter((a) => a.installed).length;
      // Beside the Switch agent row, as a submenu (clicked; from the keyboard: at the pointer).
      openOverlay({ mod: "coordinator", kind: "popup", width: 210, height: Math.min(420, 40 + n * 32),
        at: this.rowAt ? besideRow(this.rowAt, 236, 210, props()?.right) : "pointer", props: { view: "agents", terminal: args.terminal } });
    } else if (command === "coordinator.restart" && k && taskOf(k)) {
      switchTask(k);
    } else if (command === "coordinator.restart" && k) {
      // A coordinator started from the template restarts from it (edited instructions apply).
      const entry = k.labels?.["herdr.agent"] || !isCoordinator(k) ? entryFor(k, this.known ?? []) : null;
      restartAgent(k, entry?.run);
    }
  }

  // One copy of Herdr's live lists for the whole render (live.js): past ~50 ms Herdr stops it.
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw(cx) {
    const t = theme();
    const list = items(props(), this.git, this.known);
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(TEXT.body)
      .on_key_down((e, cx) => {
        this.rowAt = null; // a key chooses: no clicked row to open a submenu beside
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && (it[1].endsWith(".close") || it[0] === "Keybinds" || (it[1] === "app.theme" && list[i - 1][1] !== "app.theme")), el => el.child(div().mx(8).my(4).h(1).bg(t.border)))
            // lib/ui.js's 32 menu row; the keyboard's row is selected too.
            .child(menuRow(`mi-${i}`, it[0], { icon: menuIcon(it[1]), hint: shortcut(it[1], it[2]), onClick: (_e, cx) => this.choose(i, cx) })
              .on_mouse_down("left", (e) => { this.rowAt = rectOf(e); })
              .when(i === this.at, (el) => el.bg(t.selected))),
        ),
      );
  }
}
