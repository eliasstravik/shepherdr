// How the screen moves, the way iOS does: screens push in from the right and pop back, sheets slide up and drop away,
// menus spring out of their button and fade, the drawer follows the finger. Only transform and opacity move (the GPU
// draws them), and with reduced motion everything just fades, quickly. A part that goes away leaves a still copy of
// itself behind for its last moment (its ghost), so it can slide or fade out however it was closed: a button, Esc,
// Back, or a step back in the history.
import { useLayoutEffect, useRef, type RefObject } from 'react'

/** iOS's curve for sheets and pushed screens: quick off the mark, a long soft landing */
export const IOS = 'cubic-bezier(0.32, 0.72, 0, 1)'
/** a spring with a little overshoot: a menu growing out of its button */
export const SPRING = 'cubic-bezier(.25, 1.12, .4, 1)'
/** leaving: gone fast */
export const AWAY = 'cubic-bezier(.4, 0, 1, 1)'

export const PUSH_MS = 440
export const SHEET_MS = 460

export const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

let hushed = 0
/** what changes this moment lands without moving: a swipe (the app's or the system's) already moved it */
export function hush(ms = 150) {
  hushed = performance.now() + ms
}
export const hushedNow = () => performance.now() < hushed

/** where a fling comes to rest: where the finger let go, carried on by its speed (px per ms), like iOS projects it */
export const project = (at: number, v: number) => at + v * 200

/** a finger this fast (px per ms) as it lets go flings: it goes its way however short the swipe */
const FLING = 0.3

/** Does a swipe let go at `at` with speed `v` land past `mark`? A fling goes the way it was going, as iOS's drawers and
 *  swipe back do; a slow let-go lands where it is carried. */
export const lands = (at: number, v: number, mark: number) => (Math.abs(v) > FLING ? v > 0 : project(at, v) > mark)

/** how long the rest of a slide takes once the finger lets go: a fast fling lands quickly, a slow one at the usual pace */
export function settleMs(left: number, v: number, base = PUSH_MS) {
  const speed = Math.abs(v)
  if (speed < 0.05) return base
  return Math.round(Math.min(base, Math.max(200, (Math.abs(left) / speed) * 2.5)))
}

