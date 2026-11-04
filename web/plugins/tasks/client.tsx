// Tasks, as Shepherdr 3's Tasks panel (mods/tasks): every task on every machine, Pinned first, then Needs you
// (tasks and what any agent asks), then by the header's Group by (Status, Space, Machine, Machine › Space; kept on this
// device). A filter row picks one status (All statuses, Needs you, Working, Ready, the rest under More). Each heading
// folds what is under it away. A row says where its task is, as far as the grouping doesn't; a Ready row has Accept. A
// row's menu only pins it (core/menus.js taskMenu, the window's too); the Assistant does the rest. Done tasks archive
// themselves: the Archived row at the bottom opens them.
import clsx from 'clsx'
import { openAccept } from '@client/screens/Accept.tsx'
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  act,
  archivedIn,
  definePlugin,
  filteredGroups,
  goChat,
  setTaskFilter,
  tasksIn,
  namesFor,
  filterOf,
  getState,
  groupChoices,
  groupFor,
  listView,
  openTask,
  openSplit,
  panesHere,
  splitClick,
  pinTask,
  placeOf,
  registry,
  setFilter,
  setGroup,
  setUI,
  toggleAllDone,
  toggleShut,
  shownGroups,
  taskOf,
  useSnap,
  useStore,
  useUI,
  type GroupBy,
  type ListView,
  type TaskGroup,
} from '@client/kernel.ts'
import { keysMoved } from '@client/focus.ts'
import {
  ArchivedIcon,
  BackIcon,
  CheckIcon,
  ClockIcon,
  DownIcon,
  Empty,
  FilterBox,
  ic,
  IconButton,
  LinkButton,
  List,
  Menu,
  MenuItem,
  MenuLabel,
  Meta,
  MoreIcon,
  NextIcon,
  PinTaskIcon,
  RoundButton,
  Row,
  rowClass,
  RowText,
  taskLine,
  TaskDot,
  UnpinIcon,
} from '@client/ui.tsx'
import { doneNewestFirst, taskChatId, type Automation, type Place, type Snapshot, type Task } from '@shared/types.ts'
import { useFlip } from '@client/motion.ts'
import { RowMenu, RowMenuButton, useRowMenu, type RowMenuState } from '@client/rowmenu.tsx'
import * as MN from '@core/menus.js'

/**
 * A task, with one line under its title (taskLine). Working, its pie fills with the % done its agent reported and the minutes
 * left sit small under it. Every row shows its age (how long it has been as it is) at its end, like the rows around it;
 * waiting on you, its frozen status line stays in its chat's header.
 */
