// The coordinator's settings as compact rows (agent and model, reasoning, fast, permissions),
// with the same choices and values as the chat's model menu (mods/chat-models). Used by the
// New space dialog (mods/newspace) and Settings (mods/shepherdr-settings), with agent.js.
// Shared: the source is lib/settings.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/settings.js, never a mod's copy, then run bin/sync-shared.
//   const data = await loadChoices(machine);       what this machine's agents offer
//   coord = { sel: await lastUsed(data), data };    the choice: { agent, model, effort, fast, perm }
//   modelButton(theme(), coord, { disabled }, cx)   one button ("Opus 5.5 · high ⌄"), as the
//                                                    chat's composer has, opening the model menu
//   settingsRows(theme(), coord, { disabled }, cx)  or the same as rows (render with the render cx)
//   await saveLastUsed(coord.sel)                    on Create: next time starts from it
// The lazy Coordinator chat gets the choice as props.settings and starts its agent with it.
// A row's dropdown opens mods/chat-models in pick mode; its answer comes back through shared
// "newspace.pick" = { key, field, value, at }, which the rows apply on the next render.

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { knownAgents, openOverlay, shared, appHome } from "herdr";
import * as fs from "fs/promises";
import * as agent from "./agent.js";
// The button's words and the choices on offer: core/settings.js, shared with the web app's Settings.
import { modelLabel, choicesFrom } from "./core/settings.js";
import { permAcross } from "./core/agents.js";

const ROW = 31, LABEL = 110;
const LEVEL = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra", none: "None" };
const LAST = () => `${appHome()}/data/coordinator-last.json`;

// What the agents on this machine (or `machine`) offer: { menus, icons, installed, permDefault,
// defaults } (defaults: the CLI's own, for a first time).
export async function loadChoices(machine = null) {
  const [claude, codex, known] = await Promise.all([agent.defaults("claude", machine), agent.defaults("codex", machine),
    knownAgents({ on: machine }).catch(() => [])]);
  const prog = (k) => known.find((a) => a.key === k || (a.run ?? [])[0] === k);
  const installed = Object.fromEntries(["claude", "codex"].map((k) => [k, prog(k) ? prog(k).installed !== false : k === "claude"]));
  const icons = Object.fromEntries(["claude", "codex"].map((k) => [k, { icon: prog(k)?.icon ?? null, tint: Boolean(prog(k)?.tint) }]));
  const { menus, permDefault, defaults } = choicesFrom({ claude, codex }, installed);
  return { menus, icons, installed, permDefault, defaults };
}

// The last choice made (data/coordinator-last.json) when it still fits what is offered, else
// the defaults.
export async function lastUsed(data) {
  let s = null;
  try { s = JSON.parse(await fs.readFile(LAST(), "utf8")); } catch {}
  const m = s && data.menus[s.agent]?.models?.find((x) => x.id === s.model);
  return m ? { agent: s.agent, model: s.model, effort: m.efforts.includes(s.effort) ? s.effort : null, fast: Boolean(s.fast && m.fast),
    perm: data.menus[s.agent].perms.some((p) => p.id === s.perm) ? s.perm : data.permDefault[s.agent] } : { ...data.defaults };
}

export async function saveLastUsed(sel) {
  try {
    await fs.mkdir(`${appHome()}/data`, { recursive: true });
    await fs.writeFile(LAST(), JSON.stringify(sel));
  } catch {}
}

const modelOf = (data, sel) => data?.menus?.[sel?.agent]?.models?.find((m) => m.id === sel.model) ?? null;

// A model picked: the effort and speed stay where it has them; another agent brings its own
// permission modes, the nearest to the one chosen (core/agents.js permAcross).
function choose(coord, agentKey, id) {
  const { sel, data } = coord;
  const m = data.menus[agentKey]?.models?.find((x) => x.id === id);
  if (!m) return;
  const next = { ...sel, agent: agentKey, model: id };
  if (next.effort && !m.efforts.includes(next.effort)) next.effort = null;
  if (!m.fast) next.fast = false;
  if (agentKey !== sel.agent) next.perm = permAcross(sel.perm, agentKey, data.permDefault);
  coord.sel = next;
}

