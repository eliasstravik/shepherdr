// The Needs you view's list as it stands on a screen: oldest first when it opens, and from then on nothing under the
// thumb moves. A new need only ever joins the end. One that stops waiting (answered here or elsewhere) keeps its place
// until the view closes or Clear, so no card slides into a tap meant for another, and the list never gets shorter under
// a page scrolled to its end.
import type { Need } from '@shared/types.ts'

export interface HeldNeed {
  need: Need
  /** it no longer waits: only its place is kept */
  gone?: boolean
}

/** a plain wait has no id of its own: its time tells a new wait from the last, which joins the end like any new need */
export const needKey = (n: Need) => `${n.chat}\0${n.id}\0${n.at}`

/** the list after a new snapshot: needs is the server's, oldest first */
export function holdNeeds(held: HeldNeed[], needs: Need[]): HeldNeed[] {
  const now = new Map(needs.map((n) => [needKey(n), n]))
  const known = new Set(held.map((h) => needKey(h.need)))
  const kept = held.map((h): HeldNeed => {
    const need = now.get(needKey(h.need))
    return need ? { need } : { need: h.need, gone: true }
  })
  return [...kept, ...needs.filter((n) => !known.has(needKey(n))).map((need) => ({ need }))]
}
