// Appearance: System (the device's own light or dark), Light or Dark, kept on this device only. index.html's first
// script puts it on the page before the first paint, so nothing flashes; this keeps it in step when another is picked
// or the device's own mode changes: the root's data-theme (the styles and Tailwind's dark variant follow it), and the
// colour of the browser's bar and the phone's status bar.
import { useSyncExternalStore } from 'react'

export type Appearance = 'system' | 'light' | 'dark'
export const APPEARANCES: Appearance[] = ['system', 'light', 'dark']

/** where the pick is kept (index.html reads the same key) */
const KEY = 'shepherdr.appearance'
/** the bars over the app, as the top of the screen under them (--bg) */
const BAR = { light: '#ffffff', dark: '#0b0b0d' }

const system = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
const listeners = new Set<() => void>()

function stored(): Appearance {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

let picked = stored()

const darkNow = () => picked === 'dark' || (picked === 'system' && !!system?.matches)

function apply() {
  const dark = darkNow()
  const root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  let bar = document.querySelector<HTMLMetaElement>('meta[name=theme-color]')
  if (!bar) {
    bar = document.createElement('meta')
    bar.name = 'theme-color'
    document.head.append(bar)
  }
  bar.content = dark ? BAR.dark : BAR.light
  for (const f of listeners) f()
}

if (typeof document !== 'undefined') {
  apply()
  system?.addEventListener('change', () => picked === 'system' && apply())
  // another tab of the app on this device picked one
  addEventListener('storage', (e: StorageEvent) => {
    if (e.key !== KEY) return
    picked = stored()
    apply()
  })
}

export function setAppearance(a: Appearance) {
  picked = a
  try {
    if (a === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, a)
  } catch {
    /* private window: it holds until the app is closed */
  }
  apply()
}

const subscribe = (f: () => void) => {
  listeners.add(f)
  return () => listeners.delete(f)
}

/** the appearance picked on this device */
export const useAppearance = () => useSyncExternalStore(subscribe, () => picked)

/** the screen is dark now (picked, or the device's own mode under System) */
export const useDark = () => useSyncExternalStore(subscribe, darkNow)

/** the same, read once (what a frame opens in) */
export const isDark = darkNow
