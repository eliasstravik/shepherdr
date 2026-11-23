// What the person sees, worked out from the server's data by plain rules (no model in this path): the list (Everything,
// machines as headings, groups, spaces), a task's status from its agent's report and the facts Shepherdr knows, its
// row's words and time, a space's "needs you" count. The app, the alerts and the voice all read it from here.
import type { Artifact, Automation, Machine, Place, Section, Snapshot, Task } from './types.ts'

export type Space = Place

/* ---------- spaces ---------- */

/** Everything: the root space, one agent in a home folder on the serving machine */
export function everything(snap: Snapshot): Place | undefined {
  return snap.places.find((p) => p.id === snap.everything) ?? snap.places.find((p) => p.home && p.machine === snap.host)
}

export const isEverything = (snap: Snapshot, id: string) => everything(snap)?.id === id

/** a space the app shows: Everything or a space (another machine's home space is not one) */
export function placeOf(snap: Snapshot, id: string | null | undefined): Place | undefined {
  if (!id) return undefined
  const p = snap.places.find((x) => x.id === id)
  return p && (!p.home || isEverything(snap, p.id)) ? p : undefined
}

/** the spaces of the list: every space but the home ones */
export const spacesOf = (snap: Snapshot) => snap.places.filter((p) => !p.home)

/** "#shop", or "Everything" */
export function spaceLabel(snap: Snapshot, id: string): string {
  if (isEverything(snap, id)) return 'Everything'
  const p = snap.places.find((x) => x.id === id)
  return p ? `#${p.name}` : ''
}

export const machineOf = (snap: Snapshot, key: string): Machine | undefined => snap.machines.find((m) => m.machine === key)

/** A space's folder (SHEP-302): `short` as it shows, its own machine's home as ~ (the service gives it so); `full` the
 *  whole path on its machine; `machine` named when it is not the one Shepherdr runs on. */
export function folderOf(snap: Snapshot, p: Pick<Place, 'machine' | 'where' | 'folder'>): { short: string; full: string; machine: string | null } {
  const short = (p.where || p.folder || '').replace(/(.)\/+$/, '$1')
  return { short, full: p.folder || short, machine: p.machine && p.machine !== snap.host ? machineLabel(snap, p.machine) : null }
}

/** a folder as it shows: its path as it is, ~ for the home folder and / for the root, never a made-up name */
export const folderName = (path: string) => path || '/'
/** what a chat's header says of where it is (SHEP-360): the folder as it is (~ and / too, never a made-up name; a
 *  path's start gives way: `cut`), and its machine when that adds something: another machine, or Everything's home */
export function headerWhere(snap: Snapshot, p: Pick<Place, 'id' | 'machine' | 'where' | 'folder'>): { path: string; cut: boolean; full: string; machine: string | null } | null {
  const f = folderOf(snap, p)
  const every = isEverything(snap, p.id)
  if (!f.short && !every) return null
  const short = every && !f.short ? '~' : f.short
  return { path: short, cut: short !== '~' && short !== '/', full: f.full || '~', machine: f.machine ?? (every ? machineLabel(snap, p.machine) : null) }
}
export const machineLabel = (snap: Snapshot, key: string) => machineOf(snap, key)?.name ?? key

/** a machine the serving one can't reach now */
export const unreachable = (m: Machine | undefined) => !!m && m.status === 'off' && !m.connecting

/** SHEP-310: herdr-core's why for a link whose far side answers with another core than the one it holds */
export const staleLink = (why: string | undefined) => !!why && /a different core answers there/.test(why)
/** what the Machines page says of such a link (herdr-task's words: machines.STALE_WORDS) */
export const STALE_LINK = 'A different herdr-core answers there now (it was set up again since it was linked), so nothing gets through. ' +
  'Run herdr-task carry-over on the computer that serves this app to link it again.'

/** the machine a space is on can't be reached */
export function placeDown(snap: Snapshot, id: string): Machine | undefined {
  const p = snap.places.find((x) => x.id === id)
  const m = p && machineOf(snap, p.machine)
  return unreachable(m) ? m : undefined
}

/** "Can't reach vm · last seen 14:02" */
export function downWords(m: Machine): string {
  return `Can't reach ${m.name}${m.unreachableSince ? ` · last seen ${m.unreachableSince}` : ''}${m.linkWhy ? ' · its link is broken' : ''}`
}

