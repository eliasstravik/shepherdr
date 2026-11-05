// Coordinators: a space's Assistant and its tabs, as 3.0's tab bar (mods/tabs-tasks), + menu (mods/new-menu-tasks), tab
// menu (mods/menu-tasks) and pane header (mods/pane-chat). The tab bar, a desktop's and a tablet's, lists the space's
// tabs, its Assistant's first: what runs in each, its status (a spinner while working, what needs you and what is Ready
// as counts, else a dot), × on the shown one. A click shows a tab, a double-click renames it, a right-click (a touch
// screen: the shown tab's ⋯) opens its menu, dropping one on another moves it, the wheel goes to the next. Then its +
// and the side panels' buttons. The header's Autopilot switch says what it waits for (core/autopilot.js); "Write a
// heartbeat" follows it while the heartbeat is empty. Every word is core/menus.js's or core/confirm.js's, as the window's.
// On a phone the tabs, the shown tab's menu and the + menu's items are in the header's ⋯.
import clsx from 'clsx'
import { PlayIcon } from '@heroicons/react/16/solid'
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type ReactNode, type WheelEvent } from 'react'
import { attentionCounts } from '@client/attention.ts'
import { openRole } from '@client/screens/Role.tsx'
import { openWorktree } from '@client/screens/Worktree.tsx'
import { act, definePlugin, getState, has, registry, removeSpace, setUI, useSnap, useStore, useUI } from '@client/kernel.ts'
import { Dialog } from '@client/rowmenu.tsx'
import { sectionOf, Switch } from '@client/Settings.tsx'
import { AttentionBadge, DiffIcon, Dot, field, FolderIcon, ic, IconButton, KeyboardIcon, Menu, MenuItem, MenuLabel, MenuSeparator, ModelIcon, MoreIcon, PageIcon, PlanIcon, PlusIcon, Primary, RenameIcon, RestartIcon, SplitIcon, TasksIcon, TermIcon, XIcon } from '@client/ui.tsx'
import { openAddSpace } from '@plugins/places/add.tsx'
import { toast } from '@plugins/alerts/toasts.tsx'
import { openKeybinds } from '@plugins/keyboard/client.tsx'
import { DiffView, FilesView } from '@plugins/worktree/client.tsx'
import type { Place, PlaceTab, Snapshot, Task, TabState } from '@shared/types.ts'
import * as CF from '@core/confirm.js'
import * as MNc from '@core/menus.js'
import * as APc from '@core/autopilot.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MN = MNc as any, AP = APc as any

/** something the Herdr window does went wrong: said as the window's toasts say it */
const failed = (title: string) => (e: Error) => toast({ title, body: e.message, level: 'error' })

/** Settings › Autopilot ("Write a heartbeat"), on this space: its own, and what it inherits from Everywhere */
function openAutopilot(place: Place) {
  const s = getState()
  const level = s.snap?.settings.some((x) => x.level === place.id) ? place.id : 'all'
  const i = s.snap ? sectionOf('Autopilot', s.snap.settings, { ...s.ui, settings: { section: 0, level } }) : -1
  setUI({ settings: { section: Math.max(0, i), level }, drawer: false, menu: false })
}

/** Run now (herdr-task autopilot run-now): queued until the Assistant is idle, which the words then say ("Queued",
 *  "Waking"); it waits while one is already queued or running. The header's button and the phone's ⋯ item share it. */
function useRunNow(place: Place) {
  const [running, setRunning] = useState(false)
  const a = place.pilot
  const busy = running || !!a?.pending || !!a?.inflight
  const run = async () => {
    if (busy) return
    setRunning(true)
    try {
      const r = await act({ type: 'autopilot-run', place: place.id })
      if (r.error) throw new Error(r.error)
    } catch (e) {
      failed("Autopilot didn't wake")(e as Error)
    } finally {
      setRunning(false)
    }
  }
  return { running, busy, run }
}

/** The header's Autopilot (3.0's switch), one group: the switch, "Autopilot", what it waits for (core/autopilot.js
 *  headerDetail: "Next in 7 min", "Queued", "Waking", "On events", "Run now only") and Run now, on one quiet pill as
 *  tall as Chat | Terminal. It flips at once, herdr-task's answer says the rest (a refusal goes back, with a toast).
 *  It sits on the header's right with the other controls, Run now as a ▶ (its name in its label) so the header's
 *  name and folder keep their room; as the column narrows "Autopilot" goes while on (under 42rem: the green switch
 *  and its next run say it), then what it waits for (under 32rem); off, "Autopilot" stays down to 30rem. On a phone the switch alone, on a round pill as tall as the header's buttons: Run now is in its
 *  ⋯. "Write a heartbeat" after it while on with its heartbeat still empty. The Assistant's tab only, in every space
 *  on every machine (another machine's is switched and woken there). */
