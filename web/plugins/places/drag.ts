// Dragging a machine or a project into the order you want. A mouse drags a row at once; a finger holds it first (a
// project's menu opens then, as before) and slides it, which closes the menu. The rows it passes make room for it; let
// go, it settles into its slot. A machine takes its projects along, a section its spaces; a space moves among those
// beside it, or out onto another section (its heading, or a row in it: before that one) where it may go, which lights up.
import type { PointerEvent as ReactPointerEvent } from 'react'
import { flushSync } from 'react-dom'
import { still } from '@client/motion.ts'
import { HOLD_MS } from '@client/rowmenu.tsx'

export interface Press {
  /** the row's place, and the places it moves among (itself too), as they show */
  id: string
  siblings: string[]
  /** a machine's rows are its own and its projects' (data-machine); a project's its own (data-project), a pinned row's
   *  its own (data-pin) */
  level: 'machine' | 'project' | 'section'
  /** the new order, once it lands somewhere else; inside flushSync, so the rows are in it when it settles */
  drop: (ids: string[]) => void
  /** a space: the group it is in (data-drop on its rows and heading), whether it may go into another, and going there
   *  (before a space there, or last) */
  into?: { group: string; may: (group: string) => boolean; go: (group: string, before?: string) => void }
  /** a finger held the row long enough: its menu opens; slid, it closes (lift); the finger went up (release) */
  hold?: (el: HTMLElement) => void
  lift?: () => void
  release?: () => void
}

interface Block {
  id: string
  els: HTMLElement[]
  top: number
  bottom: number
}

const EASE = 'transform 160ms cubic-bezier(0.2, 0, 0, 1)'
let active = false

/** a row is being dragged: what a held finger would do otherwise (a context menu) waits */
export const dragging = () => active

