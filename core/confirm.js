// The window's confirm and prompt dialogs (mods/confirm-chat, mods/prompt-chat) as they are asked: their words, for the
// web app's twins (web/src/rowmenu.tsx Dialog). The window's askers (lib/coordinator.js, mods/spaces-chat/popups.js)
// say the same words; core/confirm.test.js checks they do.

// A confirm's defaults, and a prompt's: the button says what it does, never "Confirm".
export const CONFIRM = { title: "Are you sure?", verb: "OK", cancel: "Cancel" };
export const PROMPT = { label: "Name", verb: "Save", cancel: "Cancel" };

// Close a space (its menu's Close…, a tab bar's last tab): then Herdr's close, confirmed.
export const CLOSE_SPACE = {
  title: (name) => (name && name !== "~" ? `Close “${name}”?` : "Close this space?"),
  detail: "Its tabs close and every program in them ends.",
  verb: "Close space",
};

// Rename a tab: its field holds the name given (empty when nobody named it: it keeps its number, its name the
// placeholder).
export const RENAME_TAB = { title: "Rename tab", label: PROMPT.label, verb: PROMPT.verb };
