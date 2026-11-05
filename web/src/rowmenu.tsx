// A row's menu and the questions it asks, shared by the sidebar's rows: as the window's, the menu opens from a right
// click (at the pointer) or a finger held on the row, with no ⋯ on the row; what can't be undone asks first in a dialog.
// A row in the desktop's sidebar held by a finger (or opened from the keyboard's menu key) opens its menu beside it.
import clsx from 'clsx'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useUI } from './kernel.ts'
import { useMotion } from './motion.ts'
import { Ghost, ic, Menu, XIcon } from './ui.tsx'

/** how long a finger holds a row before its menu opens */
export const HOLD_MS = 450

export type RowMenuState = ReturnType<typeof useRowMenu>

/**
 * A row's menu: opened from a right click or a finger held on the row. Held open, the tap that ends the hold doesn't
 * open the row. Spread `press` on the row's <li>. `beside`: on a desktop a right click opens it at the pointer, as the
 * window's, and a held finger to the right of the row (a row in the left sidebar); elsewhere under it as any other.
 */
export function useRowMenu({ beside = false }: { beside?: boolean } = {}) {
  const desktop = useUI((u) => u.device === 'desktop')
  const [open, setOpen] = useState<null | 'down' | 'up'>(null)
  /** the row a menu beside it opened from */
  const [row, setRow] = useState<HTMLElement | null>(null)
  /** where the right click that opened it was */
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
  const close = useCallback(() => setOpen(null), [])
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  /** the hold opened the menu; once the finger lifts, the click it may end with is swallowed until then */
  const fired = useRef(false)
  const swallow = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  // near the bottom of the screen it opens upwards, so the list's scroll doesn't hide it
  const show = (el: HTMLElement | null, at?: { x: number; y: number }) => {
    const r = el?.getBoundingClientRect()
    const by = r && beside && desktop
    setRow(by ? el : null)
    setPoint(by && at ? at : null)
    setOpen((at && by ? at.y : r?.bottom ?? 0) > innerHeight * 0.6 ? 'up' : 'down')
  }
  const cancel = () => {
    clearTimeout(timer.current)
    start.current = null
    if (fired.current) swallow.current = Date.now() + 600
    fired.current = false
  }
  const hold = (el: HTMLElement) => {
    fired.current = true
    start.current = null
    navigator.vibrate?.(10)
    show(el)
  }
  return {
    open,
    row,
    point,
    show,
    close,
    /** a finger held the row long enough (for a row that times its own hold, as one that can be dragged): the menu opens */
    hold,
    /** the finger that held it lifted */
    release: cancel,
    /** the hold just opened the menu: the click its finger lifts with is swallowed (it would open the row, or close the menu) */
    held: () => fired.current || Date.now() < swallow.current,
    press: {
      onPointerDown: (e: ReactPointerEvent) => {
        fired.current = false
        if (e.pointerType === 'mouse' || (e.target as HTMLElement).closest('[role=menu]')) return
        start.current = { x: e.clientX, y: e.clientY }
        const el = e.currentTarget as HTMLElement
        timer.current = setTimeout(() => hold(el), HOLD_MS)
      },
      onPointerMove: (e: ReactPointerEvent) => {
        if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) cancel()
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onContextMenu: (e: ReactMouseEvent) => {
        if ((e.target as HTMLElement).closest('[role=menu]')) return
        e.preventDefault()
        // the keyboard's menu key has no pointer: beside the row
        if (!open) show(e.currentTarget as HTMLElement, e.button === 2 ? { x: e.clientX, y: e.clientY } : undefined)
      },
    },
  }
}

