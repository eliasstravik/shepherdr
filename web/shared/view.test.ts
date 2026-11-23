import { expect, test } from 'bun:test'
import type { Snapshot, Task } from './types.ts'
import { doneWords, folderOf, leftWords, listOf, minutesLeft, needsCount, nowGroups, statusWord, taskLine, taskWhen, tstate } from './view.ts'

const task = (x: Partial<Task>): Task => ({ id: 'T-1', name: 'A task', place: 'shop', status: 'work', state: 'work', on: 'mini', created: '', age: '', ...x })

test('a status is worked out from facts first, then the agent\'s report', () => {
  expect(tstate(task({ status: 'done', archived: 1 }))).toBe('archived')
  expect(tstate(task({ status: 'merging' }))).toBe('working')
  expect(tstate(task({ status: 'ready' }))).toBe('ready')
  expect(tstate(task({ status: 'need' }))).toBe('ask')
  expect(tstate(task({ status: 'todo', stopped: { by: 'error' } }))).toBe('ask')
  expect(tstate(task({ status: 'queued' }))).toBe('next')
  expect(tstate(task({ status: 'todo' }))).toBe('next')
})

test('the words: Ready for review, Stopped in red, Stopped by you, Waiting for the desktop', () => {
  expect(statusWord(task({ status: 'ready' }))).toEqual({ word: 'Ready for review', tone: 'ready' })
  expect(statusWord(task({ status: 'need', stopped: { by: 'error', why: 'It crashed' } }))).toEqual({ word: 'Stopped', tone: 'red' })
  expect(statusWord(task({ status: 'need', stopped: { by: 'you' } })).word).toBe('Stopped by you')
  expect(statusWord(task({ status: 'work', waitsDesktop: true })).word).toBe('Waiting for the desktop')
  expect(statusWord(task({ status: 'merging' })).word).toBe('Merging')
})

test('a finished task says how it ended', () => {
  expect(doneWords(task({ status: 'done', merged: true, doneNote: '1 link fixed' }))).toBe('Done and merged · 1 link fixed')
  expect(doneWords(task({ status: 'done', branch: 'task/x' }))).toBe('Done · not merged')
  expect(doneWords(task({ status: 'done', repo: 'folder' }))).toBe('Done')
  expect(doneWords(task({ status: 'done', quiet: 'nothing' }))).toBe('Done · nothing to do')
  expect(doneWords(task({ status: 'done', quiet: 'told', doneNote: 'told you in Everything' }))).toBe('Done · told you in Everything')
  // the status line's word alone
  expect(statusWord(task({ status: 'done', merged: true, doneNote: '1 link fixed' })).word).toBe('Done and merged')
  expect(statusWord(task({ status: 'done', branch: 'b' })).word).toBe('Done · not merged')
})

test('a row\'s second line: nothing for a plain task not started yet', () => {
  expect(taskLine(task({ status: 'todo' }))).toBe('')
  expect(taskLine(task({ status: 'queued', afterTitle: 'Fix typo' }))).toBe('Starts after Fix typo')
  expect(taskLine(task({ status: 'need', report: { msg: 'Which provider?' } }))).toBe('Which provider?')
  expect(taskLine(task({ status: 'need', blocked: 'prompt' }))).toBe('Waiting at a prompt')
  expect(taskLine(task({ status: 'work', schedule: 'Morning brief' }))).toBe('Started by its schedule')
})

test('time left is worked out, never guessed: spent × (100 − progress) ÷ progress', () => {
  const now = 1_000_000_000
  expect(minutesLeft(now - 10 * 60_000, 50, now)).toBe(10)
  expect(minutesLeft(now - 30 * 60_000, 60, now)).toBe(20)
  // no progress reported: no estimate
  expect(minutesLeft(now - 10 * 60_000, undefined, now)).toBeNull()
  expect(minutesLeft(now - 10 * 60_000, 0, now)).toBeNull()
  expect(leftWords(10)).toBe('10 min left')
  expect(leftWords(null)).toBe('')
  expect(taskWhen(task({ status: 'work', started: now - 10 * 60_000, report: { msg: '', progress: 50 } }), now)).toBe('10 min left')
  // a Needs you row: how long it has waited for the person
  expect(taskWhen(task({ status: 'need', needsAt: now - 2 * 3_600_000 }), now)).toBe('2h')
})

