// The sidebar's spaces, as 3.0's (mods/spaces-chat main.js; docs/parity/sidebar.md lists each element): a "Spaces"
// heading with its + (New space or section on the shown space's machine), Pinned (while it holds any), then each
// machine: its header (its emoji, a monitor for this computer or a server; its name; connected: its +, its meter and a
// red dot when its health couldn't be read; not: "Offline" or "Connecting…", dimmed and folded until tapped open), its
// spaces in no section, then its sections. A space's row: its # (or emoji), its name (bold while its Assistant has
// something new, dimmed with a crossed-out bell when muted), after it only what's unusual (its machine in Pinned, its
// folder where another space there has its name, its repo and branch), and its red and green counts.
// Worktree spaces nest under their repo's own. A folded section (Pinned too) still shows the space you're in and its
// unread ones, and adds up its counts on its heading. Menus are core/menus.js's, the window's too: a right click (or a
// finger held) opens them, no ⋯ on the rows. Spaces drag among their own, into a section or Pinned, or back to their machine's
// top; machines and sections keep their place. Alt+↑/↓ goes to the space above or below as they show.
import clsx from 'clsx'
import { openWorktree } from '@client/screens/Worktree.tsx'
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type LiHTMLAttributes, type ReactNode } from 'react'
import { act, counts, definePlugin, getState, goPlace, manyMachines, openSplit, placeOf, removeSpace, setUI, splitClick, useSnap, useUI, type Pane, type UI } from '@client/kernel.ts'
import { Dialog, RowMenu, useRowMenu } from '@client/rowmenu.tsx'
import { AutopilotIcon, BackIcon, BellIcon, CogIcon, BellSlashIcon, AttentionBadge, attentionWords, DeleteIcon, DownIcon, HashIcon, ic, IconButton, List, MenuItem, MenuLabel, MenuSeparator, MenuSetting, Meta, ModelIcon, MonitorIcon, NextIcon, PinnedIcon, PinTaskIcon, PlusIcon, Primary, ReadIcon, RemoveProjectIcon, RenameIcon, rowClass, RowText, SectionIcon, ServerIcon, SplitIcon, TasksIcon, UnpinIcon } from '@client/ui.tsx'
import { HealthDot, MachineMeter } from '@plugins/health/client.tsx'
import { toast } from '@plugins/alerts/toasts.tsx'
import { MarkRead, markPlaceRead, muted, placeUnread } from '@client/unread.ts'
import { RestartItem } from '@client/restart.tsx'
import { NOTIFY, NOTIFY_KEY, notifyOf, notifyRow } from '@shared/alerts.ts'
import { kept, PINNED, sectionsIn, TOP, type PlaceOrder } from '@shared/order.ts'
import { machineName, NAME_MAX, nameProblem, slugify, type Machine, type Place, type Section, type Snapshot } from '@shared/types.ts'
import { AddSpace, asTyped, openAddSpace } from './add.tsx'
import { dragging, press } from './drag.ts'
import { openNewSection, openRename, SectionDialogs } from './section.tsx'
import * as MN from '@core/menus.js'
import * as CF from '@core/confirm.js'
import * as SPc from '@core/spaces.js'

/* ---------- folded sections (Pinned, the machines), remembered on this device ---------- */

const KEY = 'shepherdr.folded'
let folded: string[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
})()
const listeners = new Set<() => void>()

function toggleFold(id: string) {
  setFolded(folded.includes(id) ? folded.filter((x) => x !== id) : [...folded, id])
}

/** opens the sections a space sits in, once you go there */
function unfold(ids: string[]) {
  if (ids.some((id) => folded.includes(id))) setFolded(folded.filter((x) => !ids.includes(x)))
}

function setFolded(next: string[]) {
  folded = next
  try {
    localStorage.setItem(KEY, JSON.stringify(folded))
  } catch {
    /* private window: unfolded again next time */
  }
  for (const l of listeners) l()
}

function useFolded() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => folded,
  )
}

/** machines that can't be reached, opened anyway (as the window's: one offline starts folded; a tap opens it for now,
 *  not kept) */
let openedOff: string[] = []
function toggleOff(id: string) {
  openedOff = openedOff.includes(id) ? openedOff.filter((x) => x !== id) : [...openedOff, id]
  for (const l of listeners) l()
}
function useOpenedOff() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => openedOff,
  )
}

/** a machine Shepherdr can't reach (Offline, or Connecting…): no +, no meter, folded until opened */
const offline = (m: Machine) => m.status === 'off' || !!m.connecting

/* ---------- the order you dragged or moved, shown at once until the server's snapshot has it ---------- */

let pending: PlaceOrder = {}
const orderListeners = new Set<() => void>()
function setPending(next: PlaceOrder) {
  pending = next
  for (const l of orderListeners) l()
}

function usePending() {
  return useSyncExternalStore(
    (l) => {
      orderListeners.add(l)
      return () => orderListeners.delete(l)
    },
    () => pending,
  )
}

/** lists shown before the snapshot has them where only what is in them is sure, not where: a space back under its
 *  machine goes where it was, which only the server knows */
const loose = new Set<string[]>()

/** shows these lists at once, and lets each go once the snapshot has it, or the server refused or never answered */
function hold(lists: PlaceOrder, sent: Promise<{ ok?: boolean }>) {
  setPending({ ...pending, ...lists })
  const forget = () => {
    for (const ids of Object.values(lists)) loose.delete(ids)
    setPending(Object.fromEntries(Object.entries(pending).filter(([k, ids]) => lists[k] !== ids)))
  }
  sent.then((r) => r.ok === false && forget(), forget)
  // the snapshot with it comes long before; this only lets go of one that never came
  setTimeout(forget, 10_000)
}

/** keeps a new order: the machines (under 'all'), a machine's spaces (under its id), a section's (under its id), or the
 *  sections at the top (TOP) or in a machine */
