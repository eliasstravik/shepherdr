import { expect, test } from 'bun:test'
import { fitGrid, following, fontFor, footTop, lastPaintedRow, linesFor, shrinkTo, showKeys, sizeTaken } from './fit.ts'

const CELL = 0.6 // a monospace character is about 0.6 of its font size wide

test('a menu at the top stays in view when the terminal parks its hidden cursor at the bottom', () => {
  const text = (row: number) => row === 12 ? 'enter confirm · esc skip' : ' '
  const last = lastPaintedRow(120, 118, false, text)
  expect(last).toBe(12)
  expect(footTop(last, 17, 480, 1576)).toBe(0)
  expect(lastPaintedRow(120, 118, true, text)).toBe(118)
})

test('the terminal asks for the columns and rows that fit its pane, at a readable font', () => {
  // a phone (12 px): 362 px wide fits 50 columns
  expect(fitGrid(362, 600, CELL)).toEqual({ cols: 50, rows: 40 })
  // an unfolded fold beside the Tasks panel, then with the panel closed: more columns, never sideways
  expect(fitGrid(1100, 900, CELL).cols).toBe(141)
  expect(fitGrid(1750, 900, CELL).cols).toBe(224)
  // the keyboard coming up takes rows, not columns
  expect(fitGrid(1100, 400, CELL)).toEqual({ cols: 141, rows: 24 })
  expect(fontFor(362)).toBe(12)
  expect(fontFor(1100)).toBe(13)
})

test('the size stays within what the server accepts', () => {
  expect(fitGrid(50, 20, CELL)).toEqual({ cols: 20, rows: 5 })
  expect(fitGrid(100000, 100000, CELL)).toEqual({ cols: 400, rows: 200 })
})

test('held at another size by someone else, the font shrinks to show it whole, never under 8 px', () => {
  // the page's own size: the normal font
  expect(shrinkTo(1100, 400, 141, 24, CELL)).toBe(13)
  // 200 columns in a pane that fits 141: smaller
  expect(shrinkTo(1100, 900, 200, 40, CELL)).toBe(9)
  // far too wide: 8 px, and only then it pans
  expect(shrinkTo(362, 600, 200, 40, CELL)).toBe(8)
  // an agent's tall screen scrolls instead: only its width shrinks the font
  expect(shrinkTo(1100, Infinity, 141, 120, CELL)).toBe(13)
})

test('it opens at the last line shown, scrolled to the end, and follows only until you scroll up', () => {
  // 120 rows of 16 px in a 640 px box, the last line on row 119: the very end
  const max = 120 * 16 + 16 - 640
  expect(footTop(119, 16, 640, max)).toBe(max)
  // a short screen (last line on row 9 of 120): that line at the foot, not the blank rows under it
  expect(footTop(9, 16, 640, max)).toBe(0)
  expect(footTop(59, 16, 640, max)).toBe(60 * 16 + 16 - 640)
  // scrolled up by more than a row: it stays where you are; back at the foot (or a row from it): it follows
  expect(following(max - 400, max, 16)).toBe(false)
  expect(following(max - 10, max, 16)).toBe(true)
  expect(following(max, max, 16)).toBe(true)
})

test('the key row shows on any touch screen, at every width, and on a phone', () => {
  expect(showKeys(false, true)).toBe(true) // an unfolded fold or a tablet: wide, but touch
  expect(showKeys(true, true)).toBe(true)
  expect(showKeys(true, false)).toBe(true)
  expect(showKeys(false, false)).toBe(false) // a computer with a mouse and keyboard
})

test('scrolling moves whole lines and carries the rest, so slow swipes still scroll', () => {
  expect(linesFor(0, 40, 16)).toEqual([2, 8])
  expect(linesFor(8, 10, 16)).toEqual([1, 2])
  expect(linesFor(0, -40, 16)).toEqual([-2, -8])
  expect(linesFor(0, 5, 16)).toEqual([0, 5])
})

test('a terminal on two pages: a size this page did not ask for means another page took it (#1498)', () => {
  // this page asked for 50x40 and got it: still its size
  expect(sizeTaken('50x40', '50x40', 50, 40)).toBe(false)
  // the desktop then set 140x30: this page only shrinks to fit from now on
  expect(sizeTaken('50x40', '50x40', 140, 30)).toBe(true)
  // the size it had when this page opened it takes nothing; another page's before this one asked does
  expect(sizeTaken('', '', 80, 24, true)).toBe(false)
  expect(sizeTaken('', '', 140, 30)).toBe(true)
  // an ask on its way: a size arriving meanwhile takes nothing
  expect(sizeTaken('50x40', '60x40', 50, 40)).toBe(false)
})
