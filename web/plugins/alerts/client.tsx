import { useEffect, useState } from 'react'
import { definePlugin, openLink, setPushEndpoint, useSnap, useStore, visibleChats } from '@client/kernel.ts'
import { keptTags, waiting } from '@shared/alerts.ts'

/** Ask this device for push alerts (the app must be installed to the home screen on an iPhone). */
export async function subscribePush(): Promise<string> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'This browser has no push alerts. On an iPhone, add Shepherdr to the home screen first.'
  const reg = await navigator.serviceWorker.register('sw.js')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return 'Alerts are off for this device.'
  const { key } = await fetch('api/push/key').then((r) => r.json())
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  await fetch('api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json', 'x-shepherdr': '1' }, body: JSON.stringify({ sub, device: navigator.userAgent }) })
  setPushEndpoint(sub.endpoint)
  return 'Alerts are on for this device.'
}

const TITLE = 'Shepherdr'

/** the app icon's count (Badging API: iPhone, Mac, Windows, ChromeOS) and, where there is no icon to mark (Linux), the
 *  window's title: "(3) Shepherdr" */
export function showCount(n: number) {
  document.title = n > 0 ? `(${n}) ${TITLE}` : TITLE
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  ;(n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => undefined)
}

/** close the alerts about what no longer waits on you, or is on screen now (you opened its card) */
async function tidy(keep: string[]) {
  const reg = await navigator.serviceWorker?.getRegistration()
  for (const n of (await reg?.getNotifications()) ?? []) if (n.data?.waits && !keep.includes(n.tag)) n.close()
}

/** keeps the icon's count and the alerts left in step with what waits on you, while the app is open */
function Keeper() {
  const snap = useSnap()
  const ui = useStore((s) => s.ui)
  const [visible, setVisible] = useState(document.visibilityState === 'visible')
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  const count = snap ? waiting(snap).count : 0
  const keep = snap && visible ? keptTags(snap, visibleChats(ui, snap)).join('\n') : null
  // in the background too (the Linux title, the Dock), and again on coming back on screen: an alert meanwhile set the
  // icon's count from the service worker
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
    reg.settingActions.alerts = subscribePush
    reg.overlays.push(Keeper)
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('sw.js')
      // tell the server which push subscription is this screen, so it sends none while the app is on screen
      .then((r) => r.pushManager?.getSubscription())
      .then((s) => s && setPushEndpoint(s.endpoint))
      .catch(() => undefined)
    // a tap on an alert while the app is open: straight to its card, without reloading
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'open' && typeof e.data.url === 'string') openLink(e.data.url)
    })
  },
})