function TaskRow({ t, ix, where }: { t: Task; ix: number; where?: string[] }) {
  // the open task, or the focused pane's in split view
  const sel = useUI((u) => u.task === t.id || (panesHere(u)[u.split.pane]?.kind === 'task' && panesHere(u)[u.split.pane].id === t.id))
  const kb = useUI((u) => u.kb && !u.task && u.cur === ix)
  // as 3.0's row (mods/tasks line()): its second line (core/tasks.js secondLine), where it is, and Accept on a Ready one
  const sub = t.sub || undefined
  const at = where?.join(' · ')
  const accept = t.status === 'ready' && !t.archived
  const two = !!sub || accept
  // archived: a quiet ring, or a done task's check; the status it was put away with stays in its chat
  const dot = t.archived ? (t.status === 'done' ? 'done' : 'idle') : t.status
  // minutes left, under the dot (amber), while it works
  const left = !t.archived && t.status === 'work' && t.report?.eta !== undefined ? `${t.report.eta}m` : null
  // its menu (Pin or Unpin) on a right click, or a finger held on it, as the window's right click
  const menu = useRowMenu()
  const place = at ? <span className="min-w-0 shrink truncate text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{at}</span> : null
  return (
    <li data-flip={t.id} className={clsx(rowClass(sel, kb), 'group relative p-0! select-none [-webkit-touch-callout:none]', menu.open && !sel && 'bg-hover')} {...menu.press}>
      {/* the whole row opens the task: one button stretched under it; Accept sits over it, a button of its own */}
      <button
        type="button"
        aria-current={sel || undefined}
        aria-label={`${t.id} ${t.name}${sub ? `, ${sub}` : ''}`}
        // with ⌘ (Ctrl off a Mac), beside the focused pane in split view
        onClick={(e) => !menu.held() && (splitClick(e) ? openSplit({ kind: 'task', id: t.id }) : openTask(t.id))}
        className="absolute inset-0 cursor-pointer rounded-[inherit] outline-none keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)]"
      />
      {/* what the row shows is said by its button's label: only Accept is read on its own */}
      <div className={clsx('pointer-events-none relative flex min-h-[inherit] w-full min-w-0 gap-2.5 px-2 phone:px-3', two ? 'items-start py-1.5' : 'items-center')}>
        <span aria-hidden className="flex w-3.5 shrink-0 flex-col items-center">
          <span className="grid h-[18px] place-items-center phone:h-5"><TaskDot s={dot} w={t.archived ? undefined : t.report} /></span>
          {two && left ? <span className="mt-0.5 font-mono text-[0.6875rem]/4 font-semibold text-work-fg tabular-nums">{left}</span> : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span aria-hidden className="flex h-[18px] min-w-0 items-center gap-2 phone:h-5">
            <span className="shrink-0 font-mono text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{t.id}</span>
            <span className="min-w-16 flex-auto truncate text-fg">{t.name}</span>
            {/* one line: where it is at the end; it gives way before the title is cut */}
            {!two ? place : null}
          </span>
          {two ? (
            <span className="flex h-5 min-w-0 items-center gap-2 phone:h-7">
              {sub ? <span aria-hidden className="min-w-0 shrink truncate text-[0.75rem] text-fg2 phone:text-[0.8125rem]">{sub}</span> : null}
              <span aria-hidden className="flex min-w-0 flex-1 justify-end">{place}</span>
              {accept ? (
                <button type="button" onClick={() => openAccept(t.id)}
                  className="press-dim pointer-events-auto relative z-1 h-5 shrink-0 rounded-full bg-fg px-2 text-[0.75rem] font-medium text-bg after:absolute after:-inset-1.5 phone:h-7 phone:px-3 phone:text-[0.8125rem]">
                  Accept
                </button>
              ) : null}
            </span>
          ) : null}
        </span>
      </div>
      {menu.open ? <TaskMenu t={t} menu={menu} /> : null}
    </li>
  )
}

/** A task's one menu, in its row's ⋯ and its chat's, as 3.0's (core/menus.js taskMenu): Pin or Unpin */
function TaskActions({ task: t, close }: { task: Task; close: () => void }) {
  return (
    <>
      {(MN.taskMenu as (o: object) => { label: string; icon: string }[])({ pinned: !!t.pinned }).map((it) => (
        <MenuItem key={it.label} icon={t.pinned ? <UnpinIcon className={ic} /> : <PinTaskIcon className={ic} />} onClick={() => { close(); void pinTask(t, !t.pinned).catch(() => undefined) }}>
          {it.label}
        </MenuItem>
      ))}
    </>
  )
}

/** The row's menu: the task's own (Pin or Unpin) */
function TaskMenu({ t, menu }: { t: Task; menu: RowMenuState }) {
  const Actions = registry.views.taskActions ?? TaskActions
  return (
    <RowMenu menu={menu} label={t.id}>
      <Actions task={t} close={menu.close} />
    </RowMenu>
  )
}

/** where a task is, as its row says it: its machine and space, each only where neither the view nor its group's
 *  heading says it ("vm-str · gtm") */
function whereOf(snap: Snapshot, t: Task, names: TaskGroup['names']) {
  const p = placeOf(snap, t.place)
  const m = names.machine && p.machine !== snap.host ? snap.machines?.find((x) => x.machine === p.machine) : undefined
  // Settings › Window › Show space on task rows off: no place on the right
  if (snap.look?.place === false) return []
  return [m?.name, names.project ? (t.listName || p.name) : undefined].filter((x): x is string => !!x)
}

/** 3.0's statuses (core/tasks.js ORDER) as the web's task statuses, and their words */
const FILTER_STATUS: Record<string, Task['status']> = { working: 'work', merging: 'merging', ready: 'ready', queued: 'queued', todo: 'todo', done: 'done' }
const FILTER_WORDS: Record<string, string> = { needs: 'Needs you', working: 'Working', merging: 'Merging', ready: 'Ready', queued: 'Queued', todo: 'To do', done: 'Done', automations: 'Automations' }
const FILTER_ORDER = ['needs', 'ready', 'merging', 'working', 'queued', 'todo', 'done', 'automations']
/** the chips that show beside All statuses before More, as far as there is room (3.0's filterRow) */
const PRIMARY = ['needs', 'working', 'ready']

/** what an agent asks that is no task's (an Assistant's question, a secret, its turn waiting): a Needs you row */
type AgentNeed = { id: string; chat: string; who: string; why: string; where?: string }
function agentNeeds(snap: Snapshot): AgentNeed[] {
  return snap.needs.filter((n) => !n.task && n.chat).map((n) => {
    const p = snap.places.find((x) => x.id === n.place)
    const m = p && p.machine !== snap.host ? snap.machines?.find((x) => x.machine === p.machine)?.name : undefined
    return { id: n.id, chat: n.chat, who: p ? `${p.name} Assistant` : 'Agent', why: n.question?.title ?? (n.secret ? `Wants the secret ${n.secret.name}` : n.text || 'Waits for your reply'), where: [m, p?.name].filter(Boolean).join(' · ') || undefined }
  })
}

/** an agent's Needs you row: a tap opens its chat */
function AgentNeedRow({ n }: { n: AgentNeed }) {
  return (
    <li className={clsx(rowClass(false, false), 'p-0!')}>
      {/* the same grid as a task's row: who on the first line, why and where it is on the second */}
      <button type="button" onClick={() => goChat(n.chat)} className="flex min-h-[inherit] w-full min-w-0 cursor-pointer items-start gap-2.5 rounded-[inherit] px-2 py-1.5 text-left outline-none keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)] phone:px-3">
        <span className="grid h-[18px] w-3.5 shrink-0 place-items-center phone:h-5"><TaskDot s="need" /></span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="h-[18px] truncate text-fg phone:h-5">{n.who}</span>
          <span className="flex h-5 min-w-0 items-center gap-2 phone:h-7">
            <span className="min-w-0 shrink truncate text-[0.75rem] text-fg2 phone:text-[0.8125rem]">{n.why}</span>
            {n.where ? <span className="flex min-w-0 flex-1 justify-end"><span className="min-w-0 truncate text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{n.where}</span></span> : null}
          </span>
        </span>
      </button>
    </li>
  )
}

/** The filter row (3.0's): All statuses, then Needs you, Working and Ready while they hold something, then More with
 *  the rest that do (and Automations) */
function StatusFilters(p: { counts: Record<string, number>; filter: string }) {
  // Settings › Window › Status filters in Tasks off: no row
  return useSnap()?.look?.filters === false ? null : <StatusFilterRow {...p} />
}

function StatusFilterRow({ counts, filter }: { counts: Record<string, number>; filter: string }) {
  const [open, setOpen] = useState(false)
  // as 3.0's: never wraps, never scrolls; a chip that doesn't fit goes in More (widths estimated, about 7.5px a letter)
  const row = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(360)
  useLayoutEffect(() => {
    const el = row.current
    if (!el) return
    const seen = new ResizeObserver(() => setWidth(el.clientWidth))
    seen.observe(el)
    return () => seen.disconnect()
  }, [])
  const est = (text: string, n: number) => 24 + text.length * 7.5 + (n ? 6 + String(n).length * 8 : 0)
  const chips = FILTER_ORDER.filter((k) => counts[k] || k === filter)
  const primary = PRIMARY.filter((k) => chips.includes(k))
  const shown: string[] = []
  let room = width - 8 - est('All statuses', 0)
  for (const [i, k] of primary.entries()) {
    const w = est(FILTER_WORDS[k], counts[k] ?? 0)
    if (w + (chips.length > primary.length || i < primary.length - 1 ? 70 : 0) > room) break
    shown.push(k)
    room -= w
  }
  const more = chips.filter((k) => !shown.includes(k))
  const picked = more.includes(filter) ? filter : null
  const chip = (k: string, label: string, n: number) => (
    <button key={k} type="button" aria-pressed={filter === k} onClick={() => setTaskFilter(k)}
      className="press inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] text-fg2 hover:bg-hover hover:text-fg aria-pressed:bg-sel aria-pressed:text-fg coarse:h-9 phone:h-9 phone:px-3 phone:text-[0.875rem]">
      {label}
      {n ? <span className="text-fg3 tabular-nums">{n}</span> : null}
    </button>
  )
  return (
    <div ref={row} role="group" aria-label="Status" className="flex items-center gap-0.5 px-1.5 pt-1.5 phone:px-2">
      {chip('all', 'All statuses', 0)}
      {shown.map((k) => chip(k, FILTER_WORDS[k], counts[k] ?? 0))}
      {more.length ? (
        <div className="relative shrink-0">
          <button type="button" aria-haspopup="menu" aria-expanded={open} aria-pressed={!!picked} onClick={() => setOpen(!open)}
            className="press inline-flex h-7 items-center gap-1 rounded-full pr-2 pl-2.5 text-[0.8125rem] text-fg2 hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-pressed:bg-sel aria-pressed:text-fg coarse:h-9 phone:h-9 phone:text-[0.875rem]">
            {picked ? FILTER_WORDS[picked] : 'More'}
            {picked && counts[picked] ? <span className="text-fg3 tabular-nums">{counts[picked]}</span> : null}
            <DownIcon aria-hidden className="size-3.5 text-fg3" />
          </button>
          {open ? (
            <Menu label="More statuses" onClose={() => setOpen(false)} className="absolute top-full left-0 z-21 mt-1.5 max-w-[calc(100vw-24px)] origin-top-left">
              {more.map((k) => (
                <MenuItem key={k} role="menuitemradio" aria-checked={filter === k} icon={filter === k ? <CheckIcon className={ic} /> : null} hint={counts[k] ? String(counts[k]) : undefined}
                  onClick={() => { setOpen(false); setTaskFilter(k) }}>
                  {FILTER_WORDS[k]}
                </MenuItem>
              ))}
            </Menu>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** a Needs you group counts what its tasks wait for, card by card, and what agents ask beside them */
const needCount = (snap: Snapshot, g: { key: string; count: number; tasks: Task[] }) => {
  if (g.key !== 'need') return g.count
  const ids = new Set(g.tasks.map((t) => t.id))
  return Math.max(g.count, snap.needs.filter((n) => n.task && ids.has(n.task)).length)
}

function TaskList(_: { placeId: string }) {
  const snap = useSnap()!
  const view = useStore((s) => listView(s.ui, snap))
  const key = view.key
  const chosen = useUI((u) => u.groups)
  const allDone = useUI((u) => u.allDone)
  const shut = useUI((u) => u.shut)
  const archived = useUI((u) => u.archived === key)
  const wanted = useUI((u) => u.taskFilter)
  const q = useUI((u) => filterOf(u, view.search, 'tasks'))
  const place = placeOf(snap, getState().ui.place)
  const by = groupFor(chosen, view.level)
  // a task moving to another group glides there; a new one fades in; what a filter, Show more or a fold leaves just shows
  const list = useRef<HTMLDivElement>(null)
  useFlip(list, `${key}|${by}|${q}|${wanted}|${allDone.join()}|${shut.join()}`)
  if (archived) return <ArchivedList list={view} />
  const loaded = !!snap.places.length || !!snap.tasks.length
  const asks = agentNeeds(snap).filter((n) => !q || [n.who, n.why, n.where].join(' ').toLowerCase().includes(q.toLowerCase()))
  const live = tasksIn(snap, view)
  const automations = Object.values(snap.automations ?? {}).flat()
  // the chips' counts: what each status holds now (Needs you: its tasks and what agents ask)
  const counts: Record<string, number> = { needs: live.filter((t) => t.status === 'need').length + agentNeeds(snap).length, automations: automations.length }
  for (const [k, st] of Object.entries(FILTER_STATUS)) counts[k] = live.filter((t) => t.status === st).length
  const filter = FILTER_ORDER.includes(wanted) && (counts[wanted] || q) ? wanted : 'all'
  const footer = q || filter !== 'all' ? null : registry.tasksFooter.map((F, i) => <F key={i} place={place} list={view} />)
  // one status picked: its rows alone, no headings
  if (filter !== 'all') {
    const rows = filter === 'needs' ? live.filter((t) => t.status === 'need') : filter === 'automations' ? [] : live.filter((t) => t.status === FILTER_STATUS[filter])
    const found = (q ? rows.filter((t) => filteredGroups(snap, view, q).some((g) => g.tasks.includes(t))) : filter === 'done' ? doneNewestFirst(rows) : rows)
    const what = filter === 'needs' ? 'tasks that need you' : filter === 'automations' ? 'automations' : `${FILTER_WORDS[filter]} tasks`
    return (
      <>
        <TaskFilter listKey={view.search} order={found} />
        <StatusFilters counts={counts} filter={filter} />
        <div ref={list} className="relative pt-1">
          {found.length || (filter === 'needs' && asks.length) ? (
            <List>
              {found.map((t, i) => <TaskRow key={t.id} t={t} ix={i} where={whereOf(snap, t, { machine: true, project: true })} />)}
              {filter === 'needs' ? asks.map((n) => <AgentNeedRow key={n.id} n={n} />) : null}
            </List>
          ) : filter === 'automations' ? registry.tasksFooter.slice(0, 1).map((F, i) => <F key={i} place={place} list={view} />) : <Empty className="pt-3 text-fg3">No {what} match “{q}”.</Empty>}
        </div>
      </>
    )
  }
  // searching, Done and archived tasks are in it too, each group whole and open, folded shut or not
  let groups = q
    ? filteredGroups(snap, view, q, { groups: chosen }).map((g) => ({ ...g, count: g.tasks.length, more: 0, less: false, shut: false }))
    : shownGroups(snap, view, { groups: chosen, allDone, shut })
  // Needs you holds what agents ask too: a group of its own after Pinned when no task needs you
  if (asks.length && !groups.some((g) => g.key === 'need')) {
    const at = groups[0]?.key === 'pinned' ? 1 : 0
    groups = [...groups.slice(0, at), { key: 'need', label: 'Needs you', tasks: [], names: namesFor(view.level), count: 0, more: 0, less: false, shut: !q && shut.includes(`${key}|need`) }, ...groups.slice(at)]
  }
  // what the keyboard walks: the rows on screen
  const order = groups.flatMap((g) => g.tasks)
  const machines = [...new Set(groups.flatMap((g) => (g.machine ? [g.machine.id] : [])))]
  const machineShut = (id: string) => !q && shut.includes(`${key}|m:${id}`)
  const nothing = !groups.length && !archivedIn(snap, view).length && !automations.length
  return (
    <>
      <TaskFilter listKey={view.search} order={order} />
      {/* the filter row, once there is anything to filter */}
      {nothing && !q ? null : <StatusFilters counts={counts} filter="all" />}
      <div ref={list} className="relative">
        {!loaded ? <Empty className="pt-3 text-fg3">Reading tasks…</Empty> : null}
        {groups.flatMap((g, i) => {
          // Machine › Space: a machine's name over its groups, once, with how many tasks they hold
          const m = g.machine
          const head =
            m && m.id !== groups[i - 1]?.machine?.id ? (
              <MachineHeading
                key={`machine:${m.id}`}
                name={m.name}
                first={!i}
                count={groups.filter((x) => x.machine?.id === m.id).reduce((n, x) => n + x.count, 0)}
                fold={q ? undefined : { shut: machineShut(m.id), toggle: (all) => toggleShut(key, `m:${m.id}`, all ? machines.filter((x) => x !== m.id).map((x) => `m:${x}`) : []) }}
              />
            ) : null
          if (m && machineShut(m.id)) return [head]
          const siblings = () => groups.filter((x) => x !== g && x.machine?.id === m?.id).map((x) => x.key)
          const fold: Fold | undefined = q ? undefined : { shut: g.shut, toggle: (all) => toggleShut(key, g.key, all ? siblings() : []) }
          const extra = g.key === 'need' ? asks : []
          return [
            head,
            <div key={g.key}>
              {g.kind === 'machine' ? (
                <MachineHeading name={g.label} first={!i} count={g.count} fold={fold} />
              ) : (
                <GroupHeading label={g.label} note={g.note} count={needCount(snap, g) + extra.length} flip={`group:${g.key}`} fold={fold} />
              )}
              {g.shut ? null : (
                <List>
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} t={t} ix={order.indexOf(t)} where={whereOf(snap, t, g.names)} />
                  ))}
                  {extra.map((n) => <AgentNeedRow key={n.id} n={n} />)}
                </List>
              )}
              {g.more || g.less ? (
                <div data-flip={`more:${g.key}`}>
                  <DoneToggle more={g.more} onClick={() => toggleAllDone(key, g.key)} />
                </div>
              ) : null}
            </div>,
          ]
        })}
        {/* nothing at all: said once, never "yet" (3.0's) */}
        {loaded && nothing && !q ? <Empty className="pt-3 text-fg3">{snap.tasks.length ? 'Nothing to do.' : 'No tasks on any machine. Ask an Assistant to plan some.'}</Empty> : null}
        {q && !groups.length ? <Empty className="pt-3 text-fg3">No tasks match “{q}”.</Empty> : null}
        {footer}
      </div>
    </>
  )
}

/** a heading's fold: shut or open, and what a tap does (all: Alt/Option held, its siblings go the same way) */
type Fold = { shut: boolean; toggle: (all: boolean) => void }

/**
 * A heading that folds what is under it away, as the sidebar's tree does: the whole heading is the button, the
 * sidebar's chevron where the rows' dots are, its count at the end, shut or open. Alt/Option-click takes its siblings
 * with it. Without a fold (filtering: every match shows) it is just the heading, in the same place.
 */
function FoldHeading({ name, fold, flip, className, children, count }: { name: string; fold?: Fold; flip?: string; className?: string; children: ReactNode; count?: number }) {
  const Icon = fold?.shut ? NextIcon : DownIcon
  const inner = (
    <>
      {fold ? <Icon aria-hidden className={clsx(ic, '-mx-px text-fg3 group-hover/h:text-fg phone:mx-0')} /> : <span aria-hidden className={clsx(ic, '-mx-px phone:mx-0')} />}
      {children}
      {count ? <span className="ml-auto shrink-0 text-[0.75rem] font-medium text-fg3 tabular-nums phone:text-[0.875rem]">{count}</span> : null}
    </>
  )
  const look = 'flex min-h-9 w-full items-center gap-2 rounded-row px-2 text-left phone:min-h-11 phone:px-3'
  return (
    <div data-flip={flip} data-heading={name} className={clsx('px-1.5 phone:px-2', className)}>
      {fold ? (
        <button
          type="button"
          aria-expanded={!fold.shut}
          onClick={(e) => fold.toggle(e.altKey)}
          className={clsx(look, 'press group/h cursor-pointer outline-none select-none hover:bg-hover keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-focus)] coarse:min-h-11')}
        >
          {inner}
        </button>
      ) : (
        <div className={look}>{inner}</div>
      )}
    </div>
  )
}

/** A group's label (Working, Done, a space): folds its tasks away, and its Show all with them */
function GroupHeading({ label, note, count, flip, fold }: { label: string; note?: string; count: number; flip?: string; fold?: Fold }) {
  return (
    <FoldHeading name={label} fold={fold} flip={flip} count={count} className="pt-1">
      <span className="min-w-0 truncate text-[0.75rem] font-medium text-fg3 phone:text-[0.875rem]">
        {label}
        {/* by space on All machines, the machine it is on */}
        {note ? <span className="font-normal opacity-75"> · {note}</span> : null}
      </span>
    </FoldHeading>
  )
}

/** On All machines, a machine's name over its tasks or its spaces' groups: a step above their labels, a hairline
 *  between machines;
 *  folded shut, its groups go and its count stays. Filtering, it doesn't fold. */
function MachineHeading({ name, first, count, fold }: { name: string; first: boolean; count: number; fold?: Fold }) {
  return (
    <FoldHeading name={name} fold={fold} flip={`machine:${name}`} count={count} className={clsx('pt-1.5', !first && 'mt-2 border-t border-line')}>
      <h3 className="min-w-0 truncate text-[0.8125rem] font-semibold text-fg2 phone:text-[0.9375rem]">{name}</h3>
    </FoldHeading>
  )
}

/** Filter tasks: by id, title, status line or summary, as you type; ↑ ↓ pick one of what is left and Enter opens it */
function TaskFilter({ listKey, order }: { listKey: string; order: Task[] }) {
  const value = useUI((u) => u.filter[`${listKey}|tasks`] ?? '')
  const cur = useUI((u) => (u.kb ? u.cur : -1))
  // its key, where there is a keyboard
  const keys = useUI((u) => u.device === 'desktop' || u.kb)
  return (
    <FilterBox
      label="Filter tasks"
        hint={keys ? 'F' : undefined}
      value={value}
      onChange={(q) => setFilter(listKey, 'tasks', q)}
      onKey={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          keysMoved('cursor')
          setUI({ kb: true, cur: Math.max(0, Math.min(order.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1))) })
        } else if (e.key === 'Enter' && order[Math.max(0, cur)]) {
          e.preventDefault()
          openTask(order[Math.max(0, cur)].id)
        }
      }}
    />
  )
}

/** Under a group cut to its latest Done tasks, "Show 91 more"; once they all show, "Show less": a quiet row, not a call to act */
function DoneToggle({ more, onClick }: { more: number; onClick: () => void }) {
  return (
    <div className="px-1.5 phone:px-2">
      <button
        type="button"
        aria-expanded={!more}
        className="press flex min-h-8 items-center gap-1 rounded-full px-2.5 text-[0.75rem] font-medium text-fg3 hover:text-fg2 keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-focus)] focus-visible:outline-none coarse:min-h-11 phone:min-h-11 phone:px-3 phone:text-[0.875rem]"
        onClick={onClick}
      >
        {more ? `Show ${more} more` : 'Show less'}
        <DownIcon aria-hidden className={clsx('size-3.5 shrink-0', !more && 'rotate-180')} />
      </button>
    </div>
  )
}

/** At the very bottom of a list's tasks, once it has archived ones: "Archived · 12", opening them */
function ArchivedLink({ list }: { place: Place; list?: ListView }) {
  const snap = useSnap()!
  const n = list ? archivedIn(snap, list).length : 0
  if (!n) return null
  return (
    // a button, not a list row: it opens a view, it is not a task
    <div data-flip="archived" className="mt-2 border-t border-line px-1.5 pt-1.5 phone:px-2">
      <button type="button" className={clsx(rowClass(), 'w-full text-left')} onClick={() => setUI({ archived: list!.key, cur: 0 })}>
        <span className="flex min-w-0 flex-1 items-center gap-2 text-fg2">
          <ArchivedIcon aria-hidden className={`${ic} text-fg3`} />
          <span className="truncate">Archived</span>
        </span>
        <Meta>{n}</Meta>
        <NextIcon aria-hidden className={`${ic} text-fg3`} />
      </button>
    </div>
  )
}

/** A list's archived tasks, the latest archived first: each opens its chat; its ⋯ (or a held finger) brings it back */
function ArchivedList({ list: view }: { list: ListView }) {
  const snap = useSnap()!
  const list = archivedIn(snap, view)
  return (
    <div>
      {/* one header row, as a group's: Back to the tasks, its name and how many */}
      <div className="flex min-h-9 items-center gap-1 pt-2 pr-4 pl-1.5 text-[0.75rem] font-medium text-fg3 phone:pt-2.5 phone:pr-5 phone:pl-2 phone:text-[0.875rem]">
        <IconButton label="Back to tasks" onClick={() => setUI({ archived: null, cur: 0 })}>
          <BackIcon className={ic} />
        </IconButton>
        <h3 className="min-w-0 flex-1 truncate">Archived</h3>
        {list.length ? <span className="shrink-0 tabular-nums">{list.length}</span> : null}
      </div>
      {list.length ? (
        <List>
          {list.map((t, i) => (
            <TaskRow key={t.id} t={t} ix={i} where={whereOf(snap, t, namesFor(view.level))} />
          ))}
        </List>
      ) : (
        <Empty className="pt-0.5 text-fg3">No archived tasks. Done tasks come here on their own.</Empty>
      )}
      <Empty className="pt-3 text-fg3">Archived tasks keep their chat and summary. Search finds them too.</Empty>
    </div>
  )
}

const GROUP_WORDS: Record<GroupBy, string> = { status: 'Status', machine: 'Machine', project: 'Space', 'machine-project': 'Machine › Space' }

/** The Tasks header's ⋯: group a machine's tasks by status or space; more machines' also by machine, or by machine
 *  and then space (place, the place picked, is for plugins of old) */
function TasksMenu(_: { place: Place }) {
  const snap = useSnap()!
  const view = useStore((s) => listView(s.ui, snap))
  const level = view.level
  const chosen = useUI((u) => u.groups)
  const by = groupFor(chosen, level)
  const phone = useUI((u) => u.device === 'phone')
  const [open, setOpen] = useState(false)
  const choices = groupChoices(level)
  const B = phone ? RoundButton : IconButton
  return (
    <div className="relative">
      <B
        label="Group by"
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx('rounded-full!', phone ? 'aria-expanded:bg-line2' : 'aria-expanded:bg-hover')}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon className={ic} />
      </B>
      {open ? (
        <Menu label="Group by" onClose={() => setOpen(false)} className="absolute top-full right-0 z-21 mt-1.5 max-w-[calc(100vw-24px)] origin-top-right">
          <div role="group" aria-label="Group by">
            <MenuLabel>Group by</MenuLabel>
            {choices.map((c) => (
              <MenuItem
                key={c}
                role="menuitemradio"
                aria-checked={by === c}
                icon={by === c ? <CheckIcon className={ic} /> : null}
                onClick={() => {
                  setOpen(false)
                  setGroup(level, c)
                }}
              >
                {GROUP_WORDS[c]}
              </MenuItem>
            ))}
          </div>
        </Menu>
      ) : null}
    </div>
  )
}

