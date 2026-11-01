import { actionable, attentionCounts } from './attention.ts'
// The screen's small kernel: plugin slots, the store (server data + what's on screen), and the link to the server.
import { useSyncExternalStore, type FC, type ReactNode } from 'react'
import { buildId } from '@shared/build.ts'
import { expire, loadOutbox, prune, saveOutbox, settle, type Outgoing } from './outbox.ts'
import { keptOf, mayReload, type Kept } from './reload.ts'
import { OPEN_WITHIN, PONG_WITHIN, retryIn, SAY_LOST_AFTER } from './link.ts'
import { groupFor, groupTasks, loadAllDone, loadGroups, loadShut, namesFor, saveAllDone, saveGroups, saveShut, shownGroup, type GroupBy, type Groups, type TaskGroup } from './groups.ts'
import { canDock, CHAT_READ, fit as fitSidebars, focused, loadSidebars, PANEL, RIGHT, saveSidebars, showPanel, toggleFocus as focusTo, type Sidebars } from './sidebars.ts'
import { hush } from './motion.ts'
import { closed, loadPanes, MAX_PANES, normal, only, opened, PANE_MIN, replaced, samePane, savePanes, type Pane, type Panes } from './panes.ts'
import { setupGuarded } from './guard.tsx'
import { decide, screenOf, screenOfUrl, stepKey, stepsTo, systemSwipe, urlOf, type Entry } from './nav.ts'
import { machineName, taskChatId, type Action, type Chat, type Message, type Place, type ReplyQuote, type ServerEvent, type Snapshot, type Task, type TermScreen, type UpdateStatus } from '@shared/types.ts'

/* ---------- slots ---------- */

export interface KeyContext {
  e: KeyboardEvent
  ui: UI
  snap: Snapshot
}

export interface Views {
  /** the list of places in the sidebar and drawer (places) */
  places: FC
  /** a coordinator's or agent's chat: messages and composer (chat) */
  chat: FC<{ chatKey: string; placeholder: string; unreachable?: string }>
  /** the lists' tasks, grouped: what their chips hold (listView); placeId is the place picked (tasks) */
  tasks: FC<{ placeId: string }>
  /** the lists' artifacts, newest first: what their chips hold (listView); placeId is the place picked (artifacts) */
  artifacts: FC<{ placeId: string }>
  /** the Tasks header's ⋯: how its tasks are grouped, by listView's level; place is the place picked (tasks) */
  tasksMenu: FC<{ place: Place }>
  /** buttons in the sidebar's header beside the app's name: New section (places) */
  placesMenu: FC
  /** everything waiting on the human, on every machine, each with its answer (needs) */
  needs: FC
  /** the settings page */
  settings: FC
  /** ⌘K: search and jump (keyboard) */
  search: FC<{ onClose: () => void }>
  /** an artifact at its latest, filling the box it is in: a split view's pane (artifacts) */
  artifact: FC<{ artifactId: string }>
}

/**
 * An item of an open task's side panel (Terminal, Files, Diff, Pull request; Browser): a tab in the panel on a
 * desktop, a row of the task header's ⋯ menu opening it as a full-screen sheet on a phone or tablet.
 */
export interface PanelItem {
  id: string
  order: number
  label: string
  Icon: FC<{ className?: string }>
  /** a hook: why it has nothing to show for this task (greyed out with that hint), or null */
  useOff?: (task: Task) => string | null
  View: FC<{ task: Task; chatKey: string }>
}

export interface Registry {
  views: Partial<Views>
  /** parts drawn under a message's bubble (the reaction picker, artifacts, question cards) */
  messageParts: { order: number; View: FC<{ msg: Message; chat: Chat; from: string }> }[]
  /** marks sitting on a message bubble's bottom edge (reactions) */
  messageEdge: { order: number; View: FC<{ msg: Message; chat: Chat }> }[]
  /** rows drawn after a chat's messages (waiting lines, question cards from the CLI) */
  chatTail: { order: number; View: FC<{ chat: Chat; from: string }> }[]
  /** buttons at the right of a coordinator chat's header, before its menu (health) */
  placeHeader: { order: number; View: FC<{ place: Place }> }[]
  /** a coordinator's mark (its mode): after the header's buttons, before its menu; on a phone, whose header has no
   *  room for its word, at the end of the subtitle line */
  placeMark: { order: number; View: FC<{ place: Place }> }[]
  /** sections of the menu at the top right of a coordinator chat (mode, search, terminal); `joined` goes on the section
   *  before it, with no line between (artifacts, under terminal) */
  placeMenu: { order: number; joined?: boolean; View: FC<{ place: Place }> }[]
  /** buttons at the right of an agent chat's header */
  agentHeader: { order: number; View: FC<{ chatKey: string }> }[]
  /** rows at the top of a task chat's ⋯ menu, before its panel items (search) */
  agentMenu: { order: number; View: FC<{ chatKey: string }> }[]
  /** the items of an open task's side panel */
  taskPanel: PanelItem[]
  /** replaces a chat's body (the terminal) */
  chatBody: { when: (ui: UI, chatKey: string) => boolean; View: FC<{ chatKey: string }> }[]
  /** takes over the composer box while it is on: a voice call, talk to type */
  composerLive: { when: (ui: UI, chatKey: string) => boolean; View: FC<{ chatKey: string }> }[]
  /** above the composer box (+ menu, attachments) */
  composerAbove: { order: number; View: FC<{ chatKey: string; cli: string }> }[]
  /** the right-hand composer button while the box is empty (voice call) */
  composerIdle: FC<{ chatKey: string }> | null
  /** settings at the top of the + menu's agent section, before the CLI's own (a coordinator's mode); `when` says if one shows */
  composerSettings: { order: number; when: (snap: Snapshot, chatKey: string) => boolean; View: FC<{ chatKey: string }> }[]
  /** the + menu */
  composerPlus: FC<{ chatKey: string; cli: string }> | null
  /** the mic */
  composerMic: FC<{ chatKey: string }> | null
  /** whole-screen layers: viewer */
  overlays: FC[]
  /** a line under the top of the screen (voice call elsewhere, offline) */
  topBars: FC[]
  /** under the task list: place is its one space, else the place picked; list, what it shows (listView) */
  tasksFooter: FC<{ place: Place; list?: ListView }>[]
  /** keyboard: return true when handled */
  keys: { order: number; handle: (k: KeyContext) => boolean }[]
  /** a settings row a plugin acts on itself (alerts: turn them on for this device); returns what to say */
  settingActions: Record<string, () => Promise<string>>
  /** pages a plugin adds to Settings' This device group, after Appearance (the keyboard shortcuts); `when` says if one shows */
  settingsPages: { name: string; about?: string; Icon: FC<{ className?: string }>; when: (ui: UI) => boolean; View: FC<{ phone: boolean }> }[]
}

export const registry: Registry = {
  views: {},
  messageParts: [],
  messageEdge: [],
  chatTail: [],
  placeHeader: [],
  placeMark: [],
  placeMenu: [],
  agentHeader: [],
  agentMenu: [],
  taskPanel: [],
  chatBody: [],
  composerLive: [],
  composerAbove: [],
  composerSettings: [],
  composerIdle: null,
  composerPlus: null,
  composerMic: null,
  overlays: [],
  topBars: [],
  tasksFooter: [],
  keys: [],
  settingActions: {},
  settingsPages: [],
}

export interface ClientPlugin {
  name: string
  setup(reg: Registry): void
}

export const definePlugin = (p: ClientPlugin) => p

let enabledNames: string[] = []
export const has = (name: string) => enabledNames.includes(name)

/** set up each plugin on the slots; `user`: the human's own, guarded so one that throws stops only itself (guard.tsx) */
export function installPlugins(plugins: ClientPlugin[], enabled: string[], user: string[] = []) {
  enabledNames = enabled
  for (const p of plugins) {
    if (user.includes(p.name)) setupGuarded(p.name, registry, (r) => p.setup(r))
    else p.setup(registry)
  }
  const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order
  registry.messageParts.sort(byOrder)
  registry.messageEdge.sort(byOrder)
  registry.chatTail.sort(byOrder)
  registry.placeHeader.sort(byOrder)
  registry.placeMark.sort(byOrder)
  registry.placeMenu.sort(byOrder)
  registry.agentHeader.sort(byOrder)
  registry.agentMenu.sort(byOrder)
  registry.taskPanel.sort(byOrder)
  registry.composerAbove.sort(byOrder)
  registry.composerSettings.sort(byOrder)
  registry.keys.sort(byOrder)
}

