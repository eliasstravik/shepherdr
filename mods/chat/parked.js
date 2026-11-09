// Agents parked behind a chat pane (the pane-chat switch), known by their core label
// herdr.chat=<chat pane>. Herdr lists an agent through its
// pane, so an agent whose terminal is parked while its chat shows drops out of agents(), tab
// and space status. Mods that list agents add these back, as the chat pane's agent.
// Shared: the source is lib/parked.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/parked.js, never a mod's copy, then run bin/sync-shared.

import { focused, shared, machines, run, exec, hc, appHome } from "herdr";
import { panes, terminals, spaces } from "./live.js";
import { chatPane } from "./core/spaces.js";

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const STATES = ["working", "blocked", "done", "idle"];

// Shaped like agents()'s entries; `pane` is the chat pane.
export function chatAgents() {
  const seen = shared("chat.seen") ?? {};
  const chats = new Map(panes().filter((p) => p.mod === "chat").map((p) => [p.pane, p]));
  const own = new Set(panes().map((p) => p.terminal).filter(Boolean));
  const where = new Map(spaces().flatMap((s) => s.tabs.map((t) => [t.id, { s, t }])));
  const now = focused()?.pane;
  const out = [];
  for (const k of terminals()) {
    const pane = chatPane(k);
    const p = pane && chats.get(pane);
    if (!p || k.state !== "live" || own.has(k.address)) continue;
    const e = { terminal: k.address };
    let status = STATES.includes(k.status) ? k.status : "idle";
    // Done means finished while nobody looked; looking at its chat makes it idle, as Herdr does.
    if (status === "done" && (now === pane || (seen[e.terminal] ?? -1) >= (k.turn ?? 0))) status = "idle";
    const w = where.get(p.tab);
    out.push({
      address: e.terminal, pane, space: w?.s.id ?? null, space_name: w?.s.name ?? "", tab: p.tab,
      tab_index: w?.t.index ?? 0, tab_name: w?.t.name ?? "", status, app: k.report?.app ?? null,
      program: k.program, title: k.title ?? "", seq: k.turn ?? 0, focused: now === pane,
    });
  }
  return out;
}

// The more urgent of two statuses (null: none).
export const urgent = (a, b) => ((RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a ?? null);

// A tab's status with its parked agents in it.
export function tabStatus(tab, parked = chatAgents()) {
  return parked.filter((a) => a.tab === tab.id).reduce((s, a) => urgent(s, a.status), tab.status ?? null);
}

// spaces() with parked agents counted in their tabs' and spaces' status.
export function spacesWithChats() {
  const parked = chatAgents();
  if (!parked.length) return spaces();
  return spaces().map((s) => {
    const tabs = s.tabs.map((t) => ({ ...t, status: tabStatus(t, parked) }));
    return { ...s, tabs, status: tabs.reduce((st, t) => urgent(st, t.status), s.status ?? null) };
  });
}

// A parked agent carries the core label herdr.chat=<its chat pane>. When that pane is gone
// (its tab or space closed, even one never shown since Herdr started), the agent ends, as
// closing its pane would have ended it, and its chat flag and asks go with it. While the pane
// is there, core keep is kept on. A machine is
// only judged once its layout has loaded, and a pane must be missing twice in a row.
const missing = new Map();
const kept = new Set();
async function keepOn(address) {
  kept.add(address);
  try {
    const t = JSON.parse((await hc(["get", address, "--json"])).stdout);
    if (t.keep === false) await hc(["keep", address]);
  } catch { kept.delete(address); }
}
export function sweep() {
  const ready = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name ?? ""));
  const have = new Set(panes().map((p) => p.pane));
  const own = new Set(panes().map((p) => p.terminal).filter(Boolean));
  for (const k of terminals()) {
    // As this window names the pane: a label written by another window (or machine) matches too (#761).
    const chat = chatPane(k);
    if (!chat || k.state !== "live") { kept.delete(k.address); continue; }
    const machine = k.address.includes("/") ? k.address.split("/")[0] : "";
    if (!ready.has(machine) || have.has(chat) || own.has(k.address)) {
      missing.delete(k.address);
      // Parking turned core keep off: on again, so it survives a lost core like a pane's terminal.
      if (have.has(chat) && !own.has(k.address) && !kept.has(k.address)) keepOn(k.address);
      continue;
    }
    if (!missing.has(k.address)) { missing.set(k.address, true); continue; }
    missing.delete(k.address);
    run("terminal.kill", { terminal: k.address });
    if (!machine) exec("sh", ["-c", 'rm -f "$1/open/$2" "$1/req/$2".*.json "$1/ans/$2".*.json', "x", `${appHome()}/data/chat-asks`, k.address]);
  }
}
