// How a list's tasks are grouped, pinned ones in a Pinned group of their own (only when it holds some). For you (the
// default, SHEP-98): what needs the person on top (Needs you, then Ready, flat, each row saying its space), then
// Pinned, then the rest per space in status order, Done after them, hidden behind a count. Space: Needs you first,
// then one list per space. Status: one group per status (Needs you, Ready, Merging, Working, Queued, To do, Done; the
// empty ones left out), each row saying its space. The machine is never a group: a space's heading names it only when
// two machines have a space of that name. Each level (more machines', one machine's) keeps its choice, remembered on
// this device.
import { doneNewestFirst, type Machine, type Place, type Task } from '@shared/types.ts'

export type GroupBy = 'you' | 'project' | 'status'
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
const GROUP_BY: GroupBy[] = ['you', 'project', 'status']

/** a kept choice: For you until another is chosen. Before SHEP-98, Status split by space was the default look (For
 *  you now) and Machine, Machine › Space and Split by space are gone: Status with the split off stays Status, the rest
 *  For you; Space stays Space. */
export function loadGroups(): Groups {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { all?: string; machine?: string; split?: boolean; v?: number } | null
    if (!v) return { all: 'you', machine: 'you' }
    const ok = (b: unknown): GroupBy => (b === 'project' ? 'project' : b === 'status' && (v.v === 2 || v.split === false) ? 'status' : 'you')
    return { all: ok(v.all), machine: ok(v.machine) }
  } catch {
    return { all: 'you', machine: 'you' }
  }
}

export function saveGroups(g: Groups) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...g, v: 2 }))
  } catch {
    /* private window: For you again next time */
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

/** the ways a list's tasks can be grouped (any level: one space's list says its space in its one heading) */
export function groupChoices(_level: number): GroupBy[] {
  return GROUP_BY
}

export function groupFor(groups: Groups, level: number): GroupBy {
  const by = level === 0 ? groups.all : groups.machine
  return GROUP_BY.includes(by) ? by : 'you'
}

export interface TaskGroup {
  key: string
  label: string
  tasks: Task[]
  /** what its rows say of where each task is, as neither the view nor the group's heading says it */
  names: { machine: boolean; project: boolean }
  /** a space's group: its place (none: a list no space works in), whose chat its heading opens under For you */
  place?: string
  /** a space's emoji (none: #) */
  emoji?: string
  /** a space's machine, quiet after its name: only when two machines have a space of that name */
  note?: string
}

/**
 * Tasks in their groups, in the order they show (archived ones left out). Done tasks are newest finished first.
 * - For you: For you (Needs you, then Ready; pinned or not), Pinned (the rest of the pinned ones, in status order),
 *   then one group per space in the sidebar's order, its tasks in status order, then Done (its own key: the list
 *   shows only its count until opened).
 * - Space: Pinned, Needs you, then one group per space, Done tasks in it.
 * - Status: Pinned, then one group per status, the empty ones left out.
 * level: the view's (0 All machines, 1 a machine, 2 a space), which says what its rows needn't.
 */
export function groupTasks(places: Place[], machines: Machine[], ts: Task[], by: GroupBy, level = 1): TaskGroup[] {
  // archived tasks are in no group: only their place's Archived view shows them
  const all = doneNewestFirst(GROUPS.flatMap(([s]) => ts.filter((t) => t.status === s && !t.archived)))
  if (by === 'you') {
    const mine = all.filter((t) => t.status === 'need' || t.status === 'ready')
    const pinned = all.filter((t) => t.pinned && !mine.includes(t))
    const rest = all.filter((t) => !t.pinned && !mine.includes(t))
    const done = rest.filter((t) => t.status === 'done')
    return [
      ...(mine.length ? [{ key: 'you', label: 'For you', tasks: mine, names: { machine: false, project: level < 2 } }] : []),
      ...(pinned.length ? [{ key: 'pinned', label: 'Pinned', tasks: pinned, names: { machine: false, project: level < 2 } }] : []),
      ...projectGroups(places, machines, rest.filter((t) => t.status !== 'done'), level),
      ...(done.length ? [{ key: 'done', label: 'Done', tasks: done, names: { machine: false, project: level < 2 } }] : []),
    ]
  }
  const pinned = all.filter((t) => t.pinned)
  const top: TaskGroup[] = pinned.length ? [{ key: 'pinned', label: 'Pinned', tasks: pinned, names: namesFor(level) }] : []
  let rest = all.filter((t) => !t.pinned)
  // as 3.0's: a group shows only when it holds something (To do too)
  if (by === 'status') return [...top, ...GROUPS.map(([s, label]) => ({ key: s, label, tasks: rest.filter((t) => t.status === s), names: namesFor(level) })).filter((g) => g.tasks.length)]
  // 3.0: by space, Needs you comes first (after Pinned), and its tasks aren't shown again below
  const needs = rest.filter((t) => t.status === 'need')
  if (needs.length) top.push({ key: 'need', label: 'Needs you', tasks: needs, names: namesFor(level) })
  rest = rest.filter((t) => t.status !== 'need')
  return [...top, ...projectGroups(places, machines, rest, level)]
}

/** what rows must say of where each task is, in a view of this level grouped by nothing that says it: the space,
 *  never the machine (SHEP-98: a quiet detail of the task's own view) */
export const namesFor = (level: number) => ({ machine: false, project: level < 2 })

/** a group with only the tasks kept */
export function keepTasks<G extends TaskGroup>(g: G, keep: (t: Task) => boolean): G {
  return { ...g, tasks: g.tasks.filter(keep) }
}

/** one group per task list, as the window's by space (mods/tasks spaceGroup): each list goes by the space working in its
 *  folder, in the sidebar's order, a list no space works in after them, by its own name (Task.listName says which; a
 *  task's place is the space that started it, which may be another's). On All machines, a space's machine is said
 *  after its name only when another machine has a space of that name. */
function projectGroups(places: Place[], machines: Machine[], ts: Task[], level: number): TaskGroup[] {
  const out: TaskGroup[] = []
  const nameOf = (t: Task) => t.listName ?? places.find((p) => p.id === t.place)?.name ?? ''
  const listOf = (t: Task) => `${t.on}|${nameOf(t)}`
  const lists = [...new Set(ts.map(listOf))]
  const at = (k: string) => { const i = places.findIndex((p) => `${p.machine}|${p.name}` === k); return i < 0 ? places.length : i }
  const nameAt = (k: string) => k.slice(k.indexOf('|') + 1)
  for (const k of lists.sort((a, b) => at(a) - at(b))) {
    const tasks = ts.filter((t) => listOf(t) === k)
    const [on, name] = [k.slice(0, k.indexOf('|')), nameAt(k)]
    const p = places.find((x) => `${x.machine}|${x.name}` === k)
    const twin = level === 0 && lists.some((o) => o !== k && nameAt(o) === name)
    const note = twin ? machines.find((m) => m.machine === on)?.name ?? on : undefined
    out.push({ key: p?.id ?? `list:${k}`, label: name, tasks, names: { machine: false, project: false }, ...(p ? { place: p.id } : {}), ...(p?.emoji ? { emoji: p.emoji } : {}), ...(note ? { note } : {}) })
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
