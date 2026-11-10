// Tasks, as Shepherdr 3's Tasks panel (mods/tasks): every task on every machine, grouped by the toggle under the search
// box (kept on this device, SHEP-182). Status, the default: what needs the person first (Needs you, Ready), then Working,
// Queued and the rest, each row saying its machine and space, Done hidden behind its count at the end. Place: each
// machine, its spaces inside it, every status mixed (a row's icon says which). Pinned tasks first in both. Each group
// folds. ⋯ narrows it all to the space picked. A Ready row has Review. A row's menu only pins it (core/menus.js taskMenu,
// the window's too); the Assistant does the rest. Done tasks archive themselves: the Archived row at the bottom opens them.
import clsx from 'clsx'
import { openAccept, useAccepting } from '@client/screens/Accept.tsx'
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import {
  archivedIn,
  definePlugin,
  DONE_OPEN,
  keepTasks,
  matches,
  filteredGroups,
  goChat,
  setThisSpace,
  inList,
  tasksIn,
  namesFor,
  filterOf,
  getState,
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
  HashIcon,
  ic,
  IconButton,
  List,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Meta,
  MonitorIcon,
  MoreIcon,
  NextIcon,
  PinTaskIcon,
  PlayIcon,
  RoundButton,
  rowClass,
  ServerIcon,
  TaskDot,
  UnpinIcon,
  XIcon,
  field,
} from '@client/ui.tsx'
import { doneNewestFirst, machineName, type Automation, type Machine, type Place, type Snapshot, type Task } from '@shared/types.ts'
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
  // the rows under the title: REF · where (always, the same on every status), then the status line on its own line
  const second = !!(ref_ || where)
  const rows = 1 + (second ? 1 : 0) + (shown ? 1 : 0)
  const two = rows > 1
  const statusRow = second ? 'row-start-3' : 'row-start-2'
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
          <span aria-hidden className={clsx('col-start-1 row-start-2 flex h-5 w-3.5 items-center justify-center font-mono text-[0.6875rem] font-semibold whitespace-nowrap tabular-nums phone:h-6 phone:w-4 phone:text-[0.75rem]', leftQuiet ? 'text-fg3' : 'text-work-fg')}>{left}</span>
        ) : null}
        <span aria-hidden={!!onOpen} className={clsx('col-start-2 row-start-1 min-w-0 truncate text-[0.875rem]/5 phone:text-base/6', dim ? 'text-fg2' : 'text-fg', two && '@max-[24rem]:col-end-4')}>{title}</span>
        {second ? (
          <span aria-hidden={!!onOpen} className="col-start-2 row-start-2 flex h-5 min-w-0 items-center gap-1.5 phone:h-6 text-[0.75rem]/4 phone:h-6 phone:text-[0.8125rem]/5">
            {ref_ ? <span className="shrink-0 font-mono text-[0.6875rem] text-fg3 phone:text-[0.75rem]">{ref_}</span> : null}
            {ref_ && where ? <span aria-hidden className="shrink-0 text-fg3">·</span> : null}
            {/* where it is: its machine and space, whole as long as the row has room */}
            {where ? <span className="min-w-0 truncate text-fg3">{where}</span> : null}
          </span>
        ) : null}
        {shown ? (
          <span aria-hidden={!!onOpen} className={clsx('col-start-2 flex h-5 min-w-0 items-center text-[0.75rem]/4 phone:h-6 phone:text-[0.8125rem]/5', statusRow)}>
            <span className="min-w-0 truncate text-fg2">{shown}</span>
          </span>
        ) : null}
        {end ? <span className={clsx('col-start-3 row-start-1 flex items-center', two && (rows === 3 ? 'row-span-3' : 'row-span-2'), two && '@max-[24rem]:row-span-1 @max-[24rem]:row-start-2')}>{end}</span> : null}
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
  // the machine is the task's own (t.on), not its space's: a task whose space isn't listed falls back to the home
  // space, on the main machine, and would show that machine's name
  const m = names.machine ? machineName(snap.machines, t.on) : undefined
  // Settings › Window › Show space on task rows off: no place on the right
  if (snap.look?.place === false) return []
  return [m, names.project ? (t.listName || p.name) : undefined].filter((x): x is string => !!x)
}

