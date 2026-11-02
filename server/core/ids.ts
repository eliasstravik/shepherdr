import type { CoreSpace } from './model.ts'
import { MAX_TASK_NUMBER, prepareTaskSequence } from './id-settings.ts'
import type { CoreStore } from './store.ts'

/** Stable-machine counters plus permanent combined-app tombstones prevent alias reuse overwriting history. */
export function reserveTaskId(store: CoreStore, machine: string, prefix: string, alias?: string, space?: CoreSpace) {
  return store.db.transaction(() => {
  if (space) {
    const current = store.get<CoreSpace>('space', space.id)
    if (!current || current.removed || current.prefix !== prefix || current.machine !== machine) throw new Error('The task ID settings changed; try the task again')
    prepareTaskSequence(store, current)
  }
  for (;;) {
    store.db.query('INSERT INTO counters(key,value) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET value=value+1').run(`task:${machine}:${prefix}`)
    const number = (store.db.query('SELECT value FROM counters WHERE key=?').get(`task:${machine}:${prefix}`) as { value: number }).value
    if (!Number.isSafeInteger(number) || number < 1 || number > MAX_TASK_NUMBER) throw new Error('Task numbers are exhausted')
    const localId = `${prefix}-${number}`, id = alias ? `${alias}/${localId}` : localId
    if (store.get('task-id', id) || store.get('task', id)) continue
    store.set('task-id', id, { id, machine, prefix, number, ...(space ? { space: space.id } : {}) })
    if (space) store.set('task-sequence', space.id, { prefix, last: number })
    return { id, localId, number }
  }
  })()
}
