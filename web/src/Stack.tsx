// The moving frames of a phone or tablet screen, the way iOS has them: screens pushed on one another (a task's chat
// over its place, settings over everything), the places drawer from the left, and sheets from the bottom. Each comes
// in and goes out with its motion (motion.ts) and follows a finger (gestures.ts): a swipe right goes back, a swipe from
// the left opens the drawer and one to the left shuts it, a sheet drags down to close.
import clsx from 'clsx'
import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { useUI } from './kernel.ts'
import { EDGE, follow, mayPanDown, mayPanX } from './gestures.ts'
import { buzz, hush, hushedNow, lands, moveTo, project, PUSH_MS, settleMs, still, useMotion } from './motion.ts'
import { useDialogFocus } from './focus.ts'
import { ic, IconButton, RoundButton, XIcon } from './ui.tsx'

/** how far the screen under a pushed one sits to the left, as iOS has it */
const UNDER = 0.3
/** from the very edge a swipe in may lean up or down this much (along at least 0.7 times as far as across): a thumb
 *  sweeps an arc, and nothing there scrolls sideways */
const EDGE_LEAN = 0.7

/** the screen under a pushed one: hidden while covered (nothing to draw), shown while the top one moves */
function cover(el: HTMLElement, covered: boolean) {
  for (const a of el.getAnimations()) a.cancel()
  el.style.visibility = covered ? 'hidden' : ''
  el.style.transform = covered ? `translateX(${-UNDER * 100}%)` : ''
}

/** a press a pushed screen already follows: the one it sits on (settings' list, under one of its sections) leaves it */
const taken = new WeakSet<Event>()

/**
 * Screens pushed on one another, like iOS's navigation: the top one slides in from the right over the base, which
 * slides a little left, and goes back out with Back or a swipe right, the base following the finger back in. What
 * shows when the app opens shows at once.
 */
export function Stack({ base, top, topKey, onBack, className }: { base: ReactNode; top: ReactNode | null; topKey: string | null; onBack: () => void; className?: string }) {
  const under = useRef<HTMLDivElement>(null)
  const drawn = useRef(false)
  const had = useRef(!!top)
  const shown = !!top
  useLayoutEffect(() => {
    const b = under.current!
    const was = had.current
    had.current = shown
    if (!drawn.current || shown === was || hushedNow() || still()) {
      drawn.current = true
      return cover(b, shown)
    }
    b.style.visibility = ''
    if (shown) void moveTo(b, { transform: `translateX(${-UNDER * 100}%)` }, PUSH_MS).then(() => had.current && cover(b, true))
    else {
      b.style.transform = `translateX(${-UNDER * 100}%)`
      void moveTo(b, { transform: 'translateX(0%)' }, 380).then(() => !had.current && cover(b, false))
    }
  }, [shown])
  return (
    // the top screen comes first, as it is read first; the base under it waits, out of reach
    <div className={clsx('relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', className)}>
      {top ? (
        <Pushed key={topKey} under={under} onBack={onBack} enter={drawn.current} className="z-1">
          {top}
        </Pushed>
      ) : null}
      <div ref={under} inert={shown} className="flex min-h-0 flex-1 flex-col will-change-transform">
        {base}
      </div>
    </div>
  )
}

/**
 * A screen pushed over another: it slides in from the right and out again, and a swipe right takes it back, following
 * the finger (from anywhere free of a message or a box, or from the very edge), the screen under it (`under`, when
 * the stack has one) coming back in from the left.
 */
