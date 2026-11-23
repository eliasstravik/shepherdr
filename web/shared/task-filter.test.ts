import { expect, test } from 'bun:test'
import type { Place, Snapshot, Task } from './types.ts'
import { chipsOf, choices, clean, filterCount, filterOn, filterTasks, fstate, NO_FILTER, toggle, type TaskFilter } from './task-filter.ts'

const place = (id: string, name: string, machine: string, x: Partial<Place> = {}): Place => ({ id, name, machine, level: 0, status: 'idle', chat: id, ...x }) as Place
const task = (id: string, pl: string, status: Task['status'], x: Partial<Task> = {}): Task => ({ id, name: id, place: pl, status, state: status, on: 'mini', created: '', age: '', ...x })
const snap = {
  host: 'mini',
  everything: 'home',
  places: [place('home', 'home', 'mini', { home: true }), place('shop', 'shop', 'mini'), place('blog', 'blog', 'mini'), place('vshop', 'shop', 'vm')],
  machines: [{ id: 'm:mini', machine: 'mini', name: 'mini', status: 'idle' }, { id: 'm:vm', machine: 'vm', name: 'vm', status: 'idle' }],
  tasks: [
    task('A', 'shop', 'need', { work: { name: 'site', folder: '/w/site', repo: true }, also: ['blog'] }),
    task('B', 'shop', 'work'),
    task('C', 'blog', 'ready'),
    task('D', 'vshop', 'need', { on: 'vm', stopped: { by: 'error' }, work: { name: 'shop', folder: '/srv/shop', repo: true } }),
    task('E', 'vshop', 'scheduled', { on: 'vm', work: { name: 'shop', folder: '/srv/shop', repo: true } }),
    task('F', 'blog', 'todo'),
    task('G', 'shop', 'done'),
    task('H', 'home', 'done', { archived: 1 }),
  ],
} as unknown as Snapshot
const ids = (f: Partial<TaskFilter>, at = 'shop') => filterTasks(snap, { ...NO_FILTER, ...f }, at).map((t) => t.id).join('')

test('the default shows every task everywhere, in any space', () => {
  expect(ids({}, 'shop')).toBe('ABCDEFGH')
  expect(ids({}, 'home')).toBe('ABCDEFGH')
  expect(filterOn(snap, NO_FILTER, 'shop')).toBe(false)
})

test('states: Stopped apart from Needs you, Scheduled apart from Up next', () => {
  expect(snap.tasks.map(fstate)).toEqual(['needs', 'working', 'ready', 'stopped', 'scheduled', 'next', 'done', 'archived'])
  expect(fstate(task('X', 'shop', 'need', { stopped: { by: 'you' } }))).toBe('needs')
})

test('each group filters, picks within a group add up, groups narrow each other', () => {
  expect(ids({ state: ['needs'] })).toBe('A')
  expect(ids({ state: ['needs', 'stopped'] })).toBe('AD')
  expect(ids({ machine: ['vm'] })).toBe('DE')
  expect(ids({ machine: ['vm', 'mini'] })).toBe('ABCDEFGH')
  expect(ids({ space: ['shop', 'blog'] })).toBe('ABCFG')
  expect(ids({ space: ['shop'], machine: ['vm'] })).toBe('')
  expect(ids({ machine: ['mini'], state: ['done', 'ready'] })).toBe('CG')
})

test('quick choices: this space only follows where you are, hide done, clear', () => {
  // a space's own: what it started and what works in its folder (SHEP-325's also)
  expect(ids({ here: true }, 'blog')).toBe('ACF')
  expect(ids({ here: true }, 'vshop')).toBe('DE')
  // in Everything it means nothing, and shows no chip
  expect(ids({ here: true }, 'home')).toBe('ABCDEFGH')
  expect(filterOn(snap, { ...NO_FILTER, here: true }, 'home')).toBe(false)
  expect(ids({ hideDone: true })).toBe('ABCDEF')
  expect(ids({ hideDone: true, here: true }, 'shop')).toBe('AB')
  // picking Done again shows them
  expect(toggle({ ...NO_FILTER, hideDone: true }, 'state', 'done')).toEqual({ ...NO_FILTER, state: ['done'] })
  expect(toggle(toggle(NO_FILTER, 'machine', 'vm'), 'machine', 'vm')).toEqual(NO_FILTER)
})

