// When the page asks for a recap by itself (the recaps plugin), and where it keeps when you last looked at each chat.
import type { Message } from '@shared/types.ts'

/** away this long from a chat, it recaps when you come back */
export const AWAY = 15 * 60_000
/** back while it works: how long to wait for it to stop before letting it be */
export const WAIT_FOR_IDLE = 2 * 60_000

/** you were away long enough, its agent said or did something since, and no recap came since */
export function dueRecap(msgs: Message[], since: number | undefined, now: number): boolean {
  if (!since || now - since < AWAY) return false
  const after = msgs.filter((m) => (m.at ?? 0) > since)
  if (after.some((m) => m.recap === 'recap')) return false
  return after.some((m) => m.who === 'agent' && !m.recap && Boolean(m.text || m.activity))
}

// when you last looked at each chat (its key → ms), on this device; the newest 200
const SEEN = 'shepherdr.seen'
export function loadSeen(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}
export function saveSeen(seen: Record<string, number>) {
  try {
    localStorage.setItem(SEEN, JSON.stringify(Object.fromEntries(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 200))))
  } catch {}
}
