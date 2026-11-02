// The terminal is drawn at the pane's own size: herdr's lines go in as one write, never wrapped, and the font scales to
// the pane's columns.
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { colsOf, fitFont, foldedRows, foldShown, frame, GAP, MAX, MIN, PAD } from '../plugins/terminal/screen.ts'

describe('the screen', () => {
  test("its width is the pane's; from an older machine (no size), the widest line without its colours", () => {
    expect(colsOf({ ansi: 'hi', cols: 138, rows: 43 })).toBe(138)
    // the pane grew between the read and the size: the line still fits
    expect(colsOf({ ansi: 'x'.repeat(140), cols: 138, rows: 43 })).toBe(140)
    expect(colsOf({ ansi: '\x1b[38;2;1;2;3mabcdef\x1b[0m\r\nabc' })).toBe(6)
    expect(colsOf({ ansi: '' })).toBe(80)
  })

  test("a live screen's blank rows fold: all below its last line, a long run down to two, the cursor's row stays", () => {
    /** x a line, c the cursor, . a blank row; what shows */
    const shown = (screen: string) => {
      const rows = [...screen]
      const folded = foldedRows(rows.length, rows.indexOf('c'), (y) => rows[y] === 'x')
      return rows.filter((_, y) => !folded[y]).join('')
    }
    expect(GAP).toBe(2)
    // a CLI's prompt pinned to the last row of a tall terminal comes up under its newest line
    expect(shown('x' + '.'.repeat(100) + 'c')).toBe('x..c')
    // a program that has only drawn its first rows
    expect(shown('xxc' + '.'.repeat(100))).toBe('xxc')
    expect(shown('c....')).toBe('c')
    // short gaps are the program's own
    expect(shown('x..x')).toBe('x..x')
    expect(shown('.'.repeat(20) + 'x')).toBe('..x')
    expect(shown('x.....x.....c....')).toBe('x..x..c')
  })

  test('scrolled back, the history shows whole: a fold follows the rows on show, not the live screen', () => {
    const lines = ['old', 'old', 'old', 'old', 'old', 'live', '', '', '', '', '> prompt']
    const shown = (viewportY: number) => {
      const rows = Array.from({ length: 6 }, () => ({ style: { display: '' } }))
      const t = { rows: 6, buffer: { active: { baseY: 5, viewportY, cursorY: 5, getLine: (y: number) => ({ translateToString: () => lines[y] ?? '' }) } } }
      return [foldShown(t, rows as unknown as HTMLElement[]), rows.map((r) => r.style.display)]
    }
    expect(shown(5)).toEqual([4, ['', '', '', 'none', 'none', '']])
    expect(shown(0)).toEqual([6, ['', '', '', '', '', '']])
  })

  test('one write from a clear screen, no cursor, rows joined as a terminal moves; blank rows at the end go', () => {
    const { rows, data } = frame('one\r\n\x1b[1mtwo\x1b[0m\r\n\r\n   \x1b[0m\r\n')
    expect(rows).toBe(2)
    expect(data).toBe('\x1b[?25l\x1b[0m\x1b[H\x1b[2Jone\r\n\x1b[1mtwo\x1b[0m')
    expect(frame('').rows).toBe(1)
  })

  test('the font fills the width with the columns, padding aside', () => {
    // 138 columns of 0.6 px per px of font in a 560 px panel
    const f = fitFont(560, 138, 0.6)
    expect(f * 0.6 * 138).toBeLessThanOrEqual(560 - 2 * PAD)
    expect((f + 0.25) * 0.6 * 138).toBeGreaterThan(560 - 2 * PAD)
    // a phone's is below the floor: the screen pans sideways; a wide desktop's is above the cap
    expect(fitFont(390, 138, 0.6)).toBeLessThan(MIN)
    expect(fitFont(1600, 80, 0.6)).toBeGreaterThan(MAX)
  })
})