test('chips: one per choice that is on, each one takes itself off', () => {
  const f: TaskFilter = { state: ['working'], machine: ['vm'], space: ['shop', 'home'], repo: ['vm:/srv/shop'], here: true, hideDone: true }
  const chips = chipsOf(snap, f, 'blog')
  expect(chips.map((c) => c.label)).toEqual(['#blog only', 'Done hidden', 'Working', 'vm', 'shop', 'Everything', 'shop'])
  let g = f
  for (const c of chips) g = c.off(g)
  expect(g).toEqual(NO_FILTER)
  expect(chipsOf(snap, NO_FILTER, 'shop')).toEqual([])
})

test('the count follows what the list shows: what needs you in it', () => {
  expect(filterCount(snap, NO_FILTER, 'shop')).toBe(3)
  expect(filterCount(snap, { ...NO_FILTER, here: true }, 'shop')).toBe(1)
  expect(filterCount(snap, { ...NO_FILTER, repo: ['vm:/srv/shop'] }, 'shop')).toBe(1)
  expect(filterCount(snap, { ...NO_FILTER, machine: ['vm'] }, 'shop')).toBe(1)
  expect(filterCount(snap, { ...NO_FILTER, state: ['working'] }, 'shop')).toBe(0)
})

test('the choices come from the tasks there are; a space keeps its machine to tell two shops apart', () => {
  expect(choices(snap, 'state', NO_FILTER).map((c) => `${c.label} ${c.n}`)).toEqual(['Needs you 1', 'Working 1', 'Ready for review 1', 'Up next 1', 'Scheduled 1', 'Stopped 1', 'Done 1', 'Archived 1'])
  expect(choices(snap, 'machine', NO_FILTER).map((c) => `${c.label} ${c.n}`)).toEqual(['mini 6', 'vm 2'])
  expect(choices(snap, 'space', NO_FILTER).map((c) => `${c.label} ${c.machine}`)).toEqual(['Everything mini', '#shop mini', '#blog mini', '#shop vm'])
})

test('a kept filter that is broken or from an older build counts as nothing picked', () => {
  expect(clean(undefined)).toEqual(NO_FILTER)
  expect(clean({ state: 'done' as never, machine: [1, 'vm'] as never, here: 'yes' as never })).toEqual({ ...NO_FILTER, machine: ['vm'] })
})

test('Repo is one more group (SHEP-325): picks add up, it narrows the others', () => {
  expect(ids({ repo: ['vm:/srv/shop'] })).toBe('DE')
  expect(ids({ repo: ['vm:/srv/shop', 'mini:/w/site'] })).toBe('ADE')
  expect(ids({ repo: ['vm:/srv/shop'], state: ['scheduled'] })).toBe('E')
  expect(choices(snap, 'repo', NO_FILTER).map((c) => `${c.label} ${c.machine} ${c.n}`)).toEqual(['shop vm 2', 'site mini 1'])
  expect(chipsOf(snap, { ...NO_FILTER, repo: ['mini:/w/site'] }, 'shop').map((c) => [c.label, c.icon])).toEqual([['site', 'folder']])
})

// SHEP-354: a task whose space was removed comes with no space (''); the Space group showed it as a row with no name
test('no blank choices: a task with no space, machine or repo adds no empty row', () => {
  const s = { ...snap, tasks: [...snap.tasks, task('Z', '', 'done', { on: '' })] } as Snapshot
  for (const key of ['state', 'machine', 'space', 'repo'] as const) {
    const all = choices(s, key, NO_FILTER)
    expect(all.length).toBeGreaterThan(0)
    for (const c of all) {
      expect(c.id.trim()).not.toBe('')
      expect(c.label.trim()).not.toBe('')
    }
  }
  // a blank pick kept from before is no row either
  expect(choices(s, 'space', { ...NO_FILTER, space: [''] }).some((c) => !c.id)).toBe(false)
})
