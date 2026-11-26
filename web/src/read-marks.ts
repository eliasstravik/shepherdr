// Unread: a space whose Assistant said something you haven't seen is bold in the list (not when muted, Notify: Off),
// and a folded group still shows it. A chat on screen is read: the service keeps the marks, so every device, the
// phone's badge and the glance count go down with it. A chat's last is its Assistant's turn (service/compat.ts
// unreadMarks), so a mark already sent covers that turn only: a newer reply is marked again.
import { useEffect, useState } from 'react'
import type { Snapshot } from '@shared/types.ts'
import { notifyOf } from '@shared/alerts.ts'
import { unread } from '@shared/needs-you.ts'
import type { Space } from '@shared/view.ts'
import { act, useStore, visibleChats, type UI } from './kernel.ts'

/** has the chat something you haven't read: Needs you's rule (web/shared/needs-you.ts) */
export { unread }

/** of these chats, the unread ones no mark sent yet covers, each with the turn to mark; notes them in asked */
export function toMark(snap: Snapshot, keys: string[], asked: Map<string, number>): Record<string, number> {
  const chats = Object.fromEntries(keys.filter((k) => unread(snap, k) && (asked.get(k) ?? 0) < snap.last![k]).map((k) => [k, snap.last![k]]))
  for (const [k, at] of Object.entries(chats)) asked.set(k, at)
  return chats
}

/** something new in a space's Assistant's chat, unless the space is muted */
export const spaceUnread = (snap: Snapshot, p: Pick<Space, 'id' | 'chat'>) => unread(snap, p.chat) && notifyOf(snap, p.id) !== 'Off'

/** what a mark sent already covers, until the snapshot has it */
const asked = new Map<string, number>()

/** these chats are read, up to what the snapshot has of them; a mark that fails is tried again */
export function markRead(snap: Snapshot, keys: string[]) {
  const chats = toMark(snap, keys, asked)
  if (!Object.keys(chats).length) return
  act({ type: 'read', chats }).catch(() => {
    for (const [k, at] of Object.entries(chats)) if (asked.get(k) === at) asked.delete(k)
  })
}

/** Mark as read: these spaces' Assistants' chats */
export const markSpacesRead = (snap: Snapshot, ps: Pick<Space, 'chat'>[]) => markRead(snap, ps.map((p) => p.chat).filter((k): k is string => !!k))

/** the chats you can see now: none while the page is hidden, nor on a phone while the list, a pane or Settings covers
 *  the chat */
export function seenChats(ui: UI, snap: Snapshot, visible: boolean): string[] {
  if (!visible || (ui.phone && (ui.drawer || ui.pane || ui.settings))) return []
  return visibleChats(ui, snap).filter((k) => unread(snap, k))
}

/** while the app is on screen, the chats it shows are read */
export function MarkRead() {
  const snap = useStore((s) => s.snap)
  const ui = useStore((s) => s.ui)
  const [visible, setVisible] = useState(typeof document === 'undefined' || document.visibilityState === 'visible')
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  const keys = snap ? seenChats(ui, snap, visible) : []
  useEffect(() => {
    if (snap && keys.length) markRead(snap, keys)
  }, [keys.join('\n'), snap])
  return null
}
