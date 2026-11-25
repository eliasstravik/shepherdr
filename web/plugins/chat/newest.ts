// Jump to the newest message (#1504): scrolled up away from a chat's end, a round ↓ above the box takes you back,
// with how many messages came since you left; End does the same. Back at the end, the chat follows again (stick.ts).
import { useSyncExternalStore } from 'react'

/** how far from its end a chat must be before the button shows: a little scroll never brings it up */
export const OFF_PX = 240

export interface OffEnd {
  /** messages from the agent (and the app's own rows) that came after you left the end */
  count: number
}

/** how many of these rows are new: those after the row that was last when you left, never what you sent yourself.
 *  Earlier pages loading at the top change nothing; a last row no longer there counts none. */
export function newSince(rows: { id: string; mine: boolean }[], last: string | null): number {
  if (last == null) return 0
  const i = rows.findIndex((r) => r.id === last)
  if (i < 0) return 0
  return rows.slice(i + 1).filter((r) => !r.mine).length
}

const now = new Map<string, OffEnd | null>()
const ends = new Map<string, () => void>()
const fns = new Set<() => void>()

/** what the chat's button shows now (null: at its end); the same answer keeps the same object */
export function setOffEnd(chat: string, a: OffEnd | null) {
  const was = now.get(chat) ?? null
  if (was?.count === a?.count && !was === !a) return
  now.set(chat, a)
  for (const fn of fns) fn()
}

export function useOffEnd(chat: string): OffEnd | null {
  return useSyncExternalStore(
    (fn) => (fns.add(fn), () => void fns.delete(fn)),
    () => now.get(chat) ?? null,
  )
}

/** the open chat says how it goes back to its end; the button and End call it */
export function onEnd(chat: string, go: () => void) {
  ends.set(chat, go)
  return () => {
    if (ends.get(chat) === go) ends.delete(chat)
  }
}

export function toEnd(chat: string | undefined): boolean {
  const go = chat ? ends.get(chat) : undefined
  go?.()
  return !!go
}

/** is the chat away from its end now (End's command shows only then) */
export const isOffEnd = (chat: string | undefined) => !!chat && !!now.get(chat)
