import { expect, test } from 'bun:test'
import { IMAGE, join, parentOf, sizeWords } from './paths.ts'

test('paths inside a space folder, and sizes in words', () => {
  expect(join('', 'a')).toBe('a')
  expect(join('a/b', 'c')).toBe('a/b/c')
  expect(parentOf('a')).toBe('')
  expect(parentOf('a/b/c')).toBe('a/b')
  expect(IMAGE.test('x/shot.PNG')).toBe(true)
  expect(IMAGE.test('notes.md')).toBe(false)
  expect(sizeWords(12)).toBe('12 B')
  expect(sizeWords(2048)).toBe('2 KB')
  expect(sizeWords(3.5 * 1024 * 1024)).toBe('3.5 MB')
})
