// #1538: Android keyboards (Gboard) hold the word being typed, or a dictated phrase, as an unfinished composition.
// Send empties the box while it is unfinished, and the keyboard then writes it back into the empty box. So Send first
// ends the composition (the box loses and takes the keyboard again in one go), and for a moment after a send drops the
// one change that puts the sent words, or their last few, back into the empty box. Any other change ends that watch.

export interface Sent { text: string; at: number }

/** let the keyboard finish what it is writing in the box, keeping the box focused */
export function endComposition(box: HTMLTextAreaElement | null) {
  if (!box || document.activeElement !== box) return
  box.blur()
  box.focus({ preventScroll: true })
}

/** the keyboard putting back what was just sent: the box was empty, and the change is the sent text or its last
 *  whole words (a first letter typed that only ends the sent text is new typing) */
export function isEcho(sent: Sent | null, was: string, value: string, now: number) {
  if (!sent || was || now - sent.at > 2000) return false
  const v = value.trim(), s = sent.text.trim()
  return !!v && s.endsWith(v) && (s.length === v.length || /\s/.test(s[s.length - v.length - 1]))
}