function AutopilotHeader({ place }: { place: Place }) {
  const a = place.pilot
  const phone = useUI((u) => u.device === 'phone')
  const other = useUI((u) => !!u.term?.startsWith('t:'))
  const [want, setWant] = useState<boolean | null>(null)
  const { running, busy, run } = useRunNow(place)
  const [, setNow] = useState(0)
  // "Next in 7 min" counts down, "Next 10:00" becomes a weekday further off than a day: looked at again each 15 s
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (want !== null && a?.on === want) setWant(null)
  }, [a?.on, want])
  if (!a || other || !has('autopilot')) return null
  const on = want ?? a.on
  const shown = want === null ? a : { ...a, on, ...(on ? {} : { next_run: null, pending: false, inflight: false }) }
  const flip = async () => {
    if (want !== null) return
    const next = !on
    setWant(next)
    try {
      const r = await act({ type: 'mode', place: place.id, mode: next ? 'autopilot' : 'regular' })
      if (r.error) throw new Error(r.error)
    } catch (e) {
      setWant(null)
      failed(`Autopilot didn't turn ${next ? 'on' : 'off'}`)(e as Error)
    }
  }
  const heartbeat =
    on && a.blank ? (
      <button type="button" onClick={() => openAutopilot(place)} className="press-dim shrink-0 text-[0.8125rem] whitespace-nowrap text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
        Write a heartbeat
      </button>
    ) : null
  if (phone)
    return (
      <div data-autopilot className="flex h-11 shrink-0 items-center rounded-full bg-bubble px-2">
        <Switch label={AP.TITLE} on={on} onChange={() => void flip()} />
      </div>
    )
  return (
    <>
      <div data-autopilot className={clsx('flex h-8 shrink-0 items-center gap-2 rounded-full bg-hover p-0.5 pl-1.5 text-[0.8125rem] coarse:h-10', !(on && want === null) && 'pr-1.5 @min-[30rem]/place:pr-3')}>
        <Switch label={AP.TITLE} on={on} onChange={() => void flip()} />
        <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => void flip()} className={clsx('shrink-0 font-medium', on ? 'text-fg @max-[42rem]/place:hidden' : 'text-fg2 @max-[30rem]/place:hidden')}>
          {AP.TITLE}
        </button>
        {on ? (
          <span className={clsx('min-w-0 truncate text-fg3 tabular-nums @max-[32rem]/place:hidden', shown.inflight && 'animate-pulse')}>{running && !shown.pending && !shown.inflight ? 'Queuing…' : AP.headerDetail(shown)}</span>
        ) : null}
        {on && want === null ? (
          <button
            type="button"
            data-run-now
            disabled={busy}
            onClick={() => void run()}
            aria-label="Run Autopilot now"
            className="press-dim relative grid size-7 shrink-0 place-items-center rounded-full text-fg2 coarse:size-9 enabled:hover:bg-seg-on enabled:hover:text-fg enabled:hover:shadow-[0_0_0_1px_var(--line2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-default disabled:opacity-50"
          >
            <PlayIcon aria-hidden className="size-3.5 shrink-0" />
            <span aria-hidden className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden" />
          </button>
        ) : null}
      </div>
      {heartbeat}
    </>
  )
}

/** On a phone, Run now is the shown tab's first item in ⋯ while Autopilot is on (the header has the switch alone) */
function PhoneRunNow({ place }: { place: Place }) {
  const phone = useUI((u) => u.device === 'phone')
  const other = useUI((u) => !!u.term?.startsWith('t:'))
  const { running, busy, run } = useRunNow(place)
  const a = place.pilot
  if (!phone || other || !a?.on || !has('autopilot')) return null
  return (
    <MenuItem
      icon={<PlayIcon aria-hidden className="size-4" />}
      disabled={busy}
      hint={running && !a.pending && !a.inflight ? 'Queuing…' : AP.headerDetail(a)}
      className="disabled:opacity-50"
      onClick={() => {
        void run()
        setUI({ menu: false })
      }}
    >
      Run Autopilot now
    </MenuItem>
  )
}

/** The pane header's status (3.0's): a spinner while its agent works, "Needs you" while it waits on you, a dot once done */
function Spin({ className }: { className?: string }) {
  return (
    <svg role="img" aria-label="Working" viewBox="0 0 16 16" className={clsx('size-3 shrink-0 animate-spin text-work motion-reduce:animate-none', className)}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** what the shown tab of a space is: its Assistant's, or another (ui.term t:<address>) */
function shownTab(place: Place, term: string | null) {
  return term?.startsWith('t:') ? (place.tabs ?? []).find((t) => t.term === term) ?? null : null
}

/** The pane header's status, in words: "Working…" with its spinner while its agent works, "Needs you" while it waits
 *  on you, nothing at rest (idle or done is the normal state). Never a control: ending or closing is the tab's (its ×
 *  and its menu in the tab bar). */
function StatusMark({ place }: { place: Place }) {
  const term = useUI((u) => u.term)
  // a phone's header is the window's narrow pane: only the switch shows there
  const phone = useUI((u) => u.device === 'phone')
  const tab = shownTab(place, term)
  if (phone) return null
  const state: TabState = tab ? tab.state ?? 'idle' : place.assistantTab?.state ?? (place.status === 'need' ? 'blocked' : place.status === 'work' ? 'working' : 'idle')
  if (state === 'working')
    return (
      <span role="status" className="flex h-8 shrink-0 items-center gap-1.5 text-[0.8125rem] text-fg2">
        <Spin />
        <span className="whitespace-nowrap @max-[34rem]/place:sr-only">Working…</span>
      </span>
    )
  if (state === 'blocked')
    return (
      <span role="status" className="inline-flex h-6 shrink-0 items-center rounded-full bg-need/15 px-2 text-[0.75rem] font-semibold whitespace-nowrap text-need-fg">
        Needs you
      </span>
    )
  return null
}

/* ---------- the tab bar's + (3.0's new-menu) ---------- */

type Agent = { kind: string; name: string; installed: boolean }

/** the agents the space's machine has, looked up as a menu opens (the window's knownAgents) */
function useAgents(place: Place) {
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    act({ type: 'tab-agents', place: place.id } as never).then((r: { agents?: Agent[] }) => setAgents(r.agents ?? []), () => setFailed(true))
  }, [place.id])
  return { agents, failed }
}

