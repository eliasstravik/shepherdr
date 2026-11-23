// What this device looks like (Settings › General), kept on this device only: Theme (System follows the device's light
// or dark), Chat width (the messages and the message box alike) and Motion. index.html puts the theme on the page
// before the first paint.
import { useSyncExternalStore } from 'react'

export const THEMES = ['System', 'Light', 'Dark'] as const
export const WIDTHS = ['Narrow', 'Medium', 'Wide'] as const
export const MOTIONS = ['System', 'Reduced'] as const
export interface Prefs {
  theme: (typeof THEMES)[number]
  width: (typeof WIDTHS)[number]
  motion: (typeof MOTIONS)[number]
}
/** Narrow is 720 px, Medium 880 px, Wide 1040 px */
export const CHAT_WIDTH: Record<Prefs['width'], number> = { Narrow: 720, Medium: 880, Wide: 1040 }

const KEY = 'shepherdr.prefs'
const START: Prefs = { theme: 'System', width: 'Narrow', motion: 'System' }
/** the bars over the app (the browser's, the phone's status bar): the canvas */
const BAR = { light: '#ffffff', dark: '#121212' }
/** the app's manifest in each, its background_color and theme_color the canvas (index.html picks it before the paint) */
const MANIFEST = { light: 'manifest.webmanifest', dark: 'manifest-dark.webmanifest' }

function load(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    return {
      theme: THEMES.includes(v.theme as Prefs['theme']) ? v.theme! : START.theme,
      width: WIDTHS.includes(v.width as Prefs['width']) ? v.width! : START.width,
      motion: MOTIONS.includes(v.motion as Prefs['motion']) ? v.motion! : START.motion,
    }
  } catch {
    return START
  }
}

let prefs = load()
const listeners = new Set<() => void>()
const system = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

export const isDark = () => prefs.theme === 'Dark' || (prefs.theme === 'System' && !!system?.matches)

function apply() {
  const root = document.documentElement
  // none: the device's own (ds.css follows prefers-color-scheme)
  if (prefs.theme === 'System') delete root.dataset.theme
  else root.dataset.theme = prefs.theme.toLowerCase()
  root.style.setProperty('--chat-w', `${CHAT_WIDTH[prefs.width]}px`)
  if (prefs.motion === 'Reduced') root.dataset.motion = 'reduced'
  else delete root.dataset.motion
  const bar = document.querySelector<HTMLMetaElement>('meta[name=theme-color]')
  if (bar) bar.content = isDark() ? BAR.dark : BAR.light
  // the installed app's window and the phone's navigation bar: the manifest's colours, read when the app updates
  const manifest = document.querySelector<HTMLLinkElement>('link[rel=manifest]')
  if (manifest) manifest.setAttribute('href', isDark() ? MANIFEST.dark : MANIFEST.light)
  for (const l of listeners) l()
}

if (typeof document !== 'undefined') {
  apply()
  system?.addEventListener('change', apply)
  addEventListener('storage', (e: StorageEvent) => {
    if (e.key !== KEY) return
    prefs = load()
    apply()
  })
}

export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  prefs = { ...prefs, [k]: v }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* a private window: until it closes */
  }
  apply()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
export const usePrefs = () => useSyncExternalStore(subscribe, () => prefs)
export const useDark = () => useSyncExternalStore(subscribe, isDark)
