// A task's news line in its Assistant's chat (Herdr's <herdr-news> lines, read by core/chat-view.js newsWords), drawn as
// one quiet row under the task's line, never as a message: Herdr said it, not the Assistant nor the person. A
// feedback report is "Feedback noted from <task>", opening to its words; other news says what happened and, when
// short, why on the same row, else opens to it.
import type { Message } from '@shared/types.ts'

type News = NonNullable<Message['news']>
export type NewsRow = { label: string; body: string }

/** words that fit on the row itself; longer ones wait behind its fold */
const SHORT = 140
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** null: nothing to draw (the app shows started, ready and done by itself, from the task's status) */
export function newsRow(n: News, title: string): NewsRow | null {
  if (n.mark === 'started' || n.mark === 'ready' || n.mark === 'done') return null
  const text = String(n.text ?? '').replace(/\s+/g, ' ').trim()
  // Herdr's event names the row ("needs-you": "Needs you"); a line from before it rode along, the words it said
  const what = (n.event || n.what || (n.mark === 'needs' ? 'needs you' : 'news')).trim().toLowerCase().replace(/-/g, ' ')
  if (what === 'feedback') return { label: `Feedback noted from ${title || n.ref}`, body: text }
  const head = cap(what)
  if (!text) return { label: head, body: '' }
  return text.length <= SHORT ? { label: `${head}: ${text}`, body: '' } : { label: head, body: text }
}
