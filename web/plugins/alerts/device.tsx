// Settings › Notify › Alerts on this device: what this phone or browser really has (on, off, blocked in its settings,
// or an iPhone that must add the app to its Home Screen first), from the subscription the browser holds and the
// server's list, so it never says Off for a device that is on; Turn on / Turn off / Send a test; and what this device
// is told about (each topic, each space), or the same for every device.
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { setPushEndpoint, useSnap } from '@client/kernel.ts'
import { Ghost, Primary, Small } from '@client/ui.tsx'
import { Switch, card, heading, rowLook } from '@client/Settings.tsx'
import { registerWorker } from './worker.ts'
import { DEFAULT_TOPICS, PUSH_TOPICS, deviceState, type DeviceState, type PushTopic } from '@shared/alerts.ts'

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

/** the subscription this browser holds now, if any */
async function browserSub() {
  if (!pushable()) return null
  const reg = await registerWorker()
  return reg.pushManager.getSubscription()
}

/** what this device has now: the browser's word, then the server's (a subscription it lost is given back) */
async function readNow(): Promise<{ state: DeviceState; endpoint: string | null; server: Server | null }> {
  const permission = 'Notification' in window ? Notification.permission : 'unknown'
  const sub = await browserSub().catch(() => null)
  let server: Server | null = null
  if (sub && permission === 'granted') {
    server = await post('state', { endpoint: sub.endpoint }).catch(() => null)
    // the browser has it, the server doesn't (Serve from moved, or its list was lost): give it back, as it was
    if (server && !server.on) server = await post('subscribe', { sub, device: navigator.userAgent }).catch(() => server)
  }
  const state = deviceState({ push: pushable(), ios: ios(), standalone: standalone(), permission, subscribed: !!sub && !!server?.on })
  return { state, endpoint: sub?.endpoint ?? null, server }
}

const WORDS: Record<DeviceState, { title: string; about: string }> = {
  on: { title: 'On', about: 'This device gets alerts while BossGoat is not on its screen.' },
  off: { title: 'Off', about: 'This device gets no alerts.' },
  blocked: { title: 'Blocked', about: "This device's settings block BossGoat's alerts. On an iPhone: Settings › Notifications › BossGoat › Allow Notifications. In a browser: the site's settings beside its address." },
  install: { title: 'Add to Home Screen first', about: 'An iPhone sends alerts only to the app on its Home Screen: tap Share, then Add to Home Screen, and open BossGoat from there.' },
  unsupported: { title: 'Not here', about: 'This browser has no push alerts.' },
}

