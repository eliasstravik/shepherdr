// Shepherdr settings' rows as data: each row's key in ~/.config/shepherdr/settings.json, its words and its choices, and every
// title, line and button word the window's Settings say (mods/shepherdr-settings), so the window, the service and the
// web app's Settings say the same. herdr-task reads the file (herdr_task/settings.py: settings_for); its defaults are
// DEFAULTS there and here.
// Shared core: the source is core/settings.js; bin/sync-shared copies it into the mods in lib/COPIES.
import { NAMES, levelName, current, rowFor, menuFor, permAcross } from "./agents.js";
import { SERVE } from "./host.js";

// ---- the frame -------------------------------------------------------------------------------------------------
// The pages, in the window's order. space: a space's own settings have it too ("local": only a space on this computer);
// the others are one setting for every space (docs/settings.md says which and why).
export const SECTIONS = [
  { id: "agents", title: "Agents", icon: "bot", space: true },
  { id: "tasks", title: "Tasks", icon: "list-checks", space: true },
  // Everywhere's heartbeat, schedule and events, and a space's own (core/autopilot.js); a space switches it on in its
  // Assistant's header
  { id: "autopilot", title: "Autopilot", icon: "plane", space: true },
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

// ---- the level switch ------------------------------------------------------------------------------------------
// At the top of each page a space can set its own of: what the page sets, Everywhere's or one space's, and a picker
// to change it (Everywhere, then every space, by machine). A page that is one for every space says so instead.
export const LEVEL = {
  label: "Applies to",
  everywhere: "Every space, unless it sets its own.",
  space: (machine) => `Only this space, on ${machine}. What it doesn't set is inherited from Everywhere.`,
  find: "Find a space…",
  spaces: "Spaces",
  none: "No space matches.",
  global: "The same for every space.",
};

// ---- under a row -----------------------------------------------------------------------------------------------
// In a space: "Set for this space · Reset" or "Inherited from Everywhere"; on Everywhere, the spaces that set their
// own. On a machine's own rows (Machines): "Set for this machine · Reset" or "Inherited from all machines".
export const CHANGED_HERE = "Set for this space";
export const SET_FOR_MACHINE = "Set for this machine";
export const RESET = "Reset";
export const RESET_TIP = (from) => `Back to ${from}'s`;
// where an inherited value comes from: Everywhere, or the machine a value set before still comes from
export const fromWord = (level, key) => (level === "machine" ? machineLabel(key) : EVERYWHERE);
export const inheritedFrom = (from) => `Inherited from ${from}`;
export const sameAs = (level, key) => inheritedFrom(fromWord(level, key));
export const spacesOwn = (n) => (n === 1 ? "1 space sets its own" : `${n} spaces set their own`);
export const machinesOwn = (n) => (n === 1 ? "1 machine uses its own" : `${n} machines use their own`);
export const SAME_AS_ALL_MACHINES = "Inherited from all machines";

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
    heartbeat: "Autopilot's heartbeat, plain text: an Assistant on Autopilot gets it on every wake. Changes apply from the next wake.",
  },
};
export const USE_OTHER_CLI = "Use other CLI";
export const LOADING_AGENTS = "Loading agents…";
// An unset Reviewer's button: what runs, the other CLI.
export const otherCliWords = (cli) => `Other CLI (${NAMES[cli] ?? cli})`;
export const otherCli = (worker) => (worker === "codex" ? "claude" : "codex");
// Reactions (herdr-task's reactions.py): every agent (Assistants, task workers, automation runs, agent tabs) reacts to
// some of your messages with an emoji; off, none does. Kept as agents.reactions; SHEP-42 kept it as assistant.reactions
// (upgradeReactions moves it).
export const REACTIONS = { title: "Reactions", about: "Agents react to some of your messages with an emoji, as a person would." };
// Suggested next message (SHEP-186): an agent ends its reply with what you would likely say next, shown greyed out in the
// box: Enter sends it, Tab fills it in, typing replaces it. Off: no agent suggests, and none is shown.
export const SUGGESTIONS = { title: "Suggested next message", about: "Your agents suggest what you'd likely say next, greyed out in the box: Enter sends it, Tab fills it in." };
// A settings file's layers (everywhere, machines, spaces) with SHEP-42's assistant.reactions moved to agents.reactions
// (a layer that has both keeps agents'). Changes cfg in place and returns it; true when anything moved.
export function upgradeReactions(cfg) {
  const layers = [cfg?.everywhere, ...Object.values(cfg?.machines ?? {}), ...Object.values(cfg?.spaces ?? {})];
  for (const l of layers) {
    const old = l && typeof l === "object" ? l.assistant : null;
    if (!old || typeof old !== "object" || !("reactions" in old)) continue;
    if (typeof old.reactions === "boolean" && typeof l.agents?.reactions !== "boolean") l.agents = { ...(l.agents ?? {}), reactions: old.reactions };
    delete old.reactions;
    if (!Object.keys(old).length) delete l.assistant;
  }
  return cfg;
}
// Ask for a star (SHEP-79, herdr-task's star.py): once, ever, after things went well, an Assistant may show a small
// card with a plain link to Shepherdr on GitHub. Everywhere only; kept as star_prompt ({ off } before it shows, then
// { asked, answer }). Once asked it never shows again, whatever the switch says.
export const STAR = {
  title: "Ask for a GitHub star",
  about: "Once, ever, after things go well, your Assistant may show a small card with a link to Shepherdr on GitHub.",
  asked: (at, answer) => `Asked on ${new Date(at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}${answer === "github" ? " (you opened GitHub)" : answer === "no" ? " (no thanks)" : ""}. It won't ask again.`,
};
// What Everywhere's star_prompt says: whether the switch is on (off: never asks) and the line under it once asked.
export function starState(cfg) {
  const s = cfg?.everywhere?.star_prompt;
  const v = s && typeof s === "object" ? s : {};
  return { on: !v.off && !v.asked, asked: Number.isFinite(v.asked) ? v.asked : null, answer: v.answer ?? null,
    about: Number.isFinite(v.asked) ? `${STAR.about}\n${STAR.asked(v.asked, v.answer)}` : STAR.about };
}
// Feedback offers (herdr-task's feedback.py, SHEP-78): an agent that hits a problem in Shepherdr itself offers once to
// file it as a GitHub issue, filed only on your yes. Kept as agents.feedback (on unless turned off) and, Everywhere's
// only, agents.feedback_repo (the repo it files to; empty: upstream Shepherdr's).
export const FEEDBACK = {
  title: "Feedback offers",
  about: "When Shepherdr itself misbehaves, agents offer once to file it as a GitHub issue, only with your yes.",
  repoTitle: "Feedback repo",
  repoAbout: "Where feedback issues go, as owner/name. Empty: Shepherdr's own repo.",
  repo: "eliasstravik/shepherdr",
  bad: "Write it as owner/name, like eliasstravik/shepherdr.",
};
// owner/name from what was typed (owner/name or a github.com link), "" for empty, null when it isn't one.
export function feedbackRepo(v) {
  const s = String(v ?? "").trim().replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//, "").replace(/\/+$/, "").replace(/\.git$/, "");
  if (!s) return "";
  return /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(s) ? s : null;
}
export const BACKUP = { title: "Backup agent", about: "The other CLI takes over a task once when its agent can't go on." };
// The machines where the other CLI can't take over (herdr-task's check, ~/.local/state/shepherdr/cli-check.json's machines: this
// computer is ""), in one line. m: the scope's machine ("local" or its name), null for Everywhere (every machine).
export function backupProblem(checks, m, cli) {
  const here = Object.entries(checks ?? {}).filter(([k]) => m === null || k === (m === LOCAL ? "" : m));
  return here.filter(([, c]) => c?.[cli] === "missing" || c?.[cli] === "signed-out")
    .map(([k, c]) => `Can't on ${k || "this computer"}: ${NAMES[cli] ?? cli} is ${c[cli] === "missing" ? "not installed" : "signed out"}.`).join(" ");
}

