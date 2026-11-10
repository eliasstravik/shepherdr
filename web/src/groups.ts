// How a list's tasks are grouped: two ways (SHEP-182), one toggle, kept on this device. Status (the default): one group
// per status in the order of who has to act (Needs you, Ready, Merging, Working, Queued, Scheduled, To do), each row
// saying its machine and space; Done last, behind its count. Place: a group per space, under its machine when more than
// one machine has tasks, every status mixed in each (the row's icon says which); Done last too. Pinned tasks get a
// Pinned group on top in both.
import { doneNewestFirst, type Machine, type Place, type Task } from '@shared/types.ts'

export type GroupBy = 'status' | 'place'

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

const KEY = 'shepherdr.tasksBy'

/** the kept choice: Status until Place is chosen */
export function loadGroups(): GroupBy {
  try {
    return localStorage.getItem(KEY) === 'place' ? 'place' : 'status'
  } catch {
    return 'status'
  }
}

export function saveGroups(by: GroupBy) {
  try {
    localStorage.setItem(KEY, by)
  } catch {
    /* private window: Status again next time */
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

export interface TaskGroup {
  key: string
  label: string
  tasks: Task[]
  /** what its rows say of where each task is, as neither the view nor the group's heading says it */
  names: { machine: boolean; project: boolean }
  /** a space's group: its place (none: a list no space works in), whose chat its heading opens */
  place?: string
  /** a space's machine (its id and name), for the machine heading above its first space when more machines show */
  on?: string
  machine?: string
  /** a space's emoji (none: #) */
  emoji?: string
  /** the machine said quietly after the heading's name (the attention list's) */
  note?: string
}

/**
 * Tasks in their groups, in the order they show (archived ones left out). Done tasks are newest finished first. Pinned
 * ones first, in a group of their own.
 * - Status: one group per status, the empty ones left out, then Done (its own key: the list shows only its count until
 *   opened). Rows say their machine and space.
 * - Place: one group per space, machine by machine in the sidebar's order, its tasks in status order, then Done.
 * level: the view's (0 more machines, 1 a machine, 2 a space), which says what its rows needn't.
 */
export function groupTasks(places: Place[], machines: Machine[], ts: Task[], by: GroupBy, level = 1): TaskGroup[] {
  // archived tasks are in no group: only their place's Archived view shows them
  const all = doneNewestFirst(GROUPS.flatMap(([s]) => ts.filter((t) => t.status === s && !t.archived)))
  const names = namesFor(level)
  const pinned = all.filter((t) => t.pinned)
  const rest = all.filter((t) => !t.pinned)
  const done = rest.filter((t) => t.status === 'done')
  const open = rest.filter((t) => t.status !== 'done')
  return [
    ...(pinned.length ? [{ key: 'pinned', label: 'Pinned', tasks: pinned, names }] : []),
    ...(by === 'status' ? GROUPS.filter(([s]) => s !== 'done').map(([s, label]) => ({ key: s, label, tasks: open.filter((t) => t.status === s), names })).filter((g) => g.tasks.length) : projectGroups(places, machines, open)),
    ...(done.length ? [{ key: 'done', label: 'Done', tasks: done, names }] : []),
  ]
}

/** what rows must say of where each task is, in a view of this level grouped by nothing that says it: the machine
 *  (only when more than one show) and the space */
export const namesFor = (level: number) => ({ machine: level === 0, project: level < 2 })

/** a group with only the tasks kept */
export function keepTasks<G extends TaskGroup>(g: G, keep: (t: Task) => boolean): G {
  return { ...g, tasks: g.tasks.filter(keep) }
}

/** one group per task list, as the window's by space (mods/tasks spaceGroup): each list goes by the space working in its
 *  folder, a list no space works in after them, by its own name (Task.listName says which; a task's place is the space
 *  that started it, which may be another's). Machine by machine, in the order the sidebar meets them, a space in the
 *  sidebar's order. */
function projectGroups(places: Place[], machines: Machine[], ts: Task[]): TaskGroup[] {
  const nameOf = (t: Task) => t.listName ?? places.find((p) => p.id === t.place)?.name ?? ''
  const listOf = (t: Task) => `${t.on}|${nameOf(t)}`
  const lists = [...new Set(ts.map(listOf))]
  const at = (k: string) => { const i = places.findIndex((p) => `${p.machine}|${p.name}` === k); return i < 0 ? places.length : i }
  const nameAt = (k: string) => k.slice(k.indexOf('|') + 1)
  const onOf = (k: string) => k.slice(0, k.indexOf('|'))
  const order = [...new Set([...places.map((p) => p.machine), ...lists.map(onOf)])]
  const out: TaskGroup[] = []
  for (const k of lists.sort((a, b) => order.indexOf(onOf(a)) - order.indexOf(onOf(b)) || at(a) - at(b))) {
    const on = onOf(k)
    const p = places.find((x) => `${x.machine}|${x.name}` === k)
    out.push({ key: p?.id ?? `list:${k}`, label: nameAt(k), tasks: ts.filter((t) => listOf(t) === k), names: { machine: false, project: false }, on, machine: machines.find((m) => m.machine === on)?.name ?? on, ...(p ? { place: p.id } : {}), ...(p?.emoji ? { emoji: p.emoji } : {}) })
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