function reorder(under: string, ids: string[]) {
  hold({ [under]: ids }, act({ type: 'order', under, ids }))
}

/** a space into a section (PINNED too) or back under its machine (to: its id), before another there or last */
function moveTo(id: string, to: string, before?: string) {
  const lists = { ...listsOf(getState().snap!), ...pending }
  const from = Object.keys(lists).find((k) => groupKey(k) && lists[k].includes(id))
  if (from === to && !before) return
  const next: PlaceOrder = {}
  if (from) next[from] = lists[from].filter((x) => x !== id)
  const there = (next[to] ?? lists[to] ?? []).filter((x) => x !== id)
  const i = before ? there.indexOf(before) : -1
  next[to] = i < 0 ? [...there, id] : [...there.slice(0, i), id, ...there.slice(i)]
  if (to.startsWith('m:') && !before) loose.add(next[to])
  hold(next, act({ type: 'move', id, to, ...(before ? { before } : {}) }))
}

/** where a row can be moved, and Alt+Shift+↑/↓ moving it one step */
interface Sort {
  under: string
  /** its place and its siblings as they show */
  ids: string[]
}

function moveKey(e: ReactKeyboardEvent, id: string, sort: Sort) {
  if (!e.altKey || !e.shiftKey || e.metaKey || e.ctrlKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
  e.preventDefault()
  const i = sort.ids.indexOf(id)
  const j = i + (e.key === 'ArrowUp' ? -1 : 1)
  if (i < 0 || j < 0 || j >= sort.ids.length) return
  const ids = sort.ids.filter((x) => x !== id)
  ids.splice(j, 0, id)
  reorder(sort.under, ids)
}

/* ---------- the tree: sections at the top, then the machines with their spaces and sections ---------- */

/** a list that holds spaces: a section's (its id) or a machine's own (its id, m:<key>) */
const groupKey = (k: string) => k === PINNED || k.startsWith('s:') || k.startsWith('m:')

/** every list of the sidebar as the snapshot has it, by what it is under (shared/order.ts): the machines, the sections
 *  at the top and in each machine, each section's spaces and each machine's own */
function listsOf(snap: Snapshot): PlaceOrder {
  const sections = snap.sections ?? []
  const inside = new Set(sections.flatMap((s) => s.spaces))
  const out: PlaceOrder = { all: (snap.machines ?? []).map((m) => m.id), [TOP]: sections.filter((s) => !s.machine).map((s) => s.id) }
  for (const s of sections) out[s.id] = s.spaces
  for (const m of snap.machines ?? []) {
    out[m.id] = snap.places.filter((p) => p.machine === m.machine && !inside.has(p.id)).map((p) => p.id)
    out[sectionsIn(m.id)] = sections.filter((s) => s.machine === m.machine).map((s) => s.id)
  }
  return out
}

interface Group {
  s: Section
  spaces: Place[]
  shut: boolean
  /** its spaces as they show: none while it or its machine is folded */
  shown: Place[]
}

/** a git branch (the window's branch.svg): a worktree space's icon where it sits under its repo */
function BranchIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className={className}>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5.5" r="1.5" />
      <path d="M4.5 5v6M11.5 7c0 2.5-3 3-7 4" />
    </svg>
  )
}

/** a worktree space's mark (├─ or └─) where it sits under its repo's own space, as the window's sidebar nests them */
const treeMark = new Map<string, string>()
/** a list's spaces with each repo's worktree spaces moved under its own space when both are in it (3.0's order) */
function nest(list: Place[], hide = false, shown: string | null = null): Place[] {
  const mains = new Set(list.filter((p) => p.git === 'main').map((p) => p.repo))
  const nested = (p: Place) => p.git === 'linked' && mains.has(p.repo)
  const out: Place[] = []
  const placed = new Set<string | undefined>()
  for (const p of list) {
    if (nested(p)) continue
    out.push(p)
    treeMark.delete(p.id)
    if (p.git !== 'main' || placed.has(p.repo)) continue
    placed.add(p.repo)
    const kids = list.filter((k) => nested(k) && k.repo === p.repo)
    // Settings › Window › Worktrees in the sidebar off: a repo's worktree spaces aren't listed, but for the one shown
    const listed = kids.filter((k) => !hide || k.id === shown)
    listed.forEach((k, n) => { out.push(k); treeMark.set(k.id, n === listed.length - 1 ? '└─' : '├─') })
  }
  return out
}

/** the sidebar as it shows: the sections at the top (Pinned while it holds any), then each machine with its own spaces
 *  and its sections. A space shows once, where it sits; one just dragged or moved shows there at once. A folded section
 *  hides every space in it, a folded machine its sections too. */
function placeTree(snap: Snapshot, fold: string[], mine: PlaceOrder, opened: string[] = openedOff) {
  const lists = { ...listsOf(snap), ...mine }
  // a folded section (Pinned too) still shows the space you're in and its unread ones, as the window's (and Slack's)
  const here = getState().ui.place
  const stays = (p: Place) => p.id === here || (snap.look?.unread !== false && placeUnread(snap, p))
  const places = new Map(snap.places.map((p) => [p.id, p]))
  const sections = new Map((snap.sections ?? []).map((s) => [s.id, s]))
  const seen = new Set<string>()
  const take = (ids: string[] | undefined, fits: (p: Place) => boolean) =>
    (ids ?? []).flatMap((id) => {
      const p = places.get(id)
      if (!p || seen.has(id) || !fits(p)) return []
      seen.add(id)
      return [p]
    })
  const group = (id: string, out: boolean, fits: (p: Place) => boolean): Group[] => {
    const s = sections.get(id)
    if (!s) return []
    const spaces = nest(take(lists[id], fits), snap.look?.worktrees === false, getState().ui.place)
    const shut = fold.includes(id)
    return [{ s, spaces, shut, shown: out ? [] : shut ? spaces.filter(stays) : spaces }]
  }
  const top = (lists[TOP] ?? []).flatMap((id) => group(id, false, () => true)).filter((g) => g.s.id !== PINNED || g.spaces.length)
  const machines = new Map((snap.machines ?? []).map((m) => [m.id, m]))
  const tree = (lists.all ?? []).flatMap((id) => {
    const m = machines.get(id)
    if (!m) return []
    // one that can't be reached starts folded, and a tap opens it for now (the window's)
    const shut = offline(m) ? !opened.includes(m.id) : fold.includes(m.id)
    const fits = (p: Place) => p.machine === m.machine
    const spaces = nest(take(lists[m.id], fits), snap.look?.worktrees === false, getState().ui.place)
    const inside = (lists[sectionsIn(m.id)] ?? []).flatMap((s) => group(s, shut, fits))
    return [{ m, spaces, shut, shown: shut ? [] : spaces, sections: inside, all: [...spaces, ...inside.flatMap((g) => g.spaces)] }]
  })
  return { top, tree }
}

