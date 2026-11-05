// Tasks, as Shepherdr 3's Tasks panel (mods/tasks): every task on every machine, Pinned first, then Needs you
// (tasks and what any agent asks), then by the header's Group by (Status, Space, Machine, Machine › Space; kept on this
// device). A filter row picks one status (All statuses, Needs you, Working, Ready, the rest under More). Each heading
// folds what is under it away. A row says where its task is, as far as the grouping doesn't; a Ready row has Review. A
// row's menu only pins it (core/menus.js taskMenu, the window's too); the Assistant does the rest. Done tasks archive
// themselves: the Archived row at the bottom opens them.
import clsx from 'clsx'
import { openAccept, useAccepting } from '@client/screens/Accept.tsx'
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import {
  archivedIn,
  definePlugin,
  matches,
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
  scheduleTask,
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
  type Groups,
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
  List,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Meta,
  MoreIcon,
  NextIcon,
  PinTaskIcon,
  PlayIcon,
  RoundButton,
  rowClass,
  TaskDot,
  UnpinIcon,
  XIcon,
  field,
} from '@client/ui.tsx'
import { doneNewestFirst, machineName, type Automation, type Place, type Snapshot, type Task } from '@shared/types.ts'
import { useFlip } from '@client/motion.ts'
import { RowMenu, useRowMenu, type RowMenuState } from '@client/rowmenu.tsx'
import * as MN from '@core/menus.js'
import * as TK from '@core/tasks.js'
import * as ND from '@core/needs.js'

// the window's words for a row (core/tasks.js, core/needs.js): every second line starts with a capital and is at most
// 40 characters, cut at a word (the whole of it in the row's label); an automation's next run as "9:00", "Tue 9:00", "Nov 12 9:00"
const capital = TK.capital as (s: string) => string
const fit = ND.fit as (s: string) => string
const day = TK.day as (ms: number) => string
const REASONS = ND.REASONS as Record<string, string>
const STATUS = TK.STATUS as Record<string, string>
/** a task's id as its row shows it: its list's ref, without the machine ("SHEP-7"; the machine is in where it is) */
const refOf = (id: string) => id.slice(id.lastIndexOf(':') + 1)

/** the window's automation mark (mods/tasks/repeat.svg, lucide's repeat) */
function RepeatIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  )
}

/**
 * A task, with one line under its title (taskLine). Working, its pie fills with the % done its agent reported and the time
 * left sits short under it ("2h"); Ready, Review sits at the row's end.
 */
function TaskRow({ t, ix, where }: { t: Task; ix: number; where?: string[] }) {
  // the open task, or the focused pane's in split view
  const sel = useUI((u) => u.task === t.id || (panesHere(u)[u.split.pane]?.kind === 'task' && panesHere(u)[u.split.pane].id === t.id))
  const kb = useUI((u) => u.kb && !u.task && u.cur === ix)
  // its menu (Pin or Unpin) on a right click, or a finger held on it, as the window's right click (not an archived
  // task's: archived ones drop out of Pinned)
  const menu = useRowMenu()
  const busy = useAccepting(t.id) || !!t.accepting
  // Review (opens the Accept card) at a Ready row's end, soft as the chat header's Review: one per Ready row, so never the
  // filled look; "Accepting…" while its accept runs
  const accept =
    t.status === 'ready' && !t.archived ? (
      <button type="button" disabled={busy} onClick={() => openAccept(t.id)}
        className="press-dim pointer-events-auto relative z-1 h-6 shrink-0 rounded-full bg-bubble px-2.5 text-[0.75rem] font-medium whitespace-nowrap text-fg after:absolute after:-inset-x-1 after:-inset-y-2.5 enabled:hover:bg-sel disabled:opacity-60 phone:px-3 phone:text-[0.8125rem]">
        {busy ? 'Accepting…' : 'Review'}
      </button>
    ) : null
  return (
    <Line
      flip={t.id}
      sel={sel}
      kb={kb}
      // its pie: the % done, while it works; an archived one is a done task's check
      glyph={<TaskDot s={t.archived ? 'done' : t.status} w={t.archived || !t.report ? undefined : { ...t.report, eta: undefined }} />}
      ref_={refOf(t.id)}
      title={t.name}
      sub={t.sub}
      // Scheduled (SHEP-38): its time until it starts ("6h") in the same place, counted live, in grey
      left={t.archived ? undefined : t.status === 'work' ? t.left : t.status === 'scheduled' && t.startsAt ? (TK.untilShort as (ms: number) => string)(t.startsAt) : undefined}
      leftQuiet={t.status === 'scheduled'}
      dim={t.status === 'done'}
      where={where?.join(' · ')}
      action={accept}
      // with ⌘ (Ctrl off a Mac), beside the focused pane in split view
      onOpen={(e) => !menu.held() && (splitClick(e) ? openSplit({ kind: 'task', id: t.id }) : openTask(t.id))}
      menu={t.archived ? undefined : menu}
    >
      {menu.open && !t.archived ? <TaskMenu t={t} menu={menu} /> : null}
    </Line>
  )
}

