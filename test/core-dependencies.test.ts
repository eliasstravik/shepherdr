import { expect, test } from 'bun:test'
import { taskDependencies } from '../server/core/dependencies.ts'

const task = (id: string, machine = 'main', place = 'space', after?: string[]) => ({ id, localId: id.split('/').at(-1), machine, place, workflow: after ? 'queued' : 'working', after })
const owner = { id: 'vm/APP-1', place: 'space', machine: 'main' }
test('dependency IDs keep stable machine identity, canonical case, deduplication and space-local numbers', () => {
  const tasks = [task(owner.id), task('vm/APP-2'), task('remote/APP-2', 'other'), task('vm/OTHER-2', 'main', 'another')]
  expect(taskDependencies(tasks, owner, ['app-2, APP-2'])).toEqual(['vm/APP-2'])
  expect(taskDependencies(tasks, owner, ['2'])).toEqual(['vm/APP-2'])
  expect(taskDependencies(tasks, owner, ['REMOTE/app-2'])).toEqual(['remote/APP-2'])
  expect(() => taskDependencies(tasks, owner, ['missing/APP-2'])).toThrow('No such dependency')
  expect(() => taskDependencies([...tasks, task('renamed/APP-2')], owner, ['app-2'])).toThrow('full task ID')
})
test('self, indirect and downstream-corrupt dependency circles are rejected', () => {
  const tasks = [task(owner.id), task('vm/APP-2', 'main', 'space', ['vm/APP-3']), task('vm/APP-3', 'main', 'space', [owner.id])]
  expect(() => taskDependencies(tasks, owner, ['app-1'])).toThrow('itself')
  expect(() => taskDependencies(tasks, owner, ['app-2'])).toThrow('APP-1 → vm/APP-2 → vm/APP-3 → vm/APP-1')
  tasks[2].after = ['vm/APP-2']
  expect(() => taskDependencies(tasks, owner, ['app-2'])).toThrow('circle')
  // Completed dependencies no longer carry waiting edges.
  tasks[2].workflow = 'merged'
  expect(taskDependencies(tasks, owner, ['app-2'])).toEqual(['vm/APP-2'])
})
test('diamond queues and long chains use bounded traversal rather than recursive stack depth', () => {
  const tasks = Array.from({ length: 12_000 }, (_, i) => task(`vm/APP-${i + 2}`, 'main', 'space', i < 11_999 ? [`vm/APP-${i + 3}`] : []))
  tasks.push(task('vm/BRANCH-1', 'main', 'space', ['vm/APP-4']))
  expect(taskDependencies(tasks, owner, ['app-2', 'branch-1'])).toEqual(['vm/APP-2', 'vm/BRANCH-1'])
  expect(() => taskDependencies(tasks, owner, Array(129).fill('app-2'))).toThrow('128')
})

test('a remote task can wait on a bare main-machine canonical ID', () => {
  const tasks = [task('CORE-1'), task('remote/REMO-2', 'other')]
  expect(taskDependencies(tasks, { id: 'remote/REMO-2', machine: 'other', place: 'space' }, ['core-1'])).toEqual(['CORE-1'])
})

test('explicit machine names or stable IDs disambiguate a bare main ID from a remote local ID', () => {
  const tasks = [task('CORE-1'), task('remote/CORE-1', 'other')]
  const remote = { id: 'remote/NEW-2', machine: 'other', place: 'space' }
  expect(taskDependencies(tasks, remote, ['CORE-1'])).toEqual(['remote/CORE-1'])
  expect(taskDependencies(tasks, remote, ['main:CORE-1'])).toEqual(['CORE-1'])
  expect(taskDependencies(tasks, remote, ['VM:core-1'], id => id === 'main' ? 'vm' : 'remote')).toEqual(['CORE-1'])
})