/** every machine open, the offline ones too */
const allOpen = (snap: Snapshot) => (snap.machines ?? []).map((m) => m.id)

/** the spaces of the sidebar as they show, top to bottom */
function shownIds({ top, tree }: ReturnType<typeof placeTree>) {
  return [...top.flatMap((g) => g.shown), ...tree.flatMap((t) => [...t.shown, ...t.sections.flatMap((g) => g.shown)])].map((p) => p.id)
}

/** the sections a space sits in: its section at the top, or its machine and its section there */
function branchesOf(snap: Snapshot, id: string) {
  const { top, tree } = placeTree(snap, [], pending, allOpen(snap))
  const g = top.find((x) => x.spaces.some((p) => p.id === id))
  if (g) return [g.s.id]
  const t = tree.find((x) => x.all.some((p) => p.id === id))
  if (!t) return []
  return [t.m.id, ...t.sections.filter((x) => x.spaces.some((p) => p.id === id)).map((x) => x.s.id)]
}

/** where a space sits: its section's id, or its machine's */
function groupOf(snap: Snapshot, mine: PlaceOrder, p: Place) {
  const lists = { ...listsOf(snap), ...mine }
  return Object.keys(lists).find((k) => groupKey(k) && lists[k].includes(p.id)) ?? `m:${p.machine}`
}

/** the sections a space may go into, by id: any at the top, its own machine's, its machine (back under it) */
function mayGo(snap: Snapshot, p: Place, group: string) {
  if (group.startsWith('m:')) return group === `m:${p.machine}`
  const s = snap.sections?.find((x) => x.id === group)
  return !!s && (!s.machine || s.machine === p.machine)
}

/* ---------- rows ---------- */

/** the spaces whose name another on their machine has: each shows its folder (core/spaces.js, as the window's rows) */
function sharedNames(snap: Snapshot) {
  return (SPc.sharedNames as (rows: object[]) => Set<string>)(snap.places.map((p) => ({ id: p.id, machine: p.machine, name: p.name, linked: p.git === 'linked' })))
}

/** what every space's row shows, as the window's (mods/spaces-chat main.js row): its name, bold and bright while its
 *  Assistant has something new (unread), bright where it is open; dimmed when muted (Notify: Off), a crossed-out bell
 *  after it, its counts still showing; then what needs you there (red) and its tasks in Ready (green) */
function usePlaceRow({ p, snap, where }: { p: Place; snap: Snapshot; where?: string }) {
  const sel = useUI((u) => u.place === p.id)
  const c = counts(snap, p.id)
  const n = c.own
  // Settings › Window › Bold unread spaces off: nothing bold
  const fresh = placeUnread(snap, p) && snap.look?.unread !== false
  const quiet = muted(snap, p.id)
  const off = p.status === 'off' && !p.connecting
  // its Autopilot (SHEP-5): a small mark before the name while on, pulsing while a wake runs (its turn) or waits for
  // its Assistant; after the name only what's unusual: its machine (in Pinned), its folder where another space on its
  // machine has its name, its repo and branch (core/spaces.js gitTail, as the window's)
  const pilot = !!p.pilot?.on
  const waking = pilot && !!(p.pilot?.inflight || p.pilot?.pending)
  const label = [where, sharedNames(snap).has(p.id) && p.where ? (SPc.tilde as (x: string) => string)(p.where) : null].filter(Boolean).join(' · ') || null
  const tail = p.git ? (SPc.gitTail as (g: object, o: object) => { where: string })({ name: p.gitName, branch: p.branch }, { name: p.name, tree: !!treeMark.get(p.id), tag: label }) : { where: label ?? '' }
  return {
    sel,
    // what the row says aloud, its count and offline too
    said: `${p.name}${where ? ` on ${where}` : ''}${p.home ? ', home space' : ''}${p.connecting ? ', connecting' : off ? ", can't reach" : n ? `, ${c.ownNeed} need you, ${c.ownReady} ready here` : ''}${fresh && !off ? ', unread' : ''}${pilot ? (waking ? ', Autopilot waking' : ', on Autopilot') : ''}${quiet ? ', muted' : ''}`,
    fresh,
    // the Autopilot mark, then the space's # before the name, as Slack's channels have: grey, lit with the name where
    // it is open or something is new
    mark: (
      <>
        <span aria-hidden data-autopilot={pilot || undefined} data-waking={waking || undefined}
          className={clsx('pilot-mark grid size-3.5 shrink-0 place-items-center', !pilot && 'invisible', waking ? 'text-work' : 'text-fg3')}>
          <AutopilotIcon className="size-3" />
        </span>
        {/* Shepherdr 3: a space's own icon (an emoji) where it has one */}
        {treeMark.get(p.id) ? <BranchIcon className={clsx(icon, 'text-fg3')} /> : p.emoji ? <span aria-hidden className={clsx(icon, 'grid place-items-center text-[0.9375rem] leading-none', quiet && 'opacity-50')}>{p.emoji}</span> : <HashIcon className={clsx(icon, fresh ? 'text-fg' : sel && !quiet ? 'text-fg2' : 'text-fg3')} />}
      </>
    ),
    name: (
      <RowText className={fresh ? 'font-semibold text-fg' : quiet ? 'text-fg3' : sel ? 'text-fg' : 'text-fg2'}>
        {p.name}
      </RowText>
    ),
    end: (
      <>
        {tail.where ? (
          <span className="min-w-0 shrink truncate text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{tail.where}</span>
        ) : null}
        {quiet ? <BellSlashIcon aria-hidden className={clsx(ic, 'text-fg3')} /> : null}
        <AttentionBadge need={c.ownNeed} ready={c.ownReady} scope="here" />
      </>
    ),
  }
}

