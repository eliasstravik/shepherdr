import { expect, test } from 'bun:test'
import { byPriority, colorsFor, darker, hexOf, HEAT_DARK, HEAT_LIGHT, priorityOf, PRIORITIES, rank } from './priority.ts'

const t = (id: string, priority?: (typeof PRIORITIES)[number]) => ({ id, priority })

test('P0 first, unflagged last, ties keep their order', () => {
  const list = [t('a'), t('b', 'p3'), t('c', 'p0'), t('d'), t('e', 'p3'), t('f', 'p2'), t('g', 'p4'), t('h', 'p1'), t('i', 'p0')]
  expect(byPriority(list).map((x) => x.id).join('')).toBe('cihfbegad')
})

test('the input is not reordered, and no flags at all changes nothing', () => {
  const list = [t('x'), t('y'), t('z')]
  expect(byPriority(list)).toEqual(list)
  const flagged = [t('a', 'p3'), t('b', 'p0')]
  byPriority(flagged)
  expect(flagged.map((x) => x.id)).toEqual(['a', 'b'])
})

test('priorityOf only knows P0 to P4', () => {
  expect(priorityOf('P1')).toBe('p1')
  expect(priorityOf(' p4 ')).toBe('p4')
  expect(priorityOf('highest')).toBeUndefined()
  expect(priorityOf('p5')).toBeUndefined()
  expect(priorityOf(undefined)).toBeUndefined()
  expect(priorityOf(3)).toBeUndefined()
})

test('rank runs from P0 to none', () => {
  expect([...PRIORITIES.map(rank), rank(undefined)]).toEqual([0, 1, 2, 3, 4, 5])
})

test('hexOf takes #rgb and #rrggbb and nothing else', () => {
  expect(hexOf('#F0a')).toBe('#ff00aa')
  expect(hexOf('#5B9BFF')).toBe('#5b9bff')
  expect(hexOf('5b9bff')).toBe('#5b9bff')
  for (const bad of ['', '#12', '#12345', '#gggggg', 'red', '#1234567', null, 7]) expect(hexOf(bad)).toBeUndefined()
})

test('a chosen colour gets a darker light-theme shade; Heat is the default', () => {
  expect(darker('#ffffff')).toBe('#c7c7c7')
  expect(darker('#000000')).toBe('#000000')
  const c = colorsFor({ p1: '#00ff00', p2: 'nonsense' })
  expect(c.p1).toEqual({ dark: '#00ff00', light: '#00c700' })
  expect(c.p2).toEqual({ dark: HEAT_DARK.p2, light: HEAT_LIGHT.p2 })
  expect(colorsFor(undefined).p0).toEqual({ dark: '#F2555A', light: '#D93036' })
})
