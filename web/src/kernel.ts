// The app's small kernel (3.2): the named places plugins fill, the store (the server's data and what is on screen),
// the link to the server, the address bar. Every feature is a plugin on these places; the shell (App.tsx) only lays
// them out.
import { useSyncExternalStore, type FC, type ReactNode } from 'react'
import { buildId } from '@shared/build.ts'
import { afterLoad, mayRetry, OWN_VERSION, readMark, safeNow, writeMark, type Now } from './update.ts'
import type { Action, Chat, Message, ReplyQuote, ServerEvent, Snapshot, Task, UpdateStatus } from '@shared/types.ts'
import { everything, placeOf, taskChat, taskOf, type ListFilter, type Space } from '@shared/view.ts'
import { clean, NO_FILTER, type TaskFilter } from '@shared/task-filter.ts'
import { apply, chatApply } from '@shared/patch.ts'
import type { IconName } from './icons.ts'
import { catchLink } from './applink.ts'
import { heartbeatDue, OPEN_WITHIN, PONG_LATE, PONG_WITHIN, retryIn, SAY_LOST_AFTER } from './link.ts'
import { expire, loadOutbox, prune, saveOutbox, settle, type Outgoing } from './outbox.ts'
import { setupGuarded } from './guard.tsx'
import { HttpError, wakeAll } from './uploads.ts'
import { SHOW_AFTER } from './pending.ts'
import { dismiss, toast, type ToastOpts } from './toasts.ts'

/* ---------- the places plugins fill ---------- */

/** what a chat column or a task's thread is showing: a space's chat, or a task */
export interface Thread {
  /** the chat's key on the server */
  chat: string
  /** the space it is in */
  place: string
  /** the task, when it is a task's thread */
  task?: Task
  /** where it is drawn: the middle column or the right-hand pane */
  where: 'chat' | 'pane'
}

/** One row of a menu: a popover's on a desktop, a sheet's on a phone. */
export interface MenuRow {
  icon?: IconName
  label: string
  /** quiet words at the row's right */
  value?: string
  danger?: boolean
  /** a line above it */
  line?: boolean
  /** a view it opens (Terminal, Screen): checked while that view is open */
  on?: boolean
  /** rows it folds open to (Move to group) */
  sub?: MenuRow[]
  /** the command it is too: its shortcut shows at the row's end */
  cmd?: string
  run?: () => void
}

/** One thing the app can do, from the palette (Cmd+K) and by its shortcut. A plugin registers its own; a plugin
 *  switched off takes them with it. Its id is what Settings › Shortcuts keeps a changed shortcut under: never rename one. */
export interface Command {
  /** "<plugin>.<what>", e.g. "tasks.open" */
  id: string
  title: string
  /** the sheet's and Settings › Shortcuts' heading it goes under: General, Go to, Spaces, Chat, Tasks, Terminal, Voice */
  area: string
  icon?: IconName
  /** the shortcuts it has unless changed, written for every computer: "Mod+K" (⌘K on a Mac, Ctrl+K elsewhere),
   *  "Ctrl+`" (the Control key on a Mac too), "Shift+/" (?), "G T" (G, then T) */
  keys?: string[]
  /** more words the palette finds it by */
  words?: string
  /** it can run now (a task is open, a pane is there): otherwise its shortcut passes and the palette leaves it out */
  when?: () => boolean
  run: () => void
  /** its shortcut works while a terminal has the keys too: only the palette and your own terminal */
  terminal?: boolean
  /** by its shortcut only, not a row of the palette (Space 1–9) */
  hidden?: boolean
}

export interface Pane {
  id: string
  /** fills the right-hand pane (the whole screen on a phone): header, body and foot are its own */
  View: FC
}

export interface SettingsSection {
  name: string
  icon: IconName
  order: number
  /** shown in the window for everything, in a space's, or both */
  scope: 'all' | 'space' | 'both'
  /** `place`: the space whose settings these are, or 'all' */
  View: FC<{ place: string }>
}

