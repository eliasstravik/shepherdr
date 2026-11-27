// How a terminal fits its pane: the page asks for as many columns and rows as fit at a readable font, so lines wrap
// at the pane's edge instead of running off it. Only when something else holds the terminal at another size (another
// viewer resized it after this page) does the font shrink to fit, down to 8 px, and only then can it pan.

/** the font a terminal is drawn at: 12 px in a narrow pane (a phone), else 13 */
export const fontFor = (width: number) => (width < 480 ? 12 : 13)
export const LINE = 1.25

/** the columns and rows that fit a box (its inner size, px) at its font; cell and line: a character's width and a
 *  row's height per px of font, as the terminal really draws them */
export function fitGrid(width: number, height: number, cell: number, line = LINE): { cols: number; rows: number } {
  const f = fontFor(width)
  return { cols: Math.max(20, Math.min(400, Math.floor(width / (f * cell)))), rows: Math.max(5, Math.min(200, Math.floor(height / (f * line)))) }
}

/** the font that shows a terminal of cols × rows whole in the box: the normal one when it fits, else smaller, never under 8 */
export function shrinkTo(width: number, height: number, cols: number, rows: number, cell: number, line = LINE): number {
  const f = fontFor(width)
  const w = Math.floor((width / (cols * cell)) * 4) / 4
  const h = Math.floor((height / (rows * line)) * 4) / 4
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

/** the box's scroll position that shows the last row with something on it (0-based) at its foot: rows of rowPx, 8 px
 *  of padding above and below, never past the end */
export function footTop(last: number, rowPx: number, boxHeight: number, maxTop: number) {
  return Math.min(maxTop, Math.max(0, Math.ceil((last + 1) * rowPx + 16 - boxHeight)))
}

/** Full-screen menus can park their hidden cursor below every visible line. */
export function lastPaintedRow(rows: number, cursorRow: number, cursorVisible: boolean, text: (row: number) => string | undefined) {
  const first = cursorVisible ? cursorRow : 0
  for (let row = rows - 1; row > first; row--) {
    if (text(row)?.trim()) return row
  }
  return first
}

/** after you scroll: does the terminal follow new output again? Only within a row of the foot, or below it */
export function following(scrollTop: number, foot: number, rowPx: number) {
  return scrollTop >= foot - rowPx
}

/** A terminal open on two pages (a phone and a desktop) has one size, set by the page you used last. A size arriving
 *  that this page didn't ask for, while it isn't waiting on an ask of its own, means another page set it: this page
 *  then only shrinks to fit until you use it again. asked/wanted: the size this page asked for and the one it is about
 *  to ask for ('cols x rows', '' for none); first: the size the terminal had when this page opened it, which takes
 *  nothing. */
export function sizeTaken(asked: string, wanted: string, cols: number, rows: number, first = false) {
  return !first && wanted === asked && `${cols}x${rows}` !== asked
}
