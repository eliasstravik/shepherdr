// Coordinators: an agent started from the `coordinator` template (herdr-core), at most one per
// space, in a tab of its own pinned first. Its workers are agents it started in tabs of their own:
// its children, or terminals labelled herdr.coordinator=<its tab> (they survive its restart).
// A coordinator tab can also have no agent yet: a chat pane (mods/chat, props.role "coordinator")
// that starts the coordinator on the person's first message. Those are recorded in shared
// "coordinator.slots" = { [slot]: { space, tab, pane, folder } }. New spaces get one, on this
// computer and on other machines alike (it runs on the space's machine), unless shared
// "coordinator.auto" is false.
// Shared: the source is lib/coordinator.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/coordinator.js, never a mod's copy, then run bin/sync-shared.

import { appHome, exec, hc, run, openOverlay, shared, setShared, home, machines, focused, readTextFile } from "herdr";
import { terminals, panes, spaces as allSpaces } from "./live.js";
import { logSpace } from "./spacelog.js";
import { toast, plainError } from "./ui.js";

// "vm/tb12" -> ["vm", "tb12"]; this machine's ids have no prefix.
const split = (id) => (id?.includes("/") ? [id.split("/")[0], id.split("/").slice(1).join("/")] : ["", id]);

// Assistants start from the "assistant" template; earlier ones (still live) from "coordinator".
export const isAssistantTemplate = (name) => name === "assistant" || name === "coordinator";
export const isCoordinator = (k) => k?.state === "live" && (k.labels?.["herdr.role"] === "coordinator" || isAssistantTemplate(k.template));

// The live coordinator terminal in a tab, or null. `ps`: panes(), passed in by a caller that
// asks for many tabs (each panes() call copies every pane).
export function coordinatorIn(tabId, all = terminals(), ps = null) {
  const [machine, tab] = split(tabId);
  const direct = all.find((k) => isCoordinator(k) && k.labels?.["herdr.tab"] === tab && split(k.address)[0] === machine);
  if (direct) return direct;
  // In Chat mode the agent has no pane and no tab label: its chat pane (herdr.chat) says where it is.
  const chats = new Set((ps ?? panes()).filter((p) => p.mod === "chat" && p.tab === tabId).map((p) => p.pane));
  return chats.size ? all.find((k) => isCoordinator(k) && chats.has(k.labels?.["herdr.chat"])) ?? null : null;
}

// The agentless coordinator chat in a tab ({ slot, space, tab, pane, folder }), or null.
export function slotIn(tabId, slots = shared("coordinator.slots") ?? {}, ps = null) {
  for (const [slot, s] of Object.entries(slots))
    if (s.tab === tabId && (ps ??= panes()).some((p) => p.pane === s.pane && p.tab === tabId)) return { slot, ...s };
  return null;
}

// A coordinator's tab: one with a coordinator agent, or a coordinator chat waiting for its first message.
export const isCoordinatorTab = (tabId, all = terminals(), ps = null) => {
  ps ??= panes();
  return Boolean(coordinatorIn(tabId, all, ps) || slotIn(tabId, undefined, ps));
};

// A space's coordinator tab, or null. One terminals() and panes() for all its tabs.
export function coordinatorTab(space, all = terminals(), ps = null) {
  if (!space) return null;
  ps ??= panes();
  const slots = shared("coordinator.slots") ?? {};
  return space.tabs.find((t) => coordinatorIn(t.id, all, ps) || slotIn(t.id, slots, ps)) ?? null;
}

// Whether new spaces get a coordinator tab: on unless shared "coordinator.auto" is false (no UI;
// set it by hand to turn it off).
export const autoCoordinator = () => shared("coordinator.auto") !== false;

// Whose worker a terminal is: its coordinator's address, or its parent's.
export function parentOf(k, all = terminals()) {
  const tab = k.labels?.["herdr.coordinator"];
  if (tab) {
    const [machine] = split(k.address);
    const c = coordinatorIn(machine ? `${machine}/${tab}` : tab, all);
    if (c && c.address !== k.address) return c.address;
  }
  return k.parent ?? null;
}

