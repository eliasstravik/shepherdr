import { needsYou, waitingTasks } from '@shared/needs-you.ts'
import type { Snapshot, Task } from '@shared/types.ts'

/** What waits on you at these places, each number what its own list shows: need is Needs you's items here (one rule for
 *  every view, web/shared/needs-you.ts), ready the Ready tasks of Tasks not in it. */
export function attentionCounts(snap: Snapshot, places: string[]) {
  const ids = new Set(places)
  const ws = needsYou(snap)
  const held = waitingTasks(ws)
  return { need: ws.filter((w) => w.place && ids.has(w.place)).length, ready: snap.tasks.filter((t) => ids.has(t.place) && !t.archived && t.status === 'ready' && !held.has(t.id)).length }
}

export const actionable = (t: Task) => t.status === 'need' || t.status === 'ready'
