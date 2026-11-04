// Swipes that move whole screens: from the left edge (or across a free part of the screen) the places drawer opens or
// a pushed screen goes back, a left swipe shuts the drawer, a sheet drags down to close. Each follows the finger and
// lands where the fling takes it. A swipe that starts on a message is the message's (it replies, or shows the
// times), as is one on a box you type in or on anything that scrolls sideways; from the screen's very edge the swipe
// is always the screen's.

/** a swipe starting this close to a screen's left edge always moves the screen: about a thumb's width, as a finger
 *  lands a little in from the very edge of a phone (and its case) */
export const EDGE = 32
/** how far a finger goes before a swipe picks its way */
const SLOP = 8

// A swipe the app has taken keeps the page still: iOS would otherwise start scrolling the list under a finger that
// drifts up or down, take the touch away (pointercancel) and drop the swipe halfway. Only a touchmove listener that
// was there as the touch began (and isn't passive) can stop that, so this one always is; it does nothing until a
// swipe is taken.
let held = false
if (typeof addEventListener === 'function')
  addEventListener('touchmove', (e) => held && e.cancelable && e.preventDefault(), { capture: true, passive: false })

/** what keeps sideways swipes to itself: boxes you type in, frames, messages (useHold marks them) and anything the
 *  app gives every touch to */
const OWN = 'input, textarea, select, [contenteditable=true], iframe, [data-hold], [data-no-pan], [role=slider], [role=separator], .touch-none'

/** May a sideways swipe starting here move the screen? x is from the left edge of what would move. */
export function mayPanX(target: EventTarget | null, x: number) {
  if (x < EDGE) return true
  const el = target instanceof Element ? target : null
  if (!el) return true
  if (el.closest(OWN)) return false
  // anything under the finger that scrolls sideways (a code block, a table, a row of tabs) keeps the swipe
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement)
    if (n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return false
  return true
}

/** May a downward drag starting here pull a sheet down? Not on a box, nor inside a list that scrolls (it scrolls, or
 *  bounces at its top): from the sheet's grabber, its header, or anywhere else that stays put. */
export function mayPanDown(target: EventTarget | null, panel: Element) {
  const el = target instanceof Element ? target : null
  if (!el || el.closest(OWN)) return false
  for (let n: Element | null = el; n && n !== panel.parentElement; n = n.parentElement)
    if (n.scrollTop > 0 || (n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY) && n !== panel)) return false
  return true
}

export interface Pan {
  /** along the axis, from where the finger went down (px) */
  d: number
  /** its speed along the axis as the finger let go (px per ms) */
  v: number
}

/**
 * Follow a finger from its pointerdown: once it has moved a few px mostly along the axis the way asked (sign), the
 * swipe is the caller's (start, then move as it goes and end as it lets go); otherwise it is left alone (a scroll,
 * a tap). `lean` is how far off the axis it may go and still be taken: along it at least `lean` times as far as
 * across (a swipe from the screen's edge, a thumb's arc, may lean more). Once taken it follows the finger from where
 * it went down, and the page doesn't scroll under it. A mouse is left alone. The tap a swipe ends with clicks nothing.
 */
export function follow(
  e: PointerEvent,
  o: { axis: 'x' | 'y'; sign: 1 | -1; lean?: number; start?: () => boolean | void; move: (d: number) => void; end: (p: Pan) => void; cancel?: () => void },
) {
  if (e.pointerType === 'mouse' || !e.isPrimary) return
  const id = e.pointerId
  const x0 = e.clientX
  const y0 = e.clientY
  let mine = false
  // where the finger was lately, from where it went down: a quick flick may be over in a move or two
  const trail: { t: number; d: number }[] = [{ t: e.timeStamp, d: 0 }]
  const along = (ev: PointerEvent) => (o.axis === 'x' ? ev.clientX - x0 : ev.clientY - y0)
  const across = (ev: PointerEvent) => (o.axis === 'x' ? ev.clientY - y0 : ev.clientX - x0)
  const stop = () => {
    held = false
    removeEventListener('pointermove', move, true)
    removeEventListener('pointerup', up, true)
    removeEventListener('pointercancel', cancel, true)
  }
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    const a = along(ev)
    if (!mine) {
      const b = across(ev)
      if (Math.hypot(a, b) < SLOP) return
      // mostly along the axis, and the way asked: the swipe is ours; any other way, the browser's
      if (Math.abs(a) < Math.abs(b) * (o.lean ?? 1.2) || Math.sign(a) !== o.sign || o.start?.() === false) return stop()
      mine = true
      held = true
      try {
        ;(e.target as Element | null)?.setPointerCapture?.(id)
      } catch {
        /* a pointer already gone */
      }
      // the tap that ends the swipe clicks nothing (the app's own clicks, like buzz's, still go)
      const eat = (c: Event) => {
        if (!c.isTrusted) return
        removeEventListener('click', eat, true)
        c.stopPropagation()
        c.preventDefault()
      }
      const done = () => removeEventListener('click', eat, true)
      addEventListener('click', eat, true)
      // no click may come at all (a drag makes none): the next touch is a tap of its own
      addEventListener('pointerdown', done, { capture: true, once: true })
      setTimeout(done, 400)
    }
    ev.preventDefault()
    trail.push({ t: ev.timeStamp, d: a })
    while (trail.length > 2 && ev.timeStamp - trail[0].t > 100) trail.shift()
    o.move(a)
  }
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    stop()
    if (!mine) return
    const d = along(ev)
    // its speed over the last moment before it let go: a finger that stopped first has none, however fast it came
    const first = trail.find((p) => ev.timeStamp - p.t <= 100)
    const dt = first ? ev.timeStamp - first.t : 0
    o.end({ d, v: first && dt > 0 ? (d - first.d) / dt : 0 })
  }
  const cancel = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    stop()
    if (mine) o.cancel?.()
  }
  addEventListener('pointermove', move, true)
  addEventListener('pointerup', up, true)
  addEventListener('pointercancel', cancel, true)
}
