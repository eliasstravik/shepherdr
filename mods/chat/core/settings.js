// Shepherdr settings' rows as data: each row's key in ~/.herdr/shepherdr.json, its words and its choices, and every
// title, line and button word the window's Settings say (mods/shepherdr-settings), so the window, the service and the
// web app's Settings say the same. herdr-task reads the file (herdr_task/settings.py: settings_for); its defaults are
// DEFAULTS there and here.
// Shared core: the source is core/settings.js; bin/sync-shared copies it into the mods in lib/COPIES.
import { AGENTS, NAMES, levelName, current, rowFor, menuFor, permDefault as permOf } from "./agents.js";
import { SERVE } from "./host.js";

// ---- the frame -------------------------------------------------------------------------------------------------
// The pages, in the window's order. space: a space's own settings have it too ("local": only a space on this computer).
export const SECTIONS = [
  { id: "agents", title: "Agents", icon: "bot", space: true },
  { id: "tasks", title: "Tasks", icon: "list-checks", space: true },
  // one setting for every space (core/autopilot.js): a space only switches it on, in its Assistant's header
  { id: "autopilot", title: "Autopilot", icon: "plane" },
  { id: "notify", title: "Notify", icon: "bell", space: true },
  { id: "secrets", title: "Secrets", icon: "key", space: true },
  { id: "machines", title: "Machines", icon: "network" },
  { id: "window", title: "Window", icon: "layout" },
  { id: "web", title: "Web", icon: "globe" },
];
// The window's title over its pages: Everywhere's, or a space's own.
export const TITLE = "Settings";
export const SPACE_TITLE = "Space settings";
export const EVERYWHERE = "Everywhere";
export const THIS_COMPUTER = "This computer";
export const LOCAL = "local";
export const machineLabel = (key) => (key === LOCAL || key == null ? THIS_COMPUTER : key);
// A space's own settings, at their top: which space, and on which machine.
export const onlyFor = (space, machine) => `Only for ${space} on ${machine}`;

// ---- under a row -----------------------------------------------------------------------------------------------
// In a space: "Changed here · Reset" or "Same as everywhere"; on Everywhere, the spaces that set their own.
export const CHANGED_HERE = "Changed here";
export const RESET = "Reset";
export const sameAs = (level, key) => (level === "machine" ? `Same as ${machineLabel(key)}` : "Same as everywhere");
export const spacesOwn = (n) => (n === 1 ? "1 space uses its own" : `${n} spaces use their own`);
export const machinesOwn = (n) => (n === 1 ? "1 machine uses its own" : `${n} machines use their own`);
export const SAME_AS_ALL_MACHINES = "Same as all machines";

// ---- Agents ----------------------------------------------------------------------------------------------------
export const ROLES = [
  { id: "coordinator", title: "Assistant", about: "Plans the work and starts a task for each part.", file: "assistant.md",
    told: "What every Assistant is told first" },
  { id: "worker", title: "Workers", about: "Do one task each.", file: "worker.md", told: "What every worker is told first" },
  { id: "reviewer", title: "Reviewer", about: "Checks each task's work before it's ready.", file: "reviewer.md",
    told: "What every reviewer is told first" },
];
export const EDIT_INSTRUCTIONS = "Edit instructions";
// The instructions editor (mods/coordinator's instructions view, over Settings): its note under the text, by role,
// and what it says once a change is in the file.
export const INSTRUCTIONS = {
  title: "Instructions", done: "Done", saved: "Saved.", notSaved: (why) => `Not saved: ${why}`,
  notes: {
    coordinator: "Every Assistant uses this. Repo-specific rules go in the repo's AGENTS.md or CLAUDE.md. Changes apply when an Assistant restarts.",
    worker: "Every worker gets this first. Repo-specific rules go in the repo's AGENTS.md or CLAUDE.md. Changes apply to the next task that starts.",
    reviewer: "Every reviewer gets this first. Repo-specific rules go in the repo's AGENTS.md or CLAUDE.md. Changes apply to the next review.",
    heartbeat: "Autopilot's heartbeat, plain text, the same in every space: an Assistant on Autopilot gets it on every wake. Changes apply from the next wake.",
  },
};
export const USE_OTHER_CLI = "Use other CLI";
export const LOADING_AGENTS = "Loading agents…";
// An unset Reviewer's button: what runs, the other CLI.
export const otherCliWords = (cli) => `Other CLI (${NAMES[cli] ?? cli})`;
// The other CLI than the worker's, for an unset Reviewer and Backup: of the kinds `menus` offers (installed here),
// Claude Code first, then Codex, then the table's order (as herdr-task's other_cli); without menus, or when none
// other is installed, Codex (Claude Code when the worker is Codex).
export const otherCli = (worker, menus = null) =>
  (menus && AGENTS.find((k) => k !== worker && menus[k])) ?? (worker === "codex" ? "claude" : "codex");