/** keys a menu answers while it is open, as the window's (C, 1 to 9): before the app's own */
function useMenuKeys(on: (key: string) => boolean) {
  const f = useRef(on)
  f.current = on
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement | null)?.matches?.('input, textarea, select')) return
      if (!f.current(e.key)) return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    addEventListener('keydown', down, true)
    return () => removeEventListener('keydown', down, true)
  }, [])
}

/** whether the space has its Assistant's tab: the + menu's row goes to it */
const assistantOpen = (p: Place) => !!(p.assistantTab?.id || p.assistantTab?.live)

/** a menu's quiet line while it looks something up */
const Quiet = ({ children }: { children: ReactNode }) => <div className="px-2 py-1.5 pl-8 text-fg3 phone:px-3 phone:pl-10">{children}</div>

/** 3.0's + menu (core/menus.js NEW_MENU): Terminal; the Assistant (Show Assistant once the space has its tab; on another
 *  machine's space it runs there); Start an agent: the installed ones (1 to 9), then up to two that aren't ("Not
 *  installed"); then New space, New worktree…, Open worktree… */
function PlusItems({ place, done }: { place: Place; done: () => void }) {
  const { agents, failed: off } = useAgents(place)
  const row = MN.assistantRow({ open: assistantOpen(place) })
  // C and 1–9 pick from the keys: their hints only where there are keys ("Not installed" always)
  const keys = useUI((u) => u.device === 'desktop' || u.kb)
  const choices: Agent[] = MN.agentChoices(agents ?? [])
  const installed = choices.filter((a) => a.installed)
  const newTab = (kind?: string) => {
    done()
    void act({ type: 'tab-new', place: place.id, ...(kind ? { kind } : {}) } as never).catch(failed("The tab didn't open"))
  }
  // the space's Assistant is its chat: shown here (the window's opens its tab; its chat starts it on the first message)
  const assistant = () => {
    done()
    setUI({ term: null, arts: null })
  }
  useMenuKeys((k) => {
    if (k.toLowerCase() === 'c' && row.enabled) return assistant(), true
    const a = /^[1-9]$/.test(k) ? installed[Number(k) - 1] : null
    return a ? (newTab(a.kind), true) : false
  })
  const N = MN.NEW_MENU
  return (
    <>
      <MenuItem icon={<TermIcon className={ic} />} onClick={() => newTab()}>{N.terminal}</MenuItem>
      <MenuItem icon={<ModelIcon className={ic} />} disabled={!row.enabled} hint={(keys && row.hint) || undefined} onClick={assistant} className="disabled:text-fg3">
        {row.label}
      </MenuItem>
      <MenuLabel>{N.agents}</MenuLabel>
      {choices.map((a, i) => (
        <MenuItem key={a.kind} icon={<ModelIcon className={ic} />} disabled={!a.installed} hint={(a.installed && !keys ? '' : MN.agentHint(a, i)) || undefined} onClick={() => newTab(a.kind)} className="disabled:text-fg3">
          {a.name}
        </MenuItem>
      ))}
      {choices.length ? null : <Quiet>{off ? N.failed : N.loading}</Quiet>}
      <MenuSeparator />
      <MenuItem icon={<PlusIcon className={ic} />} onClick={() => { done(); openAddSpace(place.machine) }}>{N.space}</MenuItem>
      <MenuItem icon={<SplitIcon className={ic} />} onClick={() => { done(); openWorktree({ place: place.id, name: place.name, op: 'new' }) }}>{N.worktreeNew}</MenuItem>
      <MenuItem icon={<SplitIcon className={ic} />} onClick={() => { done(); openWorktree({ place: place.id, name: place.name, op: 'open' }) }}>{N.worktreeOpen}</MenuItem>
    </>
  )
}

/** the tab bar's + (a desktop's or tablet's; a phone has its items in the header's ⋯ menu) */
function PlusButton({ place }: { place: Place }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <IconButton label="New tab" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <PlusIcon className={ic} />
      </IconButton>
      {open ? (
        <Menu label="New tab" onClose={() => setOpen(false)} className="absolute top-full right-0 z-21 mt-1.5 w-60 origin-top-right">
          <PlusItems place={place} done={() => setOpen(false)} />
        </Menu>
      ) : null}
    </div>
  )
}

/* ---------- the tab bar's tabs (3.0's tabs-tasks) ---------- */

/** a tab of the bar: the Assistant's (its chat; term null) or another (its terminal, t:<address>) */
interface BarTab {
  key: string
  id?: string
  name: string
  named: boolean
  state: TabState
  /** the known agent it runs (knownAgents' key), none for a shell */
  agent?: string
  assistant: boolean
  term: string | null
  /** on another machine: its agent restarts and switches from that machine's window only */
  remote: boolean
}