/** the open menu at the pointer, beside its row, or under (or over) it; a click outside closes it, as any menu */
export function RowMenu({ menu, label, className, children }: { menu: RowMenuState; label: string; className?: string; children: ReactNode }) {
  const { row, point, close } = menu
  // a long menu (a task's Start later) that would run past the screen's bottom or top moves up or down onto it
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    // the menu itself where it sits in its row (a box with no box of its own around it)
    const el = (box.current?.classList.contains('contents') ? box.current.firstElementChild : box.current) as HTMLElement | null
    if (!el) return
    el.style.translate = ''
    // its own height, not its box mid-way through springing out
    const r = el.getBoundingClientRect(), h = el.offsetHeight
    const top = menu.open === 'up' ? r.bottom - h : r.top
    // inside its row it is clipped by the list that scrolls around it, not only by the screen
    let clip = el.parentElement, lo = 8, hi = innerHeight - 8
    while (clip && clip !== document.body && getComputedStyle(clip).overflowY === 'visible') clip = clip.parentElement
    if (clip && clip !== document.body) { const c = clip.getBoundingClientRect(); lo = Math.max(lo, c.top + 4); hi = Math.min(hi, c.bottom - 4) }
    const dy = top + h > hi ? hi - (top + h) : top < lo ? lo - top : 0
    if (dy) el.style.translate = `0 ${Math.max(dy, lo - top)}px`
  })
  // beside its row it would stay put while the list under it scrolls: it goes
  useEffect(() => {
    if (!row) return
    const scrolled = (e: Event) => e.target instanceof Node && e.target.contains(row) && close()
    addEventListener('scroll', scrolled, { capture: true, passive: true })
    addEventListener('resize', close)
    return () => {
      removeEventListener('scroll', scrolled, { capture: true })
      removeEventListener('resize', close)
    }
  }, [row, close])
  if (row && point)
    return (
      // as the window's right-click menu: its corner at the pointer, kept on the screen
      <div ref={box} className="fixed z-21" style={{ left: Math.max(8, Math.min(point.x, innerWidth - 296)), ...(menu.open === 'up' ? { bottom: innerHeight - point.y } : { top: point.y }) }}>
        <Menu label={label} onClose={close} className={clsx(menu.open === 'up' ? 'origin-bottom-left' : 'origin-top-left', className)}>
          {children}
        </Menu>
      </div>
    )
  const at = row?.getBoundingClientRect()
  if (at)
    return (
      // its first row level with the row, just past the sidebar's edge; near the bottom its last row is
      <div ref={box} className="fixed z-21" style={{ left: at.right + 8, ...(menu.open === 'up' ? { bottom: innerHeight - at.bottom - 6 } : { top: at.top - 6 }) }}>
        <Menu label={label} onClose={close} className={clsx(menu.open === 'up' ? 'origin-bottom-left' : 'origin-top-left', className)}>
          {children}
        </Menu>
      </div>
    )
  return (
    // never wider than its row: a phone's drawer is narrower than a wide menu, which would run off the screen's left
    <div ref={box} className="contents">
      <Menu label={label} onClose={close} className={clsx('absolute right-1 z-21 max-w-[calc(100%-0.5rem)] origin-top-right', menu.open === 'up' ? 'bottom-full mb-1' : 'top-full mt-1', className)}>
        {children}
      </Menu>
    </div>
  )
}

/**
 * The shade and box every question sits in: it grows in like any dialog (slides up on a phone), and goes the same way.
 * Escape or a tap on the shade cancels; Tab stays inside it; the focus goes back to where it was once it closes.
 * safe: Cancel takes the focus, so Enter loses nothing.
 * The window's larger cards (the Accept card): sub, a muted line under the title; closer, the × at its top right that
 * closes it as Cancel does; foot, lines over the buttons that stay put while the body scrolls; wide, 640 across.
 */
export function Dialog({ title, sub, closer, foot, wide, children, buttons, safe, cancel = 'Cancel', onCancel }: { title: string; sub?: ReactNode; closer?: boolean; foot?: ReactNode; wide?: boolean; children: ReactNode; buttons: ReactNode; safe?: boolean; cancel?: string; onCancel: () => void }) {
  const phone = useUI((u) => u.device === 'phone')
  const shade = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useMotion(shade, phone ? 'sheet' : 'dialog')
  // read while it renders, before a button in it takes the focus: the row, or wherever it was
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  const cancelling = useRef(onCancel)
  cancelling.current = onCancel
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        cancelling.current()
      } else if (e.key === 'Tab' && box.current) {
        const bs = [...box.current.querySelectorAll<HTMLElement>('button:not(:disabled)')]
        const at = bs.indexOf(document.activeElement as HTMLElement)
        e.preventDefault()
        bs[(at + (e.shiftKey ? bs.length - 1 : 1)) % bs.length]?.focus()
      }
    }
    addEventListener('keydown', on, true)
    return () => {
      removeEventListener('keydown', on, true)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [opener])
  return (
    <div ref={shade} className="absolute inset-0 z-30 flex items-start justify-center bg-black/35 px-6 py-12 phone:items-end phone:p-3 phone:pb-[max(env(safe-area-inset-bottom),--spacing(3))]" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={box} data-panel role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-desc" className={clsx('w-full rounded-box bg-bg p-5 shadow-dialog phone:max-w-none', wide ? 'max-w-[640px]' : 'max-w-[400px]')}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="font-semibold">
              {title}
            </h2>
            {sub ? <p className="mt-0.5 truncate text-fg3">{sub}</p> : null}
          </div>
          {closer ? (
            <button type="button" aria-label="Close" onClick={onCancel} className="-mt-1 -mr-1.5 grid size-7 shrink-0 place-items-center rounded-full text-fg3 hover:bg-hover hover:text-fg phone:size-9">
              <XIcon className={ic} />
            </button>
          ) : null}
        </div>
        <div id="confirm-desc" className="mt-1.5 text-pretty text-fg2">
          {children}
        </div>
        {foot ? <div className="mt-4 flex flex-col gap-2.5">{foot}</div> : null}
        <div className="mt-5 flex justify-end gap-2 phone:flex-col-reverse phone:*:w-full phone:*:justify-center">
          <Ghost autoFocus={safe} className="h-[34px] text-sm! phone:h-11 phone:text-base!" onClick={onCancel}>
            {cancel}
          </Ghost>
          {buttons}
        </div>
      </div>
    </div>
  )
}

/** "a, b and c" */
export const and = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)
