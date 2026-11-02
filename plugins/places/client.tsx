// Spaces in the sidebar like Slack's channels, under their machines as Slack's sections. Calm like Slack's: no status
// marks, a space's name in bold where something new came in its coordinator's chat that you haven't read
// (src/unread.ts), with a red count where something waits on you there (a task's ends as a card in its space's chat). A
// folded section hides every space in it, the open one too; a quiet dot on its heading says something in it is unread
// (grey) or waits on you (red). A space whose machine Shepherdr can't reach is greyed, and so is a muted one (Notify: Off), its count still
// red. A space whose coordinator is on Autopilot says so with a red dot in its round tint just before its name (its
// header's pill without the word); every row keeps that room, so names stay in line, and off it says nothing.
// Machines are sections, as Slack's, each with its emoji (a server without one): a small chevron at the left edge folds
// what is under them, a tap anywhere on one does the same, and nothing opens: they have no chat. Each space's # sits
// under its heading's name, as a Slack channel's does. A machine's heading has a + and a ⋯ (New space, New section,
// Rename machine: its emoji and name, section.tsx) and says when it can't be reached or struggles. Rows are Slack's: 28px
// of 15px text with a mouse; a ⋯ and + take no room until the pointer is over the row, where they take the count's
// place. Going to a space opens the sections it sits in. Each space's menu (its ⋯ or a right click; a finger holds the
// row) sets its coordinator's Notify (All, Needs me, Off: Everywhere's is the default in Settings), marks it read, pins
// it, moves it to a section, renames it in the row (the space rules: lowercase, no spaces) and removes it from
// Shepherdr, as `shepherdr space remove` does: its folder stays on disk. A home space can't be removed.
// Sections only organize spaces (shared/order.ts), as Slack's: one at the top (the header's +) holds any machine's, its
// machine after a space's name; one in a machine (its ⋯) only that machine's, one small step in. Pinned is one at the top
// that can't be deleted, showing while it holds any. A space moves into one (it isn't copied) from its menu's Move to
// section or by a drag onto its heading or among its spaces; out again, or with its section deleted, it is back where it
// was under its machine. A section's ⋯ renames or deletes it.
// Machines, sections and spaces, the home spaces too, show A to Z (a home space first, a new section last) until dragged
// into another order (drag.ts; Alt+Shift+↑/↓ on a focused space), which the main machine keeps for every device.
// Alt+↑/↓ (Option on a Mac) goes to the space above or below as they show, from anywhere.
import clsx from 'clsx'
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type LiHTMLAttributes, type ReactNode } from 'react'
import { act, counts, definePlugin, getState, goPlace, manyMachines, openSplit, placeOf, removeSpace, setUI, splitClick, useSnap, useUI, type Pane, type UI } from '@client/kernel.ts'
import { and, Dialog, RowMenu, RowMenuButton, useRowMenu } from '@client/rowmenu.tsx'
import { BackIcon, BellIcon, BellSlashIcon, AttentionBadge, attentionWords, DeleteIcon, DownIcon, HashIcon, ic, IconButton, List, MenuItem, MenuLabel, MenuSeparator, MenuSetting, Meta, NextIcon, PinnedIcon, PinTaskIcon, PlusIcon, Primary, ReadIcon, RemoveProjectIcon, RenameIcon, rowClass, RowText, SectionIcon, ServerIcon, SplitIcon, TasksIcon, UnpinIcon } from '@client/ui.tsx'
import { MarkRead, markPlaceRead, muted, placeUnread } from '@client/unread.ts'
import { RestartItem } from '@client/restart.tsx'
import { NOTIFY, NOTIFY_KEY, notifyOf, notifyRow } from '@shared/alerts.ts'
import { kept, PINNED, sectionsIn, TOP, type PlaceOrder } from '@shared/order.ts'
import { machineName, NAME_MAX, nameProblem, slugify, type Machine, type Place, type Section, type Snapshot } from '@shared/types.ts'
import { AddSpace, asTyped, openAddSpace } from './add.tsx'
import { dragging, press } from './drag.ts'
import { openDeleteSection, openNewSection, openRename, SectionDialogs } from './section.tsx'

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

/** the sidebar as it shows: the sections at the top (Pinned while it holds any), then each machine with its own spaces
 *  and its sections. A space shows once, where it sits; one just dragged or moved shows there at once. A folded section
 *  hides every space in it, a folded machine its sections too. */
