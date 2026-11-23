// SHEP-325: every task says where it works (its repo's or folder's name, its machine only when there is more than
// one); a space's Tasks and count hold what it started and what works in its folder; Everything filters by repo.
// Fake data.
import { expect, test } from 'bun:test'
import type { Machine, Snapshot, Task } from './types.ts'
import { askedWords, needsCount, reposOf, spaceOnFolder, taskInSpace, tasksIn, workKey, workWords } from './view.ts'

const task = (x: Partial<Task>): Task => ({ id: 'T-1', name: 'A task', place: 'shop', status: 'work', state: 'work', on: 'mini', created: '', age: '', ...x })
const machine = (key: string, name = key): Machine => ({ id: `m:${key}`, machine: key, name, status: 'idle' }) as Machine
const snap = (x: Partial<Snapshot>): Snapshot => ({ name: '', host: 'mini', user: '', places: [], machines: [machine('mini')], tasks: [], automations: {}, artifacts: [], asks: {}, needs: [], settings: [], everything: 'home', ...x })
const place = (id: string, machine: string, x = {}) => ({ id, name: id, machine, level: 0 as const, status: 'idle' as const, mode: 'regular' as const, chat: id, ...x })
const shop = { name: 'shop', folder: '/home/me/dev/shop', short: '~/dev/shop', repo: true }

test("a task's tag: the repo's or folder's name, its machine only with several", () => {
  const one = snap({})
  expect(workWords(one, task({ work: shop }))).toBe('shop')
  // a folder that is no repo shows its path as it is: ~ for home, / for the root
  expect(workWords(one, task({ work: { name: 'notes', folder: '/home/me/notes', short: '~/notes', repo: false } }))).toBe('~/notes')
  expect(workWords(one, task({ work: { name: '~', folder: '/home/me', short: '~', repo: false } }))).toBe('~')
  expect(workWords(one, task({ work: { name: '/', folder: '/', short: '/', repo: false } }))).toBe('/')
  expect(workWords(snap({ machines: [machine('mini'), machine('mac', 'Mac')] }), task({ on: 'mac', work: { name: '~', folder: '/Users/me', short: '~', repo: false } }))).toBe('~ · Mac')
  // no folder known: no tag
  expect(workWords(one, task({}))).toBe('')
  // two machines: the task's own is named, by the person's name for it
  const two = snap({ machines: [machine('mini', 'This computer'), machine('vm-b', 'Build box')] })
  expect(workWords(two, task({ work: shop }))).toBe('shop · This computer')
  expect(workWords(two, task({ work: shop, on: 'vm-b' }))).toBe('shop · Build box')
})

test("a space's Tasks and count: what it started and what works in its folder", () => {
  const s = snap({
    places: [place('home', 'mini', { home: true }), place('root', 'mini', { folder: '/' }), place('shop', 'mini', { folder: shop.folder }), place('blog', 'mini')],
    tasks: [
      // asked in #root, works in shop: in both
      task({ id: 'a', place: 'root', asked: 'root', also: ['shop'], status: 'need', work: shop }),
      task({ id: 'b', place: 'shop', asked: 'shop', status: 'ready', work: shop }),
      task({ id: 'c', place: 'blog', status: 'need' }),
    ],
  })
  expect(tasksIn(s, 'shop').map((t) => t.id)).toEqual(['a', 'b'])
  expect(tasksIn(s, 'root').map((t) => t.id)).toEqual(['a'])
  expect(tasksIn(s, 'blog').map((t) => t.id)).toEqual(['c'])
  expect(tasksIn(s, 'home').map((t) => t.id)).toEqual(['a', 'b', 'c'])
  expect(needsCount(s, 'shop')).toBe(2)
  expect(needsCount(s, 'root')).toBe(1)
  // Everything counts each task once
  expect(needsCount(s, 'home')).toBe(3)
  expect(taskInSpace(s.tasks[0]!, 'shop') && taskInSpace(s.tasks[0]!, 'root') && !taskInSpace(s.tasks[0]!, 'blog')).toBe(true)
})

test("Everything's repo filter: each repo or folder once, most tasks first, on its machine", () => {
  const s = snap({
    machines: [machine('mini'), machine('vm-b')],
    places: [place('home', 'mini', { home: true, folder: '/home/me' }), place('shop', 'mini', { folder: shop.folder })],
    tasks: [
      task({ id: 'a', work: shop }),
      task({ id: 'b', work: shop }),
      task({ id: 'c', work: { name: 'vibecam', folder: '/home/me/dev/vibecam', short: '~/dev/vibecam', repo: true } }),
      // the same folder on another machine is another repo
      task({ id: 'd', work: shop, on: 'vm-b' }),
      // archived: not counted, but its repo is still known
      task({ id: 'e', work: { name: 'old', folder: '/home/me/old', repo: true }, archived: 1 }),
      task({ id: 'f' }),
    ],
  })
  const repos = reposOf(s)
  expect(repos.map((r) => [r.name, r.machine, r.tasks.length])).toEqual([['shop', 'mini', 2], ['shop', 'vm-b', 1], ['vibecam', 'mini', 1], ['old', 'mini', 0]])
  // the filter: one repo's tasks by its key
  const key = repos[0]!.key
  expect(s.tasks.filter((t) => workKey(t) === key).map((t) => t.id)).toEqual(['a', 'b'])
  // a repo with a space on it opens that space; one without offers to make one
  expect(spaceOnFolder(s, repos[0]!)?.id).toBe('shop')
  expect(spaceOnFolder(s, repos[1]!)).toBeUndefined()
  expect(spaceOnFolder(s, repos[2]!)).toBeUndefined()
  // the home folder's space is Everything
  expect(spaceOnFolder(s, { folder: '/home/me', machine: 'mini' })?.id).toBe('home')
})

test('the one quiet line on a task: the space that asked', () => {
  const s = snap({ places: [place('home', 'mini', { home: true }), place('root', 'mini')] })
  expect(askedWords(s, task({ asked: 'root' }))).toBe('Asked in #root')
  expect(askedWords(s, task({ asked: 'home' }))).toBe('Asked in Everything')
  // no space asked, or it is gone: nothing
  expect(askedWords(s, task({}))).toBe('')
  expect(askedWords(s, task({ asked: 'gone' }))).toBe('')
})
