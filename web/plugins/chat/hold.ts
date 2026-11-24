// The app's own cards in a chat (a review, a task's "Done and merged" line) come from the tasks' status, which is here
// at once; the chat's messages come from its log, a moment later. A chat never shows those cards alone while its
// messages are still on their way (SHEP-445): it stays as a chat still loading until they come, then both show
// together in their order. A card from before the stretch of chat loaded so far waits for that stretch.
import type { Chat, Message } from '@shared/types.ts'

export type ChatCard = { key: string; at?: number; past?: boolean }

/** its messages are not here yet: no chat yet, or its log still being found */
export const messagesComing = (chat: Chat | undefined) => !chat || (chat.notice === 'opening' && !chat.messages.length)

/** a message the person or the agent wrote (not a task's row, a closing line or a brief's label) */
export const said = (m: Message) => !!m.text && !m.news && !m.card && !m.relay && !m.brief && m.ended === undefined && !m.error && !m.activity && !m.newSession

/** the cards to draw now: none while its messages are coming; with earlier pages left to load, a past one (a done
 *  line) from before the oldest message here waits until that page comes, so it never piles up above the first one */
export function cardsNow<C extends ChatCard>(cards: C[], chat: Chat | undefined, tried = TRIES): C[] {
  if (stillLoading(chat, tried)) return []
  if (!chat!.earlier) return cards
  const first = Math.min(...chat!.messages.map((m) => m.at ?? Infinity))
  if (first === Infinity) return cards
  return cards.filter((c) => !c.past || c.at === undefined || c.at >= first)
}

/** how many of the person's and the agent's own messages a chat opens with at least, loading earlier pages for them */
export const ENOUGH = 3

/** at most this many earlier pages read by themselves when a chat opens */
export const TRIES = 5

/** the newest page held only task rows: read the page before it, until a few real messages are in view */
export const wantsEarlier = (chat: Chat | undefined, tried: number) => tried < TRIES && !!chat?.earlier && chat.messages.filter(said).length < ENOUGH

/** still loading as the person sees it: its messages are coming, or the pages read so far hold none of them yet (it
 *  shows once one is in, or once there is nothing earlier to read) */
export const stillLoading = (chat: Chat | undefined, tried: number) =>
  messagesComing(chat) || (wantsEarlier(chat, tried) && !chat!.messages.some(said))