/** Play a move from where an element is now to `to`; it stays there (as its own style) when done. */
export function moveTo(el: HTMLElement, to: Keyframe, ms: number, easing = IOS): Promise<void> {
  const from: Keyframe = {}
  const cs = getComputedStyle(el)
  for (const k of Object.keys(to)) from[k] = cs.getPropertyValue(k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`))
  for (const a of el.getAnimations()) a.cancel()
  Object.assign(el.style, to)
  if (!ms) return Promise.resolve()
  return el
    .animate([from, to], { duration: ms, easing })
    .finished.then(
      () => undefined,
      () => undefined,
    )
}

/* ---------- coming in and going out ---------- */

/** a menu springs out of its button; a sheet slides up (phone); a dialog grows into the middle (wider); a page pushes
 *  in from the right; a fade just fades */
export type Motion = 'menu' | 'sheet' | 'dialog' | 'page' | 'fade'

/** the part of a sheet or dialog that moves; the rest of it is the shade behind */
const panelOf = (el: HTMLElement) => el.querySelector<HTMLElement>(':scope > [data-panel]') ?? el

function enter(el: HTMLElement, m: Motion) {
  if (hushedNow()) return
  if (still()) return void el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' })
  const p = panelOf(el)
  if (m === 'menu') p.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: SPRING })
  else if (m === 'page') p.animate([{ transform: 'translateX(100%)' }, { transform: 'none' }], { duration: PUSH_MS, easing: IOS })
  else if (m === 'fade') p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' })
  else {
    if (p !== el) el.animate([{ backgroundColor: 'transparent' }, {}], { duration: m === 'sheet' ? SHEET_MS : 250, easing: 'ease-out' })
    if (m === 'sheet') p.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: SHEET_MS, easing: IOS })
    else p.animate([{ opacity: 0, transform: 'translateY(8px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: SPRING })
  }
}

function leave(el: HTMLElement, m: Motion): Promise<unknown> {
  if (still()) return el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-in', fill: 'forwards' }).finished
  const p = panelOf(el)
  const opt = { fill: 'forwards' as const }
  if (m === 'menu') return p.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.96)' }], { ...opt, duration: 150, easing: AWAY }).finished
  if (m === 'page') return p.animate([{ transform: 'none' }, { transform: 'translateX(100%)' }], { ...opt, duration: 380, easing: IOS }).finished
  if (m === 'fade') return p.animate([{ opacity: 1 }, { opacity: 0 }], { ...opt, duration: 160, easing: 'ease-in' }).finished
  if (p !== el) el.animate([{}, { backgroundColor: 'transparent' }], { ...opt, duration: 260, easing: 'ease-in' })
  if (m === 'sheet') return p.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], { ...opt, duration: 340, easing: IOS }).finished
  return p.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.97)' }], { ...opt, duration: 160, easing: AWAY }).finished
}

/** A still copy of what is on screen: where it is, scrolled as it is, without ids, frames or anything to load again. */
function ghostOf(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  const copy = el.cloneNode(true) as HTMLElement
  const from = [el, ...el.querySelectorAll<HTMLElement>('*')]
  const to = [copy, ...copy.querySelectorAll<HTMLElement>('*')]
  const scrolled: [HTMLElement, number, number][] = []
  from.forEach((n, i) => (n.scrollTop || n.scrollLeft) && scrolled.push([to[i], n.scrollTop, n.scrollLeft]))
  // a copy, not the thing: nothing finds it by its id, name, role or label, nor as a message (data-msg)
  for (const n of to) for (const a of ['id', 'name', 'role', 'aria-label', 'aria-labelledby', 'data-msg', 'data-anchor', 'data-flip', 'data-arrive', 'data-kb']) n.removeAttribute(a)
  // a frame or a video would load again, a canvas comes back blank: an empty box of their size
  for (const f of copy.querySelectorAll<HTMLElement>('iframe, video, canvas')) {
    const box = document.createElement('div')
    box.className = f.className
    box.style.cssText = `width:${f.offsetWidth}px;height:${f.offsetHeight}px`
    f.replaceWith(box)
  }
  Object.assign(copy.style, { position: 'absolute', inset: 'auto', top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', transform: 'none', translate: 'none' })
  return { copy, scrolled }
}

/** the layer ghosts play on: over the app, drawn the way the app is (its device, type and colours) */
function ghostLayer() {
  const app = document.querySelector<HTMLElement>('[data-device]')
  const g = document.createElement('div')
  g.className = app?.className ?? ''
  if (app?.dataset.device) g.dataset.device = app.dataset.device
  g.dataset.ghost = ''
  g.ariaHidden = 'true'
  g.inert = true
  g.style.cssText = 'position:fixed;inset:0;height:auto;display:block;background:transparent;pointer-events:none;z-index:60;overflow:hidden'
  return g
}

/**
 * A part that comes in and goes out with its motion: in as it shows, and out (as its ghost) however it was closed.
 * One a swipe already moved out is marked data-gone and leaves no ghost; `comesIn` false: it is there at once.
 */
export function useMotion(ref: RefObject<HTMLElement | null>, m: Motion, comesIn = true) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (comesIn) enter(el, m)
    return () => {
      if (el.hasAttribute('data-gone') || hushedNow() || !el.isConnected) return
      const { copy, scrolled } = ghostOf(el)
      // React's strict mode takes a part down and up again in development, leaving it on screen: no ghost then
      queueMicrotask(() => {
        if (el.isConnected) return
        const layer = ghostLayer()
        layer.append(copy)
        document.body.append(layer)
        for (const [n, top, left] of scrolled) {
          n.scrollTop = top
          n.scrollLeft = left
        }
        const done = () => layer.remove()
        leave(copy, m).then(done, done)
        setTimeout(done, 600)
      })
    }
  }, [])
}

/* ---------- lists ---------- */

/** a row gliding to its new place: short, so a change reads as one calm move */
const FLIP_MS = 320

/** where a list's row was last time, in the list's own terms (as if never scrolled); and the row itself, for its ghost */
type Spot = { y: number; x: number; w: number; el: HTMLElement }

/** what a row is moved by now, in the middle of its glide (its layout less where it shows) */
function gliding(el: HTMLElement) {
  if (!el.getAnimations().some((a) => a.id === 'flip')) return 0
  const t = getComputedStyle(el).transform
  return t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0
}

/** the box a list scrolls in */
function scrollerOf(el: HTMLElement) {
  for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p
  return null
}

const middle = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1]

const clear = (c: string) => c === 'transparent' || c === 'rgba(0, 0, 0, 0)'

/** the colour a list is drawn on: what a row passing over another hides it with */
function groundOf(el: HTMLElement) {
  for (let p: HTMLElement | null = el; p; p = p.parentElement) {
    const c = getComputedStyle(p).backgroundColor
    if (!clear(c)) return c
  }
  return 'Canvas'
}

/**
 * Rows of a list (marked data-flip with their key) glide from where they showed to where they are now, as a task moves
 * from Working to Ready; new ones fade in and gone ones fade out where they were. Only rows are marked, never what
 * holds them, so no move adds to another. A change in the middle of a glide carries on from where each row shows,
 * so changes close together never stack. Changes above what shows keep what shows still (as scroll anchoring does,
 * which Safari lacks). When `reset` changes (another place), the new list just shows.
 */
export function useFlip(ref: RefObject<HTMLElement | null>, reset: unknown) {
  const last = useRef<{ reset: unknown; box: HTMLElement; at: Map<string, Spot> } | null>(null)
  const ghosts = useRef(new Set<HTMLElement>())
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return void (last.current = null)
    const was = last.current && last.current.reset === reset && last.current.box === box ? last.current.at : null
    // another list now: what was fading out of the last one goes at once
    if (!was) for (const g of ghosts.current) g.remove()
    const calm = !was || still() || hushedNow()
    const rows = [...box.querySelectorAll<HTMLElement>('[data-flip]')]
    // where each showed just before this change, then the glides stop: what is measured next is the new layout
    const shown = new Map<HTMLElement, number>()
    for (const el of rows) {
      if (!calm) shown.set(el, gliding(el))
      for (const a of el.getAnimations()) if (a.id === 'flip' || a.id === 'flip-in') a.cancel()
    }
    const scroller = scrollerOf(box)
    if (scroller) scroller.style.overflowAnchor = 'none'
    const top0 = box.getBoundingClientRect().top
    const at = new Map<string, Spot>()
    const measure = (top: number) => {
      at.clear()
      const left = box.getBoundingClientRect().left
      for (const el of rows) {
        const r = el.getBoundingClientRect()
        at.set(el.dataset.flip!, { y: r.top - top, x: r.left - left, w: r.width, el })
      }
    }
    measure(top0)
    if (was && scroller && scroller.scrollTop > 0) {
      // what showed stays where it showed: the rows that showed, and are still here, moved by this much
      const view = scroller.getBoundingClientRect()
      const moved: number[] = []
      for (const [k, s] of was) {
        const now = at.get(k)
        if (now && s.y + top0 < view.bottom && s.y + top0 + 1 > view.top) moved.push(now.y - s.y)
      }
      const by = moved.length ? middle(moved) : 0
      if (Math.abs(by) > 0.5) scroller.scrollTop += by
    }
    const top = box.getBoundingClientRect().top
    if (top !== top0) measure(top)
    last.current = { reset, box, at }
    if (calm) return
    // how far what showed moved on screen by the scroll kept still
    const lift = top0 - top
    const ground = groundOf(box)
    for (const el of rows) {
      const s = at.get(el.dataset.flip!)!
      const from = was.get(el.dataset.flip!)
      if (from === undefined) {
        el.animate([{ opacity: 0, transform: 'scale(.98)' }, { opacity: 1, transform: 'none' }], { id: 'flip-in', duration: 260, easing: 'ease-out' })
        continue
      }
      const dy = from.y + (from.el === el ? shown.get(el)! : 0) + lift - s.y
      if (Math.abs(dy) <= 1) continue
      // gliding, a row hides what it passes over; one that changed its group passes over the rest
      const look: Keyframe = { ...(clear(getComputedStyle(el).backgroundColor) && { backgroundColor: ground }), ...(from.el !== el && { zIndex: 1 }) }
      el.animate([{ transform: `translateY(${dy}px)`, ...look }, { transform: 'none', ...look }], { id: 'flip', duration: FLIP_MS, easing: IOS })
    }
    // a row gone (archived, or into a group cut short): a still copy fades where it was
    for (const [k, s] of was) {
      if (at.has(k) || s.el.isConnected) continue
      // a plain box with the row's look and insides: no list item, nothing to find it by
      const ghost = document.createElement('div')
      ghost.className = s.el.className
      ghost.append(...(s.el.cloneNode(true) as HTMLElement).childNodes)
      for (const n of ghost.querySelectorAll<HTMLElement>('*')) for (const a of ['id', 'name', 'role', 'aria-label', 'data-flip', 'data-kb']) n.removeAttribute(a)
      ghost.ariaHidden = 'true'
      ghost.inert = true
      Object.assign(ghost.style, { position: 'absolute', top: `${s.y + lift}px`, left: `${s.x}px`, width: `${s.w}px`, margin: '0', pointerEvents: 'none' })
      // under the rows, which glide over it
      box.prepend(ghost)
      ghosts.current.add(ghost)
      const done = () => {
        ghost.remove()
        ghosts.current.delete(ghost)
      }
      ghost.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.98)' }], { duration: 180, easing: 'ease-out', fill: 'forwards' }).finished.then(done, done)
    }
  })
}

/** Rows (marked data-arrive with their key) added at the end of a list rise into place, like a message just sent or
 *  just in. What shows as the list first fills, or after `reset` changes, or comes in above (older ones), just shows.
 *  Nothing is measured. */
export function useArrive(ref: RefObject<HTMLElement | null>, reset: unknown) {
  const last = useRef<{ reset: unknown; keys: Set<string> } | null>(null)
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const rows = [...box.querySelectorAll<HTMLElement>('[data-arrive]')]
    const keys = new Set(rows.map((el) => el.dataset.arrive!))
    const was = last.current && last.current.reset === reset && last.current.keys.size ? last.current.keys : null
    last.current = { reset, keys }
    if (!was || still()) return
    // only what comes after the last row there was
    for (let i = rows.length - 1; i >= 0 && !was.has(rows[i].dataset.arrive!); i--)
      rows[i].animate([{ opacity: 0, transform: 'translateY(10px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: SPRING })
  })
}

/* ---------- a tap from the phone ---------- */

/** a light tap from the phone: Android vibrates; iOS 18 and later tick when a switch flips, so one is flipped unseen.
 *  Only from a touch's own handler: a phone taps for the person touching it, not for the app. */
export function buzz() {
  if (navigator.vibrate) return void navigator.vibrate(8)
  const label = document.createElement('label')
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.setAttribute('switch', '')
  label.ariaHidden = 'true'
  label.style.display = 'none'
  label.append(box)
  document.body.append(label)
  label.click()
  label.remove()
}
