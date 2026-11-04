// What Herdr's `herdr` module answers, worked out from what the server pushes: herdr-core's
// terminals and each machine's layout document ("herdr-app", the window's spaces, tabs and
// panes), with this page's own view on top (which space and tab it shows, its panels).
import { state, onState, touch } from "./core.js";

const STATES = ["working", "blocked", "done", "idle"];
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const urgent = (a, b) => ((RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a ?? null);

// ---- this page's view: its own space, tabs and layout (never the window's) ---------------
const SAVED = "shepherdr-web.view";
export const view = (() => {
  try { return JSON.parse(localStorage.getItem(SAVED)) ?? {}; } catch { return {}; }
})();
view.tabs ??= {};
export function saveView() {
  try { localStorage.setItem(SAVED, JSON.stringify({ active: view.active, tabs: view.tabs, layoutState: view.layoutState })); } catch {}
  touch("view");
}

// ---- programs (Herdr's programs.json, the few the PoC needs) -----------------------------
const PROGRAMS = {
  claude: { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false, agent: true },
  codex: { key: "codex", name: "Codex", icon: "icons/codex.svg", tint: true, agent: true },
  pi: { key: "pi", name: "Pi", icon: "icons/agent.svg", tint: true, agent: true },
  shell: { key: "shell", name: "shell", icon: null, tint: true, shell: true },
};
function programOf(t) {
  const app = t.status?.app ?? "";
  const fg = (t.foreground?.name ?? t.argv?.[0] ?? "").split("/").pop();
  const key = app.startsWith("claude") || fg === "claude" ? "claude" : app === "codex" || fg === "codex" ? "codex" : app === "pi" || fg === "pi" ? "pi"
    : /^(bash|zsh|fish|sh|nu)$/.test(fg) ? "shell" : null;
  const p = key ? PROGRAMS[key] : { key: "program", name: fg || "program", icon: null, tint: true };
  return { tile: null, color: null, shell: false, agent: Boolean(t.status), ...p, ...(key === "shell" ? { name: fg } : {}) };
}

// ---- memoised derivations (recomputed when the pushed state changes) -------------------
let memo = {};
onState(() => { memo = {}; });
const once = (k, f) => (k in memo ? memo[k] : (memo[k] = f()));

export const terminalsRaw = () => state.terminals ?? [];
export function terminals() {
  return once("terminals", () => terminalsRaw().map((t) => ({
    ...t, status: t.status?.state ?? null, report: t.status ?? null, program: programOf(t),
  })));
}
const byAddress = () => once("byAddress", () => new Map(terminals().map((t) => [t.address, t])));

const MACHINE_ORDER = () => [null, ...(state.coreMachines ?? []).map((m) => m.name)];
const docs = () => state.docs ?? {};

export function machines() {
  return once("machines", () => MACHINE_ORDER().filter((m) => m === null || docs()[m] || true).map((m) => {
    if (m === null) return { name: null, layout: "ready" };
    const c = (state.coreMachines ?? []).find((x) => x.name === m);
    return { name: m, layout: c?.state === "connected" && docs()[m] ? "ready" : "unavailable" };
  }).filter((m) => m.name === null || docs()[m.name] || m.layout === "unavailable"));
}

function blocks(node, out = []) {
  if (!node) return out;
  if (node.type === "block") out.push(node);
  for (const c of node.children ?? []) blocks(c, out);
  return out;
}

// Every space on every machine, in order: this computer's first.
function raw() {
  return once("raw", () => {
    const out = [];
    for (const m of MACHINE_ORDER()) {
      const doc = docs()[m ?? ""];
      if (!doc) continue;
      const pre = m ? `${m}/` : "";
      for (const s of doc.spaces ?? []) out.push({ m, pre, s });
    }
    return out;
  });
}

export function activeSpace() {
  const all = raw();
  const ids = all.map((r) => r.pre + r.s.id);
  if (!ids.includes(view.active)) view.active = ids.includes(state.view?.active) ? state.view.active : ids[0] ?? null;
  return view.active;
}

export function panes() {
  return once("panes", () => {
    const t = byAddress();
    const out = [];
    for (const { m, pre, s } of raw()) {
      for (const tab of s.tabs ?? []) {
        const tid = pre + tab.id;
        const focus = view.tabs[tid]?.focused ?? state.view?.tabs?.[tid]?.focused;
        const bs = blocks(tab.root);
        for (const b of bs) {
          const c = b.content ?? {};
          const pane = pre + b.id;
          const addr = c.terminal ? pre + c.terminal : null;
          const k = addr ? t.get(addr) : null;
          if (c.mod) out.push({ pane, terminal: null, mod: c.mod, props: c.props ?? {}, tab: tid, title: c.mod, focused: focus ? focus === pane : b === bs[0], zoomed: false, cwd: null, branch: null, status: null, app: null, program: PROGRAMS.shell, movable: false });
          else out.push({
            pane, terminal: addr, tab: tid, title: k?.title ?? "", cwd: k?.foreground?.cwd ?? k?.cwd ?? null, branch: null,
            status: STATES.includes(k?.status) ? k.status : null, app: k?.report?.app ?? null, program: k?.program ?? programOf({}),
            focused: focus ? focus === pane : b === bs[0], zoomed: false, movable: bs.length > 1,
          });
        }
      }
    }
    return out;
  });
}

export function spaces() {
  return once("spaces", () => {
    const active = activeSpace();
    const ps = panes();
    return raw().map(({ m, pre, s }, i) => {
      const id = pre + s.id;
      const shownTab = view.tabs[id]?.tab ?? state.view?.spaces?.[id] ?? (s.tabs?.[0] ? pre + s.tabs[0].id : null);
      const tabs = (s.tabs ?? []).map((tab, j) => {
        const tid = pre + tab.id;
        const mine = ps.filter((p) => p.tab === tid);
        const status = mine.reduce((st, p) => urgent(st, p.status), null);
        return { id: tid, index: j + 1, name: tab.name || String(j + 1), named: Boolean(tab.name), active: tid === shownTab, status, panes: mine.length, zoomed: false, settled: false, settled_at: null, changed_at: null, working_since: null };
      });
      if (!tabs.some((t) => t.active) && tabs[0]) tabs[0].active = true;
      const first = ps.find((p) => p.tab === tabs[0]?.id && p.cwd)?.cwd;
      const folder = s.folder ?? "";
      const name = s.name || (first ?? folder).split("/").filter(Boolean).pop() || "~";
      return { id, index: i + 1, name, named: Boolean(s.name), folder, machine: m, branch: null, active: id === active, status: tabs.reduce((st, t) => urgent(st, t.status), null), tabs };
    });
  });
}

export function agents() {
  return once("agents", () => {
    const sp = spaces();
    const where = new Map(sp.flatMap((s) => s.tabs.map((t) => [t.id, { s, t }])));
    const t = byAddress();
    return panes().filter((p) => p.terminal && t.get(p.terminal)?.report).map((p) => {
      const k = t.get(p.terminal);
      const w = where.get(p.tab);
      return {
        address: p.terminal, pane: p.pane, space: w?.s.id, space_name: w?.s.name ?? "", tab: p.tab, tab_index: w?.t.index ?? 0, tab_name: w?.t.name ?? "",
        status: STATES.includes(k.status) ? k.status : "idle", app: k.report?.app ?? null, program: k.program, title: k.title ?? "", seq: k.turn ?? 0, pinned: false, focused: p.focused,
      };
    });
  });
}

export function focused() {
  const s = spaces().find((x) => x.active);
  if (!s) return null;
  const tab = s.tabs.find((t) => t.active);
  const p = panes().find((x) => x.tab === tab?.id && x.focused);
  return { space: s.id, tab: tab?.id ?? null, pane: p?.pane ?? null, terminal: p?.terminal ?? null, shown: null, agent: null, cwd: p?.cwd ?? null };
}

export function settings() {
  return once("settings", () => ({ ...(state.themes?.settings ?? {}), ...(state.settings ?? {}) }));
}
export function theme() {
  return once("theme", () => {
    const s = settings();
    const name = s.theme ?? (s.dark ? s.theme_dark : s.theme_light) ?? "graphite";
    const t = (state.themes?.themes ?? []).find((x) => x.name === name) ?? state.themes?.themes?.[0];
    return { ...(t?.colors ?? {}), ...(s.colors ?? {}) };
  });
}
export const themes = () => state.themes?.themes ?? [];
export const isDark = () => (state.themes?.themes ?? []).find((x) => x.name === (settings().theme ?? "graphite"))?.light === false;

export function keys() {
  return once("keys", () => Object.entries(state.keys ?? {}).flatMap(([section, m]) => Object.entries(m ?? {}).map(([k, action]) => ({ section, keys: k, action: String(action) }))));
}