export interface Registry {
  /** the parts of a thread (a chat or a task), drawn by the shell in the middle and by the Tasks pane */
  views: {
    /** a chat's messages, with what plugins draw between and after them */
    messages?: FC<{ thread: Thread }>
    /** the message box: the text, then +, the agent line, the mic and the round button (Send; a voice call while empty) */
    box?: FC<{ thread: Thread; placeholder: string }>
    /** the message box's right end (voice): the mic, and the round button where Send is, a voice call while the box
     *  is empty (SHEP-363); without it the box ends with Send */
    boxEnd?: FC<{ thread: Thread; setText: (value: string) => void; filled: boolean; send: () => void; later?: () => void }>
    /** an open task's header: back, title, its menu (Terminal and Screen are in it), and Expand and Close in the pane */
    taskHead?: FC<{ task: Task; where: 'chat' | 'pane'; scrolled?: boolean }>
    /** an open task's status line, over its messages */
    taskTop?: FC<{ task: Task }>
    /** Tasks › Scheduled: the schedules of a space, or of every space (schedules) */
    scheduled?: FC<{ place: string }>
    /** a page as a picture tile: in a chat, on a review card, in the Artifacts grid (artifacts) */
    tile?: FC<{ id: string }>
    /** search: one box for spaces, tasks and artifacts */
    search?: FC<{ close: () => void }>
    /** the picker row a dialog shows for an agent choice lives in picker.tsx; the settings window in settings.tsx */
  }
  /** buttons at the right of a chat's header, in order: Artifacts, Tasks (Tasks last: it opens where its pane's Close lands). Terminal and Screen are rows of the space's
   *  name menu instead; the voice call is the message box's round button. `phone`: also in a phone's header (none: the
   *  rest live in its bottom bar) */
  header: { order: number; phone?: boolean; View: FC<{ thread: Thread }> }[]
  /** buttons in an open task's header, after its title (none today: Terminal and Screen are in its ⋯ menu) */
  taskHeader: { order: number; View: FC<{ thread: Thread }> }[]
  /** what the right-hand pane can show */
  panes: Pane[]
  /** the phone's bottom pill, after Chat */
  bar: { order: number; pane: string; label: string; icon: IconName; count?: (snap: Snapshot, place: string) => number }[]
  /** rows of a space's menu, first, before Settings: Terminal and Screen (only from the header's name: `head`), then
   *  View as terminal */
  spaceMenu: { order: number; rows: (place: Space, head: boolean) => MenuRow[] }[]
  /** rows of a task's menu (its row's and its thread's) */
  taskMenu: { order: number; rows: (task: Task, where: 'row' | 'thread') => MenuRow[] }[]
  /** drawn in a chat between its messages: under a message (cards, artifact tiles) */
  messageParts: { order: number; View: FC<{ msg: Message; chat: Chat; thread: Thread }> }[]
  /** a small mark under a message's bubble (reactions) */
  messageEdge: { order: number; View: FC<{ msg: Message; chat: Chat }> }[]
  /** a message's quick actions, first in the bar a tap or a mouse over it shows (SHEP-332: add a reaction); a phone's
   *  narrow bar shows only the first */
  messageQuick: { order: number; View: FC<{ msg: Message; chat: Chat }> }[]
  /** rows of a message's menu, and what sits above them (the emoji row) */
  messageMenu: { order: number; Top?: FC<{ msg: Message; chat: Chat; close: () => void }>; rows?: (msg: Message, chat: Chat) => MenuRow[] }[]
  /** cards the app puts in a chat from a task's status, not an agent: each sits where it came up (`at`), among the
   *  messages of that time; one without a time goes after the last message. past: history (a task's Done line), which
   *  waits for its stretch of chat to load; any other card always shows once the chat's messages are in. after: a card
   *  still waiting on you goes below the newest later message this matches (hold.ts cardsAfter) */
  chatCards: { order: number; cards: (snap: Snapshot, thread: Thread) => { key: string; at?: number; past?: boolean; after?: (m: Message) => boolean; node: ReactNode }[] }[]
  /** after a chat's messages (cards the app puts there from a task's status, the live picture, the working line) */
  chatTail: { order: number; View: FC<{ chat: Chat | undefined; thread: Thread }> }[]
  /** takes a chat's place (the agent's own terminal) */
  chatBody: { when: (ui: UI, thread: Thread) => boolean; View: FC<{ thread: Thread }> }[]
  /** above the message box, in the middle by default */
  aboveBox: { order: number; inPane?: boolean; View: FC<{ thread: Thread }> }[]
  /** in the message box's bar, before its right end (none today: the voice plugin fills views.boxEnd) */
  boxButtons: { order: number; View: FC<{ thread: Thread; setText: (value: string) => void }> }[]
  /** under a column, below its message box (your own terminal) */
  drawer: { when: (ui: UI, thread: Thread) => boolean; View: FC<{ thread: Thread }> }[]
  /** the list's brand row, before Search */
  sideHead: FC[]
  /** takes the whole middle column (an artifact expanded to the middle) */
  middle: { when: (ui: UI) => boolean; View: FC }[]
  /** whole-screen layers */
  overlays: FC[]
  /** thin lines at the very top (the link is gone) */
  topBars: FC[]
  /** sections of the settings window */
  settings: SettingsSection[]
  /** keyboard: true when handled (before the commands' shortcuts) */
  keys: { order: number; handle: (e: KeyboardEvent) => boolean }[]
  /** what the palette and the shortcuts run (commands.ts) */
  commands: Command[]
  /** a wake word on this device: the voice plugin starts a call */
  voiceWake: (() => void) | null
}

export const registry: Registry = {
  views: {},
  header: [], taskHeader: [], panes: [], bar: [], spaceMenu: [], taskMenu: [], messageParts: [], messageEdge: [], messageQuick: [],
  messageMenu: [], chatCards: [], chatTail: [], chatBody: [], aboveBox: [], boxButtons: [], drawer: [], sideHead: [], overlays: [], topBars: [], settings: [],
  keys: [], commands: [], voiceWake: null, middle: [],
}

export interface ClientPlugin {
  name: string
  setup(reg: Registry): void
}
export const definePlugin = (p: ClientPlugin) => p

