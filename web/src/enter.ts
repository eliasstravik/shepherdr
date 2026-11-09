// Enter in a box that sends something (a chat's message box, a card's reply or note, Mark up's note).
// A computer sends on Enter and adds a new line on Shift+Enter; a phone (a touch-only device typing on its on-screen
// keyboard) adds a new line on Enter and sends only with the Send button. Decided by what the device has, never by
// the window's width: a narrow desktop window still sends, and a tablet with a hardware keyboard (no on-screen one
// coming up) sends as a computer does.

/** No mouse or trackpad anywhere, only a finger: a phone, or a tablet without a trackpad */
export function touchOnly(): boolean {
  if (typeof matchMedia !== 'function') return false
  return !matchMedia('(any-pointer: fine)').matches && matchMedia('(any-pointer: coarse)').matches
}

export type EnterKey = { key: string; shiftKey: boolean; isComposing?: boolean; keyCode?: number }

/** Does this key send? Enter alone (not Shift+Enter, not while an IME is composing a word), unless typed on a
 *  touch-only device's on-screen keyboard. Ctrl/Cmd+Enter sends too (held until the agent is free, where a box has
 *  that). */
export function enterSends(e: EnterKey, touch: boolean, keyboardUp: boolean): boolean {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return false
  return !(touch && keyboardUp)
}

/** enterSends for a React key event on this device as it is now (keyboardUp: the UI's `keyboard`) */
export function sendsNow(e: { key: string; shiftKey: boolean; nativeEvent: KeyboardEvent }, keyboardUp: boolean): boolean {
  return enterSends({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.nativeEvent.keyCode }, touchOnly(), keyboardUp)
}

/** the return key's label on an on-screen keyboard: a new line where Enter makes one, else Send */
export function enterHint(): 'enter' | 'send' {
  return touchOnly() ? 'enter' : 'send'
}