// A coordinator's live workers.
export const workersOf = (coord, all = terminals()) =>
  coord ? all.filter((k) => k.state === "live" && k.address !== coord.address && parentOf(k, all) === coord.address) : [];

// The agent a tab shows: its coordinator, else its first agent terminal.
export function agentIn(tabId, all = terminals()) {
  const c = coordinatorIn(tabId, all);
  if (c) return c;
  const p = panes().find((p) => p.tab === tabId && p.terminal && p.program?.agent);
  return p ? all.find((k) => k.address === p.terminal && k.state === "live") ?? null : null;
}

// The menu entry (knownAgents()) a terminal runs, or null.
export function entryFor(k, known) {
  if (!k) return null;
  const base = (s) => (s ?? "").split(/[\\/]/).pop();
  const chosen = k.labels?.["herdr.agent"];
  if (chosen) return known.find((a) => base(a.run?.[0]) === chosen) ?? null;
  return known.find((a) => a.key === k.program?.key) ?? known.find((a) => base(a.run?.[0]) === base(k.foreground?.argv?.[0] ?? k.argv?.[0])) ?? null;
}

// The helper scripts run detached: the menu that starts one closes at once.
function script(name, args) {
  return exec("bash", ["-c", 'setsid -f bash "$0" "$@" >/dev/null 2>&1 </dev/null', `${appHome()}/mods/coordinator/${name}.sh`, ...args]);
}

// Where a space's coordinator works: its focused (else first) terminal's folder.
function folderOf(space) {
  const mine = new Set(space.tabs.map((t) => t.id));
  const p = panes().find((p) => mine.has(p.tab) && p.focused && p.cwd) ?? panes().find((p) => mine.has(p.tab) && p.cwd);
  // A pane in Chat mode isn't a terminal pane: its agent's folder stands in for it.
  const chat = !p && panes().find((q) => mine.has(q.tab) && q.mod === "chat");
  const agent = chat && terminals().find((k) => k.labels?.["herdr.chat"] === chat.pane);
  return p?.cwd || agent?.cwd || space.folder || home();
}

// Shepherdr settings (mods/shepherdr-settings writes them; herdr-task reads them too):
// ~/.herdr/shepherdr.json = { version, everywhere: SETTINGS, machines: { <machine>: SETTINGS },
//   spaces: { <space id>: { folder, name, machine, ...SETTINGS } } }
// with SETTINGS = { coordinator, worker, reviewer: { agent, model, effort, fast, perm },
//   tasks: { merge: "auto"|"checks"|"ask", review_rounds, must_fix: "blocker"|"major"|"minor", max_running,
//            archive_after (days Done tasks stay in the lists; 0: never archived) },
//   automations: { enabled }, agents: { reactions } }, every key optional. A machine is "local" (this computer) or its
// name; a space on another machine is "<machine>/<id>". The settings window pushes each other
// machine its share (with "here": its name) for its herdr-task. Settings edits only Everywhere and
// spaces now; a machine's layer holds its machine-only rows (machine, home) and is still read for
// anything it set for all its spaces before machine scope went.
export const SHEPHERDR_FILE = () => `${home()}/.herdr/shepherdr.json`;
export const SHEPHERDR_DEFAULTS = { tasks: { merge: "ask", review_rounds: 0, must_fix: "major", max_running: 10, archive_after: 7 }, automations: { enabled: true },
  agents: { reactions: true } };
