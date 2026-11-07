// The Keybinds list's words (Shepherdr 3.0's Keybinds dialog, mods/keybinds): each key as people read it, each action
// in plain words, grouped (Tabs, Spaces, Panes, Agents, Terminal, a mod's own, App). The window reads its keys live
// (keys()); the web app passes the ones that work in a browser (web/plugins/keyboard). Both name them from here.
// Shared core: the source is core/keys.js; bin/sync-shared copies it into the mods in lib/COPIES.

const DIRS = { left: "left", right: "right", up: "up", down: "down" };

// Names for actions whose words depend on their argument, and for mods' own commands (not in
// commands()). (arg) => name.
export const NAMES = {
  "tab.new": () => "New tab",
  "tab.close": () => "Close tab",
  "tab.rename": () => "Rename tab",
  "tab.next": () => "Next tab",
  "tab.prev": () => "Previous tab",
  "space.new": () => "New space",
  "space.rename": () => "Rename space",
  "space.next": () => "Next space",
  "space.prev": () => "Previous space",
  "pane.split": (d) => (d === "down" ? "Split down" : "Split right"),
  "pane.go": (d) => `Focus the pane ${DIRS[d] ?? d}`,
  "pane.swap": (d) => `Swap with the pane ${DIRS[d] ?? d}`,
  "pane.close": () => "Close pane",
  "pane.zoom": () => "Zoom pane, or show all",
  "layout.toggle": (id) => (id === "sidebar" ? "Show or hide the sidebar" : `Show or hide ${id}`),
  "layout.switch": () => "Next layout",
  "mod.open": (name) => ({ jump: "Jump to a space, task or artifact", keybinds: "Keybinds" })[name] ?? `Open ${name}`,
  "app.help": () => "Keybinds",
  "app.palette": () => "Command palette",
  "app.settings": () => "Settings",
  "app.zoom_in": () => "Zoom in",
  "app.zoom_out": () => "Zoom out",
  "app.zoom_reset": () => "Actual size",
  "terminal.copy": () => "Copy",
  "terminal.paste": () => "Paste",
  "tabs-tasks.close": () => "Close tab",
  "tabs-tasks.newspace": () => "New space",
  "tabs-tasks.rename-tab": () => "Rename tab",
  "tabs-tasks.rename-space": () => "Rename space",
  "chat.dictate": () => "Dictate",
  "chat.call": () => "Start a call",
  "chat.find": () => "Find in the chat",
};

// What a terminal key types, by its text.
const SENDS = { "\u0017": "Delete the word before", "\u001bb": "Word left", "\u001bf": "Word right" };

// The group an action goes in, in this order (a mod's own group, "Chat", between Terminal and App).
export const ORDER = ["Tabs", "Spaces", "Panes", "Agents", "Terminal", "App"];
export function groupOf(section, action) {
  if (section === "terminal") return "Terminal";
  if (section.startsWith("mod:")) return section.slice(4).replace(/^./, (c) => c.toUpperCase()).replace(/-/g, " ");
  if (/^tab\.|^tabs-tasks\.(close|rename-tab)$/.test(action)) return "Tabs";
  if (/^space\.|^tabs-tasks\.(newspace|rename-space)$/.test(action)) return "Spaces";
  if (/^pane\./.test(action)) return "Panes";
  if (/^agent\./.test(action)) return "Agents";
  return "App";
}