/** "#shop · mac-mini", or "Everything · mac-mini" */
export function whereWords(snap: Snapshot, placeId: string): string {
  const p = snap.places.find((x) => x.id === placeId)
  if (!p) return ''
  return `${spaceLabel(snap, placeId)} · ${machineLabel(snap, p.machine)}`
}

export interface ListGroup {
  id: string
  name: string
  spaces: Place[]
}
/** which spaces a machine's heading shows */
export type ListFilter = 'Active' | 'Archived' | 'All'

export interface ListMachine {
  machine: Machine
  /** a few words when it needs attention (a warning mark that opens Settings › Machines) */
  warn: string
  /** what its filter shows, and how many of its spaces are archived (the filter's menu says) */
  filter: ListFilter
  archived: number
  /** groups first as the person ordered them, then the spaces in no group */
  groups: ListGroup[]
  spaces: Place[]
}

/** why a machine carries a warning mark: out of reach, or disk or memory over 90% */
export function machineWarn(m: Machine): string {
  if (unreachable(m)) return "Can't reach"
  const hot = m.health?.meters.find((x) => /disk|memory/i.test(x.name) && x.pct > 90)
  return hot ? `${/disk/i.test(hot.name) ? 'Disk' : 'Memory'} nearly full` : ''
}

/** the list under Everything: machines as headings, their groups and spaces, as each machine's filter says (one for
 *  all, or by machine key); every machine stays, with how many archived spaces it has */
export function listOf(snap: Snapshot, filter: ListFilter | ((machine: string) => ListFilter)): ListMachine[] {
  const sections: Section[] = (snap.sections ?? []).filter((s) => s.id !== 'pinned')
  return snap.machines.map((machine) => {
    const f = typeof filter === 'function' ? filter(machine.machine) : filter
    const all = snap.places.filter((p) => p.machine === machine.machine && !p.home)
    const mine = all.filter((p) => f === 'All' || (f === 'Archived') === !!p.archived)
    const groups = sections
      .filter((s) => (s.machine ?? snap.host) === machine.machine)
      .map((s) => ({ id: s.id, name: s.name, spaces: s.spaces.map((id) => mine.find((p) => p.id === id)).filter((p): p is Place => !!p) }))
    const grouped = new Set(groups.flatMap((g) => g.spaces.map((p) => p.id)))
    // the archived view lists spaces only
    return { machine, warn: machineWarn(machine), filter: f, archived: all.filter((p) => p.archived).length, groups: f === 'Archived' ? [] : groups, spaces: mine.filter((p) => f === 'Archived' || !grouped.has(p.id)) }
  })
}

/** the group a space is in */
export function groupOf(snap: Snapshot, placeId: string): Section | undefined {
  return (snap.sections ?? []).find((s) => s.id !== 'pinned' && s.spaces.includes(placeId))
}

/* ---------- a task's status ---------- */

/** the groups of Tasks › Now */
export type TaskState = 'ask' | 'ready' | 'working' | 'next' | 'done' | 'archived'

/** Which group a task is in. First match wins, as the plan's status table: a fact before the agent's report. */
export function tstate(t: Task): TaskState {
  if (t.archived) return 'archived'
  if (t.status === 'done') return 'done'
  if (t.status === 'merging' || t.accepting) return 'working'
  if (t.status === 'ready') return 'ready'
  if (t.status === 'need' || t.stopped) return 'ask'
  if (t.status === 'work') return 'working'
  return 'next'
}

export type Tone = 'ask' | 'ready' | 'working' | 'red' | 'mute'

/** on a branch or worktree: Mark as done merges it, and closing it without merging says so */
export const onBranch = (t: Task) => t.repo === 'branch' || (t.repo === undefined && !!(t.branch || t.pr))

