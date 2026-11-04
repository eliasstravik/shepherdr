// When a chat shows the agent's typing dots: only while herdr says its agent is working and it is in a turn that ends in
// a reply, so they can never stick after it stops or while only its background work runs, and never while it waits on
// the human.
import type { Chat } from '@shared/types.ts'

export function typing(chat: Chat) {
  if (!chat.working || chat.background || chat.finished) return false
  // a question card it posted last (its own, or the CLI's menu) waits on the human, whatever the terminal says; Shepherdr's
  // update cards don't count
  const last = chat.messages.findLast((m) => !m.waiting && !m.card)
  return !(last?.question && last.question.sent === undefined)
}

/** the live line shows: herdr says it works and its log has the turn it is on, and no card of its waits on the human */
export function working(chat: Chat) {
  if (!chat.working || !chat.live || chat.finished) return false
  const last = chat.messages.findLast((m) => !m.waiting && !m.card)
  return !(last?.question && last.question.sent === undefined)
}
