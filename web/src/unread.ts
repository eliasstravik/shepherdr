// Unread, as Slack has it: a coordinator's chat with something new from it or Shepherdr that you haven't seen makes its
// space's row bold (its own chat only), and a muted space (Notify: Off) stays quiet. Headings never are: they have no
// chat; a folded one only has a quiet dot for its spaces (plugins/places). Tasks' chats count for nothing here: a
// task's row shows its own status.
// A chat on screen is read; the main machine keeps the marks, so every device shows the same (server/live/unread.ts).
import { useEffect, useState } from 'react'
import { notifyOf } from '@shared/alerts.ts'
import type { Place, Snapshot } from '@shared/types.ts'
import { act, useSnap, useStore, visibleChats } from './kernel.ts'

/** has the chat something you haven't read */
export function unread(snap: Snapshot, key: string | undefined): boolean {
  const last = key ? snap.last?.[key] : undefined
  if (!key || !last) return false
  return last > Math.max(snap.read?.[key] ?? 0, snap.read?.['*'] ?? 0)
}

/** Notify is Off: no alerts, and its row stays quiet */
export const muted = (snap: Snapshot, place: string) => notifyOf(snap, place) === 'Off'

/** something new in a space's coordinator's chat, unless it is muted */
export function placeUnread(snap: Snapshot, p: Place) {
  return !muted(snap, p.id) && unread(snap, p.chat)
}

/** what a mark sent already covers, until the snapshot has it */
const asked = new Map<string, number>()

/** these chats are read, up to what the snapshot has of them */
export function markRead(snap: Snapshot, keys: string[]) {
  const chats = Object.fromEntries(keys.filter((k) => unread(snap, k) && (asked.get(k) ?? 0) < snap.last![k]).map((k) => [k, snap.last![k]]))
  if (!Object.keys(chats).length) return
  for (const [k, at] of Object.entries(chats)) asked.set(k, at)
  act({ type: 'read', chats }).catch(() => undefined)
}

/** Mark as read: these spaces' coordinators' chats */
export function markPlaceRead(snap: Snapshot, ps: Place[]) {
  markRead(snap, ps.map((p) => p.chat).filter((k): k is string => !!k))
}

/** while the app is on screen, the chats it shows are read */
export function MarkRead() {
  const snap = useSnap()
  const ui = useStore((s) => s.ui)
  const [visible, setVisible] = useState(document.visibilityState === 'visible')
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  const keys = snap && visible ? visibleChats(ui, snap).filter((k) => unread(snap, k)) : []
  useEffect(() => {
    if (snap && keys.length) markRead(snap, keys)
  }, [keys.join('\n'), snap])
  return null
}