// The rows. `coord` = { sel, data }; disabled: dimmed and inert (no coordinator).
export function settingsRows(t, coord, opts = {}, cx = null) {
  const { sel, data } = coord;
  if (!sel || !data) return v_flex().h(ROW).justify_center().px(9).text_size(12.8).text_color(t.dim).child("Loading agents…");
  coord.key ??= `ns-${Math.random().toString(36).slice(2, 8)}`;
  const off = Boolean(opts.disabled);
  // A dropdown's answer (shared "newspace.pick"): applied once, after this render.
  applyReply(coord, cx);
  const menu = data.menus[sel.agent];
  const m = modelOf(data, sel);
  const icon = (a) => {
    const ic = data.icons?.[a];
    if (!ic?.icon) return div().size(14).flex_none();
    return ic.tint ? svg(ic.icon).size(14).flex_none().text_color(t.foreground) : image(ic.icon).size(14).flex_none();
  };
  const row = (label, control) => h_flex().h(ROW).flex_none().px(9).gap(10).items_center()
    .child(div().w(LABEL).flex_none().text_color(t.muted).child(label))
    .child(h_flex().flex_1().min_w(0).justify_end().child(control));
  const pickAt = (field, options, current) => openOverlay({ mod: "chat-models", kind: "popup", width: 260, height: 10 + ROW * options.length,
    props: { pick: field, key: coord.key, options, current, width: 260, height: 10 + ROW * options.length } });
  const select = (id, content, fn) => h_flex().id(id).h(26).max_w(260).pl(8).pr(6).gap(6).items_center().rounded(7).border_1().border_color(t.input)
    .when(!off, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); fn(); cx.notify(); }))
    .children(content)
    .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none().text_color(t.dim));
  const models = Object.entries(data.menus).flatMap(([a, mm]) => mm.models.map((x) => ({ id: `${a}:${x.id}`, label: x.name, icon: data.icons?.[a]?.icon, tint: data.icons?.[a]?.tint })));
  const levels = m?.efforts ?? [];
  const level = sel.effort ?? m?.defaultEffort ?? null;
  const fastOk = Boolean(m?.fast);
  const perm = menu?.perms?.find((p) => p.id === sel.perm);
  return v_flex().w_full().text_size(12.8).text_color(t.foreground).when(off, (el) => el.opacity(0.45))
    .child(row("Agent", select("ns-model", [icon(sel.agent), div().min_w(0).truncate().child(m?.name ?? sel.model ?? "Choose")],
      () => pickAt("model", models, `${sel.agent}:${sel.model}`))))
    .child(row("Reasoning", h_flex().h(26).p(2).gap(2).rounded(7).bg(t.raised).children(levels.map((e) =>
      h_flex().id(`ns-level-${e}`).h_full().px(7).justify_center().items_center().rounded(5).text_size(11.5)
        .when(level === e, (el) => el.bg(t.background).text_color(t.foreground).font_medium())
        .when(level !== e, (el) => el.text_color(t.muted).when(!off, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); coord.sel = { ...coord.sel, effort: e }; cx.notify(); })))
        .child(LEVEL[e] ?? e)))))
    .when(fastOk, (el) => el.child(row("Fast", div().id("ns-fast").relative().w(28).h(16).flex_none().rounded(8).bg(sel.fast ? t.accent : t.input)
      .when(!off, (el) => el.cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); coord.sel = { ...coord.sel, fast: !coord.sel.fast }; cx.notify(); }))
      .child(div().id("ns-fast-knob").absolute().top(2).left(sel.fast ? 14 : 2).size(12).rounded(6).bg(t.background).transition("left", 120)))))
    .when(Boolean(menu?.perms?.length), (el) => el.child(row("Permissions", select("ns-perm",
      [svg("mods/chat-models/shield.svg").size(14).flex_none().text_color(t.dim), div().min_w(0).truncate().child(perm?.label ?? "Default")],
      () => pickAt("perm", menu.perms.map((p) => ({ id: p.id, label: p.label })), sel.perm)))));
}

