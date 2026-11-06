// Who last took the keyboard in the window (shared "keyboard.holder" = { who, at }): a chat's box (its areaKey(): its
// pane, or "thread" for a task's chat in the Tasks panel), or the Tasks panel's list or search ("tasks"). The Tasks
// panel is a layout block, not a pane, so Herdr still counts the Assistant chat's pane as focused while the person
// types there; that chat gives its box the keyboard back only while it is the holder (#633).
import { shared, setShared } from "herdr";

export const KEY_HOLDER = "keyboard.holder";

// A press or focus in `who`: it holds the keyboard now (written only when that changes).
export function holdKeys(who) {
  if (!who || shared(KEY_HOLDER)?.who === who) return;
  setShared(KEY_HOLDER, { who, at: Date.now() });
}

// Whether someone else than `mine` took the keyboard last.
export const keysElsewhere = (holder, mine) => Boolean(holder?.who && holder.who !== mine);