/** what needs you that is no task's: an agent asking (an Assistant's question, a secret, its turn waiting), or an
 *  automation that didn't run or didn't start its task (the window's inbox items) */
type AgentNeed = { id: string; chat?: string; who: string; why: string; where?: string; space?: string; auto?: Automation }
/** what needs you that is no task's, in a list: an agent's by its place, an automation's by the place it is kept under */
function agentNeeds(snap: Snapshot, chips: string[]): AgentNeed[] {
  const where = (machine: string | null | undefined, name?: string) => {
    const m = machine && machine !== snap.host ? snap.machines?.find((x) => x.machine === machine)?.name ?? machine : undefined
    return [m, name].filter(Boolean).join(' · ') || undefined
  }
  const asks = snap.needs.filter((n) => !n.task && n.chat && inList(snap, chips, n.place)).map((n) => {
    const p = snap.places.find((x) => x.id === n.place)
    // why, in the window's words (core/needs.js REASONS, reqReason): a plan, a permission's own words, a question
    const q = n.question
    const why = q ? (q.kind === 'Plan' ? REASONS.plan : fit(q.title) || (q.choices?.[0]?.label === 'Allow' ? REASONS.permission : REASONS.question))
      : n.secret ? fit(`Wants the secret ${n.secret.name}`) : REASONS.question
    // an agent's item: its name (a space's agent is its Assistant), where it is: its machine and space
    return { id: n.id, chat: n.chat, who: 'Assistant', why, where: where(p?.machine, p?.name), space: p?.name }
  })
  // an automation goes by its name, with no id: "Didn't run" or "Didn't start its task"
  const autos = autosIn(snap, chips).filter((a) => a.error)
    .map((a) => ({ id: `auto:${a.machine ?? ''}:${a.listName}:${a.name}`, who: a.name, why: a.failed === 'fire' ? "Didn't run" : "Didn't start its task", where: where(a.machine, a.listName), space: a.listName, auto: a }))
  return [...asks, ...autos]
}

/** a list's automations: snap.automations holds them by place id (a list no space works in: by its own key, in
 *  every list but one narrowed to places) */
function autosIn(snap: Snapshot, chips: string[]) {
  return Object.entries(snap.automations ?? {}).filter(([k]) => inList(snap, chips, k)).flatMap(([, v]) => v)
}