// The answers from the model menu (settings mode) and the pick lists, into coord.sel.
function applyReply(coord, cx) {
  const reply = shared("newspace.pick");
  if (!reply || reply.key !== coord.key || reply.at === coord.pickAt || !cx) return;
  coord.pickAt = reply.at;
  cx.timer.after(0, (cx) => {
    if (reply.field === "settings" && reply.value?.agent) coord.sel = { ...reply.value };
    if (reply.field === "model") { const [a, ...id] = String(reply.value).split(":"); choose(coord, a, id.join(":")); }
    if (reply.field === "perm") coord.sel = { ...coord.sel, perm: reply.value };
    cx.notify();
  });
}

// What the choice says, as the composer's button does: "Opus 5.5 · 1M · High · Fast".
export function settingsLabel(coord) {
  return modelLabel(coord.data?.menus, coord.sel);
}

// One quiet button, 28 px, like the chat composer's model button: it opens the model menu
// (mods/chat-models, settings mode) anchored to it, above when there is room, else below;
// every change there comes back into coord.sel. disabled: greyed and inert. label: words shown
// instead of the choice (Settings' unset Reviewer: "Other CLI (Codex)").
export function modelButton(t, coord, opts = {}, cx = null) {
  const { sel, data } = coord;
  const off = Boolean(opts.disabled) || !sel || !data;
  coord.key ??= `ns-${Math.random().toString(36).slice(2, 8)}`;
  if (sel && data) applyReply(coord, cx);
  return h_flex().id(`ns-model-${coord.key}`).h(28).pl(8).pr(5).gap(4).flex_none().min_w(0).items_center().rounded(7)
    .text_size(12).font_medium().text_color(off ? t.dim : t.muted).when(off, (el) => el.opacity(0.6))
    .when(!off, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (e) => { coord.at = e.bounds ?? (e.position ? { x: e.position.x - 40, y: e.position.y - 14, width: 80, height: 28 } : null); })
      .on_click((_e, cx) => { cx.stop_propagation(); openMenu(coord); cx.notify(); }))
    .child(div().min_w(0).truncate().child(sel && data ? opts.label ?? settingsLabel(coord) : "Loading agents…"))
    .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none());
}

// The model menu over the button. Its height is the menu at its tallest (as the chat counts it).
// select: { agent, model } that comes chosen (a typed /model sonnet), told back at once.
export function openMenu(coord, select = null) {
  const { sel, data } = coord;
  // border and padding, agent tabs, search, the list (it scrolls past 8 rows), separator,
  // Reasoning header and levels, Fast, Permissions (chat-models' sizes)
  const W = 340, H = 2 + 10 + 34 + 36 + 8 * 31 + 9 + 26 + 34 + 31 + 31;
  const b = coord.at;
  const at = b ? { x: Math.max(8, b.x + b.width - W), y: b.y - H - 6 >= 8 ? b.y - H - 6 : b.y + b.height + 6 } : "pointer";
  openOverlay({ mod: "chat-models", kind: "popup", frame: "none", width: W, height: H, at,
    props: { mode: "settings", key: coord.key, width: W, height: H, remote: null, select,
      current: { agent: sel.agent, model: sel.model, effort: sel.effort ?? null, fast: Boolean(sel.fast), perm: sel.perm ?? null },
      menus: data.menus, icons: data.icons, permDefault: data.permDefault } });
}

// Also known as settingsButton (the name agreed for the New space dialog).
export const settingsButton = modelButton;
