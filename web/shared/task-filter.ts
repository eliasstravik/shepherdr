// The Tasks panel's filter (SHEP-331): every task everywhere by default; narrowed by groups of choices (Machine,
// Space, State, Repo), each a multi-select where nothing picked means all. Two quick
// choices beside them: "This space only" (follows the space you are in) and "Hide done". Kept on this device.
import type { Snapshot, Task } from './types.ts'
import { isEverything, machineLabel, reposOf, spaceLabel, taskInSpace, tstate, workKey } from './view.ts'

/** the states the filter offers, in the order the person reads them */
export const STATES = ['needs', 'working', 'ready', 'next', 'scheduled', 'stopped', 'done', 'archived'] as const
export type FState = (typeof STATES)[number]
export const STATE_WORDS: Record<FState, string> = {
  needs: 'Needs you',
  working: 'Working',
  ready: 'Ready for review',
  next: 'Up next',
  scheduled: 'Scheduled',
  stopped: 'Stopped',
  done: 'Done',
  archived: 'Archived',
}

/** a group of choices: its key, its words, a task's value */
export type GroupKey = 'state' | 'machine' | 'space' | 'repo'
export interface TaskFilter {
  state: string[]
  machine: string[]
  space: string[]
  /** SHEP-325's repos and folders, by their key (machine and folder) */
  repo: string[]
  /** only the space you are in (nothing in Everything) */
  here: boolean
  /** Done and Archived left out */
  hideDone: boolean
}
export const NO_FILTER: TaskFilter = { state: [], machine: [], space: [], repo: [], here: false, hideDone: false }

/** a filter kept from an older visit, or hand-edited: whatever is not a list or a flag counts as nothing picked */
export function clean(f: Partial<TaskFilter> | null | undefined): TaskFilter {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return { state: list(f?.state), machine: list(f?.machine), space: list(f?.space), repo: list(f?.repo), here: f?.here === true, hideDone: f?.hideDone === true }
}

/** a task's state as the filter names it: Stopped apart from Needs you, Scheduled apart from Up next */
export function fstate(t: Task): FState {
  const s = tstate(t)
  if (s === 'ask') return t.stopped && t.stopped.by !== 'you' ? 'stopped' : 'needs'
  if (s === 'next') return t.status === 'scheduled' ? 'scheduled' : 'next'
  return s
}

/** the machine a task works on: its space's */
export const taskMachine = (snap: Snapshot, t: Task) => snap.places.find((p) => p.id === t.place)?.machine ?? t.on

export interface Group {
  key: GroupKey
  name: string
  of: (snap: Snapshot, t: Task) => string
}
export const GROUPS: Group[] = [
  { key: 'state', name: 'State', of: (_, t) => fstate(t) },
  { key: 'machine', name: 'Machine', of: taskMachine },
  { key: 'space', name: 'Space', of: (_, t) => t.place },
  { key: 'repo', name: 'Repo', of: (_, t) => workKey(t) },
]

const doneLike = (t: Task) => ['done', 'archived'].includes(tstate(t))

/** "This space only" applies: it is on and you are in a space, not Everything */
export const hereOn = (snap: Snapshot, f: TaskFilter, at: string) => f.here && !!at && !isEverything(snap, at)

/** the tasks the panel lists */
export function filterTasks(snap: Snapshot, f: TaskFilter, at: string): Task[] {
  const here = hereOn(snap, f, at)
  return snap.tasks.filter(
    (t) => (!here || taskInSpace(t, at)) && !(f.hideDone && doneLike(t)) && GROUPS.every((g) => !f[g.key].length || f[g.key].includes(g.of(snap, t))),
  )
}

/** the Tasks button's number: what needs you among the tasks the list shows */
export const filterCount = (snap: Snapshot, f: TaskFilter, at: string) => filterTasks(snap, f, at).filter((t) => ['ask', 'ready'].includes(tstate(t))).length

/** a filter is on: anything picked, or a quick choice that applies here */
export const filterOn = (snap: Snapshot, f: TaskFilter, at: string) => hereOn(snap, f, at) || f.hideDone || GROUPS.some((g) => f[g.key].length > 0)

/** the choices of a group, from the tasks there are (a choice picked before stays, so it can be taken off). Never a
 *  blank one: a task whose space was removed has no space (the service gives it ''), and it made a row with no name. */