let enabledNames: string[] = []
/** is this plugin on (Settings › Plugins)? */
export const has = (name: string) => enabledNames.includes(name)

export function installPlugins(plugins: ClientPlugin[], enabled: string[], user: string[] = []) {
  enabledNames = enabled
  for (const p of plugins) {
    if (user.includes(p.name)) setupGuarded(p.name, registry, (r) => p.setup(r))
    else p.setup(registry)
  }
  const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order
  for (const k of ['header', 'taskHeader', 'bar', 'spaceMenu', 'taskMenu', 'messageParts', 'messageEdge', 'messageQuick', 'messageMenu', 'chatTail', 'aboveBox', 'boxButtons', 'settings', 'keys'] as const)
    (registry[k] as { order: number }[]).sort(byOrder)
}

/* ---------- what is on screen ---------- */

export type Filter = ListFilter

/** what a machine's heading in the list shows (SHEP-342): its own filter, Active until changed */
export const shownOn = (ui: { shown?: Record<string, ListFilter> }, machine: string): ListFilter => ui.shown?.[machine] ?? 'Active'

/** an agent's browser or desktop on screen: whose (chat:<place>, task:<id>, machine:<key>), which, and who drives */
export interface ScreenAt {
  key: string
  src: 'b' | 'd'
  drive: boolean
}

export interface UI {
  /** up to 767 px: the phone layout (bottom bar, panes full screen) */
  phone: boolean
  /** up to 1023 px: opening a pane hides the list */
  narrow: boolean
  /** the space shown ('' until the first spaces are known) */
  at: string
  /** the right-hand pane: tasks, artifacts, screen, terminal (a phone's) */
  pane: string | null
  /** the open task */
  task: string | null
  /** the task maximized into the middle column (SHEP-435): it stays there, whatever the pane shows, until its own
   *  Minimize or another space; the pane's own task (`task`) is another matter */
  max: string | null
  /** the open artifact, at a version picked or its latest */
  art: string | null
  artV: number | null
  artBack: ArtifactBack | null
  /** the open artifact has the middle column */
  artWide: boolean
  tab: 'Now' | 'Scheduled'
  /** the phone's list of spaces is out */
  drawer: boolean
  /** the list is hidden (desktop) */
  sideOff: boolean
  /** SHEP-342: which spaces each machine's heading shows (by machine key; none: Active) */
  shown: Record<string, Filter>
  /** your own terminal is open under the chat (desktop), under an open task */
  term: boolean
  tterm: boolean
  /** a phone's terminal pane is a task's */
  termTask: boolean
  /** chats switched to their agent's own terminal */
  aterm: Record<string, boolean>
  scr: ScreenAt | null
  /** the Screen view fills the device: a step of its own, so the system's Back leaves it */
  scrFull: boolean
  /** repo: on Everywhere's Tasks page, the repo whose task settings it shows (Config.repos key, SHEP-335); none: Everywhere's */
  settings: { scope: string; sec: string | null; repo?: string | null } | null
  search: boolean
  /** Now's groups folded or opened by hand, by name */
  open: Record<string, boolean>
  /** groups of spaces folded shut */
  shut: Record<string, boolean>
  /** how many Done tasks show */
  doneShown: number
  /** the Tasks panel's filter (SHEP-331): nothing picked shows every task everywhere; kept on this device */
  tf: TaskFilter
  /** a voice call is on */
  call: boolean
  callMuted: boolean
  /** what the call heard or says, one line */
  /** files in each message box, not sent yet */
  files: Record<string, { name: string; path?: string; id?: string; failed?: string }[]>
  /** the message each box replies to */
  reply: Record<string, ReplyQuote & { id: string }>
  /** the on-screen keyboard is up */
  keyboard: boolean
  /** since when the link to Shepherdr is gone */
  offline: number | null
  /** a message or card to bring into view once its chat shows it (an alert's link) */
  jump: string | null
  /** A link opens its chat again even when that chat is already on screen. */
  chatLink: { place: string; task: string | null; focus: string | null } | null
  /** the artifacts grid's search box: null is closed */
  artq: string | null
  /** the warnings line was closed: the ids of the warnings it held ("a|b"), until one that isn't among them shows */
  banner: { what: string } | null
  /** the Changes pane (diff plugin): whose changes (task:<id>, space:<id>) and the file open in it */
  diff?: { src: string; file: string | null } | null
}

interface State {
  snap: Snapshot | null
  chats: Record<string, Chat>
  outbox: Outgoing[]
  update: UpdateStatus | null
  /** the web app the service serves (SHEP-337): its build and version; a page on another build updates itself */
  served: { build: string; version: string } | null
  /** what needs the person, as the service counts it while this page is off screen (it sends nothing else then) */
  needs: number | null
  ui: UI
}

const MQ = typeof matchMedia === 'function' ? matchMedia('(max-width:767px)') : null
const MQ2 = typeof matchMedia === 'function' ? matchMedia('(max-width:1023px)') : null

function stored<T>(key: string, or: T): T {
  try {
    const v = localStorage.getItem(key)
    return v === null ? or : (JSON.parse(v) as T)
  } catch {
    return or
  }
}
function store(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* a private window: gone with it */
  }
}

