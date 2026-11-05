// #-mentions of spaces (core/mentions.js): "#" in the box lists the spaces this chat's agent can reach (from its
// machine's reach map, what tell-assistant follows) with this space's tasks under them, and a sent one draws as a chip
// that opens its space; a space the agent can't reach, or one the person doesn't see here, draws locked, like Slack's
// link to a private channel. "@" does the same for tasks: the tasks in the spaces this chat's agent reaches, and a sent
// one draws as a chip (its status dot, ID and short title) that opens the task, locked by the same rule.
import clsx from 'clsx'
import { useEffect, useState, type ReactNode } from 'react'
import { LockClosedIcon } from '@heroicons/react/16/solid'
import * as MN from '@core/mentions.js'
import { goPlace, manyMachines, openTask, taskOf, useSnap } from '@client/kernel.ts'
import { Dot } from '@client/ui.tsx'
import { machineName, taskChatId, type Place, type Snapshot, type Task } from '@shared/types.ts'

const M = MN as any

export type Reach = { id: string; name: string; route: string; machine: string; target: string; emoji?: string; assistant: boolean }
type Got = { from: string | null; spaces: Reach[]; checked: number | null }

/* ---------- what this chat's agent reaches ---------- */

const lists = new Map<string, { at: number; got: Promise<Got> }>()
const known = new Map<string, Got>()
const listeners = new Set<() => void>()

function load(chatKey: string) {
  const was = lists.get(chatKey)
  if (was && Date.now() - was.at < 60_000) return was.got
  const got: Promise<Got> = fetch(`api/reach?chat=${encodeURIComponent(chatKey)}`).then((r) => r.json()).catch(() => ({ from: null, spaces: [], checked: null }))
  lists.set(chatKey, { at: Date.now(), got })
  got.then((g) => { known.set(chatKey, g); listeners.forEach((f) => f()) })
  return got
}

/** the spaces this chat's agent reaches, once known (null before); asked for when first wanted */
export function useReach(chatKey: string, want = true): Got | null {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!want) return
    const on = () => tick((n) => n + 1)
    listeners.add(on)
    void load(chatKey)
    return () => void listeners.delete(on)
  }, [chatKey, want])
  return known.get(chatKey) ?? null
}

/** a space by its own id: the snapshot's place for it (another machine's place ids are "machine/id") */
export const placeOf = (snap: Snapshot | null | undefined, id: string): Place | undefined =>
  snap?.places.find((p) => p.id === id || p.id.endsWith(`/${id}`))

/* ---------- the box ---------- */

/** a task as people say it: SHEP-4 (another machine's ids are "machine:SHEP-4") */
export const refOf = (id: string) => id.split(':').pop() ?? id

/** a picked task: what its token names (core/mentions.js taskToken) */
export type TaskPick = { ref: string; route: string; folder: string }

/** what the person picked in each chat's box: at send, its "#name" or "@REF" becomes the full mention */
const picks = new Map<string, Reach[]>()
const taskPicks = new Map<string, TaskPick[]>()
export const pickedIn = (chatKey: string) => picks.get(chatKey) ?? []
export function remember(chatKey: string, s: Reach) {
  picks.set(chatKey, [...pickedIn(chatKey).filter((x) => x.name !== s.name), s])
}
function rememberTask(chatKey: string, t: TaskPick) {
  taskPicks.set(chatKey, [...(taskPicks.get(chatKey) ?? []).filter((x) => x.ref !== t.ref), t])
}
/** the words to send: each picked "#name" and "@REF" as its mention (core/mentions.js expand, expandTasks) */
export const expandPicked = (chatKey: string, text: string): string => {
  const out = M.expandTasks(M.expand(text, pickedIn(chatKey)), taskPicks.get(chatKey) ?? [])
  picks.delete(chatKey)
  taskPicks.delete(chatKey)
  return out
}

