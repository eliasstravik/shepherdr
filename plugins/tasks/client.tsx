// Tasks: a place's tasks grouped Needs you / Ready / Working / To do / Done, or as this device chose in the header's ⋯
// (groups.ts). Each heading folds what is under it away, remembered per view on this device. A row says where its task
// is (machine, space) only where the view and its heading don't. A task opens straight into its one
// agent's chat, and its dot here is that agent's. A To do task's agent waits for its next message, like any
// chat. Tasks are added only by asking a coordinator. To do always shows, empty or not, so the human sees it
// exists; the other groups, and Automations, only when they hold something; pinned tasks sit above them all, in Pinned.
// A task's one menu (TaskActions) sits in its row's ⋯ (a mouse finds it on hover or a right click; a finger taps the ⋯ or
// holds the row) and in its chat's ⋯. It ends a task three ways: Stop (To do, its work kept), Done and Delete. Done tasks
// file themselves in the Archived view at the bottom of the list, out of every list and count; Unarchive brings one back.
import clsx from 'clsx'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  act,
  archivedIn,
  archiveTask,
  definePlugin,
  closeTask,
  deleteTask,
  filteredGroups,
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
  setChips,
  setGroup,
  setUI,
  toggleAllDone,
  toggleShut,
  shownGroups,
  stopTask,
  taskOf,
  useSnap,
  useStore,
  useUI,
  type GroupBy,
  type ListView,
  type TaskGroup,
} from '@client/kernel.ts'
import { ListChips } from '@client/chips.tsx'
import { keysMoved } from '@client/focus.ts'
import {
  ArchivedIcon,
  BackIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  DeleteIcon,
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
  MenuSeparator,
  Meta,
  MoreIcon,
  NextIcon,
  PinTaskIcon,
  Primary,
  RoundButton,
  Row,
  rowClass,
  RowText,
  SplitIcon,
  StopIcon,
  taskLine,
  TaskDot,
  UnarchiveIcon,
  UnpinIcon,
  Who,
} from '@client/ui.tsx'
import { taskChatId, type Automation, type Place, type Snapshot, type Task } from '@shared/types.ts'
import { useFlip } from '@client/motion.ts'
import { and, Dialog, RowMenu, RowMenuButton, useRowMenu, type RowMenuState } from '@client/rowmenu.tsx'
import { RestartItem } from '@client/restart.tsx'

/**
 * A task, with one line under its title (taskLine). Working, its pie fills with the % done its agent reported and the minutes
 * left sit small under it. Every row shows its age (how long it has been as it is) at its end, like the rows around it;
 * waiting on you, its frozen status line stays in its chat's header.
 */
function TaskRow({ t, ix, where }: { t: Task; ix: number; where?: string[] }) {
  // the open task, or the focused pane's in split view
  const sel = useUI((u) => u.task === t.id || (panesHere(u)[u.split.pane]?.kind === 'task' && panesHere(u)[u.split.pane].id === t.id))
  const kb = useUI((u) => u.kb && !u.task && u.cur === ix)
  const sub = taskLine(t, where)
  // archived: a quiet ring, or a done task's check; the status it was put away with stays in its chat
  const dot = t.archived ? (t.status === 'done' ? 'done' : 'idle') : t.status
  const menu = useRowMenu()
  // while its ⋯ shows, the age gives it its place
  const shy = menu.open ? 'invisible' : '[@media(hover:hover)]:group-hover:invisible [@media(hover:hover)]:group-has-focus-visible:invisible'
  return (
    <li data-flip={t.id} className={clsx(rowClass(sel, kb), 'group p-0! select-none [-webkit-touch-callout:none]', menu.open && !sel && 'bg-hover')} {...menu.press}>
      {/* the whole row is one button (it opens the task); its ⋯ sits over its end, a button of its own */}
      <button
        type="button"
        aria-current={sel || undefined}
        // with ⌘ (Ctrl off a Mac), beside the focused pane in split view
        onClick={(e) => !menu.held() && (splitClick(e) ? openSplit({ kind: 'task', id: t.id }) : openTask(t.id))}
        className={clsx(
          // where nothing hovers its ⋯ always shows, past the age
          'flex min-h-[inherit] min-w-0 flex-1 cursor-pointer gap-2 rounded-[inherit] px-2 text-left outline-none keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)] phone:px-3 [@media(hover:none)]:pr-9!',
          sub ? 'items-start py-1.5 [&>.dot]:mt-[3px] phone:[&>.dot]:mt-1' : 'items-center',
        )}
      >
        <TaskDot s={dot} w={t.archived ? undefined : t.report} />
        <RowText sub={sub}>
          <span className="text-fg3">{t.id}</span> {t.name}
        </RowText>
        <Meta className={shy}>{t.age}</Meta>
      </button>
      <RowMenuButton menu={menu} always label="More for this task" className={clsx('absolute right-1 z-1 phone:right-1.5', sub ? 'top-1.5 phone:top-2.5' : 'top-1/2 -translate-y-1/2')} />
      {menu.open ? <TaskMenu t={t} menu={menu} /> : null}
    </li>
  )
}