/** when it ran, short: "Today 9:00", "Mon 2 Nov 9:00" */
function ranAt(ms: number) {
  const d = new Date(ms)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? `Today ${time}` : `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`
}

const small = 'text-[0.8125rem] phone:text-[0.9375rem]'

/**
 * A space's automations, at the bottom once it has one (everything, every space's): its name, then when it runs.
 * A tap shows the task it adds and its last runs, and lets you run it now, pause or remove it. Each run adds a new task with a
 * fresh agent. Only agents add or change them, through the shepherdr command, when asked in the chat: none, no section.
 */
function Automations({ place, list }: { place: Place; list?: ListView }) {
  const snap = useSnap()!
  // each space the chips name has its own; everything (no chips), every space's, each with its name; a machine's, none
  const all = !!list && !list.chips.length
  const spaces = !list ? [place] : all ? snap.places : list.chips.flatMap((c) => snap.places.filter((p) => p.id === c))
  return spaces.map((p) => <SpaceAutomations key={p.id} place={p} note={all || spaces.length > 1 ? p.name : undefined} />)
}

function SpaceAutomations({ place, note }: { place: Place; note?: string }) {
  const snap = useSnap()!
  const [open, setOpen] = useState<string | null>(null)
  // it folds away like the task groups above it
  const shut = useUI((u) => u.shut.includes(`${place.id}|automations`))
  const list = snap.automations[place.id] ?? []
  if (!list.length) return null
  return (
    <div data-flip={note ? `automations:${place.id}` : 'automations'}>
      <GroupHeading label="Automations" note={note} count={list.length} fold={{ shut, toggle: () => toggleShut(place.id, 'automations') }} />
      {shut ? null : (
        <List>
          {list.map((a) => {
            const on = open === a.name
            const id = `automation-${place.id}-${a.name}`.replace(/[^\w-]/g, '-')
            return (
              <Fragment key={a.name}>
                <Row two aria-expanded={on} aria-controls={id} onActivate={() => setOpen(on ? null : a.name)}>
                  {/* a clock, not a box: an automation runs on its own, there is nothing to tick; as wide as a status dot */}
                  <ClockIcon className={clsx(ic, '-mx-px h-lh text-fg3 phone:mx-0', !a.on && 'opacity-50')} />
                  <RowText sub={`${a.on ? '' : 'Paused · '}${a.when}`}>{a.name}</RowText>
                  <DownIcon aria-hidden className={clsx(ic, 'h-lh text-fg3', on && 'rotate-180')} />
                </Row>
                {on ? <AutomationDetail id={id} place={place} a={a} /> : null}
              </Fragment>
            )
          })}
        </List>
      )}
    </div>
  )
}

