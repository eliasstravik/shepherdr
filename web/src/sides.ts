// SHEP-336: which side the chat is on, beside a pane (Tasks, a task, Artifacts, a terminal or a screen). The chat
// header's menu (Move the chat to the right / left), a double tap on the divider, or Settings › General flips it. There
// is no button on the divider: it floated over the content and drew the eye (SHEP-352). It is kept on this device, one choice
// per layout: a phone has no split (the chat is always its own screen); an unfolded fold or a tablet (a touch screen,
// or a window under 1024 px) and a desktop each keep their own, so flipping one never moves the other.
import { useSyncExternalStore } from 'react'
import { getState, subscribe as subscribeUI, type MenuRow } from './kernel.ts'

export type Layout = 'phone' | 'tablet' | 'desktop'
export type Side = 'left' | 'right'
type Kept = Partial<Record<Exclude<Layout, 'phone'>, Side>>

const KEY = 'shepherdr.sides'
const COARSE = '(pointer: coarse)'
const coarseQ = typeof matchMedia === 'function' ? matchMedia(COARSE) : null

/** the layout class: a phone, an unfolded fold or tablet (touch first, or under 1024 px), or a desktop */
export function layoutOf(ui: { phone: boolean; narrow: boolean }, coarse: boolean): Layout {
  if (ui.phone) return 'phone'
  return ui.narrow || coarse ? 'tablet' : 'desktop'
}

function load(): Kept {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Kept
    const ok = (s: unknown): s is Side => s === 'left' || s === 'right'
    return { ...(ok(v.tablet) ? { tablet: v.tablet } : {}), ...(ok(v.desktop) ? { desktop: v.desktop } : {}) }
  } catch {
    return {}
  }
}

let kept = load()
const listeners = new Set<() => void>()
const tell = () => {
  for (const l of listeners) l()
}
if (typeof addEventListener === 'function') {
  addEventListener('storage', (e: StorageEvent) => {
    if (e.key !== KEY) return
    kept = load()
    tell()
  })
}
coarseQ?.addEventListener?.('change', tell)

/** the chat's side in a layout: a phone's is always the left (it has no split) */
export const chatSide = (layout: Layout, from: Kept = kept): Side => (layout === 'phone' ? 'left' : from[layout] ?? 'left')

/** the layout this window is in now */
export const layoutNow = (): Layout => layoutOf(getState().ui, !!coarseQ?.matches)

/** put the chat on a side for a layout, kept on this device (a phone has nothing to keep) */
export function setChatSide(layout: Layout, side: Side) {
  if (layout === 'phone') return
  kept = { ...kept, [layout]: side }
  try {
    localStorage.setItem(KEY, JSON.stringify(kept))
  } catch {
    /* a private window: until it closes */
  }
  tell()
}

/** flip the sides in the layout this window is in */
export const swapSides = () => {
  const l = layoutNow()
  setChatSide(l, chatSide(l) === 'left' ? 'right' : 'left')
}

/** the chat header menu's row that swaps the sides: only beside a pane, never on a phone (it has no split) */
export function swapRow(ui: { phone: boolean; pane: string | null }, side: Side = chatSide(layoutNow())): MenuRow[] {
  if (ui.phone || !ui.pane) return []
  return [{ icon: 'swap', label: side === 'left' ? 'Move the chat to the right' : 'Move the chat to the left', run: swapSides }]
}

/** what goes where in the shell after the list, in reading (and so focus) order */
export const columnsOf = (side: Side): ('chat' | 'pane')[] => (side === 'right' ? ['pane', 'chat'] : ['chat', 'pane'])

const subscribe = (l: () => void) => {
  listeners.add(l)
  const off = subscribeUI(l)
  return () => {
    listeners.delete(l)
    off()
  }
}
const snapshot = () => `${layoutNow()}:${chatSide(layoutNow())}`
/** the layout this window is in, and the chat's side there */
export function useSides(): { layout: Layout; side: Side } {
  const [layout, side] = useSyncExternalStore(subscribe, snapshot, snapshot).split(':') as [Layout, Side]
  return { layout, side }
}

/** for tests: read what is kept again */
export const reloadSides = () => void (kept = load())
