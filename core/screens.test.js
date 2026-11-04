import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readScreen, ScreenWatch, starting, pressKeys, SCREEN } from "./screens.js";

const TRUST = [
  "Do you trust the files in this folder?",
  "",
  " ❯ 1. Yes, proceed",
  "   2. No, exit",
  "",
  "Enter to confirm · Esc to exit",
].join("\n");

describe("a CLI's start screen, read the same by the window and the service", () => {
  test("its words and choices, the cursor's one", () => {
    expect(readScreen(TRUST)).toEqual({ words: "Do you trust the files in this folder?", choices: [{ label: "Yes, proceed" }, { label: "No, exit" }], at: 0 });
    expect(pressKeys(0, 1)).toEqual(["down", "enter"]);
  });
  test("starting: live, no status, no turn, a CLI", () => {
    expect(starting({ state: "live", foreground: { name: "claude" } })).toBe(true);
    expect(starting({ state: "live", status: { state: "working" }, foreground: { name: "claude" } })).toBe(false);
  });
  test("two matching reads put a card up; a press on it presses the choice", async () => {
    const store = new Map();
    const sent = [];
    const io = { hc: async (a) => (a[0] === "read" ? { code: 0, stdout: TRUST } : (sent.push(a), { code: 0, stdout: "" })), cards: (x) => store.get(x) ?? [], save: (x, l) => store.set(x, l) };
    const w = new ScreenWatch(io);
    const k = { address: "t1", state: "live", foreground: { name: "claude" }, created_ms: 0 };
    await w.tick("t1", k, 100000);
    expect(store.get("t1")).toBeUndefined();
    await w.tick("t1", k, 102000);
    const card = store.get("t1")[0];
    expect(card).toMatchObject({ cli: "Claude Code", state: "open", choices: [{ label: "Yes, proceed" }, { label: "No, exit" }] });
    expect(await w.press(card, 0)).toBe(null);
    expect(sent).toEqual([["keys", "t1", "enter"]]);
    expect(store.get("t1")[0]).toMatchObject({ state: "answered", how: SCREEN.answered("Yes, proceed") });
  });
  test("the window's chat watches with this core", () => {
    expect(readFileSync(join(import.meta.dir, "..", "mods/chat/screens.js"), "utf8")).toContain('from "./core/screens.js"');
  });
});
