import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreStore } from '../server/core/store.ts'
import type { CoreSpace } from '../server/core/model.ts'
import { reserveTaskId } from '../server/core/ids.ts'
import { automaticTaskPrefix, setTaskIdSetting, taskSequence, MAX_TASK_NUMBER } from '../server/core/id-settings.ts'

function fixture(run: (store: CoreStore, space: CoreSpace) => void) {
  const home = mkdtempSync(join(tmpdir(), 'shep-id-settings-')), store = new CoreStore(home)
  const space: CoreSpace = { id: 'space-one', machine: 'machine', name: 'demo', folder: '/repo', base: 'main', prefix: 'DEMO', mode: 'regular', added: 1 }
  store.set('space', space.id, space)
  try { run(store, space) } finally { store.close(); rmSync(home, { recursive: true, force: true }) }
}
test('prefix changes preserve forward numbering and all historical reservations across deletion and restart', () => fixture((store, space) => {
  const first = reserveTaskId(store, space.machine, space.prefix, 'box', space)
  expect(first.id).toBe('box/DEMO-1')
  expect(setTaskIdSetting(store, space.id, 'taskIds.next', '50')).toEqual({ prefix: 'DEMO', last: 49 })
  expect(() => setTaskIdSetting(store, space.id, 'taskIds.next', '49')).toThrow('Earlier numbers')
  setTaskIdSetting(store, space.id, 'taskIds.prefix', 'NEW')
  const current = store.get<CoreSpace>('space', space.id)!
  expect(reserveTaskId(store, current.machine, current.prefix, 'box', current).id).toBe('box/NEW-50')
  expect(store.get('task-id', first.id)).toMatchObject({ space: space.id, number: 1 })
  setTaskIdSetting(store, space.id, 'taskIds.prefix', 'DEMO')
  const reverted = store.get<CoreSpace>('space', space.id)!
  expect(reserveTaskId(store, reverted.machine, reverted.prefix, 'renamed', reverted).id).toBe('renamed/DEMO-51')
  store.set('space', 'space-two', { ...space, id: 'space-two', prefix: 'OTHER' })
  expect(() => setTaskIdSetting(store, 'space-two', 'taskIds.prefix', 'NEW')).toThrow('reserved')
  expect(automaticTaskPrefix(store, space.machine, 'demo')).toBe('DEMO2')
}))
test('ID controls reject collisions, old unknown ownership, invalid numbers and stale space input without advancing', () => fixture((store, space) => {
  reserveTaskId(store, space.machine, 'OLD', 'box')
  expect(() => setTaskIdSetting(store, space.id, 'taskIds.prefix', 'OLD')).toThrow('history')
  expect(() => setTaskIdSetting(store, space.id, 'taskIds.prefix', 'lower')).toThrow('capital')
  for (const bad of ['0', '-1', '1.5', '1e3', ' 2', String(MAX_TASK_NUMBER + 1)]) expect(() => setTaskIdSetting(store, space.id, 'taskIds.next', bad)).toThrow()
  expect(taskSequence(store, space).last).toBe(0)
  setTaskIdSetting(store, space.id, 'taskIds.prefix', 'NEXT')
  expect(() => reserveTaskId(store, space.machine, space.prefix, 'box', space)).toThrow('changed')
  const current = store.get<CoreSpace>('space', space.id)!
  setTaskIdSetting(store, space.id, 'taskIds.next', String(MAX_TASK_NUMBER))
  expect(reserveTaskId(store, current.machine, current.prefix, 'box', current).number).toBe(MAX_TASK_NUMBER)
  expect(() => reserveTaskId(store, current.machine, current.prefix, 'box', current)).toThrow('exhausted')
  expect(taskSequence(store, current).last).toBe(MAX_TASK_NUMBER)
}))
