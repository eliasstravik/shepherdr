// Which chats a page still has to mark read (web/src/unread.ts sends them). A chat's last is its Assistant's turn
// (service/compat.ts unreadMarks), so a mark already sent covers that turn only: a newer reply is marked again.
import type { Snapshot } from '@shared/types.ts'

/** has the chat something you haven't read */
export function unread(snap: Snapshot, key: string | undefined): boolean {
  const last = key ? snap.last?.[key] : undefined
  if (!key || !last) return false
  return last > Math.max(snap.read?.[key] ?? 0, snap.read?.['*'] ?? 0)
}

/** of these chats, the unread ones no mark sent yet covers, each with the turn to mark; notes them in asked */
export function toMark(snap: Snapshot, keys: string[], asked: Map<string, number>): Record<string, number> {
  const chats = Object.fromEntries(keys.filter((k) => unread(snap, k) && (asked.get(k) ?? 0) < snap.last![k]).map((k) => [k, snap.last![k]]))
  for (const [k, at] of Object.entries(chats)) asked.set(k, at)
  return chats
}