/** Done: at once when nothing would be left unmerged; else it asks first (and says why when it can't be done) */
async function markDone(t: Task) {
  const r = await closeTask(t).catch((e: Error) => ({ ok: false, error: e.message, held: undefined }))
  if (r.held?.length) setConfirm({ t, kind: 'close', held: r.held })
  else if (r.ok === false) setConfirm({ t, kind: 'close', held: [], error: r.error || 'It could not be marked done.' })
}

/**
 * A task's one menu, in its row's ⋯ and its chat's: Pin or Unpin (not for an archived task), Restart agent (an open one),
 * then the ways to end it: Stop (an open one, unless it is To do with no agent up; it asks first), Done (one not done yet; it asks
 * first when work would stay unmerged), Unarchive (an archived one), and Delete, which always asks first.
 */
function TaskActions({ task: t, close }: { task: Task; close: () => void }) {
  const then = (f: () => unknown) => () => {
    close()
    f()
  }
  return (
    <>
      {t.archived ? null : t.pinned ? (
        <MenuItem icon={<UnpinIcon className={ic} />} onClick={then(() => pinTask(t, false).catch(() => undefined))}>
          Unpin
        </MenuItem>
      ) : (
        <MenuItem icon={<PinTaskIcon className={ic} />} onClick={then(() => pinTask(t, true).catch(() => undefined))}>
          Pin
        </MenuItem>
      )}
      {t.status !== 'done' && !t.archived ? <RestartItem chat={t.agent?.chat ?? `${t.id}/Agent`} name={t.id} onPick={close} /> : null}
      {t.status !== 'done' && !t.archived && (t.status !== 'todo' || t.agent?.running) ? (
        <MenuItem icon={<StopIcon className={ic} />} onClick={then(() => setConfirm({ t, kind: 'stop' }))}>
          Stop…
        </MenuItem>
      ) : null}
      {t.status !== 'done' ? (
        <MenuItem icon={<CheckCircleIcon className={ic} />} onClick={then(() => markDone(t))}>
          Done
        </MenuItem>
      ) : null}
      {t.archived ? (
        <MenuItem icon={<UnarchiveIcon className={ic} />} onClick={then(() => archiveTask(t, false).catch(() => undefined))}>
          Unarchive
        </MenuItem>
      ) : null}
      <MenuSeparator />
      <MenuItem icon={<DeleteIcon className={ic} />} className="text-need-fg" onClick={then(() => setConfirm({ t, kind: 'delete' }))}>
        Delete…
      </MenuItem>
    </>
  )
}

/** The row's menu: beside a desktop's panes, Open in split view, then the task's own */
function TaskMenu({ t, menu }: { t: Task; menu: RowMenuState }) {
  const desktop = useUI((u) => u.device === 'desktop')
  const Actions = registry.views.taskActions ?? TaskActions
  return (
    <RowMenu menu={menu} label={t.id}>
      {desktop ? (
        <>
          <MenuItem
            icon={<SplitIcon className={ic} />}
            onClick={() => {
              menu.close()
              openSplit({ kind: 'task', id: t.id })
            }}
          >
            Open in split view
          </MenuItem>
          <MenuSeparator />
        </>
      ) : null}
      <Actions task={t} close={menu.close} />
    </RowMenu>
  )
}

/* ---------- stopping and deleting a task ask first ---------- */