export function Pushed({
  children,
  onBack,
  under,
  enter = true,
  className,
  label,
  role,
}: {
  children: ReactNode
  onBack: () => void
  under?: RefObject<HTMLDivElement | null>
  enter?: boolean
  className?: string
  label?: string
  role?: string
}) {
  const ref = useRef<HTMLElement>(null)
  // what shows when the app opens doesn't slide in
  useMotion(ref, 'page', enter)
  const down = (e: ReactPointerEvent) => {
    const el = ref.current!
    const b = under?.current ?? null
    const x = e.clientX - el.getBoundingClientRect().left
    if (e.defaultPrevented || taken.has(e.nativeEvent) || !mayPanX(e.target, x)) return
    taken.add(e.nativeEvent)
    const w = el.offsetWidth
    const place = (x: number) => {
      el.style.transform = `translateX(${x}px)`
      if (b) b.style.transform = `translateX(${-UNDER * (w - x)}px)`
    }
    const settle = (back: boolean, v: number, d: number) => {
      const ms = back ? settleMs(w - d, v) : settleMs(d, v, 320)
      const done = Promise.all([moveTo(el, { transform: `translateX(${back ? w : 0}px)` }, ms), b && moveTo(b, { transform: `translateX(${back ? 0 : -UNDER * w}px)` }, ms)])
      void done.then(() => {
        if (!back) {
          el.style.transform = ''
          return b && cover(b, true)
        }
        // it is already out: it leaves no ghost, and the screen under it doesn't slide in again
        el.dataset.gone = ''
        hush()
        onBack()
      })
    }
    follow(e.nativeEvent, {
      axis: 'x',
      sign: 1,
      lean: x < EDGE ? EDGE_LEAN : undefined,
      start: () => {
        for (const a of el.getAnimations()) a.cancel()
        if (b) {
          for (const a of b.getAnimations()) a.cancel()
          b.style.visibility = ''
        }
      },
      move: (d) => place(Math.max(0, d)),
      end: ({ d, v }) => settle(lands(d, v, w / 2), v, Math.max(0, d)),
      cancel: () => settle(false, 0, 0),
    })
  }
  return (
    <section ref={ref} role={role} aria-label={label} data-pushed="" onPointerDown={down} className={clsx('absolute inset-0 flex flex-col bg-bg shadow-push', className)}>
      {children}
      {/* the very edge always takes a swipe back, even over something that scrolls sideways (a diff, a terminal); with
          a screen pushed inside this one (a settings section over their list), that one's edge takes it */}
      <div aria-hidden="true" className="absolute inset-y-0 left-0 z-30 w-3.5 touch-pan-y [[data-pushed]:has([data-pushed])>&]:hidden" />
    </section>
  )
}

/**
 * The places drawer of a phone or tablet. It follows a finger out from the left edge, or across any free part of what
 * `data-drawer-from` marks while `can` holds, and back with a swipe left or a tap beside it; the button and Back open
 * and shut it with the same slide.
 */
export function Drawer({ open, onOpen, can, panel, label, children }: { open: boolean; onOpen: (open: boolean) => void; can: boolean; panel: string; label: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const side = useRef<HTMLElement>(null)
  const shade = useRef<HTMLButtonElement>(null)
  /** how far out it is: 0 shut, 1 open */
  const at = useRef(open ? 1 : 0)
  const width = () => side.current!.offsetWidth
  const draw = (p: number) => {
    at.current = p
    side.current!.style.transform = `translateX(${(p - 1) * 100}%)`
    shade.current!.style.opacity = String(p)
    root.current!.style.visibility = p > 0 ? '' : 'hidden'
  }
  const stop = () => [side.current!, shade.current!].forEach((el) => el.getAnimations().forEach((a) => a.cancel()))
  /** where it is now, mid-slide too */
  const now = () => {
    const r = side.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (r.right - root.current!.getBoundingClientRect().left) / r.width))
  }
  const slide = (to: 0 | 1, v = 0) => {
    const from = now()
    stop()
    if (still()) {
      draw(to)
      return Promise.resolve()
    }
    root.current!.style.visibility = ''
    const ms = settleMs(Math.abs(to - from) * width(), v, 420)
    at.current = to
    return Promise.all([moveTo(side.current!, { transform: `translateX(${(to - 1) * 100}%)` }, ms), moveTo(shade.current!, { opacity: String(to) }, ms)]).then(() => {
      if (at.current !== to) return
      draw(to)
    })
  }
  /** a finger let go: open or shut, where its fling lands */
  const land = (d: number, v: number, from: number) => {
    const w = width()
    const to = lands(from * w + d, v, w / 2) ? 1 : 0
    // a light tap from the phone as it snaps open under the finger (still in the touch, as phones require)
    if (to && !open) buzz()
    void slide(to, v).then(() => {
      if (!!to === open) return
      hush()
      onOpen(!!to)
    })
  }
  // the button, Back or a step in the history: the same slide
  useLayoutEffect(() => {
    if (at.current === (open ? 1 : 0)) return
    if (!hushedNow()) return void slide(open ? 1 : 0)
    draw(open ? 1 : 0)
  }, [open])
  useLayoutEffect(() => draw(at.current), [])
  // out from the edge, or across the screen's free parts
  useEffect(() => {
    if (!can || open) return
    const on = (e: PointerEvent) => {
      const from = (e.target as Element | null)?.closest?.('[data-drawer-from]')
      const x = from ? e.clientX - from.getBoundingClientRect().left : 0
      if (!from || e.defaultPrevented || !mayPanX(e.target, x)) return
      let base = 0
      follow(e, {
        axis: 'x',
        sign: 1,
        lean: x < EDGE ? EDGE_LEAN : undefined,
        start: () => {
          stop()
          base = now()
        },
        move: (d) => draw(Math.min(1, Math.max(0, base + d / width()))),
        end: ({ d, v }) => land(d, v, base),
        cancel: () => void slide(0),
      })
    }
    addEventListener('pointerdown', on)
    return () => removeEventListener('pointerdown', on)
  }, [can, open])
  // back in with a swipe left, on it or beside it
  const shut = (e: ReactPointerEvent) => {
    if (!open || e.defaultPrevented) return
    let base = 1
    follow(e.nativeEvent, {
      axis: 'x',
      sign: -1,
      start: () => {
        stop()
        base = now()
      },
      move: (d) => draw(Math.min(1, Math.max(0, base + d / width()))),
      end: ({ d, v }) => land(d, v, base),
      cancel: () => void slide(1),
    })
  }
  return (
    <div ref={root} inert={!open} onPointerDown={shut} className="absolute inset-0 z-5 touch-pan-y overflow-hidden">
      <button ref={shade} type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/30" onClick={() => onOpen(false)} />
      <nav ref={side} aria-label={label} className={clsx('absolute inset-y-0 left-0 flex min-h-0 touch-pan-y flex-col overflow-y-auto overscroll-contain bg-well shadow-drawer will-change-transform', panel)}>
        {/* drawn all along, hidden while shut: a swipe doesn't wait for the list to be drawn under the finger */}
        {children}
      </nav>
    </div>
  )
}