/** a Needs you row of no task: an agent's opens its chat; a failed automation's opens the Automations group */
function AgentNeedRow({ n, listKey, spaceOnly }: { n: AgentNeed; listKey: string; spaceOnly?: boolean }) {
  const shut = useUI((u) => u.shut.includes(`${listKey}|automations`))
  return (
    <Line
      glyph={n.auto ? <RepeatIcon className="size-3.5 text-need" /> : <TaskDot s="need" />}
      title={n.who}
      sub={n.why}
      where={spaceOnly ? n.space : n.where}
      tip={n.auto?.error}
      onOpen={() => (n.chat ? goChat(n.chat) : shut && toggleShut(listKey, 'automations'))}
    />
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

/** The toggle under the search box: group by status or by place (SHEP-182), kept on this device */
function ByToggle() {
  const by = useUI((u) => u.groups)
  const opt = (k: GroupBy, label: string) => (
    <button key={k} type="button" role="radio" aria-checked={by === k} onClick={() => setGroup(k)}
      className="press inline-flex h-6 items-center rounded-full px-3 text-[0.75rem] text-fg2 hover:text-fg aria-checked:bg-sel aria-checked:text-fg coarse:h-8 phone:h-8 phone:px-4 phone:text-[0.875rem]">
      {label}
    </button>
  )
  return (
    <div role="radiogroup" aria-label="Group by" className="flex items-center gap-0.5 px-2.5 pt-2 phone:px-3.5">
      <span className="pr-1.5 text-[0.75rem] text-fg3 phone:text-[0.875rem]">Group by</span>
      {opt('status', 'Status')}
      {opt('place', 'Place')}
    </div>
  )
}

function TaskList(_: { placeId: string }) {
  const snap = useSnap()!
  const view = useStore((s) => listView(s.ui, snap))
  const key = view.key
  const by = useUI((u) => u.groups)
  const allDone = useUI((u) => u.allDone)
  const shut = useUI((u) => u.shut)
  const archived = useUI((u) => u.archived === key)
  const here = useUI((u) => u.thisSpace && view.chips.length === 1 && view.chips[0] === u.place)
  const q = useUI((u) => filterOf(u, view.search, 'tasks'))
  const place = placeOf(snap, getState().ui.place)
  // a task moving to another group glides there; a new one fades in; what a filter, Show more or a fold leaves just shows
  const list = useRef<HTMLDivElement>(null)
  useFlip(list, `${key}|${by}|${q}|${allDone.join()}|${shut.join()}`)
  // headings stay on screen while their group scrolls under the search field (it is sticky too): --stick is its height
  useLayoutEffect(() => {
    const el = list.current
    const box = el?.parentElement?.querySelector<HTMLElement>('[data-filter]')
    if (!el || !box) return
    const seen = new ResizeObserver(() => el.style.setProperty('--stick', `${box.offsetHeight}px`))
    seen.observe(box)
    return () => seen.disconnect()
  }, [archived])
  if (archived) return <ArchivedList list={view} />
  const loaded = !!snap.places.length || !!snap.tasks.length
  // what the search field holds: only what matches it shows, in its group (the window's matches())
  const asks = agentNeeds(snap, view.chips).filter((n) => !q || matches(q, n.who, n.why, n.where))
  const live = tasksIn(snap, view).filter((t) => !q || found(snap, t, q))
  const autos = autosIn(snap, view.chips).filter((a) => !q || matches(q, a.name, a.listName, a.machine ? machineName(snap.machines, a.machine) : undefined))
  const footer = q ? null : registry.tasksFooter.map((F, i) => <F key={i} place={place} list={view} />)
  // searching, Done and archived tasks are in it too, each group whole and open, folded shut or not
  let groups = q
    ? filteredGroups(snap, view, '', { groups: by }).map((g) => keepTasks(g, (t) => found(snap, t, q))).filter((g) => g.tasks.length)
      .map((g) => ({ ...g, count: g.tasks.length, more: 0, less: false, shut: false }))
    : shownGroups(snap, view, { groups: by, allDone, shut })
  // what agents ask needs you too: Needs you is a group of its own when no task is in it, first but Pinned
  if (asks.length && !groups.some((g) => g.key === 'need')) {
    const at = groups[0]?.key === 'pinned' ? 1 : 0
    groups = [...groups.slice(0, at), { key: 'need', label: 'Needs you', tasks: [], names: namesFor(view.level), count: 0, more: 0, less: false, shut: !q && shut.includes(`${key}|need`) }, ...groups.slice(at)]
  }
  // what the keyboard walks: the rows on screen
  const order = groups.flatMap((g) => g.tasks)
  const nothing = !groups.length && !autos.length
  // searching, the archived tasks that match come last, after the automations
  const archivedGroup = groups.find((g) => g.key === 'archived')
  const autoShut = !q && shut.includes(`${key}|automations`)
  const autoGroup = autos.length ? (
    <div key="automations" data-flip="automations">
      <GroupHeading label="Automations" count={autos.length} flip="group:automations" fold={q ? undefined : { shut: autoShut, toggle: () => toggleShut(key, 'automations') }} />
      {autoShut ? null : <List>{autos.map((a) => <AutoRow key={`${a.machine ?? ''}:${a.listName}:${a.name}`} a={a} where={autoWhere(snap, a)} from={autoFrom(snap, a)} />)}</List>}
    </div>
  ) : null
  let lastOn: string | undefined
  return (
    <>
      <TaskFilter listKey={view.search} order={order} />
      <ByToggle />
      <div ref={list} className="relative">
        {!loaded ? <Empty className="pt-3 text-fg3">Reading tasks…</Empty> : null}
        {groups.filter((g) => g !== archivedGroup).map((g) => {
          const fold: Fold | undefined = q ? undefined : { shut: g.shut, toggle: (all) => toggleShut(key, g.key, all ? groups.filter((x) => x !== g).map((x) => x.key) : []) }
          const extra = g.key === 'need' ? asks : []
          const row = (t: Task) => <TaskRow key={t.id} t={t} ix={order.indexOf(t)} where={whereOf(snap, t, g.names)} />
          const rows = <List>{g.tasks.map(row)}{extra.map((n) => <AgentNeedRow key={n.id} n={n} listKey={key} spaceOnly />)}</List>
          // by place: a space's work under its name, under its machine's name where more show; both fold
          if (g.on !== undefined) {
            const mShut = !q && shut.includes(`${key}|m:${g.on}`)
            const first = g.on !== lastOn
            lastOn = g.on
            const mine = groups.filter((x) => x.on === g.on)
            const head = view.level === 0 && first ? <MachineHeading name={g.machine ?? g.on} machine={snap.machines?.find((x) => x.machine === g.on)} count={mine.reduce((n, x) => n + x.count, 0)} fold={q ? undefined : { shut: mShut, toggle: () => toggleShut(key, `m:${g.on}`) }} /> : null
            if (view.level === 0 && mShut) return head ? <div key={g.key}>{head}</div> : null
            return (
              <div key={g.key}>
                {head}
                <SpaceHeading group={g} count={g.count} fold={fold} />
                {/* its tasks indented under the space's heading */}
                {g.shut ? null : <div className="pl-5 phone:pl-6">{rows}</div>}
              </div>
            )
          }
          // Done, shut: only its count, a quiet line, until opened
          if (g.key === 'done' && g.shut) {
            return <DoneLine key="done" count={g.count} today={g.count === live.filter((t) => t.status === 'done' && !t.archived && !t.pinned && isToday(t.doneAt)).length} onClick={() => toggleShut(key, DONE_OPEN)} />
          }
          const doneFold: Fold | undefined = g.key === 'done' && !q ? { shut: false, toggle: () => toggleShut(key, DONE_OPEN) } : fold
          return (
            <div key={g.key}>
              <GroupHeading label={g.label} note={g.note} count={g.count + extra.length} flip={`group:${g.key}`} fold={doneFold} />
              {g.shut ? null : rows}
              {g.more || g.less ? (
                <div data-flip={`more:${g.key}`}>
                  <DoneToggle more={g.more} onClick={() => toggleAllDone(key, g.key)} />
                </div>
              ) : null}
            </div>
          )
        })}
        {/* Automations: their own group, last */}
        {autoGroup}
        {/* nothing at all: said once, never "yet" (3.0's) */}
        {loaded && nothing && !q ? <Empty className="pt-3 text-fg3">{here ? `Nothing in ${place.name}.` : snap.tasks.length ? 'Nothing to do.' : 'No tasks on any machine. Ask an Assistant to plan some.'}</Empty> : null}
        {archivedGroup ? (
          <div key="archived">
            <GroupHeading label="Archived" count={archivedGroup.tasks.length} flip="group:archived" />
            <List>
              {archivedGroup.tasks.map((t) => <TaskRow key={t.id} t={t} ix={order.indexOf(t)} where={whereOf(snap, t, { machine: view.level === 0, project: true })} />)}
            </List>
          </div>
        ) : null}
        {q && !groups.length && !autos.length ? <Empty className="pt-3 text-fg3">No tasks match “{q}”.</Empty> : null}
        {footer}
      </div>
    </>
  )
}

/** By place: a machine's name over its spaces (when more than one machine has tasks); folds them all */
/** a machine's heading in Place: its mark (emoji, a monitor for this computer, a server) and its name, muted and regular,
 *  as the Spaces sidebar's machine rows; the hierarchy is the icon and the indent, not weight */
function MachineHeading({ name, machine, count, fold }: { name: string; machine?: Machine; count: number; fold?: Fold }) {
  return (
    <FoldHeading name={name} fold={fold} flip={`machine:${name}`} count={count} className="pt-4" sticky>
      <span className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-fg2 phone:text-base">
        <MachineGlyph m={machine} />
        <h3 className="min-w-0 truncate font-normal">{name}</h3>
      </span>
    </FoldHeading>
  )
}

/** a machine's mark, as the Spaces sidebar draws it */
function MachineGlyph({ m }: { m?: Machine }) {
  if (m?.emoji) return <span data-icon="emoji" aria-hidden className="-mr-0.5 grid w-[15px] shrink-0 place-items-center text-[0.9375rem] leading-none phone:w-4 phone:text-base">{m.emoji}</span>
  const Plain = m?.here ? MonitorIcon : ServerIcon
  return <Plain className="size-[15px] shrink-0 -mr-0.5 text-fg3 phone:size-4" />
}

/** a heading's fold: shut or open, and what a tap does (all: Alt/Option held, its siblings go the same way) */
type Fold = { shut: boolean; toggle: (all: boolean) => void }

/**
 * A heading that folds what is under it away, as the sidebar's tree does: the whole heading is the button, the
 * sidebar's chevron where the rows' dots are, its count at the end, shut or open. Alt/Option-click takes its siblings
 * with it. Without a fold (filtering: every match shows) it is just the heading, in the same place.
 */
function FoldHeading({ name, fold, flip, className, children, count, sticky }: { name: string; fold?: Fold; flip?: string; className?: string; children: ReactNode; count?: number; sticky?: boolean }) {
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
    <div data-flip={flip} data-heading={name} className={clsx('px-1.5 phone:px-2', sticky && 'sticky top-(--stick,0px) z-1 bg-bg', className)}>
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

/** By place: a space's name over its work, its emoji beside it if it has one; the whole heading folds it */
function SpaceHeading({ group: g, count, fold }: { group: Pick<TaskGroup, 'label' | 'emoji' | 'key'>; count: number; fold?: Fold }) {
  return (
    // indented under its machine's heading, its icon (the space's emoji, else #) level with the machine's name's room
    <FoldHeading name={g.label} fold={fold} flip={`group:${g.key}`} count={count} className="pt-2 pl-5 phone:pl-6" sticky>
      <span className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-fg2 phone:text-base">
        {g.emoji ? <span data-icon="emoji" aria-hidden className="-mr-0.5 grid w-[15px] shrink-0 place-items-center text-[0.9375rem] leading-none phone:w-4 phone:text-base">{g.emoji}</span> : <HashIcon className="size-[15px] shrink-0 -mr-0.5 text-fg3 phone:size-4" />}
        <span className="min-w-0 truncate">{g.label}</span>
      </span>
    </FoldHeading>
  )
}

/** a Done time today, on this device's clock */
const isToday = (ms?: number) => !!ms && new Date(ms).toDateString() === new Date().toDateString()

/** Done, shut: one quiet line, "3 done today" (or "12 done", some older), a tap shows them */
function DoneLine({ count, today, onClick }: { count: number; today: boolean; onClick: () => void }) {
  return (
    <div data-flip="group:done" className="px-1.5 pt-2 phone:px-2">
      <button type="button" aria-expanded={false} onClick={onClick}
        className="press flex min-h-8 w-full items-center gap-3 rounded-row px-2 text-left text-[0.75rem] text-fg3 outline-none hover:bg-hover hover:text-fg2 keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-focus)] coarse:min-h-11 phone:min-h-11 phone:px-3 phone:text-[0.875rem]">
        <NextIcon aria-hidden className={clsx(ic, '-mx-px phone:mx-0')} />
        <span className="tabular-nums">{count} done{today ? ' today' : ''}</span>
      </button>
    </div>
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

/** The Tasks header's ⋯: narrow the list to the space picked (the one thing the old chip row had that the toggle doesn't) */
function TasksMenu(_: { place: Place }) {
  const here = useUI((u) => u.thisSpace)
  const phone = useUI((u) => u.device === 'phone')
  const [open, setOpen] = useState(false)
  const B = phone ? RoundButton : IconButton
  return (
    <div className="relative">
      <B
        label="Tasks options"
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx('rounded-full!', phone ? 'aria-expanded:bg-line2' : 'aria-expanded:bg-hover')}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon className={ic} />
      </B>
      {open ? (
        <Menu label="Tasks options" onClose={() => setOpen(false)} className="absolute top-full right-0 z-21 mt-1.5 max-w-[calc(100vw-24px)] origin-top-right">
          <MenuItem role="menuitemcheckbox" aria-checked={here} icon={here ? <CheckIcon className={ic} /> : null} onClick={() => { setOpen(false); setThisSpace(!here) }}>
            Only this space
          </MenuItem>
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
