import { describe, expect, test } from 'bun:test'
import { groupTasks, loadGroups, saveGroups, shownGroup } from './groups.ts'
import type { Machine, Place, Task } from '@shared/types.ts'

const place = (id: string, name: string, machine: string, emoji?: string) => ({ id, name, machine, level: 2, emoji }) as unknown as Place
const places = [place('a:shep', 'shepherdr', 'a', '🐑'), place('a:tor', 'tor-gameboy', 'a', '🎮'), place('b:gtm', 'gtm', 'b')]
const machines = [{ id: 'm:a', machine: 'a', name: 'vm-a' }, { id: 'm:b', machine: 'b', name: 'mac' }] as Machine[]
let n = 0
const task = (p: string, status: Task['status'], more: Partial<Task> = {}) => {
  const pl = places.find((x) => x.id === p)!
  return { id: `${pl.machine}:T-${++n}`, name: `t${n}`, status, place: p, listName: pl.name, on: pl.machine, age: '', created: '', ...more } as Task
}

describe('Group by status or by place (SHEP-182)', () => {
  const ts = () => [task('b:gtm', 'work'), task('a:shep', 'ready'), task('a:tor', 'need'), task('a:shep', 'todo'), task('a:shep', 'done', { doneAt: 5 }), task('a:shep', 'queued'), task('b:gtm', 'need')]
  test('status: who acts first, rows saying machine and space, Done last', () => {
    const gs = groupTasks(places, machines, ts(), 'status', 0)
    expect(gs.map((g) => [g.key, g.tasks.length])).toEqual([['need', 2], ['ready', 1], ['work', 1], ['queued', 1], ['todo', 1], ['done', 1]])
    expect(gs[0].names).toEqual({ machine: true, project: true })
  })
  test('one machine: rows say only their space', () => {
    expect(groupTasks(places, machines, ts(), 'status', 1)[0].names).toEqual({ machine: false, project: true })
  })
  test('place: machine by machine, a space in the sidebar order with every status, Done last', () => {
    const gs = groupTasks(places, machines, ts(), 'place', 0)
    expect(gs.map((g) => [g.key, g.machine, g.tasks.map((t) => t.status)])).toEqual([
      ['a:shep', 'vm-a', ['ready', 'queued', 'todo']],
      ['a:tor', 'vm-a', ['need']],
      ['b:gtm', 'mac', ['need', 'work']],
      ['done', undefined, ['done']],
    ])
    expect([gs[0].emoji, gs[0].place]).toEqual(['🐑', 'a:shep'])
  })
  test('a pinned task gets Pinned on top in both', () => {
    const t = [task('a:shep', 'need', { pinned: 1 }), task('a:tor', 'work')]
    expect(groupTasks(places, machines, t, 'status', 0).map((g) => g.key)).toEqual(['pinned', 'work'])
    expect(groupTasks(places, machines, t, 'place', 0).map((g) => g.key)).toEqual(['pinned', 'a:tor'])
  })
  test('Done shows only its count while shut, and its latest five once opened', () => {
    const t = Array.from({ length: 7 }, (_, i) => task('a:shep', 'done', { doneAt: 100 + i }))
    const [done] = groupTasks(places, machines, t, 'status', 0)
    expect(shownGroup(done, false, true)).toMatchObject({ count: 7, tasks: [] })
    expect(shownGroup(done, false, false)).toMatchObject({ count: 7, more: 2 })
  })
  test('the kept choice: Status until Place is chosen', () => {
    const store = new Map<string, string>()
    globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as Storage
    expect(loadGroups()).toBe('status')
    saveGroups('place')
    expect(loadGroups()).toBe('place')
  })
})

describe("the window's grouping (core/tasks.js groupNow)", () => {
  test('For you until chosen; old Status split by space and the machine ones become For you', async () => {
    const { groupNow } = (await import('@core/tasks.js')) as { groupNow: (s: (k: string) => unknown) => string }
    const from = (v: Record<string, unknown>) => groupNow((k) => v[k])
    expect(from({})).toBe('you')
    expect(from({ 'tasks.groupby': 'status' })).toBe('you')
    expect(from({ 'tasks.groupby': 'status', 'tasks.split': false })).toBe('status')
    expect(from({ 'tasks.groupby': 'machine-space' })).toBe('you')
    expect(from({ 'tasks.groupby': 'folder' })).toBe('space')
    expect(from({ 'tasks.group': 'status', 'tasks.groupby': 'space' })).toBe('status')
  })
})