/** a row's icon: a hair under the name's 15px, tucked 2px nearer the name */
const icon = 'size-[15px] shrink-0 -mr-0.5 phone:size-4'

/* ---------- indents: a space in by a chevron's room, its # under its heading's icon ---------- */

const indent = {
  top: 'pl-[33px] phone:pl-[38px]',
  machine: 'pl-[33px] phone:pl-[38px]',
  inner: 'pl-[45px] phone:pl-[50px]',
}

/** a section's heading (Pinned, a machine): its chevron, its icon (Pinned's pin; a machine's emoji or server) and its word. A tap anywhere on it folds
 *  what is under it, as its chevron does; it goes nowhere, as Slack's sections don't. What it adds (a machine's +
 *  and how it is) comes after its name. */
function Heading({ id, label, folds, icon: mark, shut, held, toggle, dim, className, children, ...rest }: { id: string; label: string; folds: string; icon: ReactNode; shut: boolean; held?: () => boolean; toggle?: () => void; dim?: boolean; className?: string; children?: ReactNode } & Omit<LiHTMLAttributes<HTMLLIElement>, 'children'>) {
  const flip = toggle ?? (() => toggleFold(id))
  return (
    <li data-heading={id} className={clsx(rowClass(false, false, true), 'group gap-1.5 select-none [-webkit-touch-callout:none]', className)} {...rest}>
      <Fold label={`${shut ? 'Show' : 'Hide'} ${folds}`} shut={shut} toggle={flip} />
      {mark}
      <h2 className="contents">
        <button
          type="button"
          aria-expanded={!shut}
          // a finger held to open its menu folds nothing
          onClick={() => !held?.() && flip()}
          className="flex min-w-0 flex-1 cursor-pointer text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] keys:focus-visible:after:shadow-[inset_0_0_0_1.5px_var(--focus)]"
        >
          <RowText className={clsx('font-medium', dim ? 'text-fg3' : 'text-fg2')}>{label}</RowText>
        </button>
      </h2>
      {children}
    </li>
  )
}

/** the icon a core menu item names (core/menus.js), drawn with the web's own */
const MENU_ICONS: Record<string, (p: { className?: string }) => ReactNode> = {
  plus: PlusIcon, 'folder-plus': SectionIcon, 'check-check': ReadIcon, pin: PinTaskIcon, 'pin-off': UnpinIcon, 'square-pen': RenameIcon,
  settings: CogIcon, 'git-branch': SplitIcon, x: RemoveProjectIcon, 'trash-2': DeleteIcon, network: ModelIcon,
}
type CoreItem = { id?: string; label?: string; icon?: string; sep?: boolean; setting?: boolean; note?: string }
/** a core menu (core/menus.js, the window's too) as the web draws it: its items in order, each done by `acts` */
function CoreMenuItems({ items, acts, setting }: { items: CoreItem[]; acts: Record<string, () => void>; setting?: ReactNode }) {
  return (
    <>
      {items.map((it, i) => {
        if (it.sep) return i ? <MenuSeparator key={`sep${i}`} /> : null
        if (it.setting) return <Fragment key={it.id}>{setting}</Fragment>
        const Icon = MENU_ICONS[it.icon ?? '']
        return <MenuItem key={it.id} icon={Icon ? <Icon className={ic} /> : undefined} onClick={acts[it.id!]}>{it.label}</MenuItem>
      })}
    </>
  )
}

/** A space's menu, as the window's (core/menus.js spaceMenu): Notify, Start Assistant while it has none (on any
 *  machine: its chat, whose first message starts it there), Mark as read while it has something new, Pin or Unpin,
 *  Rename…, Space settings…, its worktrees where it is a repo, and Close… */
function PlaceMenu({ p, snap, menu, unread, onClose }: { p: Place; snap: Snapshot; menu: ReturnType<typeof useRowMenu>; unread: boolean; onClose: () => void }) {
  const now = notifyOf(snap, p.id)
  const row = notifyRow(snap, p.id)
  const pick = (v: string) => act({ type: 'setting', key: NOTIFY_KEY, value: row?.inherits?.value === v ? null : v, place: p.id })
  const pinned = groupOf(snap, usePending(), p) === PINNED
  const then = (f: () => void) => () => { menu.close(); setTimeout(f) }
  const items = (MN.spaceMenu as (o: object) => CoreItem[])({ unread, pinned, git: p.git ?? null, assistant: !!(p.assistantTab?.id || p.assistantTab?.live) })
  return (
    <RowMenu menu={menu} label={p.name} className="min-w-[min(17rem,calc(100%-0.5rem))]!">
      <CoreMenuItems items={items}
        setting={<MenuSetting name="Notify" named icon={now === 'Off' ? <BellSlashIcon className={ic} /> : <BellIcon className={ic} />}
          note={items.find((x) => x.setting)?.note}
          choices={NOTIFY.map((v) => ({ label: v, on: now === v, onClick: () => void pick(v).catch(() => undefined) }))} />}
        acts={{
          assistant: then(() => { goPlace(p.id); setUI({ term: null, arts: null }) }),
          read: then(() => markPlaceRead(snap, [p])),
          pin: then(() => moveTo(p.id, PINNED)), unpin: then(() => moveTo(p.id, `m:${p.machine}`)),
          rename: then(() => openRename(p.id)),
          settings: then(() => setUI({ settings: { section: getState().ui.device === 'phone' ? null : 0, level: p.id }, drawer: false })),
          'worktree-new': then(() => openWorktree({ place: p.id, name: p.name, op: 'new' })),
          'worktree-open': then(() => openWorktree({ place: p.id, name: p.name, op: 'open' })),
          'worktree-remove': then(() => openWorktree({ place: p.id, name: p.name, op: 'remove' })),
          close: then(onClose),
        }} />
    </RowMenu>
  )
}


