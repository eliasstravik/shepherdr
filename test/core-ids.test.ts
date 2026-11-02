import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreStore } from '../server/core/store.ts'
import { reserveTaskId } from '../server/core/ids.ts'
import { taskChatId } from '../shared/types.ts'

test('machine rename/replacement and deleted tasks never reuse a combined task ID', () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-ids-')), store = new CoreStore(home)
  try {
    const first = reserveTaskId(store, 'old-core', 'DEMO', 'box')
    store.set('task', first.id, { id: first.id, history: 'original' })
    expect(reserveTaskId(store, 'old-core', 'DEMO', 'renamed').id).toBe('renamed/DEMO-2')
    expect(reserveTaskId(store, 'replacement-core', 'DEMO', 'box').id).toBe('box/DEMO-2')
    expect(store.get('task', first.id)).toMatchObject({ history: 'original' })
    store.delete('task', first.id)
    expect(reserveTaskId(store, 'third-core', 'DEMO', 'box').id).toBe('box/DEMO-3')
    expect(taskChatId('box/DEMO-3/Agent')).toBe('box/DEMO-3')
    expect(taskChatId('box/DEMO-3/Reviewer-1')).toBe('box/DEMO-3')
    expect(taskChatId('DEMO-1/Agent')).toBe('DEMO-1')
    expect(taskChatId('p:machine:space')).toBeUndefined()
  } finally { store.close(); rmSync(home, { recursive: true, force: true }) }
})