/* ---------- what's on screen ---------- */

export type Device = 'phone' | 'tablet' | 'desktop'

/** What the Tasks and Artifacts lists show: their chips, spaces ("p:…") and whole machines ("m:…") a task or artifact
 *  may be in (none: everything). Following, the place picked's own, or what was made of them while at it (at); pinned,
 *  they stay whatever place is picked. */
export interface Lists {
  pinned: boolean
  chips: string[]
  at: string | null
}

export interface UI {
  device: Device
  place: string
  /** the open task: its agent's chat */
  task: string | null
  /** phone: Chat, Needs you, Tasks or Artifacts */
  tab: 'chat' | 'needs' | 'tasks' | 'artifacts'
  /** a wide screen's right-hand column: Needs you, the place's Tasks or its Artifacts, remembered on this device */
  side: 'needs' | 'tasks' | 'artifacts'
  /** what the Tasks and Artifacts lists show (their chips) and whether it stays whatever place is picked, remembered
   *  on this device */
  lists: Lists
  /** the section shown (null: a phone's list of them), and the level of defaults it edits (a place id: all, m:…, p:…;
   *  none: the place it was opened from) */
  settings: { section: number | null; level?: string } | null
  drawer: boolean
  /** the wide screen's sidebar widths, and whether places shows (sidebars.ts) */
  sidebars: Sidebars
  /** split view: the panes side by side in the middle, the focused one and their widths (desktop; panes.ts),
   *  remembered on this device */
  split: Panes
  /** an artifact open full screen: at a version you picked, or (none) its latest, following its updates */
  viewer: { artifact: string; v?: number } | null
  /** an attached picture opened full screen: a sent one by its message, one still in the message box by its file */
  photo: { chat: string; msg?: string; file?: { name: string; path: string } } | null
  search: boolean
  /** initial scope for unified search; global entrances leave it empty */
  searchScope?: { kind: 'all' } | { kind: 'chat' | 'space' | 'machine'; id: string }
  /** the Add a project dialog is open: true, or the name of the machine whose + opened it */
  adding: boolean | string
  /** chat key flipped to its terminal (a coordinator's; a task's terminal is an item of its side panel) */
  term: string | null
  /** chat key flipped to the list of its artifacts (a coordinator's; a task's is an item of its side panel) */
  arts: string | null
  /** phone and tablet: the side panel item open over the task's chat, as a full-screen sheet */
  sheet: string | null
  /** the task header's ⋯ menu is open (phone and tablet) */
  taskMenu: boolean
  /** what each side panel item has picked, by "task|item" (the file shown) */
  picked: Record<string, string>
  /** chat key on a voice call */
  call: string | null
  callStarted: number
  callMuted: boolean
  /** why the last voice call stopped, until dismissed */
  callError: string | null
  plus: string | null
  /** the coordinator chat's top-right menu is open */
  menu: boolean
  /** how All machines and a machine group their tasks, remembered on this device */
  groups: Groups
  /** task groups showing all their Done tasks ("place|group"), remembered on this device */
  allDone: string[]
  /** task headings folded shut, each view its own ("place|group", "place|m:machine"), remembered on this device */
  shut: string[]
  /** the lists (by their key) whose tasks column shows their Archived tasks instead */
  archived: string | null
  /** what each list is filtered by, while typed: "place|tasks", "place|artifacts" (*pinned for the pinned chips) */
  filter: Record<string, string>
  /** message id with the reaction bar open */
  pick: string | null
  /** the chat of that message (two chats on screen may share message ids) */
  pickChat: string | null
  /** the full emoji picker is open for it */
  pickAll: boolean
  /** message id whose text a touch can select (holding it reacts otherwise) */
  selecting: string | null
  /** chat key whose box has keyboard focus */
  focus: string | null
  /** an alert's link: the message or card (its id, or its question's) to bring into view and light up once its chat
   *  shows it */
  jump: string | null
  /** the on-screen keyboard is up */
  keyboard: boolean
  /** keyboard cursor in lists */
  kb: boolean
  cur: number
  /** chat key listening for talk-to-type */
  dict: string | null
  dictStarted: number
  /** Done was pressed: the last words are still coming in */
  dictDone: boolean
  files: Record<string, { name: string; path?: string }[]>
  /** search in a chat: its words, and the match shown (by message id; none: the newest) */
  find: { chat: string; q: string; id: string | null } | null
  /** the message each chat's box replies to, with its quote */
  reply: Record<string, ReplyQuote & { id: string }>
  offline: number | null
}

/* ---------- store ---------- */

interface State {
  snap: Snapshot | null
  chats: Record<string, Chat>
  terms: Record<string, TermScreen>
  /** what you sent that the chats don't show yet: it shows at once, and survives a reload */
  outbox: Outgoing[]
  /** how Shepherdr's last update of itself went */
  update: UpdateStatus | null
  ui: UI
}

function tabOf(t: string | null): UI['tab'] {
  return t === 'needs' || t === 'tasks' || t === 'artifacts' ? t : 'chat'
}

function deviceFor(w: number): Device {
  return w < CHAT_READ + RIGHT.min ? 'phone' : w < 1024 ? 'tablet' : 'desktop'
}

const LISTS = 'shepherdr.lists'
// before: the lists pinned to one place, its id; a home space's meant its machine's, the main machine's everything
const PIN = 'shepherdr.pin'
/** a place the lists were pinned to before chips, until the first snapshot says what it showed */
let oldPin: string | null = null

function loadLists(): Lists {
  const follow: Lists = { pinned: false, chips: [], at: null }
  try {
    const v = JSON.parse(localStorage.getItem(LISTS) ?? 'null') as Partial<Lists> | null
    if (v) return { pinned: v.pinned === true, chips: Array.isArray(v.chips) ? v.chips.filter((c): c is string => typeof c === 'string') : [], at: typeof v.at === 'string' ? v.at : null }
    oldPin = localStorage.getItem(PIN)
    return follow
  } catch {
    return follow
  }
}

function saveLists(l: Lists) {
  try {
    localStorage.setItem(LISTS, JSON.stringify(l))
    localStorage.removeItem(PIN)
  } catch {
    /* private window: following again next time */
  }
}

/** the lists pinned to a place before chips, as chips: a space's own, a home space's its machine, the main machine's
 *  home space's everything */
function fromOldPin(snap: Snapshot) {
  if (!oldPin) return
  const p = snap.places.find((x) => x.id === oldPin)
  // its machine still connecting (or not known yet): looked at again with the next snapshot
  if (!p && awaited(snap, oldPin)) return
  oldPin = null
  if (p) setUI({ lists: { pinned: true, chips: p.level === 0 ? [] : p.level === 1 ? [`m:${p.machine}`] : [p.id], at: null } })
}

const SIDE = 'shepherdr.side'

function loadSide(): UI['side'] {
  try {
    const side = localStorage.getItem(SIDE)
    return side === 'artifacts' || side === 'needs' ? side : 'tasks'
  } catch {
    return 'tasks'
  }
}

function saveSide(side: UI['side']) {
  try {
    localStorage.setItem(SIDE, side)
  } catch {
    /* private window: Tasks again next time */
  }
}

const params = new URLSearchParams(location.search)
// a reload for a new build draws at once what it showed: the last snapshot and the chats on screen, until the server's
const { text: keptText, snap: keptSnap, chats: keptChats, ...keptUI } = kept()
let state: State = {
  snap: keptSnap ?? null,
  chats: keptChats ?? {},
  terms: {},
  outbox: loadOutbox(),
  update: null,
  ui: {
    device: deviceFor(innerWidth),
    place: params.get('place') ?? lastPlace() ?? 'all',
    task: params.get('task'),
    tab: tabOf(params.get('tab')),
    side: loadSide(),
    lists: loadLists(),
    settings: null,
    drawer: false,
    sidebars: loadSidebars(),
    split: loadPanes(),
    viewer: params.get('artifact') ? { artifact: params.get('artifact')! } : null,
    photo: null,
    search: false,
    adding: false,
    term: null,
    arts: null,
    sheet: params.get('task') && deviceFor(innerWidth) !== 'desktop' ? params.get('item') : null,
    taskMenu: false,
    picked: {},
    call: null,
    callStarted: 0,
    callMuted: false,
    callError: null,
    plus: null,
    menu: false,
    groups: loadGroups(),
    allDone: loadAllDone(),
    shut: loadShut(),
    archived: null,
    filter: {},
    pick: null,
    pickChat: null,
    pickAll: false,
    selecting: null,
    focus: null,
    jump: params.get('focus'),
    keyboard: false,
    kb: false,
    cur: 0,
    dict: null,
    dictStarted: 0,
    dictDone: false,
    files: {},
    reply: {},
    find: null,
    offline: null,
    ...keptUI,
  },
}