/**
 * Renaming a space, in its row: its name becomes a box, Enter (or leaving it) keeps the new name, Escape
 * keeps the old. Only the name that shows changes; empty gives it back its own. The new one shows at once, until the
 * snapshot has it. A space's name follows the space rules as you type (lowercase, a space becomes -), and one another
 * space on its machine has, or that breaks a rule, is refused in the box.
 */
function useRename(p: Place, snap: Snapshot) {
  const [editing, setEditing] = useState(false)
  const [typed, setTyped] = useState<string | null>(null)
  useEffect(() => setTyped(null), [p.name])
  const save = (v: string) => {
    setEditing(false)
    const name = slugify(v)
    if (name === p.name) return
    if (name) setTyped(name)
    act({ type: 'rename', id: p.id, name }).then(
      (r: { ok?: boolean }) => r.ok === false && setTyped(null),
      () => setTyped(null),
    )
  }
  const problem = (v: string) => (v ? nameProblem(v, snap.places.filter((x) => x.machine === p.machine && x.id !== p.id).map((x) => x.name)) : undefined)
  return {
    editing,
    start: () => setEditing(true),
    /** the name as it shows: the one just typed until the snapshot has it */
    name: typed ?? p.name,
    box: editing ? <RenameBox name={typed ?? p.name} problem={problem} onSave={save} onCancel={() => setEditing(false)} /> : null,
  }
}

function RenameBox({ name, problem, onSave, onCancel }: { name: string; problem: (v: string) => string | undefined; onSave: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(name)
  const box = useRef<HTMLInputElement>(null)
  // Enter or Escape closed it already: the blur its going brings changes nothing
  const done = useRef(false)
  const bad = problem(v)
  useEffect(() => {
    box.current?.focus({ preventScroll: true })
    box.current?.select()
  }, [])
  const end = (keep: boolean) => {
    if (done.current) return
    done.current = true
    if (keep && !bad) onSave(v)
    else onCancel()
  }
  return (
    <>
      <input
        ref={box}
        name="place-name"
        aria-label={`New name for ${name}`}
        aria-invalid={!!bad || undefined}
        enterKeyHint="done"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={NAME_MAX}
        value={v}
        onChange={(e) => setV(asTyped(e.target.value))}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== 'Escape') return
          e.preventDefault()
          e.stopPropagation()
          if (e.key === 'Enter' && bad) return
          end(e.key === 'Enter')
        }}
        onBlur={() => end(true)}
        className="-ml-1 h-6 min-w-0 flex-1 rounded-[calc(var(--row-radius)-3px)] bg-bg px-1 text-fg shadow-[inset_0_0_0_1.5px_var(--focus)] outline-none aria-invalid:shadow-[inset_0_0_0_1.5px_var(--color-need-fg)] coarse:h-8 phone:h-8 phone:text-[1rem]"
      />
      {bad ? <Meta className="text-need-fg!">{bad.includes('Another') ? 'Taken' : 'Not allowed'}</Meta> : null}
    </>
  )
}

/** a row's name: a button going there, stretched over the row */
function Go({ p, said, sel, sort, onClick, children }: { p: Place; said: string; sel: boolean; sort?: Sort; onClick?: (e: { metaKey: boolean; ctrlKey: boolean }) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={said}
      aria-current={sel || undefined}
      aria-keyshortcuts={sort && sort.ids.length > 1 ? 'Alt+Shift+ArrowUp Alt+Shift+ArrowDown' : undefined}
      onKeyDown={sort ? (e) => moveKey(e, p.id, sort) : undefined}
      onClick={onClick ?? ((e) => openPlace(p.id, e))}
      className="flex min-w-0 flex-1 cursor-pointer text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] keys:focus-visible:after:shadow-[inset_0_0_0_1.5px_var(--focus)]"
    >
      {children}
    </button>
  )
}

/** a space's row clicked: there */
function openPlace(id: string, _e?: { metaKey: boolean; ctrlKey: boolean }) {
  // the window's row selects its space, whatever key is held (no split view from the sidebar)
  goPlace(id)
}

/** A space: its name (going there, a button stretched over the row) and its count. Its menu opens, as the window's,
 *  from a right click (at the pointer) or a finger held on the row: no ⋯ comes and goes on it. In a section at the top it sits
 *  in under its heading, its machine after its name where there are more machines; in a machine's section, in under
 *  that. It drags among those beside it, a home space too, or onto another section it may go in. */
