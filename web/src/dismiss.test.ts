import { expect, test } from 'bun:test'
import { idsOf, kept, showing } from './dismiss.ts'

// The warnings line stays closed while every warning now is one that was closed; one that goes and comes back is new.

test('nothing closed: it shows when there is a warning', () => {
  expect(showing(['u:a'], idsOf(null))).toBe(true)
  expect(showing([], idsOf(null))).toBe(false)
})

test('closed: it stays closed for the same warnings, in any order', () => {
  expect(showing(['m:b', 'u:a'], idsOf('m:b|u:a'))).toBe(false)
})

test('closed: one of them going away keeps it closed', () => {
  expect(showing(['u:a'], idsOf('m:b|u:a'))).toBe(false)
})

test('a new warning brings it back', () => {
  expect(showing(['u:a', 'm:c:down'], idsOf('u:a'))).toBe(true)
})

test('one that went away and comes back counts as new', () => {
  let closed = 'm:b|u:a'
  closed = kept(['u:a'], idsOf(closed)) ?? ''
  expect(closed).toBe('u:a')
  expect(showing(['u:a', 'm:b'], idsOf(closed))).toBe(true)
})

test('the closed set empties once none of it is there', () => {
  expect(kept([], idsOf('u:a'))).toBe(null)
  expect(kept(['u:a', 'x'], idsOf('u:a'))).toBe('u:a')
})

test('an old dismiss (with its day) still reads', () => {
  expect(idsOf(({ day: 'Mon', what: 'u:a' } as { what: string }).what)).toEqual(['u:a'])
})
