import { expect, test } from 'bun:test'
import { fitGrid, fontFor, linesFor, shrinkTo, showKeys } from './fit.ts'

const CELL = 0.6 // a monospace character is about 0.6 of its font size wide

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
