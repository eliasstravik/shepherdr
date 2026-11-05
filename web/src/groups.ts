// How a list's tasks are grouped, pinned ones first in a Pinned group of their own (only when it holds some): by status
// (Needs you, Ready, Merging, Working, Queued, To do, Done; To do shows even when empty, so the human sees where waiting
// tasks go) across everything it lists, or one list per space. A list of one machine's tasks (its chip) can be by
// space; one of more machines' (everything, or chips on more), also one list per machine, or each machine's name over
// its spaces' lists. One space's list is by status alone. More machines' and one machine's each keep their choice,
// remembered on this device; by status until chosen.
import { doneNewestFirst, type Machine, type Place, type Task } from '@shared/types.ts'

export type GroupBy = 'status' | 'machine' | 'project' | 'machine-project'
export type Groups = { all: GroupBy; machine: GroupBy }

export const GROUPS: [Task['status'], string][] = [
  ['need', 'Needs you'],
  ['ready', 'Ready'],
  ['merging', 'Merging'],
  ['work', 'Working'],
  ['queued', 'Queued'],
  ['scheduled', 'Scheduled'],
  ['todo', 'To do'],
  ['done', 'Done'],
]

const KEY = 'shepherdr.grouping'
// before: All machines always split by machine, so its by project was each machine's name over its projects
const OLD = 'shepherdr.groups'
const GROUP_BY: GroupBy[] = ['status', 'machine', 'project', 'machine-project']

export function loadGroups(): Groups {
  const ok = (v: unknown) => (GROUP_BY.includes(v as GroupBy) ? (v as GroupBy) : 'status')
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Groups> | null
    if (v) return { all: ok(v.all), machine: ok(v.machine) }
    const old = JSON.parse(localStorage.getItem(OLD) ?? 'null') as Partial<Groups> | null
    return { all: old?.all === 'project' ? 'machine-project' : 'status', machine: ok(old?.machine) }
  } catch {
    return { all: 'status', machine: 'status' }
  }
}

export function saveGroups(g: Groups) {
  try {
    localStorage.setItem(KEY, JSON.stringify(g))
  } catch {
    /* private window: by status again next time */
  }
}

const ALL_DONE = 'shepherdr.allDone'

/** the groups showing all their Done tasks ("place|group"), remembered on this device */
export function loadAllDone(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(ALL_DONE) ?? 'null') as unknown
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

export function saveAllDone(keys: string[]) {
  try {
    localStorage.setItem(ALL_DONE, JSON.stringify(keys))
  } catch {
    /* private window: the latest few again next time */
  }
}

const SHUT = 'shepherdr.shut'

/** the headings folded shut, each a view's own ("place|group", "place|m:machine"), remembered on this device */
export function loadShut(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SHUT) ?? 'null') as unknown
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

export function saveShut(keys: string[]) {
  try {
    localStorage.setItem(SHUT, JSON.stringify(keys))
  } catch {
    /* private window: all open again next time */
  }
}

/** the ways a list's tasks can be grouped, by its level (0 more machines', 1 one machine's, 2 one space's) */
export function groupChoices(level: number): GroupBy[] {
  // 3.0's Group by: Status, Space, then Machine and Machine › Space while more than one machine has tasks
  return level === 0 ? ['status', 'project', 'machine', 'machine-project'] : level === 1 ? ['status', 'project'] : ['status']
}

export function groupFor(groups: Groups, level: number): GroupBy {
  const by = level === 0 ? groups.all : groups.machine
  return groupChoices(level).includes(by) ? by : 'status'
}

export interface TaskGroup {
  key: string
  label: string
  tasks: Task[]
  /** what its rows say of where each task is, as neither the view nor the group's heading says it */
  names: { machine: boolean; project: boolean }
  /** by machine: it is a machine's, its heading a machine's */
  kind?: 'machine'
  /** by project on All machines: the machine it is on, quiet after its name */
  note?: string
  /** Machine › Project: the machine it sits under, its name a heading over that machine's groups */
  machine?: { id: string; name: string }
}

/**
 * Tasks in their groups, in the order they show (archived ones left out). Pinned tasks first, in a Pinned group in
 * status order, and in no other group. Then by status: Needs you, Ready, Merging, Working, Queued, To do, Done, the
 * empty ones left out. By machine or by project: Needs you first, then one group each, in the sidebar's order, its tasks
 * in that same status order. Machine › Project: each machine in the sidebar's order, its projects' groups under
 * it. Done tasks are newest finished first. level: the view's (0 All machines, 1 a machine, 2 a space), which says
 * what its rows needn't.
 */
