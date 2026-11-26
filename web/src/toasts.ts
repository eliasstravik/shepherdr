/* The app's toasts: small notices at the top, one shared behaviour for all of them. Each stays long enough to read
   (by its kind and its length), waits while it is hovered or focused and while the tab is in the background, has its
   own close button, and several stack instead of replacing each other. Drawn by App.tsx's Toasts. */

/** ok: a short confirmation ("Copied"); info: something to know; error: something went wrong */
export type Tone = 'ok' | 'info' | 'error'
export type ToastOpts = {
  tone?: Tone
  /** at least this long, ms (its words may keep it longer) */
  ms?: number
  /** something still going: a spinner beside its words; it stays until it is dismissed or `ms` runs out */
  busy?: boolean
  /** stays until it is closed: an error that asks the person to do something */
  sticky?: boolean
  /** more words under its first line (an agent's alert's body) */
  sub?: string
  /** a button that goes where it is about ("Open") */
  act?: { label: string; run: () => void }
}
export type Toast = { id: number; text: string; tone: Tone; busy: boolean; sticky: boolean; sub?: string; act?: ToastOpts['act'] }

/** the most shown at once: an older one gives its place to a new one */
export const MAX = 3
const WPM_MS = 300 // ms a word: about 200 words a minute, read on a glance

/** ms a toast stays: a confirmation a few seconds, a longer one by its words, an error longer still */
export function lasts(text: string, tone: Tone = 'info', ms = 0): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const read = 1500 + words * WPM_MS
  const by = tone === 'error' ? Math.max(7000, read + 2000) : tone === 'ok' ? Math.max(3000, read) : Math.max(4000, read)
  return Math.max(ms, Math.min(by, 30_000))
}

type Live = Toast & { left: number; since: number; timer: ReturnType<typeof setTimeout> | null }
let live: Live[] = []
let shown: Toast[] = []
let next = 1
const holds = new Set<string>()
const listeners = new Set<() => void>()

function changed() {
  shown = live.map(({ id, text, tone, busy, sticky, sub, act }) => ({ id, text, tone, busy, sticky, sub, act }))
  listeners.forEach((l) => l())
}
function run(t: Live) {
  if (t.timer) clearTimeout(t.timer)
  t.timer = null
  if (t.sticky || holds.size) return
  t.since = Date.now()
  t.timer = setTimeout(() => dismiss(t.id), Math.max(0, t.left))
}
function stop(t: Live) {
  if (!t.timer) return
  clearTimeout(t.timer)
  t.timer = null
  t.left -= Date.now() - t.since
}

/** shows a toast and returns its id. The same words again take the old one's place and start its time over. */
export function toast(text: string, o: ToastOpts = {}): number {
  const tone = o.tone ?? 'info'
  const same = live.find((t) => t.text === text)
  if (same) dismiss(same.id, true)
  const t: Live = { id: next++, text, tone, busy: !!o.busy, sticky: !!o.sticky, sub: o.sub, act: o.act, left: o.busy ? (o.ms ?? 60_000) : lasts(o.sub ? `${text} ${o.sub}` : text, tone, o.ms), since: 0, timer: null }
  live = [...live, t]
  while (live.length > MAX) dismiss(live[0].id, true)
  run(t)
  changed()
  return t.id
}

export function dismiss(id: number, quiet = false) {
  const t = live.find((x) => x.id === id)
  if (!t) return
  if (t.timer) clearTimeout(t.timer)
  live = live.filter((x) => x !== t)
  // the last one gone: a pointer or focus left on it can't say so any more
  if (!live.length) (holds.delete('hover'), holds.delete('focus'))
  if (!quiet) changed()
}

/** a reason the toasts wait ('hover', 'focus', 'hidden'): their time stops until every reason is gone */
export function hold(why: string, on: boolean) {
  const was = holds.size > 0
  if (on) holds.add(why)
  else holds.delete(why)
  if (was === holds.size > 0) return
  for (const t of live) (on ? stop(t) : run(t))
}

export const toasts = () => shown
export function subscribe(l: () => void) {
  listeners.add(l)
  return () => void listeners.delete(l)
}

if (typeof document !== 'undefined') {
  const vis = () => hold('hidden', document.visibilityState === 'hidden')
  document.addEventListener('visibilitychange', vis)
  vis()
}

/** for tests: no toasts, no holds */
export function reset() {
  for (const t of live) if (t.timer) clearTimeout(t.timer)
  live = []
  holds.clear()
  changed()
}