export type Item =
  | { kind: 'space'; key: string; space: Reach; place?: Place }
  | { kind: 'locked'; key: string; place: Place }
  | { kind: 'task'; key: string; task: Task; pick: TaskPick; where: string }
  | { kind: 'lockedTask'; key: string; task: Task; where: string }

/** the space a chat is in: a task's chat's task's, else the place whose chat it is */
const placeHere = (snap: Snapshot, chatKey: string) => {
  const own = taskChatId(chatKey)
  return own ? taskOf(snap, own)?.place : snap.places.find((p) => p.chat === chatKey)?.id
}

/** "shop · vm-demo" with more machines, else "shop" */
function whereOf(snap: Snapshot, t: Task) {
  const p = snap.places.find((x) => x.id === t.place)
  const name = p?.name ?? ''
  const m = p?.machine ?? t.on
  return manyMachines(snap) && m ? [name, machineName(snap.machines, m)].filter(Boolean).join(' · ') : name
}

/** the "#" list for what is typed: reachable spaces, then a few the agent can't reach (never picked: they say why).
 *  The "@" list: the tasks in spaces this chat's agent reaches (waiting on you and at work first, Done last), then a
 *  few in spaces it can't. Keys move over the reachable ones. */
export function mentionItems(snap: Snapshot | null | undefined, chatKey: string, text: string, got: Got | null): Item[] {
  if (!snap) return []
  const tq = M.typingTask(text)
  if (tq !== null) return taskItems(snap, chatKey, tq, got)
  const q = M.typing(text)
  if (q === null) return []
  const spaces: Item[] = (got ? (M.match(got.spaces, q) as Reach[]) : []).map((s) => ({ kind: 'space', key: `s:${s.id}`, space: s, place: placeOf(snap, s.id) }))
  const ql = q.toLowerCase()
  // a space in the sidebar this agent can't reach: shown under the rest, so its absence isn't a mystery
  const reach = new Set(got?.spaces.map((s) => s.id) ?? [])
  const locked: Item[] = got
    ? snap.places
        .filter((p) => !reach.has(p.id.split('/').pop()!) && (!ql || p.name.toLowerCase().includes(ql)))
        .slice(0, ql ? 3 : 2)
        .map((p) => ({ kind: 'locked', key: `l:${p.id}`, place: p }))
    : []
  return [...spaces, ...locked]
}

/** where this chat's agent reaches a task: its space's entry in the reach list (the chat's own space before the list
 *  comes), else null */
function reachOfTask(snap: Snapshot, t: Task, here: string | undefined, got: Got | null): Reach | null {
  const sid = t.place.split('/').pop()!
  const r = got?.spaces.find((s) => s.id === sid)
  if (r) return r
  return !got && t.place === here ? { id: sid, name: '', route: '', machine: '', target: sid, assistant: false } : null
}

function taskItems(snap: Snapshot, chatKey: string, q: string, got: Got | null): Item[] {
  const here = placeHere(snap, chatKey)
  const live = (snap.tasks ?? []).filter((t) => !t.archived && t.place && /^[\w.-]+$/.test(refOf(t.id)))
  const row = (t: Task) => ({ ref: refOf(t.id), title: t.name, status: t.status, at: t.at, space: snap.places.find((p) => p.id === t.place)?.name, machine: t.on, t })
  const ok: Item[] = (M.matchTasks(live.filter((t) => reachOfTask(snap, t, here, got)).map(row), q, 8) as ReturnType<typeof row>[]).map(({ t }) => {
    const r = reachOfTask(snap, t, here, got)!
    const pick = { ref: refOf(t.id), route: r.route, folder: t.place === here ? '' : (t.taskFolder ?? '') }
    return { kind: 'task', key: `t:${t.id}`, task: t, pick, where: whereOf(snap, t) }
  })
  // tasks the person sees that this agent can't reach: under the rest, never picked
  const locked: Item[] = got
    ? (M.matchTasks(live.filter((t) => t.status !== 'done' && !reachOfTask(snap, t, here, got)).map(row), q, q ? 3 : 2) as ReturnType<typeof row>[])
        .map(({ t }) => ({ kind: 'lockedTask', key: `lt:${t.id}`, task: t, where: whereOf(snap, t) }))
    : []
  return [...ok, ...locked]
}
export const pickable = (items: Item[]) => items.filter((i) => i.kind === 'space' || i.kind === 'task')

