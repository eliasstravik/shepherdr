// The Settings window's menus that open over the page (the level switch's spaces, Secrets' For and Kept on) are drawn
// after the rows under them (GitHub #1002): drawn inside their own row, gpui painted the page's later rows over them,
// so the menu looked see-through and those rows' words showed in it. No window runs here: gpui is a stand-in that
// keeps each element's children in order (fake-gpui.ts).
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { element, fakeGpuiBase, fakeGpuiKit } from "./fake-gpui";

mock.module("gpui-kit", () => fakeGpuiKit());
mock.module("gpui-base", () => fakeGpuiBase());
const { over } = await import("../mods/shepherdr-settings/over.js");

const src = (f: string) => readFileSync(new URL(`../mods/shepherdr-settings/${f}`, import.meta.url), "utf8");

describe("Settings menus draw over the page (GitHub #1002)", () => {
  test("the menu is the last thing drawn, after every row under it", () => {
    const row = element(), a = element(), b = element(), menu = element();
    const col = over(row, [a, b], menu);
    expect(col.kids).toEqual([row, a, b, menu]);
    // measured from the row it opens from: that row is first in a relative column
    expect(col.calls.some(([n]: [string]) => n === "relative")).toBe(true);
  });

  test("closed: no menu", () => {
    const row = element(), a = element();
    expect(over(row, [a], null).kids).toEqual([row, a]);
  });

  test("the level switch's menu goes after the page's body, not inside its bar", () => {
    const main = src("main.js");
    expect(main).toContain("over(this.levelBar(t), [body], this.levelOpen");
    expect(main).not.toMatch(/\.when\(this\.levelOpen, \(el\) => el\.child\(this\.levelMenu\(t\)\)\)/);
  });

  test("Secrets' two menus go after the rows under them, not inside their own rows", () => {
    const sec = src("secrets-section.js");
    expect(sec).not.toMatch(/\.when\(s\.open, \(el\) => el\.child\(menu\)\)/);
    expect(sec).not.toMatch(/\.when\(s\.keptOpen, \(el\) => el\.child\(keptMenu\)\)/);
    expect(sec).toContain("], s.open ? menu : null)");
    expect(sec).toContain("], s.keptOpen ? keptMenu : null)");
  });
});