// split, the place is the focused pane's; a link to a place (an alert's) opens it there once the spaces are known
{
  const { split } = state.ui
  const p = split.panes[split.pane]
  if (!params.get('place') && p && (p.kind === 'place' || p.kind === 'tasks')) state.ui.place = p.id
}
/** the place the address names is in the focused pane: checked once, with the first spaces known */
let linked = !state.ui.split.panes.length
function linkToPane() {
  const { snap, ui } = state
  if (linked || !snap) return
  linked = true
  const p = ui.split.panes[Math.max(0, ui.split.pane)]
  if (!p || placeOfPane(snap, p) === ui.place) return
  // a reload names the focused pane's own place; a link another (or the place a task pane's task left)
  const patch = placeInPane(ui, ui.place)
  if (patch.split) {
    state = { ...state, ui: { ...ui, ...patch } }
    savePanes(state.ui.split)
  }
}

function lastPlace(): string | null {
  try {
    return localStorage.getItem('shepherdr.place')
  } catch {
    return null
  }
}

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function getState() {
  return state
}

export function setUI(patch: Partial<UI> | ((ui: UI) => Partial<UI>)) {
  let p = typeof patch === 'function' ? patch(state.ui) : patch
  // another task (or none) closes the sheet and the menu the last one had open
  if (p.task !== undefined && p.task !== state.ui.task) p = { sheet: null, taskMenu: false, ...p }
  // a link to a place the screen doesn't list (All machines with a single machine) goes to the top
  if (p.place !== undefined && state.snap) p.place = placeOf(state.snap, p.place).id
  // following, another place puts back its own chips: what was edited stayed with the place it was edited at
  if (p.place !== undefined && p.place !== state.ui.place && !p.lists && !state.ui.lists.pinned && state.ui.lists.at) p = { ...p, lists: { pinned: false, chips: [], at: null } }
  // split, a place picked (the sidebar, search, a key) opens in the focused pane
  if (p.place !== undefined && p.split === undefined && p.place !== state.ui.place) p = { ...placeInPane(state.ui, p.place), ...p }
  // the open task on the right had the focus and closes: the first pane takes it
  else if (p.task === null && p.split === undefined && state.ui.task && state.ui.split.pane < 0 && state.ui.split.panes.length) p = { ...splitTo({ ...state.ui.split, pane: 0 }), ...p }
  // nothing changes: nothing redraws
  if ((Object.keys(p) as (keyof UI)[]).every((k) => Object.is(p[k], state.ui[k]))) return
  state = { ...state, ui: { ...state.ui, ...p } }
  if ((Object.keys(p) as (keyof UI)[]).some((k) => STEP_FIELDS.has(k))) syncUrl()
  if (p.sidebars) saveSidebars(p.sidebars)
  if (p.split) savePanes(p.split)
  if (p.groups) saveGroups(p.groups)
  if (p.allDone) saveAllDone(p.allDone)
  if (p.shut) saveShut(p.shut)
  if (p.lists) saveLists(p.lists)
  if (p.side) saveSide(p.side)
  watchVisible()
  emit()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Pick only what a part shows: it redraws when that changes, not on every change to the store. */
export function useStore<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => pick(state))
}

/** change what waits to show in the chats; what a chat already shows goes at once */
export function setOutbox(fn: (out: Outgoing[]) => Outgoing[]) {
  let out = fn(state.outbox)
  for (const key of new Set(out.map((o) => o.chat))) if (state.chats[key]) out = settle(out, state.chats[key])
  putOutbox(out)
  emit()
}

function putOutbox(out: Outgoing[]) {
  if (out === state.outbox) return
  state = { ...state, outbox: out }
  saveOutbox(out)
}

// one still sending long after its time didn't go through; one that went in but never came back stops showing
setInterval(() => {
  const out = expire(state.outbox, Date.now(), (chat) => !!state.chats[chat]?.working)
  if (out === state.outbox) return
  putOutbox(out)
  emit()
}, 2000)

/** What's on screen; better, pick the bits a part shows (`useUI((u) => u.device)`) so it redraws only when they change. */
export function useUI(): UI
export function useUI<T>(pick: (ui: UI) => T): T
export function useUI<T>(pick?: (ui: UI) => T) {
  return useStore((s) => (pick ? pick(s.ui) : s.ui))
}
export const useSnap = () => useStore((s) => s.snap)

/* ---------- drafts ---------- */

// Half-typed texts live apart from the store: a letter typed redraws only the box it went in, not the whole screen.
let drafts: Record<string, string> = keptText ?? {}
const draftListeners = new Set<() => void>()
const subscribeDrafts = (l: () => void) => {
  draftListeners.add(l)
  return () => {
    draftListeners.delete(l)
  }
}

export const getDraft = (key: string): string | undefined => drafts[key]

export function setDraft(key: string, text: string) {
  if (drafts[key] === text) return
  drafts = { ...drafts, [key]: text }
  draftListeners.forEach((l) => l())
}

/** a half-typed text that survives a reload (the screen reloads itself on a new build); undefined until first set */
export function useDraftOf(key: string): string | undefined {
  return useSyncExternalStore(subscribeDrafts, () => drafts[key])
}

/** a half-typed text that survives a reload, and its setter */
export function useDraft(key: string): [string, (v: string) => void] {
  return [useDraftOf(key) ?? '', (t) => setDraft(key, t)]
}

/* ---------- address bar and Back (nav.ts) ---------- */

/** what of the screen makes a step in the history (nav.ts) */
const STEP_FIELDS = new Set<keyof UI>(['place', 'task', 'tab', 'sheet', 'viewer', 'settings', 'search', 'drawer', 'photo', 'adding', 'archived'])

/** the history entry on screen, as the app wrote it */
let entry: Entry | null = null
/** a step back the app asked for (a close) is on its way: the next change waits for it to land */
let backing: ReturnType<typeof setTimeout> | null = null

/** write the screen into the history: a new step, or in place of the one on screen */
function write(how: 'push' | 'replace') {
  const screen = screenOf(state.ui)
  const url = urlOf(screen, state.ui.device === 'phone', location.pathname, (id) => slugOf(state.snap, id))
  const next: Entry = { shep: 1, key: stepKey(screen), prev: how === 'push' ? (entry?.key ?? null) : (entry?.prev ?? null), screen }
  // Safari allows only so many history writes: an unchanged screen isn't written again
  if (how === 'replace' && entry && url === location.pathname + location.search && JSON.stringify(entry) === JSON.stringify(next)) return
  if (how === 'push') history.pushState(next, '', url)
  else history.replaceState(next, '', url)
  entry = next
  try {
    localStorage.setItem('shepherdr.place', state.ui.place)
  } catch {
    /* private window */
  }
}

function syncUrl(replace = false) {
  if (backing) return
  const how = replace ? 'replace' : decide(entry, screenOf(state.ui))
  if (how !== 'back') return write(how)
  history.back()
  // no step came back (none was there): the screen goes in place of this one
  backing = setTimeout(() => {
    backing = null
    write('replace')
  }, 600)
}

/** the first entry: a reload keeps its steps; a link (an alert's) gets the steps that lead to it */
function startHistory() {
  const st = history.state as Entry | null
  if (st?.shep) {
    entry = st
    return write('replace')
  }
  const phone = state.ui.device === 'phone'
  stepsTo(screenOf(state.ui)).forEach((s, i) => {
    const next: Entry = { shep: 1, key: stepKey(s), prev: entry?.key ?? null, screen: s }
    if (i) history.pushState(next, '', urlOf(s, phone, location.pathname, (id) => slugOf(state.snap, id)))
    else history.replaceState(next, '', urlOf(s, phone, location.pathname, (id) => slugOf(state.snap, id)))
    entry = next
  })
}
startHistory()

