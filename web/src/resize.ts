// Every split can be dragged: the edge between the list and the chat, between the chat and the pane, and the top of
// the terminal. Double-click puts it back. Sizes are remembered on this device. A phone has no splits.
// SHEP-336: a double tap (a finger or a pen) on the edge beside the pane swaps the chat and the pane, as Android's split
// screen does; a mouse's double click still puts the size back. With the pane on the left its edge drags the other way.
import type { PointerEvent as RPE } from 'react'

type Edge = 'side' | 'pane' | 'term'
const VAR: Record<Edge, string> = { side: '--side-w', pane: '--pane-w', term: '--term-h' }
const KEY = 'shepherdr.sizes'
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

function load(): Partial<Record<Edge, number>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<Edge, number>>
  } catch {
    return {}
  }
}
function save(sizes: Partial<Record<Edge, number>>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sizes))
  } catch {
    /* a private window */
  }
}

/** The limits: the list 180 px to 40% of the window (at most 440), the pane 280 px to 60% (at most 820), the terminal
 *  80 px up to the chat's height less room for the message box. */
export function limit(edge: Edge, v: number, width: number, chatHeight: number): number {
  if (edge === 'side') return clamp(v, 180, Math.min(440, width * 0.4))
  if (edge === 'pane') return clamp(v, 280, Math.min(820, width * 0.6))
  return clamp(v, 80, Math.max(80, chatHeight - 260))
}

/** put the remembered sizes on the page */
export function applySizes() {
  const s = load()
  for (const k of Object.keys(VAR) as Edge[]) if (typeof s[k] === 'number') document.documentElement.style.setProperty(VAR[k], `${s[k]}px`)
}

/** two taps this close (ms) and this near (px) are a double tap */
const TAP2_MS = 350
const TAP_PX = 10
let lastTap: { at: number; x: number; y: number; edge: Edge } | null = null
let lastType = 'mouse'

/** Is a tap at (x, y) at `at` the second of a double tap on the same edge? */
export function secondTap(prev: typeof lastTap, at: number, x: number, y: number, which: Edge): boolean {
  return !!prev && prev.edge === which && at - prev.at < TAP2_MS && Math.hypot(x - prev.x, y - prev.y) < TAP_PX * 3
}

/** props for an edge's handle; `onDoubleTap`: what a double tap with a finger or pen does instead of resizing */
export function edge(which: Edge, onDoubleTap?: () => void) {
  return {
    'aria-hidden': true,
    onDoubleClick: () => {
      // a finger's double tap already did its own thing (Chrome sends a dblclick after it too)
      if (onDoubleTap && lastType !== 'mouse') return
      document.documentElement.style.removeProperty(VAR[which])
      const s = load()
      delete s[which]
      save(s)
    },
    onPointerDown: (e: RPE<HTMLElement>) => {
      e.preventDefault()
      lastType = e.pointerType
      const touch = e.pointerType !== 'mouse'
      if (onDoubleTap && touch && secondTap(lastTap, e.timeStamp, e.clientX, e.clientY, which)) {
        lastTap = null
        onDoubleTap()
        return
      }
      const el = e.currentTarget
      const shell = el.closest('.shell')?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight)
      const col = el.closest('.col')
      const chatH = col?.getBoundingClientRect().height ?? innerHeight
      const term = col?.querySelector<HTMLElement>('.tdr .termbox')
      const t0 = term?.getBoundingClientRect().height ?? 170
      const y0 = e.clientY
      const x0 = e.clientX
      const down = e.timeStamp
      // the pane on the left (the chat swapped to the right): its width runs from its own left edge
      const pane = el.closest('.shell')?.querySelector<HTMLElement>(':scope > .pane')
      const paneLeft = el.closest('.shell')?.classList.contains('swap') ? pane?.getBoundingClientRect().left ?? null : null
      let last = 0
      let far = 0
      el.classList.add('on')
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* a pointer the page no longer has */
      }
      const move = (ev: PointerEvent) => {
        far = Math.max(far, Math.hypot(ev.clientX - x0, ev.clientY - y0))
        if (touch && far < TAP_PX) return
        const raw = which === 'side' ? ev.clientX - shell.left : which === 'pane' ? (paneLeft !== null ? ev.clientX - paneLeft : shell.right - ev.clientX) : t0 + (y0 - ev.clientY)
        last = limit(which, raw, shell.width, chatH)
        document.documentElement.style.setProperty(VAR[which], `${last}px`)
      }
      const end = () => {
        el.classList.remove('on')
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', end)
        el.removeEventListener('pointercancel', end)
        lastTap = touch && far < TAP_PX ? { at: down, x: x0, y: y0, edge: which } : null
        if (last) save({ ...load(), [which]: last })
        dispatchEvent(new Event('app-resized'))
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', end)
      el.addEventListener('pointercancel', end)
    },
  }
}
