// What a finger does on a message (SHEP-332), as the good chat apps read it: a quick tap shows the quick actions beside
// it, a press held still opens the whole menu, and a slide to the right replies. The slide waits until the finger
// clearly goes sideways, so scrolling up and down, selecting words and the screen's own edge swipe keep working.

/** held this long without moving: the whole menu */
export const HOLD_MS = 450
/** a finger that moves this far was not a tap or a hold */
export const SLOP = 8
/** slid this far (px) to the right, let go: a reply */
export const REPLY_AT = 64
/** the furthest a message slides; past REPLY_AT it moves slower, as if on a rubber band */
export const MAX_SLIDE = 96
/** a finger that starts this near the screen's left edge belongs to the system (Back) or the sidebar */
export const EDGE_PX = 24

/** how far the message shows slid for a finger moved `dx` to the right */
export function slid(dx: number): number {
  if (dx <= 0) return 0
  if (dx <= REPLY_AT) return dx
  return Math.min(MAX_SLIDE, REPLY_AT + (dx - REPLY_AT) * 0.35)
}

export type Way = 'undecided' | 'slide' | 'scroll'

/** Which way a moving finger goes: sideways to the right clearly more than up or down is a slide; up, down or to the
 *  left is the page's (scrolling, the drawer). Undecided until it has moved past the slop. */
export function wayOf(dx: number, dy: number): Way {
  if (Math.hypot(dx, dy) < SLOP) return 'undecided'
  return dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.5 ? 'slide' : 'scroll'
}

/** what a finger did once it lets go */
export type Outcome = 'tap' | 'hold' | 'reply' | 'back' | 'none'

/** One finger on one message, from down to up. `now` is the clock (ms), so tests can run it without waiting. */
export class Finger {
  readonly x0: number
  readonly y0: number
  readonly t0: number
  way: Way = 'undecided'
  dx = 0
  /** past REPLY_AT now (the haptic tick fires once each time it crosses) */
  armed = false
  held = false
  readonly edge: boolean

  constructor(x: number, y: number, t: number) {
    this.x0 = x
    this.y0 = y
    this.t0 = t
    this.edge = x < EDGE_PX
  }

  /** the finger moved: what the message shows now, and whether it just crossed the reply mark */
  move(x: number, y: number): { slide: number; crossed: boolean } {
    const dx = x - this.x0
    const dy = y - this.y0
    if (this.way === 'undecided' && !this.held) this.way = this.edge ? (Math.hypot(dx, dy) < SLOP ? 'undecided' : 'scroll') : wayOf(dx, dy)
    if (this.way !== 'slide') return { slide: 0, crossed: false }
    this.dx = Math.max(0, dx)
    const was = this.armed
    this.armed = this.dx >= REPLY_AT
    return { slide: slid(this.dx), crossed: this.armed && !was }
  }

  /** the hold timer fired: a hold, if the finger has not moved off */
  hold(t: number): boolean {
    if (this.way !== 'undecided' || t - this.t0 < HOLD_MS) return false
    this.held = true
    return true
  }

  /** the finger let go */
  up(): Outcome {
    if (this.held) return 'hold'
    if (this.way === 'slide') return this.armed ? 'reply' : 'back'
    if (this.way === 'undecided') return 'tap'
    return 'none'
  }
}

/** Where the quick bar goes and how much it holds: beside the message on its open side (right of the agent's, left of
 *  yours), every action when there is room, else only the reaction; with no room at all it sits over the message's
 *  edge. `room` is the free width (px) on that side. */
export type QuickFit = { actions: 'all' | 'react'; over: boolean; time: boolean }
export const QUICK_BTN = 40
const PAD = 4
const GAP = 8
const TIME_W = 52
export function quickFit(room: number, wide: boolean): QuickFit {
  const all = 3 * QUICK_BTN + 2 * PAD + GAP
  const one = QUICK_BTN + 2 * PAD + GAP
  if (wide && room >= all) return { actions: 'all', over: false, time: room >= all + TIME_W }
  if (room >= one) return { actions: 'react', over: false, time: room >= one + TIME_W }
  return { actions: wide ? 'all' : 'react', over: true, time: false }
}
