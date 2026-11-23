// A message's reactions as chips (SHEP-332): one chip per emoji, with how many reacted with it, and whether one of them
// is you (that chip is tinted and a tap takes it back). As in WhatsApp and iMessage you keep one reaction per message:
// picking another changes it.
import type { Reaction } from '@shared/types.ts'

export interface Chip {
  emoji: string
  count: number
  /** you reacted with it */
  mine: boolean
  /** still on its way to the agent */
  pending: boolean
}

export function chipsOf(list: Reaction[] | undefined): Chip[] {
  const out = new Map<string, Chip>()
  for (const r of list ?? []) {
    const c = out.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, pending: false }
    c.count += r.by === 'both' ? 2 : 1
    c.mine ||= r.by === 'me' || r.by === 'both'
    c.pending ||= !!r.pending
    out.set(r.emoji, c)
  }
  return [...out.values()]
}

/** your reactions on a message now */
export const minesOf = (list: Reaction[] | undefined) => chipsOf(list).filter((c) => c.mine).map((c) => c.emoji)

/** The toggles a pick sends (each toggles one emoji of yours on the agent's side): the same emoji again takes it back;
 *  another one takes your old one back first and adds the new one. */
export function togglesFor(list: Reaction[] | undefined, pick: string): string[] {
  const mine = minesOf(list)
  if (mine.includes(pick)) return [pick]
  return [...mine, pick]
}

/** what a screen reader hears for a chip */
export function chipLabel(c: Chip): string {
  const who = c.mine ? (c.count > 1 ? 'You and the agent' : 'You') : 'The agent'
  return `${c.emoji} from ${who}. ${c.mine ? 'Tap to remove yours' : 'Tap to react the same'}`
}