// An action in words. about: command name -> its description (Herdr's commands()).
export function nameOf(action, about = new Map()) {
  if (action.startsWith("send:")) return SENDS[action.slice(5)] ?? "Type text";
  const [name, arg] = action.split(/:(.*)/s);
  if (NAMES[name]) return NAMES[name](arg);
  // The description's first clause: "Show the next agent, in the order…" → "Show the next agent".
  const said = (about.get(name) ?? "").split(/\s*[(:;,]|\.(\s|$)/)[0].trim();
  if (said) return said;
  const last = name.split(".").pop().replace(/[-_]/g, " ");
  return last[0].toUpperCase() + last.slice(1);
}

const SPECIAL = { pageup: "PageUp", pagedown: "PageDown", escape: "Esc", backspace: "Backspace" };

// keys.json's "ctrl-shift-t" as people read it: "Ctrl+Shift+T" (⌃⇧T on macOS), as the menus show it.
export function keyText(stroke, mac = false) {
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return stroke.trim().split(/\s+/).map((one) => {
    const parts = one.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map((m) => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = SPECIAL[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase());
    return [...Object.keys(names).filter((m) => held.has(m)).map((m) => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

// The rows, grouped: [{ group, rows: [{ name, keys: [text] }] }]. list: [{ section, keys, action }] (Herdr's keys());
// layout: the shown layout's name, whose own section's key replaces the global one (other layouts' are left out).
// One row per name, with all its keys; "Show tab 1" … "Show tab 9" fold into one row, "Alt+1–9".
export function grouped(list, { layout = "", about = new Map(), mac = false } = {}) {
  const shown = `layout:${layout ?? ""}`;
  const all = list.filter((k) => k.action && k.action !== "terminal" && !(k.section.startsWith("layout:") && k.section !== shown));
  const mine = new Set(all.filter((k) => k.section === shown).map((k) => k.keys));
  const live = all.filter((k) => !(k.section === "global" && mine.has(k.keys)));
  const groups = new Map();
  for (const k of live) {
    const group = groupOf(k.section, k.action);
    const series = /^(tab|space)\.select:([1-9])$/.exec(k.action);
    const lead = /^(.*-)?([1-9])$/.exec(k.keys.trim());
    const name = series && lead ? `Show ${series[1]} 1–9` : nameOf(k.action, about);
    if (!groups.has(group)) groups.set(group, new Map());
    const rows = groups.get(group);
    if (!rows.has(name)) rows.set(name, []);
    const text = series && lead ? `${keyText(`${lead[1] ?? ""}1`, mac)}–9` : keyText(k.keys, mac);
    if (!rows.get(name).includes(text)) rows.get(name).push(text);
  }
  const rank = (g) => (ORDER.includes(g) ? ORDER.indexOf(g) : ORDER.length - 1.5);
  return [...groups].sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([group, rows]) => ({ group, rows: [...rows].map(([name, keys]) => ({ name, keys })) }));
}

// The dialog's filter: every word typed is in the group, the name or the keys.
export function keyFound(filter, group, row) {
  const words = String(filter ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => `${group} ${row.name} ${row.keys.join(" ")}`.toLowerCase().includes(w));
}

// The dialog's words.
export const KEYBINDS = { title: "Keybinds", filter: "Filter keys", none: "No keys match." };

// The window's keys that work in the web app too (web/plugins/keyboard handles each), as keys.json and Herdr's
// defaults bind them, under the BossGoat layout. The others are the window's: panes, the command palette, zoom,
// the terminal's own keys, and those a browser keeps for itself (Ctrl+Tab, Ctrl+1–9, Ctrl+Shift+N, T, W).
export const WEB_KEYS = {
  global: {
    "alt-1": "tab.select:1", "alt-2": "tab.select:2", "alt-3": "tab.select:3", "alt-4": "tab.select:4", "alt-5": "tab.select:5",
    "alt-6": "tab.select:6", "alt-7": "tab.select:7", "alt-8": "tab.select:8", "alt-9": "tab.select:9",
    "alt-left": "tab.prev", "alt-right": "tab.next", "alt-]": "tab.next", "alt-[": "tab.prev",
    "alt-down": "space.next", "alt-up": "space.prev",
    "ctrl-shift-/": "mod.open:keybinds", "ctrl-shift-?": "mod.open:keybinds",
    "ctrl-shift-b": "layout.toggle:sidebar",
    "ctrl-shift-k": "mod.open:jump", "ctrl-k": "mod.open:jump",
    "ctrl-,": "app.settings",
  },
  "mod:chat": { "ctrl-shift-d": "chat.dictate", "ctrl-shift-space": "chat.call", "ctrl-f": "chat.find" },
  "layout:BossGoat": { "shift-f2": "tabs-tasks.rename-space" },
};

// keys.json's sections as the list grouped() takes: { section: { keys: action } } -> [{ section, keys, action }].
export const flatKeys = (json) => Object.entries(json ?? {}).flatMap(([section, map]) => Object.entries(map ?? {}).map(([keys, action]) => ({ section, keys, action })));
