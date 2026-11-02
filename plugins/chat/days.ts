// Plain rules the chat draws by, kept apart so tests can run them without a screen.
import type { Message } from '@shared/types.ts'

/** a day's line between messages: Today, Yesterday, a weekday this week, else its date (and year, if not this one) */
export function dayLabel(at: number, now = new Date()) {
  const d = new Date(at)
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((start(now) - start(d)) / 864e5)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days > 1 && days < 7) return d.toLocaleDateString([], { weekday: 'long' })
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}

/** a reply's words as they read, without its markdown: a link by its words, no marks around them */
function underscores(s: string) {
  const stack: { at: number; size: number }[] = [], omit = new Set<number>()
  const word = (char: string) => /[\p{L}\p{N}_]/u.test(char)
  for (let i = 0; i < s.length; i++) if (s[i] === '_') {
    const at = i
    while (s[i + 1] === '_') i++
    const size = i - at + 1, before = s[at - 1] || '', after = s[i + 1] || ''
    if (size > 2) continue
    if (before && !/\s/.test(before) && !word(after) && stack.at(-1)?.size === size) {
      omit.add(stack.pop()!.at); omit.add(at)
    } else if (!word(before) && after && !/\s/.test(after)) stack.push({ at, size })
  }
  return s.replace(/_+/g, (run, at: number) => omit.has(at) ? '' : run)
}
const plain = (s: string) => {
  const words = (part: string) => underscores(part.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')).replace(/[*`#>~]/g, '')
  // Code and underscores inside identifiers are literal visible words, not emphasis marks.
  let text = '', from = 0
  for (const match of s.matchAll(/(`+)([\s\S]*?)\1/g)) {
    text += words(s.slice(from, match.index)) + match[2]
    from = match.index + match[0].length
  }
  return text + words(s.slice(from))
}

/** what a message can be found by: its words, a file's name, a card's title */
export const messageText = (m: Message) => [m.text && plain(m.text), m.file?.name, m.question?.title].filter(Boolean).join('\n')
const hay = (m: Message) => messageText(m).toLowerCase()

/** the messages with these words (search in a chat), oldest first; not one still waiting to go in */
export function findIn(msgs: Message[], q: string) {
  const w = q.trim().toLowerCase()
  return w ? msgs.filter((m) => !m.waiting && hay(m).includes(w)).map((m) => m.id) : []
}