/** An open automation: when (its trigger in words) and its next runs, the task it adds in full, its last runs, and what you can do with it; lined up with its
 *  name */
function AutomationDetail({ id, place, a }: { id: string; place: Place; a: Automation }) {
  const [error, setError] = useState('')
  const pending = useRef<{ op: string; cid: string } | null>(null)
  const sending = useRef(false)
  const run = async (op: 'run' | 'pause' | 'resume' | 'remove') => {
    if (sending.current) return
    if (pending.current && pending.current.op !== op) { setError('Confirm the previous action before changing this automation.'); return }
    const command = pending.current ||= { op, cid: crypto.randomUUID() }
    sending.current = true
    try {
      const r = (await act({ type: 'automation', cid: command.cid, place: place.id, op, name: a.name })) as { ok?: boolean; error?: string } | undefined
      if (r?.ok === false) setError(r.error ?? 'Refused.')
      else { pending.current = null; setError('') }
    } catch { setError('The action was not confirmed. Try the same action again to check its result.') }
    finally { sending.current = false }
  }
  return (
    <li id={id} className="pr-2 pb-2 pl-8 phone:pr-3 phone:pl-9">
      <dl className={clsx('grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1', small)}>
        <dt className="font-medium text-fg">When</dt>
        <dd className="text-fg2">
          {a.when}
          {a.on ? '' : ' (paused)'}
        </dd>
        {a.next.length ? (
          <>
            <dt className="font-medium text-fg">Next</dt>
            <dd className="text-fg2 tabular-nums">{a.next.join(' · ')}</dd>
          </>
        ) : null}
        <dt className="font-medium text-fg">Task</dt>
        <dd className="text-pretty break-words text-fg2">{a.what}</dd>
        {a.brief ? (
          <>
            <dt className="font-medium text-fg">Instructions</dt>
            <dd className="text-pretty break-words whitespace-pre-wrap text-fg2">{a.brief}</dd>
          </>
        ) : null}
        <dt className="font-medium text-fg">Last runs</dt>
        <dd className="text-fg2">
          {a.runs.length
            ? a.runs.slice(0, 3).map((r) => (
                <div key={r.at}>
                  {ranAt(r.at)} ·{' '}
                  {r.task ? (
                    <button type="button" className="press-dim text-focus hover:underline" onClick={() => openTask(r.task!)}>
                      {r.task}
                    </button>
                  ) : (
                    <span className="text-need">failed: {r.error}</span>
                  )}
                </div>
              ))
            : 'Not run yet'}
        </dd>
      </dl>
      {error ? <div className={clsx('mt-1 text-need', small)}>{error}</div> : null}
      <div className={clsx('mt-1.5 flex flex-wrap gap-x-4 gap-y-1 phone:mt-2', small)}>
        <LinkButton onClick={() => run('run')}>Run now</LinkButton>
        <LinkButton onClick={() => run(a.on ? 'pause' : 'resume')}>{a.on ? 'Pause' : 'Resume'}</LinkButton>
        <LinkButton onClick={() => run('remove')}>Remove</LinkButton>
      </div>
    </li>
  )
}

export default definePlugin({
  name: 'tasks',
  setup(reg) {
    reg.views.tasks = TaskList
    reg.views.tasksMenu = TasksMenu
    reg.views.taskActions = TaskActions
    reg.tasksFooter.push(Automations, ArchivedLink)
    },
})
