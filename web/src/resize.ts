// Every split can be dragged: the edge between the list and the chat, between the chat and the pane, and the top of
// the terminal. Double-click puts it back. Sizes are remembered on this device. A phone has no splits.
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

/** props for an edge's handle */
export function edge(which: Edge) {
  return {
    'aria-hidden': true,
    onDoubleClick: () => {
      document.documentElement.style.removeProperty(VAR[which])
      const s = load()
      delete s[which]
      save(s)
    },
    onPointerDown: (e: RPE<HTMLElement>) => {
      e.preventDefault()
      const el = e.currentTarget
      const shell = el.closest('.shell')?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight)
      const col = el.closest('.col')
      const chatH = col?.getBoundingClientRect().height ?? innerHeight
      const term = col?.querySelector<HTMLElement>('.tdr .termbox')
      const t0 = term?.getBoundingClientRect().height ?? 170
      const y0 = e.clientY
      let last = 0
      el.classList.add('on')
      el.setPointerCapture(e.pointerId)
      const move = (ev: PointerEvent) => {
        const raw = which === 'side' ? ev.clientX - shell.left : which === 'pane' ? shell.right - ev.clientX : t0 + (y0 - ev.clientY)
        last = limit(which, raw, shell.width, chatH)
        document.documentElement.style.setProperty(VAR[which], `${last}px`)
      }
      const end = () => {
        el.classList.remove('on')
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', end)
        el.removeEventListener('pointercancel', end)
        if (last) save({ ...load(), [which]: last })
        dispatchEvent(new Event('app-resized'))
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', end)
      el.addEventListener('pointercancel', end)
    },
  }
}
