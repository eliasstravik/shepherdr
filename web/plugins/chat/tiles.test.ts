import { expect, test } from 'bun:test'
import { shortName, sizeWords, tileOf } from './tiles.ts'

test('a picture, a video and other files each get their tile', () => {
  expect(tileOf('Screenshot_20261123-070858.png')).toEqual({ kind: 'image', label: 'Picture' })
  expect(tileOf('photo.JPEG').kind).toBe('image')
  expect(tileOf('clip.mov')).toEqual({ kind: 'video', label: 'Video' })
  expect(tileOf('report.pdf')).toEqual({ kind: 'file', label: 'PDF' })
  expect(tileOf('notes.markdown').label).toBe('MD')
  expect(tileOf('backup.tar.gz').label).toBe('GZ')
  expect(tileOf('data.parquet').label).toBe('PARQ')
  expect(tileOf('Makefile')).toEqual({ kind: 'file', label: 'File' })
})

test('a short name keeps its start, its end and its extension', () => {
  expect(shortName('a.pdf')).toBe('a.pdf')
  expect(shortName('exactly14chars')).toBe('exactly14chars')
  const s = shortName('Screenshot_20261123-070858.png')
  expect(s.length).toBe(14)
  expect(s.startsWith('Scree')).toBe(true)
  expect(s.endsWith('858.png')).toBe(true)
  expect(s).toContain('…')
  expect(shortName('quarterly-report-final.xlsx', 12)).toMatch(/^.+….*\.xlsx$/)
  expect(shortName('quarterly-report-final.xlsx', 12).length).toBe(12)
  // no extension: still the start and the end
  expect(shortName('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcde…wxyz')
})

test('sizes in plain words', () => {
  expect(sizeWords(1)).toBe('1 byte')
  expect(sizeWords(820)).toBe('820 bytes')
  expect(sizeWords(14_200)).toBe('14 KB')
  expect(sizeWords(2_400_000)).toBe('2.4 MB')
  expect(sizeWords(3_000_000)).toBe('3 MB')
  expect(sizeWords(25_000_000)).toBe('25 MB')
})
