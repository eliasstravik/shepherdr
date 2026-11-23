// A card that waits for an answer stays where it was asked and scrolls away like any message (SHEP-419): nothing in
// the chat sticks. While one is out of view, a one-line reminder above the box leads back to it.
import { useSyncExternalStore } from 'react'

export interface Waiting {
  /** its data-card, to jump to */
  id: string
  /** the reminder's words */
  words: string
}

/** the newest waiting card that is wholly out of the chat's view, if any */
export function outOfView(cards: (Waiting & { top: number; bottom: number })[], view: { top: number; bottom: number }): Waiting | null {
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i]!
    if (c.bottom <= view.top || c.top >= view.bottom) return { id: c.id, words: c.words }
  }
  return null
}

const now = new Map<string, Waiting | null>()
const fns = new Set<() => void>()

/** what the chat's reminder shows now; the same answer keeps the same object, so nothing draws again */
export function setAway(chat: string, w: Waiting | null) {
  const was = now.get(chat) ?? null
  if (was?.id === w?.id && was?.words === w?.words) return
  now.set(chat, w)
  for (const fn of fns) fn()
}

export function useAway(chat: string): Waiting | null {
  return useSyncExternalStore(
    (fn) => (fns.add(fn), () => void fns.delete(fn)),
    () => now.get(chat) ?? null,
  )
}
