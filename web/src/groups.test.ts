import { describe, expect, test } from 'bun:test'
import { groupTasks, keepTasks, shownSplit } from './groups.ts'
import type { Machine, Place, Task } from '@shared/types.ts'

const place = (id: string, name: string, machine: string, emoji?: string) => ({ id, name, machine, level: 2, emoji }) as unknown as Place
const places = [place('a:shep', 'shepherdr', 'a', '🐑'), place('a:tor', 'tor-gameboy', 'a', '🎮'), place('b:gtm', 'gtm', 'b')]
const machines = [{ id: 'm:a', machine: 'a', name: 'vm-a' }, { id: 'm:b', machine: 'b', name: 'mac' }] as Machine[]
let n = 0
const task = (p: string, status: Task['status'], more: Partial<Task> = {}) => {
  const pl = places.find((x) => x.id === p)!
  return { id: `${pl.machine}:T-${++n}`, name: `t${n}`, status, place: p, listName: pl.name, on: pl.machine, age: '', created: '', ...more } as Task
}

describe('Split by space (SHEP-65)', () => {
  test('a status in more spaces splits per machine · space, the latest news first; its tasks follow that order', () => {
    const ts = [task('a:shep', 'work', { at: 1 }), task('a:tor', 'work', { at: 5 }), task('b:gtm', 'work', { at: 3 }), task('a:shep', 'work', { at: 2 })]
    const [g] = groupTasks(places, machines, ts, 'status', 0, { split: true })
    expect(g.subs!.map((s) => [s.label, s.note, s.emoji, s.tasks.length])).toEqual([['tor-gameboy', 'vm-a', '🎮', 1], ['gtm', 'mac', undefined, 1], ['shepherdr', 'vm-a', '🐑', 2]])
    expect(g.tasks).toEqual(g.subs!.flatMap((s) => s.tasks))
  })
  test('the space open now comes first; one machine says no machine', () => {
    const ts = [task('a:shep', 'ready', { at: 1 }), task('a:tor', 'ready', { at: 9 })]
    const [g] = groupTasks(places, machines, ts, 'status', 1, { split: true, here: 'a:shep' })
    expect(g.subs!.map((s) => [s.label, s.note])).toEqual([['shepherdr', undefined], ['tor-gameboy', undefined]])
  })
  test('one space, split off, Needs you and Pinned: no subgroups', () => {
    const one = groupTasks(places, machines, [task('a:shep', 'work'), task('a:shep', 'work')], 'status', 0, { split: true })
    expect(one[0].subs).toBeUndefined()
    const off = groupTasks(places, machines, [task('a:shep', 'work'), task('a:tor', 'work')], 'status', 0, { split: false })
    expect(off[0].subs).toBeUndefined()
    const need = groupTasks(places, machines, [task('a:shep', 'need'), task('a:tor', 'need'), task('a:shep', 'todo', { pinned: 1 }), task('a:tor', 'todo', { pinned: 1 })], 'status', 0, { split: true })
    expect(need.map((g) => [g.key, !!g.subs])).toEqual([['pinned', false], ['need', false]])
  })
  test('each subgroup folds and cuts its Done on its own', () => {
    const ts = [...Array.from({ length: 7 }, (_, i) => task('a:shep', 'done', { doneAt: 100 + i, at: 100 + i })), task('a:tor', 'done', { doneAt: 1, at: 1 })]
    const [g] = groupTasks(places, machines, ts, 'status', 0, { split: true })
    const shown = shownSplit(g, () => false, () => false)
    expect(shown.subs!.map((s) => [s.label, s.tasks.length, s.count, s.more])).toEqual([['shepherdr', 5, 7, 2], ['tor-gameboy', 1, 1, 0]])
    const folded = shownSplit(g, (k) => k === 'done/a:shep', (k) => k === 'done/a:tor')
    expect(folded.subs!.map((s) => [s.tasks.length, s.less, s.shut])).toEqual([[7, true, false], [0, false, true]])
    expect(folded.tasks.length).toBe(7)
    expect(folded.count).toBe(8)
  })
  test('a search keeps the subgroups holding a match; one left, none', () => {
    const ts = [task('a:shep', 'work'), task('a:tor', 'work'), task('b:gtm', 'work')]
    const [g] = groupTasks(places, machines, ts, 'status', 0, { split: true })
    expect(keepTasks(g, (t) => t.on === 'a').subs!.length).toBe(2)
    expect(keepTasks(g, (t) => t.on === 'b').subs).toBeUndefined()
  })
})
