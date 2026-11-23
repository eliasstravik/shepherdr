// When a chat shows its agent's working sign (SHEP-313): only while herdr says its agent is working and it is in a turn
// that ends in a reply, or its log has the turn it is on, so the sign can never stick after it stops or while only its
// background work runs, and never while it waits on the human.
import type { Chat } from '@shared/types.ts'

/** a question card it posted last (its own, or the CLI's menu) waits on the human, whatever the terminal says;
 *  Shepherdr's update cards don't count */
function asks(chat: Chat) {
  const last = chat.messages.findLast((m) => !m.waiting && !m.card)
  return !!(last?.question && last.question.sent === undefined)
}

/** it works on a turn that ends in words you will see */
export function typing(chat: Chat) {
  if (!chat.working || chat.background || chat.finished) return false
  return !asks(chat)
}

/** herdr says it works and its log has the turn it is on, and no card of its waits on the human */
export function working(chat: Chat) {
  if (!chat.working || !chat.live || chat.live.end || chat.finished) return false
  return !asks(chat)
}

/** The working sign at the chat's end: null when it doesn't show; else the step it is on, one line ('' when nothing is
 *  known: the sign alone). It goes with the turn: once herdr says it stopped working, it ended or crashed, or a card of
 *  its waits on you. Words that arrive mid-turn land above it; it stays below them while the next step runs. */
export function signOf(chat: Chat | undefined): { step: string } | null {
  if (!chat || chat.notice === 'ended' || chat.notice === 'gone') return null
  const live = working(chat)
  if (!live && !typing(chat)) return null
  const now = live ? chat.live?.now : undefined
  const step = chat.doing || now?.doing || now?.title || ''
  return { step: step.replace(/\s+/g, ' ').trim() }
}
