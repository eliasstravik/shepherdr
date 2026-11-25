// Alerts: push notifications to this device when something needs the person. This keeps the app icon's count and the
// alerts left on the phone in step with what still waits, and takes a tapped alert straight to its task. The choice
// itself is in Settings › General (device.ts).
import { useEffect, useState } from 'react'
import { definePlugin, openLink, setPushEndpoint, useSnap, useStore, visibleChats } from '@client/kernel.ts'
import { keptTags } from '@shared/alerts.ts'
import { needsCount } from '@shared/view.ts'
import { registerWorker } from './worker.ts'

const TITLE = 'Shepherdr'

/** the app icon's count, and where there is no icon to mark (Linux) the window's title: "(3) Shepherdr" */
export function showCount(n: number) {
  document.title = n > 0 ? `(${n}) ${TITLE}` : TITLE
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  ;(n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => undefined)
}

/** close the alerts about what no longer waits on you, or is on screen now */
async function tidy(keep: string[]) {
  const reg = await navigator.serviceWorker?.getRegistration()
  for (const n of (await reg?.getNotifications()) ?? []) if (n.data?.waits && !keep.includes(n.tag)) n.close()
}

function Keeper() {
  const snap = useSnap()
  const ui = useStore((s) => s.ui)
  const [visible, setVisible] = useState(document.visibilityState === 'visible')
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  // off screen the service sends only this count (service/live.ts), not the snapshot
  const told = useStore((s) => s.needs)
  const count = !visible && told !== null ? told : snap ? needsCount(snap) : 0
  const keep = snap && visible ? keptTags(snap, visibleChats(ui, snap)).join('\n') : null
  useEffect(() => {
    if (snap) showCount(count)
  }, [count, !!snap, visible])
  useEffect(() => {
    if (keep !== null) tidy(keep ? keep.split('\n') : []).catch(() => undefined)
  }, [keep])
  return null
}

export default definePlugin({
  name: 'alerts',
  setup(reg) {
    reg.overlays.push(Keeper)
    if (!('serviceWorker' in navigator)) return
    registerWorker()
      // tell the server which push subscription is this screen, so it sends none while the app is on screen
      .then((r) => r.pushManager?.getSubscription())
      .then((s) => s && setPushEndpoint(s.endpoint))
      .catch(() => undefined)
    // a tap on an alert while the app is open: straight to its task, without reloading
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'open' && typeof e.data.url === 'string') openLink(e.data.url)
    })
  },
})