/** kept on this device across visits */
const KEPT: (keyof UI)[] = ['sideOff', 'shown', 'shut', 'banner', 'term', 'tf']
const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
export const launchHref = typeof location === 'undefined' ? '' : location.href

const paneOfUrl = (q: URLSearchParams) => (q.get('artifact') ? 'artifacts' : q.get('task') || (MQ?.matches && q.get('max')) ? 'tasks' : q.get('pane'))
/** the pane's task from a link: on a phone a maximized one is the pane's */
const taskOfUrl = (q: URLSearchParams) => q.get('task') ?? (MQ?.matches ? q.get('max') : null)

let state: State = {
  snap: null,
  chats: {},
  outbox: loadOutbox(),
  update: null,
  served: null,
  needs: null,
  ui: {
    phone: !!MQ?.matches,
    narrow: !!MQ2?.matches,
    at: params.get('place') ?? stored('shepherdr.at', ''),
    pane: paneOfUrl(params),
    task: taskOfUrl(params),
    // a phone has no middle beside a pane: a maximized task opens as its pane
    max: MQ?.matches ? null : params.get('max'),
    art: params.get('artifact'),
    artV: null,
    artBack: null,
    artWide: false,
    tab: 'Now',
    drawer: false,
    sideOff: false,
    shown: {},
    term: false,
    tterm: false,
    termTask: false,
    aterm: {},
    scr: null,
    scrFull: false,
    settings: null,
    search: false,
    open: {},
    shut: {},
    doneShown: 20,
    tf: NO_FILTER,
    call: false,
    callMuted: false,
    files: {},
    reply: {},
    keyboard: false,
    offline: null,
    jump: params.get('focus'),
    chatLink: params.has('focus') ? { place: params.get('place') ?? '', task: params.get('task') ?? params.get('max'), focus: params.get('focus') } : null,
    artq: null,
    banner: null,
    ...stored<Partial<UI>>('shepherdr.ui', {}),
  },
}
// a filter kept from an older build, or left half-written: whatever is off counts as nothing picked
state.ui.tf = clean(state.ui.tf)

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
export const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export const getState = () => state

/** what makes a step in the browser's history: Back closes a task, a pane, the settings */
const ART_ROUTE = ['at', 'pane', 'task', 'art', 'max'] as const
const STEPS: (keyof UI)[] = ['at', 'pane', 'task', 'art', 'max', 'artWide', 'scrFull', 'settings', 'drawer', 'search']

export function setUI(patch: Partial<UI> | ((ui: UI) => Partial<UI>)) {
  const ui = state.ui
  const change = typeof patch === 'function' ? patch(ui) : patch
  const leftArtifact = ui.artBack && !('artBack' in change) && ART_ROUTE.some((k) => k in change && change[k] !== ui[k])
  const p = leftArtifact ? { ...change, artBack: null } : change
  const keys = Object.keys(p) as (keyof UI)[]
  if (keys.every((k) => Object.is(p[k], state.ui[k]))) return
  state = { ...state, ui: { ...state.ui, ...p } }
  if (keys.some((k) => KEPT.includes(k))) store('shepherdr.ui', Object.fromEntries(KEPT.map((k) => [k, state.ui[k]])))
  if (p.at) store('shepherdr.at', p.at)
  if (keys.some((k) => STEPS.includes(k))) writeUrl(false)
  watchVisible()
  emit()
}

/** Pick only what a part shows: it redraws when that changes. */
export function useStore<T>(pick: (s: State) => T): T {
  const get = () => pick(state)
  // the same on a server render (tests draw parts with react-dom/server)
  return useSyncExternalStore(subscribe, get, get)
}
export function useUI(): UI
export function useUI<T>(pick: (ui: UI) => T): T
export function useUI<T>(pick?: (ui: UI) => T) {
  return useStore((s) => (pick ? pick(s.ui) : s.ui))
}
export const useSnap = () => useStore((s) => s.snap)
export const useChat = (key: string | null | undefined) => useStore((s) => (key ? s.chats[key] : undefined))

/* ---------- drafts: a letter typed redraws only its own box ---------- */

let drafts: Record<string, string> = stored('shepherdr.drafts', {})
const draftListeners = new Set<() => void>()
export const getDraft = (key: string): string => drafts[key] ?? ''
export function setDraft(key: string, text: string) {
  if ((drafts[key] ?? '') === text) return
  drafts = { ...drafts, [key]: text }
  if (!text) delete drafts[key]
  store('shepherdr.drafts', drafts)
  draftListeners.forEach((l) => l())
}
export function useDraft(key: string): [string, (v: string) => void] {
  const v = useSyncExternalStore(
    (l) => {
      draftListeners.add(l)
      return () => void draftListeners.delete(l)
    },
    () => drafts[key] ?? '',
  )
  return [v, (t) => setDraft(key, t)]
}

/* ---------- the outbox: what you sent shows at once ---------- */

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
if (typeof window !== 'undefined')
  setInterval(() => {
    const out = expire(state.outbox, Date.now(), (chat) => !!state.chats[chat]?.working)
    if (out === state.outbox) return
    putOutbox(out)
    emit()
  }, 2000)

