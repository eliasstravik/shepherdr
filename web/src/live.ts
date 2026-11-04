// The page's one live link to the service (service/live.ts): named views arrive whole when the page joins, then one
// at a time when they change. The link comes back by itself (link.ts's timing); the page says it's gone only after
// SAY_LOST_AFTER without it.
import { useSyncExternalStore } from 'react'
import { OPEN_WITHIN, PONG_WITHIN, SAY_LOST_AFTER, retryIn } from './link.ts'

export type Hello = { version: string; login: string; machine: string | null; link: string | null }
export type Link = 'connecting' | 'open' | 'lost'

const views = new Map<string, unknown>()
let hello: Hello | null = null
let link: Link = 'connecting'
const listeners = new Set<() => void>()
const changed = () => { for (const f of listeners) f() }

let ws: WebSocket | null = null
let tries = 0
let lostTimer: ReturnType<typeof setTimeout> | null = null

function url() {
  const u = new URL('api/ws', location.href)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return u.href
}

function connect() {
  const s = new WebSocket(url())
  ws = s
  const giveUp = setTimeout(() => { if (s.readyState !== WebSocket.OPEN) s.close() }, OPEN_WITHIN)
  s.onopen = () => {
    clearTimeout(giveUp)
    tries = 0
    if (lostTimer) clearTimeout(lostTimer)
    lostTimer = null
    link = 'open'
    changed()
  }
  s.onmessage = (e) => {
    let m: any
    try { m = JSON.parse(String(e.data)) } catch { return }
    if (m.type === 'hello') hello = m
    else if (m.type === 'view') views.set(m.name, m.value)
    else if (m.type === 'pong') pong?.()
    changed()
  }
  s.onclose = () => {
    clearTimeout(giveUp)
    if (ws !== s) return
    ws = null
    if (link === 'open') link = 'connecting'
    lostTimer ??= setTimeout(() => { link = 'lost'; changed() }, SAY_LOST_AFTER)
    changed()
    setTimeout(connect, retryIn(++tries))
  }
}

let pong: (() => void) | null = null
/** Back on screen: a socket that looks open must answer quickly, or it's one the phone killed while asleep. */
function check() {
  if (document.visibilityState !== 'visible' || !ws || ws.readyState !== WebSocket.OPEN) return
  const s = ws
  const t = setTimeout(() => s.close(), PONG_WITHIN)
  pong = () => { clearTimeout(t); pong = null }
  s.send(JSON.stringify({ type: 'ping', at: Date.now() }))
}

if (typeof window !== 'undefined') {
  connect()
  document.addEventListener('visibilitychange', check)
  addEventListener('online', check)
}

const subscribe = (f: () => void) => { listeners.add(f); return () => listeners.delete(f) }

export function useView<T>(name: string): T | undefined {
  return useSyncExternalStore(subscribe, () => views.get(name) as T | undefined)
}
export const useHello = () => useSyncExternalStore(subscribe, () => hello)
export const useLink = () => useSyncExternalStore(subscribe, () => link)

/** A write to the service: the page's own origin plus the header only scripts can send. */
export async function post(path: string, body: unknown) {
  const r = await fetch(new URL(path, location.href), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shepherdr': '1' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}