/** the status word of a task's status line */
export function statusWord(t: Task): { word: string; tone: Tone } {
  const s = tstate(t)
  if (s === 'done' || s === 'archived') return { word: doneWords(t).split(' · ').slice(0, t.merged ? 1 : 2).join(' · '), tone: 'mute' }
  if (t.status === 'merging' || t.accepting) return { word: 'Merging', tone: 'working' }
  if (s === 'ready') return { word: 'Ready for review', tone: 'ready' }
  if (t.stopped) return t.stopped.by === 'you' ? { word: 'Stopped by you', tone: 'ask' } : { word: 'Stopped', tone: 'red' }
  if (s === 'ask') return { word: 'Needs you', tone: 'ask' }
  if (s === 'working') return { word: t.waitsDesktop ? 'Waiting for the desktop' : 'Working', tone: 'mute' }
  return { word: 'Up next', tone: 'mute' }
}

/** how a finished task ended: "Done and merged · 1 link fixed", "Done · not merged", "Done · nothing to do" */
export function doneWords(t: Task): string {
  if (t.quiet === 'nothing') return 'Done · nothing to do'
  if (t.merged) return `Done and merged${t.doneNote ? ` · ${t.doneNote}` : ''}`
  if (t.quiet === 'told') return `Done · ${t.doneNote ?? 'told you in its chat'}`
  if (onBranch(t)) return 'Done · not merged'
  return `Done${t.doneNote ? ` · ${t.doneNote}` : ''}`
}

/** a task row's second line: what it says now (nothing for a plain task not started yet) */
export function taskLine(t: Task): string {
  const s = tstate(t)
  if (s === 'done' || s === 'archived') return doneWords(t)
  if (t.status === 'merging' || t.accepting) return 'Merging…'
  if (s === 'ready') return 'Ready for review'
  if (t.stopped) return t.stopped.by === 'you' ? 'Stopped by you' : `Stopped${t.stopped.why ? ` · ${t.stopped.why}` : ''}`
  if (s === 'ask') return t.report?.msg || (t.blocked === 'prompt' ? 'Waiting at a prompt' : t.blocked === 'permission' ? 'Wants to run a command' : 'Waits for your reply')
  if (s === 'working') return t.waitsDesktop ? 'Waiting for the desktop' : t.report?.msg || (t.schedule ? 'Started by its schedule' : '')
  return t.afterTitle ? afterWords(t) : t.startsAt ? `Starts ${dayTime(t.startsAt)}` : ''
}

/** what an Up next task waits for, short: "Starts after Fix typo", or "Starts after 6 tasks" when it waits for several
 *  (a long title then a cut-off line said less than the count) */
export function afterWords(t: Pick<Task, 'afterTitle' | 'afterMore'>): string {
  if (!t.afterTitle) return ''
  return t.afterMore ? `Starts after ${t.afterMore + 1} tasks` : `Starts after ${t.afterTitle}`
}

/** "2h", "5m", "1w": how long ago, short */
export function agoShort(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - ms) / 60000))
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  return d < 7 ? `${d}d` : `${Math.round(d / 7)}w`
}

/** "Fri 9:00" */
export function dayTime(ms: number): string {
  const d = new Date(ms)
  const today = new Date().toDateString() === d.toDateString()
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  return today ? `today ${time}` : `${d.toLocaleDateString('en', { weekday: 'short' })} ${time}`
}

/** A task's time left as its agent reports it (herdr-task status --left, counted down by the service), in minutes:
 *  only while it works (frozen and not shown while it waits on you); none when it gave none. 0: under a minute. */
export function etaOf(t: Task): number | null {
  const eta = t.report?.eta
  if (tstate(t) !== 'working' || t.status === 'merging' || t.accepting || t.waitsDesktop || t.report?.paused) return null
  return typeof eta === 'number' && eta >= 0 ? eta : null
}

/** "10 min left", "2 h left" */
export function leftWords(min: number | null): string {
  if (min === null) return ''
  return min < 1 ? 'under a minute left' : min < 60 ? `${min} min left` : `${Math.round(min / 60)} h left`
}

/** the time left as few letters as fit under a task's status icon: "<1m", "13m", "59m", "1h", "2h"; nothing unknown */
export function leftShort(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min) || min < 0) return ''
  if (min < 1) return '<1m'
  if (min < 60) return `${Math.round(min)}m`
  return `${Math.round(min / 60)}h`
}

