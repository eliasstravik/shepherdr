// How a list's tasks are grouped, pinned ones first in a Pinned group of their own (only when it holds some): by status
// (Needs you, Ready, Merging, Working, Queued, To do, Done; To do shows even when empty, so the human sees where waiting
// tasks go) across everything it lists, or one list per space. A list of one machine's tasks (its chip) can be by
// space; one of more machines' (everything, or chips on more), also one list per machine, or each machine's name over
// its spaces' lists. One space's list is by status alone. More machines' and one machine's each keep their choice,
// remembered on this device; by status until chosen. By status on more spaces, each status's tasks (but Pinned's and
// Needs you's) go under a light heading per machine · space when they are in more than one (Split by space, on until
// switched off).
import { doneNewestFirst, type Machine, type Place, type Task } from '@shared/types.ts'

export type GroupBy = 'status' | 'machine' | 'project' | 'machine-project'
export type Groups = { all: GroupBy; machine: GroupBy; split: boolean }

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
    if (v) return { all: ok(v.all), machine: ok(v.machine), split: v.split !== false }
    const old = JSON.parse(localStorage.getItem(OLD) ?? 'null') as Partial<Groups> | null
    return { all: old?.all === 'project' ? 'machine-project' : 'status', machine: ok(old?.machine), split: true }
  } catch {
    return { all: 'status', machine: 'status', split: true }
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
  /** by status, Split by space on: its tasks per machine · space (more than one; its tasks are theirs, in this order) */
  subs?: SubGroup[]
}

/** a status group's tasks in one space (one task list): a light heading over them, folded on its own ("group/sub") */
export interface SubGroup {
  key: string
  /** the space's name (its list's) */
  label: string
  /** on All machines, its machine, quiet after the name */
  note?: string
  /** the space's emoji (none: #) */
  emoji?: string
  tasks: Task[]
  /** as it shows (shownGroups): all of them, Done cut short until Show all, folded shut */
  count?: number
  more?: number
  less?: boolean
  shut?: boolean
}

/** where a row's thing is, for Split by space: its machine and its list's (space's) name, and its latest news */
type Spot = { on: string; name: string; at?: number }

/**
 * Things (tasks, automations) per machine · space, as Split by space shows them: the space the person is in first
 * (here), then the one with the latest news, then the sidebar's order. Each with its space's emoji and, on All
 * machines (level 0), its machine's name. Only one space: none (no heading needed).
 */
export function bySpace<T>(items: T[], spot: (x: T) => Spot, places: Place[], machines: Machine[], level: number, here?: string): (Omit<SubGroup, 'tasks'> & { items: T[] })[] {
  const keyOf = (x: T) => { const s = spot(x); return `${s.on}|${s.name}` }
  const keys = [...new Set(items.map(keyOf))]
  if (keys.length < 2) return []
  const placeAt = (k: string) => places.findIndex((p) => `${p.machine}|${p.name}` === k)
  const latest = new Map(keys.map((k) => [k, Math.max(0, ...items.filter((x) => keyOf(x) === k).map((x) => spot(x).at ?? 0))]))
  const rank = (k: string) => (here && places[placeAt(k)]?.id === here ? 0 : 1)
  const at = (k: string) => { const i = placeAt(k); return i < 0 ? places.length : i }
  return keys
    .sort((a, b) => rank(a) - rank(b) || latest.get(b)! - latest.get(a)! || at(a) - at(b))
    .map((k) => {
      const [on, name] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)]
      const p = places[placeAt(k)]
      const machine = level === 0 ? machines.find((m) => m.machine === on)?.name ?? on : undefined
      return { key: p?.id ?? `list:${k}`, label: name, ...(machine ? { note: machine } : {}), ...(p?.emoji ? { emoji: p.emoji } : {}), items: items.filter((x) => keyOf(x) === k) }
    })
}