function placeTree(snap: Snapshot, fold: string[], mine: PlaceOrder) {
  const lists = { ...listsOf(snap), ...mine }
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
    const spaces = take(lists[id], fits)
    const shut = fold.includes(id)
    return [{ s, spaces, shut, shown: shut || out ? [] : spaces }]
  }
  const top = (lists[TOP] ?? []).flatMap((id) => group(id, false, () => true)).filter((g) => g.s.id !== PINNED || g.spaces.length)
  const machines = new Map((snap.machines ?? []).map((m) => [m.id, m]))
  const tree = (lists.all ?? []).flatMap((id) => {
    const m = machines.get(id)
    if (!m) return []
    const shut = fold.includes(m.id)
    const fits = (p: Place) => p.machine === m.machine
    const spaces = take(lists[m.id], fits)
    const inside = (lists[sectionsIn(m.id)] ?? []).flatMap((s) => group(s, shut, fits))
    return [{ m, spaces, shut, shown: shut ? [] : spaces, sections: inside, all: [...spaces, ...inside.flatMap((g) => g.spaces)] }]
  })
  return { top, tree }
}

/** the spaces of the sidebar as they show, top to bottom */
function shownIds({ top, tree }: ReturnType<typeof placeTree>) {
  return [...top.flatMap((g) => g.shown), ...tree.flatMap((t) => [...t.shown, ...t.sections.flatMap((g) => g.shown)])].map((p) => p.id)
}