type Confirming = { t: Task; kind: 'stop' | 'delete' } | { t: Task; kind: 'close'; held: string[]; error?: string }
let confirming: Confirming | null = null
const confirmListeners = new Set<() => void>()
function setConfirm(c: Confirming | null) {
  confirming = c
  confirmListeners.forEach((f) => f())
}

/** "Stop SHE-12?", "Mark SHE-12 done?" or "Delete SHE-12?" */
function ConfirmTask() {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((n) => n + 1)
    confirmListeners.add(f)
    return () => void confirmListeners.delete(f)
  }, [])
  const snap = useSnap()
  // the task as it is now: it may have stopped working while this was up
  const c = confirming
  const t = c && snap ? (snap.tasks.find((x) => x.id === c.t.id) ?? c.t) : c?.t
  if (!c || !t) return null
  // a new question each time, its own state fresh
  if (c.kind === 'close') return <ConfirmClose key={`c:${t.id}`} t={t} held={c.held} failed={c.error} />
  return c.kind === 'delete' ? <ConfirmDelete key={`d:${t.id}`} t={t} /> : <ConfirmStop key={`s:${t.id}`} t={t} />
}

const cancel = () => setConfirm(null)

/** "Stop SHE-12?": its agent goes and it is To do; its work stays. It says why when it can't be stopped */
function ConfirmStop({ t }: { t: Task }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    setError(null)
    const r: { ok?: boolean; error?: string } = await stopTask(t).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (r.ok === false) return setError(r.error || 'It could not be stopped.')
    setConfirm(null)
  }
  return (
    <Dialog
      onCancel={cancel}
      title={`Stop ${t.id}?`}
      buttons={
        <Primary autoFocus disabled={busy} onClick={go}>
          {busy ? 'Stopping…' : 'Stop'}
        </Primary>
      }
    >
      <p>{t.status === 'work' ? 'Its agent is working; this ends that. ' : ''}It goes to To do. Its work stays, and writing to it starts it again.</p>
      {error ? <p className="mt-1.5 text-need-fg">{error}</p> : null}
    </Dialog>
  )
}

/** "Mark SHE-12 done?" when it holds work main lacks: that stays in its worktree and branch, but nothing is merged.
 *  failed: it could not be marked done, and this says why */
function ConfirmClose({ t, held, failed }: { t: Task; held: string[]; failed?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(failed ?? null)
  const go = async () => {
    setBusy(true)
    const r = await closeTask(t, true).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (r.ok === false) return setError(r.error || 'It could not be marked done.')
    setConfirm(null)
  }
  return (
    <Dialog
      onCancel={cancel}
      title={failed ? `${t.id} wasn’t marked done` : `Mark ${t.id} done?`}
      safe={!held.length}
      cancel={held.length ? 'Cancel' : 'OK'}
      buttons={
        held.length ? (
          <Primary autoFocus disabled={busy} onClick={go}>
            {busy ? 'Marking done…' : 'Done'}
          </Primary>
        ) : null
      }
    >
      {held.length ? <p>It holds {and(held)}. Nothing is merged; its worktree and branch keep that work.</p> : null}
      {error ? <p className="mt-1.5 text-need-fg">{error}</p> : null}
    </Dialog>
  )
}

/**
 * "Delete SHE-12?": it goes for good, with its agent, worktree, branch and chat. A task that holds work the branch
 * hasn't landed (or uncommitted changes) is refused first; then it says what would be lost and offers to delete anyway.
 */
function ConfirmDelete({ t }: { t: Task }) {
  const [busy, setBusy] = useState(false)
  const [held, setHeld] = useState<string[] | null>(null)
  // its agent was stopped while it was looked at again: it waits for a message to go on
  const [stopped, setStopped] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    setError(null)
    const r = await deleteTask(t, !!held).catch((e: Error) => ({ ok: false, error: e.message, held: undefined, stopped: false }))
    setBusy(false)
    if (r.held?.length) {
      setStopped(!!r.stopped)
      return setHeld(r.held)
    }
    if (r.ok === false) return setError(r.error || 'It could not be deleted.')
    setConfirm(null)
    // its chat was open: it is gone, so back to the place
    if (getState().ui.task === t.id) setUI({ task: null })
  }
  return (
    <Dialog
      onCancel={cancel}
      safe
      title={`Delete ${t.id}?`}
      buttons={
        <Primary className="bg-need-fg! text-white! dark:text-black!" disabled={busy} onClick={go}>
          {busy ? 'Deleting…' : held ? 'Delete anyway' : 'Delete'}
        </Primary>
      }
    >
      {held ? (
        <p>
          It holds {and(held)}.{stopped ? ' Its agent was stopped; writing to it starts it again.' : ''} Deleting it anyway loses that work for good.
        </p>
      ) : (
        <p>Its agent, worktree, branch and chat go for good. This can’t be undone.</p>
      )}
      {error ? <p className="mt-1.5 text-need-fg">{error}</p> : null}
    </Dialog>
  )
}