// The model menu's words (mods/chat-models, settings mode) and its button's: "Opus 5.5 · 1M · High".
// the model list's headings come from core/agents.js modelSections (Pinned, Recent, Models)
export const MODEL_MENU = { reasoning: "Reasoning", fast: "Fast", permissions: "Permissions" };
const modelOf = (menus, sel) => menus?.[sel?.agent]?.models?.find((m) => m.id === sel.model) ?? null;
export function modelLabel(menus, sel) {
  const m = modelOf(menus, sel);
  const level = sel?.effort ?? m?.defaultEffort ?? null;
  return [m?.name ?? sel?.model, levelName(level), sel?.fast ? "Fast" : null].filter(Boolean).join(" · ") || "Choose a model";
}
// What the agents offer, from each CLI's own settings (agents.js parseDefaults) and which are installed:
// { menus, permDefault, defaults } (defaults: the first installed CLI's own, what an unset role runs).
export function choicesFrom(dflts, installed = { claude: true, codex: true }) {
  const menus = Object.fromEntries(["claude", "codex"].filter((k) => installed[k]).map((k) => [k, menuFor(k, dflts[k])]));
  const permDefault = { claude: dflts.claude?.mode ?? "manual", codex: "auto" };
  const first = menus.claude ? "claude" : Object.keys(menus)[0] ?? "claude";
  const c = current(first, [], {}, dflts[first]);
  const model = rowFor(first, c) ?? menus[first]?.models?.[0]?.id ?? null;
  return { menus, permDefault, defaults: { agent: first, model, effort: c.effort ?? null, fast: false, perm: permDefault[first] } };
}
// What a role's model button starts from: its own choice, else for the Reviewer the other CLI, else the defaults.
export function roleSel(role, own, choices, worker) {
  if (own) return { sel: { ...own }, unset: false };
  const o = otherCli(worker);
  if (role === "reviewer" && choices?.menus?.[o])
    return { sel: { agent: o, model: choices.menus[o].models[0]?.id ?? null, effort: null, fast: false, perm: choices.permDefault?.[o] ?? null }, unset: true };
  return { sel: choices?.defaults ? { ...choices.defaults } : null, unset: true };
}
// A model picked in the menu: the effort and speed stay where it has them; another agent brings its own permission
// modes, the nearest to the one chosen (agents.js permAcross).
export function chooseModel(menus, permDefault, sel, agent, id) {
  const m = menus?.[agent]?.models?.find((x) => x.id === id);
  if (!m) return sel;
  const next = { ...sel, agent, model: id };
  if (next.effort && !m.efforts.includes(next.effort)) next.effort = null;
  if (!m.fast) next.fast = false;
  if (agent !== sel.agent) {
    next.perm = permAcross(sel.perm, agent, permDefault);
    next.fast = false;
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
// Branch names (tasks.branch, #570): a folder's new task branches, Everywhere's or a space's own; herdr-task fills
// it in (settings.py BRANCH_PATTERN, branch_pattern_problem). A task's own --branch wins.
export const BRANCH = {
  title: "Branch names",
  about: "New tasks' branches. {n} is its number, {key} its id (SHEP-4), {slug} its title.",
  pattern: "task/{n}-{slug}",
};
// Why a Branch names pattern can't be used, or "" (herdr-task's branch_pattern_problem says the same).
export function branchPattern(pattern) {
  const p = String(pattern ?? "").trim();
  if (!p) return "";
  if (!p.includes("{n}") && !p.includes("{key}")) return "Put {n} or {key} in it, so each task's branch is its own.";
  if (/\{(?!(?:n|key|slug)\})[^}]*\}/.test(p)) return "Only {n}, {key} and {slug} can be filled in.";
  const sample = p.replaceAll("{n}", "4").replaceAll("{key}", "ABC-4").replaceAll("{slug}", "fix-login");
  if (/^[-/]|[/.]$|\.lock$|[\s~^:?*[\\]|\.\.|@\{|\/\/|\/\./.test(sample)) return "That isn't a name git allows for a branch.";
  return "";
}

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
  // Kept on: the machine whose vault every machine's agents and voice calls use (shepherdr secrets move-to)
  keptOn: "Kept on", keptHere: "This computer", thisOne: "this computer",
  keptAbout: "Every machine's agents and voice calls get them from there. Pick an always-on machine.",
  // nobody picked one: they follow Serve from (core/secrets.js followTo)
  sameAsServe: (name) => `Same as Serve from: ${name}`,
  sameAbout: "They stay with the machine serving the web app, and move with it. Every machine's agents and voice calls get them from there. Pick another machine to keep them there instead.",
  forNow: (name) => `${name}, for now`,
  following: (to) => `They follow Serve from: they move to ${to} on their own, with a backup, once both machines are on.`,
  unreachable: (name) => `Can't reach ${name}, which keeps them: agents on other machines can't get secrets until it's back.`,
  notLinked: "A machine not linked from here keeps them.",
  moveConfirm: (name) => `Keep secrets on ${name}?`,
  moveDetail: (name, from) => `Every secret is copied to ${name}, checked, and then used from there by every machine. ${from} keeps a backup copy; moving them back brings back what was added since.`,
  moveVerb: "Move them",
  moving: (name) => `Moving them to ${name}…`,
  offline: "offline",
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
  start_notes: "When a task starts", finish_notes: "When a task finishes", base: "Base branch", branch: "Branch names", agents: "Reactions" };
// Home Assistant's line: on or off, and what herdr-task's home round last found there (~/.local/share/shepherdr/tasks/.home.json).
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
// Usage insights' Delete, under its switch (the window's and the web's Settings > Window): every machine's log.
export const INSIGHTS = {
  title: "Delete usage data",
  about: "Deletes the usage log on this computer and on your other machines. It starts again from now while the add-on is on.",
  button: "Delete",
  done: "Deleted.",
  missed: (names) => `Deleted here. Not reached: ${names}. Try again when they're online.`,
};
// An add-on's line: its about, and what stops a flip (stop: the titles in the way).
export function addonAbout(about, now, stop) {
  if (!stop.length) return about;
  const one = stop.length === 1, names = stop.join(", ");
  return now ? `${about} ${names} need${one ? "s" : ""} it: turn ${one ? "that" : "them"} off first.`
    : `${about} Needs ${names}: turn ${one ? "it" : "them"} on first.`;
}

// ---- Web -------------------------------------------------------------------------------------------------------
export const WEB = { title: "Shepherdr on the web", link: "Link", copy: "Copy", copied: "Copied", phone: "Open it on your phone" };
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

export const DEFAULTS = { tasks: { merge: "ask", review_rounds: 0, must_fix: "major", max_running: 10, worktrees: true, archive_after: 7, proof: true }, automations: { enabled: true },
  agents: { reactions: true, suggestions: true, feedback: true, feedback_repo: "" } };

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