/** How a task's status icon draws (SHEP-321, as before 3.2.0: a ring filled by the % done its agent reports, the time
 *  left under it). `check`: finished (Ready for review, merging, Done). Otherwise the ring: `pct` its share done
 *  (0-100; null: none reported yet, an alive indeterminate ring while it works), `tone` its colour, `mark` the small
 *  sign that tells states apart without colour (needs you: the ring's inside softly tinted; stopped: a square; not started, waiting for the person's Start: a dotted ring, as
 *  Linear's Backlog; Up next and Scheduled are a plain empty ring, as its Todo). */
export interface Ring {
  kind: 'check' | 'ring'
  tone: 'working' | 'ask' | 'red' | 'ready' | 'mute'
  pct: number | null
  mark?: 'tint' | 'stop' | 'unstarted'
  /** the words a screen reader says for it */
  label: string
}

export function ringOf(t: Task): Ring {
  const s = tstate(t)
  if (s === 'done' || s === 'archived') return { kind: 'check', tone: 'mute', pct: 100, label: 'Done' }
  if (s === 'ready' || t.status === 'merging' || t.accepting) return { kind: 'check', tone: 'ready', pct: 100, label: s === 'ready' ? 'Ready for review' : 'Merging' }
  const p = t.report?.progress
  const pct = typeof p === 'number' && Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : null
  const done = pct === null ? '' : `, ${pct}% done`
  if (t.stopped) return t.stopped.by === 'you' ? { kind: 'ring', tone: 'ask', pct, mark: 'stop', label: `Stopped by you${done}` } : { kind: 'ring', tone: 'red', pct, mark: 'stop', label: `Stopped${done}` }
  if (s === 'ask') return { kind: 'ring', tone: 'ask', pct, mark: 'tint', label: `Needs you${done}` }
  if (s === 'working') return { kind: 'ring', tone: 'working', pct, label: `Working${done}` }
  // added and waiting for the person's Start (SHEP-369): a dotted ring; queued or scheduled (starts by itself): a solid empty one
  if (t.status === 'todo' && !t.agent && !t.started) return { kind: 'ring', tone: 'mute', pct: pct ?? 0, mark: 'unstarted', label: 'Not started' }
  return { kind: 'ring', tone: 'mute', pct: pct ?? 0, label: 'Up next' }
}

/** the time at the right of a task's row: how long a Needs you row has waited for the person, how long ago a Done row
 *  ended. A Working row's time left sits under its status icon instead (leftShort). */
export function taskWhen(t: Task, now = Date.now()): string {
  const s = tstate(t)
  if (s === 'ask' || s === 'ready') return t.needsAt ? agoShort(t.needsAt, now) : ''
  if (s === 'done') return t.doneAt ? agoShort(t.doneAt, now) : ''
  return ''
}

export const taskOf = (snap: Snapshot, id: string | null | undefined): Task | undefined => (id ? snap.tasks.find((t) => t.id === id) : undefined)

/** a task's chat on the server (its agent's, or where one would be) */
export const taskChat = (t: Task) => t.agent?.chat ?? `${t.id}/worker`

/** the short id shown as small print in a task's header ("SHOP-12" of "vm:SHOP-12") */
export const taskRef = (t: Task) => t.id.replace(/^.*:/, '')

/** the tasks a view lists: every one from Everything, a space's own inside it */
export function tasksIn(snap: Snapshot, placeId: string): Task[] {
  return isEverything(snap, placeId) ? snap.tasks : snap.tasks.filter((t) => taskInSpace(t, placeId))
}

/** SHEP-325: a space's Tasks and its count hold what it started and what works in its folder (the window's rule) */
export const taskInSpace = (t: Task, placeId: string) => t.place === placeId || !!t.also?.includes(placeId)

/* ---------- where a task works (SHEP-325) ---------- */

/** a task's folder as one key: its machine and folder */
export const workKey = (t: Task) => (t.work ? `${t.on}:${t.work.folder}` : '')

/** "shepherdr", "~", "~/notes": a repo by its name, any other folder by its path */
export const workName = (t: Task) => (t.work ? (t.work.repo ? t.work.name : folderName(t.work.short || t.work.name)) : '')

/** what a task's tag says: where it works, and its machine only when there is more than one ("shepherdr · mac-mini") */
export function workWords(snap: Snapshot, t: Task): string {
  const name = workName(t)
  if (!name) return ''
  return snap.machines.length > 1 ? `${name} · ${machineLabel(snap, t.on)}` : name
}

