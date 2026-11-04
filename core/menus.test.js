import { expect, test } from "bun:test";
import { spaceMenu, addMenu, machineMenu, sectionMenu, taskMenu, machineLabel } from "./menus.js";

const words = (list) => list.map((x) => (x.sep ? "—" : x.label));

test("a space's menu is the window's: Notify, Mark as read when unread, Pin, Rename, Space settings, worktrees, Close", () => {
  expect(words(spaceMenu())).toEqual(["Notify", "—", "Pin", "Rename…", "Space settings…", "—", "Close…"]);
  expect(words(spaceMenu({ unread: true, pinned: true, git: "linked" }))).toEqual(
    ["Notify", "—", "Mark as read", "Unpin", "Rename…", "Space settings…", "—", "New worktree", "Open worktree", "Remove worktree", "—", "Close…"]);
  expect(words(spaceMenu({ git: "main" }))).not.toContain("Remove worktree");
});

test("the sidebar's other menus and a task row's", () => {
  expect(words(addMenu())).toEqual(["New space", "New section"]);
  expect(words(machineMenu())).toEqual(["Rename…"]);
  expect(words(sectionMenu())).toEqual(["Rename…", "Delete"]);
  expect(words(taskMenu())).toEqual(["Pin"]);
  expect(words(taskMenu({ pinned: true }))).toEqual(["Unpin"]);
  expect(machineLabel(null)).toBe("This computer");
  expect(machineLabel("vm", "Build box")).toBe("Build box");
});