/** the sections a space sits in: its section at the top, or its machine and its section there */
function branchesOf(snap: Snapshot, id: string) {
  const { top, tree } = placeTree(snap, [], pending)
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

/** what every space's row shows: its name, bold when something new came in its coordinator's chat or waits on you
 *  there (with its count: a task waiting on you ends as a card in its space's chat), or that its machine can't be
 *  reached; dimmed when muted, as Slack's muted channels, its count still red */
function usePlaceRow({ p, snap, where }: { p: Place; snap: Snapshot; where?: string }) {
  const sel = useUI((u) => u.place === p.id)
  const c = counts(snap, p.id)
  const n = c.own
  const fresh = placeUnread(snap, p)
  const quiet = muted(snap, p.id)
  const off = p.status === 'off' && !p.connecting
  const pilot = p.mode === 'autopilot' && !off
  return {
    sel,
    // what the row says aloud, its count and offline too
    said: `${p.name}${where ? ` on ${where}` : ''}${p.home ? ', home space' : ''}${p.connecting ? ', connecting' : off ? ", can't reach" : n ? `, ${c.ownNeed} need you, ${c.ownReady} ready here` : ''}${fresh && !off ? ', unread' : ''}${pilot ? ', on Autopilot' : ''}${quiet ? ', muted' : ''}`,
    fresh,
    // the Autopilot mark, then the space's # before the name, as Slack's channels have: grey, lit with the name where
    // it is open or something is new
    mark: (
      <>
        <span aria-hidden data-autopilot={pilot || undefined} className={clsx('mode-pill mark', !pilot && 'invisible')} />
        <HashIcon className={clsx(icon, off || quiet ? 'text-fg3' : sel || n || fresh ? 'text-fg' : 'text-fg2')} />
      </>
    ),
    name: (
      <RowText className={off || quiet ? 'text-fg3' : n || fresh ? 'font-semibold text-fg' : sel ? 'text-fg' : 'text-fg2'}>
        {p.name}
        {where ? <span className="font-normal text-fg3"> · {where}</span> : null}
      </RowText>
    ),
    end: (
      <>
        {quiet ? <BellSlashIcon aria-hidden className={clsx(ic, 'text-fg3')} /> : null}
        {p.connecting || off ? null : <AttentionBadge need={c.ownNeed} ready={c.ownReady} scope="here" />}
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
 *  what is under it, as its chevron does; it goes nowhere, as Slack's sections don't. What it adds (a machine's +, ⋯
 *  and how it is) comes after its name. */
function Heading({ id, label, folds, icon: mark, shut, held, className, children, ...rest }: { id: string; label: string; folds: string; icon: ReactNode; shut: boolean; held?: () => boolean; className?: string; children?: ReactNode } & Omit<LiHTMLAttributes<HTMLLIElement>, 'children'>) {
  return (
    <li data-heading={id} className={clsx(rowClass(false, false, true), 'group gap-1.5 select-none [-webkit-touch-callout:none]', className)} {...rest}>
      <Fold label={`${shut ? 'Show' : 'Hide'} ${folds}`} id={id} shut={shut} />
      {mark}
      <h2 className="contents">
        <button
          type="button"
          aria-expanded={!shut}
          // a finger held to open its menu folds nothing
          onClick={() => !held?.() && toggleFold(id)}
          className="flex min-w-0 flex-1 cursor-pointer text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] keys:focus-visible:after:shadow-[inset_0_0_0_1.5px_var(--focus)]"
        >
          <RowText className="font-medium text-fg2">{label}</RowText>
        </button>
      </h2>
      {children}
    </li>
  )
}

const NOTIFY_HINT: Record<(typeof NOTIFY)[number], string> = {
  All: "every new message from its coordinator",
  'Needs me': "its coordinator's questions and alerts",
  Off: 'nothing from its coordinator, and its row stays quiet',
}

/** A space's menu: its coordinator's Notify (a choice that is what it would get anyway goes back to following it), Mark
 *  as read (its own chat, as its row shows it), Pin, Restart agent (its coordinator), Move to section (the menu turns into where it may go), Rename, and
 *  what the row adds (Remove, but for a home space) */
function PlaceMenu({ p, snap, menu, unread, onRename, children }: { p: Place; snap: Snapshot; menu: ReturnType<typeof useRowMenu>; unread: boolean; onRename?: () => void; children?: ReactNode }) {
  const [moving, setMoving] = useState(false)
  const now = notifyOf(snap, p.id)
  const row = notifyRow(snap, p.id)
  const { ownNeed, ownReady } = counts(snap, p.id)
  const attention = p.status === 'off' || p.connecting ? '' : attentionWords(ownNeed, ownReady)
  const pick = (v: string) => act({ type: 'setting', key: NOTIFY_KEY, value: row?.inherits?.value === v ? null : v, place: p.id })
  const desktop = useUI((u) => u.device === 'desktop')
  const split = (pane: Pane) => () => {
    menu.close()
    openSplit(pane)
  }
  if (moving)
    return (
      <RowMenu menu={menu} label={`Move ${p.name} to section`} className="min-w-[min(16rem,calc(100%-0.5rem))]!">
        <MoveItems p={p} snap={snap} menu={menu} onBack={() => setMoving(false)} />
      </RowMenu>
    )
  return (
    <RowMenu menu={menu} label={p.name} className="min-w-[min(16rem,calc(100%-0.5rem))]!">
      {attention ? <MenuLabel>{attention}</MenuLabel> : null}
      {desktop ? (
        <>
          <MenuItem icon={<SplitIcon className={ic} />} onClick={split({ kind: 'place', id: p.id })}>
            Open in split view
          </MenuItem>
          <MenuItem icon={<TasksIcon className={ic} />} onClick={split({ kind: 'tasks', id: p.id })}>
            Open its tasks in split view
          </MenuItem>
          <MenuSeparator />
        </>
      ) : null}
      <MenuSetting
        name="Notify"
        note="For its coordinator's chat; tasks alert as always"
        icon={now === 'Off' ? <BellSlashIcon className={ic} /> : <BellIcon className={ic} />}
        choices={NOTIFY.map((v) => ({ label: v, hint: NOTIFY_HINT[v], on: now === v, onClick: () => void pick(v).catch(() => undefined) }))}
      />
      <MenuItem
        icon={<ReadIcon className={ic} />}
        disabled={!unread}
        className="disabled:pointer-events-none disabled:text-fg3"
        onClick={() => {
          menu.close()
          markPlaceRead(snap, [p])
        }}
      >
        Mark as read
      </MenuItem>
      <PinItem p={p} snap={snap} menu={menu} />
      <RestartItem chat={p.chat} name={p.name} onPick={menu.close} />
      <MenuItem icon={<SectionIcon className={ic} />} hint={<NextIcon className={ic} />} aria-haspopup="menu" onClick={() => setMoving(true)}>
        Move to section
      </MenuItem>
      {onRename ? (
        <MenuItem
          icon={<RenameIcon className={ic} />}
          onClick={() => {
            menu.close()
            // once the menu has given the focus back to the ⋯: the name's box takes it then
            setTimeout(onRename)
          }}
        >
          Rename
        </MenuItem>
      ) : null}
      {children ? (
        <>
          <MenuSeparator />
          {children}
        </>
      ) : null}
    </RowMenu>
  )
}

/** Move to section: back first, then its machine's sections, those at the top (Pinned too), and its machine itself (no
 *  section); where it is now says Here */
function MoveItems({ p, snap, menu, onBack }: { p: Place; snap: Snapshot; menu: ReturnType<typeof useRowMenu>; onBack: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const here = groupOf(snap, usePending(), p)
  const m = snap.machines?.find((x) => x.machine === p.machine)
  const all = snap.sections ?? []
  useEffect(() => ref.current?.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)')?.focus({ preventScroll: true }), [])
  const item = (id: string, name: string, mark: ReactNode) => (
    <MenuItem
      key={id}
      icon={mark}
      disabled={id === here}
      hint={id === here ? 'Here' : undefined}
      className="disabled:pointer-events-none disabled:text-fg3"
      onClick={() => {
        menu.close()
        moveTo(p.id, id)
      }}
    >
      {name}
    </MenuItem>
  )
  const own = all.filter((s) => s.machine === p.machine)
  return (
    <div ref={ref} className="contents">
      <MenuItem icon={<BackIcon className={ic} />} className="text-fg2" onClick={onBack}>
        Move to section
      </MenuItem>
      <MenuSeparator />
      {own.length && m ? (
        <>
          <MenuLabel>In {m.name}</MenuLabel>
          {own.map((s) => item(s.id, s.name, <SectionMark s={s} />))}
        </>
      ) : null}
      <MenuLabel>At the top</MenuLabel>
      {all.filter((s) => !s.machine).map((s) => item(s.id, s.name, <SectionMark s={s} />))}
      {m ? (
        <>
          <MenuSeparator />
          {item(m.id, m.name, <MachineMark m={m} />)}
        </>
      ) : null}
    </div>
  )
}

/** Pin (to Pinned, at the end) or Unpin (back under its machine, where it was): a space's, wherever it sits */
function PinItem({ p, snap, menu }: { p: Place; snap: Snapshot; menu: ReturnType<typeof useRowMenu> }) {
  const on = groupOf(snap, usePending(), p) === PINNED
  return (
    <MenuItem
      icon={on ? <UnpinIcon className={ic} /> : <PinTaskIcon className={ic} />}
      onClick={() => {
        menu.close()
        moveTo(p.id, on ? `m:${p.machine}` : PINNED)
      }}
    >
      {on ? 'Unpin' : 'Pin'}
    </MenuItem>
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
        title={bad}
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

/** a row's name: a button going there, stretched over the row so its ⋯ stays a button of its own */
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

/** a space's row clicked: there, or with ⌘ (Ctrl off a Mac) beside the focused pane, in split view */
function openPlace(id: string, e: { metaKey: boolean; ctrlKey: boolean }) {
  if (splitClick(e)) openSplit({ kind: 'place', id })
  else goPlace(id)
}

/** A space: its name (going there, a button stretched over the row), its ⋯ and its count. Its menu opens from the ⋯,
 *  a right click or a finger held on the row; none while its machine can't be reached. In a section at the top it sits
 *  in under its heading, its machine after its name where there are more machines; in a machine's section, in under
 *  that. It drags among those beside it, a home space too, or onto another section it may go in. */
function Space({ p, snap, sort, at }: { p: Place; snap: Snapshot; sort: Sort; at: 'top' | 'machine' | 'inner' }) {
  const rename = useRename(p, snap)
  const top = at === 'top'
  const group = sort.under
  const r = usePlaceRow({ p: { ...p, name: rename.name }, snap, where: top && manyMachines(snap) ? machineName(snap.machines, p.machine) : undefined })
  const menu = useRowMenu({ beside: true })
  const off = p.status === 'off'
  const still = off || rename.editing
  return (
    <li
      data-machine={top ? undefined : `m:${p.machine}`}
      data-section={at === 'machine' ? undefined : group}
      data-project={p.id}
      data-pin={group === PINNED ? p.id : undefined}
      data-home={p.home || undefined}
      data-drop={group}
      className={clsx(rowClass(r.sel, false, true), dragged, dropBefore, indent[at], 'group select-none [-webkit-touch-callout:none]', menu.open && !r.sel && 'bg-hover')}
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
                ...(off ? {} : { hold: menu.hold, lift: menu.close, release: menu.release }),
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
      {still ? null : <RowMenuButton menu={menu} label={`More for ${p.name}`} className="relative z-1 -mr-1 phone:-mr-1.5 phone:size-8" />}
      <span className={clsx('contents', !still && 'untucked:hidden')}>{r.end}</span>
      {menu.open ? (
        <PlaceMenu p={p} snap={snap} menu={menu} unread={r.fresh} onRename={rename.start}>
          {p.home ? null : (
            <MenuItem
              icon={<RemoveProjectIcon className={ic} />}
              onClick={() => {
                menu.close()
                // once the menu has given the focus back to the ⋯, which takes it again when the question goes
                setTimeout(() => setRemoving(p))
              }}
            >
              Remove from Shepherdr…
            </MenuItem>
          )}
        </PlaceMenu>
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
 * "Remove gtm from Shepherdr?": the folder and its code stay on disk; Shepherdr forgets it and its coordinator closes.
 * Its open tasks hide with it and come back when it is added again. While one of its tasks is working it can't be
 * removed: it says which, and changes by itself once they stop.
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
  const mine = snap.tasks.filter((t) => t.place === p.id && !t.archived)
  const working = mine.filter((t) => t.status === 'work').map((t) => t.id)
  const open = mine.filter((t) => t.status !== 'done').map((t) => t.id)
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
  if (working.length)
    return (
      <Dialog title={`${p.name} can’t be removed yet`} safe cancel="OK" onCancel={cancel} buttons={null}>
        <p>
          {and(working)} {working.length > 1 ? 'are' : 'is'} still working. Stop {working.length > 1 ? 'them' : 'it'} or let {working.length > 1 ? 'them' : 'it'} finish first.
        </p>
      </Dialog>
    )
  return (
    <Dialog
      title={`Remove ${p.name} from Shepherdr?`}
      safe
      onCancel={cancel}
      buttons={
        <Primary className="bg-need-fg! text-white! dark:text-black!" disabled={busy} onClick={go}>
          {busy ? 'Removing…' : 'Remove'}
        </Primary>
      }
    >
      <p>Its files and folder stay on disk. Shepherdr only forgets it, and its coordinator closes.</p>
      <p className="mt-1.5">
        {open.length
          ? `${open.length > 1 ? `Its ${open.length} open tasks` : 'Its open task'}${open.length <= 4 ? ` (${and(open)})` : ''} ${open.length > 1 ? 'hide' : 'hides'} with it; ${open.length > 1 ? 'their worktrees and branches stay' : 'its worktree and branch stay'}. Add the space again to bring them and its chat back.`
          : 'Add it again any time to bring its chat back.'}
      </p>
      {error ? <p className="mt-1.5 text-need-fg">{error}</p> : null}
    </Dialog>
  )
}

/** A machine's mark: its emoji, or a server without one */
function MachineMark({ m }: { m: Machine }) {
  return m.emoji ? <Emoji e={m.emoji} /> : <ServerIcon className={clsx(icon, 'text-fg3')} />
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

/** A machine's heading: its chevron folds its spaces and sections away, as a tap on it does; nothing opens. Its emoji
 *  (a server without one) before its name. It says when it can't be reached or struggles, and has a + (New space there)
 *  and a ⋯ (New space, New section in it, Rename machine). It drags among the machines, all it holds with it; a space of
 *  its own dropped on it goes back under it. */
function MachineHeading({ m, snap, shut, spaces, sort, className }: { m: Machine; snap: Snapshot; shut: boolean; spaces: Place[]; sort: Sort; className?: string }) {
  const menu = useRowMenu({ beside: true })
  const off = m.status === 'off' && !m.connecting
  // a machine past an alert limit says which, quietly in red; all well, it says nothing (what it said last while it
  // connects again after a restart: not news)
  const herdr = !m.connecting && m.herdrDown
  const over = m.health?.meters.find((x) => x.level === 'over')
  const warn = herdr ? 'herdr down' : over ? `${over.name} ${over.pct}%` : ''
  return (
    <Heading
      id={m.id}
      label={m.name}
      folds={`${m.name}'s spaces`}
      icon={<MachineMark m={m} />}
      held={menu.held}
      shut={shut}
      data-machine={m.id}
      data-drop={m.id}
      className={clsx(dragged, dropHeading, className, menu.open && 'bg-hover')}
      onPointerDown={(e) => press(e, { id: m.id, siblings: sort.ids, level: 'machine', drop: (ids) => reorder(sort.under, ids), ...(off ? {} : { hold: menu.hold, lift: menu.close, release: menu.release }) })}
      onContextMenu={off ? undefined : (e) => (dragging() ? e.preventDefault() : menu.press.onContextMenu(e))}
    >
      {off ? null : <AddButton machine={m.machine} name={m.name} />}
      {off ? null : <RowMenuButton menu={menu} label={`More for ${m.name}`} className="relative z-1 -mr-1 phone:-mr-1.5 phone:size-8" />}
      <span className={clsx('contents', !off && !warn && 'untucked:hidden')}>
        {warn ? <Meta className="text-need-fg!">{warn}</Meta> : null}
        {m.connecting ? <Meta>Connecting…</Meta> : off && !herdr ? <Meta>Can't reach</Meta> : null}
        {shut && !off ? <Inside snap={snap} spaces={spaces} /> : null}
      </span>
      {menu.open ? (
        <RowMenu menu={menu} label={m.name} className="min-w-56!">
          <MenuItem
            icon={<PlusIcon className={ic} />}
            onClick={() => {
              menu.close()
              openAddSpace(m.machine)
            }}
          >
            New space…
          </MenuItem>
          <MenuItem
            icon={<SectionIcon className={ic} />}
            onClick={() => {
              menu.close()
              // once the menu has given the focus back to the ⋯, which takes it again when the dialog goes
              setTimeout(() => openNewSection(m.machine))
            }}
          >
            New section…
          </MenuItem>
          <MenuItem
            icon={<RenameIcon className={ic} />}
            onClick={() => {
              menu.close()
              setTimeout(() => openRename(m.id))
            }}
          >
            Rename machine…
          </MenuItem>
        </RowMenu>
      ) : null}
    </Heading>
  )
}

/** A section's heading, at the top or in a machine: its mark and name, folding its spaces away. It drags among the
 *  sections beside it, its spaces with it; a space dropped on it goes in, last. Its ⋯ renames or deletes it; Pinned
 *  only renames (its pin stays), and shows while it holds any. */
function SectionHeading({ g, snap, sort, keep, at, className }: { g: Group; snap: Snapshot; sort: Sort; keep?: string[]; at: 'top' | 'inner'; className?: string }) {
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
      className={clsx(dragged, dropHeading, at === 'inner' && 'pl-5 phone:pl-6', className, menu.open && 'bg-hover')}
      // Pinned out of sight while it holds nothing keeps its place among them
      onPointerDown={(e) => press(e, { id: s.id, siblings: sort.ids, level: 'section', drop: (ids) => reorder(sort.under, keep ? kept(keep, ids) : ids), hold: menu.hold, lift: menu.close, release: menu.release })}
      onContextMenu={(e) => (dragging() ? e.preventDefault() : menu.press.onContextMenu(e))}
    >
      <RowMenuButton menu={menu} label={`More for ${s.name}`} className="relative z-1 -mr-1 phone:-mr-1.5 phone:size-8" />
      <span className="contents untucked:hidden">{g.shut ? <Inside snap={snap} spaces={g.spaces} /> : null}</span>
      {menu.open ? (
        <RowMenu menu={menu} label={s.name} className="min-w-56!">
          <MenuItem
            icon={<RenameIcon className={ic} />}
            onClick={() => {
              menu.close()
              setTimeout(() => openRename(s.id))
            }}
          >
            Rename section…
          </MenuItem>
          {pinned ? null : (
          <MenuItem
            icon={<DeleteIcon className={ic} />}
            onClick={() => {
              menu.close()
              setTimeout(() => openDeleteSection(s.id))
            }}
          >
            Delete section…
          </MenuItem>
          )}
        </RowMenu>
      ) : null}
    </Heading>
  )
}

/** the sidebar header's +: a new section at the top */
function NewSection() {
  return (
    <IconButton label="New section" onClick={() => openNewSection()}>
      <PlusIcon className={ic} />
    </IconButton>
  )
}

/** on a folded section's heading, what its hidden spaces hold: a red dot where something waits on you in one, else a
 *  grey one where one is unread; nothing all read. Quiet as a mark, not a count: the spaces have those. */
function Inside({ snap, spaces }: { snap: Snapshot; spaces: Place[] }) {
  const on = spaces.filter((p) => p.status !== 'off')
  const needs = on.some((p) => counts(snap, p.id).own)
  const fresh = !needs && on.some((p) => placeUnread(snap, p))
  if (!needs && !fresh) return null
  const said = needs ? 'Something in it waits on you' : 'Something in it is unread'
  return <span role="img" aria-label={said} data-inside={needs ? 'needs' : 'unread'} className={clsx('mx-1.5 size-2 shrink-0 rounded-full phone:size-2.5', needs ? 'bg-need' : 'bg-fg2')} />
}

/** the chevron before a heading's name: folds what is under it away */
function Fold({ label, id, shut }: { label: string; id: string; shut: boolean }) {
  const Icon = shut ? NextIcon : DownIcon
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={!shut}
      onClick={(e) => {
        e.stopPropagation()
        toggleFold(id)
      }}
      className="hit relative z-1 -ml-0.5 grid size-4 shrink-0 place-items-center rounded-full text-fg3 hover:bg-sel hover:text-fg phone:-ml-1 phone:size-5"
    >
      <Icon className="size-3 phone:size-3.5" />
    </button>
  )
}

/** + on a machine's heading: a new space there. A mouse finds it on hover; a finger always sees it. */
function AddButton({ machine, name }: { machine: string; name: string }) {
  return (
    <button
      type="button"
      aria-label={`New space on ${name}`}
      onClick={(e) => {
        e.stopPropagation()
        openAddSpace(machine)
      }}
      className="hit relative z-1 -mr-1 grid size-6 shrink-0 place-items-center rounded-full text-fg3 hover:bg-sel hover:text-fg tucked:pointer-events-none tucked:absolute tucked:opacity-0 phone:-mr-1.5 phone:size-8"
    >
      <PlusIcon className={ic} />
    </button>
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
  const all = shownIds(placeTree(snap, [], pending))
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
  const { top, tree } = placeTree(snap, fold, mine)
  useEffect(() => {
    // one gone to from the sidebar itself (a click, Alt+↑/↓) was in sight already: the sidebar stays as it is
    if (seen !== null && seen !== place && !shownIds(placeTree(snap, folded, pending)).includes(place)) unfold(branchesOf(snap, place))
    seen = place
  }, [place])
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
  const tops = top.map((g) => g.s.id)
  const machines = tree.map((x) => x.m.id)
  return (
    <>
      {top.length ? (
        // one list, so a section drags among the others, as the machines do below
        <List className="pt-1">
          {top.map((g, i) => (
            <Fragment key={g.s.id}>
              <SectionHeading g={g} snap={snap} sort={{ under: TOP, ids: tops }} keep={listsOf(snap)[TOP]} at="top" className={i ? 'mt-3 phone:mt-4' : undefined} />
              {g.shown.map((p) => (
                <Space key={p.id} p={p} snap={snap} at="top" sort={{ under: g.s.id, ids: g.shown.map((x) => x.id) }} />
              ))}
            </Fragment>
          ))}
        </List>
      ) : null}
      {/* one list, so a machine drags among the others; each a section of its own, apart as those at the top are */}
      <List className={top.length ? 'pt-3 phone:pt-4' : 'pt-1'}>
        {tree.map(({ m, shut, shown, sections, all }, i) => (
          <Fragment key={m.id}>
            <MachineHeading m={m} snap={snap} shut={shut} spaces={all} sort={{ under: 'all', ids: machines }} className={i ? 'mt-3 phone:mt-4' : undefined} />
            {shown.map((p) => (
              <Space key={p.id} p={p} snap={snap} at="machine" sort={{ under: m.id, ids: shown.map((x) => x.id) }} />
            ))}
            {shut
              ? null
              : sections.map((g) => (
                  <Fragment key={g.s.id}>
                    <SectionHeading g={g} snap={snap} sort={{ under: sectionsIn(m.id), ids: sections.map((x) => x.s.id) }} at="inner" />
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
    reg.views.placesMenu = NewSection
    reg.overlays.push(AddSpace, ConfirmRemove, MarkRead, SectionDialogs)
    reg.keys.push({ order: 1, handle: ({ e, ui, snap }) => stepPlace(e, ui, snap) })
  },
})