function Space({ p, snap, sort, at }: { p: Place; snap: Snapshot; sort: Sort; at: 'top' | 'machine' | 'inner' }) {
  const rename = useRename(p, snap)
  // Shift+F2 (3.0's rename-space): the shown space's row takes its name box
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<string>).detail === p.id && openRename(p.id)
    addEventListener('shepherdr:rename', on)
    return () => removeEventListener('shepherdr:rename', on)
  }, [p.id, rename.start])
  const top = at === 'top'
  const group = sort.under
  const r = usePlaceRow({ p: { ...p, name: rename.name }, snap, where: top && manyMachines(snap) ? machineName(snap.machines, p.machine) : undefined })
  const menu = useRowMenu({ beside: true })
  // its menu opens whatever its machine is doing, as the window's right-click
  const still = rename.editing
  return (
    <li
      data-machine={top ? undefined : `m:${p.machine}`}
      data-section={at === 'machine' ? undefined : group}
      data-project={p.id}
      data-pin={group === PINNED ? p.id : undefined}
      data-home={p.home || undefined}
      data-drop={group}
      className={clsx(rowClass(r.sel, false, true), dragged, dropBefore, indent[at], treeMark.get(p.id) && 'pl-[51px] phone:pl-[56px]', 'group select-none [-webkit-touch-callout:none]', menu.open && !r.sel && 'bg-hover')}
      onPointerDown={
        rename.editing
          ? undefined
          : (e) =>
              press(e, {
                id: p.id,
                siblings: sort.ids,
                level: 'project',
                drop: (ids) => reorder(group, ids),
                into: { group, may: (g) => mayGo(snap, p, g), go: (g, before) => moveTo(p.id, g, before) },
                hold: menu.hold, lift: menu.close, release: menu.release,
              })
      }
      onContextMenu={still ? undefined : (e) => (dragging() ? e.preventDefault() : menu.press.onContextMenu(e))}
    >
      {r.mark}
      {rename.box ?? (
        <Go p={p} said={r.said} sel={r.sel} sort={sort} onClick={(e) => !menu.held() && openPlace(p.id, e)}>
          {r.name}
        </Go>
      )}
      {r.end}
      {menu.open ? (
        <PlaceMenu p={p} snap={snap} menu={menu} unread={r.fresh} onClose={() => setRemoving(p)} />
      ) : null}
    </li>
  )
}

/** a row being dragged lifts above the rest */
const dragged = 'data-dragging:z-10 data-dragging:bg-bg data-dragging:shadow-menu'

/** a space dragged over another section: its heading lights up, and a line shows where it goes among its spaces */
const dropHeading = 'data-[drop-over=heading]:bg-sel'
const dropBefore = 'data-[drop-over=before]:shadow-[inset_0_2px_0_var(--focus)]'

/* ---------- removing a space asks first ---------- */

let removing: Place | null = null
const removeListeners = new Set<() => void>()
function setRemoving(p: Place | null) {
  removing = p
  for (const l of removeListeners) l()
}

/**
 * Close a space, as the window's confirm asks it (mods/confirm-chat): "Close “gtm”?", "Its tabs close and every
 * program in them ends.", Close space; then the window's own close (space.close, confirmed).
 */
function ConfirmRemove() {
  const p = useSyncExternalStore(
    (l) => {
      removeListeners.add(l)
      return () => void removeListeners.delete(l)
    },
    () => removing,
  )
  const snap = useSnap()
  if (!p || !snap) return null
  return <RemoveBox key={p.id} p={p} snap={snap} />
}

function RemoveBox({ p, snap }: { p: Place; snap: Snapshot }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancel = () => setRemoving(null)
  const go = async () => {
    setBusy(true)
    setError(null)
    const r = await removeSpace(p.id).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (r.ok === false) return setError(r.error || 'It could not be removed.')
    setRemoving(null)
    // it was open: its machine's home space takes its place
    const home = snap.places.find((x) => x.home && x.machine === p.machine)
    if (getState().ui.place === p.id && home) goPlace(home.id)
  }
  // the window's confirm (mods/confirm-chat, its words core/confirm.js): no other question first
  return (
    <Dialog
      title={CF.CLOSE_SPACE.title(p.name)}
      safe
      onCancel={cancel}
      buttons={
        <Primary disabled={busy} onClick={go}>
          {CF.CLOSE_SPACE.verb}
        </Primary>
      }
    >
      <p>{CF.CLOSE_SPACE.detail}</p>
      {error ? <p className="mt-1.5 text-need-fg">{error}</p> : null}
    </Dialog>
  )
}

/** A machine's mark: its emoji, or a monitor (this computer) or a server without one; faded while it can't be reached */
function MachineMark({ m }: { m: Machine }) {
  const Plain = m.here ? MonitorIcon : ServerIcon
  return m.emoji ? <span className={clsx('contents', offline(m) && '*:opacity-50')}><Emoji e={m.emoji} /></span> : <Plain className={clsx(icon, 'text-fg3')} />
}

/** A section's mark: Pinned's pin, its emoji, or a folder without one */
function SectionMark({ s }: { s: Section }) {
  return s.id === PINNED ? <PinnedIcon className={clsx(icon, 'text-fg3')} /> : s.emoji ? <Emoji e={s.emoji} /> : <SectionIcon className={clsx(icon, 'text-fg3')} />
}

function Emoji({ e }: { e: string }) {
  return (
    <span data-icon="emoji" aria-hidden className="-mr-0.5 grid w-[15px] shrink-0 place-items-center text-[0.9375rem] leading-none phone:w-4 phone:text-base">
      {e}
    </span>
  )
}

/** A machine's heading, as the window's (mods/spaces-chat main.js): its emoji (a monitor for this computer, a server for
 *  another without one) and its name; a tap folds its spaces and sections away, nothing opens. Connected: its + (New
 *  space, New section there) and its meter, a red dot when its health couldn't be read. Not connected: "Offline" (or
 *  "Connecting…"), dimmed and folded, a tap opening it for now. Its menu renames it. It stays in its place (machines
 *  don't drag); a space of its own dropped on it goes back to its top. */
