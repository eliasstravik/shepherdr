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

// A dialog with a text field (New space, #752) holds the keyboard while it is open: "dialog:<name>", its `at` renewed
// every few seconds (keepKeys()), so one gone without a word stops holding it soon. A chat behind it takes nothing back
// meanwhile, not even when its agent restarts or its pane is focused again.
export const DIALOG_FRESH = 6000;
const isDialog = (holder) => String(holder?.who ?? "").startsWith("dialog:");

export function keepKeys(who, now = Date.now()) {
  const h = shared(KEY_HOLDER);
  if (h?.who === who && now - (h.at ?? 0) < DIALOG_FRESH / 3) return;
  setShared(KEY_HOLDER, { who, at: now });
}

// The dialog closing: nobody holds the keyboard, so the chat behind it gives its box the keyboard back.
export function dropKeys(who) {
  if (shared(KEY_HOLDER)?.who === who) setShared(KEY_HOLDER, { who: null, at: Date.now() });
}

// A dialog holds the keyboard now.
export const dialogHolds = (holder, now = Date.now()) => isDialog(holder) && now - (holder.at ?? 0) < DIALOG_FRESH;

// The holder as it counts now: a dialog's that wasn't renewed is no one's.
export const liveHolder = (holder, now = Date.now()) => (isDialog(holder) && !dialogHolds(holder, now) ? null : holder);
