// A row's menu and the questions it asks, shared by the task rows and the project rows in the sidebar: the menu opens
// from the row's ⋯ (a mouse finds it on hover; a task row's always shows to a finger), a right click, or a finger held on the row; what can't be undone asks
// first in a dialog. A row in the desktop's sidebar opens its menu beside it, so it covers none of the rows under it.
import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useUI } from './kernel.ts'
import { useMotion } from './motion.ts'
import { Ghost, ic, Menu, MoreIcon } from './ui.tsx'

/** how long a finger holds a row before its menu opens */
export const HOLD_MS = 450

export type RowMenuState = ReturnType<typeof useRowMenu>

/**
 * A row's menu: opened from its ⋯, a right click, or a finger held on the row. Held
 * open, the tap that ends the hold doesn't open the row. Spread `press` on the row's <li>. `beside`: on a desktop it
 * opens to the right of the row (a row in the left sidebar), elsewhere under it as any other.
 */
export function useRowMenu({ beside = false }: { beside?: boolean } = {}) {
  const desktop = useUI((u) => u.device === 'desktop')
  const [open, setOpen] = useState<null | 'down' | 'up'>(null)
  /** the row a menu beside it opened from */
  const [row, setRow] = useState<HTMLElement | null>(null)
  const close = useCallback(() => setOpen(null), [])
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  /** the hold opened the menu; once the finger lifts, the click it may end with is swallowed until then */
  const fired = useRef(false)
  const swallow = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  // near the bottom of the screen it opens upwards, so the list's scroll doesn't hide it
  const show = (el: HTMLElement | null) => {
    const r = el?.getBoundingClientRect()
    setRow(r && beside && desktop ? el : null)
    setOpen(r && r.bottom > innerHeight * 0.6 ? 'up' : 'down')
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
        if (!open) show(e.currentTarget as HTMLElement)
      },
    },
  }
}

/** the ⋯ at a row's end: tucked away until the pointer is on the row; none where nothing hovers (a finger holds the row),
 *  and never seen through what sits under it on a screen that reports neither hover nor a finger.
 *  always: it shows to a finger too, its row making room for it.
 *  Its name doesn't repeat the row's: the row's own button is the one named by it */
export function RowMenuButton({ menu, label, always, className }: { menu: RowMenuState; label: string; always?: boolean; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={!!menu.open}
      onClick={(e) => (menu.open ? menu.close() : menu.show(e.currentTarget.closest('li')))}
      className={clsx(
        // its ring only for the keyboard: a browser that gives the focus back to it as a question closes shows none
        'hit grid size-6 place-items-center rounded-full text-fg3 outline-none! keys:focus-visible:shadow-[0_0_0_1.5px_var(--focus)] hover:bg-sel hover:text-fg aria-expanded:bg-sel aria-expanded:text-fg tucked:not-aria-expanded:pointer-events-none tucked:not-aria-expanded:absolute tucked:not-aria-expanded:opacity-0',
        !always && 'pointer-coarse:hidden [@media(hover:none)]:not-aria-expanded:not-focus-visible:opacity-0',
        className,
      )}
    >
      <MoreIcon className={ic} />
    </button>
  )
}

/** the open menu under (or over) its row, or beside it; a click outside closes it, as any menu */
export function RowMenu({ menu, label, className, children }: { menu: RowMenuState; label: string; className?: string; children: ReactNode }) {
  const { row, close } = menu
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
  const at = row?.getBoundingClientRect()
  if (at)
    return (
      // its first row level with the row, just past the sidebar's edge; near the bottom its last row is
      <div className="fixed z-21" style={{ left: at.right + 8, ...(menu.open === 'up' ? { bottom: innerHeight - at.bottom - 6 } : { top: at.top - 6 }) }}>
        <Menu label={label} onClose={close} className={clsx(menu.open === 'up' ? 'origin-bottom-left' : 'origin-top-left', className)}>
          {children}
        </Menu>
      </div>
    )
  return (
    // never wider than its row: a phone's drawer is narrower than a wide menu, which would run off the screen's left
    <Menu label={label} onClose={close} className={clsx('absolute right-1 z-21 max-w-[calc(100%-0.5rem)] origin-top-right', menu.open === 'up' ? 'bottom-full mb-1' : 'top-full mt-1', className)}>
      {children}
    </Menu>
  )
}

/**
 * The shade and box every question sits in: it grows in like any dialog (slides up on a phone), and goes the same way.
 * Escape or a tap on the shade cancels; Tab stays inside it; the focus goes back to where it was once it closes.
 * safe: Cancel takes the focus, so Enter loses nothing.
 */
export function Dialog({ title, children, buttons, safe, cancel = 'Cancel', onCancel }: { title: string; children: ReactNode; buttons: ReactNode; safe?: boolean; cancel?: string; onCancel: () => void }) {
  const phone = useUI((u) => u.device === 'phone')
  const shade = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useMotion(shade, phone ? 'sheet' : 'dialog')
  // read while it renders, before a button in it takes the focus: the row's ⋯, or wherever it was
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
      <div ref={box} data-panel role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-desc" className="w-full max-w-[400px] rounded-box bg-bg p-5 shadow-dialog phone:max-w-none">
        <h2 id="confirm-title" className="font-semibold">
          {title}
        </h2>
        <div id="confirm-desc" className="mt-1.5 text-pretty text-fg2">
          {children}
        </div>
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
