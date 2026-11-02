import type { Snapshot, Task } from '@shared/types.ts'

/** What waits on you at these places, each number what its own list shows: need is the Needs you view's cards here,
 *  ready the Ready tasks of Tasks. */
export function attentionCounts(snap: Snapshot, places: string[]) {
  const ids = new Set(places)
  return { need: snap.needs.filter((n) => ids.has(n.place)).length, ready: snap.tasks.filter((t) => ids.has(t.place) && !t.archived && t.status === 'ready').length }
}

export const actionable = (t: Task) => t.status === 'need' || t.status === 'ready'
