/** A text box grows with its text up to six lines (164 px), then scrolls inside itself. To measure its text it is
 *  first set back to one line (44 px): that must not move anything around it, so its frame is held at its present
 *  height meanwhile. Unheld, the box's moment at one line made the chat above it taller for that instant, and Safari
 *  took it as the chat's end coming nearer: it scrolled the chat up by the box's extra lines on every key, and the
 *  chat's own "stay at the end" pulled it back down, so the chat flickered while you typed. No imports: the layout
 *  test (test/test_box_grow.py) runs this very file in a real Chrome. */
export function fitBox(t: HTMLTextAreaElement) {
  const frame = t.parentElement
  if (frame) frame.style.minHeight = `${frame.offsetHeight}px`
  t.style.height = '44px'
  t.style.height = `${Math.min(164, t.scrollHeight)}px`
  if (frame) frame.style.minHeight = ''
}
