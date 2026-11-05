import { expect, test } from "bun:test";
import { spaceMenu, addMenu, machineMenu, sectionMenu, taskMenu, machineLabel, tabMenu, appMenu, assistantRow, agentChoices, agentHint, tabName, endAgent, NEW_MENU, SWITCH_AGENT } from "./menus.js";

const words = (list) => list.map((x) => (x.sep ? "—" : x.label));

test("a space's menu is the window's: Notify, Mark as read when unread, Pin, Rename, Space settings, worktrees, Close", () => {
  expect(words(spaceMenu())).toEqual(["Notify", "—", "Pin", "Rename…", "Space settings…", "—", "Close…"]);
  expect(words(spaceMenu({ unread: true, pinned: true, git: "linked" }))).toEqual(
    ["Notify", "—", "Mark as read", "Unpin", "Rename…", "Space settings…", "—", "New worktree", "Open worktree", "Remove worktree", "—", "Close…"]);
  expect(words(spaceMenu({ git: "main" }))).not.toContain("Remove worktree");
  // Notify's quiet note under its choices, the same in the window's menu and the web's
  expect(spaceMenu()[0].note).toBe("Tasks alert either way.");
  // a space with no Assistant's tab yet (any machine) offers to start one, first after Notify
  expect(words(spaceMenu({ assistant: false })).slice(0, 4)).toEqual(["Notify", "—", "Start Assistant", "Pin"]);});

test("the sidebar's other menus and a task row's", () => {
  expect(words(addMenu())).toEqual(["New space", "New section"]);
  expect(words(machineMenu())).toEqual(["Rename…"]);
  expect(words(sectionMenu())).toEqual(["Rename…", "Delete"]);
  expect(words(taskMenu())).toEqual(["Pin"]);
  expect(words(taskMenu({ pinned: true }))).toEqual(["Unpin"]);
  // SHEP-38: a task not started yet starts later; a scheduled one is rescheduled, started now or unscheduled
  const later = (m) => m.map((x) => x.sep ? "—" : x.heading ? `# ${x.heading}` : x.label);
  expect(later(taskMenu({ status: "todo" }))).toEqual(["# Start later", "In 1 hour", "In 3 hours", "Tomorrow 9:00", "Monday 9:00", "Other time…", "—", "Pin"]);
  expect(later(taskMenu({ status: "scheduled", pinned: true }))).toEqual(["# Reschedule", "In 1 hour", "In 3 hours", "Tomorrow 9:00", "Monday 9:00", "Other time…", "—", "Start now", "Unschedule", "—", "Unpin"]);
  expect(later(taskMenu({ status: "working" }))).toEqual(["Pin"]);
  expect(machineLabel(null)).toBe("This computer");
  expect(machineLabel("vm", "Build box")).toBe("Build box");
});

test("a tab's menu (the tab bar's): Rename…, Edit instructions… on an Assistant's, Switch agent, Restart, then Close tab", () => {
  expect(words(tabMenu())).toEqual(["Rename…", "—", "Close tab"]);
  expect(words(tabMenu({ assistant: true, switchable: true, restartable: true }))).toEqual(
    ["Rename…", "Edit instructions…", "Switch agent", "Restart", "—", "Close tab"]);
  expect(SWITCH_AGENT).toEqual({ title: "Switch agent", loading: "Checking installed agents…", current: "Current" });
});

test("the + menu's words: the Assistant's row, the agents it offers, and a tab's name", () => {
  expect(assistantRow({ open: true })).toEqual({ label: "Show Assistant", hint: "", enabled: true });
  expect(assistantRow()).toEqual({ label: "Assistant", hint: "C", enabled: true });
  // another machine's space starts its Assistant there, as here (SHEP-8)
  expect(assistantRow({ remote: true })).toEqual({ label: "Assistant", hint: "C", enabled: true });
  const list = agentChoices([{ key: "a", installed: false }, { key: "b", installed: true }, { key: "c", installed: false }, { key: "d", installed: false }]);
  expect(list.map((a) => a.key)).toEqual(["b", "a", "c"]);
  expect(list.map(agentHint)).toEqual(["1", "Not installed", "Not installed"]);
  expect(NEW_MENU.agents).toBe("Start an agent");
  expect(tabName("tb3", "Claude Code")).toBe("Claude Code");
  expect(tabName("", null)).toBe("Terminal");
  expect(tabName("Build")).toBe("Build");
  expect(endAgent("Codex")).toEqual({ ask: "End Codex?", tip: "End Codex", cancel: "Cancel", verb: "End agent" });
});

test("the app menu: New space, Keybinds, then the window's themes", () => {
  expect(words(appMenu())).toEqual(["New space", "—", "Keybinds", "—", "Theme: Graphite", "Theme: Ink", "Theme: Moss", "Theme: Atom One Dark"]);
});