/** go where an alert's link points (its place, task and card), as a tap on the alert does with the app open */
export function openLink(href: string) {
  const q = new URL(href, location.href).searchParams
  const place = q.get('place')
  if (!place) return
  const task = q.get('task')
  const closed = { settings: null, drawer: false, search: false, adding: false, menu: false, pick: null, pickAll: false, viewer: null, photo: null, cur: 0 }
  // a task elsewhere comes with its place as a step before it, so Back from it goes to its place
  if (task && (state.ui.place !== place || state.ui.task)) setUI({ ...closed, place, task: null, tab: 'chat' })
  setUI({ ...closed, place, task, tab: 'chat', jump: q.get('focus') })
  forgetJump()
}

// the card to bring into view is not part of the address: a reload or a step back doesn't bring it into view again
let jumpTimer: ReturnType<typeof setTimeout> | null = null
function forgetJump() {
  if (new URLSearchParams(location.search).has('focus')) syncUrl(true)
  // a card its chat no longer has (answered meanwhile) is let go
  if (jumpTimer) clearTimeout(jumpTimer)
  jumpTimer = setTimeout(() => state.ui.jump && setUI({ jump: null }), 15_000)
}
if (state.ui.jump) forgetJump()

addEventListener('popstate', (e) => {
  const st = (e as PopStateEvent).state as Entry | null
  if (backing) {
    // the step back the app asked for: the screen already shows it, and what changed meanwhile goes in now
    clearTimeout(backing)
    backing = null
    entry = st?.shep ? st : null
    return syncUrl()
  }
  entry = st?.shep ? st : null
  // iOS's own swipe already slid the screen: it lands still
  if (systemSwipe()) hush()
  const before = state.ui
  state = {
    ...state,
    ui: {
      ...state.ui,
      ...(st?.shep ? st.screen : screenOfUrl(location.search, state.ui.device === 'desktop', tabOf)),
      menu: false,
      taskMenu: false,
      plus: null,
      pick: null,
      pickAll: false,
    },
  }
  if (!entry) write('replace')
  stayOnShown()
  // split, the place stepped back to shows in the focused pane (or focuses the pane that has it)
  if (state.ui.place !== before.place) {
    const patch = placeInPane(before, state.ui.place)
    if (patch.split) {
      state = { ...state, ui: { ...state.ui, ...patch } }
      savePanes(state.ui.split)
    }
  }
  watchVisible()
  emit()
})

addEventListener('resize', () => {
  const d = deviceFor(innerWidth)
  if (d !== state.ui.device || (state.ui.drawer && placesDocked(state.ui, state.snap))) setUI({ device: d, drawer: false })
  else {
    // Docking and compact task focus also change within a device class. Rewatch chats brought back by widening.
    watchVisible()
    emit()
  }
})

/* ---------- server link ---------- */

let ws: WebSocket | null = null
let watched = ''

export async function act(a: Action, signal?: AbortSignal) {
  const r = await fetch('api/action', { method: 'POST', headers: { 'content-type': 'application/json', 'x-shepherdr': '1' }, body: JSON.stringify(a), signal })
  if (!r.ok) throw new Error((await r.text()) || `${r.status}`)
  return r.json().catch(() => ({}))
}

// One live socket to the server (link.ts says how it comes back). The screen keeps what it last showed meanwhile.
let tries = 0
let retrying: ReturnType<typeof setTimeout> | null = null
let opening: ReturnType<typeof setTimeout> | null = null
let pinging: ReturnType<typeof setTimeout> | null = null
let saying: ReturnType<typeof setTimeout> | null = null
let downSince: number | null = null
/** the outbox was cleared of what a loading screen drops */
let pruned = false
let tried = 0

export function connect() {
  if (retrying) clearTimeout(retrying)
  retrying = null
  const url = new URL('api/ws', location.href)
  url.protocol = url.protocol.replace('http', 'ws')
  const sock = new WebSocket(url)
  ws = sock
  tried = Date.now()
  opening = setTimeout(() => drop(sock), OPEN_WITHIN)
  sock.onopen = () => {
    clearTimeout(opening!)
    linkedAt = Date.now()
    tries = 0
    downSince = null
    if (saying) clearTimeout(saying)
    saying = null
    watched = ''
    if (state.ui.offline) setUI({ offline: null })
    watchVisible()
  }
  sock.onmessage = (ev) => {
    if (pinging) clearTimeout(pinging)
    pinging = null
    const msg = JSON.parse(ev.data) as ServerEvent
    if (msg.type === 'pong') return
    if (msg.type === 'snapshot') {
      state = { ...state, snap: msg.snapshot }
      stayOnShown()
      fromOldPin(msg.snapshot)
      // once loaded, the first snapshot with every machine in reach says which chats are gone (one connecting or out
      // of reach may not list its chats yet: then none is dropped); later ones don't, so a failed one left open a day
      // keeps its Retry
      if (!pruned && msg.snapshot.machines.every((m) => !m.connecting && m.status !== 'off')) {
        putOutbox(prune(state.outbox, Date.now(), chatIn(msg.snapshot)))
        pruned = true
      }
    } else if (msg.type === 'chat') {
      state = { ...state, chats: { ...state.chats, [msg.chat.key]: msg.chat } }
      putOutbox(settle(state.outbox, msg.chat))
    }
    else if (msg.type === 'terminal') state = { ...state, terms: { ...state.terms, [msg.chat]: { ansi: msg.ansi, cols: msg.cols, rows: msg.rows } } }
    else if (msg.type === 'update') state = { ...state, update: msg.update }
    else if (msg.type === 'build' && BUILD && msg.id && msg.id !== BUILD) reloadSoon()
    if (msg.type === 'snapshot') watchVisible()
    emit()
  }
  sock.onclose = () => drop(sock)
}

/** this socket is done (closed, never opened, or silent): try again, and say the link is gone if it stays gone */
function drop(sock: WebSocket) {
  if (sock !== ws) return
  forget()
  downSince ??= Date.now()
  saying ??= sayLater()
  retrying = setTimeout(connect, retryIn(tries++))
}

/** let go of the socket, whatever it is doing */
function forget() {
  if (!ws) return
  ws.onopen = ws.onmessage = ws.onclose = null
  ws.close()
  ws = null
  clearTimeout(opening!)
  if (pinging) clearTimeout(pinging)
  pinging = null
}

/** say the link is gone in a few seconds, unless it is back by then; a timer that slept with the page starts over */
function sayLater(at = Date.now()): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    if (Date.now() - at > SAY_LOST_AFTER + 1000) saying = sayLater()
    else if (ws?.readyState !== WebSocket.OPEN) setUI({ offline: downSince })
  }, SAY_LOST_AFTER)
}

/** back on screen (or on the network): an open link must answer a ping, any other is tried again at once */
function wake() {
  if (document.visibilityState !== 'visible') return
  if (ws?.readyState === WebSocket.OPEN) {
    if (pinging) return
    const sock = ws
    pinging = setTimeout(() => {
      tries = 0
      drop(sock)
    }, PONG_WITHIN)
    return sock.send(JSON.stringify({ type: 'ping' }))
  }
  // back on screen, the link gets a fresh few seconds before the top line says it is gone; a try made while away
  // went out before the network woke and can hang, so it starts over (one just made stays: a phone says it twice)
  if (saying) {
    clearTimeout(saying)
    saying = sayLater()
    if (state.ui.offline) setUI({ offline: null })
  }
  if (ws && Date.now() - tried < 1000) return
  forget()
  tries = 0
  connect()
}

document.addEventListener('visibilitychange', wake)
addEventListener('pageshow', (e) => (e as PageTransitionEvent).persisted && wake())
addEventListener('online', wake)

let pushEndpoint: string | null = null

/** This device's push subscription (alerts sets it): while the app is on screen, the server sends it no alerts. */
export function setPushEndpoint(endpoint: string | null) {
  pushEndpoint = endpoint
  watchVisible()
}

document.addEventListener('visibilitychange', () => watchVisible())

/** Tell the server the chats (and terminals) now on screen, and whether the app is on screen at all. */
function watchVisible() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !state.snap) return
  const keys = visibleChats(state.ui, state.snap)
  const term = state.ui.term ?? panelTerm(state.ui, state.snap)
  const visible = document.visibilityState === 'visible'
  const next = JSON.stringify({ keys, term, visible, pushEndpoint })
  if (next === watched) return
  watched = next
  ws.send(JSON.stringify({ type: 'watch', chats: keys, term, visible, push: pushEndpoint }))
}

/* ---------- reloading on a new build ---------- */

// the build this screen is (empty under the dev server: it reloads by itself)
const BUILD = buildId(document.head.innerHTML)
let reloading: ReturnType<typeof setInterval> | null = null
let holds = 0
let typed = 0