function barTabs(snap: Snapshot, place: Place): BarTab[] {
  const a = place.assistantTab
  return [
    { key: place.chat, id: a?.id, name: a?.name ?? 'Assistant', named: !!a?.named, state: a?.state ?? 'idle', agent: a?.agent ?? a?.cli, assistant: true, term: null, remote: place.machine !== snap.host },
    ...(place.tabs ?? []).map((t: PlaceTab) => ({ key: t.term, id: t.id, name: t.name, named: !!t.named, state: t.state ?? 'idle', agent: t.agent ?? t.cli, assistant: false, term: t.term, remote: t.term.slice(2).includes('/') })),
  ]
}

/** a tab's counts (3.0's): the Assistant's has what needs you in its space and its Ready tasks; another its own agent
 *  waiting on you */
function countsOf(snap: Snapshot, place: Place, t: BarTab) {
  return t.assistant ? attentionCounts(snap, [place.id]) : { need: t.state === 'blocked' ? 1 : 0, ready: 0 }
}

/** shows a tab: the Assistant's chat (as it was, chat or terminal), or another's terminal */
function showTab(t: BarTab) {
  setUI((ui) => (t.term ? { term: t.term, arts: null, menu: false, plus: null, pick: null } : ui.term?.startsWith('t:') ? { term: null, arts: null, menu: false } : {}))
}

/* the tab menu, open at a point (right-click), or under the shown tab's ⋯ on a touch screen */
type MenuAt = { place: string; key: string; x: number; y: number }
let menuAt: MenuAt | null = null
const menuListeners = new Set<() => void>()
const openTabMenu = (m: MenuAt | null) => { menuAt = m; menuListeners.forEach((f) => f()) }

function Tab({ place, t, on, i, drag }: { place: Place; t: BarTab; on: boolean; i: number; drag: { current: number | null } }) {
  const snap = useSnap()!
  const counts = countsOf(snap, place, t)
  // Settings › Window's Red and Green counts off: none (a waiting agent's dot shows instead)
  const need = snap.look?.red === false ? 0 : counts.need, ready = snap.look?.green === false ? 0 : counts.ready
  const menu = (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    openTabMenu({ place: place.id, key: t.key, x: e.type === 'contextmenu' && e.clientX ? e.clientX : r.left, y: e.type === 'contextmenu' && e.clientY ? e.clientY : r.bottom + 6 })
  }
  // a tab pressed on one and let go on another moves there (Herdr's tab.move: its place from 1)
  const drop = () => {
    const from = drag.current
    drag.current = null
    const tabs = barTabs(snap, place)
    if (from === null || from === i || !tabs[from]?.id) return
    void act({ type: 'tab-move', tab: tabs[from].id, index: i + 1 } as never).catch(failed("The tab didn't move"))
  }
  return (
    <div
      role="tab"
      aria-selected={on}
      tabIndex={on ? 0 : -1}
      data-tab={t.key}
      onPointerDown={(e) => { if (e.button === 0) drag.current = i }}
      onPointerUp={(e) => { if (e.button === 0) drop() }}
      onClick={() => showTab(t)}
      onDoubleClick={() => openTabRename({ place: place.id, key: t.key })}
      onContextMenu={menu}
      onKeyDown={(e) => {
        if (e.key === 'F2') { e.preventDefault(); openTabRename({ place: place.id, key: t.key }) }
        else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) menu(e as unknown as ReactMouseEvent)
      }}
      className={clsx(
        'press-dim flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] whitespace-nowrap select-none coarse:h-9',
        on ? 'bg-seg-on text-fg shadow-[0_0_0_1px_var(--line2)]' : 'text-fg2 hover:bg-hover hover:text-fg',
      )}
    >
      {t.agent ? <ModelIcon className={clsx(ic, 'text-fg3')} /> : t.assistant ? null : <TermIcon className={clsx(ic, 'text-fg3')} />}
      <span className="max-w-[170px] truncate">{t.name}</span>
      {t.state === 'working' ? <Spin /> : null}
      {need || ready ? <AttentionBadge need={need} ready={ready} scope={t.name} /> : t.state === 'blocked' || t.state === 'done' ? <Dot s={t.state === 'blocked' ? 'need' : 'done'} className="shrink-0" /> : null}
      {on ? (
        <>
          {/* a touch screen has no right-click: the shown tab's menu is here */}
          <button type="button" aria-label="Tab menu" onPointerDown={(e) => e.stopPropagation()} onClick={menu} className="-mr-1 hidden size-6 place-items-center rounded-full text-fg3 hover:text-fg coarse:grid">
            <MoreIcon className="size-3.5" />
          </button>
          <button type="button" aria-label={MN.tabMenu().at(-1).label} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void closeTab(snap, place, t) }} className="-mr-1 grid size-5 place-items-center rounded-full text-fg3 hover:bg-hover hover:text-fg coarse:size-6">
            <XIcon className="size-3" />
          </button>
        </>
      ) : null}
    </div>
  )
}

/** 3.0's side panels' buttons, one style for all: the icon, its word where the bar has room (the open one keeps it),
 *  a count after it (Tasks': what needs you and what is Ready, everywhere). The open one pressed again hides it. */
type Panel = 'files' | 'changes' | 'tasks' | 'artifacts'