export const LOCAL_MACHINE = "local";
export async function readShepherdr() {
  try { return JSON.parse((await readTextFile(SHEPHERDR_FILE())) ?? "{}") ?? {}; } catch { return {}; }
}
// A scope: null (Everywhere), "m:<machine>" (a machine), or a space id.
export const machineOfSpace = (id) => (String(id).includes("/") ? String(id).split("/")[0] : LOCAL_MACHINE);
// The layers a scope reads, most specific first: [{ level: "space"|"machine"|"everywhere", key, obj }].
export function shepherdrLayers(cfg, scope = null) {
  const out = [];
  let machine = null;
  if (scope && scope.startsWith("m:")) machine = scope.slice(2);
  else if (scope) { out.push({ level: "space", key: scope, obj: cfg?.spaces?.[scope] || {} }); machine = machineOfSpace(scope); }
  if (machine) out.push({ level: "machine", key: machine, obj: cfg?.machines?.[machine] || {} });
  out.push({ level: "everywhere", key: null, obj: cfg?.everywhere || {} });
  return out;
}
// What applies in a scope: the most specific layer that sets it wins, else the defaults.
// Agents are whole choices; tasks and automations merge key by key.
export function shepherdrFor(cfg, scope = null) {
  const layers = shepherdrLayers(cfg, scope).reverse();
  const out = {};
  for (const role of ["coordinator", "worker", "reviewer"]) out[role] = layers.reduce((v, l) => l.obj[role] ?? v, null);
  // agents: Reactions set before they were for every agent (SHEP-42's assistant.reactions) count where a layer has no agents'
  const own = (l, k) => (k === "agents" && typeof l.obj.assistant?.reactions === "boolean" ? { reactions: l.obj.assistant.reactions, ...l.obj.agents } : l.obj[k] ?? {});
  for (const k of ["tasks", "automations", "agents"]) out[k] = Object.assign({ ...SHEPHERDR_DEFAULTS[k] }, ...layers.map((l) => own(l, k)));
  return out;
}

// One app command, waited for, with what it made ({ tab, pane, ... }).
async function app(name, args) {
  const r = await exec("herdr-app", ["do", name, ...Object.entries(args).flatMap(([k, v]) => [`--${k}`, typeof v === "string" ? v : JSON.stringify(v)])]);
  let out = {};
  try { out = JSON.parse(r.stdout || "{}"); } catch {}
  if (r.code !== 0 || out.error) throw new Error(out.error || r.stderr.trim() || `${name} failed`);
  return out;
}

// Whether a machine (null: this computer) has its layout here now: Herdr adds tabs only then.
const machineReady = (name) => machines().find((m) => (m.name ?? null) === (name ?? null))?.layout === "ready";

// A space's Assistant already running on its machine with no chat of its own here (started from
// the web app, or its tab closed while it ran on): the new tab takes it instead of starting another.
function runningAssistant(space, ps = panes()) {
  const id = String(space.id).split("/").pop(), machine = space.machine ?? "";
  const shown = (k) => ps.some((p) => p.terminal === k.address || (p.mod === "chat" && p.pane === k.labels?.["herdr.chat"]));
  return terminals().find((k) => isCoordinator(k) && split(k.address)[0] === machine && !shown(k)
    && [k.labels?.["herdr.coordinator.space"], k.labels?.["herdr.space"]].includes(id)) ?? null;
}

// Opens a space's coordinator tab, first in the space: a chat with no agent yet, which starts
// the coordinator on the person's first message (mods/chat), on the space's machine. show: go to
// it; else the view stays. settings ({ agent, model, effort, fast, perm }, from the New space
// dialog): what it starts with. A machine that's offline gets it once it's back (watchNewSpaces).
export async function openCoordinator(space, show = true, settings = null) {
  if (space.machine && !machineReady(space.machine)) {
    setShared("coordinator.pending", { ...(shared("coordinator.pending") ?? {}), [space.id]: { settings, at: Date.now() } });
    toast({ title: `${space.machine} is offline`, body: "Its Assistant starts when it's back." });
    return;
  }
  const folder = folderOf(space);
  // Unless the New space dialog chose, the coordinator runs what Shepherdr settings say for the space.
  if (!settings) settings = shepherdrFor(await readShepherdr(), space.id).coordinator;
  const slot = `coord-${space.id}-${Math.random().toString(36).slice(2, 10)}`;
  const was = focused();
  const running = runningAssistant(space);
  try {
    const out = await app("tab.new", { space: space.id, name: "Assistant", mod: "chat",
      props: { role: "coordinator", template: "assistant", space: space.id, folder, slot, ...(settings ? { settings } : {}) } });
    const pane = out.pane ?? panes().find((p) => p.tab === out.tab && p.mod === "chat")?.pane ?? null;
    setShared("coordinator.slots", { ...liveSlots(), [slot]: { space: space.id, tab: out.tab, pane, folder } });
    // The chat follows the agent its slot names (mods/chat adoptSlot).
    if (running && pane) await hc(["label", running.address, `herdr.chat=${pane}`, `herdr.chat.slot=${slot}`, `herdr.chat.origin=slot:${slot}`,
      `herdr.coordinator.tab=${String(out.tab).split("/").pop()}`]).catch(() => {});
    await app("tab.move", { id: out.tab, index: 1 });
    if (show) {
      if (!space.active) run("space.select", { id: space.id });
      run("tab.select", { id: out.tab });
    } else if (was?.pane) run("pane.focus", { pane: was.pane }); // tab.new shows the new tab: back to where the person was.
  } catch (e) {
    toast({ title: "Assistant didn't open", body: plainError(e), level: "error" });
  }
}

