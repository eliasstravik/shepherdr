// Share into Shepherdr (SHEP-345): the installed app is on Android's Share sheet. Pictures, files, words and links
// shared to it land in the message box of the chat you had open last, ready to send, with a chip to send them to
// another space or task instead. The service worker (web/public/sw.js) takes the share (a POST to ./share), keeps it in
// Cache Storage and opens the app on ./?share=<id>; this page takes it from there.
import { useSyncExternalStore } from 'react'
import type { Snapshot } from '@shared/types.ts'
import { placeOf, taskChat, taskOf } from '@shared/view.ts'
import { attach, detach, localOf } from '@client/send.ts'
import { getDraft, getState, go, launchHref, notice, openTask, setDraft, subscribe } from '@client/kernel.ts'
import { named } from './paste.ts'

/** the cache the service worker keeps a share in, until this page takes it */
export const SHARE_CACHE = 'shepherdr-share'

export interface Shared {
  files: File[]
  text: string
}

/** what a share's words become in the box: its text, then its link when the text doesn't hold it already; a link's
 *  title only when it came with nothing else to say (Android's apps mostly put the link in the text) */
export function sharedText(m: { title?: string; text?: string; url?: string }): string {
  const text = (m.text ?? '').trim()
  const url = (m.url ?? '').trim()
  const title = (m.title ?? '').trim()
  const parts = [text || (url && title ? title : ''), url && !text.includes(url) ? url : ''].filter(Boolean)
  return parts.length ? parts.join('\n') : title
}

const base = () => new URL('./', typeof document === 'undefined' ? 'http://localhost/' : document.baseURI)

/** a share the service worker kept, as files and words; taken: gone from the cache (with any older one left there) */
export async function takeShared(id: string, store: CacheStorage = caches, at: URL = base()): Promise<Shared | null> {
  const cache = await store.open(SHARE_CACHE)
  const meta = await cache.match(new URL(`share/${id}`, at).href)
  if (!meta) return null
  const m = (await meta.json()) as { title?: string; text?: string; url?: string; files?: { name: string; type: string }[] }
  const now = new Date()
  const files: File[] = []
  for (const [i, f] of (m.files ?? []).entries()) {
    const r = await cache.match(new URL(`share/${id}/${i}`, at).href)
    if (!r) continue
    const blob = await r.blob()
    files.push(named(new File([blob], f.name || '', { type: f.type || blob.type }), now, i, m.files!.length))
  }
  for (const k of await cache.keys()) await cache.delete(k)
  return { files, text: sharedText(m) }
}

/* ---------- the chat you had open last: a task's, or else your space's ---------- */

const LAST = 'shepherdr.lastChat'
/** the chat on screen: its space, and the task open in it */
type Last = { at: string; task: string | null }
let last: Last | null = null
try {
  last = JSON.parse(localStorage.getItem(LAST) ?? 'null')
} catch {
  /* no storage here */
}
/** the chat open when the app was last on screen: a share opens the app on ./?share=<id>, which names none */
const launchLast = last

/** keep which chat is open (a space opened from a link too, which the app doesn't keep as its space), so a share lands
 *  there later */
export function watchLastChat() {
  return subscribe(() => {
    const ui = getState().ui
    if (!ui.at) return
    const now = { at: ui.at, task: ui.task && ui.pane === 'tasks' ? ui.task : null }
    if (last?.at === now.at && last.task === now.task) return
    last = now
    try {
      localStorage.setItem(LAST, JSON.stringify(now))
    } catch {
      /* a private window */
    }
  })
}

/** the box a share lands in: the task last open, while it has a chat, else the space last on screen */
export function landingChat(snap: Snapshot, at: string, task: string | null): { key: string; place?: string; task?: string } | null {
  const t = taskOf(snap, task)
  if (t?.agent && !t.archived) return { key: taskChat(t), task: t.id }
  const p = placeOf(snap, at)
  return p ? { key: p.chat, place: p.id } : null
}

/* ---------- the chip that says where it goes ---------- */

/** the box a share just landed in: its chip offers to send it elsewhere, until it is sent or put away */
let landed: string | null = null
const chipListeners = new Set<() => void>()
const setLanded = (k: string | null) => {
  landed = k
  chipListeners.forEach((l) => l())
}
export const useLanded = () =>
  useSyncExternalStore(
    (l) => {
      chipListeners.add(l)
      return () => void chipListeners.delete(l)
    },
    () => landed,
  )
export const putAway = () => setLanded(null)

/** put a share in a box: its files as thumbnails, its words after what was typed there */
export function land(key: string, s: Shared) {
  if (s.files.length) attach(key, key, s.files)
  if (s.text) {
    const was = getDraft(key).replace(/\s+$/, '')
    setDraft(key, was ? `${was}\n${s.text}` : s.text)
  }
  setLanded(key)
}

/** move what a share put in one box to another chat's (a space's, or a task's), and go there */
export function moveShared(from: string, to: { key: string; place?: string; task?: string }) {
  const s = getState()
  const files = (s.ui.files[from] ?? []).map((f) => localOf(f.id)?.file).filter((f): f is File => !!f)
  const text = getDraft(from)
  for (let i = (s.ui.files[from] ?? []).length - 1; i >= 0; i--) detach(from, i)
  setDraft(from, '')
  if (to.task) openTask(to.task)
  else if (to.place) go(to.place)
  land(to.key, { files, text })
}

/** the share this page was opened with (./?share=<id>), into the last chat's box once the spaces are known */
export async function landLaunchShare(href = launchHref) {
  const id = new URL(href || 'http://x/').searchParams.get('share')
  if (!id) return
  if (id === 'lost' || !/^[\w-]{1,40}$/.test(id) || typeof caches === 'undefined') return notice("The share didn't come through. Share it again.", 4000)
  let shared: Shared | null = null
  try {
    shared = await takeShared(id)
  } catch {
    /* no cache here */
  }
  if (!shared) return
  const s = shared
  // once: going to its task redraws the app, which calls this again before it is done
  let done = false
  const put = () => {
    const { snap, ui } = getState()
    if (done || !snap) return done
    const to = (launchLast && landingChat(snap, launchLast.at, launchLast.task)) || landingChat(snap, ui.at, null)
    if (!to) return false
    done = true
    if (to.task) openTask(to.task)
    else if (to.place && to.place !== ui.at) go(to.place)
    land(to.key, s)
    return true
  }
  if (put()) return
  const off = subscribe(() => put() && off())
}