function PanelButton({ place, id, label, Icon, roomy, badge }: { place: Place; id: Panel; label: string; Icon: (p: { className?: string }) => ReactNode; roomy: boolean; badge?: ReactNode }) {
  const on = useUI((u) => u.side === id && !u.sideShut)
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={() => {
        setUI(on ? { sideShut: true } : { side: id, sideShut: false })
        panels.save(place.id, on ? null : id)
      }}
      className={clsx('press-dim flex h-7 shrink-0 items-center gap-1.5 rounded-full pl-2 text-[0.8125rem] coarse:h-9', roomy || on || badge ? 'pr-2.5' : 'pr-2', on ? 'bg-sel text-fg' : 'text-fg2 hover:bg-hover hover:text-fg')}
    >
      <Icon className={ic} />
      {roomy || on ? <span>{label}</span> : null}
      {badge}
    </button>
  )
}

/** the side panel each space had open (null: none), remembered on this device as the window remembers it per space */
const panels = {
  KEY: 'shepherdr.panels',
  all(): Record<string, Panel | null> {
    try { return JSON.parse(localStorage.getItem(this.KEY) ?? '{}') ?? {} } catch { return {} }
  },
  save(place: string, side: Panel | null) {
    try { localStorage.setItem(this.KEY, JSON.stringify({ ...this.all(), [place]: side })) } catch { /* private window: this time only */ }
  },
}

/** the Tasks button's count: everything that needs you and every Ready task, as the window's */
function TasksCount() {
  const snap = useSnap()!
  const ready = snap.tasks.filter((t) => !t.archived && t.status === 'ready').length
  return <AttentionBadge need={snap.needs.length} ready={ready} scope="everywhere" />
}

/** 3.0's tab bar, over the middle on a desktop and a tablet: the tabs (Settings › Window › Show tabs off: none), +, and
 *  the side panels' buttons. The window's minimize, maximize and close are the browser's. */
function TabBar({ place }: { place: Place }) {
  const snap = useSnap()!
  const term = useUI((u) => u.term)
  const shownTabs = useStore((s) => s.snap?.look?.tabs !== false)
  const bar = useRef<HTMLDivElement>(null)
  const drag = useRef<number | null>(null)
  const [roomy, setRoomy] = useState(false)
  // the words show where the bar is as wide as 3.0's needs (1100px, the panels' column with it)
  useEffect(() => {
    const el = bar.current
    if (!el) return
    const ro = new ResizeObserver(() => setRoomy(innerWidth - el.getBoundingClientRect().left >= 1100))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // switching spaces shows the side panel that space had open (one it never chose keeps what shows)
  useEffect(() => {
    const all = panels.all()
    if (!(place.id in all)) return
    const want = all[place.id]
    if ((want === 'artifacts' && !registry.views.artifacts) || ((want === 'files' || want === 'changes') && !(getState().snap?.panels ?? []).includes(want))) return
    setUI(want ? { side: want, sideShut: false } : { sideShut: true })
  }, [place.id])
  const herdr = snap.panels ?? ['files', 'changes']
  // the app menu (the window's, where no tab is under the pointer): New space, Keybinds
  const appMenu = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest('[role=tab], button')) return
    e.preventDefault()
    openTabMenu({ place: place.id, key: APP, x: e.clientX, y: e.clientY })
  }
  const tabs = barTabs(snap, place)
  const shown = tabs.find((t) => t.term && t.term === term) ?? tabs[0]
  // the wheel goes to the next tab or the one before, as the window's bar
  const wheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) < 1 || Math.abs(e.deltaY) < Math.abs(e.deltaX) || !shownTabs) return
    const i = tabs.indexOf(shown) + (e.deltaY > 0 ? 1 : -1)
    if (tabs[i]) showTab(tabs[i])
  }
  return (
    <div ref={bar} data-chrome data-tabbar onWheel={wheel} onContextMenu={appMenu} onPointerUp={() => setTimeout(() => (drag.current = null))} className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-well px-2.5 coarse:h-13">
      <div role="tablist" aria-label="Tabs" className="scroll-x flex min-w-0 flex-1 items-center gap-1 py-1">
        {shownTabs ? tabs.map((t, i) => <Tab key={t.key} place={place} t={t} i={i} on={t === shown} drag={drag} />) : null}
      </div>
      <PlusButton place={place} />
      {/* Herdr's own Files and Changes, the shown space's folder (as shared "workspace.panels" has them) */}
      {herdr.includes('files') ? <PanelButton place={place} id="files" label="Files" Icon={FolderIcon} roomy={roomy} /> : null}
      {herdr.includes('changes') ? <PanelButton place={place} id="changes" label="Changes" Icon={DiffIcon} roomy={roomy} /> : null}
      <PanelButton place={place} id="tasks" label="Tasks" Icon={TasksIcon} roomy={roomy} badge={<TasksCount />} />
      {registry.views.artifacts ? <PanelButton place={place} id="artifacts" label="Artifacts" Icon={PageIcon} roomy={roomy} /> : null}
    </div>
  )
}

/* ---------- a tab's menu (3.0's menu-tasks: core/menus.js tabMenu) ---------- */

const MENU_ICONS: Record<string, (p: { className?: string }) => ReactNode> = { 'square-pen': RenameIcon, 'file-text': PlanIcon, 'arrow-left-right': ModelIcon, 'rotate-ccw': RestartIcon, x: XIcon }

