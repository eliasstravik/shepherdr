// Replies, like iMessage, WhatsApp and Slack: anyone replies to any message. Swipe a message right (on a touch screen),
// pick Reply from its hold menu, or the reply arrow beside it (with a mouse). The box shows what it answers in a small
// strip with an x; the sent message carries a short quote of it, and a tap on the quote jumps to it and lights it up.
// An artifact's card is a message too: its quote is its title and version.
import { getState, setUI } from '@client/kernel.ts'
import { unfold } from './fold.tsx'
import { excerpt } from '@shared/excerpt.ts'
import { artifactQuote, type Chat, type Message, type Question, type ReplyQuote } from '@shared/types.ts'

/** the start of a message as a quote shows it: one line of plain words (a file by its name, an artifact by its title
    and version) */
export function quoteOf(msg: Message): ReplyQuote & { id: string } {
  if (isArtifact(msg)) {
    const title = getState().snap?.artifacts?.find((a) => a.id === msg.artifact!.id)?.title ?? 'Artifact'
    return { id: msg.id, who: msg.who, text: artifactQuote(title, msg.artifact!.v), artifact: true }
  }
  if (!msg.text) return { id: msg.id, who: msg.who, text: msg.file?.name ?? '', file: true }
  return { id: msg.id, who: msg.who, text: excerpt(msg.text, 160) }
}

/** the message a card was answered with in the chat, as its quote: your first one after the card with those words
    (or with a file, when it had none); just the words, with nothing to jump to, while it isn't in the chat */
export function answeredBy(q: Question, chat: Chat, card: string): ReplyQuote | null {
  if (q.via !== 'chat') return null
  const said = q.said && excerpt(q.said, Infinity)
  const mine = chat.messages.slice(chat.messages.findIndex((m) => m.id === card) + 1).filter((m) => m.who === 'you' && canReply(m) && !m.answered)
  const m = said ? mine.find((m) => m.text && excerpt(m.text, Infinity) === said) : mine.find((m) => m.file)
  if (m) return quoteOf(m)
  return said ? { who: 'you', text: excerpt(said, 160) } : null
}

/** an artifact's card on its own: reacted to and replied to as a message (one posted with words, from an older
    machine, reacts with its words) */
export const isArtifact = (msg: Message) => !!msg.artifact && !msg.text && !msg.file && !msg.card

/** can it be replied to: a message of words, a file or an artifact that is in the chat (not one still on its way) */
export const canReply = (msg: Message, out?: unknown) => !msg.waiting && !out && !msg.id.startsWith('out:') && !!(msg.text || msg.file || isArtifact(msg))

const boxOf = (chat: string) => document.querySelector<HTMLTextAreaElement>(`textarea[name=message][data-chat="${CSS.escape(chat)}"]`)

/** reply to a message: the box shows it, and takes the focus (in the tap itself, so a phone brings its keyboard up) */
export function startReply(chat: string, msg: Message) {
  setUI((u) => ({ pick: null, pickAll: false, selecting: null, reply: { ...u.reply, [chat]: quoteOf(msg) } }))
  const box = boxOf(chat)
  box?.focus({ preventScroll: true })
  requestAnimationFrame(() => box?.setSelectionRange(box.value.length, box.value.length))
}

export function cancelReply(chat: string) {
  if (!getState().ui.reply[chat]) return
  setUI((u) => {
    const { [chat]: _, ...rest } = u.reply
    return { reply: rest }
  })
}

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const lit = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

/** scroll a message into view (opened, if it was folded) and light it up for a moment; false when the chat no longer
    has it. card: its card (a question) rather than its words, with the card's buttons in view */
export function jumpTo(chat: string, id: string, { card = false } = {}) {
  unfold(id)
  const at = `[data-chat="${CSS.escape(chat)}"]`
  const el = document.querySelector<HTMLElement>(`[data-msg="${CSS.escape(id)}"]${at}`)
  // a question's card sits beside the message's words (or alone, the CLI's own question)
  const box = card ? document.querySelector<HTMLElement>(`[data-whole="${CSS.escape(id)}"]${at} [data-card]`) : null
  const anchor = box ?? el?.querySelector<HTMLElement>('[data-anchor]') ?? el
  if (!anchor) return false
  const tall = !!box && box.offsetHeight > innerHeight * 0.7
  // the chat lets go of its bottom and leaves the scroll alone while it glides there: setting it would stop the glide
  anchor.dispatchEvent(new Event('chat-jump', { bubbles: true }))
  ;(box ?? el ?? anchor).scrollIntoView({ block: tall ? 'end' : 'center', behavior: still() ? 'auto' : 'smooth' })
  anchor.removeAttribute('data-flash')
  // read layout once, so the light starts over when it is tapped again
  void anchor.offsetWidth
  anchor.setAttribute('data-flash', '')
  clearTimeout(lit.get(anchor))
  lit.set(anchor, setTimeout(() => anchor.removeAttribute('data-flash'), 1600))
  return true
}