/** a task's spot: its machine, its list (a list goes by the space working in its folder, else its own name) */
const taskSpot = (places: Place[]) => (t: Task): Spot => ({ on: t.on, name: t.listName ?? places.find((p) => p.id === t.place)?.name ?? '', at: t.at })

/** a status group split by space (more than one), its tasks in its subgroups' order */
function split(g: TaskGroup, places: Place[], machines: Machine[], level: number, here?: string): TaskGroup {
  const subs = bySpace(g.tasks, taskSpot(places), places, machines, level, here).map(({ items, ...s }) => ({ ...s, tasks: items }))
  return subs.length ? { ...g, tasks: subs.flatMap((s) => s.tasks), subs } : g
}

/** a group with only the tasks kept, its subgroups too: empty ones go, and with one left, none (its rows say where) */
export function keepTasks<G extends TaskGroup>(g: G, keep: (t: Task) => boolean): G {
  const tasks = g.tasks.filter(keep)
  const subs = g.subs?.map((s) => ({ ...s, tasks: s.tasks.filter(keep) })).filter((s) => s.tasks.length)
  return { ...g, tasks, subs: subs && subs.length > 1 ? subs : undefined }
}

/**
 * Tasks in their groups, in the order they show (archived ones left out). Pinned tasks first, in a Pinned group in
 * status order, and in no other group. Then by status: Needs you, Ready, Merging, Working, Queued, To do, Done, the
 * empty ones left out. By machine or by project: Needs you first, then one group each, in the sidebar's order, its tasks
 * in that same status order. Machine › Project: each machine in the sidebar's order, its projects' groups under
 * it. Done tasks are newest finished first. level: the view's (0 All machines, 1 a machine, 2 a space), which says
 * what its rows needn't.
 */
export function groupTasks(places: Place[], machineList: Machine[], ts: Task[], by: GroupBy, level = 1, opts: { split?: boolean; here?: string } = {}): TaskGroup[] {
  // archived tasks are in no group: only their place's Archived view shows them
  const all = doneNewestFirst(GROUPS.flatMap(([s]) => ts.filter((t) => t.status === s && !t.archived)))
  const pinned = all.filter((t) => t.pinned)
  const top: TaskGroup[] = pinned.length ? [{ key: 'pinned', label: 'Pinned', tasks: pinned, names: namesFor(level) }] : []
  let rest = all.filter((t) => !t.pinned)
  const machineOf = new Map(places.map((p) => [p.id, p.machine]))
  const machines = machineList
  const onMachine = (m: Machine) => rest.filter((t) => machineOf.get(t.place) === m.machine)
  // as 3.0's: a group shows only when it holds something (To do too)
  // Split by space: each status's tasks per space, Needs you's (it holds what agents ask too) and Pinned's not
  const spaced = (g: TaskGroup) => (opts.split && level < 2 && g.key !== 'need' ? split(g, places, machines, level, opts.here) : g)
  if (by === 'status') return [...top, ...GROUPS.map(([s, label]) => ({ key: s, label, tasks: rest.filter((t) => t.status === s), names: namesFor(level) })).filter((g) => g.tasks.length).map(spaced)]
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

/** A group split by space as it shows: each subgroup folded on its own ("group/sub" in shut) and cut to its latest
 *  Done tasks on its own ("group/sub" in allDone); the group's tasks are what its open subgroups show */
export function shownSplit(g: TaskGroup, all: (key: string) => boolean, shut: (key: string) => boolean): TaskGroup & { count: number; more: number; less: boolean; shut: boolean } {
  if (!g.subs || shut(g.key)) return shownGroup(g, all(g.key), shut(g.key))
  const subs = g.subs.map((s) => {
    const k = `${g.key}/${s.key}`
    const { tasks, count, more, less, shut: folded } = shownGroup({ ...g, key: k, tasks: s.tasks, subs: undefined }, all(k), shut(k))
    return { ...s, tasks, count, more, less, shut: folded }
  })
  return { ...g, subs, tasks: subs.flatMap((s) => s.tasks), count: g.tasks.length, more: 0, less: false, shut: false }
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