function MachineHeading({ m, shut, className }: { m: Machine; shut: boolean; className?: string }) {
  const menu = useRowMenu({ beside: true })
  const off = offline(m)
  return (
    <Heading
      id={m.id}
      label={m.name}
      folds={`${m.name}'s spaces`}
      icon={<MachineMark m={m} />}
      held={menu.held}
      shut={shut}
      dim={off}
      toggle={off ? () => toggleOff(m.id) : undefined}
      data-machine={m.id}
      data-drop={m.id}
      className={clsx(dropHeading, className, menu.open && 'bg-hover')}
      // only its menu: a finger held on it opens it (machines keep their place)
      onPointerDown={(e) => press(e, { id: m.id, siblings: [m.id], level: 'machine', drop: () => {}, hold: menu.hold, lift: menu.close, release: menu.release })}
      onContextMenu={(e) => (dragging() ? e.preventDefault() : menu.press.onContextMenu(e))}
    >
      {off ? <Meta>{m.connecting ? 'Connecting…' : 'Offline'}</Meta> : null}
      {off ? null : <AddButton machine={m.machine} name={m.name} />}
      {off ? null : <MachineMeter m={m} />}
      {off ? null : <HealthDot m={m} />}
      {menu.open ? (
        <RowMenu menu={menu} label={m.name} className="min-w-56!">
          {/* a machine's own menu, as the window's (core/menus.js): its name and emoji */}
          <CoreMenuItems items={MN.machineMenu() as CoreItem[]} acts={{ rename: () => { menu.close(); setTimeout(() => openRename(m.id)) } }} />
        </RowMenu>
      ) : null}
    </Heading>
  )
}

/** A section's heading, at the top (Pinned) or in a machine, as the window's: its mark and name, a tap folding its
 *  spaces away (the one you're in and its unread ones stay); folded, what needs you in them (red) and their tasks in
 *  Ready (green). Sections keep their place (they don't drag); a space dropped on one goes in, last. Its menu renames or
 *  deletes it; Pinned has none, and shows while it holds any. */
function SectionHeading({ g, snap, at, className }: { g: Group; snap: Snapshot; at: 'top' | 'inner'; className?: string }) {
  const menu = useRowMenu({ beside: true })
  const { s } = g
  const pinned = s.id === PINNED
  return (
    <Heading
      id={s.id}
      label={s.name}
      folds={pinned ? 'the pinned' : `${s.name}'s spaces`}
      icon={<SectionMark s={s} />}
      held={menu.held}
      shut={g.shut}
      data-section={s.id}
      data-machine={at === 'inner' ? `m:${s.machine}` : undefined}
      data-drop={s.id}
      className={clsx(dropHeading, at === 'inner' && 'pl-5 phone:pl-6', className, menu.open && 'bg-hover')}
      // only its menu: a finger held on it opens it (sections keep their place)
      onPointerDown={pinned ? undefined : (e) => press(e, { id: s.id, siblings: [s.id], level: 'section', drop: () => {}, hold: menu.hold, lift: menu.close, release: menu.release })}
      onContextMenu={pinned ? undefined : (e) => (dragging() ? e.preventDefault() : menu.press.onContextMenu(e))}
    >
      {/* Pinned has no menu in the window */}
      {g.shut ? <Inside snap={snap} spaces={g.spaces} /> : null}
      {menu.open ? (
        <RowMenu menu={menu} label={s.name} className="min-w-56!">
          {/* as the window's (core/menus.js): Rename…, and Delete at once, its toast offering Undo */}
          <CoreMenuItems items={MN.sectionMenu() as CoreItem[]} acts={{
            rename: () => { menu.close(); setTimeout(() => openRename(s.id)) },
            delete: () => { menu.close(); void deleteSection(s).catch(() => undefined) },
          }} />
        </RowMenu>
      ) : null}
    </Heading>
  )
}

/** an open section with no spaces in it: where they go, as the window's */
function EmptySection({ inner }: { inner: boolean }) {
  return <li className={clsx('flex min-h-7 items-center text-[0.75rem] text-fg3 phone:min-h-9 phone:text-[0.8125rem]', inner ? indent.inner : indent.top)}>Drag spaces here</li>
}

/** the "Spaces" heading over the list, as the window's: its word, and its + (New space or section, on the shown space's
 *  machine) */
function SpacesHeading() {
  const snap = useSnap()
  const place = useUI((u) => u.place)
  const m = snap?.machines?.find((x) => x.machine === snap.places.find((p) => p.id === place)?.machine) ?? snap?.machines?.[0]
  return (
    <div className="flex h-8 items-center justify-between pr-2.5 pl-4 text-[0.75rem] font-medium text-fg3 phone:h-10 phone:pr-3.5 phone:pl-5 phone:text-[0.8125rem]">
      <h2>Spaces</h2>
      {m ? <span className="flex"><AddButton machine={m.machine} name={m.name} label="New space or section" /></span> : null}
    </div>
  )
}

/** on a folded section's heading (Pinned too), as the window's: what needs you in its spaces (red) and their tasks in
 *  Ready (green), added up */
function Inside({ snap, spaces }: { snap: Snapshot; spaces: Place[] }) {
  const need = spaces.reduce((n, p) => n + counts(snap, p.id).ownNeed, 0)
  const ready = spaces.reduce((n, p) => n + counts(snap, p.id).ownReady, 0)
  return <AttentionBadge need={need} ready={ready} scope="in it" />
}

/** a section's Delete (its menu), as the window's: at once, then a toast whose tap puts it back */
async function deleteSection(s: Section) {
  const r = (await act({ type: 'section', op: 'delete', id: s.id })) as { ok?: boolean }
  if (r?.ok === false) return
  const words = (SPc.sectionDeletedToast as (name: string) => { title: string; body: string })(s.name)
  toast({ ...words, level: 'info', timeout: 8000, go: () => void act({ type: 'section', op: 'restore' }).catch(() => undefined) })
}

/** the chevron before a heading's name: folds what is under it away */
function Fold({ label, shut, toggle }: { label: string; shut: boolean; toggle: () => void }) {
  const Icon = shut ? NextIcon : DownIcon
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={!shut}
      onClick={(e) => {
        e.stopPropagation()
        toggle()
      }}
      className="hit relative z-1 -ml-0.5 grid size-4 shrink-0 place-items-center rounded-full text-fg3 hover:bg-sel hover:text-fg phone:-ml-1 phone:size-5"
    >
      <Icon className="size-3 phone:size-3.5" />
    </button>
  )
}