export interface Repo {
  key: string
  name: string
  folder: string
  /** its folder as it shows (~/dev/shop) */
  short: string
  machine: string
  repo: boolean
  /** its tasks, archived ones left out */
  tasks: Task[]
}

/** the repos and folders tasks work in, most tasks first (then by name); a repo's tag and Everything's filter use it */
export function reposOf(snap: Snapshot): Repo[] {
  const by = new Map<string, Repo>()
  for (const t of snap.tasks) {
    if (!t.work) continue
    const k = workKey(t)
    const r = by.get(k) ?? by.set(k, { key: k, name: workName(t), folder: t.work.folder, short: t.work.short || t.work.folder, machine: t.on, repo: t.work.repo, tasks: [] }).get(k)!
    if (!t.archived) r.tasks.push(t)
  }
  return [...by.values()].sort((a, b) => b.tasks.length - a.tasks.length || a.name.localeCompare(b.name))
}

/** the space working in a repo's folder on its machine, if one does */
export const spaceOnFolder = (snap: Snapshot, r: Pick<Repo, 'folder' | 'machine'>) =>
  snap.places.find((p) => (!p.home || isEverything(snap, p.id)) && !p.archived && p.machine === r.machine && p.folder === r.folder)

/** "Asked in #root": the space that asked for a task, in words */
export const askedWords = (snap: Snapshot, t: Task) => (t.asked && snap.places.some((p) => p.id === t.asked) ? `Asked in ${spaceLabel(snap, t.asked)}` : '')

/** Tasks › Now, grouped by what each task needs. Done newest first. */
export function nowGroups(tasks: Task[]): { name: 'Needs you' | 'Working' | 'Up next' | 'Done' | 'Archived'; tasks: Task[] }[] {
  const by = (s: TaskState[]) => tasks.filter((t) => s.includes(tstate(t)))
  const newest = (a: Task, b: Task) => (b.doneAt ?? b.at ?? 0) - (a.doneAt ?? a.at ?? 0)
  return [
    { name: 'Needs you' as const, tasks: by(['ask', 'ready']) },
    { name: 'Working' as const, tasks: by(['working']) },
    { name: 'Up next' as const, tasks: by(['next']) },
    { name: 'Done' as const, tasks: by(['done']).sort(newest) },
    { name: 'Archived' as const, tasks: by(['archived']).sort(newest) },
  ]
}

/** How many things in a space need the person: its tasks under Needs you (Ready for review among them), and its own
 *  chat's agent when it asks. No space: everywhere. The same count decides the Tasks button's number. */
export function needsCount(snap: Snapshot, placeId?: string): number {
  const all = !placeId || isEverything(snap, placeId)
  const tasks = snap.tasks.filter((t) => (all || taskInSpace(t, placeId)) && ['ask', 'ready'].includes(tstate(t))).length
  const chats = snap.places.filter((p) => p.needs && (all ? !p.home || isEverything(snap, p.id) : p.id === placeId)).length
  return tasks + chats
}

/* ---------- schedules and artifacts ---------- */

export interface Schedule extends Automation {
  id: string
  place: string
}

/** every schedule, one-off and repeating alike, with its space */
export function schedulesOf(snap: Snapshot, placeId?: string): Schedule[] {
  const all = !placeId || isEverything(snap, placeId)
  const out: Schedule[] = []
  for (const [key, list] of Object.entries(snap.automations ?? {}))
    for (const a of list) {
      const place = a.place ?? key
      if (all || place === placeId) out.push({ ...a, id: a.id ?? `${key}|${a.name}`, place })
    }
  return out
}

/** a schedule row's second line: when it runs and when next, or Paused */
export function scheduleLine(a: Automation): string {
  if (!a.on) return 'Paused'
  return a.when + (a.nextWords ? ` · next ${a.nextWords}` : '')
}

/** the artifacts a view lists: things made to keep (a task's proof stays on its task), newest first */
export function artifactsIn(snap: Snapshot, placeId: string): Artifact[] {
  const all = isEverything(snap, placeId)
  const proofs = new Set(snap.tasks.map((t) => t.proof).filter(Boolean))
  return snap.artifacts.filter((a) => !proofs.has(a.id) && !a.proof && (all || a.place === placeId)).sort((a, b) => b.at - a.at)
}