const snap = (x: Partial<Snapshot>): Snapshot => ({ name: '', host: 'mini', user: '', places: [], machines: [], tasks: [], automations: {}, artifacts: [], asks: {}, needs: [], settings: [], ...x })
const place = (id: string, machine: string, x = {}) => ({ id, name: id, machine, level: 0 as const, status: 'idle' as const, mode: 'regular' as const, chat: id, ...x })

test('the list: machines as headings, groups first, home spaces left out, archived by the filter', () => {
  const s = snap({
    everything: 'home',
    places: [place('home', 'mini', { home: true }), place('shop', 'mini'), place('blog', 'mini', { archived: true }), place('vmhome', 'vm', { home: true }), place('garden', 'vm')],
    machines: [{ id: 'm:mini', machine: 'mini', name: 'mini', status: 'idle' }, { id: 'm:vm', machine: 'vm', name: 'vm', status: 'off', unreachableSince: '14:02' }],
    sections: [{ id: 's:1', name: 'Store', machine: 'mini', spaces: ['shop', 'blog'] }],
  })
  const active = listOf(s, 'Active')
  expect(active.map((m) => m.machine.name)).toEqual(['mini', 'vm'])
  expect(active[0]!.groups[0]!.spaces.map((p) => p.id)).toEqual(['shop'])
  expect(active[1]!.spaces.map((p) => p.id)).toEqual(['garden'])
  expect(active[1]!.warn).toBe("Can't reach")
  expect(listOf(s, 'Archived')[0]!.spaces.map((p) => p.id)).toEqual(['blog'])
  expect(listOf(s, 'All')[0]!.groups[0]!.spaces.map((p) => p.id)).toEqual(['shop', 'blog'])
})

test('needs you: a space\'s tasks under Needs you and Ready for review, and its own chat asking', () => {
  const s = snap({
    everything: 'home',
    places: [place('home', 'mini', { home: true }), place('shop', 'mini', { needs: true }), place('blog', 'mini')],
    tasks: [task({ id: 'a', status: 'need' }), task({ id: 'b', status: 'ready' }), task({ id: 'c', status: 'work' }), task({ id: 'd', status: 'ready', place: 'blog' }), task({ id: 'e', status: 'need', archived: 1 })],
  })
  expect(needsCount(s, 'shop')).toBe(3)
  expect(needsCount(s, 'blog')).toBe(1)
  expect(needsCount(s, 'home')).toBe(4)
  expect(nowGroups(s.tasks).map((g) => [g.name, g.tasks.length])).toEqual([['Needs you', 3], ['Working', 1], ['Up next', 0], ['Done', 0], ['Archived', 1]])
})

test("a space's folder: home as ~, the folder's own name kept whole, another machine named (SHEP-302)", () => {
  const snap = { host: 'mini', machines: [{ id: 'm:vm-b', machine: 'vm-b', name: 'Build box', status: 'idle' }] } as unknown as Snapshot
  expect(folderOf(snap, { machine: 'mini', where: '~/dev/shop', folder: '/Users/sam/dev/shop' })).toEqual({ head: '~/dev', tail: '/shop', full: '/Users/sam/dev/shop', machine: null })
  // Everything, at home
  expect(folderOf(snap, { machine: 'mini', where: '~', folder: '/Users/sam' })).toEqual({ head: '', tail: '~', full: '/Users/sam', machine: null })
  // another machine: its own home as ~, and its name
  expect(folderOf(snap, { machine: 'vm-b', where: '~/clients/acme/shop', folder: '/home/sam/clients/acme/shop' })).toEqual({ head: '~/clients/acme', tail: '/shop', full: '/home/sam/clients/acme/shop', machine: 'Build box' })
  // outside home, the root, a trailing slash, and an older service that sends only `where`
  expect(folderOf(snap, { machine: 'mini', where: '/srv/app' })).toMatchObject({ head: '/srv', tail: '/app', full: '/srv/app' })
  expect(folderOf(snap, { machine: 'mini', where: '/' })).toMatchObject({ head: '', tail: '/' })
  expect(folderOf(snap, { machine: 'mini', where: '/srv' })).toMatchObject({ head: '', tail: '/srv' })
  expect(folderOf(snap, { machine: 'mini', where: '~/dev/shop/' })).toMatchObject({ head: '~/dev', tail: '/shop' })
  // a machine Shepherdr doesn't list by name: its key
  expect(folderOf(snap, { machine: 'vm-c', where: '~/x' }).machine).toBe('vm-c')
})