// New space: the New space dialog (mods/newspace), on the space's machine (none: this computer).
// It finds that machine's recent folders and home first, so the dialog opens at the height its
// content needs, its paths shown from that home.
export async function newSpace(space) {
  // The machine asked for, else (it can't be reached) this computer, as core/newspace.js startMachine: the dialog's
  // Machine choice offers the rest, shown while another machine is connected.
  const asked = space?.machine ?? null;
  const machine = asked && !machineReady(asked) ? null : asked;
  const choosing = machines().some((m) => m.name && m.layout === "ready");
  const [recent, at] = await Promise.all([recentFolders(machine).catch(() => []), homeOf(machine).catch(() => null)]);
  if (!at) return toast({ title: `Couldn't reach ${machine}`, body: "Try New space again once it's connected.", level: "error" });
  // The dialog draws its own panel (frame "none"), centered and as tall as what it shows now:
  // the overlay is the panel at its tallest.
  openOverlay({ mod: "newspace", kind: "dialog", frame: "none", width: 460, height: newSpaceHeight(recent.length, choosing), props: { recent, machine, home: at } });
}

// A machine's home folder (null: this computer's).
export async function homeOf(machine = null) {
  if (!machine) return home();
  const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: machine });
  return r.code === 0 && r.stdout.startsWith("/") ? r.stdout : null;
}

// The New space dialog's parts, in px (mods/newspace draws them at these sizes): its padding,
// title, the Folder label and field (gap apart), list rows (a typed path's Use row, at most
// NEWSPACE_SHOWN folders, then Choose folder…), the Coordinator row and, while it's on, its two
// rows (Task ID, Agent), the buttons, and the space between sections. The overlay is the dialog
// with the coordinator on; off, the dialog draws itself shorter in its middle.
export const NEWSPACE = { pad: 18, title: 20, label: 16, gap: 4, field: 32, row: 31, line: 32, buttons: 32, section: 16 };
export const NEWSPACE_SHOWN = 5;
// choosing: the Machine choice shows (its label, field and the space under it), and another machine's folders may be
// more, so the rows are at their most.
export function newSpaceHeight(n, choosing = false) {
  const k = NEWSPACE, rows = 1 + Math.min(choosing ? NEWSPACE_SHOWN : n, NEWSPACE_SHOWN) + 1;
  return (choosing ? k.label + k.gap + k.field + k.section : 0) + 2 * k.pad + k.title + k.section + k.label + k.gap + k.field + k.gap + rows * k.row + k.section + 3 * k.line + k.section + k.buttons;
}