addEventListener('input', () => (typed = Date.now()), true)

/** Hold off reloading while something can't be picked up again (an upload on its way). Returns the release. */
export function holdReload() {
  holds++
  let done = false
  return () => {
    if (!done) holds--
    done = true
  }
}

function reloadSoon() {
  if (reloading) return
  const tryNow = () => {
    if (!mayReload(state.ui, { holds, sinceTyped: Date.now() - typed, focused: document.activeElement })) return
    keep(state, drafts)
    // what of itself each part keeps (a chat, how far up it was read)
    dispatchEvent(new Event('shepherdr:reloading'))
    location.reload()
  }
  reloading = setInterval(tryNow, 1000)
  tryNow()
}

function keep(st: State, text: Record<string, string>) {
  const shown = st.snap ? visibleChats(st.ui, st.snap) : []
  const k = keptOf(st.ui, text)
  try {
    sessionStorage.setItem('shepherdr.kept', JSON.stringify({ ...k, snap: st.snap ?? undefined, chats: Object.fromEntries(shown.filter((c) => st.chats[c]).map((c) => [c, st.chats[c]])) }))
  } catch {
    // too much to keep (a long chat): what was open and typed still comes back
    try {
      sessionStorage.setItem('shepherdr.kept', JSON.stringify(k))
    } catch {
      /* private window: the reload still brings the newest screen */
    }
  }
}

function kept(): Kept {
  try {
    const k = sessionStorage.getItem('shepherdr.kept')
    sessionStorage.removeItem('shepherdr.kept')
    return k ? (JSON.parse(k) as Kept) : {}
  } catch {
    return {}
  }
}

/* ---------- derived ---------- */

/** More than one machine known (reachable or not): only then does a space say its machine where it shows apart from it. */
export function manyMachines(snap: Snapshot) {
  return (snap.machines?.length ?? 0) > 1
}

/** The spaces the screen lists. */
export function shownPlaces(snap: Snapshot) {
  return snap.places
}

/** The space the app opens on: the main machine's home space, which keeps every machine's overview. */
export function home(snap: Snapshot) {
  return (snap.places.find((p) => p.home && p.machine === snap.host) ?? snap.places.find((p) => p.home) ?? snap.places[0])?.id ?? ''
}

/** a space's address in links: its machine and its name ("vm-str/gtm") */
export function slugOf(snap: Snapshot | null, id: string) {
  const p = snap?.places.find((x) => x.id === id)
  return p ? `${p.machine}/${p.name}` : id
}

/** the space a link names: by its id, or by its machine and name ("vm-str/gtm"); a link from before spaces to All
 *  machines or a machine goes to its home space */
export function placeIdOf(snap: Snapshot, s: string) {
  if (snap.places.some((p) => p.id === s)) return s
  const [machine, name] = s.split('/')
  const named = name !== undefined && snap.places.find((p) => p.machine === machine && p.name === name)
  if (named) return named.id
  if (s === 'all') return home(snap)
  const m = s.match(/^m:(.+)$/)
  return m ? `p:${m[1]}:~` : s
}

/** The screen stays on a space it lists, else goes to the main home space: a space gone. A space on a machine still
 * connecting (just after Shepherdr restarted for an update) isn't gone: the screen stays on it. */
function stayOnShown() {
  stayOnPlace()
  linkToPane()
}

function stayOnPlace() {
  const { snap, ui } = state
  if (!snap) return
  const id = placeIdOf(snap, ui.place)
  if (id !== ui.place && (snap.places.some((p) => p.id === id) || awaited(snap, id))) {
    state = { ...state, ui: { ...ui, place: id } }
    return syncUrl(true)
  }
  if (snap.places.some((p) => p.id === ui.place) || awaited(snap, ui.place)) {
    // renamed: its address follows its new name
    if (new URLSearchParams(location.search).get('place') !== slugOf(snap, ui.place)) syncUrl(true)
    return
  }
  state = { ...state, ui: { ...ui, place: home(snap), task: null } }
  syncUrl(true)
}

/** when the link to the server last came back: a restarted server may not know its other machines for a moment */
let linkedAt = 0
/** a server finds its other machines within this long of starting */
const FINDS_MACHINES_IN = 30_000
let recheck: ReturnType<typeof setTimeout> | null = null

/** A space the screen doesn't list yet but will: its machine is connecting, or not known yet just after the link came
 *  back. Shown meanwhile as connecting, under the name it has in its id. */
function awaited(snap: Snapshot, id: string): Place | undefined {
  const m = id.match(/^p:([^:]+):(.+)$/)
  if (!m) return undefined
  const label = m[1]
  const machine = snap.machines?.find((x) => x.machine === label)
  if (machine ? !machine.connecting : Date.now() - linkedAt > FINDS_MACHINES_IN) return undefined
  // not listed yet: looked at again once the server has had time to find it
  if (!machine && !recheck)
    recheck = setTimeout(() => {
      recheck = null
      stayOnShown()
      emit()
    }, FINDS_MACHINES_IN)
  const home = m[2] === '~'
  return { id, name: home ? 'home' : m[2], machine: label, ...(home ? { home: true } : {}), level: home ? 1 : 2, status: 'idle', mode: 'regular', chat: id, connecting: true }
}

export function placeOf(snap: Snapshot, id: string) {
  const shown = shownPlaces(snap)
  return shown.find((p) => p.id === id) ?? awaited(snap, id) ?? shown.find((p) => p.id === placeIdOf(snap, id)) ?? shown.find((p) => p.id === home(snap)) ?? shown[0]
}

export function taskOf(snap: Snapshot, id: string | null) {
  return id ? (snap.tasks.find((t) => t.id === id) ?? null) : null
}

/** the spaces a space's lists show, itself included: its own; a home space's its machine's; the main machine's home
 *  space's every machine's */
export function subtree(snap: Snapshot, id: string): string[] {
  const p = snap.places.find((x) => x.id === id)
  if (!p) return []
  if (p.level === 2) return [id]
  return snap.places.filter((x) => p.level === 0 || x.machine === p.machine).map((x) => x.id)
}

/** "gtm · vm-str" with more machines, else the space's name */
export function ladder(snap: Snapshot, id: string) {
  const p = placeOf(snap, id)
  return manyMachines(snap) ? `${p.name} · ${machineName(snap.machines, p.machine)}` : p.name
}

/** a list's tasks: archived ones are left out of every list and count */
export function tasksIn(snap: Snapshot, list: Pick<ListView, 'chips'>) {
  return snap.tasks.filter((t) => inList(snap, list.chips, t.place) && !t.archived)
}

/** a list's archived tasks, for its Archived view: the latest archived first */
export function archivedIn(snap: Snapshot, list: Pick<ListView, 'chips'>) {
  return snap.tasks.filter((t) => inList(snap, list.chips, t.place) && t.archived).sort((a, b) => b.archived! - a.archived!)
}

/** archive a task (its agent stops first) or bring it back */
export function archiveTask(t: Task, on: boolean) {
  const key = t.agent?.chat ?? `${t.id}/Agent`
  return act({ type: 'archive', chat: key, on })
}

/** pin a task to the top of its lists, or unpin it */
export function pinTask(t: Task, on: boolean) {
  return act({ type: 'pin', chat: t.agent?.chat ?? `${t.id}/Agent`, on })
}

/** pause a working task: its agent is interrupted and the task is To do until written to */
export function pauseTask(t: Task) {
  return act({ type: 'pause', chat: t.agent?.chat ?? `${t.id}/Agent` })
}

/** mark a task done with nothing merged: refused (held: what it holds) while it holds unmerged work, unless force */
export function closeTask(t: Task, force = false): Promise<{ ok?: boolean; error?: string; held?: string[]; waiting?: boolean }> {
  return act({ type: 'close', chat: t.agent?.chat ?? `${t.id}/Agent`, force })
}

/** delete a task for good: refused (held: what it holds) while it holds work, unless force */
export function deleteTask(t: Task, force = false): Promise<{ ok?: boolean; error?: string; held?: string[]; stopped?: boolean; waiting?: boolean }> {
  return act({ type: 'delete', chat: t.agent?.chat ?? `${t.id}/Agent`, force })
}

/** Shepherdr forgets a space (its folder stays on disk): refused (error) while one of its tasks is working, and for a
 *  home space */
export function removeSpace(placeId: string): Promise<{ ok?: boolean; error?: string; waiting?: boolean }> {
  return act({ type: 'space-remove', place: placeId })
}

