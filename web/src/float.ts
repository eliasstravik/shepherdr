// Where a popup (a menu, a popover) goes on the screen: by what opened it, on the side with room, always all of it in
// sight. Pure numbers, so it can be tested; Floating (ui.tsx) measures and applies it.

/** a box on the screen, in viewport pixels */
export type Box = { left: number; top: number; right: number; bottom: number }

/**
 * below-end: under its button, right edges level (a button's popover, a row's menu on a phone); up over it when only
 * there is room. below-start: the same, left edges level. beside: right of its row, its first row level with it (a
 * sidebar row's menu), left of it when only there is room. point: its corner at the pointer (a right click), as a
 * desktop's context menu, flipped left or up near the edges.
 */
export type Placement = 'below-end' | 'below-start' | 'beside' | 'point'

/** x, y: its top left corner. maxH: as tall as it may be (it scrolls past that). up: it opens upwards. left: it lies
 *  left of what opened it */
export type Spot = { x: number; y: number; maxH: number; up: boolean; left: boolean }

/** the gap kept to the screen's edges */
export const EDGE = 8

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)))

/** Where a popup w × h opens from `a` (its button, its row, or the pointer as an empty box) on a screen vw × vh. */
export function placeFloat(a: Box, w: number, h: number, place: Placement, vw: number, vh: number, gap = 6): Spot {
  const fullH = Math.max(0, vh - 2 * EDGE)
  w = Math.min(w, vw - 2 * EDGE)
  let x: number, y: number, maxH: number, up = false, left = false
  if (place === 'beside' || place === 'point') {
    const beside = place === 'beside'
    x = beside ? a.right + gap : a.left
    // no room on the right: on its left, if that has room
    if (x + w > vw - EDGE) {
      const l = beside ? a.left - gap - w : a.left - w
      if (l >= EDGE) { x = l; left = true }
    }
    // its first row level with the row (its padding above it), or its corner at the pointer
    y = beside ? a.top - gap : a.top
    maxH = fullH
    // too low: a pointer's flips up over it, a row's moves up onto the screen
    if (!beside && y + h > vh - EDGE && a.top - h >= EDGE) { y = a.top - h; up = true }
    else if (beside && y + h > vh - EDGE) up = true
  } else {
    x = place === 'below-end' ? a.right - w : a.left
    left = place === 'below-end'
    const below = vh - EDGE - (a.bottom + gap)
    const above = a.top - gap - EDGE
    // under it if it fits, else over it if that fits, else wherever there is more room
    up = h > below && (h <= above || above > below)
    maxH = up ? above : below
    y = up ? a.top - gap - Math.min(h, maxH) : a.bottom + gap
    // neither side has a useful amount of room (a short screen): the whole screen's height, over its button
    if (maxH < Math.min(h, 240)) { maxH = fullH; y = a.bottom + gap }
  }
  const shown = Math.min(h, maxH)
  return { x: clamp(x, EDGE, vw - EDGE - w), y: clamp(y, EDGE, vh - EDGE - shown), maxH, up, left }
}