/** where a task is, as its row says it: its machine and space, each only where neither the view nor its group's
 *  heading says it ("vm-str · gtm") */
function whereOf(snap: Snapshot, t: Task, names: TaskGroup['names']) {
  const p = placeOf(snap, t.place)
  const m = names.machine ? snap.machines?.find((x) => x.machine === p.machine) : undefined
  return [m?.name, names.project ? p.name : undefined].filter((x): x is string => !!x)
}

/** what to ask for a task where none is: the one space's coordinator, else any */
function noTasks(snap: Snapshot, list: ListView) {
  const one = list.level === 2 ? snap.places.find((p) => p.id === list.chips[0]) : undefined
  return one ? `No tasks yet. Ask ${one.name} to add one.` : 'No tasks yet. Ask a coordinator to add one.'
}

/** The lists' tasks: what their chips hold (placeId, the place picked, is for plugins of old) */
/** a Needs you group counts what its tasks wait for, card by card, as every other count does */
const needCount = (snap: Snapshot, g: { key: string; count: number; tasks: Task[] }) => {
  if (g.key !== 'need' && !g.key.endsWith('|need')) return g.count
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
  const q = useUI((u) => filterOf(u, view.search, 'tasks'))
  // the footer's place: the one space shown, else the place picked
  const place = placeOf(snap, view.level === 2 ? view.chips[0] : getState().ui.place)
  const by = groupFor(chosen, view.level)
  // a task moving to another group glides there; a new one fades in; what a filter, Show all, a fold or a chip leaves
  // just shows
  const list = useRef<HTMLDivElement>(null)
  useFlip(list, `${key}|${by}|${q}|${allDone.join()}|${shut.join()}`)
  if (archived) return <ArchivedList list={view} />
  // filtering, Done and archived tasks are in it too, each group whole and open, folded shut or not
  const groups = q
    ? filteredGroups(snap, view, q, { groups: chosen }).map((g) => ({ ...g, count: g.tasks.length, more: 0, less: false, shut: false }))
    : shownGroups(snap, view, { groups: chosen, allDone, shut })
  // what the keyboard walks: the rows on screen
  const order = groups.flatMap((g) => g.tasks)
  const footer = q ? null : registry.tasksFooter.map((F, i) => <F key={i} place={place} list={view} />)
  if (!groups.length && !q && !archivedIn(snap, view).length)
    return (
      <>
        <ListChips alone />
        <Empty>{view.attention ? 'No tasks need you or are ready.' : noTasks(snap, view)}</Empty>
        {view.attention ? <LinkButton onClick={() => setChips(view.chips)}>Show all tasks</LinkButton> : null}
        {footer}
      </>
    )
  const machines = [...new Set(groups.flatMap((g) => (g.machine ? [g.machine.id] : [])))]
  const machineShut = (id: string) => !q && shut.includes(`${key}|m:${id}`)
  return (
    <>
      <TaskFilter listKey={view.search} order={order} />
      {view.attention && !q ? <div className="flex items-center justify-between gap-2 px-3 pt-2 text-[0.8125rem] text-fg2 phone:px-4 phone:text-[0.9375rem]">
        <span>Actionable · all machines</span>
        <LinkButton onClick={() => setChips(view.chips)}>Show all tasks</LinkButton>
      </div> : null}
      {/* one flat run of keyed parts: a group showing or going never makes the ones after it start over; only the
          rows and what sits between them glide (data-flip), never what holds them, so no move adds to another */}
      <div ref={list} className="relative">
        {groups.flatMap((g, i) => {
          // All machines: a machine's name over its groups, once, with how many tasks they hold
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
          // a machine folded shut shows its name alone
          if (m && machineShut(m.id)) return [head]
          // its siblings: the groups under the same machine (or under none)
          const siblings = () => groups.filter((x) => x !== g && x.machine?.id === m?.id).map((x) => x.key)
          const fold: Fold | undefined = q ? undefined : { shut: g.shut, toggle: (all) => toggleShut(key, g.key, all ? siblings() : []) }
          return [
            head,
            <div key={g.key}>
              {g.kind === 'machine' ? (
                <MachineHeading name={g.label} first={!i} count={g.count} fold={fold} />
              ) : (
                <GroupHeading label={g.label} note={g.note} count={needCount(snap, g)} flip={`group:${g.key}`} fold={fold} />
              )}
              {g.shut ? null : g.tasks.length ? (
                <List>
                  {g.tasks.map((t) => (
                    <TaskRow key={t.id} t={t} ix={order.indexOf(t)} where={whereOf(snap, t, g.names)} />
                  ))}
                </List>
              ) : (
                // only To do shows empty; with no tasks at all it says how one comes
                <div data-flip={`empty:${g.key}`}>
                  <Empty className="pt-0.5 text-fg3">{order.length ? 'No tasks to do yet. Ask a coordinator to add one.' : noTasks(snap, view)}</Empty>
                </div>
              )}
              {g.more || g.less ? (
                <div data-flip={`more:${g.key}`}>
                  <DoneToggle more={g.more} onClick={() => toggleAllDone(key, g.key)} />
                </div>
              ) : null}
            </div>,
          ]
        })}
        {q && !groups.length ? <Empty className="pt-3 text-fg3">No tasks match “{q}”. Try another search or change the filters.</Empty> : null}
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
    >
      <ListChips />
    </FilterBox>
  )
}