/** Needs you beside the chat: the coordinator's card about a waiting task leads here */
export function openNeeds() {
  const { ui, snap } = state
  if (!snap) return
  setUI(ui.device === 'phone' ? { task: null, tab: 'needs', pick: null, plus: null, menu: false } : { task: ui.task && !taskInMiddle(ui, snap) ? null : ui.task, side: 'needs' })
}

/** What waits on you at a place: red counts its whole subtree, own only the place itself (its own coordinator's chat: the sidebar's count). */
export function counts(snap: Snapshot, placeId: string) {
  const sub = subtree(snap, placeId)
  const c = attentionCounts(snap, sub)
  const own = attentionCounts(snap, [placeId])
  // Legacy totals remain available for plugins; named categories are separate.
  return { red: c.need + c.ready, tasks: snap.tasks.filter((t) => sub.includes(t.place) && !t.archived && actionable(t)).length, own: own.need + own.ready, need: c.need, ready: c.ready, ownNeed: own.need, ownReady: own.ready }
}

/* ---------- a place's tasks, grouped (groups.ts) ---------- */

export { GROUPS, groupChoices, groupFor, namesFor, type GroupBy, type Groups, type TaskGroup } from './groups.ts'

/** a list's tasks in their groups, in the order they show: more machines' under each machine's name */
export function taskGroups(snap: Snapshot, list: ListView, by: GroupBy): TaskGroup[] {
  const tasks = tasksIn(snap, list)
  if (list.attention) return snap.places.flatMap((p) => (['need', 'ready'] as const).flatMap((status) => {
    const rows = tasks.filter((t) => t.place === p.id && t.status === status)
    return rows.length ? [{ key: `${p.id}|${status}`, label: `${p.name} · ${status === 'need' ? 'Needs you' : 'Ready'}`, note: machineName(snap.machines, p.machine), tasks: rows, names: { machine: false, project: false } }] : []
  }))
  return groupTasks(snap.places, snap.machines ?? [], tasks, by, list.level)
}

/** a list's task groups as this screen shows them: grouped as this device chose, Done cut short until Show all, a
 *  group folded shut (or under a machine folded shut) showing none of its tasks */
export function shownGroups(snap: Snapshot, list: ListView, ui: Pick<UI, 'groups' | 'allDone' | 'shut'> = state.ui) {
  const shut = (key: string) => ui.shut.includes(`${list.key}|${key}`)
  return taskGroups(snap, list, groupFor(ui.groups, list.level)).map((g) => shownGroup(g, ui.allDone.includes(`${list.key}|${g.key}`), shut(g.key) || (!!g.machine && shut(`m:${g.machine.id}`))))
}

/** fold a heading of a list's tasks shut or open ("group", "m:machine"); with siblings, them too, the same way */
export function toggleShut(listKey: string, key: string, siblings: string[] = []) {
  setUI((ui) => {
    const k = (x: string) => `${listKey}|${x}`
    const open = ui.shut.includes(k(key))
    const keys = [key, ...siblings].map(k)
    return { shut: open ? ui.shut.filter((x) => !keys.includes(x)) : [...ui.shut.filter((x) => !keys.includes(x)), ...keys], cur: 0 }
  })
}

/** Show all of a group's Done tasks, or (shown) back to the latest few */
export function toggleAllDone(listKey: string, key: string) {
  const k = `${listKey}|${key}`
  setUI((ui) => ({ allDone: ui.allDone.includes(k) ? ui.allDone.filter((x) => x !== k) : [...ui.allDone, k] }))
}

/** how lists of this level group their tasks (a place's level: 0 more machines', 1 one machine's) */
export function setGroup(level: number, by: GroupBy) {
  setUI((ui) => ({ groups: { ...ui.groups, [level === 0 ? 'all' : 'machine']: by }, lists: { ...ui.lists, chips: state.snap ? listChips(ui, state.snap) : [], at: ui.place }, cur: 0 }))
}

/** whether every word typed is in one of these, any case: ⌘K's search and the lists' filters */
export function matches(q: string, ...fields: (string | number | undefined)[]) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const all = fields.filter((f) => f !== undefined && f !== '').join(' ').toLowerCase()
  return words.every((w) => all.includes(w))
}

/** a task by its id, title, status line or summary, and its pull request's number */
export const taskMatches = (t: Task, q: string) => matches(q, t.id, t.name, t.report?.msg, t.sub, t.pr && `#${t.pr.number}`)

/** what a list is filtered by ('' while it isn't), by where its words are kept (a ListView's search) */
export const filterOf = (ui: UI, listKey: string, list: 'tasks' | 'artifacts') => ui.filter[`${listKey}|${list}`]?.trim() ?? ''

export function setFilter(listKey: string, list: 'tasks' | 'artifacts', q: string) {
  setUI((ui) => ({ filter: { ...ui.filter, [`${listKey}|${list}`]: q }, cur: 0 }))
}

/** A list's tasks filtered: in their groups, every Done one, and then its archived ones; groups with none left out */
export function filteredGroups(snap: Snapshot, list: ListView, q: string, ui: Pick<UI, 'groups'> = state.ui) {
  const groups: TaskGroup[] = taskGroups(snap, { ...list, attention: false }, groupFor(ui.groups, list.level))
  const archived = archivedIn(snap, list)
  if (archived.length) groups.push({ key: 'archived', label: 'Archived', tasks: archived, names: namesFor(list.level) })
  return groups.map((g) => ({ ...g, tasks: g.tasks.filter((t) => taskMatches(t, q)) })).filter((g) => g.tasks.length)
}

/** a list's tasks in the order they show, as the keyboard walks them: only the ones on screen */
export function orderedTasks(snap: Snapshot, list: ListView) {
  if (state.ui.archived === list.key) return archivedIn(snap, list)
  const q = filterOf(state.ui, list.search, 'tasks')
  if (q) return filteredGroups(snap, list, q).flatMap((g) => g.tasks)
  return shownGroups(snap, list).flatMap((g) => g.tasks)
}

/** what a space is, under its name in its header: a home space keeps its machine (the main machine's every machine) */
export function placeKind(snap: Snapshot, p: Place) {
  const on = machineName(snap.machines, p.machine)
  if (p.home) return !manyMachines(snap) ? 'Home space' : p.level === 0 ? 'Home · every machine' : `Home · ${on}`
  return manyMachines(snap) ? `Space on ${on}` : 'Space'
}

/** the open task's agent, whose chat is on screen */
export function agentChat(ui: UI, snap: Snapshot) {
  return taskOf(snap, ui.task)?.agent ?? null
}

/** whether a chat is still there: a space's coordinator's, or a task's agent's (an archived task's too) */
export function chatIn(snap: Snapshot) {
  const keys = new Set([...snap.places.map((p) => p.chat), ...snap.tasks.flatMap((t) => (t.agent ? [t.agent.chat] : []))])
  return (key: string) => keys.has(key)
}

/** "GTM-15 agent", "gtm" */
export function chatName(snap: Snapshot, key: string) {
  if (key.includes('/')) {
    const id = taskChatId(key)!, role = key.slice(key.lastIndexOf('/') + 1)
    return `${id} ${role.toLowerCase()}`
  }
  // a coordinator keeps its own name, even one the screen doesn't list (All machines with a single machine)
  return (snap.places.find((p) => p.chat === key) ?? placeOf(snap, key)).name
}

export function visibleChats(ui: UI, snap: Snapshot): string[] {
  const place = placeOf(snap, ui.place).chat
  const ag = agentChat(ui, snap)?.chat
  // a phone shows one chat (with a task open, its place's chat waits under it as it last was, unseen)
  if (ui.device === 'phone') return [ui.task ? ag : ui.tab === 'chat' && !ui.settings ? place : null].filter(Boolean) as string[]
  // split, each pane's chat
  const panes = panesHere(ui)
  // (focus on the open task hides them)
  if (panes.length) return [...new Set([...(focusHere(ui, snap) ? [] : panes.map((p) => paneChat(snap, p))), ag])].filter(Boolean) as string[]
  // a task in the middle covers its place's chat
  return [taskInMiddle(ui, snap) ? null : place, ag].filter(Boolean) as string[]
}

/* ---------- what the Tasks and Artifacts lists show: their chips ---------- */