/* ---------- the address bar and Back ---------- */

type Step = Pick<UI, 'at' | 'pane' | 'task' | 'art' | 'max' | 'artWide' | 'scrFull' | 'settings' | 'drawer' | 'search'>
const stepOf = (ui: UI): Step => ({ at: ui.at, pane: ui.pane, task: ui.task, art: ui.art, max: ui.max, artWide: ui.artWide, scrFull: ui.scrFull, settings: ui.settings, drawer: ui.drawer, search: ui.search })

function urlOf(s: Step) {
  const q = new URLSearchParams()
  if (s.at) q.set('place', s.at)
  if (s.max) q.set('max', s.max)
  if (s.task) q.set('task', s.task)
  else if (s.art) q.set('artifact', s.art)
  else if (s.pane) q.set('pane', s.pane)
  const t = q.toString()
  return location.pathname + (t ? `?${t}` : '')
}

let written = ''
/** the next change is a step of its own, which Back undoes (a link followed in the app) */
let stepNext = false
function writeUrl(replace: boolean) {
  if (typeof history === 'undefined') return
  const step = stepOf(state.ui)
  const key = JSON.stringify(step)
  if (key === written) return
  // going deeper is a step Back undoes; anything else takes the place of the one on screen
  const deeper = !replace && written !== '' && (stepNext || depth(step) > depth(JSON.parse(written) as Step))
  written = key
  if (deeper) history.pushState({ shep: 2, step }, '', urlOf(step))
  else history.replaceState({ shep: 2, step }, '', urlOf(step))
}
const depth = (s: Step) => (s.drawer || s.search ? 1 : 0) + (s.settings ? 1 + (s.settings.sec ? 1 : 0) : 0) + (s.pane ? 1 : 0) + (s.task || s.art ? 1 : 0) + (s.max ? 1 : 0) + (s.artWide ? 1 : 0) + (s.scrFull && s.pane === 'screen' ? 1 : 0)

if (typeof window !== 'undefined') {
  // The chat and terminal position themselves when a history entry comes back.
  history.scrollRestoration = 'manual'
  addEventListener('popstate', (e) => {
    const st = (e as PopStateEvent).state as { shep?: number; step?: Step } | null
    const q = new URLSearchParams(location.search)
    const step: Partial<Step> = st?.shep === 2 && st.step ? st.step : { at: q.get('place') ?? state.ui.at, task: taskOfUrl(q), art: q.get('artifact'), pane: paneOfUrl(q), max: MQ?.matches ? null : q.get('max'), artWide: false, scrFull: false, settings: null, drawer: false, search: false }
    state = { ...state, ui: { ...state.ui, ...step, artBack: null, jump: q.get('focus'), chatLink: null } }
    written = JSON.stringify(stepOf(state.ui))
    stayOnShown()
    watchVisible()
    emit()
  })
  // folding to a phone: a maximized task becomes the open pane's task, as a phone shows one
  const sized = () =>
    setUI((ui) => ({ phone: !!MQ?.matches, narrow: !!MQ2?.matches, ...(MQ?.matches ? (ui.max ? { max: null, task: ui.max, pane: 'tasks', art: null } : {}) : { drawer: false }) }))
  MQ?.addEventListener('change', sized)
  MQ2?.addEventListener('change', sized)
}

/** go where a link points (an alert's, or a link in the app to the app): its space, task, artifact or card.
    `step`: a step of its own, so Back returns to what was on screen (SHEP-339). */
export function openLink(href: string, step = false) {
  const q = new URL(href, location.href).searchParams
  const place = q.get('place')
  const task = q.get('task')
  const art = q.get('artifact')
  const pane = q.get('pane')
  const max = q.get('max')
  const focus = q.get('focus')
  const chatLink = !art && (task || max || !pane) ? { place: place ?? state.ui.at, task: task ?? max, focus } : null
  const targetTask = state.snap && chatLink?.task ? taskOf(state.snap, chatLink.task) : undefined
  const targetPlace = state.snap && chatLink && !chatLink.task ? placeOf(state.snap, chatLink.place) : undefined
  const chat = targetTask ? taskChat(targetTask) : targetPlace?.chat
  const clearMax = (task && task === state.ui.max) || (place && (place !== state.ui.at || (chatLink && !chatLink.task)))
  stepNext = step
  try {
    setUI({
      settings: null,
      drawer: false,
      search: false,
      ...(place ? { at: place } : {}),
      task: task ?? (state.ui.phone ? max : null),
      art,
      ...(art ? { artV: null, artBack: step && (!place || place === state.ui.at) ? artifactBackFrom(state.ui, art) : null } : {}),
      pane: art ? 'artifacts' : task || (max && state.ui.phone) ? 'tasks' : pane && pane !== 'screen' ? pane : state.ui.phone ? null : state.ui.pane,
      // A space link gives the middle back to the space. A task link must show the task only once.
      max: max && !state.ui.phone ? max : clearMax ? null : state.ui.max,
      artWide: false,
      scrFull: false,
      jump: focus,
      chatLink,
      ...(chat && state.ui.aterm[chat] ? { aterm: { ...state.ui.aterm, [chat]: false } } : {}),
    })
  } finally {
    stepNext = false
  }
}

