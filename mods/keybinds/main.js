// Keybinds: every key that does something, in plain words, grouped (Tabs, Spaces, Panes, ...).
// Ours, in place of Herdr's help (app.help), which lists raw command ids. Opened with
// mod.open:keybinds (Ctrl+Shift+/, and the tab bar's menu). Read live from keys(): what the shown
// layout's own section binds replaces the global key; other layouts' sections are left out.
// A name comes from NAMES, else from the command's own description (commands()).
// Type to filter: every word must be in the name, the keys or the group.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { keys, commands, shared, window, theme } from "herdr";
import { TEXT, RADIUS, H, heading } from "./ui.js";

const DIRS = { left: "left", right: "right", up: "up", down: "down" };

// Names for actions whose words depend on their argument, and for mods' own commands (not in
// commands()). (arg) => name.
const NAMES = {
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

// The group an action goes in, in this order.
const ORDER = ["Tabs", "Spaces", "Panes", "Agents", "Terminal", "App"];
function groupOf(section, action) {
  if (section === "terminal") return "Terminal";
  if (section.startsWith("mod:")) return section.slice(4).replace(/^./, (c) => c.toUpperCase()).replace(/-/g, " ");
  if (/^tab\.|^tabs-tasks\.(close|rename-tab)$/.test(action)) return "Tabs";
  if (/^space\.|^tabs-tasks\.(newspace|rename-space)$/.test(action)) return "Spaces";
  if (/^pane\./.test(action)) return "Panes";
  if (/^agent\./.test(action)) return "Agents";
  return "App";
}

// An action in words.
function nameOf(action, about) {
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
function keyText(stroke) {
  const mac = window()?.platform === "macos";
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

// The rows, grouped: [{ group, rows: [{ name, keys: [text] }] }]. One row per name, with all its
// keys; "Show tab 1" … "Show tab 9" fold into one row, "Alt+1–9".
function grouped() {
  const about = new Map(commands().map((c) => [c.name, c.about]));
  const shown = `layout:${shared("layout") ?? ""}`;
  const all = keys().filter((k) => k.action && k.action !== "terminal" && !(k.section.startsWith("layout:") && k.section !== shown));
  // The shown layout's own key replaces the global one.
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
    const text = series && lead ? `${keyText(`${lead[1] ?? ""}1`)}–9` : keyText(k.keys);
    if (!rows.get(name).includes(text)) rows.get(name).push(text);
  }
  const rank = (g) => (ORDER.includes(g) ? ORDER.indexOf(g) : ORDER.length - 1.5);
  return [...groups].sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([group, rows]) => ({ group, rows: [...rows].map(([name, keys]) => ({ name, keys })) }));
}

export default class Keybinds extends View {
  init(_props, cx) {
    this.filter = "";
    this.input = InputState.new({ placeholder: "Filter keys" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); cx.notify(); });
    this.input.on("focus", (_e, cx) => { this.focused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.focused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(0, () => this.input.focus());
  }

  render() {
    const t = theme();
    const words = this.filter.toLowerCase().split(/\s+/).filter(Boolean);
    const found = (g, r) => words.every((w) => `${g} ${r.name} ${r.keys.join(" ")}`.toLowerCase().includes(w));
    const groups = grouped().map((g) => ({ ...g, rows: g.rows.filter((r) => found(g.group, r)) })).filter((g) => g.rows.length);
    const cap = (text) => div().h(20).px(6).flex_none().flex().items_center().rounded(RADIUS.control).border_1().border_color(t.border)
      .bg(t.background).text_size(TEXT.id).text_color(t.muted).whitespace_nowrap().child(text);
    return v_flex().id("keybinds").size_full().min_h(0).p(18).gap(12).bg(t.popover).text_color(t.foreground)
      .child(div().flex_none().text_size(TEXT.title).font_semibold().child("Keybinds"))
      .child(h_flex().h(H.lg).flex_none().px(10).gap(8).items_center().rounded(RADIUS.control).border_1()
        .border_color(this.focused ? t.accent : t.input).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(14).flex_none().text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(TEXT.body).text_color(t.foreground)))
      .child(v_flex().id("keybinds-list").flex_1().min_h(0).overflow_y_scrollbar().gap(8)
        .when(groups.length === 0, (el) => el.child(div().py(24).text_center().text_size(TEXT.body).text_color(t.dim).child("No keys match.")))
        .children(groups.map((g) => v_flex().flex_none()
          .child(heading(g.group))
          .children(g.rows.map((r) => h_flex().h(H.lg).flex_none().gap(12).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(TEXT.body).child(r.name))
            .child(h_flex().flex_none().gap(4).items_center().children(r.keys.map(cap))))))));
  }
}