/**
 * One row, as the window's (mods/tasks line()). Three parts, each with one job:
 * - the glyph, level with the title, and under it, level with the second line, the time left ("2h", "<1m": short, in the
 *   working colour, centred on the glyph; wider than it, it overflows evenly, so the column and the titles never move);
 * - the text: the title owns the first line; under it one quiet line read left to right, never pushed apart: the
 *   task's id (dim, monospace), what it says now (why it needs you, what its agent does: at most 40 characters, the
 *   whole of it in the row's label), then where it is after a dot, whole or not at all (it gives way first);
 * - the end, centred on the row (in a narrow list, at the second line's end): the one thing to act on or watch:
 *   Review or an automation's next run (`meta`).
 * A row with nothing under its title is one line. `tip`: more for its button's label only (an automation's error).
 */
function Line({ flip, sel = false, kb = false, glyph, ref_, title, sub, left, leftQuiet, dim, meta, where, action, tip, onOpen, menu, children }: {
  flip?: string; sel?: boolean; kb?: boolean; glyph: ReactNode; ref_?: string; title: string; sub?: string; left?: string; leftQuiet?: boolean; dim?: boolean; meta?: string
  where?: string; action?: ReactNode; tip?: string; onOpen?: (e: MouseEvent) => void; menu?: RowMenuState; children?: ReactNode
}) {
  const said = sub ? capital(sub) : undefined
  const shown = said ? fit(said) : undefined
  const two = !!(ref_ || shown || where)
  const end = action ?? (meta ? <span className="shrink-0 text-[0.75rem] whitespace-nowrap text-fg3 tabular-nums phone:text-[0.8125rem]">{meta}</span> : null)
  return (
    <li data-flip={flip} className={clsx(rowClass(sel, kb), 'group @container relative p-0! select-none [-webkit-touch-callout:none]', menu?.open && !sel && 'bg-hover')} {...(menu?.press ?? {})}>
      {/* the whole row opens it: one button stretched under it; Review sits over it, a button of its own */}
      {onOpen ? (
        <button
          type="button"
          aria-current={sel || undefined}
          aria-label={`${ref_ ? `${ref_} ` : ''}${title}${said ? `, ${said}` : ''}${left ? (leftQuiet ? `, in ${left}` : `, ${left} left`) : ''}${meta ? `, ${meta}` : ''}${tip ? `, ${tip}` : ''}`}
          onClick={onOpen}
          className="absolute inset-0 cursor-pointer rounded-[inherit] outline-none keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)]"
        />
      ) : null}
      {/* what the row shows is said by its button's label: only Review is read on its own. A grid: the glyph, the title
          and the end on the first line (the end centred on the row); in a narrow list (a phone, a tablet's panel) the
          end sits at the second line's end, so the title has the whole first line */}
      <div className={clsx('pointer-events-none relative grid min-h-[inherit] w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-2 phone:px-3', two && 'gap-y-0.5 py-2')}>
        <span aria-hidden className="col-start-1 row-start-1 grid h-5 w-3.5 place-items-center phone:h-6 phone:w-4">{glyph}</span>
        {/* the time left under the glyph, as tall as the second line so it sits level with it */}
        {two && left ? (
          <span aria-hidden className={clsx('col-start-1 row-start-2 flex h-4 w-3.5 items-center justify-center font-mono text-[0.6875rem] font-semibold whitespace-nowrap tabular-nums @max-[24rem]:h-6 phone:h-6 phone:w-4 phone:text-[0.75rem]', leftQuiet ? 'text-fg3' : 'text-work-fg')}>{left}</span>
        ) : null}
        <span aria-hidden={!!onOpen} className={clsx('col-start-2 row-start-1 min-w-0 truncate text-[0.875rem]/5 phone:text-base/6', dim ? 'text-fg2' : 'text-fg', two && '@max-[24rem]:col-end-4')}>{title}</span>
        {two ? (
          <span aria-hidden={!!onOpen} className="col-start-2 row-start-2 flex h-4 min-w-0 @max-[24rem]:h-6 items-center gap-1.5 text-[0.75rem]/4 phone:h-6 phone:text-[0.8125rem]/5">
            {ref_ ? <span className="shrink-0 font-mono text-[0.6875rem] text-fg3 phone:text-[0.75rem]">{ref_}</span> : null}
            {shown ? <span className="min-w-0 shrink truncate text-fg2">{shown}</span> : null}
            {/* where it is takes the room left after the words, whole or not at all: it drops under the line, out of
                sight (the empty first item keeps the line its height), never a cut "shep…" */}
            {where ? (
              <span className="flex h-full min-w-0 flex-1 basis-0 flex-wrap content-start overflow-hidden">
                <span className="h-full" />
                <span className="flex h-full shrink-0 items-center gap-1.5 whitespace-nowrap text-fg3">{ref_ || shown ? <span aria-hidden>·</span> : null}{where}</span>
              </span>
            ) : null}
          </span>
        ) : null}
        {end ? <span className={clsx('col-start-3 row-start-1 flex items-center', two && 'row-span-2 @max-[24rem]:row-span-1 @max-[24rem]:row-start-2')}>{end}</span> : null}
      </div>
      {children}
    </li>
  )
}

