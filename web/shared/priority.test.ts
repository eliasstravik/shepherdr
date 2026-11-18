import { expect, test } from 'bun:test'
import { byPriority, priorityOf, PRIORITIES, rank } from './priority.ts'

const t = (id: string, priority?: (typeof PRIORITIES)[number]) => ({ id, priority })

test('Highest first, unflagged last, ties keep their order', () => {
  const list = [t('a'), t('b', 'low'), t('c', 'highest'), t('d'), t('e', 'low'), t('f', 'medium'), t('g', 'lowest'), t('h', 'high'), t('i', 'highest')]
  expect(byPriority(list).map((x) => x.id).join('')).toBe('cihfbegad')
})

test('the input is not reordered, and no flags at all changes nothing', () => {
  const list = [t('x'), t('y'), t('z')]
  expect(byPriority(list)).toEqual(list)
  const flagged = [t('a', 'low'), t('b', 'highest')]
  byPriority(flagged)
  expect(flagged.map((x) => x.id)).toEqual(['a', 'b'])
})

test('priorityOf only knows the five levels', () => {
  expect(priorityOf('High')).toBe('high')
  expect(priorityOf(' lowest ')).toBe('lowest')
  expect(priorityOf('urgent')).toBeUndefined()
  expect(priorityOf(undefined)).toBeUndefined()
  expect(priorityOf(3)).toBeUndefined()
})

test('rank runs from Highest to none', () => {
  expect([...PRIORITIES.map(rank), rank(undefined)]).toEqual([0, 1, 2, 3, 4, 5])
})