/** Rename…, Edit instructions… (an Assistant's), Switch agent ›, Restart, Close tab; Switch agent opens its list in
 *  the menu's place */
export function TabMenuItems({ place, tab, close }: { place: Place; tab: BarTab; close: () => void }) {
  const snap = useSnap()!
  const { agents } = useAgents(place)
  const [sub, setSub] = useState(false)
  // 1–9 pick an agent from the keys: their hints only where there are keys
  const keys = useUI((u) => u.device === 'desktop' || u.kb)
  const installed = (agents ?? []).filter((a) => a.installed)
  const chat = tab.term ?? place.chat
  // an agent runs in it, on this machine (the window restarts through this machine's core)
  const agent = !tab.remote && (tab.assistant ? !!place.assistantTab?.live : !!tab.agent)
  const items = MN.tabMenu({ assistant: tab.assistant, switchable: agent && installed.length > 0, restartable: agent })
  // Restart, and Switch agent, as the window's (restart.sh): at once, in its tab; as it runs now (an Assistant from
  // its template again, so edited instructions apply), or as the agent picked
  const restartAs = (kind?: string) => {
    close()
    void act({ type: 'tab-switch', chat, ...(kind ? { kind } : {}) } as never)
      .then((r: { error?: string }) => { if (r.error) throw new Error(r.error) })
      .catch(failed("It didn't restart"))
  }
  const restart = () => restartAs()
  const pick = (a: Agent) => {
    if (a.kind === tab.agent) return close()
    restartAs(a.kind)
  }
  useMenuKeys((k) => {
    const a = sub && /^[1-9]$/.test(k) ? installed[Number(k) - 1] : null
    return a ? (pick(a), true) : false
  })
  if (sub) {
    const S = MN.SWITCH_AGENT
    return (
      <>
        <MenuLabel>{S.title}</MenuLabel>
        {agents === null ? <Quiet>{S.loading}</Quiet> : installed.map((a, i) => {
          const on = a.kind === tab.agent
          return (
            <MenuItem key={a.kind} icon={<ModelIcon className={ic} />} disabled={on} hint={on ? S.current : keys && i < 9 ? String(i + 1) : undefined} onClick={() => pick(a)} className="disabled:text-fg3">
              {a.name}
            </MenuItem>
          )
        })}
      </>
    )
  }
  const acts: Record<string, () => void> = {
    rename: () => { close(); openTabRename({ place: place.id, key: tab.key }) },
    instructions: () => { close(); openRole({ kind: 'file', role: 'coordinator', title: 'What every Assistant is told first', file: 'assistant.md' }) },
    switch: () => setSub(true),
    restart,
    close: () => { close(); void closeTab(snap, place, tab) },
  }
  return (
    <>
      {(items as { id?: string; label?: string; icon?: string; sep?: boolean; submenu?: boolean }[]).map((it, i) => {
        if (it.sep) return <MenuSeparator key={`sep${i}`} />
        const Icon = MENU_ICONS[it.icon ?? '']
        return (
          <MenuItem key={it.id} icon={Icon ? <Icon className={ic} /> : undefined} hint={it.submenu ? '›' : undefined} onClick={acts[it.id!]}>
            {it.label}
          </MenuItem>
        )
      })}
    </>
  )
}

/** the tab menu where it was opened (a right-click, or the shown tab's ⋯) */
function TabMenu() {
  const at = useSyncExternalStore((f) => (menuListeners.add(f), () => void menuListeners.delete(f)), () => menuAt)
  const snap = useSnap()
  const place = at && snap?.places.find((p) => p.id === at.place)
  const tab = place && barTabs(snap!, place).find((t) => t.key === at!.key)
  if (!at || !place || (!tab && at.key !== APP)) return null
  const close = () => openTabMenu(null)
  return (
    <div className="fixed z-30" style={{ left: Math.max(8, Math.min(at.x, innerWidth - 248)), top: Math.max(8, Math.min(at.y, innerHeight - 240)) }}>
      <Menu label={tab?.name ?? 'Menu'} onClose={close} className="w-60">
        {tab ? <TabMenuItems place={place} tab={tab} close={close} /> : <AppMenuItems place={place} close={close} />}
      </Menu>
    </div>
  )
}

/** the app menu's key in the tab menu's place */
const APP = '#app'

/** 3.0's app menu (core/menus.js appMenu): New space on the shown space's machine, Keybinds. Its themes are Herdr's
 *  own, the window's look: the web follows the device's light or dark. */
function AppMenuItems({ place, close }: { place: Place; close: () => void }) {
  const ICONS: Record<string, (p: { className?: string }) => ReactNode> = { plus: PlusIcon, keyboard: KeyboardIcon }
  const acts: Record<string, () => void> = { 'new-space': () => openAddSpace(place.machine), keybinds: () => openKeybinds() }
  const items = (MN.appMenu() as { id?: string; label?: string; icon?: string; sep?: boolean; window?: boolean }[]).filter((it) => !it.window)
  return (
    <>
      {items.map((it, i) => {
        if (it.sep) return i && i < items.length - 1 ? <MenuSeparator key={`sep${i}`} /> : null
        const Icon = ICONS[it.icon ?? '']
        return (
          <MenuItem key={it.id} icon={Icon ? <Icon className={ic} /> : undefined} onClick={() => { close(); acts[it.id!]?.() }}>
            {it.label}
          </MenuItem>
        )
      })}
    </>
  )
}

