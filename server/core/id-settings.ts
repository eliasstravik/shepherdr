import type { CoreStore } from './store.ts'
import type { CoreSpace } from './model.ts'
import { Refusal } from './client.ts'

export const MAX_TASK_NUMBER = Number.MAX_SAFE_INTEGER - 1
const counter = (machine: string, prefix: string) => `task:${machine}:${prefix}`
const ownerKey = (machine: string, prefix: string) => `${machine}\0${prefix}`
interface Sequence { prefix: string; last: number }
const used = (store: CoreStore, machine: string, prefix: string) => (store.db.query('SELECT value FROM counters WHERE key=?').get(counter(machine, prefix)) as { value: number } | null)?.value ?? 0
/** Snapshot reads never allocate, claim a prefix or advance a number. */
export function taskSequence(store: CoreStore, space: CoreSpace): Sequence {
  const saved = store.get<Sequence>('task-sequence', space.id)
  return { prefix: space.prefix, last: Math.max(saved?.last ?? 0, used(store, space.machine, space.prefix)) }
}
function available(store: CoreStore, space: CoreSpace, prefix: string) {
  if (!/^[A-Z][A-Z0-9]{0,15}$/.test(prefix)) throw new Refusal('Use 1–16 capital letters or digits, starting with a letter.')
  const owner = store.get<{ space: string }>('task-prefix', ownerKey(space.machine, prefix))
  if (owner && owner.space !== space.id || store.all<CoreSpace>('space').some(other => !other.home && other.machine === space.machine && other.id !== space.id && other.prefix === prefix)) throw new Refusal('That prefix is already used or reserved on this machine.')
  // A historical prefix with no ownership metadata must not be reassigned.
  if (!owner && prefix !== space.prefix && used(store, space.machine, prefix)) throw new Refusal('That prefix has reserved task history on this machine.')
}
function remember(store: CoreStore, space: CoreSpace, prefix: string) {
  store.set('task-prefix', ownerKey(space.machine, prefix), { space: space.id })
}
/** Called inside the same synchronous transaction as task reservation. */
export function prepareTaskSequence(store: CoreStore, space: CoreSpace) {
  available(store, space, space.prefix)
  const sequence = taskSequence(store, space)
  remember(store, space, space.prefix)
  store.db.query('INSERT INTO counters(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=MAX(value,excluded.value)').run(counter(space.machine, space.prefix), sequence.last)
  return sequence
}
export function setTaskIdSetting(store: CoreStore, id: string, key: string, value: string | null) {
  return store.db.transaction(() => {
    const space = store.get<CoreSpace>('space', id)
    if (!space || space.home || space.removed) throw new Refusal('Select a repository space in Settings.')
    const sequence = taskSequence(store, space)
    if (key === 'taskIds.prefix') {
      const prefix = value ?? ''
      available(store, space, prefix)
      // Keep old ownership forever when it is unambiguous, including after deletion.
      if (!store.all<CoreSpace>('space').some(other => other.id !== id && !other.home && other.machine === space.machine && other.prefix === space.prefix)) remember(store, space, space.prefix)
      remember(store, space, prefix)
      space.prefix = prefix; store.set('space', id, space)
      store.set('task-sequence', id, { prefix, last: Math.max(sequence.last, used(store, space.machine, prefix)) })
    } else if (key === 'taskIds.next') {
      if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > MAX_TASK_NUMBER) throw new Refusal(`Use a whole task number from 1 to ${MAX_TASK_NUMBER}.`)
      const next = Number(value)
      if (next <= sequence.last) throw new Refusal(`Use ${sequence.last + 1} or higher. Earlier numbers are reserved.`)
      available(store, space, space.prefix); remember(store, space, space.prefix)
      store.set('task-sequence', id, { prefix: space.prefix, last: next - 1 })
      store.db.query('INSERT INTO counters(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=MAX(value,excluded.value)').run(counter(space.machine, space.prefix), next - 1)
    } else throw new Refusal('No such task ID setting.')
    return taskSequence(store, space)
  })()
}
export function automaticTaskPrefix(store: CoreStore, machine: string, name: string) {
  const base = name.replace(/[^a-z]/gi, '').slice(0, 4).toUpperCase() || 'TASK'
  for (let suffix = 0; suffix < 100000; suffix++) {
    const prefix = base + (suffix ? suffix + 1 : '')
    if (!store.get('task-prefix', ownerKey(machine, prefix)) && !used(store, machine, prefix) && !store.all<CoreSpace>('space').some(space => !space.home && space.machine === machine && space.prefix === prefix)) return prefix
  }
  throw new Refusal('Choose another space name; its task prefixes are reserved.')
}
