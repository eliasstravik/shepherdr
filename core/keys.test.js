import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { grouped, keyText, keyFound, flatKeys, WEB_KEYS, NAMES } from "./keys.js";

const repoKeys = JSON.parse(readFileSync(new URL("../keys.json", import.meta.url), "utf8"));

test("keys as people read them, as the window's Keybinds shows them", () => {
  expect(keyText("ctrl-shift-k")).toBe("Ctrl+Shift+K");
  expect(keyText("alt-left")).toBe("Alt+Left");
  expect(keyText("ctrl--")).toBe("Ctrl+-");
  expect(keyText("alt-escape")).toBe("Alt+Esc");
  expect(keyText("ctrl-shift-k", true)).toBe("⌃⇧K");
});

test("Shepherdr's keys.json grouped: the layout's own key replaces the global one, Alt+1–9 folds, Chat is its own group", () => {
  const g = grouped(flatKeys(repoKeys), { layout: "BossGoat" });
  expect(g.map((x) => x.group)).toEqual(["Tabs", "Spaces", "Panes", "Terminal", "Chat", "App"]);
  const row = (group, name) => g.find((x) => x.group === group)?.rows.find((r) => r.name === name);
  expect(row("Tabs", "Show tab 1–9").keys).toEqual(["Alt+1–9"]);
  expect(row("Tabs", "Close tab").keys).toEqual(["Ctrl+Shift+W"]);
  expect(row("App", "Jump to a space, task or artifact").keys).toEqual(["Ctrl+K", "Ctrl+Shift+K"]);
  expect(row("App", "Keybinds").keys).toEqual(["Ctrl+Shift+/", "Ctrl+Shift+?"]);
  expect(row("Chat", "Find in the chat").keys).toEqual(["Ctrl+F"]);
});

test("the web's keys are the window's: each one bound the same in Shepherdr's keys.json or Herdr's defaults, every one named", () => {
  const herdr = { "alt-]": "tab.next", "alt-[": "tab.prev", "ctrl-shift-b": "layout.toggle:sidebar", "ctrl-,": "app.settings" };
  for (const [section, map] of Object.entries(WEB_KEYS))
    for (const [k, action] of Object.entries(map)) {
      expect(repoKeys[section]?.[k] ?? (section === "global" ? herdr[k] : undefined)).toBe(action);
      if (!action.startsWith("tab.select:")) expect(NAMES[action.split(":")[0]]).toBeDefined();
    }
  const g = grouped(flatKeys(WEB_KEYS), { layout: "BossGoat" });
  expect(g.map((x) => x.group)).toEqual(["Tabs", "Spaces", "Chat", "App"]);
  expect(g[0].rows.map((r) => r.name)).toEqual(["Show tab 1–9", "Previous tab", "Next tab"]);
  expect(g[0].rows[1].keys).toEqual(["Alt+Left", "Alt+["]);
});

test("the filter: every word in the group, name or keys", () => {
  const r = { name: "Next tab", keys: ["Alt+Right"] };
  expect(keyFound("tabs alt", "Tabs", r)).toBe(true);
  expect(keyFound("space", "Tabs", r)).toBe(false);
  expect(keyFound("", "Tabs", r)).toBe(true);
});
