// How a terminal fits its pane: the page asks for as many columns and rows as fit at a readable font, so lines wrap
// at the pane's edge instead of running off it. Only when something else holds the terminal at another size (another
// viewer resized it after this page) does the font shrink to fit, down to 8 px, and only then can it pan.

/** the font a terminal is drawn at: 12 px in a narrow pane (a phone), else 13 */
export const fontFor = (width: number) => (width < 480 ? 12 : 13)
export const LINE = 1.25

/** the columns and rows that fit a box (its inner size, px) at its font; cell: a character's width per px of font */
export function fitGrid(width: number, height: number, cell: number): { cols: number; rows: number } {
  const f = fontFor(width)
  return { cols: Math.max(20, Math.min(400, Math.floor(width / (f * cell)))), rows: Math.max(5, Math.min(200, Math.floor(height / (f * LINE)))) }
}

/** the font that shows a terminal of cols × rows whole in the box: the normal one when it fits, else smaller, never under 8 */
export function shrinkTo(width: number, height: number, cols: number, rows: number, cell: number): number {
  const f = fontFor(width)
  const w = Math.floor((width / (cols * cell)) * 4) / 4
  const h = Math.floor((height / (rows * LINE)) * 4) / 4
  return Math.max(8, Math.min(f, w, h))
}

/** The row of terminal keys (esc, tab, ctrl, arrows) shows on a phone and on any device with a touch screen, whatever
 *  its width: an unfolded phone or a tablet has no esc key on its on-screen keyboard. */
export function showKeys(phone: boolean, coarse: boolean) {
  return phone || coarse
}

/** whole lines to scroll for a wheel or a finger's move of `delta` px, carrying the rest: [lines, rest] */
export function linesFor(carry: number, delta: number, linePx: number): [number, number] {
  const total = carry + delta
  const lines = Math.trunc(total / linePx)
  return [lines, total - lines * linePx]
}
