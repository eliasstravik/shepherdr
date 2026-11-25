import { expect, test } from 'bun:test'
import { isOffEnd, newSince, onEnd, setOffEnd, toEnd } from './newest.ts'

const r = (id: string, mine = false) => ({ id, mine })

test('counts what came after you left the end, not what you sent', () => {
  expect(newSince([r('a'), r('b'), r('c'), r('d', true), r('e')], 'b')).toBe(2)
  expect(newSince([r('a'), r('b')], 'b')).toBe(0)
})

test('earlier pages loading at the top change nothing; an unknown or no mark counts none', () => {
  expect(newSince([r('x'), r('y'), r('a'), r('b'), r('c')], 'b')).toBe(1)
  expect(newSince([r('a')], 'gone')).toBe(0)
  expect(newSince([r('a')], null)).toBe(0)
})

test('End goes to the open chat only while it is away from its end', () => {
  let went = 0
  const off = onEnd('c1', () => went++)
  expect(isOffEnd('c1')).toBe(false)
  setOffEnd('c1', { count: 3 })
  expect(isOffEnd('c1')).toBe(true)
  expect(toEnd('c1')).toBe(true)
  expect(went).toBe(1)
  expect(toEnd('c2')).toBe(false)
  off()
  expect(toEnd('c1')).toBe(false)
  setOffEnd('c1', null)
  expect(isOffEnd('c1')).toBe(false)
})