/** A list as it shows now: its chips, and what is kept under its key */
export interface ListView {
  /** its folds, Show alls, filters and Archived are kept under it: a space's id, else its chips joined (*: all) */
  key: string
  /** its filter's words are kept under it: the place picked's, or the pinned chips' (*pinned), so editing the chips
   *  keeps them */
  search: string
  chips: string[]
  /** what its rows needn't say, as a place's level: 2 one space's, 1 one machine's, 0 more machines' */
  level: 0 | 1 | 2
  /** Global Home’s default, before an explicit scope or search. */
  attention?: boolean
}

const machineChip = (c: string) => c.startsWith('m:')

/** a place is in a list with these chips: one of them is it or its machine, or there are none (everything) */
export function inList(snap: Snapshot, chips: string[], placeId: string) {
  if (!chips.length || chips.includes(placeId)) return true
  const p = snap.places.find((x) => x.id === placeId)
  return !!p && chips.includes(`m:${p.machine}`)
}

/** a chip for a space or machine still listed (or just connecting) */
function known(snap: Snapshot, c: string) {
  return machineChip(c) ? (snap.machines ?? []).some((m) => m.id === c) : snap.places.some((p) => p.id === c) || !!awaited(snap, c)
}

/** The chips the lists show: pinned, theirs; following, the place picked's own, or what was made of them there. Pinned
 *  chips all gone, they follow again. */
export function listChips(ui: UI, snap: Snapshot): string[] {
  const l = ui.lists
  if (l.pinned || l.at === ui.place) {
    const chips = l.chips.filter((c) => known(snap, c))
    if (chips.length || !l.chips.length) return chips
  }
  const p = placeOf(snap, ui.place)
  return p.home && p.machine === snap.host ? [] : p.home ? [`m:${p.machine}`] : [p.id]
}

export function listOf(snap: Snapshot, chips: string[]): Omit<ListView, 'search'> {
  const machines = new Set(snap.places.filter((p) => inList(snap, chips, p.id)).map((p) => p.machine))
  const level = machines.size > 1 || (!chips.length && manyMachines(snap)) ? 0 : chips.length === 1 && !machineChip(chips[0]) ? 2 : 1
  return { key: chips.length ? [...chips].sort().join('+') : '*', chips, level }
}

let lastList: { snap: Snapshot; lists: Lists; place: string; view: ListView } | null = null

/** the lists as they show now: the same object while nothing they hang on changes, so a part can pick it */
export function listView(ui: UI, snap: Snapshot): ListView {
  if (lastList && lastList.snap === snap && lastList.lists === ui.lists && lastList.place === ui.place) return lastList.view
  const view = { ...listOf(snap, listChips(ui, snap)), search: listsPinned(ui, snap) ? '*pinned' : ui.place, attention: !!placeOf(snap, ui.place).home && placeOf(snap, ui.place).machine === snap.host && !listsPinned(ui, snap) && ui.lists.at !== ui.place }
  lastList = { snap, lists: ui.lists, place: ui.place, view }
  return view
}

/** what waits on you in a list: its tasks that need you or are ready */
export function listWaiting(snap: Snapshot, list: ListView) {
  return tasksIn(snap, list).filter((t) => t.status === 'need' || t.status === 'ready').length
}

/** a chip's words: a space's "# gtm" (with its machine where there are more: "# gtm · vm-str"), a machine's name */
export function chipName(snap: Snapshot, c: string) {
  if (machineChip(c)) return machineName(snap.machines, c.slice(2))
  return ladder(snap, c)
}

/** the lists stay on their chips whatever place is picked: pinned, on everything or on a chip still listed */
export function listsPinned(ui: UI, snap: Snapshot) {
  return ui.lists.pinned && (!ui.lists.chips.length || ui.lists.chips.some((c) => known(snap, c)))
}

/** pin the lists to the chips they show, or let them follow the picked place again; what their filters say goes with
 *  them */
export function togglePin() {
  setUI((ui) => {
    const pinned = !!state.snap && listsPinned(ui, state.snap)
    const [from, to] = pinned ? ['*pinned', ui.place] : [ui.place, '*pinned']
    const filter = { ...ui.filter }
    for (const l of ['tasks', 'artifacts']) filter[`${to}|${l}`] = ui.filter[`${from}|${l}`] ?? ''
    return {
      lists: pinned ? { pinned: false, chips: [], at: null } : { pinned: true, chips: state.snap ? listChips(ui, state.snap) : [], at: ui.place },
      filter,
      cur: 0,
    }
  })
}

/** the lists' chips changed: pinned, they stay; following, until another place is picked */
export function setChips(chips: string[]) {
  setUI((ui) => ({ lists: { ...ui.lists, chips: [...new Set(chips)], at: ui.place }, cur: 0, archived: null }))
}

/** a wide screen with the lists pinned opens a task in the middle, over its place's chat, the pinned list staying
 *  beside it; in focus the task has the window as always */
export function taskInMiddle(ui: UI, snap: Snapshot | null) {
  // split, an open task shows on the right
  return ui.device !== 'phone' && !panesHere(ui).length && !!snap && listsPinned(ui, snap) && !!taskOf(snap, ui.task) && !focusHere(ui, snap)
}

/* ---------- an open task's side panel ---------- */

/** the side panel has a column here: a desktop with a task open whose agent has started */
export function panelHere(ui: UI, snap: Snapshot) {
  return ui.device === 'desktop' && !ui.settings && !!agentChat(ui, snap)
}

/** the side panel item on screen now, if any: the open panel's tab on a desktop, the sheet on a phone or tablet */
export function shownItem(ui: UI, snap: Snapshot): string | null {
  if (!agentChat(ui, snap)) return null
  if (ui.device === 'desktop') return panelHere(ui, snap) && ui.sidebars.panelOpen ? ui.sidebars.item : null
  return ui.sheet
}

/** the task's terminal is on screen in its side panel: the server sends its screen while it is */
function panelTerm(ui: UI, snap: Snapshot) {
  return shownItem(ui, snap) === 'terminal' ? (agentChat(ui, snap)?.chat ?? null) : null
}

/** an open task in focus: it has the whole window, its coordinator chat and places hidden (desktop and tablet) */
export function focusHere(ui: UI, snap: Snapshot | null) {
  if (ui.device === 'phone' || !snap || !taskOf(snap, ui.task) || (ui.settings && ui.device === 'desktop')) return false
  const panel = panelHere(ui, snap)
  return focused(ui.sidebars, panel) || compactPanel(ui, snap)
}

/** A tool left open while resizing must still leave its task chat readable. */
function compactPanel(ui: UI, snap: Snapshot) {
  return panelHere(ui, snap) && ui.sidebars.panelOpen && innerWidth < CHAT_READ + RIGHT.min + PANEL.min
}

/** Places can dock independently of the device label, using the actual requested column widths. */
export function placesDocked(ui: UI, snap: Snapshot | null, width = innerWidth) {
  return ui.device === 'desktop' && canDock(ui.sidebars, width, !!snap && panelHere(ui, snap))
}

/** Focus and the user's toggle hide docked places; insufficient room makes them a drawer instead. */
export function placesDrawn(ui: UI, snap: Snapshot | null, width = innerWidth) {
  return ui.sidebars.open && !focusHere(ui, snap) && placesDocked(ui, snap, width)
}

/** open an item: the panel's tab on a desktop, a full-screen sheet on a phone or tablet */
export function openItem(id: string) {
  setUI((ui) => (ui.device === 'desktop' ? { sidebars: { ...showPanel(ui.sidebars, true, innerWidth), item: id }, taskMenu: false } : { sheet: id, taskMenu: false, plus: null, pick: null }))
}

/** close the sheet (its step in the history goes too) */
export function closeSheet() {
  setUI({ sheet: null })
}

/** show or hide the side panel (desktop) */
export function togglePanel() {
  setUI((ui) => ({ sidebars: showPanel(ui.sidebars, !ui.sidebars.panelOpen, innerWidth) }))
}

/** focus on an open task, or back out of it: its coordinator chat shows again (desktop and tablet) */
export function toggleFocus() {
  setUI((ui) => {
    // Showing the coordinator on a narrow window needs the tool's room. Closing it also ends automatic focus.
    if (state.snap && compactPanel(ui, state.snap)) return { sidebars: showPanel({ ...ui.sidebars, focus: false, focusAuto: false, wide: false }, false, innerWidth) }
    return { sidebars: focusTo(ui.sidebars, !!state.snap && panelHere(ui, state.snap)) }
  })
}

