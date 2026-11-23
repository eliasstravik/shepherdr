// Slide to reply (SHEP-332): a finger that slides a message to the right and lets go past the mark replies to it; the
// same gesture, mark, tick and spring on a task's row (the Tasks panel, a task's line or card in the chat) replies to
// that task in the space's chat. A press held still can open a menu. Mouse pointers never slide: they have the menu.
import { useEffect, useRef, useState, type PointerEvent as RPE } from 'react'
import { getState, setUI } from '@client/kernel.ts'
import { attr } from '@client/attr.ts'
import { I } from '@client/ui.tsx'
import { placeOf } from '@shared/view.ts'
import type { Task } from '@shared/types.ts'
import { Finger, HOLD_MS, REPLY_AT } from './press.ts'

/** a light tick, where the device has one (Android; iPhones have no web haptics) */
export const tick = (ms = 8) => {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not allowed here */
  }
}

/** The click a finger's lift makes after a hold would land on the menu's backdrop the hold just opened, and close it:
 *  the next click (within a moment of the lift) is swallowed. */
export function swallowClick() {
  const eat = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
    off()
  }
  const lifted = () => setTimeout(off, 400)
  const off = () => {
    removeEventListener('click', eat, true)
    removeEventListener('pointerup', lifted, true)
  }
  addEventListener('click', eat, true)
  addEventListener('pointerup', lifted, true)
}

/** The slide on one thing: bind `on` to the element the finger presses, move `moving` by `style`, show <SlideHint>.
 *  `skip` is set when the click that follows was a hold or a slide, not a tap (the caller's onClick clears it).
 *  `hold`: what a press held still opens (the element it was on); `off`: no slide now (its words are being selected). */
export function useSlide(reply: () => void, opts: { hold?: (el: HTMLElement) => void; off?: boolean } = {}) {
  const finger = useRef<Finger | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const skip = useRef(false)
  const [slide, setSlide] = useState(0)
  const [armed, setArmed] = useState(false)
  const [settling, setSettling] = useState(false)
  useEffect(() => () => clearTimeout(timer.current), [])
  const letGo = (replying: boolean) => {
    skip.current = true
    setSettling(true)
    setSlide(0)
    setArmed(false)
    if (replying) reply()
  }
  const on = {
    onPointerDown: (e: RPE<HTMLElement>) => {
      if (e.button !== 0 || opts.off || e.pointerType === 'mouse') return
      const f = new Finger(e.clientX, e.clientY, performance.now())
      finger.current = f
      const el = e.currentTarget
      clearTimeout(timer.current)
      const hold = opts.hold
      if (!hold) return
      timer.current = setTimeout(() => {
        if (finger.current !== f || !f.hold(performance.now())) return
        tick(10)
        skip.current = true
        swallowClick()
        hold(el)
      }, HOLD_MS)
    },
    onPointerMove: (e: RPE<HTMLElement>) => {
      const f = finger.current
      if (!f || f.held) return
      const r = f.move(e.clientX, e.clientY)
      if (f.way === 'scroll') {
        finger.current = null
        clearTimeout(timer.current)
        return
      }
      if (f.way !== 'slide') return
      clearTimeout(timer.current)
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId)
      setSettling(false)
      setSlide(r.slide)
      setArmed(f.armed)
      if (r.crossed) tick()
    },
    onPointerUp: () => {
      const f = finger.current
      finger.current = null
      clearTimeout(timer.current)
      const o = f?.up()
      if (o === 'reply' || o === 'back') letGo(o === 'reply')
    },
    onPointerCancel: () => {
      const f = finger.current
      finger.current = null
      clearTimeout(timer.current)
      if (f?.way === 'slide') letGo(false)
    },
  }
  return {
    on,
    slide,
    armed,
    skip,
    /** a finger is on it now (a right click waits for it) */
    pressing: () => !!finger.current,
    /** for the thing that moves: its class (the spring back) and transform */
    moving: { className: settling ? 'settle' : '', style: slide ? { transform: `translateX(${slide}px)` } : undefined, onTransitionEnd: () => setSettling(false) },
  }
}

/** what shows behind a sliding thing: Reply, strong once a let-go replies */
export function SlideHint({ slide, armed }: { slide: number; armed: boolean }) {
  if (slide <= 0) return null
  return (
    <span className={armed ? 'rpl on' : 'rpl'} aria-hidden="true" style={{ width: Math.max(0, slide - 8), opacity: Math.min(1, slide / REPLY_AT) }}>
      <I n="reply" />
      <span>Reply</span>
    </span>
  )
}

/** The space chat the person is in: where a reply to a task goes (whatever space or machine the task is on). */
export function mainChat(): string | null {
  const { snap, ui } = getState()
  return (snap && placeOf(snap, ui.at)?.chat) || null
}

/** Reply to a task in the space's chat, as to a message: its title goes in the box's reply chip, the space's chat
 *  shows (a task open in the middle, or a phone's panel, steps aside) and its box takes the keyboard. What is sent then
 *  carries the task's tag line, so "status?" is about that task (service/actions.ts quoteOf). */
export function replyToTask(t: Pick<Task, 'id' | 'name'>) {
  const key = mainChat()
  if (!key) return
  const { ui } = getState()
  setUI((u) => ({
    reply: { ...u.reply, [key]: { id: `task:${t.id}`, task: t.id, text: t.name.slice(0, 200) } },
    ...(ui.wide ? { wide: false } : {}),
    ...(ui.phone && ui.pane ? { pane: null, task: null } : {}),
  }))
  // the box may only show once the chat is back in front
  const focus = () => globalThis.document?.querySelector?.<HTMLTextAreaElement>(`textarea[data-box="${attr(key)}"]`)?.focus?.()
  if (ui.wide || (ui.phone && ui.pane)) setTimeout(focus, 60)
  else focus()
}
