// Split view (desktop): the middle holds up to three panes side by side, each a space's chat, a task's chat, an
// artifact or a space's tasks. One has the focus: the sidebar's selection, the lists on the right and the keys follow
// it, and a place picked opens in it. Dividers between them resize them; each closes, or becomes the only one. With
// no panes the middle is as it always was (a place's chat, or a pinned list's task). Remembered on this device.

export interface Pane {
  kind: 'place' | 'task' | 'artifact' | 'tasks'
  id: string
}

export interface Panes {
  /** left to right; none: the middle as always */
  panes: Pane[]
  /** the focused one (-1: the open task on the right has it) */
  pane: number
  /** each one's share of the middle's width */
  sizes: number[]
}

/** at most this many side by side */
export const MAX_PANES = 3
/** a pane keeps at least this much: a window with no room for another opens it in place of one */
export const PANE_MIN = 300

const KEY = 'shepherdr.panes'
export const NO_PANES: Panes = { panes: [], pane: 0, sizes: [] }

export const samePane = (a: Pane) => (b: Pane) => a.kind === b.kind && a.id === b.id

/** a single place's chat is the middle as always: no panes then */
export function normal(v: Panes): Panes {
  const { panes } = v
  if (!panes.length || (panes.length === 1 && panes[0].kind === 'place')) return NO_PANES
  const sizes = v.sizes.length === panes.length && v.sizes.every((s) => s > 0) ? v.sizes : panes.map(() => 1)
  return { panes, pane: Math.max(-1, Math.min(v.pane, panes.length - 1)), sizes }
}

/** `p` opened beside the focused pane (or `start`, the middle as it shows now, and `p`); one already open is focused.
 *  At `cap` it takes the place of the pane beside the focused one. */
export function opened(v: Panes, start: Pane, p: Pane, cap: number): Panes {
  const panes = v.panes.length ? v.panes : [start]
  const at = panes.findIndex(samePane(p))
  if (at >= 0) return { ...v, panes, sizes: v.panes.length ? v.sizes : [1], pane: at }
  const from = v.panes.length ? Math.max(0, v.pane) : 0
  if (cap <= 1) return normal({ panes: [p], pane: 0, sizes: [1] })
  if (panes.length >= cap) {
    const i = from + 1 < panes.length ? from + 1 : from - 1
    return { panes: panes.map((x, j) => (j === i ? p : x)), pane: i, sizes: panes.map(() => 1) }
  }
  const next = [...panes.slice(0, from + 1), p, ...panes.slice(from + 1)]
  return { panes: next, pane: from + 1, sizes: next.map(() => 1) }
}

/** pane `i` closed: its neighbour takes the focus */
export function closed(v: Panes, i: number): Panes {
  const panes = v.panes.filter((_, j) => j !== i)
  const sizes = v.sizes.filter((_, j) => j !== i)
  const pane = v.pane > i ? v.pane - 1 : v.pane === i ? Math.min(i, panes.length - 1) : v.pane
  return normal({ panes, pane: Math.max(0, pane), sizes })
}

/** pane `i` the only one */
export const only = (v: Panes, i: number): Panes => normal({ panes: [v.panes[i]], pane: 0, sizes: [1] })

/** pane `i` shows `p` instead (one open elsewhere is focused there instead) */
export function replaced(v: Panes, i: number, p: Pane): Panes {
  const at = v.panes.findIndex(samePane(p))
  if (at >= 0) return { ...v, pane: at }
  return normal({ ...v, panes: v.panes.map((x, j) => (j === i ? p : x)) })
}

export function loadPanes(): Panes {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Panes> | null
    if (!v || !Array.isArray(v.panes)) return NO_PANES
    const panes = v.panes
      .filter((p): p is Pane => !!p && ['place', 'task', 'artifact', 'tasks'].includes(p.kind) && typeof p.id === 'string' && !!p.id)
      .slice(0, MAX_PANES)
    const sizes = Array.isArray(v.sizes) ? v.sizes.filter((s) => typeof s === 'number' && s > 0) : []
    return normal({ panes, pane: typeof v.pane === 'number' ? v.pane : 0, sizes })
  } catch {
    return NO_PANES
  }
}

export function savePanes(v: Panes) {
  try {
    if (v.panes.length) localStorage.setItem(KEY, JSON.stringify(v))
    else localStorage.removeItem(KEY)
  } catch {
    /* private window: one pane again next time */
  }
}