export const BACKUP = { title: "Backup agent", about: "The other CLI takes over a task once when its agent can't go on." };
// The machines where the other CLI can't take over (herdr-task's check, ~/.herdr/cli-check.json's machines: this
// computer is ""), in one line. m: the scope's machine ("local" or its name), null for Everywhere (every machine).
export function backupProblem(checks, m, cli) {
  const here = Object.entries(checks ?? {}).filter(([k]) => m === null || k === (m === LOCAL ? "" : m));
  return here.filter(([, c]) => c?.[cli] === "missing" || c?.[cli] === "signed-out")
    .map(([k, c]) => `Can't on ${k || "this computer"}: ${NAMES[cli] ?? cli} is ${c[cli] === "missing" ? "not installed" : "signed out"}.`).join(" ");
}

// The model menu's words (mods/chat-models, settings mode) and its button's: "Opus 5.5 · 1M · High".
export const MODEL_MENU = { model: "Model", reasoning: "Reasoning", fast: "Fast", permissions: "Permissions" };
const modelOf = (menus, sel) => menus?.[sel?.agent]?.models?.find((m) => m.id === sel.model) ?? null;
export function modelLabel(menus, sel) {
  const m = modelOf(menus, sel);
  const level = sel?.effort ?? m?.defaultEffort ?? null;
  return [m?.name ?? sel?.model, levelName(level), sel?.fast ? "Fast" : null].filter(Boolean).join(" · ") || "Choose a model";
}
// What the agents offer, from each CLI's own settings (agents.js parseDefaults) and which are installed:
// { menus, permDefault, defaults } (defaults: the first installed CLI's own, what an unset role runs).
export function choicesFrom(dflts, installed = { claude: true, codex: true }) {
  const menus = Object.fromEntries(AGENTS.filter((k) => installed[k]).map((k) => [k, menuFor(k, dflts[k])]));
  const permDefault = Object.fromEntries(AGENTS.map((k) => [k, permOf(k, dflts[k])]));
  const first = menus.claude ? "claude" : Object.keys(menus)[0] ?? "claude";
  const c = current(first, [], {}, dflts[first]);
  const model = rowFor(first, c) ?? menus[first]?.models?.[0]?.id ?? null;
  return { menus, permDefault, defaults: { agent: first, model, effort: c.effort ?? null, fast: false, perm: permDefault[first] } };
}
// What a role's model button starts from: its own choice, else for the Reviewer the other CLI, else the defaults.
export function roleSel(role, own, choices, worker) {
  if (own) return { sel: { ...own }, unset: false };
  const o = otherCli(worker, choices?.menus);
  if (role === "reviewer" && choices?.menus?.[o])
    return { sel: { agent: o, model: choices.menus[o].models[0]?.id ?? null, effort: null, fast: false, perm: choices.permDefault?.[o] ?? null }, unset: true };
  return { sel: choices?.defaults ? { ...choices.defaults } : null, unset: true };
}
// A model picked in the menu: the effort and speed stay where it has them; another agent brings its own permission
// modes (full access staying full access).
export function chooseModel(menus, permDefault, sel, agent, id) {
  const m = menus?.[agent]?.models?.find((x) => x.id === id);
  if (!m) return sel;
  const next = { ...sel, agent, model: id };
  if (next.effort && !m.efforts.includes(next.effort)) next.effort = null;
  if (!m.fast) next.fast = false;
  if (agent !== sel.agent) {
    // a kind with no full-access mode (pi, amp, cursor) gets its default instead
    const full = sel.perm === "bypassPermissions" || sel.perm === "full";
    const fullId = agent === "claude" ? "bypassPermissions" : "full";
    next.perm = full && menus[agent]?.perms?.some((p) => p.id === fullId) ? fullId : permDefault?.[agent] ?? null;
    // Fast as the CLI has it (Codex's service_tier in its config); a kind with no Fast stays off
    next.fast = Boolean(menus[agent]?.fastLocked && m.fast);
  }
  return next;
}