type MenuEntry = { id?: string; label?: string; icon?: string; heading?: string; sep?: boolean; at?: string; in?: string; typed?: boolean }
const OTHER = MN.SCHEDULE_OTHER as { placeholder: string; label: string; button: string }

/** A task's one menu, in its row's ⋯ and its chat's, as 3.0's (core/menus.js taskMenu): Pin or Unpin; a task not started
 *  yet also Start later (SHEP-38): a few times, or one typed in herdr-task's words (Other time…), and a scheduled one
 *  Start now and Unschedule. What herdr-task refuses (a time it doesn't know) shows under it, the menu kept open. */
function TaskActions({ task: t, close }: { task: Task; close: () => void }) {
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const go = async (when: Parameters<typeof scheduleTask>[1]) => {
    setBusy(true)
    setError(null)
    const r = await scheduleTask(t, when).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (r?.ok === false) setError(r.error ?? "Couldn't schedule it.")
    else close()
  }
  const items = (MN.taskMenu as (o: object) => MenuEntry[])({ pinned: !!t.pinned, status: t.archived ? null : t.status })
  return (
    <>
      {items.map((it, i) => {
        if (it.sep) return <MenuSeparator key={`sep${i}`} />
        if (it.heading) return <MenuLabel key={it.heading}>{t.status === 'scheduled' && t.sub ? `${it.heading} · ${capital(t.sub)}` : it.heading}</MenuLabel>
        if (it.id === 'schedule')
          return <MenuItem key={it.label} disabled={busy} icon={<ClockIcon className={ic} />} onClick={() => void go(it.in ? { in: it.in } : { at: it.at })}>{it.label}</MenuItem>
        if (it.id === 'schedule-other')
          return typing ? (
            <div key="other">
            <form className="flex items-center gap-2 px-2 py-1 phone:px-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void go({ at: text }) }}>
              <input name="when" aria-label={OTHER.label} autoFocus placeholder={OTHER.placeholder} value={text} disabled={busy}
                onChange={(e) => { setText(e.target.value); setError(null) }}
                className={clsx(field, 'h-7 min-w-0 flex-1 rounded-md bg-bg px-2 text-[0.8125rem] max-sm:text-base/6 phone:h-9')} />
              <button type="submit" disabled={busy || !text.trim()} className="press-dim h-7 shrink-0 rounded-md bg-bubble px-2.5 text-[0.75rem] font-medium text-fg enabled:hover:bg-sel disabled:opacity-40 phone:h-9 phone:px-3 phone:text-[0.8125rem]">{OTHER.button}</button>
            </form>
            {/* what herdr-task refused, under the field, never widening the menu */}
            {error ? <p role="alert" className="w-0 min-w-full px-2 pb-1.5 text-[0.75rem]/4 text-need-fg phone:px-3 phone:text-[0.8125rem]/5">{error}</p> : null}
            </div>
          ) : (
            <MenuItem key="other" disabled={busy} icon={<ClockIcon className={ic} />} onClick={() => setTyping(true)}>{it.label}</MenuItem>
          )
        if (it.id === 'start-now') return <MenuItem key="now" disabled={busy} icon={<PlayIcon className={ic} />} onClick={() => void go({ now: true })}>{it.label}</MenuItem>
        if (it.id === 'unschedule') return <MenuItem key="off" disabled={busy} icon={<XIcon className={ic} />} onClick={() => void go({ off: true })}>{it.label}</MenuItem>
        return (
          <MenuItem key={it.label} icon={t.pinned ? <UnpinIcon className={ic} /> : <PinTaskIcon className={ic} />} onClick={() => { close(); void pinTask(t, !t.pinned).catch(() => undefined) }}>
            {it.label}
          </MenuItem>
        )
      })}
      {error && !typing ? <p role="alert" className="w-0 min-w-full px-2 pt-1 pb-1.5 text-[0.75rem]/4 text-need-fg phone:px-3 phone:text-[0.8125rem]/5">{error}</p> : null}
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
const FILTER_STATUS: Record<string, Task['status']> = { working: 'work', merging: 'merging', ready: 'ready', queued: 'queued', scheduled: 'scheduled', todo: 'todo', done: 'done' }
const FILTER_WORDS: Record<string, string> = { needs: 'Needs you', working: 'Working', merging: 'Merging', ready: 'Ready', queued: 'Queued', scheduled: 'Scheduled', todo: 'To do', done: 'Done', automations: 'Automations' }
const FILTER_ORDER = ['needs', 'ready', 'merging', 'working', 'queued', 'scheduled', 'todo', 'done', 'automations']
/** the chips that show beside All statuses before More, as far as there is room (3.0's filterRow) */
const PRIMARY = ['needs', 'working', 'ready']

/** what needs you that is no task's: an agent asking (an Assistant's question, a secret, its turn waiting), or an
 *  automation that didn't run or didn't start its task (the window's inbox items) */
type AgentNeed = { id: string; chat?: string; who: string; why: string; where?: string; auto?: Automation }
function agentNeeds(snap: Snapshot): AgentNeed[] {
  const where = (machine: string | null | undefined, name?: string) => {
    const m = machine && machine !== snap.host ? snap.machines?.find((x) => x.machine === machine)?.name ?? machine : undefined
    return [m, name].filter(Boolean).join(' · ') || undefined
  }
  const asks = snap.needs.filter((n) => !n.task && n.chat).map((n) => {
    const p = snap.places.find((x) => x.id === n.place)
    // why, in the window's words (core/needs.js REASONS, reqReason): a plan, a permission's own words, a question
    const q = n.question
    const why = q ? (q.kind === 'Plan' ? REASONS.plan : fit(q.title) || (q.choices?.[0]?.label === 'Allow' ? REASONS.permission : REASONS.question))
      : n.secret ? fit(`Wants the secret ${n.secret.name}`) : REASONS.question
    // an agent's item: its name (a space's agent is its Assistant), where it is: its machine and space
    return { id: n.id, chat: n.chat, who: 'Assistant', why, where: where(p?.machine, p?.name) }
  })
  // an automation goes by its name, with no id: "Didn't run" or "Didn't start its task"
  const autos = Object.values(snap.automations ?? {}).flat().filter((a) => a.error)
    .map((a) => ({ id: `auto:${a.machine ?? ''}:${a.listName}:${a.name}`, who: a.name, why: a.failed === 'fire' ? "Didn't run" : "Didn't start its task", where: where(a.machine, a.listName), auto: a }))
  return [...asks, ...autos]
}

/** a Needs you row of no task: an agent's opens its chat; a failed automation's opens the Automations group */
function AgentNeedRow({ n, listKey }: { n: AgentNeed; listKey: string }) {
  const shut = useUI((u) => u.shut.includes(`${listKey}|automations`))
  return (
    <Line
      glyph={n.auto ? <RepeatIcon className="size-3.5 text-need" /> : <TaskDot s="need" />}
      title={n.who}
      sub={n.why}
      where={n.where}
      tip={n.auto?.error}
      onOpen={() => (n.chat ? goChat(n.chat) : shut && toggleShut(listKey, 'automations'))}
    />
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

/** a task the search finds, as the window's (mods/tasks found()): by its id, title, status line or pull request's
 *  number, or where it is: its space or list, and machine */
function found(snap: Snapshot, t: Task, q: string) {
  const p = placeOf(snap, t.place)
  return matches(q, refOf(t.id), t.name, t.sub, t.report?.msg, t.pr && `#${t.pr.number}`, t.listName, p.name, machineName(snap.machines, t.on))
}

/** what an automation's row says of where it is: its machine (with more than one) and space, whatever the grouping,
 *  as the Automations group sits under no machine or space heading (core/tasks.js autoWhere) */
function autoWhere(snap: Snapshot, a: Automation) {
  if (snap.look?.place === false) return undefined
  return (TK.autoWhere as (m: string, s?: string, multi?: boolean) => string | null)(machineName(snap.machines, a.machine || snap.host), a.listName, multiMachine(snap)) ?? undefined
}

/** an automation set off by another folder's task events (--from): by what and where ("On merges in vm-b · shepherdr") */
function autoFrom(snap: Snapshot, a: Automation) {
  const f = a.from
  return f ? (TK.fromLine as (e: string[], w: string) => string)(f.events, `${machineName(snap.machines, f.machine || snap.host)} · ${f.place}`) : undefined
}

/** An automation (herdr-task auto), as the window's row (mods/tasks autoRow): its mark, its name (no id), when it runs
 *  next at the first line's end; on the second line why it won't run as planned (Didn't start, the error in its
 *  label; Paused), else what sets it off from another folder (--from). A tap opens the task it added last. Only agents
 *  add or change automations. */
function AutoRow({ a, where, from }: { a: Automation; where?: string; from?: string }) {
  return (
    <Line
      glyph={<RepeatIcon className={clsx('size-3.5', a.error ? 'text-need' : 'text-fg3')} />}
      title={a.name}
      dim={!a.on}
      sub={a.error ? "Didn't start" : !a.on ? 'Paused' : from}
      meta={a.nextAt ? day(a.nextAt) : undefined}
      where={where}
      tip={a.error}
      onOpen={a.task ? () => openTask(a.task!) : undefined}
    />
  )
}

function TaskList(_: { placeId: string }) {
  const snap = useSnap()!
  const view = useStore((s) => listView(s.ui, snap))
  const key = view.key
  const chosen = grouping(useUI((u) => u.groups), snap)
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
  // what the search field holds: only what matches it shows, in its group (the window's matches())
  const asks = agentNeeds(snap).filter((n) => !q || matches(q, n.who, n.why, n.where))
  const live = tasksIn(snap, view).filter((t) => !q || found(snap, t, q))
  const autos = Object.values(snap.automations ?? {}).flat().filter((a) => !q || matches(q, a.name, a.listName, a.machine ? machineName(snap.machines, a.machine) : undefined))
  // the chips' counts: what each status holds now, as far as the search lets it (Needs you: its tasks and what else
  // needs you)
  const counts: Record<string, number> = { needs: live.filter((t) => t.status === 'need').length + asks.length, automations: autos.length }
  for (const [k, st] of Object.entries(FILTER_STATUS)) counts[k] = live.filter((t) => t.status === st).length
  // Settings › Window › Status filters off: no row, all shown
  const filters = snap.look?.filters !== false
  const filter = filters && FILTER_ORDER.includes(wanted) && (counts[wanted] || q) ? wanted : 'all'
  // what rows say of where they are: all of it in a flat list or by status; by machine, the space; by space, nothing
  const names = filter !== 'all' || by === 'status' ? { machine: true, project: true } : by === 'machine' ? { machine: false, project: true } : { machine: false, project: false }
  const footer = q || filter !== 'all' ? null : registry.tasksFooter.map((F, i) => <F key={i} place={place} list={view} />)
  // one status picked: its rows alone, no headings
  if (filter !== 'all') {
    const rows = filter === 'needs' ? live.filter((t) => t.status === 'need') : filter === 'automations' ? [] : live.filter((t) => t.status === FILTER_STATUS[filter])
    const shown = filter === 'done' ? doneNewestFirst(rows) : rows
    const what = filter === 'needs' ? 'tasks that need you' : filter === 'automations' ? 'automations' : `${STATUS[filter]} tasks`
    const any = shown.length || (filter === 'needs' && asks.length) || (filter === 'automations' && autos.length)
    return (
      <>
        <TaskFilter listKey={view.search} order={shown} />
        <StatusFilters counts={counts} filter={filter} />
        <div ref={list} className="relative pt-1">
          {any ? (
            <List>
              {shown.map((t, i) => <TaskRow key={t.id} t={t} ix={i} where={whereOf(snap, t, names)} />)}
              {filter === 'needs' ? asks.map((n) => <AgentNeedRow key={n.id} n={n} listKey={key} />) : null}
              {filter === 'automations' ? autos.map((a) => <AutoRow key={`${a.machine ?? ''}:${a.listName}:${a.name}`} a={a} where={autoWhere(snap, a)} from={autoFrom(snap, a)} />) : null}
            </List>
          ) : <Empty className="pt-3 text-fg3">No {what} match “{q}”.</Empty>}
        </div>
      </>
    )
  }
  // searching, Done and archived tasks are in it too, each group whole and open, folded shut or not
  let groups = q
    ? filteredGroups(snap, view, '', { groups: chosen }).map((g) => ({ ...g, tasks: g.tasks.filter((t) => found(snap, t, q)) })).filter((g) => g.tasks.length)
      .map((g) => ({ ...g, count: g.tasks.length, more: 0, less: false, shut: false }))
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
  const nothing = !groups.length && !autos.length
  // searching, the archived tasks that match come last, after the automations
  const archivedGroup = groups.find((g) => g.key === 'archived')
  const autoShut = !q && shut.includes(`${key}|automations`)
  const autoGroup = autos.length ? (
    <div key="automations" data-flip="automations">
      <GroupHeading label="Automations" count={autos.length} flip="group:automations" fold={q ? undefined : { shut: autoShut, toggle: () => toggleShut(key, 'automations') }} />
      {autoShut ? null : (
        <List>
          {autos.map((a) => <AutoRow key={`${a.machine ?? ''}:${a.listName}:${a.name}`} a={a} where={autoWhere(snap, a)} from={autoFrom(snap, a)} />)}
        </List>
      )}
    </div>
  ) : null
  return (
    <>
      <TaskFilter listKey={view.search} order={order} />
      {/* the filter row: All statuses, and a chip for each status that holds something now */}
      <StatusFilters counts={counts} filter="all" />
      <div ref={list} className="relative">
        {!loaded ? <Empty className="pt-3 text-fg3">Reading tasks…</Empty> : null}
        {groups.filter((g) => g !== archivedGroup).flatMap((g, i) => {
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
                <GroupHeading label={g.label} note={g.note} count={g.count + extra.length} flip={`group:${g.key}`} fold={fold} />
              )}
              {g.shut ? null : (
                <List>
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} t={t} ix={order.indexOf(t)} where={whereOf(snap, t, g.names)} />
                  ))}
                  {extra.map((n) => <AgentNeedRow key={n.id} n={n} listKey={key} />)}
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
        {/* Automations: their own group, last */}
        {autoGroup}
        {/* nothing at all: said once, never "yet" (3.0's) */}
        {loaded && nothing && !q ? <Empty className="pt-3 text-fg3">{snap.tasks.length ? 'Nothing to do.' : 'No tasks on any machine. Ask an Assistant to plan some.'}</Empty> : null}
        {archivedGroup ? (
          <div key="archived">
            <GroupHeading label="Archived" count={archivedGroup.tasks.length} flip="group:archived" />
            <List>
              {archivedGroup.tasks.map((t) => <TaskRow key={t.id} t={t} ix={order.indexOf(t)} where={whereOf(snap, t, { machine: true, project: true })} />)}
            </List>
          </div>
        ) : null}
        {q && !groups.length && !autos.length ? <Empty className="pt-3 text-fg3">No tasks match “{q}”.</Empty> : null}
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
      {/* its count right by its name ("Ready 2"), not across the panel */}
      {count ? <span className="shrink-0 text-[0.75rem] text-fg3 tabular-nums phone:text-[0.875rem]">{count}</span> : null}
    </>
  )
  const look = 'flex min-h-8 w-full items-center gap-3 rounded-row px-2 text-left phone:min-h-11 phone:px-3'
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
    <FoldHeading name={label} fold={fold} flip={flip} count={count} className="pt-3">
      <span className="min-w-0 truncate text-[0.75rem] font-medium text-fg2 phone:text-[0.875rem]">
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

/** The Archived view, as the window's: the search field stays (it narrows them too; no filter row), Back to the
 *  tasks (Esc too), its heading and count, then the archived tasks, the latest archived first */
function ArchivedList({ list: view }: { list: ListView }) {
  const snap = useSnap()!
  const q = useUI((u) => filterOf(u, view.search, 'tasks'))
  const list = archivedIn(snap, view).filter((t) => !q || found(snap, t, q))
  const back = () => setUI({ archived: null, cur: 0 })
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || (e.target as HTMLElement)?.closest?.('input, textarea, [role=menu], [role=dialog]')) return
      e.preventDefault()
      back()
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [])
  return (
    <>
      <TaskFilter listKey={view.search} order={list} />
      <div>
        {/* one header row, as a group's: Back to the tasks, its name and how many */}
        <div className="flex min-h-9 items-center gap-1 pt-2 pr-4 pl-1.5 text-[0.75rem] font-medium text-fg3 phone:pt-2.5 phone:pr-5 phone:pl-2 phone:text-[0.875rem]">
          <IconButton label="Back to tasks" onClick={back}>
            <BackIcon className={ic} />
          </IconButton>
          <h3 className="min-w-0 flex-1 truncate">Archived</h3>
          {list.length ? <span className="shrink-0 tabular-nums">{list.length}</span> : null}
        </div>
        {list.length ? (
          <List>
            {list.map((t, i) => (
              <TaskRow key={t.id} t={t} ix={i} where={whereOf(snap, t, { machine: true, project: true })} />
            ))}
          </List>
        ) : (
          <Empty className="pt-0.5 text-fg3">{q ? `No archived tasks match “${q}”.` : 'No archived tasks. Done tasks come here on their own.'}</Empty>
        )}
        <Empty className="pt-3 text-fg3">Archived tasks keep their chat and summary. Search finds them too.</Empty>
      </div>
    </>
  )
}

/** more than one machine has tasks or automations: only then can the list go by machine (the window's `multi`) */
function multiMachine(snap: Snapshot) {
  return new Set([...snap.tasks.map((t) => t.on), ...Object.values(snap.automations ?? {}).flat().map((a) => a.machine || snap.host)]).size > 1
}

/** the grouping as the list shows it: by machine with one machine is by status, Machine › Space by space (the
 *  window's; the choice itself is kept) */
function grouping(g: Groups, snap: Snapshot): Groups {
  if (multiMachine(snap)) return g
  const one = (b: GroupBy): GroupBy => (b === 'machine' ? 'status' : b === 'machine-project' ? 'project' : b)
  return { all: one(g.all), machine: one(g.machine) }
}

const GROUP_WORDS: Record<GroupBy, string> = { status: 'Status', machine: 'Machine', project: 'Space', 'machine-project': 'Machine › Space' }

/** The Tasks header's ⋯: group a machine's tasks by status or space; more machines' also by machine, or by machine
 *  and then space (place, the place picked, is for plugins of old) */
function TasksMenu(_: { place: Place }) {
  const snap = useSnap()!
  const view = useStore((s) => listView(s.ui, snap))
  const level = view.level
  const chosen = grouping(useUI((u) => u.groups), snap)
  const by = groupFor(chosen, level)
  const phone = useUI((u) => u.device === 'phone')
  const [open, setOpen] = useState(false)
  // the machine ones only while more than one machine has tasks (the window's)
  const choices = groupChoices(level).filter((c) => multiMachine(snap) || !c.startsWith('machine'))
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

export default definePlugin({
  name: 'tasks',
  setup(reg) {
    reg.views.tasks = TaskList
    reg.views.tasksMenu = TasksMenu
    reg.views.taskActions = TaskActions
    // the window's Automations group is the list's own (last, before Archived): only the Archived row is a footer
    reg.tasksFooter.push(ArchivedLink)
  },
})