// a tap on a link to this same app opens it here, never reloading the page; another site's goes to a new tab
if (typeof document !== 'undefined')
  document.addEventListener('click', (e) =>
    catchLink(e, location.href, (u) => openLink(u.href, true), (href) => void window.open(href, '_blank', 'noopener,noreferrer')),
  )

/* ---------- the link to the server ---------- */

let ws: WebSocket | null = null
let watched = ''

export async function act<T = { ok?: boolean; error?: string; [k: string]: unknown }>(a: Action | ({ type: string } & Record<string, unknown>), signal?: AbortSignal): Promise<T> {
  const r = await fetch('api/action', { method: 'POST', headers: { 'content-type': 'application/json', 'x-shepherdr': '1' }, body: JSON.stringify(a), signal })
  // with its status: a proxy's 502 is the network (uploads.ts transient), the server's own no is not
  if (!r.ok) throw new HttpError(r.status, (await r.text()) || `${r.status}`)
  return r.json().catch(() => ({})) as Promise<T>
}

/** an action asked of the server: null when it said yes, else its words why not (never thrown) */
export async function attempt(a: { type: string } & Record<string, unknown>): Promise<string | null> {
  try {
    const r = await act(a)
    return r.ok === false ? r.error || 'That did not work.' : null
  } catch (e) {
    return e instanceof Error && e.message ? e.message : 'That did not work.'
  }
}

/** an action whose failure is said in a small notice instead of thrown. `doing`: what it does, said in the notice with
 *  a spinner while it takes longer than a moment (a menu's row is gone once tapped: the notice is its answer) */
export async function tryAct(a: { type: string } & Record<string, unknown>, done?: string, doing?: string): Promise<boolean> {
  let spin = 0
  const busy = doing ? setTimeout(() => (spin = notice(doing, { busy: true })), SHOW_AFTER) : null
  const error = await attempt(a)
  if (busy) clearTimeout(busy)
  if (spin) dismiss(spin)
  if (error !== null) notice(error, { tone: 'error' })
  else if (done) notice(done, { tone: 'ok' })
  return error === null
}

/* a small notice at the top (the design system's toast): toasts.ts holds how long each stays and when it waits */
/** shows a toast and returns its id; a number is the old form's least time in ms, `busy` a spinner beside its words */
export function notice(text: string, o: ToastOpts | number = {}, busy = false): number {
  return toast(text, typeof o === 'number' ? { ms: o, busy } : o)
}
export { dismiss as dismissNotice }

let tries = 0
let retrying: ReturnType<typeof setTimeout> | null = null
let opening: ReturnType<typeof setTimeout> | null = null
let pinging: ReturnType<typeof setTimeout> | null = null
let saying: ReturnType<typeof setTimeout> | null = null
let downSince: number | null = null
let pruned = false
let tried = 0
/** each chat as the service last sent it (its patches build on that, not on what the screen made of it) */
const sentChats = new Map<string, Chat>()
/** when the link last heard from the server */
let heard = 0

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
    heard = Date.now()
    tries = 0
    downSince = null
    if (saying) clearTimeout(saying)
    saying = null
    watched = ''
    sentChats.clear()
    // the link is back: what waits to send goes now
    wakeAll()
    if (state.ui.offline) setUI({ offline: null })
    watchVisible()
  }
  sock.onmessage = (ev) => {
    heard = Date.now()
    if (pinging) clearTimeout(pinging)
    pinging = null
    if (typeof ev.data !== 'string') return
    let msg = JSON.parse(ev.data) as ServerEvent
    if (msg.type === 'pong') return
    // what changed since the snapshot or chat this page has (#1468); one it can't build on: all of it again
    if (msg.type === 'needs') {
      state = { ...state, needs: msg.n }
      return emit()
    }
    if (msg.type === 'patch') {
      if (!state.snap) return sock.send(JSON.stringify({ type: 'resync' }))
      msg = { type: 'snapshot', snapshot: apply(state.snap, msg.patch) }
    } else if (msg.type === 'chatp') {
      const chat = chatApply(sentChats.get(msg.key), msg)
      if (!chat) return sock.send(JSON.stringify({ type: 'resync' }))
      msg = { type: 'chat', chat }
    }
    if (msg.type === 'show') return setUI({ art: msg.artifact, artV: null, artBack: null, pane: 'artifacts', task: null })
    if (msg.type === 'voice') return registry.voiceWake?.()
    if (msg.type === 'go') return openLink(msg.url)
    if (msg.type === 'snapshot') {
      // a plugin switched on or off in Settings › Plugins: the page starts again with it in or out (main.tsx)
      const booted = (window as { shepherdrOff?: string[] }).shepherdrOff
      if (booted && msg.snapshot.off && [...msg.snapshot.off].sort().join() !== [...booted].sort().join()) return location.reload()
      state = { ...state, snap: msg.snapshot }
      stayOnShown()
      if (!pruned && msg.snapshot.machines.every((m) => !m.connecting && m.status !== 'off')) {
        const keys = new Set([...msg.snapshot.places.map((p) => p.chat), ...msg.snapshot.tasks.flatMap((t) => (t.agent ? [t.agent.chat] : []))])
        putOutbox(prune(state.outbox, Date.now(), (c) => keys.has(c)))
        pruned = true
      }
      watchVisible()
    } else if (msg.type === 'chat') {
      sentChats.set(msg.chat.key, msg.chat)
      const was = state.chats[msg.chat.key]
      // a chat with no agent yet (not started, or ended): the conversation the screen shows stays
      const chat = msg.chat.fresh && was && !was.fresh && was.messages.length ? { ...was, agent: msg.chat.agent, cli: msg.chat.cli } : msg.chat
      state = { ...state, chats: { ...state.chats, [msg.chat.key]: chat } }
      if (!msg.chat.fresh) putOutbox(settle(state.outbox, msg.chat))
    } else if (msg.type === 'update') state = { ...state, update: msg.update }
    else if (msg.type === 'build') {
      state = { ...state, served: { build: msg.id, version: msg.version ?? '' } }
      if (BUILD && msg.id && msg.id !== BUILD) reloadSoon()
    } else return
    emit()
  }
  sock.onclose = () => drop(sock)
}

