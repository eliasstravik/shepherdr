// #1553: Keep the screen on (Settings › General), for this device only and off until you turn it on. While it's on
// and the app is on screen, the screen doesn't dim or lock (the browser's Screen Wake Lock). The browser lets go
// when the app is hidden; it's asked again when the app comes back. A browser that can't do it shows no switch.
import { useSyncExternalStore } from 'react'

const KEY = 'shepherdr.awake'

interface Lock { released: boolean; release(): Promise<void> }
type WakeLock = { request(type: 'screen'): Promise<Lock> }
const wakeLock = (): WakeLock | undefined => (typeof navigator !== 'undefined' ? (navigator as { wakeLock?: WakeLock }).wakeLock : undefined)

/** this browser can keep the screen on (it needs the page on https) */
export const canKeepAwake = () => !!wakeLock() && typeof isSecureContext !== 'undefined' && isSecureContext

let on = false
try {
  on = typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'
} catch {}
let lock: Lock | null = null
let asking = false
const listeners = new Set<() => void>()

async function hold() {
  const wl = wakeLock()
  if (!on || !wl || asking || (lock && !lock.released) || document.visibilityState !== 'visible') return
  asking = true
  try {
    lock = await wl.request('screen')
    // turned off while it was asked
    if (!on) void lock.release()
  } catch {
    // refused (battery saver, a page not on screen): asked again when it comes back
  } finally {
    asking = false
  }
}

function letGo() {
  const l = lock
  lock = null
  if (l && !l.released) void l.release().catch(() => {})
}

export function setAwake(v: boolean) {
  on = v
  try {
    if (v) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    /* a private window: until it closes */
  }
  if (v) void hold()
  else letGo()
  for (const l of listeners) l()
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => void hold())
  addEventListener('storage', (e: StorageEvent) => e.key === KEY && setAwake(e.newValue === '1'))
  void hold()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
export const useAwake = () => useSyncExternalStore(subscribe, () => on)
