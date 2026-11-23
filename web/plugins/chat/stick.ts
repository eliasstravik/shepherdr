/** The chat stays at its newest message while it is there (stuck): when what it shows grows (a picture loaded, a card
 *  came) and when its window gets shorter (the box grew, the suggested replies came above it), its end stays in view.
 *  A ResizeObserver runs after layout and before paint, so the move never shows as a jump. No imports: the layout test
 *  (test/test_reply_row.py) runs this very file in a real Chrome. */
export function keepAtEnd(sc: HTMLElement, box: HTMLElement, stuck: () => boolean): () => void {
  const ro = new ResizeObserver(() => {
    if (stuck()) sc.scrollTop = sc.scrollHeight
  })
  ro.observe(box)
  ro.observe(sc)
  return () => ro.disconnect()
}

/** The suggested replies' row scrolls sideways when its bubbles don't fit: a soft fade at each edge where more
 *  continues (--fl, --fr, read by .sugs's mask), none at an edge it has reached. A new set starts at its first bubble. */
export function rowEdges(row: HTMLElement): () => void {
  row.scrollLeft = 0
  const set = () => {
    const x = Math.abs(row.scrollLeft)
    row.style.setProperty('--fl', x > 1 ? '24px' : '0px')
    row.style.setProperty('--fr', x + row.clientWidth < row.scrollWidth - 1 ? '24px' : '0px')
  }
  set()
  row.addEventListener('scroll', set, { passive: true })
  const ro = new ResizeObserver(set)
  ro.observe(row)
  return () => {
    row.removeEventListener('scroll', set)
    ro.disconnect()
  }
}
