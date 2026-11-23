import { expect, test } from 'bun:test'
import { PIC, picBox } from './thumbs.tsx'

// a sent picture's box is known before it draws, so nothing under it moves when it does
test('a sent picture keeps its box before it has loaded', () => {
  expect(picBox(4000, 3000)).toEqual({ width: PIC, maxWidth: '100%', height: 'auto', aspectRatio: '4000 / 3000' })
  expect(picBox(1000, 2000).width).toBe(PIC / 2)
  expect(picBox(100, 50).width).toBe(100)
})
