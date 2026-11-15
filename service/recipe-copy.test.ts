// SHEP-228: in the window's recipe view (mods/artifacts/recipe-view.js), every code box has a Copy button that puts
// its whole text on the clipboard: a code block, and a fenced block inside a text, a list item or a callout. The window
// binds no copy key to a page's selected text, so a command an agent asks the person to run had to be retyped.
// No window runs here: the view is installed as herdr-artifact installs it (recipe-view.js, recipe.js, recipe-data.js
// and a stub artifact.js in one folder), gpui and herdr are stand-ins, and a click runs the button's real handler.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeHerdr } from "./fake-herdr";
import { built, byId, dispatch, element, fakeGpuiBase, fakeGpuiKit } from "./fake-gpui";

const theme = new Proxy({}, { get: () => "#000000" });
mock.module("herdr", () => fakeHerdr({ theme: () => theme }));
mock.module("gpui-kit", () => fakeGpuiKit());
const TextView = Object.assign(() => element("TextView"), { markdown: (_id: string, md: string) => element(`TextView:${md}`) });
mock.module("gpui-base", () => fakeGpuiBase({ TextView }));

const RECIPE = {
  recipe: 1,
  blocks: [
    { type: "code", id: "cmd", text: "herdr-task list\n  --all" },
    { type: "text", id: "t", md: "Run this:\n\n```sh\nbun install && bun run build\n```\n\nThen reload." },
    { type: "list", id: "l", items: ["Plain step", "Then:\n  ```\n  git pull --rebase\n  ```"] },
    { type: "callout", id: "c", tone: "warn", title: "Before you go", md: "~~~\nexport A=1\necho $A\n~~~" },
    { type: "text", id: "p", md: "Just words, with `inline code`." },
  ],
};

const dir = mkdtempSync(join(tmpdir(), "recipe-copy-"));
copyFileSync(join(import.meta.dir, "../mods/artifacts/recipe-view.js"), join(dir, "recipe-view.js"));
copyFileSync(join(import.meta.dir, "../mods/artifacts/core/recipe.js"), join(dir, "recipe.js"));
writeFileSync(join(dir, "recipe-data.js"), `export default ${JSON.stringify(RECIPE)};\n`);
writeFileSync(join(dir, "artifact.js"), "export const asset = (s) => s; export const reply = async () => true;\n");
const { default: RecipeView } = await import(join(dir, "recipe-view.js"));

let clipboard: string[] = [];
let timers: [number, (cx: any) => void][] = [];
const cx: any = new Proxy({
  write_to_clipboard: (s: string) => clipboard.push(s),
  timer: { after: (ms: number, f: (cx: any) => void) => timers.push([ms, f]) },
}, { get: (t, k) => (t as any)[k] ?? (() => {}) });

const draw = (v: any) => { built.length = 0; return v.render(cx); };
const copyIds = () => built.flatMap((e) => e.calls.filter(([n, a]: any) => n === "id" && String(a[0]).startsWith("copy-")).map(([, a]: any) => a[0]));
const label = (id: string) => byId(id)!.kids.filter((k: unknown) => typeof k === "string").pop();

describe("Copy buttons on code in the window's recipe view (SHEP-228)", () => {
  let v: any;
  beforeEach(() => { clipboard = []; timers = []; v = new RecipeView(); v.init({}, cx); draw(v); });

  test("every code box has one: a code block, and fences in a text, a list item and a callout", () => {
    expect(copyIds()).toEqual(["copy-cmd", "copy-t-c1", "copy-l-1-c1", "copy-c-c0"]);
  });

  test("a click copies the box's whole text, as written (the fence's indent and marks left out)", () => {
    for (const id of copyIds()) dispatch(byId(id)!, "on_click", cx);
    expect(clipboard).toEqual(["herdr-task list\n  --all", "bun install && bun run build", "git pull --rebase", "export A=1\necho $A"]);
  });

  test("the words around a fence still show as Markdown, and plain text is drawn as before", () => {
    const md = built.map((e) => e.kind).filter((k: string) => k.startsWith("TextView:"));
    expect(md).toContain("TextView:Run this:\n");
    expect(md).toContain("TextView:\nThen reload.");
    expect(md).toContain("TextView:Then:");
    expect(md).toContain("TextView:Just words, with `inline code`.");
    expect(md.some((k: string) => k.includes("```") || k.includes("~~~"))).toBe(false);
  });

  test("the button says Copied a moment, then Copy again; the click goes no further", () => {
    expect(label("copy-t-c1")).toBe("Copy");
    const ran = dispatch(byId("copy-t-c1")!, "on_click", cx);
    expect(ran.length).toBe(1);
    draw(v);
    expect(label("copy-t-c1")).toBe("Copied");
    expect(label("copy-cmd")).toBe("Copy");
    expect(timers.map(([ms]) => ms)).toEqual([1500]);
    timers[0][1](cx);
    draw(v);
    expect(label("copy-t-c1")).toBe("Copy");
  });

  test("an older box's timer doesn't clear a newer box's Copied", () => {
    dispatch(byId("copy-cmd")!, "on_click", cx);
    dispatch(byId("copy-c-c0")!, "on_click", cx);
    timers[0][1](cx);
    draw(v);
    expect(label("copy-c-c0")).toBe("Copied");
  });
});
