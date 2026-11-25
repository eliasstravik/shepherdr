// The row of keys under a terminal (esc, tab, ctrl, the arrows, enter). A finger's tap sends its key and leaves the
// on-screen keyboard as it was, up or down: the press never moves focus (the row's mousedown is cancelled), and the
// terminal's box is focused afterwards only for a mouse click or a key press on the button, where there is no on-screen
// keyboard to bring up.

/** after a key of the row is pressed with this pointer ('' for a keyboard), does the terminal's box take the keys? */
export const focusAfterKey = (pointer: string) => pointer !== 'touch' && pointer !== 'pen'