export function groupTasks(places: Place[], machineList: Machine[], ts: Task[], by: GroupBy, level = 1): TaskGroup[] {
  // archived tasks are in no group: only their place's Archived view shows them
  const all = doneNewestFirst(GROUPS.flatMap(([s]) => ts.filter((t) => t.status === s && !t.archived)))
  const pinned = all.filter((t) => t.pinned)
  const top: TaskGroup[] = pinned.length ? [{ key: 'pinned', label: 'Pinned', tasks: pinned, names: namesFor(level) }] : []
  let rest = all.filter((t) => !t.pinned)
  const machineOf = new Map(places.map((p) => [p.id, p.machine]))
  const machines = machineList
  const onMachine = (m: Machine) => rest.filter((t) => machineOf.get(t.place) === m.machine)
  // as 3.0's: a group shows only when it holds something (To do too)
  if (by === 'status') return [...top, ...GROUPS.map(([s, label]) => ({ key: s, label, tasks: rest.filter((t) => t.status === s), names: namesFor(level) })).filter((g) => g.tasks.length)]
  // 3.0: whatever the grouping, Needs you comes first (after Pinned), and its tasks aren't shown again below
  const needs = rest.filter((t) => t.status === 'need')
  if (needs.length) top.push({ key: 'need', label: 'Needs you', tasks: needs, names: namesFor(level) })
  rest = rest.filter((t) => t.status !== 'need')
  if (by === 'machine' && level === 0) {
    // one on no machine in the list (none should be) still shows, last, as by status
    const lost = rest.filter((t) => !machines.some((m) => m.machine === machineOf.get(t.place)))
    return [
      ...top,
      ...machines.map((m) => ({ key: m.id, label: m.name, kind: 'machine' as const, tasks: onMachine(m), names: { machine: false, project: true } })).filter((g) => g.tasks.length),
      ...(lost.length ? [{ key: 'lost', label: 'No machine', tasks: lost, names: namesFor(level) }] : []),
    ]
  }
  if (by === 'machine-project' && level === 0)
    return [
      ...top,
      ...machines.flatMap((m) => projectGroups(places, machines, onMachine(m), 1).map((g) => ({ ...g, key: `${m.id}|${g.key}`, machine: { id: m.id, name: m.name } }))),
      ...projectGroups(places, machines, rest.filter((t) => !machines.some((m) => m.machine === machineOf.get(t.place))), 1),
    ]
  return [...top, ...projectGroups(places, machines, rest, level)]
}

/** what rows must say of where each task is, in a view of this level grouped by nothing that says it */
export const namesFor = (level: number) => ({ machine: level === 0, project: level < 2 })

/** one group per task list, as the window's by space (mods/tasks spaceGroup): each list goes by the space working in its
 *  folder, in the sidebar's order, a list no space works in after them, by its own name (Task.listName says which; a
 *  task's place is the space that started it, which may be another's). On All machines, each says its machine after
 *  its name. */
function projectGroups(places: Place[], machines: Machine[], ts: Task[], level: number): TaskGroup[] {
  const out: TaskGroup[] = []
  const listOf = (t: Task) => `${t.on}|${t.listName ?? places.find((p) => p.id === t.place)?.name ?? ''}`
  const lists = [...new Set(ts.map(listOf))]
  const at = (k: string) => { const i = places.findIndex((p) => `${p.machine}|${p.name}` === k); return i < 0 ? places.length : i }
  for (const k of lists.sort((a, b) => at(a) - at(b))) {
    const tasks = ts.filter((t) => listOf(t) === k)
    const [on, name] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)]
    const p = places.find((x) => `${x.machine}|${x.name}` === k)
    const machine = level === 0 ? machines.find((m) => m.machine === on)?.name : undefined
    out.push({ key: p?.id ?? `list:${k}`, label: name, note: machine, tasks, names: { machine: false, project: false } })
  }
  return out
}

/** a group's Done tasks shown before Show all */
export const DONE_SHOWN = 5

/** A group as it shows: at most DONE_SHOWN of its Done tasks until Show all; more is how many Done are hidden then, less
 * that all show and Show less would cut them short again */
export function shownGroup(g: TaskGroup, all: boolean, shut = false): TaskGroup & { count: number; more: number; less: boolean; shut: boolean } {
  // folded shut, none show, but its count stays
  if (shut) return { ...g, tasks: [], count: g.tasks.length, more: 0, less: false, shut }
  const done = g.tasks.filter((t) => t.status === 'done')
  // pinned ones all show, done or not: each was pinned to be seen
  if (g.key === 'pinned' || done.length <= DONE_SHOWN) return { ...g, count: g.tasks.length, more: 0, less: false, shut }
  if (all) return { ...g, count: g.tasks.length, more: 0, less: true, shut }
  const hide = new Set(done.slice(DONE_SHOWN))
  return { ...g, tasks: g.tasks.filter((t) => !hide.has(t)), count: g.tasks.length, more: hide.size, less: false, shut }
}
