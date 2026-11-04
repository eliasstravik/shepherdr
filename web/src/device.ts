// Phone, tablet or desktop: each has its own layout, not one stretched page. The root carries data-device, which
// the styles' phone:, tablet: and desktop: variants follow (as in 2.1).
import { useSyncExternalStore } from 'react'

export type Device = 'phone' | 'tablet' | 'desktop'

/** a phone: narrower than a chat's reading width plus a side column; a tablet: up to a small laptop */
export const deviceFor = (w: number): Device => (w < 800 ? 'phone' : w < 1024 ? 'tablet' : 'desktop')

let device: Device = typeof innerWidth === 'number' ? deviceFor(innerWidth) : 'desktop'
const listeners = new Set<() => void>()

function apply() {
  const d = deviceFor(innerWidth)
  document.documentElement.dataset.device = d
  if (d === device) return
  device = d
  for (const f of listeners) f()
}

if (typeof window !== 'undefined') {
  apply()
  addEventListener('resize', apply)
}

export const useDevice = () => useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f) }, () => device)