// ---- Tasks -----------------------------------------------------------------------------------------------------
// One line under each row's title (by its key, section.field).
export const ABOUT = {
  "tasks.merge": "Who merges a task once it's Ready: you, by accepting it, or Herdr.",
  "tasks.review_rounds": "A task's agent has its work reviewed and fixes what's found.",
  "tasks.must_fix": "What the agent fixes before it says ready. It lists the rest.",
  "tasks.proof": "Each task shows real proof of its work in one artifact, linked from Accept.",
  "tasks.max_running": "Per folder. More wait their turn and start by themselves.",
  "tasks.archive_after": "Done tasks move to Archived, with their chat and summary.",
  "tasks.worktrees": "In a git repo, each task gets its own worktree and branch.",
  "automations.enabled": "Tasks an agent set to start on a schedule or an event.",
};
// What a task's agent is told to do first and last (tasks.start_notes / finish_notes), each a box under its words.
export const NOTES = [
  { id: "start", title: "When a task starts", about: "Steps its agent does before the work.",
    example: "Install packages, copy .env from the main folder" },
  { id: "finish", title: "When a task finishes", about: "Steps its agent does before it says the task is ready.",
    example: "Stop the dev server you started, delete temp files" },
];
export const SAVED = "Saved";
// Base branch, a space's only (tasks.base): checked before it's saved.
export const BASE = {
  title: "Base branch",
  about: "New tasks branch from it and merge into it. Empty: the branch the folder has checked out.",
  empty: (now) => (now ? `Its branch now: ${now}` : "Its current branch"),
  missing: (want) => `There's no branch “${want}” here or on origin.`,
  follows: "the folder's branch",
};
// A branch name git could have (before asking git whether it is there).
export const branchShape = (b) => !/^-|[\s~^:?*[\\]|\.\.|@\{/.test(b);

// ---- Notify ----------------------------------------------------------------------------------------------------
export const NOTIFY_ABOUT = "What reaches you from a space's Assistant. Tasks always alert.";
export const notifyMachineAbout = (v) => `Its spaces use ${v}.`;

// ---- Secrets ---------------------------------------------------------------------------------------------------
export const SECRETS = {
  about: "Agents use these by name and never see them.",
  asked: "Asked for", add: "Add", kept: "Kept", name: "Name", value: "Value", for: "For",
  namePlaceholder: "GITHUB_TOKEN", valuePlaceholder: "Paste the value",
  hint: "The same name again replaces it there.",
  save: "Save", saving: "Saving…", loading: "Loading…",
  none: "None. An agent that needs one asks in its chat.",
  give: "Give it", replace: "Replace", remove: "Remove", keep: "Keep",
  machine: "Machine", space: "Space",
  badName: "Name it like an environment variable: letters, digits and _, such as GITHUB_TOKEN.",
  noValue: "Paste the value first.",
  asks: (who, name) => `${who} asks for ${name}`,
  keptNote: (name, where) => `Kept ${name} for ${where}.`,
  removedNote: (name, where) => `Removed ${name} from ${where}.`,
  pasteNew: (name) => `Paste the new value for ${name}.`,
};
// A scope in words, for the list and the For picker: "Everywhere", a machine's name, "Space web".
export const secretWhere = (scope, machine, spaceName) =>
  scope === "space" ? `Space ${spaceName}` : scope === "machine" ? machine || THIS_COMPUTER : EVERYWHERE;

// ---- Machines --------------------------------------------------------------------------------------------------
export const MACHINES = {
  heading: "When new tasks wait, on every machine",
  limits: [
    { field: "start_memory", title: "Memory busy above", about: "New tasks there wait while more memory is in use." },
    { field: "start_load", title: "CPU busy above", about: "The 1-minute load, as a share of all its cores." },
    { field: "start_disk", title: "Disk busy above", about: "Its home or /tmp, whichever is fuller." },
  ],
  low: { title: "Workers run at low priority", about: "Task agents start below the Assistant and your apps, and are ended first when memory runs out." },
  cap: { title: "Memory cap per worker", about: "A worker over it is slowed down, not ended. Applies to tasks started after a change." },
  own: { title: "Limits", about: "Same as all machines.", button: "Set its own" },
  old: { title: "Set before for its spaces", about: (names) => `${names.join(", ")}. These still apply to its spaces unless a space sets its own.` },
  home: { title: "Home Assistant", make: "Make home space" },
};
// What the old machine scope could hold, as the person knows it.
export const OLD_NAMES = { coordinator: "Assistant", worker: "Workers", reviewer: "Reviewer", backup: "Backup agent",
  automations: "Run automations", merge: "Merge", review_rounds: "Review", must_fix: "Must fix", proof: "Proof",
  max_running: "Tasks at once", archive_after: "Archive Done after", worktrees: "Worktrees",
  start_notes: "When a task starts", finish_notes: "When a task finishes", base: "Base branch" };
// Home Assistant's line: on or off, and what herdr-task's home round last found there (~/.herdr/tasks/.home.json).
export function homeAbout(on, st) {
  return !on ? "Off: nobody watches its disk, load and processes."
    : st?.assistant ? "Its home space's Assistant watches its disk, load and processes."
    : st?.space ? "Its home Assistant starts when you first write to it."
    : st?.error ? "Couldn't read it now. Trying again every minute."
    : "No home space there.";
}

// ---- Window ----------------------------------------------------------------------------------------------------
// On/off switches kept in shared state (on unless false), then Add-ons (lib/addons.json's switches).
export const SWITCHES = [
  { id: "tabs", title: "Show tabs", about: "The space's tabs, in the bar at the top. The bar's buttons stay either way.",
    key: "tabbar.tabs" },
  { id: "worktrees", title: "Worktrees in the sidebar", about: "A repo's worktree spaces, listed under it.",
    key: "sidebar.worktrees" },
  { id: "unread", title: "Bold unread spaces", about: "A space whose Assistant has something new shows bold and bright.",
    key: "sidebar.unread" },
  { id: "counts", title: "Red counts", about: "What needs you, counted in red on spaces, tabs and Tasks.", key: "counts.red" },
  { id: "greens", title: "Green counts", about: "Tasks in Ready, counted in green on spaces, tabs and Tasks.", key: "counts.green" },
  { id: "filters", title: "Status filters in Tasks", about: "The row of status chips under the Tasks search.",
    key: "tasks.filters" },
  { id: "place", title: "Show space on task rows", about: "Each task row names its space and machine, dimmed on the right.",
    key: "tasks.place" },
  { id: "helpers", title: "Show subagents above the chat box", about: "The agent's own subagents at work, listed over the box.",
    key: "chat.helpers" },
  { id: "assistant", title: "Assistant in new spaces", about: "A new space opens with its Assistant's chat, else a terminal.",
    key: "coordinator.auto" },
];
export const ADDONS = "Add-ons";
// An add-on's line: its about, and what stops a flip (stop: the titles in the way).
export function addonAbout(about, now, stop) {
  if (!stop.length) return about;
  const one = stop.length === 1, names = stop.join(", ");
  return now ? `${about} ${names} need${one ? "s" : ""} it: turn ${one ? "that" : "them"} off first.`
    : `${about} Needs ${names}: turn ${one ? "it" : "them"} on first.`;
}

// ---- Web -------------------------------------------------------------------------------------------------------
export const WEB = { title: "Shepherdr on the web", link: "Link", copy: "Copy", phone: "Open it on your phone" };
// The Web page's state line: off (the Web add-on), not read yet, no service, or what the service last said (web.json).
// Served from another machine (Serve from, core/host.js): says which; a move under way says that first.
export const webState = (off, loaded, w) => (off ? "Off. Turn it on under Window › Add-ons." : !loaded ? "Reading…"
  : !w ? "Shepherdr's service isn't running here." : w.serve?.moving ? SERVE.moving(w.serve.moving)
  : w.serve?.host && !w.serve.reachable ? SERVE.unreachable(w.serve.host) : w.why ? w.why
  : w.serve?.host ? SERVE.elsewhere(w.serve.host) : "On, private to your tailnet.");

// ---- the rows' choices -----------------------------------------------------------------------------------------
export const MERGE = [["ask", "On Accept"], ["checks", "After checks pass"], ["auto", "Right away"]];
export const MUST_FIX = [["blocker", "Blockers"], ["major", "Major and up"], ["minor", "Everything"]];
export const ROUNDS = [[0, "Off"], [1, "1 round"], [2, "2 rounds"], [3, "3 rounds"]];
export const ARCHIVE = [[0, "Off"], [1, "1 day"], [3, "3 days"], [7, "1 week"], [30, "1 month"]];
export const ONOFF = [[true, "On"], [false, "Off"]];

export const DEFAULTS = { tasks: { merge: "ask", review_rounds: 0, must_fix: "major", max_running: 10, worktrees: true, archive_after: 7, proof: true }, automations: { enabled: true } };

// [section, field, label, choices | { min, max }]
export const TASK_ROWS = [
  ["tasks", "merge", "Merge", MERGE],
  ["tasks", "review_rounds", "Review", ROUNDS],
  ["tasks", "must_fix", "Must fix", MUST_FIX],
  ["tasks", "proof", "Proof", ONOFF],
  ["tasks", "max_running", "Tasks at once", { min: 1, max: 10 }],
  ["tasks", "archive_after", "Archive Done after", ARCHIVE],
  ["tasks", "worktrees", "Worktrees", ONOFF],
  ["automations", "enabled", "Run automations", ONOFF],
];

// A row's value now, Everywhere's (the file's "everywhere" layer, else the default).
export function valueOf(file, section, field) {
  const v = file?.everywhere?.[section]?.[field];
  return v ?? DEFAULTS[section]?.[field] ?? null;
}

// The file with one Everywhere value changed (null: back to the default).
export function withValue(file, section, field, value) {
  const f = JSON.parse(JSON.stringify(file ?? {}));
  f.everywhere ??= {};
  f.everywhere[section] ??= {};
  if (value === null) delete f.everywhere[section][field]; else f.everywhere[section][field] = value;
  return f;
}

// A choice's words for its value, and back.
export const wordFor = (choices, v) => (Array.isArray(choices) ? choices.find(([x]) => x === v)?.[1] ?? String(v) : String(v));
export const valueFor = (choices, word) => (Array.isArray(choices) ? choices.find(([, w]) => w === word)?.[0] : Number(word));