/** + on a connected machine's heading (and the Spaces heading's, for the shown space's machine), always there as the
 *  window's: New space or New section there */
function AddButton({ machine, name, label }: { machine: string; name: string; label?: string }) {
  const menu = useRowMenu({ beside: true })
  return (
    <>
      <button
        type="button"
        aria-label={label ?? `New space or section on ${name}`}
        aria-haspopup="menu"
        aria-expanded={!!menu.open}
        onClick={(e) => {
          e.stopPropagation()
          if (menu.open) menu.close()
          else menu.show(e.currentTarget.closest('li') ?? e.currentTarget.parentElement)
        }}
        className="hit relative z-1 -mr-1 grid size-6 shrink-0 place-items-center rounded-full text-fg3 hover:bg-sel hover:text-fg aria-expanded:bg-sel phone:-mr-1.5 phone:size-8"
      >
        <PlusIcon className={ic} />
      </button>
      {menu.open ? (
        <RowMenu menu={menu} label={`New on ${name}`} className="min-w-48!">
          {/* the window's + (core/menus.js addMenu) */}
          <CoreMenuItems items={MN.addMenu() as CoreItem[]} acts={{
            'new-space': () => { menu.close(); openAddSpace(machine) },
            'new-section': () => { menu.close(); setTimeout(() => openNewSection(machine)) },
          }} />
        </RowMenu>
      ) : null}
    </>
  )
}

/** the space open the last time the sidebar looked: the first one shows as you left the tree, later ones open it */
let seen: string | null = null

/** Alt+↑/↓ (Option on a Mac): the space above or below in the sidebar as it shows, with its message box focused.
 *  Anywhere, the message box too: there Option+↑/↓ only jumps to its start or end. */
function stepPlace(e: KeyboardEvent, ui: UI, snap: Snapshot) {
  if (!e.altKey || e.shiftKey || e.metaKey || e.ctrlKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return false
  // a sheet or dialog keeps the keys: the sidebar is out of reach
  if (ui.search || ui.adding || ui.viewer || removing) return false
  e.preventDefault()
  // from where it sits with every section open: the open space may be in a folded one
  const shown = new Set(shownIds(placeTree(snap, folded, pending)))
  const all = shownIds(placeTree(snap, [], pending, allOpen(snap)))
  const i = all.indexOf(ui.place)
  const id = e.key === 'ArrowUp' ? all.slice(0, Math.max(0, i)).findLast((x) => shown.has(x)) : all.slice(i + 1).find((x) => shown.has(x))
  if (!id) return true
  goPlace(id)
  setUI({ focus: placeOf(snap, id).chat, kb: true })
  return true
}

function Places() {
  const snap = useSnap()!
  const place = useUI((u) => u.place)
  const fold = useFolded()
  const mine = usePending()
  const opened = useOpenedOff()
  const { top, tree } = placeTree(snap, fold, mine, opened)
  // going to a space folds nothing open, as the window's: a folded section shows the space you're in anyway (placeTree)
  useEffect(() => {
    // a list the snapshot has as it was dragged or moved shows from it again
    const now = listsOf(snap)
    const known = new Set([...snap.places.map((p) => p.id), ...(snap.machines ?? []).map((m) => m.id), ...(snap.sections ?? []).map((s) => s.id)])
    const same = (a: string[], b: string[]) => a.join('\n') === b.join('\n')
    const left = Object.fromEntries(
      Object.entries(pending).filter(([k, ids]) => {
        const want = ids.filter((x) => known.has(x))
        return loose.has(ids) ? !same([...(now[k] ?? [])].sort(), want.sort()) : !same(now[k] ?? [], want)
      }),
    )
    if (Object.keys(left).length !== Object.keys(pending).length) setPending(left)
  }, [snap])
  return (
    <>
      <SpacesHeading />
      {top.length ? (
        <List>
          {top.map((g, i) => (
            <Fragment key={g.s.id}>
              <SectionHeading g={g} snap={snap} at="top" className={i ? 'mt-3 phone:mt-4' : undefined} />
              {!g.shut && !g.spaces.length ? <EmptySection inner={false} /> : null}
              {g.shown.map((p) => (
                <Space key={p.id} p={p} snap={snap} at="top" sort={{ under: g.s.id, ids: g.shown.map((x) => x.id) }} />
              ))}
            </Fragment>
          ))}
        </List>
      ) : null}
      {/* the machines, each a section of its own, apart as those at the top are */}
      <List className={top.length ? 'pt-3 phone:pt-4' : undefined}>
        {tree.map(({ m, shut, shown, sections }, i) => (
          <Fragment key={m.id}>
            <MachineHeading m={m} shut={shut} className={i ? 'mt-3 phone:mt-4' : undefined} />
            {shown.map((p) => (
              <Space key={p.id} p={p} snap={snap} at="machine" sort={{ under: m.id, ids: shown.map((x) => x.id) }} />
            ))}
            {shut
              ? null
              : sections.map((g) => (
                  <Fragment key={g.s.id}>
                    <SectionHeading g={g} snap={snap} at="inner" />
                    {!g.shut && !g.spaces.length ? <EmptySection inner /> : null}
                    {g.shown.map((p) => (
                      <Space key={p.id} p={p} snap={snap} at="inner" sort={{ under: g.s.id, ids: g.shown.map((x) => x.id) }} />
                    ))}
                  </Fragment>
                ))}
          </Fragment>
        ))}
      </List>
    </>
  )
}

export default definePlugin({
  name: 'places',
  setup(reg) {
    reg.views.places = Places
    reg.overlays.push(AddSpace, ConfirmRemove, MarkRead, SectionDialogs)
    reg.keys.push({ order: 1, handle: ({ e, ui, snap }) => stepPlace(e, ui, snap) })
  },
})
