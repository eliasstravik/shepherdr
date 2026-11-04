// The app's own Back. Every screen it opens is a step in the browser's history: a place, a task, and the layers over
// them (the places drawer, settings, search, a task's sheet, an artifact, a picture, Add a
// project, a place's archived tasks). So iOS's swipe back, Android's back and the browser's Back go one step back inside the app (task, then
// place, then the places list it was picked from), and closing a screen takes its step back out, so Back never lands
// on a screen you closed. A link from an alert gets the steps that lead to it, so Back from its task goes to its place.
import type { UI } from './kernel.ts'

/** what of the screen is a step in the history */
export type Screen = Pick<UI, 'place' | 'task' | 'tab' | 'sheet' | 'viewer' | 'settings' | 'search' | 'drawer' | 'photo' | 'adding' | 'archived'>

/** the layers over a place or task, each its own step */
const LAYERS = ['drawer', 'settings', 'search', 'sheet', 'viewer', 'photo', 'adding', 'archived'] as const

/** a history entry as the app writes it: its screen, and the step before it (to tell a close from a new step) */
export interface Entry {
  shep: 1
  key: string
  prev: string | null
  screen: Screen
}

export function screenOf(ui: Screen): Screen {
  const { place, task, tab, sheet, viewer, settings, search, drawer, photo, adding, archived } = ui
  return { place, task, tab, sheet, viewer, settings, search, drawer, photo, adding, archived }
}

/** settings: shut, a phone's list of sections, or a section */
const settingsStep = (s: Screen) => (!s.settings ? 0 : s.settings.section === null ? 1 : 2)

/** Which step a screen is. Switching tabs, a settings section, an artifact's version or the picture shown is the same
 *  step: it replaces it rather than adding one. A section opened from a phone's list of them is a step of its own. */
export function stepKey(s: Screen) {
  return JSON.stringify([s.place, s.task, s.sheet, s.viewer?.artifact ?? null, settingsStep(s), s.search, s.drawer, !!s.photo, !!s.adding, s.archived])
}

const open = (s: Screen, l: (typeof LAYERS)[number]) => !!s[l]

/**
 * How a change of screen goes into the history: the same step is replaced; the step before is gone back to (a close),
 * so Back can't land on it again; closing or swapping layers over the same place and task replaces the step (search
 * opened from the drawer takes the drawer's step); anything else (another place or task, a layer opened) is a step.
 */
export function decide(entry: Entry | null, next: Screen): 'push' | 'replace' | 'back' {
  if (!entry) return 'replace'
  const k = stepKey(next)
  if (k === entry.key) return 'replace'
  if (k === entry.prev) return 'back'
  const cur = entry.screen
  if (cur.place !== next.place || cur.task !== next.task) return 'push'
  if (settingsStep(cur) === 1 && settingsStep(next) === 2) return 'push'
  const opened = LAYERS.some((l) => open(next, l) && !open(cur, l))
  const closed = LAYERS.some((l) => !open(next, l) && open(cur, l))
  return opened && !closed ? 'push' : 'replace'
}

/** nothing over the place or task */
const bare = (s: Screen): Screen => ({ ...s, sheet: null, viewer: null, settings: null, search: false, drawer: false, photo: null, adding: false, archived: null })

/** The steps that lead to a screen opened from a link (an alert): its place, then its task, then what is open over
 *  it; one step when it is just a place. */
export function stepsTo(s: Screen): Screen[] {
  const place = { ...bare(s), task: null, tab: s.task ? ('chat' as const) : s.tab }
  const steps: Screen[] = [place]
  if (s.task) steps.push({ ...bare(s), task: s.task })
  if (stepKey(s) !== stepKey(steps[steps.length - 1])) steps.push(s)
  return steps
}

/** the address of a screen: its space (by its machine and name, "vm-str/gtm"), task, tab (phone), and a sheet or
 *  artifact open over it */
export function urlOf(s: Screen, phone: boolean, path = location.pathname, slug: (id: string) => string = (id) => id) {
  const q = new URLSearchParams()
  q.set('place', slug(s.place))
  if (s.task) q.set('task', s.task)
  if (phone && !s.task && s.tab !== 'chat') q.set('tab', s.tab)
  if (s.task && s.sheet) q.set('item', s.sheet)
  if (s.viewer) q.set('artifact', s.viewer.artifact)
  return `${path}?${q}`
}

/** a screen from an address the app didn't write (an old bookmark, a link): what it names, nothing else open */
export function screenOfUrl(search: string, desktop: boolean, tabOf: (t: string | null) => UI['tab']): Partial<UI> {
  const q = new URLSearchParams(search)
  return {
    place: q.get('place') ?? 'all',
    task: q.get('task'),
    tab: tabOf(q.get('tab')),
    viewer: q.get('artifact') ? { artifact: q.get('artifact')! } : null,
    sheet: q.get('task') && !desktop ? q.get('item') : null,
    settings: null,
    search: false,
    drawer: false,
    photo: null,
    adding: false,
    archived: null,
  }
}

/* ---------- a swipe the system did ---------- */

// iOS's own swipe back (in Safari, and in an app on the home screen) slides the page itself: the app shouldn't slide
// it again when the step back lands. A touch near a screen edge that is on, or just ended, marks such a Back.
let edge = 0
if (typeof addEventListener === 'function') {
  addEventListener('touchstart', (e) => {
    const t = (e as TouchEvent).touches
    const x = t[0]?.clientX ?? 100
    if (t.length === 1 && (x < 30 || x > innerWidth - 30)) edge = Infinity
  }, { capture: true, passive: true })
  const up = () => edge === Infinity && (edge = performance.now())
  addEventListener('touchend', up, { capture: true, passive: true })
  addEventListener('touchcancel', up, { capture: true, passive: true })
}

/** a Back now comes from the system's own swipe, which already slid the screen */
export const systemSwipe = () => performance.now() - edge < 700