/** Under a group cut to its latest Done tasks, "Show all 96"; once they all show, "Show less": a quiet row, not a call to act */
function DoneToggle({ more, onClick }: { more: number; onClick: () => void }) {
  return (
    <div className="px-1.5 phone:px-2">
      <button
        type="button"
        aria-expanded={!more}
        className="press flex min-h-8 items-center gap-1 rounded-full px-2.5 text-[0.75rem] font-medium text-fg3 hover:text-fg2 keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-focus)] focus-visible:outline-none coarse:min-h-11 phone:min-h-11 phone:px-3 phone:text-[0.875rem]"
        onClick={onClick}
      >
        {more ? `Show all ${more}` : 'Show less'}
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
  const by = view.attention ? 'project' : groupFor(chosen, level)
  const phone = useUI((u) => u.device === 'phone')
  const [open, setOpen] = useState(false)
  const choices = groupChoices(level)
  if (choices.length < 2) return null
  const B = phone ? RoundButton : IconButton
  return (
    <div className="relative">
      <B
        label="Group tasks"
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx('rounded-full!', phone ? 'aria-expanded:bg-line2' : 'aria-expanded:bg-hover')}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon className={ic} />
      </B>
      {open ? (
        <Menu label="Group tasks" onClose={() => setOpen(false)} className="absolute top-full right-0 z-21 mt-1.5 max-w-[calc(100vw-24px)] origin-top-right">
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

/** a task's pull request, small in its chat's header: a tap opens it on GitHub */
function PrLink({ chatKey }: { chatKey: string }) {
  const snap = useSnap()!
  const ui = useUI()
  const id = taskChatId(chatKey)
  const pr = id ? taskOf(snap, id)?.pr : undefined
  if (!pr) return null
  const phone = ui.device === 'phone'
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      data-pr={pr.number}
      className={clsx(
        'press-dim inline-flex shrink-0 items-center rounded-full font-medium whitespace-nowrap text-fg2 tabular-nums',
        phone ? 'h-11 bg-bubble px-3.5 text-[0.9375rem]' : 'h-7 px-2.5 text-[0.8125rem] shadow-[inset_0_0_0_1px_var(--line2)] hover:bg-hover',
      )}
    >
      {/* a phone's header has room for the number alone */}
      {phone ? `#${pr.number}` : `PR #${pr.number}`}
    </a>
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
    reg.overlays.push(ConfirmTask)
    reg.agentHeader.push({ order: 40, View: PrLink })
  },
})