function drop(sock: WebSocket) {
  if (sock !== ws) return
  forget()
  downSince ??= Date.now()
  saying ??= sayLater()
  retrying = setTimeout(connect, retryIn(tries++))
}

function forget() {
  if (!ws) return
  ws.onopen = ws.onmessage = ws.onclose = null
  ws.close()
  ws = null
  clearTimeout(opening!)
  if (pinging) clearTimeout(pinging)
  pinging = null
}

/** say the link is gone in a few seconds, unless it is back by then */
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

if (typeof document !== 'undefined') {
  // on screen, a quiet link is checked now and then: one dead without closing is replaced, and its chats come again
  setInterval(() => {
    if (ws?.readyState !== WebSocket.OPEN || !heartbeatDue(Date.now(), heard, document.visibilityState === 'visible', !!pinging)) return
    const sock = ws
    pinging = setTimeout(() => {
      tries = 0
      drop(sock)
    }, PONG_LATE)
    sock.send(JSON.stringify({ type: 'ping' }))
  }, 5000)
  document.addEventListener('visibilitychange', wake)
  addEventListener('pageshow', (e) => (e as PageTransitionEvent).persisted && wake())
  addEventListener('online', wake)
  document.addEventListener('visibilitychange', () => watchVisible())
}

let pushEndpoint: string | null = null
/** This device's push subscription (alerts sets it): while the app is on screen, the server sends it no alerts. */
export function setPushEndpoint(endpoint: string | null) {
  pushEndpoint = endpoint
  watchVisible()
}

/** more chats a part wants kept fresh while it shows (a search result's preview) */
const extra = new Set<string>()
export function watchAlso(key: string) {
  extra.add(key)
  watchVisible()
  return () => {
    extra.delete(key)
    watchVisible()
  }
}

/** The space and every open task, including one opened directly into the middle column. */
export function visibleChats(ui: UI, snap: Snapshot): string[] {
  const keys = new Set<string>(extra)
  const p = placeOf(snap, ui.at)
  if (p) keys.add(p.chat)
  for (const id of [ui.task, ui.max]) {
    const task = taskOf(snap, id)
    if (task) keys.add(taskChat(task))
  }
  return [...keys]
}

function watchVisible() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !state.snap) return
  const keys = visibleChats(state.ui, state.snap)
  const visible = document.visibilityState === 'visible'
  const next = JSON.stringify({ keys, visible, pushEndpoint })
  if (next === watched) return
  watched = next
  ws.send(JSON.stringify({ type: 'watch', chats: keys, term: null, visible, push: pushEndpoint }))
}

/** The screen stays on a space the list has, else goes to Everything. */
function stayOnShown() {
  const { snap, ui } = state
  if (!snap) return
  const here = placeOf(snap, ui.at)
  const at = here?.id ?? everything(snap)?.id ?? ''
  const gone = (id: string | null) => !!id && !taskOf(snap, id) && !snap.machines.some((m) => m.connecting)
  const task = gone(ui.task) ? null : ui.task
  const max = gone(ui.max) ? null : ui.max
  if (at === ui.at && task === ui.task && max === ui.max) return
  state = { ...state, ui: { ...ui, at, task, max, artBack: at === ui.at ? ui.artBack : null } }
  writeUrl(true)
}

/* ---------- a new build: the page reloads once nothing would be lost (SHEP-337, update.ts) ---------- */

export const BUILD = typeof document === 'undefined' ? '' : buildId(document.head.innerHTML)
let reloading: ReturnType<typeof setInterval> | null = null
let holds = 0
let touched = Date.now()
if (typeof window !== 'undefined') {
  for (const ev of ['input', 'keydown', 'pointerdown', 'wheel', 'touchstart']) addEventListener(ev, () => (touched = Date.now()), { capture: true, passive: true })
  // the line after an update, once; a reload that brought the same page back is kept, so it isn't tried again soon
  const after = afterLoad(readMark(), BUILD, OWN_VERSION, Date.now())
  writeMark(after.keep)
  // said once the page is on screen: an update while it was hidden is told when you come back
  const say = () => {
    const said = after.said
    if (!said || document.visibilityState !== 'visible') return
    document.removeEventListener('visibilitychange', say)
    after.said = null
    setTimeout(() => notice(said, { ms: 5000 }), 600)
  }
  if (after.said) {
    document.addEventListener('visibilitychange', say)
    say()
  }
}

