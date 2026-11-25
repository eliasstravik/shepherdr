import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readScreen, ScreenWatch, starting, pressKeys, SCREEN, screenText, trustOf, TRUST as TRUST_WORDS } from "./screens.js";

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
});

// #1441: Claude Code's folder-trust screen (its Enter on "No, exit" quits) and Codex's, read as a trust card's two
// choices wherever the cursor and the order are. Fake folders.
const CLAUDE_TRUST = [
  "Accessing workspace:",
  "",
  "/home/me/dev/shop",
  "",
  "Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source",
  "project, or work from your team). If not, take a moment to review what's in this folder first.",
  "",
  " ❯ 1. Yes, I trust this folder",
  "   2. No, exit",
  "",
  "Enter to confirm · Esc to cancel",
].join("\n");
const CODEX_TRUST = [
  "> You are in /home/me/dev/shop",
  "",
  "  Do you trust the contents of this directory? Working with untrusted contents comes with higher risk of prompt injection.",
  "",
  "› 1. Yes, continue",
  "  2. No, quit",
  "",
  "  Press enter to continue",
].join("\n");
const card = (text) => ({ ...readScreen(text), all: screenText(text) });

describe("#1441: a folder-trust screen", () => {
  test("Claude Code's: its Yes and No, and the folder it names", () => {
    expect(trustOf(card(CLAUDE_TRUST))).toEqual({ yes: 0, no: 1, folder: "/home/me/dev/shop" });
    expect(trustOf(card(TRUST))).toEqual({ yes: 0, no: 1, folder: null });
  });
  test("Codex's", () => {
    expect(trustOf(card(CODEX_TRUST))).toMatchObject({ yes: 0, no: 1 });
  });
  test("No first and the cursor on it: still the right choice each", () => {
    const flipped = CLAUDE_TRUST.replace(" ❯ 1. Yes, I trust this folder\n   2. No, exit", " ❯ 1. No, exit\n   2. Yes, I trust this folder");
    expect(trustOf(card(flipped))).toEqual({ yes: 1, no: 0, folder: "/home/me/dev/shop" });
  });
  test("any other start screen is no trust card", () => {
    const theme = "Choose the text style that looks best with your terminal\n\n ❯ 1. Dark mode\n   2. Light mode\n";
    expect(trustOf(card(theme))).toBeNull();
    expect(trustOf(null)).toBeNull();
  });
  test("its words say what waits and what trusting allows", () => {
    expect(TRUST_WORDS.waits("Claude Code", "/home/me/dev/shop")).toBe("Claude Code won't start in /home/me/dev/shop until you trust this folder.");
    expect(TRUST_WORDS.allows).toMatch(/project settings and hooks/);
    expect(TRUST_WORDS.yes).toBe("Trust this folder and start");
    expect(TRUST_WORDS.yesShort.length).toBeLessThanOrEqual(24);
  });
});
