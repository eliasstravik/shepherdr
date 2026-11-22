// Alerts on this device: one choice and nothing else (Needs me / Everything / Off). What this phone or browser really
// has comes from the subscription the browser holds and the server's list, so it never says Off for a device that is
// on. "Everything" adds finished tasks. Tapping an alert opens its task.
import { useEffect, useState } from 'react'
import { setPushEndpoint } from '@client/kernel.ts'
import { deviceState, type DeviceState, type PushTopic } from '@shared/alerts.ts'
import { registerWorker } from './worker.ts'

export const TELL = ['Needs me', 'Everything', 'Off'] as const
export type Tell = (typeof TELL)[number]
const TOPICS: Record<Exclude<Tell, 'Off'>, PushTopic[]> = { 'Needs me': ['needs', 'ready'], Everything: ['needs', 'ready', 'done'] }

type Server = { on: boolean; topics: PushTopic[]; muted: string[]; devices: number }

const post = (path: string, body: unknown) =>
  fetch(`api/push/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shepherdr': '1' }, body: JSON.stringify(body) }).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error ?? 'That did not work. Try again.')
    return j
  })

const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const pushable = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

async function browserSub() {
  if (!pushable()) return null
  const reg = await registerWorker()
  return reg.pushManager.getSubscription()
}

export interface DeviceNow {
  state: DeviceState
  endpoint: string | null
  tell: Tell
}

/** what this device has now: the browser's word, then the server's (a subscription it lost is given back) */
export async function readNow(): Promise<DeviceNow> {
  const permission = 'Notification' in window ? Notification.permission : 'unknown'
  const sub = await browserSub().catch(() => null)
  let server: Server | null = null
  if (sub && permission === 'granted') {
    server = await post('state', { endpoint: sub.endpoint }).catch(() => null)
    if (server && !server.on) server = await post('subscribe', { sub, device: navigator.userAgent }).catch(() => server)
  }
  const state = deviceState({ push: pushable(), ios: ios(), standalone: standalone(), permission, subscribed: !!sub && !!server?.on })
  const tell: Tell = state !== 'on' ? (wanted() ?? 'Needs me') : server?.topics.includes('done') ? 'Everything' : 'Needs me'
  return { state, endpoint: sub?.endpoint ?? null, tell: state === 'on' || wanted() !== 'Off' ? tell : 'Off' }
}

/** the choice made before alerts were turned on in this browser, kept until they are */
const KEY = 'shepherdr.tell'
function wanted(): Tell | null {
  try {
    const v = localStorage.getItem(KEY) as Tell | null
    return v && TELL.includes(v) ? v : null
  } catch {
    return null
  }
}
function want(v: Tell) {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    /* a private window */
  }
}

/** turn alerts on in this browser: it asks the device, then subscribes with the choice made */
export async function turnOn(tell: Exclude<Tell, 'Off'> = 'Needs me'): Promise<string | void> {
  const reg = await registerWorker()
  if ((await Notification.requestPermission()) !== 'granted') return 'Alerts were not allowed on this device.'
  const { key } = (await fetch('api/push/key').then((r) => r.json())) as { key: string }
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }))
  await post('subscribe', { sub, device: navigator.userAgent })
  await post('choose', { endpoint: sub.endpoint, topics: TOPICS[tell], muted: [], all: false })
  setPushEndpoint(sub.endpoint)
  want(tell)
}

/** the one choice: Needs me, Everything (adds finished tasks) or Off */
export async function choose(tell: Tell, now: DeviceNow): Promise<string | void> {
  want(tell)
  if (tell === 'Off') {
    const sub = await browserSub()
    if (sub) {
      await post('unsubscribe', { endpoint: sub.endpoint })
      await sub.unsubscribe()
    }
    return setPushEndpoint(null)
  }
  if (now.state !== 'on') return now.state === 'off' ? turnOn(tell) : undefined
  await post('choose', { endpoint: now.endpoint, topics: TOPICS[tell], muted: [], all: false })
}

/** why alerts can't be on here, when they can't */
export const WHY: Partial<Record<DeviceState, string>> = {
  blocked: "This device's settings block Shepherdr's alerts",
  install: 'On an iPhone, add Shepherdr to the Home Screen first',
  unsupported: 'This browser has no alerts',
}

export function useDeviceAlerts() {
  const [now, setNow] = useState<DeviceNow | null>(null)
  const read = () => readNow().then(setNow).catch(() => setNow({ state: 'off', endpoint: null, tell: 'Needs me' }))
  useEffect(() => {
    void read()
    // back from the phone's settings (allowed there): read again
    const on = () => document.visibilityState === 'visible' && void read()
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return { now, read }
}
