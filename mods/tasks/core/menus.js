// The menus Shepherdr shows, as data: each item's id and words, in order, given what it is for. The window's mods and
// the web app build their menus from these lists (each does an item its own way), so both offer the same things in
// the same words. A label ends in "…" when it opens a dialog.
// Shared core: the source is core/menus.js.

const sep = { sep: true };

// The sidebar: a machine header's +, a space's menu, a machine header's own menu, a section's.
export const addMenu = () => [
  { id: "new-space", label: "New space", icon: "plus" },
  { id: "new-section", label: "New section", icon: "folder-plus" },
];

// git: null (not a repo), "main" (a repo's own folder) or "linked" (one of its worktrees). assistant: false when the
// space has no Assistant's tab yet (on any machine): Start Assistant opens it, taking one already running there.
export function spaceMenu({ unread = false, pinned = false, git = null, assistant = true } = {}) {
  return [
    // its Assistant's Notify, picked in place (the menu stays open), a quiet note under it
    { id: "notify", label: "Notify", setting: true, note: "Tasks alert either way." },
    sep,
    ...(assistant ? [] : [{ id: "assistant", label: "Start Assistant", icon: "network" }]),
    ...(unread ? [{ id: "read", label: "Mark as read", icon: "check-check" }] : []),
    pinned ? { id: "unpin", label: "Unpin", icon: "pin-off" } : { id: "pin", label: "Pin", icon: "pin" },
    { id: "rename", label: "Rename…", icon: "square-pen" },
    { id: "settings", label: "Space settings…", icon: "settings" },
    ...(git ? [sep, { id: "worktree-new", label: "New worktree", icon: "git-branch" }, { id: "worktree-open", label: "Open worktree", icon: "git-branch" }] : []),
    ...(git === "linked" ? [{ id: "worktree-remove", label: "Remove worktree", icon: "git-branch" }] : []),
    sep,
    { id: "close", label: "Close…", icon: "x" },
  ];
}

export const machineMenu = () => [{ id: "rename", label: "Rename…", icon: "square-pen" }];

export const sectionMenu = () => [
  { id: "rename", label: "Rename…", icon: "square-pen" },
  // at once; its toast offers Undo
  { id: "delete", label: "Delete", icon: "trash-2" },
];

// A task row's menu (the Tasks panel): its pin; a task not started yet (status: todo, queued or scheduled, SHEP-38) also
// starts by itself later: a few times to pick (herdr-task edit's --in or --at words), Other time… (typed: the web's), and
// a scheduled one Start now and Unschedule. A heading item has no id.
export const SCHEDULE_PICKS = [
  { label: "In 1 hour", in: "1h" }, { label: "In 3 hours", in: "3h" },
  { label: "Tomorrow 9:00", at: "tomorrow 9:00" }, { label: "Monday 9:00", at: "mon 9:00" },
];
export const taskMenu = ({ pinned = false, status = null } = {}) => {
  const later = ["todo", "queued", "scheduled"].includes(status);
  return [
    ...(later ? [{ heading: status === "scheduled" ? "Reschedule" : "Start later" },
      ...SCHEDULE_PICKS.map((p) => ({ id: "schedule", icon: "clock", ...p })),
      { id: "schedule-other", label: "Other time…", icon: "clock", typed: true }] : []),
    ...(status === "scheduled" ? [sep, { id: "start-now", label: "Start now", icon: "play" }, { id: "unschedule", label: "Unschedule", icon: "x" }] : []),
    ...(later ? [sep] : []),
    pinned ? { id: "unpin", label: "Unpin", icon: "pin-off" } : { id: "pin", label: "Pin", icon: "pin" },
  ];
};
// What Other time… asks (the web's field under the picks): its words, an example, the button's.
export const SCHEDULE_OTHER = { placeholder: "fri 8:15, 18:00 or 6h", label: "When it starts", button: "Schedule" };

// The tab bar: a tab's menu (right-click on a tab; the web's touch screens also open it from the shown tab's ⋯). Rename…,
// Edit instructions… on an Assistant's tab, Switch agent (a submenu of the installed agents) while an agent runs in it
// and one is installed, Restart when it can restart, then Close tab under a line.
export const tabMenu = ({ assistant = false, switchable = false, restartable = false } = {}) => [
  { id: "rename", label: "Rename…", icon: "square-pen" },
  ...(assistant ? [{ id: "instructions", label: "Edit instructions…", icon: "file-text" }] : []),
  ...(switchable ? [{ id: "switch", label: "Switch agent", icon: "arrow-left-right", submenu: true }] : []),
  ...(restartable ? [{ id: "restart", label: "Restart", icon: "rotate-ccw" }] : []),
  sep,
  { id: "close", label: "Close tab", icon: "x" },
];

// The app menu (the window's menu with no tab or pane under it): New space, Keybinds (our own keys list), then Herdr's
// themes (the window's own look: the web follows the device's light or dark instead).
export const appMenu = () => [
  { id: "new-space", label: "New space", icon: "plus" },
  sep,
  { id: "keybinds", label: "Keybinds", icon: "keyboard" },
  sep,
  ...[["graphite", "Graphite"], ["ink", "Ink"], ["moss", "Moss"], ["atom-one-dark", "Atom One Dark"]].map(([theme, name]) => ({ id: `theme:${theme}`, label: `Theme: ${name}`, icon: "settings", theme, window: true })),
];

// Switch agent's submenu: its heading, while the installed agents are looked up, and the one the tab runs now.
export const SWITCH_AGENT = { title: "Switch agent", loading: "Checking installed agents…", current: "Current" };

// The tab bar's + menu: its fixed rows' words, the Assistant's row, and which agents it offers to start.
export const NEW_MENU = {
  terminal: "Terminal", agents: "Start an agent", loading: "Checking installed agents…", failed: "Couldn't load agents",
  notInstalled: "Not installed", space: "New space", worktreeNew: "New worktree…", worktreeOpen: "Open worktree…",
};
// open: the space has its Assistant's tab (the row goes to it). On another machine's space too: its Assistant runs
// there, from that machine's assistant template. Its key is C.
export const assistantRow = ({ open = false } = {}) => ({ label: open ? "Show Assistant" : "Assistant", hint: open ? "" : "C", enabled: true });
// The installed agents (keys 1 to 9, in order), then at most two that aren't.
export const agentChoices = (agents) => [...agents.filter((a) => a.installed), ...agents.filter((a) => !a.installed).slice(0, 2)];
export const agentHint = (a, i) => (a.installed ? (i < 9 ? String(i + 1) : "") : NEW_MENU.notInstalled);

// A tab's name in the tab bar: the name given, else (Herdr's own "tb3", or none) what runs in it, else "Terminal".
export const tabName = (name, program = null) => (!name || /^tb\d+$/.test(name) ? program || "Terminal" : name);

// The pane header's × on an agent's chat asks first, in place of its buttons.
export const endAgent = (program) => ({ ask: `End ${program}?`, tip: `End ${program}`, cancel: "Cancel", verb: "End agent" });

// What a machine is called: the name the person gave it (the sidebar's), else its own; this computer "This computer".
export const machineLabel = (machine, given = null) => given || machine || "This computer";