// A machine's folders people worked in (null: this computer's), newest first, at most 8: its spaces'
// terminals and other agents', each as its repo's top folder. Task worktrees are left out (they
// belong to a task).
export async function recentFolders(machine = null) {
  const at = new Map();
  const add = (p, t) => { if (p && !p.includes("/.herdr/worktrees/")) at.set(p, Math.max(at.get(p) ?? 0, t ?? 0)); };
  const there = (id) => (machine ? id.startsWith(`${machine}/`) : !id.includes("/"));
  for (const k of terminals()) if (there(k.address)) add(k.foreground?.cwd ?? k.cwd, k.created_ms);
  for (const p of panes()) if (p.cwd && there(p.pane) && there(p.tab)) add(p.cwd, Date.now());
  const paths = [...at.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 40);
  const r = await exec("sh", ["-c", 'for d; do [ -d "$d" ] || continue; git -C "$d" rev-parse --show-toplevel 2>/dev/null || echo "$d"; done', "x", ...paths], machine ? { on: machine } : {});
  const out = [];
  for (const p of r.stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (!out.includes(p) && !p.includes("/.herdr/worktrees/")) out.push(p);
    if (out.length >= 8) break;
  }
  return out;
}

// Makes a space at `folder` (New space dialog), on `machine` (null: this computer), and, unless
// `settings` is null, its Coordinator tab, started with those settings on the first message; lands
// in it. `icon`: the emoji the dialog picked (null: "#"), kept as the sidebar's Rename keeps it
// (mods/spaces-chat sections.js setIcon). Resolves with the space id.
// With a coordinator, the space has only its Coordinator tab: Herdr's first shell tab goes, while
// it is still a fresh shell nobody used.
export async function createSpace(folder, settings, machine = null, icon = null) {
  setShared("coordinator.creating", Date.now());
  // Named from the start, as Herdr would call it (the repo's name, else the folder's) but "Home" at home:
  // an unnamed space follows its first terminal, and with the coordinator parked in a chat that
  // can be a task's worker in its worktree ("task-3-..."). A name given stays.
  const name = await placeName(folder, machine);
  const out = await app("space.new", { folder, name, ...(machine ? { machine } : {}) });
  const now = JSON.parse((await exec("herdr-app", ["ls"]).catch(() => ({ stdout: "" }))).stdout || "{}").spaces?.find((x) => x.id === out.space);
  if (now && !now.named) {
    logSpace("rename", out.space, "coordinator.js createSpace (New space)", { to: name });
    await app("space.rename", { id: out.space, name }).catch(() => {});
  }
  if (icon) {
    const d = shared("spaces-chat") ?? {};
    setShared("spaces-chat", { ...d, icons: { ...(d.icons ?? {}), [out.space]: icon } });
  }
  if (settings === null) return out.space;
  await openCoordinator({ id: out.space, tabs: [], active: true, folder }, true, settings);
  if (out.terminal && out.tab && (await freshShell(out.terminal)))
    await app("tab.close", { id: out.tab, confirmed: true }).catch(() => {});
  return out.space;
}

// A machine's home space (HERD-51): the space at its home folder, whose Assistant also looks after
// the machine (herdr-task's home round). Made when missing, with its Assistant tab, and the view
// goes back to where the person was: Herdr's space.new shows the new space.
export async function makeHomeSpace(machine = null) {
  const at = await homeOf(machine);
  if (!at) throw new Error(`Couldn't reach ${machine}.`);
  const mine = (s) => (s.machine ?? null) === machine && s.folder === at;
  const all = JSON.parse((await exec("herdr-app", ["ls"]).catch(() => ({ stdout: "" }))).stdout || "{}").spaces ?? [];
  const there = all.find(mine);
  if (there) {
    if (!coordinatorTab(there)) await openCoordinator(there, false);
    return there.id;
  }
  const was = focused();
  const out = await app("space.new", { folder: at, ...(machine ? { machine } : {}) });
  try {
    await openCoordinator({ id: out.space, tabs: [], active: false, folder: at }, false);
    if (out.terminal && out.tab && (await freshShell(out.terminal)))
      await app("tab.close", { id: out.tab, confirmed: true }).catch(() => {});
  } finally {
    if (was?.space) run("space.select", { id: was.space });
    if (was?.pane) run("pane.focus", { pane: was.pane });
  }
  return out.space;
}

