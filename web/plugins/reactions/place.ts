// Places a message's reaction chips as Claude Duet does: the first chip's middle on the bubble's top corner that faces
// the middle of the chat (the CSS puts it near there; this centres it on the corner whatever the chip's width), the
// rest growing toward the middle. Where the bubble fills the column (a side panel's narrow chat), they move in by just
// enough to stay on the bubble's top edge, inside the column. Plain DOM, no imports: test/test_reaction_chip.py runs
// it in a real layout.

/** centre the first chip on the bubble's corner, then keep the row inside the column (its padding aside) */
export function fit(rxs: HTMLElement) {
  const col = rxs.closest('.msgs')
  const b = rxs.parentElement?.querySelector('.b')
  const first = rxs.firstElementChild
  if (!col || !b || !first) return
  rxs.style.removeProperty('--rx-dx')
  const r = rxs.getBoundingClientRect()
  const f = first.getBoundingClientRect()
  const br = b.getBoundingClientRect()
  const c = col.getBoundingClientRect()
  const s = getComputedStyle(col)
  const lo = c.left + parseFloat(s.paddingLeft || '0')
  const hi = c.right - parseFloat(s.paddingRight || '0')
  let dx = (rxs.closest('.bw.mine') ? br.left : br.right) - (f.left + f.right) / 2
  if (r.right + dx > hi) dx = hi - r.right
  if (r.left + dx < lo) dx = lo - r.left
  if (Math.abs(dx) >= 0.25) rxs.style.setProperty('--rx-dx', `${dx}px`)
}