export function DeviceAlerts({ phone }: { phone: boolean }) {
  const snap = useSnap()
  const [now, setNow] = useState<Awaited<ReturnType<typeof readNow>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const [err, setErr] = useState(false)

  const read = () => readNow().then(setNow).catch(() => setNow({ state: 'off', endpoint: null, server: null }))
  useEffect(() => {
    void read()
    // back from the phone's settings (allowed there): read again
    const on = () => document.visibilityState === 'visible' && void read()
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  const run = async (what: () => Promise<string | void>) => {
    setBusy(true)
    setSaid('')
    setErr(false)
    try {
      const out = await what()
      if (out) setSaid(out)
    } catch (e) {
      setErr(true)
      setSaid(e instanceof Error ? e.message : 'That did not work. Try again.')
    }
    await read()
    setBusy(false)
  }

  const turnOn = () =>
    run(async () => {
      const reg = await registerWorker()
      if ((await Notification.requestPermission()) !== 'granted') return 'Alerts were not allowed on this device.'
      const { key } = await fetch('api/push/key').then((r) => r.json())
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }))
      await post('subscribe', { sub, device: navigator.userAgent })
      setPushEndpoint(sub.endpoint)
    })

  const turnOff = () =>
    run(async () => {
      const sub = await browserSub()
      if (sub) {
        await post('unsubscribe', { endpoint: sub.endpoint })
        await sub.unsubscribe()
      }
      setPushEndpoint(null)
    })

  const test = () => run(async () => {
    const r = await post('test', { endpoint: now?.endpoint })
    if (!r.ok) throw new Error(r.said)
    return r.said as string
  })

  const choose = (c: { topics?: PushTopic[]; muted?: string[] }, all = false) =>
    run(async () => {
      await post('choose', { endpoint: now?.endpoint, ...c, all })
      if (all) return `Every device (${now?.server?.devices}) now gets the same.`
    })

  const state = now?.state
  const server = now?.server
  const topics = server?.topics ?? DEFAULT_TOPICS
  const muted = new Set(server?.muted ?? [])
  const spaces = snap?.places ?? []
  const words = state ? WORDS[state] : null

  return (
    <div className="flex w-full flex-col gap-6">
      <section className="w-full" aria-labelledby="device-alerts">
        <h3 id="device-alerts" className={heading(phone)}>Alerts on this device</h3>
        <div className={phone ? card : undefined}>
          <div className={clsx(rowLook(phone), phone ? '' : 'border-b border-line')}>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <span aria-hidden className={clsx('size-2 shrink-0 rounded-full', state === 'on' ? 'bg-ready' : state === 'blocked' || state === 'install' ? 'bg-need' : 'bg-line2')} />
                <span data-state={state ?? 'reading'}>{words?.title ?? 'Checking…'}</span>
              </span>
              {words ? <Small className="text-pretty">{words.about}</Small> : null}
            </div>
            <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              {state === 'on' ? (
                <>
                  <Ghost disabled={busy} onClick={test}>Send a test</Ghost>
                  <Ghost disabled={busy} onClick={turnOff}>Turn off</Ghost>
                </>
              ) : state === 'off' ? (
                <Primary disabled={busy} onClick={turnOn}>Turn on</Primary>
              ) : state === 'blocked' ? (
                <Ghost disabled={busy} onClick={() => void read()}>Check again</Ghost>
              ) : null}
            </span>
          </div>
        </div>
        {said ? (
          <Small role="status" className={clsx('pt-1.5 text-pretty', phone && 'px-4', err && 'text-need-fg!')}>
            {said}
          </Small>
        ) : null}
      </section>

      {state === 'on' && server ? (
        <>
          <section className="w-full" aria-labelledby="device-topics">
            <h3 id="device-topics" className={heading(phone)}>Tell this device about</h3>
            <dl className={phone ? card : undefined}>
              {PUSH_TOPICS.map((t) => (
                <div key={t.id} className={rowLook(phone)}>
                  <dt className="flex min-w-0 flex-1 flex-col">
                    {t.label}
                    <Small className="text-pretty">{t.about}.</Small>
                  </dt>
                  <dd>
                    <Switch label={t.label} on={topics.includes(t.id)} disabled={busy} onChange={(on) => choose({ topics: on ? [...topics, t.id] : topics.filter((x) => x !== t.id) })} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {spaces.length > 1 ? (
            <section className="w-full" aria-labelledby="device-spaces">
              <h3 id="device-spaces" className={heading(phone)}>From these spaces</h3>
              <dl className={phone ? card : undefined}>
                {spaces.map((p) => (
                  <div key={p.id} className={rowLook(phone)}>
                    <dt className="min-w-0 flex-1 truncate">{p.name}</dt>
                    <dd>
                      <Switch label={p.name} on={!muted.has(p.id)} disabled={busy} onChange={(on) => choose({ muted: on ? [...muted].filter((x) => x !== p.id) : [...muted, p.id] })} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {server.devices > 1 ? (
            <div className={clsx('flex flex-col items-start gap-1', phone && 'px-4')}>
              <Ghost disabled={busy} onClick={() => choose({ topics, muted: [...muted] }, true)}>Use these on all {server.devices} devices</Ghost>
              <Small className="text-pretty">Each device keeps its own choice until then.</Small>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
