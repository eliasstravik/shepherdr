// Messages held for the agent's turn (#1560): sent with Ctrl/Cmd+Enter, or a long press on Send on a phone, while it
// works. Shepherdr keeps them (service/actions.ts `held`) and sends them once it is free; until then each is a row over
// the box with Send now, Edit and Remove, so a wrong one can still be fixed or taken back.
import type { Chat, Question } from '@shared/types.ts'
import type { Outgoing } from '@client/outbox.ts'

/** one held for its turn, not one that failed */
export const isHeld = (o: Outgoing) => o.state !== 'failed' && (!!o.hold || o.waitsFor === 'turn')

/** this chat's held ones, oldest first, until the chat has them (they went in) */
export function heldOf(outbox: Outgoing[], key: string, chat?: Chat): Outgoing[] {
  return outbox.filter((o) => o.chat === key && isHeld(o) && !chat?.messages.some((m) => m.cid === o.cid))
}

/** Edit on a held one: its words back in the box, above what is typed there now */
export const editedDraft = (held: string, now: string) => (now.trim() ? `${held}\n\n${now}` : held)

/** a question this chat's own agent asks with quick answers and room for your own (not a permission, a plan, or a
 *  worker's question copied here): while one is open, the box's words answer it too */
export function ownAsk(chat?: Chat): Question | undefined {
  for (let i = (chat?.messages.length ?? 0) - 1; i >= 0; i--) {
    const q = chat!.messages[i]!.question
    if (q && q.other && !q.by && q.sent === undefined && !q.closed) return q
  }
  return undefined
}