export function choices(snap: Snapshot, key: GroupKey, f: TaskFilter): Choice[] {
  return allChoices(snap, key, f).filter((c) => c.id.trim() && c.label.trim())
}
export interface Choice {
  id: string
  label: string
  n: number
  machine?: string
}
function allChoices(snap: Snapshot, key: GroupKey, f: TaskFilter): Choice[] {
  const g = GROUPS.find((x) => x.key === key)!
  const n = (id: string) => snap.tasks.filter((t) => g.of(snap, t) === id).length
  if (key === 'state') return STATES.map((s) => ({ id: s, label: STATE_WORDS[s], n: n(s) })).filter((c) => c.n || f.state.includes(c.id))
  if (key === 'machine') {
    const ids = [...new Set([...snap.machines.map((m) => m.machine), ...snap.tasks.map((t) => taskMachine(snap, t)), ...f.machine])]
    return ids.map((id) => ({ id, label: machineLabel(snap, id), n: n(id) })).filter((c) => c.n || f.machine.includes(c.id))
  }
  if (key === 'repo') {
    const repos = reposOf(snap).map((r) => ({ id: r.key, label: r.name, n: snap.tasks.filter((t) => workKey(t) === r.key).length, machine: machineLabel(snap, r.machine) }))
    return [...repos, ...f.repo.filter((id) => !repos.some((r) => r.id === id)).map((id) => ({ id, label: id.replace(/^.*?:/, '').replace(/^.*\//, '') || id, n: 0, machine: '' }))]
  }
  // spaces: Everything first, then as the list orders them, each with its machine (two spaces may share a name)
  const ids = [...new Set([...snap.places.map((p) => p.id), ...snap.tasks.map((t) => t.place), ...f.space])]
  return ids
    .map((id) => ({ id, label: spaceLabel(snap, id) || id, n: n(id), machine: machineLabel(snap, snap.places.find((p) => p.id === id)?.machine ?? '') }))
    .filter((c) => c.n || f.space.includes(c.id))
    .sort((a, b) => Number(isEverything(snap, b.id)) - Number(isEverything(snap, a.id)))
}

/** one choice turned on or off */
export function toggle(f: TaskFilter, key: GroupKey, id: string): TaskFilter {
  const on = f[key].includes(id)
  const next = { ...f, [key]: on ? f[key].filter((x) => x !== id) : [...f[key], id] }
  // picking Done or Archived shows them again
  if (!on && key === 'state' && (id === 'done' || id === 'archived')) next.hideDone = false
  return next
}

/** the chips under the header: each one a choice that is on, taken off by its ✕ */
export interface Chip {
  key: string
  label: string
  icon: 'hash' | 'folder' | 'layers' | 'server' | 'check' | 'ask' | 'working' | 'ready' | 'next' | 'clock' | 'archive'
  off: (f: TaskFilter) => TaskFilter
}
/** a state's chip carries its status mark */
const STATE_ICON: Record<FState, Chip['icon']> = { needs: 'ask', working: 'working', ready: 'ready', next: 'next', scheduled: 'clock', stopped: 'ask', done: 'check', archived: 'archive' }

export function chipsOf(snap: Snapshot, f: TaskFilter, at: string): Chip[] {
  const out: Chip[] = []
  if (hereOn(snap, f, at)) out.push({ key: 'here', label: `${spaceLabel(snap, at)} only`, icon: 'hash', off: (x) => ({ ...x, here: false }) })
  if (f.hideDone) out.push({ key: 'hideDone', label: 'Done hidden', icon: 'check', off: (x) => ({ ...x, hideDone: false }) })
  for (const id of f.state) out.push({ key: `state:${id}`, label: STATE_WORDS[id as FState] ?? id, icon: STATE_ICON[id as FState] ?? 'check', off: (x) => toggle(x, 'state', id) })
  for (const id of f.machine) out.push({ key: `machine:${id}`, label: machineLabel(snap, id), icon: 'server', off: (x) => toggle(x, 'machine', id) })
  for (const id of f.space.filter((x) => x.trim())) out.push({ key: `space:${id}`, label: (spaceLabel(snap, id) || id).replace(/^#/, ''), icon: isEverything(snap, id) ? 'layers' : 'hash', off: (x) => toggle(x, 'space', id) })
  for (const id of f.repo) out.push({ key: `repo:${id}`, label: reposOf(snap).find((r) => r.key === id)?.name ?? (id.replace(/^.*\//, '') || id), icon: 'folder', off: (x) => toggle(x, 'repo', id) })
  return out
}
