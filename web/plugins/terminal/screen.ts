// The terminal's screen as herdr reads it, for xterm.js: its width in cells, one write per read, and the font that fits.
import type { TermScreen } from '@shared/types.ts'

/** font sizes in px: the fit never goes below MIN (the screen pans sideways instead) nor above MAX (a wide panel keeps
 *  it calm); a pinch goes from the whole width up to ZOOM */
export const MIN = 8
export const MAX = 13
export const ZOOM = 24
export const LINE = 1.2
/** the screen's padding, each side, in px */
export const PAD = 12

/** the pane's width in cells: herdr's, or the widest line when that is wider (the pane grew between the read and the
 *  size) or there is none (a machine on an older build sends none). A line wider than the screen would wrap and push
 *  the top line off. */
export function colsOf(screen: TermScreen) {
  const widest = Math.max(0, ...screen.ansi.split('\n').map((l) => l.replace(/\x1b\[[0-9;:?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\r/g, '').length))
  return Math.max(screen.cols ?? 0, widest) || 80
}

/** herdr's lines as one write: from a clear screen, no cursor (the CLI draws its own), rows joined as a terminal moves */
export function frame(ansi: string) {
  const lines = ansi.replace(/\r/g, '').split('\n')
  while (lines.length > 1 && !lines.at(-1)!.replace(/\x1b\[[0-9;:]*m/g, '').trim()) lines.pop()
  return { rows: lines.length, data: `\x1b[?25l\x1b[0m\x1b[H\x1b[2J${lines.join('\r\n')}` }
}

/** blank rows a live screen keeps where a longer gap folds */
export const GAP = 2

/** the rows of a live screen to fold away: every blank row below its last line, and a long blank run within it down to
 *  GAP rows. A CLI pins its prompt to the last of a tall terminal's rows; folded, it sits under the newest line. `text`
 *  says whether a row holds any, `cursor` is a row that stays. */
export function foldedRows(rows: number, cursor: number, text: (row: number) => boolean) {
  const kept = Array.from({ length: rows }, (_, y) => y === cursor || text(y))
  const folded = kept.map(() => false)
  let end = kept.lastIndexOf(true)
  for (let y = rows - 1; y > end; y--) folded[y] = true
  for (let y = end - 1, run = 0; y >= -1; y--) {
    if (y >= 0 && !kept[y]) { run++; continue }
    for (let i = y + 1 + GAP; i <= y + run; i++) folded[i] = true
    run = 0
  }
  return folded
}

/** folds what a terminal shows now, its live screen or the history scrolled back to, in its drawn `rows`; how many stay */
export function foldShown(
  t: { rows: number; buffer: { active: { baseY: number; viewportY: number; cursorY: number; getLine(y: number): { translateToString(trim: boolean): string } | undefined } } },
  rows: ArrayLike<HTMLElement>,
) {
  const b = t.buffer.active
  const folded = foldedRows(t.rows, b.viewportY === b.baseY ? b.cursorY : -1, (y) => !!b.getLine(b.viewportY + y)?.translateToString(true))
  Array.from(rows).forEach((row, y) => (row.style.display = folded[y] ? 'none' : ''))
  return folded.filter((f) => !f).length
}

/** the font size whose cells fill `width` px with `cols` cells, unclamped */
export function fitFont(width: number, cols: number, cell: number) {
  return Math.floor(((width - 2 * PAD) / (cols * cell)) * 4) / 4
}