/** the side panel widened to most of the window, or back to its width; widening a hidden panel opens it (desktop) */
export function toggleWide() {
  setUI((ui) => ({ sidebars: ui.sidebars.panelOpen && ui.sidebars.wide ? { ...ui.sidebars, wide: false } : { ...ui.sidebars, panelOpen: true, wide: true } }))
}

/** show or hide places beside the chat (desktop); shown on a window with no room beside an open panel, the panel shuts.
 *  In focus, it shows them and the coordinator chat again. */
export function togglePlaces() {
  setUI((ui) => {
    if (!placesDocked(ui, state.snap)) return { drawer: !ui.drawer }
    if (focusHere(ui, state.snap)) {
      const out = { ...ui, sidebars: { ...focusTo(ui.sidebars, true), open: true } }
      return { sidebars: placesDrawn(out, state.snap) ? out.sidebars : { ...out.sidebars, panelOpen: false } }
    }
    if (placesDrawn(ui, state.snap)) return { sidebars: { ...ui.sidebars, open: false } }
    const opened = { ...ui.sidebars, open: true }
    return { sidebars: placesDrawn({ ...ui, sidebars: opened }, state.snap) ? opened : { ...opened, panelOpen: false } }
  })
}

export function goPlace(id: string) {
  setUI((ui) => ({ ...placeInPane(ui, id), place: id, task: null, drawer: false, settings: null, tab: 'chat', pick: null, menu: false, cur: 0, archived: null }))
}

/** a task opens straight into its agent's chat */
export function openTask(id: string) {
  const snap = state.snap
  const t = snap && taskOf(snap, id)
  // split, one open in a pane already gets the focus there
  const at = panesHere(state.ui).findIndex(samePane({ kind: 'task', id }))
  if (at >= 0) return focusPane(at)
  // the tab it was opened from stays: Back goes to it, as on iOS
  // one from the lists beside it stays over this place's chat; another goes to its own place. Split, the panes stay
  // as they are (the place is the focused pane's) and the task takes the keys
  setUI((ui) => ({
    ...(panesHere(ui).length ? { split: { ...ui.split, pane: -1 } } : {}),
    task: id,
    pick: null,
    cur: 0,
    drawer: false,
    place: t && !panesHere(ui).length && t.place !== ui.place && !inList(snap!, listChips(ui, snap!), t.place) ? t.place : ui.place,
  }))
}

export function goChat(key: string) {
  if (key.includes('/')) openTask(taskChatId(key)!)
  else setUI({ place: key, task: null, tab: 'chat', drawer: false })
}

export type Children = { children?: ReactNode }

/** an artifact full screen, at its latest (following its updates) or at a version */
export function openArtifact(id: string, v?: number) {
  setUI({ viewer: { artifact: id, v }, pick: null, plus: null, menu: false })
}

/** close it (its step in the history goes too, so Back and the close button agree) */
export function closeArtifact() {
  setUI({ viewer: null })
}

/** a list's artifacts, newest first */
export function artifactsIn(snap: Snapshot, list: Pick<ListView, 'chips'>) {
  return (snap.artifacts ?? []).filter((a) => inList(snap, list.chips, a.place))
}

/* ---------- split view ---------- */

export type { Pane } from './panes.ts'

/** the panes the middle shows: a desktop's (none: the middle as always) */
export function panesHere(ui: UI): Pane[] {
  return ui.device === 'desktop' ? ui.split.panes : NONE
}
const NONE: Pane[] = []

/** a ⌘-click (Ctrl-click off a Mac) opens in split view, as a browser opens a new tab (desktop) */
export const splitClick = (e: { metaKey: boolean; ctrlKey: boolean }) => state.ui.device === 'desktop' && (e.metaKey || e.ctrlKey)

/** the place a pane belongs to: the sidebar marks it and the lists on the right show it while it has the focus */
export function placeOfPane(snap: Snapshot, p: Pane): string | null {
  if (p.kind === 'place' || p.kind === 'tasks') return p.id
  if (p.kind === 'task') return taskOf(snap, p.id)?.place ?? null
  return snap.artifacts?.find((a) => a.id === p.id)?.place ?? null
}

/** the chat a pane shows, if any */
export function paneChat(snap: Snapshot, p: Pane): string | null {
  if (p.kind === 'place') return placeOf(snap, p.id).chat
  if (p.kind === 'task') return taskOf(snap, p.id)?.agent?.chat ?? null
  return null
}

/** the chat the keys work on (/, T, A, E): the focused pane's, else the open task's, else the place's */
export function keysChat(ui: UI, snap: Snapshot): string {
  const p = panesHere(ui)[ui.split.pane]
  return (p && paneChat(snap, p)) ?? agentChat(ui, snap)?.chat ?? placeOf(snap, ui.place).chat
}

/** the patch that puts the panes at `v`, the place following the focused one */
function splitTo(v: Panes): Partial<UI> {
  const p = v.panes[v.pane]
  const place = p && state.snap ? placeOfPane(state.snap, p) : null
  return { split: v, ...(place && state.snap ? { place: placeOf(state.snap, place).id } : {}) }
}

/** split, a place picked opens in the focused pane (or focuses the pane that has it) */
function placeInPane(ui: UI, id: string): Partial<UI> {
  if (!panesHere(ui).length) return {}
  // the open task on the right had the focus: the first pane takes it
  const at = Math.max(0, ui.split.pane)
  return { split: replaced({ ...ui.split, pane: at }, at, { kind: 'place', id }) }
}

/** how many panes the middle has room for, beside places, the lists and an open task's panel */
export function roomFor(ui: UI, snap: Snapshot, width = innerWidth) {
  const panel = panelHere(ui, snap)
  const w = fitSidebars({ ...ui.sidebars, open: placesDrawn(ui, snap, width) }, width, true, panel)
  return Math.max(1, Math.min(MAX_PANES, Math.floor((width - w.left - w.right - w.panel) / PANE_MIN)))
}

/** open in split view (desktop): beside the focused pane, or beside the middle as it shows now */
export function openSplit(p: Pane) {
  setUI((ui) => {
    const snap = state.snap
    if (ui.device !== 'desktop' || !snap) return {}
    // what the middle shows now is the first pane
    const start: Pane = taskInMiddle(ui, snap) ? { kind: 'task', id: ui.task! } : { kind: 'place', id: placeOf(snap, ui.place).id }
    const v = normal(opened(ui.split, start, p, roomFor(ui, snap)))
    // a task leaves the right for its pane (or the middle it was in)
    const task = v.panes.some((x) => x.kind === 'task' && x.id === ui.task) || start.kind === 'task' ? { task: null } : {}
    // no room for two: a place opens as the middle always shows it
    const place = !v.panes.length && p.kind === 'place' ? { place: p.id } : {}
    return { ...splitTo(v), ...place, ...task, viewer: p.kind === 'artifact' ? null : ui.viewer, menu: false, taskMenu: false }
  })
}

/** a click or the keys went into pane `i` (-1: the open task on the right) */
export function focusPane(i: number) {
  setUI((ui) => (ui.split.pane === i ? {} : splitTo({ ...ui.split, pane: i })))
}

export function closePane(i: number) {
  setUI((ui) => closing(ui, i))
}

function closing(ui: UI, i: number): Partial<UI> {
  const v = closed(ui.split, i)
  // the last place left takes the middle as always
  const last = !v.panes.length && ui.split.panes.length === 2 ? ui.split.panes[1 - i] : null
  return { ...splitTo(v), ...(last?.kind === 'place' ? { place: last.id } : {}) }
}

/** a task's pane gives way to the task opened on the right, with its side panel at `item` (its Terminal, Files, …) */
export function paneToPanel(i: number, item: string) {
  setUI((ui) => {
    const p = ui.split.panes[i]
    if (p?.kind !== 'task') return {}
    const out = closing(ui, i)
    // the task on the right has the focus now
    return { ...out, split: out.split?.panes.length ? { ...out.split, pane: -1 } : out.split, task: p.id, sidebars: { ...showPanel(ui.sidebars, true, innerWidth), item }, taskMenu: false }
  })
}

/** pane `i` the only one: a place's chat is the middle as always then */
export function onlyPane(i: number) {
  setUI((ui) => {
    const p = ui.split.panes[i]
    return { ...splitTo(only(ui.split, i)), ...(p?.kind === 'place' ? { place: p.id } : {}) }
  })
}

export function sizePanes(sizes: number[]) {
  setUI((ui) => ({ split: { ...ui.split, sizes } }))
}
