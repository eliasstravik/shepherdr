// The cursor. Keys go to the app's own box over the terminal (the .tcap input), never to xterm's textarea, so xterm
// would always think it is unfocused and draw the hollow outline. The box's focus and blur are passed on to xterm's
// textarea as events: xterm listens for those (not for document.activeElement), so the terminal your keys go to draws a
// solid blinking cursor, and every other one the outline.

/** tell xterm's textarea it gained (true) or lost (false) the keys */
export function mirrorFocus(textarea: EventTarget | undefined | null, on: boolean) {
  textarea?.dispatchEvent(new Event(on ? 'focus' : 'blur'))
}
