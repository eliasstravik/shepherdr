// A task's priority in the window's Tasks panel (MSHEP-1), as the web app's (web/shared/priority.ts, web/src/priority.tsx):
// P0 Urgent, P1 High, P2 Medium, P3 Low, P4 Backlog, kept on the task as `priority` ("p0".."p4"). A row shows a flag in a
// pill with its number (P4 an outline flag); a click opens the picker (mods/tasks-menu, menu "priority"). Colours: Heat,
// or the person's own (Settings › Tasks › Priority colours on the web: everywhere.tasks.priority_colors in the settings
// file), the light theme showing a darker shade of one's own.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { settings, theme, readTextFile } from "herdr";
import { dirs } from "./dirs.js";
import { TEXT } from "./ui.js";

export const LEVELS = [["p0", "P0", "Urgent"], ["p1", "P1", "High"], ["p2", "P2", "Medium"], ["p3", "P3", "Low"], ["p4", "P4", "Backlog"]];
const HEAT_DARK = { p0: "#F2555A", p1: "#FF8A3D", p2: "#F5B83D", p3: "#5B9BFF", p4: "#9AA6BA" };
const HEAT_LIGHT = { p0: "#D93036", p1: "#E8590C", p2: "#B7791F", p3: "#2F6FDE", p4: "#5C6778" };

// a stored value as a level, or null
export const levelOf = (v) => { const s = typeof v === "string" ? v.trim().toLowerCase() : ""; return LEVELS.some(([k]) => k === s) ? s : null; };
export const rank = (v) => { const i = LEVELS.findIndex(([k]) => k === levelOf(v)); return i < 0 ? LEVELS.length : i; };
// "#rgb" or "#rrggbb" (the # may be left off) as "#rrggbb", else null
export function hexOf(v) {
  const m = typeof v === "string" ? /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim()) : null;
  if (!m) return null;
  return `#${(m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1]).toLowerCase()}`;
}
const channels = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const toHex = (c) => `#${c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`;
// the light theme's shade of a colour of one's own: each channel at 78%
export const darker = (hex) => toHex(channels(hex).map((x) => x * 0.78));
// a colour at `a` over a background (an opaque fill: the pill's 14%)
export const over = (color, bg, a = 0.14) => { const c = channels(color), b = channels(bg); return toHex(c.map((x, i) => x * a + b[i] * (1 - a))); };

// The person's own colours, read off the settings file now and then (never blocking a render).
let custom = {};
let readAt = 0;
export function refreshColors(onChange) {
  if (Date.now() - readAt < 5000) return;
  readAt = Date.now();
  Promise.resolve(readTextFile(dirs().settings)).then((text) => {
    let c = {};
    try { c = JSON.parse(text ?? "{}")?.everywhere?.tasks?.priority_colors ?? {}; } catch {}
    const next = Object.fromEntries(LEVELS.map(([k]) => [k, hexOf(c?.[k])]).filter(([, v]) => v));
    if (JSON.stringify(next) !== JSON.stringify(custom)) { custom = next; onChange?.(); }
  }).catch(() => {});
}
const dark = () => settings()?.dark !== false;
export const colorOf = (level) => (custom[level] ? (dark() ? custom[level] : darker(custom[level])) : (dark() ? HEAT_DARK : HEAT_LIGHT)[level]);

// The flag in its pill at a row's end, or (unflagged, shown by the row only while it is hovered) a faint dashed flag. `onClick` opens the picker.
export function pill(id, level, onClick) {
  const t = theme();
  const lv = levelOf(level);
  const hit = (el) => el.cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); onClick(); cx.notify(); });
  if (!lv) return hit(h_flex().id(id).size(24).flex_none().items_center().justify_center().rounded(12).opacity(0.4).hover((s) => s.bg(t.hover).opacity(1))
    .child(svg("mods/tasks/flag-empty.svg").size(14).flex_none().text_color(t.dim)));
  const color = colorOf(lv);
  const bg = /^#[0-9a-f]{6}$/i.test(String(t.background)) ? over(color, t.background) : t.hover;
  return hit(h_flex().id(id).h(20).pl(4).pr(7).gap(3).flex_none().items_center().rounded(10).bg(bg).text_color(color)
    .font_semibold().text_size(TEXT.id).whitespace_nowrap()
    .child(svg(lv === "p4" ? "mods/tasks/flag-outline.svg" : "mods/tasks/flag.svg").size(12).flex_none().text_color(color))
    .child(LEVELS.find(([k]) => k === lv)[1]));
}