/* ---------- Files and Changes: Herdr's own panels, for the shown space's folder ---------- */

/** Files: the space's folder, one folder at a time, each changed file's letter, a file in place of the list; Changes:
 *  its uncommitted changes against HEAD, a file's diff under them, and Herdr's commit box. The task view's views
 *  (web/plugins/worktree), asked of the space's folder (service: /api/worktree?space=). */
function SpacePanel({ place, what }: { place: Place; what: 'files' | 'changes' }) {
  const source = { id: `space:${place.id}` } as Task
  if (what === 'files') return <FilesView key={place.id} task={source} />
  return (
    <>
      <DiffView key={place.id} task={source} />
      <Commit place={place} />
    </>
  )
}

/** Herdr's Changes' commit box: "Commit message", Commit (everything, git add -A), "Commit failed: …" */
function Commit({ place }: { place: Place }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  useEffect(() => { setMessage(''); setNote('') }, [place.id])
  const go = async () => {
    if (!message.trim() || busy) return
    setBusy(true); setNote('')
    try {
      const r = (await act({ type: 'space-commit', place: place.id, message } as never)) as { error?: string }
      if (r.error) throw new Error(r.error)
      setMessage('')
    } catch (e) {
      const m = (e as Error).message
      setNote(m.startsWith('Commit failed') ? m : `Commit failed: ${m}`)
    } finally { setBusy(false) }
  }
  return (
    <>
      {note ? <p role="alert" className="px-3 pb-2 text-[0.75rem] text-need-fg">{note}</p> : null}
      <div className="flex shrink-0 items-center gap-2 border-t border-line p-2.5">
        <input value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void go()} placeholder="Commit message" aria-label="Commit message"
          className={`${field} h-8 min-w-0 flex-1 rounded-full bg-bg px-3 text-[0.8125rem] coarse:h-11`} />
        <Primary disabled={!message.trim() || busy} onClick={() => void go()}>{busy ? 'Committing…' : 'Commit'}</Primary>
      </div>
    </>
  )
}

/** On a phone, the header's ⋯ has the shown tab's menu, then the + menu's items */
function PhoneTabItems({ place }: { place: Place }) {
  const phone = useUI((u) => u.device === 'phone')
  const term = useUI((u) => u.term)
  const snap = useSnap()!
  if (!phone) return null
  const tabs = barTabs(snap, place)
  const tab = tabs.find((t) => t.term && t.term === term) ?? tabs[0]
  const close = () => setUI({ menu: false })
  return (
    <>
      <PhoneRunNow place={place} />
      <TabMenuItems place={place} tab={tab} close={close} />
      <MenuSeparator />
      <PlusItems place={place} done={close} />
    </>
  )
}

/** Closes a tab, as the window's: an Assistant with workers running asks what becomes of them; a space's last tab
 *  closes the space, so it asks as Close… does */
async function closeTab(snap: Snapshot, place: Place, tab: BarTab) {
  const many = barTabs(snap, place).filter((t) => !t.assistant || assistantOpen(place)).length > 1
  try {
    if (tab.assistant && place.assistantTab?.live) {
      const r = (await act({ type: 'assistant-close', place: place.id, mode: 'count' } as never)) as { workers?: number; error?: string }
      if (r.error) throw new Error(r.error)
      if (r.workers) return openClose(place)
      if (!many) return openCloseSpace(place)
      const done = (await act({ type: 'assistant-close', place: place.id, mode: 'keep' } as never)) as { error?: string }
      if (done.error) throw new Error(done.error)
      return
    }
    if (!many) return openCloseSpace(place)
    if (!tab.id) throw new Error('Close it in the Herdr window.')
    const r = (await act({ type: 'tab-close', tab: tab.id } as never)) as { error?: string }
    if (r.error) throw new Error(r.error)
    if (tab.term && getState().ui.term === tab.term) setUI({ term: null })
  } catch (e) {
    failed("The tab didn't close")(e as Error)
  }
}

/* ---------- Rename tab (the window's prompt: core/confirm.js RENAME_TAB) ---------- */

let renaming: { place: string; key: string } | null = null
const renameListeners = new Set<() => void>()
const openTabRename = (p: { place: string; key: string } | null) => { renaming = p; renameListeners.forEach((f) => f()) }

/** Rename tab: the field holds the name given, empty when nobody named it (its name the placeholder); saving it empty
 *  unnames it again */
