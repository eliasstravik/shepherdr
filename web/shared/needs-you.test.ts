import { expect, test } from 'bun:test'
import { ALERT_FRESH_MS, alertStands, alertWhat, taskAlerts } from './needs-you.ts'
import { needsCount, nowGroups } from './view.ts'
import type { Snapshot, Task } from './types.ts'

const T0 = 1_000_000_000
const task = (id: string, o: Partial<Task> = {}) => ({ id, name: id, place: 'shop', status: 'work', ...o }) as Task
const alert = (id: string, o: Record<string, unknown> = {}) => ({ id, at: T0, title: `Fix login · Need your yes`, what: 'Need your yes', body: 'code 123456', chat: 'SHOP-1/worker', task: 'SHOP-1', place: 'shop', notify: true, ...o })
const snapOf = (tasks: Task[], alerts: ReturnType<typeof alert>[]) => ({ places: [{ id: 'shop', name: 'shop' }], tasks, needs: [], alerts }) as unknown as Snapshot

test("a task's alert shows its own words, its newest one", () => {
  const s = snapOf([task('SHOP-1')], [alert('a'), alert('b', { at: T0 + 5, what: 'Newer' })])
  const a = taskAlerts(s, T0 + 10).get('SHOP-1')!
  expect(a.id).toBe('b')
  expect(alertWhat(a)).toBe('Newer')
  expect(alertWhat({ title: 'Old · words' })).toBe('Old · words')
})

test('an alert goes after 15 minutes, unless its task still waits on you (#1561)', () => {
  const later = T0 + ALERT_FRESH_MS + 1
  const a = alert('a')
  expect(alertStands(a, snapOf([task('SHOP-1')], [a]), later)).toBe(false)
  // it asked for the code, then waited: the code stays on screen while it waits
  expect(alertStands(a, snapOf([task('SHOP-1', { status: 'need', needsAt: T0 + 2000 })], [a]), later + 60 * 60_000)).toBe(true)
  // a wait that began long after the alert is another wait
  expect(alertStands(a, snapOf([task('SHOP-1', { status: 'need', needsAt: T0 + 2 * ALERT_FRESH_MS })], [a]), T0 + 3 * ALERT_FRESH_MS)).toBe(false)
  // done, or its agent ended: gone
  expect(alertStands(a, snapOf([task('SHOP-1', { status: 'done' })], [a]), T0 + 1)).toBe(false)
  expect(alertStands({ ...a, ended: true }, snapOf([task('SHOP-1')], [a]), T0 + 1)).toBe(false)
})

test('a working task with a standing alert is under Needs you, and counts', () => {
  const s = snapOf([task('SHOP-1'), task('SHOP-2')], [alert('a')])
  const now = Date.now()
  const fresh = snapOf(s.tasks, [alert('a', { at: now })])
  const groups = nowGroups(fresh.tasks, taskAlerts(fresh, now))
  expect(groups.find((g) => g.name === 'Needs you')!.tasks.map((t) => t.id)).toEqual(['SHOP-1'])
  expect(groups.find((g) => g.name === 'Working')!.tasks.map((t) => t.id)).toEqual(['SHOP-2'])
  expect(needsCount(fresh, 'shop')).toBe(1)
  // without it, the same as before
  expect(nowGroups(fresh.tasks).find((g) => g.name === 'Needs you')!.tasks).toEqual([])
})