// A shell nobody used: the shell itself in the foreground, at its first prompt (a line or two, or under a login message).
// A shell still starting is waited for, up to 3 s.
async function freshShell(address) {
  for (let i = 0; i < 12; i++) {
    const fresh = await shellState(address);
    if (fresh !== null) return fresh;
    await exec("sleep", ["0.25"]);
  }
  return false;
}

// true: a fresh shell; false: used, or not a shell; null: no foreground program yet.
async function shellState(address) {
  try {
    const k = JSON.parse((await exec("hc", ["get", address, "--json"])).stdout);
    if (k.state !== "live") return false;
    if (!k.foreground?.argv?.length) return null;
    const fg = k.foreground.argv[0].split("/").pop().replace(/^-/, "");
    if (!["bash", "zsh", "fish", "sh", "dash", "nu", "elvish", "xonsh", "pwsh"].includes(fg)) return false;
    const screen = (await exec("hc", ["read", address, "--lines", "40"])).stdout.split("\n").filter((l) => l.trim());
    // A login message above it (another machine's motd) is no use: still fresh while its one
    // prompt is the last line, with nothing typed or run after it.
    const prompt = (l) => /[$#%>❯]\s*$/.test(l);
    return screen.length <= 2 || (prompt(screen[screen.length - 1]) && screen.filter(prompt).length === 1);
  } catch { return null; }
}

// What Herdr calls an unnamed space in `folder` (on `machine`): its repo, else the folder, ~ at home.
async function placeName(folder, machine = null) {
  if (folder === (await homeOf(machine).catch(() => null))) return "Home";
  const top = (await exec("git", ["-C", folder, "rev-parse", "--show-toplevel"], machine ? { on: machine } : {}).catch(() => null))?.stdout.trim();
  return (top || folder).split("/").filter(Boolean).pop() ?? folder;
}

// Opens a space's coordinator tab from a mod about to close: the tab bar does it (watchNewSpaces).
// show false: the view stays where it is.
export const requestCoordinator = (space, show = true) => setShared("coordinator.openreq", { space: space.id, show, at: Date.now() });

// Slot records whose chat pane is still there (judged once this computer's layout has loaded).
function liveSlots() {
  const slots = shared("coordinator.slots") ?? {};
  if (machines().find((m) => m.name == null)?.layout !== "ready") return slots;
  const have = new Set(panes().map((p) => p.pane));
  return Object.fromEntries(Object.entries(slots).filter(([, s]) => !s.pane || have.has(s.pane)));
}

// Whether a machine runs a Shepherdr window of its own (its herdr-app home has mods): that window
// gives its own new spaces their Assistant, so this one leaves them be. Asked once per machine.
const ownWindow = new Map();
function hasOwnWindow(machine) {
  if (!ownWindow.has(machine)) {
    ownWindow.set(machine, null);
    exec("sh", ["-c", 'test -d "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods"'], { on: machine })
      .then((r) => ownWindow.set(machine, r.code === 0), () => ownWindow.delete(machine));
  }
  return ownWindow.get(machine);
}
// Other machines whose layout was ready at the last look: one coming back has its spaces noted
// again, so spaces made there while it was away are left alone.
const wasReady = new Set();

// Called from the tab bar's render: every new space gets a coordinator tab, on this computer and on
// other machines (one with a Shepherdr window of its own sees to its own). Spaces there when this
// first ran, made while it was off, or made on a machine while it was away, are left alone.
export function watchNewSpaces(spaces) {
  if (machines().find((m) => m.name == null)?.layout !== "ready") return;
  // A menu that closes at once (the + menu, a space's Start Assistant) asks the tab bar to open a
  // coordinator tab for it.
  const req = shared("coordinator.openreq");
  if (req) {
    setShared("coordinator.openreq", null);
    const space = spaces.find((s) => s.id === req.space);
    if (space && Date.now() - req.at < 10000 && !coordinatorTab(space)) openCoordinator(space, req.show !== false);
  }
  // Asked for while its machine was offline (openCoordinator): it opens once the machine is back,
  // where the view is; a space gone since, or a wish older than a week, is dropped.
  const pending = shared("coordinator.pending");
  if (pending && Object.keys(pending).length) {
    const left = {};
    for (const [id, w] of Object.entries(pending)) {
      const space = spaces.find((s) => s.id === id);
      if (Date.now() - (w.at ?? 0) > 7 * 86400000) continue;
      if (!space ? !machineReady(machineOfSpace(id)) : !machineReady(space.machine)) { left[id] = w; continue; }
      if (space && !coordinatorTab(space)) openCoordinator(space, false, w.settings ?? null);
    }
    if (Object.keys(left).length !== Object.keys(pending).length) setShared("coordinator.pending", left);
  }
  // The New space dialog closes as soon as it asks: the space is made here (createSpace), where
  // the work isn't cut short by the dialog going when the view moves to the new space.
  const make = shared("newspace.createreq");
  if (make) {
    setShared("newspace.createreq", null);
    if (Date.now() - make.at < 10000) createSpace(make.folder, make.settings ?? null, make.machine ?? null, make.icon ?? null)
      .catch((e) => toast({ title: "Space wasn't made", body: plainError(e), level: "error" }));
  }
  // Settings > Machines turned a machine's Home Assistant on: its home space, made if missing.
  const home = shared("home.makereq");
  if (home) {
    setShared("home.makereq", null);
    if (Date.now() - home.at < 10000) makeHomeSpace(home.machine ?? null)
      .catch((e) => toast({ title: "Home space wasn't made", body: plainError(e), level: "error" }));
  }
  const fresh = watchRemoteSpaces(spaces);
  const mine = spaces.filter((s) => !s.machine && !s.id.includes("/"));
  const seen = shared("coordinator.seen");
  if (!Array.isArray(seen)) setShared("coordinator.seen", mine.map((s) => s.id));
  else {
    const here = mine.filter((s) => !seen.includes(s.id));
    if (here.length || seen.some((id) => !mine.some((s) => s.id === id))) {
      setShared("coordinator.seen", mine.map((s) => s.id));
      const slots = shared("coordinator.slots") ?? {}, kept = liveSlots();
      if (Object.keys(kept).length !== Object.keys(slots).length) setShared("coordinator.slots", kept);
    }
    fresh.unshift(...here);
  }
  if (!fresh.length) return;
  // A space the New space dialog is making gets its coordinator (or none) from the dialog.
  if (!autoCoordinator() || Date.now() - (shared("coordinator.creating") ?? 0) < 15000) return;
  // A new space's first tab appears with it: once it has one, the coordinator goes in front. The
  // person lands in it when the new space is the one they're looking at; a space made elsewhere
  // (an agent's) leaves the view where it was.
  for (const s of fresh) if (s.tabs.length && !coordinatorTab(s)) openCoordinator(s, s.active);
}

// Other machines' new spaces, as watchNewSpaces does this computer's: shared
// "coordinator.seen.remote" = { [machine]: [space ids] }, noted while its layout is ready.
function watchRemoteSpaces(spaces) {
  const seen = shared("coordinator.seen.remote") ?? {};
  let next = null, fresh = [];
  for (const m of machines()) {
    if (m.name == null) continue;
    if (m.layout !== "ready") { wasReady.delete(m.name); continue; }
    const mine = spaces.filter((s) => s.machine === m.name).map((s) => s.id);
    const before = seen[m.name];
    const back = !wasReady.has(m.name);
    wasReady.add(m.name);
    if (!Array.isArray(before) || back) {
      if (JSON.stringify(before) !== JSON.stringify(mine)) (next ??= { ...seen })[m.name] = mine;
      continue;
    }
    const add = mine.filter((id) => !before.includes(id));
    if (!add.length && before.every((id) => mine.includes(id))) continue;
    // Not known yet whether it has a window of its own: looked at again next time.
    if (add.length && hasOwnWindow(m.name) === null) continue;
    (next ??= { ...seen })[m.name] = mine;
    if (!hasOwnWindow(m.name)) fresh.push(...spaces.filter((s) => add.includes(s.id)));
  }
  if (next) setShared("coordinator.seen.remote", next);
  return fresh;
}

// The task (herdr-task) an agent works on: its key, or null.
export const taskOf = (k) => k?.labels?.["herdr.task"] ?? null;

// Restarts a task's agent in its tab through herdr-task, as `agentKey` or as it was.
export const switchTask = (k, agentKey) =>
  script("task", [taskOf(k), k.foreground?.cwd ?? k.cwd, parentOf(k) ?? "", ...(agentKey ? [agentKey] : [])]);

// Restarts the agent `k` in its tab: with `argv`, as that agent; without, as it was
// (a coordinator from the template again, so edited instructions apply).
export const restartAgent = (k, argv) => script("restart", argv ? [k.address, JSON.stringify(argv)] : [k.address]);

// Closes a tab. A coordinator with live workers asks first; a space's last tab closes the space,
// so it asks as Close space does (our confirm, not Herdr's).
export function closeTab(tabId) {
  const c = coordinatorIn(tabId);
  if (c && workersOf(c).length) {
    openOverlay({ mod: "coordinator", kind: "dialog", width: 440, height: 336, props: { view: "close", tab: tabId } });
    return;
  }
  const space = allSpaces().find((s) => s.tabs.some((x) => x.id === tabId));
  if (space?.tabs.length === 1) return closeSpace(space.id);
  run("tab.close", { id: tabId });
}

// Rename a tab: our prompt (mods/prompt-chat, the app's one dialog footer), its field holding the
// name given (empty when nobody named it: it keeps its number).
export function renameTab(tab) {
  openOverlay({ mod: "prompt-chat", kind: "dialog", width: 400, height: 196, props: { title: "Rename tab",
    value: tab?.named ? tab.name : "", placeholder: tab?.name ?? "", command: { name: "tab.rename", args: { id: tab?.id } } } });
}

// A space's Rename and Close, as its sidebar menu does them (mods/spaces-chat): the Rename dialog
// (name and icon), and our confirm (mods/confirm-chat) before Herdr's close.
export function renameSpace(id) {
  openOverlay({ mod: "spaces-chat", kind: "dialog", frame: "none", width: 380, height: 172, props: { view: "rename", space: id } });
}
export function closeSpace(id) {
  const name = allSpaces().find((s) => s.id === id)?.name;
  openOverlay({ mod: "confirm-chat", kind: "dialog", width: 400, height: 168, props: {
    title: name && name !== "~" ? `Close \u201c${name}\u201d?` : "Close this space?",
    detail: "Its tabs close and every program in them ends.", verb: "Close space",
    command: { name: "space.close", args: { id, confirmed: true } } } });
  logSpace("close", id, "coordinator.js closeSpace (asks in confirm-chat)");
}

// An element's place in the window, from a mouse event on it: { x, y, width, height }.
export const rectOf = (e) => ({ x: e.position.x - (e.local_position?.x ?? 0), y: e.position.y - (e.local_position?.y ?? 0),
  width: e.bounds?.width ?? 0, height: e.bounds?.height ?? 0 });

// Where a submenu `width` wide opens beside a menu `menu` wide, at the row it belongs to: right of
// the menu when it fits before `right` (the window's right edge, if known), else left of it; its
// first row level with that row (menus pad their rows by 5 px). Kept inside the window.
export function besideRow(row, menu, width, right) {
  const left = row.x - 5, edge = left + menu;
  const fits = right != null && edge + 4 + width <= right - 8;
  let x = fits ? edge + 4 : left - 4 - width;
  if (x < 8) x = right != null ? Math.min(edge + 4, right - 8 - width) : edge + 4;
  return { x: Math.max(8, x), y: Math.max(8, row.y - 5) };
}

// Ends a coordinator's tab; "stop" ends its workers first.
export const closeCoordinator = (tabId, coord, mode) => script("close", [tabId, coord.address, mode]);