function TabRename() {
  const at = useSyncExternalStore((f) => (renameListeners.add(f), () => void renameListeners.delete(f)), () => renaming)
  const snap = useSnap()
  const place = at && snap?.places.find((p) => p.id === at.place)
  const tab = place && barTabs(snap!, place).find((t) => t.key === at!.key)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setName(tab?.named ? tab.name : ''); setBusy(false); setError('') }, [at]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!at || !place || !tab) return null
  const save = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const r = (await act({ type: 'tab-rename', ...(tab.id ? { tab: tab.id } : { place: place.id }), name: name.trim() } as never)) as { error?: string }
      if (r.error) throw new Error(r.error)
      openTabRename(null)
    } catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return (
    <Dialog title={CF.RENAME_TAB.title} onCancel={() => openTabRename(null)} buttons={<Primary disabled={busy} onClick={() => void save()}>{CF.RENAME_TAB.verb}</Primary>}>
      <label htmlFor="rename-tab" className="mt-2 mb-1 block text-xs text-fg3">{CF.RENAME_TAB.label}</label>
      <input id="rename-tab" autoFocus onFocus={(e) => e.currentTarget.select()} value={name} placeholder={tab.name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} className={`${field} h-10 w-full rounded-full bg-bg px-3.5`} />
      {error ? <p role="alert" className="mt-2 text-need-fg">{error}</p> : null}
    </Dialog>
  )
}

/* ---------- Close a space (its last tab's ×: core/confirm.js CLOSE_SPACE) ---------- */

let closingSpace: Place | null = null
const spaceListeners = new Set<() => void>()
const openCloseSpace = (p: Place | null) => { closingSpace = p; spaceListeners.forEach((f) => f()) }

function CloseSpace() {
  const place = useSyncExternalStore((f) => (spaceListeners.add(f), () => void spaceListeners.delete(f)), () => closingSpace)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setBusy(false); setError('') }, [place])
  if (!place) return null
  const go = async () => {
    setBusy(true); setError('')
    const r = await removeSpace(place.id).catch((e: Error) => ({ error: e.message }))
    if (r.error) { setError(r.error); setBusy(false) } else openCloseSpace(null)
  }
  return (
    <Dialog title={CF.CLOSE_SPACE.title(place.name)} onCancel={() => openCloseSpace(null)} buttons={<Primary disabled={busy} onClick={() => void go()}>{CF.CLOSE_SPACE.verb}</Primary>}>
      <p className="text-fg2">{CF.CLOSE_SPACE.detail}</p>
      {error ? <p role="alert" className="mt-2 text-need-fg">{error}</p> : null}
    </Dialog>
  )
}

let closing: Place | null = null
const closeListeners = new Set<() => void>()
const openClose = (p: Place | null) => { closing = p; closeListeners.forEach((f) => f()) }

/** Close the Assistant? With workers running: stop them, or let them finish on their own */
function CloseAssistant() {
  const place = useSyncExternalStore((f) => (closeListeners.add(f), () => void closeListeners.delete(f)), () => closing)
  const [workers, setWorkers] = useState<number | null>(null)
  const [stop, setStop] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setWorkers(null); setStop(true); setBusy(false); setError('')
    if (place) act({ type: 'assistant-close', place: place.id, mode: 'count' } as never).then((r: { workers?: number; error?: string }) => (r.error ? setError(r.error) : setWorkers(r.workers ?? 0)), (e: Error) => setError(e.message))
  }, [place])
  if (!place) return null
  const go = async () => {
    setBusy(true); setError('')
    try { await act({ type: 'assistant-close', place: place.id, mode: stop ? 'stop' : 'keep' } as never); openClose(null) }
    catch (e) { setError((e as Error).message); setBusy(false) }
  }
  const choice = (on: boolean, title: string, detail: string, pick: () => void) => (
    <button type="button" role="radio" aria-checked={on} onClick={pick} className="press flex w-full items-start gap-2.5 rounded-row px-2 py-2 text-left hover:bg-hover">
      <span aria-hidden="true" className={clsx('mt-0.5 size-4 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_var(--fg3)]', on && 'shadow-[inset_0_0_0_5px_var(--fg)]')} />
      <span><span className="block font-medium">{title}</span><span className="block text-[0.8125rem] text-fg2">{detail}</span></span>
    </button>
  )
  return (
    <Dialog title="Close the Assistant?" onCancel={() => openClose(null)} safe
      buttons={<Primary disabled={busy || workers === null} onClick={() => void go()}>{busy ? 'Closing…' : 'Close Assistant'}</Primary>}>
      <div className="flex flex-col gap-2 text-pretty">
        <p className="text-fg2">{workers === null ? (error ? '' : 'Reading…') : workers ? `It has ${workers} worker${workers > 1 ? 's' : ''} running. Their branches and worktrees stay either way.` : 'It has no workers running.'}</p>
        {workers ? (
          <div role="radiogroup" aria-label="Its workers" className="flex flex-col">
            {choice(stop, 'Stop its workers', 'Ends the agents it started and closes their tabs.', () => setStop(true))}
            {choice(!stop, 'Let them finish', 'Workers keep running in their own tabs, on their own.', () => setStop(false))}
          </div>
        ) : null}
        {error ? <p role="alert" className="text-need-fg">{error}</p> : null}
      </div>
    </Dialog>
  )
}

export default definePlugin({
  name: 'coordinators',
  setup(reg) {
    // the pane header: the name and folder on the left; on the right, in one row of 32px controls, the status in words,
    // the Autopilot pill and (the terminal plugin's, order 15) Chat | Terminal
    reg.placeHeader.push({ order: 12, View: StatusMark }, { order: 14, View: AutopilotHeader })
    reg.views.tabBar = TabBar
    reg.views.spacePanel = SpacePanel
    reg.overlays.push(CloseAssistant, TabRename, TabMenu, CloseSpace)
    reg.placeMenu.push({ order: 80, View: PhoneTabItems, joined: true })
  },
})