/** Hold off reloading while something can't be picked up again (an upload on its way, dictation). Returns the release. */
export function holdReload() {
  holds++
  let done = false
  return () => {
    if (!done) holds--
    done = true
  }
}

/** the service serves a newer web app than this page runs */
export const newerServed = (s: State) => !!(BUILD && s.served?.build && s.served.build !== BUILD)

/** what reloading now would lose */
function nowFacts(): Now {
  const words = [...document.querySelectorAll('textarea')].some((t) => t.value.trim() !== '')
  return {
    holds,
    call: state.ui.call,
    modal: !!document.querySelector('[aria-modal="true"]') || !!state.ui.settings,
    composer: words,
    hidden: document.visibilityState === 'hidden',
    idleMs: Date.now() - touched,
  }
}

/** Reload onto the new web app now (the chip's Update, Settings › About): what was typed and where you were stay. */
export function updateNow() {
  writeMark({ from: BUILD, to: state.served?.build ?? '', at: Date.now() })
  location.reload()
}

function reloadSoon() {
  if (reloading) return
  const tryNow = () => {
    if (!newerServed(state)) return
    if (!mayRetry(readMark(), BUILD, Date.now()) || !safeNow(nowFacts())) return
    updateNow()
  }
  reloading = setInterval(tryNow, 2000)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', tryNow)
  tryNow()
}

/* ---------- going places ---------- */

/** show a space's chat */
export function go(place: string) {
  setUI((ui) => ({
    at: place,
    drawer: false,
    // any space's chat in the middle: a maximized task gives it back
    max: null,
    artWide: false,
    search: false,
    jump: null,
    chatLink: null,
    // another space: the open task goes with the one it was opened in
    ...(ui.phone ? { pane: null, task: null, art: null } : { task: null }),
    ...(ui.pane === 'screen' && ui.scr ? (ui.scr.key.startsWith('chat:') ? { scr: { key: `chat:${place}`, src: 'b' as const, drive: false } } : { pane: null }) : {}),
  }))
}

/** open a task in the pane (one not started yet opens its Start dialog instead: the tasks plugin decides); a task
 *  maximized in the middle stays there */
export function openTask(id: string) {
  const shut = { artWide: false, drawer: false, search: false, settings: null, jump: null, chatLink: null }
  // the one already in the middle stays there, not shown twice
  if (getState().ui.max === id) return setUI(shut)
  setUI({ ...shut, task: id, pane: 'tasks', art: null })
}

/** a task's chat takes the middle and stays (SHEP-435): the pane it was in closes, free for anything else */
export function maximize(id: string) {
  setUI((ui) => ({ max: id, artWide: false, ...(ui.task === id ? { task: null, pane: null } : {}) }))
}

/** the maximized task goes back to the pane, the space's chat back to the middle */
export function minimize() {
  setUI((ui) => (ui.max ? { max: null, task: ui.max, pane: 'tasks', art: null, artWide: false } : {}))
}

type ArtifactBack = Pick<UI, 'pane' | 'task' | 'art' | 'artV' | 'artWide' | 'drawer' | 'search' | 'artBack'>

function artifactBackFrom(ui: UI, id: string): ArtifactBack | null {
  const { pane, task, art, artV, artWide, drawer, search, artBack } = ui
  return art === id ? artBack : { pane, task, art, artV, artWide, drawer, search, artBack }
}

export function openArtifact(id: string, v: number | null = null) {
  setUI((ui) => ({ art: id, artV: v, artBack: artifactBackFrom(ui, id), pane: 'artifacts', task: null, artWide: false, drawer: false, search: false, settings: null }))
}

export function backFromArtifact() {
  setUI((ui) => {
    const back = ui.artBack
    if (!back) return { art: null, artV: null }
    if (back.task && state.snap && !taskOf(state.snap, back.task)) return { ...back, task: null }
    return back
  })
}

/** open or close a pane from its button: pressed again on a desktop, it closes */
export function togglePane(pane: string | null) {
  setUI((ui) => {
    if (!pane) return { pane: null, task: null, art: null, artWide: false }
    const shut = ui.pane === pane && !ui.phone
    return { pane: shut ? null : pane, task: null, art: null, artWide: false }
  })
}

export function openSettings(scope = 'all', sec: string | null = null, repo: string | null = null) {
  setUI({ settings: { scope, sec, ...(repo ? { repo } : {}) }, drawer: false })
}

/** the list is hidden: by its button, or by an open pane on a narrow window */
export const sideHidden = (ui: UI) => ui.phone || ui.sideOff || (ui.narrow && !!ui.pane)

export type { Outgoing, ReactNode }
