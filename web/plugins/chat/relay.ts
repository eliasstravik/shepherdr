// A message between agents (SHEP-368) in words for its quiet row: "Message to #root on vm-demo", "Message from Fix
// login", and whether it got there. One row per message, in both chats: the sender's ("to") and the receiver's ("from").
import type { Relay } from '@shared/types.ts'

/** the row's words: whom it went to, or who sent it */
export function relayLabel(r: Relay): string {
  return `Message ${r.dir === 'to' ? 'to' : 'from'} ${r.name || 'another agent'}`
}

/** whether it got there, on a sent one's row ('' while its command hasn't said, and on a received one: it came) */
export function relayState(r: Relay): { word: string; tone?: 'red' | 'amber' } {
  if (r.dir !== 'to' || !r.state) return { word: '' }
  if (r.state === 'delivered') return { word: 'Delivered' }
  if (r.state === 'waiting') return { word: 'Waiting', tone: 'amber' }
  return { word: 'Not delivered', tone: 'red' }
}

/** what a waiting or undelivered one says about why, at the top of its words once opened */
export function relayWhy(r: Relay): string {
  if (r.dir !== 'to' || !r.state || r.state === 'delivered') return ''
  const why = String(r.why ?? '').trim()
  if (r.state === 'waiting') return why ? `Not delivered yet: ${why}. It goes by itself.` : 'Not delivered yet. It goes by itself.'
  return why ? `Not delivered: ${why}.` : 'Not delivered.'
}