function SpaceMark({ emoji, dim }: { emoji?: string; dim?: boolean }) {
  return (
    <span aria-hidden="true" className={clsx('grid size-6 shrink-0 place-items-center rounded-md bg-well text-[0.8125rem] phone:size-7', dim ? 'text-fg3' : 'text-fg2')}>
      {emoji ?? '#'}
    </span>
  )
}

/** a task row's title, then its space · machine: on its right, or under it on a phone */
function TitleWhere({ title, where, quiet }: { title: string; where: string; quiet?: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2.5 phone:flex-col phone:items-stretch phone:gap-0">
      <span className={clsx('min-w-0 flex-1 truncate', quiet && 'text-fg2')}>{title}</span>
      {where ? <span className="max-w-[40%] shrink-0 truncate text-[0.75rem] text-fg3 phone:max-w-full">{where}</span> : null}
    </span>
  )
}

/** the "#" list over the box: a tap (or Enter / Tab on the chosen one) takes one */
export function MentionList({ items, sel, pick, from }: { items: Item[]; sel: number; pick: (i: Item) => void; from: string | null }) {
  if (!items.length) return null
  const ok = pickable(items)
  const chosen = ok[Math.min(sel, ok.length - 1)]?.key
  const head = (text: string) => <div className="px-2.5 pt-1.5 pb-1 text-[0.75rem] text-fg3">{text}</div>
  const tasks = items.some((i) => i.kind === 'task' || i.kind === 'lockedTask')
  const groups: [string, Item[]][] = tasks ? [
    [from ? `Tasks ${from} can reach` : 'Tasks this agent can reach', items.filter((i) => i.kind === 'task')],
    ['Out of reach for this agent', items.filter((i) => i.kind === 'lockedTask')],
  ] : [
    [from ? `Spaces ${from} can reach` : 'Spaces this agent can reach', items.filter((i) => i.kind === 'space')],
    ['Out of reach for this agent', items.filter((i) => i.kind === 'locked')],
  ]
  return (
    <div role="listbox" aria-label={tasks ? 'Mention a task' : 'Mention a space'} className="max-h-[min(22rem,40dvh)] overflow-y-auto overscroll-contain rounded-box bg-bg p-1 shadow-menu">
      {groups.filter(([, g]) => g.length).map(([title, g]) => (
        <div key={title} role="group" aria-label={title}>
          {head(title)}
          {g.map((i) => {
            if (i.kind === 'lockedTask') return (
              <div key={i.key} role="option" aria-disabled="true" aria-selected={false} aria-label={`${refOf(i.task.id)} ${i.task.name}: ${M.LOCKED_TASK}`} className="flex min-w-0 items-center gap-2.5 rounded-row px-2.5 py-1 text-fg3 phone:py-1.5">
                <span className="grid w-6 shrink-0 place-items-center phone:w-7"><LockClosedIcon className="size-3" aria-hidden="true" /></span>
                <span className="shrink-0 font-medium tabular-nums">{refOf(i.task.id)}</span>
                <TitleWhere title={i.task.name} where={i.where} />
              </div>
            )
            if (i.kind === 'locked') return (
              <div key={i.key} role="option" aria-disabled="true" aria-selected={false} className="flex min-w-0 items-center gap-2.5 rounded-row px-2.5 py-1 phone:py-1.5">
                <SpaceMark emoji={i.place.emoji} dim />
                <span className="min-w-0 truncate text-fg3">{i.place.name}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1 text-[0.75rem] text-fg3">
                  <LockClosedIcon className="size-3" aria-hidden="true" />
                  {i.place.machine}
                </span>
              </div>
            )
            const on = i.key === chosen
            return (
              <button key={i.key} type="button" role="option" aria-selected={on} data-chosen={on ? '' : undefined}
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}
                className={clsx('flex w-full min-w-0 items-center gap-2.5 rounded-row px-2.5 py-1 text-left hover:bg-hover phone:py-1.5', on && 'bg-hover')}>
                {i.kind === 'space' ? (
                  <>
                    <SpaceMark emoji={i.space.emoji ?? i.place?.emoji} />
                    <span className="min-w-0 truncate font-medium">{i.space.name}</span>
                    <span className="ml-auto shrink-0 text-[0.75rem] text-fg3">{i.space.route ? i.space.machine : 'This machine'}</span>
                  </>
                ) : i.kind === 'task' ? (
                  <>
                    <span className="grid w-6 shrink-0 place-items-center phone:w-7"><Dot s={i.task.status} p={i.task.report?.progress} /></span>
                    <span className="shrink-0 font-medium tabular-nums">{refOf(i.task.id)}</span>
                    <TitleWhere title={i.task.name} where={i.where} quiet />
                  </>
                ) : null}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** the box after a pick: a space as "#name " (its full mention goes in at send), a task as its id */
export function takeItem(chatKey: string, text: string, i: Item): string {
  if (i.kind === 'space') {
    remember(chatKey, i.space)
    return M.pickInto(text, i.space)
  }
  if (i.kind === 'task') {
    rememberTask(chatKey, i.pick)
    return M.pickTaskInto(text, i.pick)
  }
  return text
}

/* ---------- in a message ---------- */

type Mention = { name: string; target: string; id: string; route: string }

/** how a mention shows here: its place when the person sees it, and whether this chat's agent reaches it (unknown
 *  until its list comes: it shows as it would, not locked) */
export function stateOf(m: Mention, snap: Snapshot | null | undefined, got: Got | null) {
  const place = placeOf(snap, m.id)
  const agent = got ? got.spaces.some((s) => s.id === m.id) : true
  const machine = place?.machine ?? (m.route ? m.route.split('>').pop()! : got?.from ?? '')
  return { place, ok: !!place && agent, why: !agent ? M.LOCKED.why : !place ? M.UNSEEN : '', machine }
}

export function Chip({ m, chatKey }: { m: Mention; chatKey: string }) {
  const snap = useSnap()
  const got = useReach(chatKey)
  const { place, ok, why, machine } = stateOf(m, snap, got)
  const label = (
    <>
      <span className="font-medium">#{m.name}</span>
      {machine ? <span className="opacity-70"> · {machine}</span> : null}
    </>
  )
  if (!ok) return (
    <span data-mention="locked" aria-label={`${m.name}: ${why}`}
      className="inline-flex max-w-full items-baseline gap-1 rounded-md bg-fg/6 px-1.5 align-baseline whitespace-nowrap text-fg3">
      <LockClosedIcon className="size-3 shrink-0 translate-y-[0.1em] self-center" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  )
  return (
    <button type="button" data-mention="open" aria-label={`Open space ${m.name} on ${machine}`}
      onClick={(e) => { e.stopPropagation(); goPlace(place!.id) }}
      className="inline-flex max-w-full items-baseline rounded-md bg-accent/12 px-1.5 align-baseline whitespace-nowrap text-accent hover:bg-accent/20">
      <span className="truncate">{label}</span>
    </button>
  )
}

/* ---------- a task in a message ---------- */

export type TaskMention = { ref: string; target: string; route: string; folder: string }

/** the task a mention names, as the person sees it: by its ID, then its folder, then the machine its route ends on (or
 *  this chat's machine), then this chat's space */
export function taskFor(m: TaskMention, snap: Snapshot | null | undefined, chatKey: string): Task | undefined {
  if (!snap) return undefined
  const ref = m.ref.toLowerCase()
  const all = (snap.tasks ?? []).filter((t) => refOf(t.id).toLowerCase() === ref)
  if (all.length < 2) return all[0]
  const here = placeHere(snap, chatKey)
  const hereMachine = snap.places.find((p) => p.id === here)?.machine
  const hop = m.route ? m.route.split('>').pop()! : null
  const score = (t: Task) => (m.folder && t.taskFolder === m.folder ? 4 : 0) +
    ((hop ? t.on === hop || snap.places.find((p) => p.id === t.place)?.machine === hop : t.on === hereMachine) ? 2 : 0) + (t.place === here ? 1 : 0)
  return [...all].sort((a, b) => score(b) - score(a))[0]
}

/** how a task mention shows here: open when the person sees the task and this chat's agent reaches its space (unknown
 *  until its list comes: it shows as it would, not locked) */
export function taskStateOf(m: TaskMention, snap: Snapshot | null | undefined, got: Got | null, chatKey: string) {
  const task = taskFor(m, snap, chatKey)
  const agent = !got || !task ? true : got.spaces.some((s) => s.id === task.place.split('/').pop())
  return { task, ok: !!task && agent, why: !task ? M.UNSEEN_TASK : !agent ? M.LOCKED_TASK : '' }
}

/** a chip's title: short enough on a phone that the chip stays in the line's flow */
export const TITLE = 'inline-block max-w-[16rem] truncate align-top phone:max-w-[7rem]'
const TASK_CHIP = 'inline-flex max-w-full items-baseline gap-1 rounded-md py-px pr-1.5 pl-1 align-baseline whitespace-nowrap'

export function TaskChip({ m, chatKey }: { m: TaskMention; chatKey: string }) {
  const snap = useSnap()
  const got = useReach(chatKey)
  const { task, ok, why } = taskStateOf(m, snap, got, chatKey)
  if (!ok) return (
    <span data-mention="locked" aria-label={`${m.ref}: ${why}`} className={clsx(TASK_CHIP, 'bg-fg/6 text-fg3')}>
      <LockClosedIcon className="size-3 shrink-0 self-center" aria-hidden="true" />
      <span className="truncate"><span className="font-medium">@{m.ref}</span>{task ? <span> · <span className={TITLE}>{M.short(task.name)}</span></span> : null}</span>
    </span>
  )
  return (
    <button type="button" data-mention="open" aria-label={`Open task ${m.ref}: ${task!.name}`}
      onClick={(e) => { e.stopPropagation(); openTask(task!.id) }}
      className={clsx(TASK_CHIP, 'bg-accent/12 text-accent hover:bg-accent/20')}>
      <Dot s={task!.status} p={task!.report?.progress} className="size-3 self-center" />
      <span className="truncate"><span className="font-medium">{m.ref}</span><span className="text-fg2"> · <span className={TITLE}>{M.short(task!.name)}</span></span></span>
    </button>
  )
}

/** the person's words with each mention as a chip */
export function withChips(text: string, chatKey: string): ReactNode {
  if (!M.hasMention(text)) return text
  return (M.split(text) as ({ text: string } | { mention: Mention } | { task: TaskMention })[]).map((p, i) =>
    'mention' in p ? <Chip key={i} m={p.mention} chatKey={chatKey} /> : 'task' in p ? <TaskChip key={i} m={p.task} chatKey={chatKey} /> : p.text,
  )
}

/** an agent's markdown before it is drawn: each mention as a link toHtml() turns into a chip ("#space=" and "#task="
 *  survive the sanitizer; "space:" wouldn't) */
export const forMarkdown = (text: string) =>
  M.hasMention(text)
    ? text
        .replace(/\[#([^\]\n]{1,80})\]\(space:([^)\s]+)\)/g, (_: string, n: string, t: string) => `[#${n}](#space=${encodeURIComponent(t)})`)
        .replace(/\[@([^\]\n]{1,80})\]\(task:([^)\s]+)\)/g, (_: string, n: string, t: string) => `[@${n}](#task=${encodeURIComponent(t)})`)
    : text
export const parseTask = (target: string): TaskMention => M.parseTask(target)

export const hasMention = (text: string): boolean => M.hasMention(text)
export const parseMention = (name: string, target: string): Mention => M.parse(name, target)