/** a sheet's close: a grey circle on a phone, like every phone header button */
export function SheetClose({ onClose }: { onClose: () => void }) {
  const phone = useUI((u) => u.device === 'phone')
  const B = phone ? RoundButton : IconButton
  return (
    <B label="Close" onClick={onClose}>
      <XIcon className={ic} />
    </B>
  )
}

/**
 * A dialog over the app. On a phone a sheet: it slides up from the bottom, leaving the top of the app dimmed behind
 * it (`full`: over all of it), and drags down to close. Wider, a card in the middle that grows in (a finger drags it down too). Tapping beside
 * it, its close button or Esc close it; it slides away however it closes.
 */
export function Sheet({ label, onClose, children, panel, z = 'z-8', full }: { label: string; onClose: () => void; children: ReactNode; panel?: string; z?: string; full?: boolean }) {
  const phone = useUI((u) => u.device === 'phone')
  const ref = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useMotion(ref, phone ? 'sheet' : 'dialog')
  // the keyboard stays in it: the focus moves in, Tab goes round inside, and it goes back once it closes
  useDialogFocus(panelRef)
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = e.currentTarget
    const shade = ref.current!
    if (e.defaultPrevented || !mayPanDown(e.target, p)) return
    const h = p.offsetHeight
    const dim = (y: number) => `rgb(0 0 0 / ${0.35 * (1 - Math.min(1, Math.max(0, y) / h))})`
    follow(e.nativeEvent, {
      axis: 'y',
      sign: 1,
      start: () => [p, shade].forEach((el) => el.getAnimations().forEach((a) => a.cancel())),
      move: (d) => {
        // up past where it sits, it barely gives
        const y = d > 0 ? d : d * 0.2
        p.style.transform = `translateY(${y}px)`
        shade.style.backgroundColor = dim(y)
      },
      end: ({ d, v }) => {
        const close = project(d, v) > h * 0.35 && v > -0.1
        const ms = close ? settleMs(h - d, v, 340) : settleMs(d, v, 300)
        void Promise.all([moveTo(p, { transform: `translateY(${close ? h : 0}px)` }, ms), moveTo(shade, { backgroundColor: dim(close ? h : 0) }, ms)]).then(() => {
          if (!close) {
            p.style.transform = ''
            shade.style.backgroundColor = ''
            return
          }
          shade.dataset.gone = ''
          onClose()
        })
      },
      cancel: () => {
        p.style.transform = ''
        shade.style.backgroundColor = ''
      },
    })
  }
  return (
    <div
      ref={ref}
      className={clsx('absolute inset-0 flex bg-black/35', z, phone ? clsx('flex-col', !full && 'pt-[calc(env(safe-area-inset-top)+10px)]') : clsx('justify-center', full ? 'items-stretch tablet:p-4 desktop:p-6' : 'items-start px-6 py-12'))}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        data-panel
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onPointerDown={down}
        className={clsx('flex min-h-0 min-w-0 touch-pinch-zoom flex-col overflow-hidden bg-bg shadow-dialog outline-none', phone ? clsx('flex-1', !full && 'rounded-t-box') : 'max-h-full w-full rounded-box', panel)}
      >
        {/* iOS's grabber: a sheet can be dragged down */}
        {phone && !full ? (
          <div aria-hidden="true" className="flex h-5 shrink-0 justify-center pt-1.5">
            <div className="h-1 w-9 rounded-full bg-line2" />
          </div>
        ) : null}
        {children}
      </div>
    </div>
  )
}
