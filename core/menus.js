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

// git: null (not a repo), "main" (a repo's own folder) or "linked" (one of its worktrees).
export function spaceMenu({ unread = false, pinned = false, git = null } = {}) {
  return [
    // its Assistant's Notify, picked in place (the menu stays open)
    { id: "notify", label: "Notify", setting: true },
    sep,
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

// A task row's menu (the Tasks panel): only its pin.
export const taskMenu = ({ pinned = false } = {}) => [pinned ? { id: "unpin", label: "Unpin", icon: "pin-off" } : { id: "pin", label: "Pin", icon: "pin" }];

// What a machine is called: the name the person gave it (the sidebar's), else its own; this computer "This computer".
export const machineLabel = (machine, given = null) => given || machine || "This computer";