/** a pointer went down on a row that can be dragged: follows it until it goes up */
export function press(e: ReactPointerEvent<HTMLElement>, o: Press) {
  if ((e.pointerType === 'mouse' && e.button !== 0) || e.ctrlKey || (e.target as HTMLElement).closest('[role=menu]')) return
  const el = e.currentTarget
  const mouse = e.pointerType === 'mouse'
  const id = e.pointerId
  const x0 = e.clientX
  const y0 = e.clientY
  const movable = o.siblings.length > 1 || !!o.into
  let held = mouse
  let blocks: Block[] = []
  let from = -1
  let to = -1
  let dy = 0
  let gap = 0
  /** another group it is over, where it may go: its heading lit, and the row it goes before */
  let over: { group: string; before?: string; lit: HTMLElement[] } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  if (!mouse)
    timer = setTimeout(() => {
      held = true
      if (o.hold) o.hold(el)
      else navigator.vibrate?.(10)
    }, HOLD_MS)

  const rowsOf = (k: string) => [...el.parentElement!.children].filter((x): x is HTMLElement => x instanceof HTMLElement && x.dataset[o.level] === k)
  const begin = () => {
    blocks = o.siblings.map((k) => {
      const els = rowsOf(k)
      const rs = els.map((x) => x.getBoundingClientRect())
      return { id: k, els, top: Math.min(...rs.map((r) => r.top)), bottom: Math.max(...rs.map((r) => r.bottom)) }
    })
    from = to = o.siblings.indexOf(o.id)
    if (from < 0 || blocks.some((b) => !b.els.length)) return false
    gap = blocks.length > 1 ? Math.max(0, blocks[1].top - blocks[0].bottom) : 0
    active = true
    o.lift?.()
    for (const [i, b] of blocks.entries())
      for (const x of b.els) {
        x.style.transition = i === from ? 'none' : still() ? 'none' : EASE
        if (i === from) x.dataset.dragging = ''
      }
    if (mouse) document.documentElement.style.cursor = 'grabbing'
    navigator.vibrate?.(10)
    return true
  }
  /** the group under the pointer, other than its own, where it may go */
  const target = (x: number, y: number) => {
    if (!o.into) return null
    const mine = new Set(blocks[from].els)
    const hit = document.elementsFromPoint(x, y).find((e) => ![...mine].some((m) => m.contains(e)))
    const row = hit?.closest<HTMLElement>('[data-drop]')
    const group = row?.dataset.drop
    if (!row || !group || group === o.into.group || !o.into.may(group)) return null
    const before = row.dataset.heading ? undefined : row.dataset.project
    const heading = document.querySelector<HTMLElement>(`[data-heading="${CSS.escape(group)}"]`)
    return { group, before, lit: [heading, before ? row : null].filter((e): e is HTMLElement => !!e) }
  }
  const light = (next: typeof over) => {
    if (over?.group === next?.group && over?.before === next?.before) return
    for (const e of over?.lit ?? []) delete e.dataset.dropOver
    over = next
    for (const e of over?.lit ?? []) e.dataset.dropOver = e.dataset.heading ? 'heading' : 'before'
  }
  const place = (y: number, x: number) => {
    const me = blocks[from]
    light(target(x, y))
    if (over) {
      // out over another group: it follows the pointer, and the rest stay as they were
      dy = y - y0
      to = from
      for (const x of me.els) x.style.transform = `translateY(${dy}px)`
      for (const [i, b] of blocks.entries()) if (i !== from) for (const x of b.els) x.style.transform = ''
      return
    }
    dy = Math.min(Math.max(y - y0, blocks[0].top - me.top), blocks.at(-1)!.bottom - me.bottom)
    // it passes a row once its top edge (going up) or bottom edge (going down) is past that row's middle
    const others = blocks.filter((_, i) => i !== from)
    to = others.filter((b, k) => (b.top + b.bottom) / 2 < (k < from ? me.top : me.bottom) + dy).length
    const room = me.bottom - me.top + gap
    for (const x of me.els) x.style.transform = `translateY(${dy}px)`
    for (const [k, b] of others.entries()) {
      const i = k < from ? k : k + 1
      const shift = i < from && k >= to ? room : i > from && k < to ? -room : 0
      for (const x of b.els) x.style.transform = shift ? `translateY(${shift}px)` : ''
    }
  }
  const clear = () => {
    for (const b of blocks) for (const x of b.els) Object.assign(x.style, { transform: '', transition: '' })
  }
  /** let go: the rows take their new order, and the dragged one glides the last bit into its slot */
  const settle = () => {
    const me = blocks[from]
    if (over) {
      const { group, before } = over
      light(null)
      clear()
      for (const x of me.els) delete x.dataset.dragging
      flushSync(() => o.into!.go(group, before))
      return
    }
    const at = me.top + dy
    const ids = blocks.filter((_, i) => i !== from).map((b) => b.id)
    ids.splice(to, 0, me.id)
    clear()
    if (to !== from) flushSync(() => o.drop(ids))
    const now = Math.min(...me.els.map((x) => x.getBoundingClientRect().top))
    for (const x of me.els) Object.assign(x.style, { transition: 'none', transform: `translateY(${at - now}px)` })
    void el.offsetHeight
    for (const x of me.els) Object.assign(x.style, { transition: still() ? 'none' : EASE, transform: '' })
    setTimeout(() => {
      for (const x of me.els) {
        delete x.dataset.dragging
        x.style.transition = ''
      }
    }, still() ? 0 : 170)
  }

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    if (active) return place(ev.clientY, ev.clientX)
    const far = Math.hypot(ev.clientX - x0, ev.clientY - y0)
    // a finger that moves before the hold scrolls the list
    if (!held) return far > 8 && end()
    if (movable && far > (mouse ? 4 : 8) && begin()) place(ev.clientY, ev.clientX)
  }
  // once held, the finger drags the row instead of scrolling the list
  const touch = (ev: TouchEvent) => (held || active) && ev.cancelable && ev.preventDefault()
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    const was = active
    end()
    if (!was) return
    settle()
    // the click a drag ends with opens nothing
    const swallow = (c: MouseEvent) => (c.stopPropagation(), c.preventDefault())
    addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => removeEventListener('click', swallow, { capture: true }), 50)
  }
  const cancel = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    const was = active
    end()
    if (was) {
      to = from
      light(null)
      settle()
    }
  }
  const end = () => {
    clearTimeout(timer)
    removeEventListener('pointermove', move)
    removeEventListener('pointerup', up)
    removeEventListener('pointercancel', cancel)
    removeEventListener('touchmove', touch)
    if (mouse) document.documentElement.style.cursor = ''
    active = false
    o.release?.()
  }
  addEventListener('pointermove', move)
  addEventListener('pointerup', up)
  addEventListener('pointercancel', cancel)
  addEventListener('touchmove', touch, { passive: false })
}
