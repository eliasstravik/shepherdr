// The wide screen's columns: places | chat | tasks, and with a task open on a desktop its side panel after them. The
// sidebars resize by dragging their inner edge; places hides with its toggle or ⌘B, the panel with its toggle in the
// task's header. Focus on an open task shuts places and the chat, the task's chat taking their room. The sums live in
// sidebars.ts.
import clsx from 'clsx'
import { useRef, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { focusHere, getState, placesDocked, placesDrawn, setUI, togglePlaces, useStore, useUI } from './kernel.ts'
import { BASE, dragLeft, dragPanel, dragRight, fit, LEFT, PANEL, RIGHT, type Sidebars } from './sidebars.ts'
import { ic, IconButton, SidebarIcon } from './ui.tsx'

const onResize = (l: () => void) => {
  addEventListener('resize', l)
  return () => removeEventListener('resize', l)
}
const useWindowWidth = () => useSyncExternalStore(onResize, () => innerWidth)

/** The frame's widths as CSS variables, for its sidebars as stored and as drawn (`sb`, places shut when not drawn) */
function widths(sidebars: Sidebars, sb: Sidebars, width: number, places: boolean, panel: boolean, focus: boolean) {
  const w = fit(sb, width, places, panel, focus)
  // the widths they open again at
  const leftOpen = w.left || fit({ ...sidebars, open: true, panelOpen: false }, width, places, panel).left
  const panelOpen = w.panel || fit({ ...sb, panelOpen: true }, width, places, panel, focus).panel
  // the chat's, out of focus
  const out = fit({ ...sb, focus: false, wide: false }, width, places, panel)
  return {
    '--left': `${w.left}px`,
    // places and the panel keep their width while they slide shut, so nothing in them rewraps
    '--left-open': `${leftOpen}px`,
    '--right': `${w.right}px`,
    '--panel': `${w.panel}px`,
    '--panel-open': `${panelOpen}px`,
    '--chat-open': `${width - out.left - out.right - out.panel}px`,
  }
}

/** The columns of a wide screen: places (desktop), the middle, tasks, an open task's side panel (desktop). Places and
 *  the panel slide shut and open again. */
export function Frame({ places, tasks, panel, children }: { places?: boolean; tasks?: boolean; panel?: boolean; children: ReactNode }) {
  const sidebars = useUI((u) => u.sidebars)
  const width = useWindowWidth()
  const drawn = useStore((s) => placesDrawn(s.ui, s.snap, width))
  const focus = useStore((s) => focusHere(s.ui, s.snap))
  const ref = useRef<HTMLDivElement>(null)
  // a window too narrow for all four draws places shut while the panel shows (placesDrawn)
  const sb = { ...sidebars, open: !!places && drawn }
  const w = fit(sb, width, !!places, !!panel, focus)
  const vars = widths(sidebars, sb, width, !!places, !!panel, focus) as CSSProperties
  // one row as tall as the frame: a row sized to its content would measure every column again (a long chat and all)
  // each time the message box changes height, as it does on every letter typed
  return (
    <div
      ref={ref}
      style={vars}
      className={clsx(
        'relative grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none data-resizing:transition-none data-resizing:select-none',
        places && tasks && panel
          ? 'grid-cols-[var(--left)_minmax(0,1fr)_var(--right)_var(--panel)]'
          : places && tasks
            ? 'grid-cols-[var(--left)_minmax(0,1fr)_var(--right)]'
            : places
              ? 'grid-cols-[var(--left)_minmax(0,1fr)]'
              : 'grid-cols-[minmax(0,1fr)_var(--right)]',
      )}
    >
      {children}
      {places && sb.open ? <Resizer side="left" places panel={!!panel} frame={ref} now={w.left} /> : null}
      {/* in focus the task's chat takes the room the panel leaves */}
      {tasks && !focus ? <Resizer side="right" places={!!places} panel={!!panel} frame={ref} now={w.right} /> : null}
      {panel && sidebars.panelOpen ? <Resizer side="panel" places={!!places} panel frame={ref} now={w.panel} /> : null}
    </div>
  )
}

/** Places beside the chat; hidden, it is out of reach of Tab and screen readers too */
export function PlacesColumn({ children }: { children: ReactNode }) {
  const drawn = useStore((s) => placesDrawn(s.ui, s.snap))
  return (
    <div className="min-w-0 overflow-hidden" inert={!drawn}>
      <nav id="places" aria-label="Spaces" className="flex h-full w-(--left-open) flex-col overflow-y-auto border-r border-line bg-well">
        {children}
      </nav>
    </div>
  )
}

/** The coordinator chat beside the tasks; in focus it slides shut, keeping its width so nothing in it rewraps, and is
 *  out of reach of Tab and screen readers too */
export function ChatColumn({ children }: { children: ReactNode }) {
  const focus = useStore((s) => focusHere(s.ui, s.snap))
  return (
    <div className="flex min-w-0 overflow-hidden *:min-w-(--chat-open)" inert={focus}>
      {children}
    </div>
  )
}

/** An open task's side panel, right of its chat; hidden, it is out of reach of Tab and screen readers too */
export function PanelColumn({ children }: { children: ReactNode }) {
  const open = useUI((u) => u.sidebars.panelOpen)
  return (
    <div className="min-w-0 overflow-hidden" inert={!open}>
      <aside id="task-panel" aria-label="Task panel" className="flex h-full w-(--panel-open) flex-col border-l border-line bg-bg">
        {children}
      </aside>
    </div>
  )
}

/**
 * A sidebar's inner edge: invisible until the pointer finds it, then a thin line. Drag it to resize (places snaps shut
 * when dragged narrow enough), double-click to reset, or focus it and use the arrow keys. While dragging, the widths
 * go straight onto the frame and reach the store once, on letting go: the chats don't redraw on every move.
 */
function Resizer({ side, places, panel, frame, now }: { side: 'left' | 'right' | 'panel'; places: boolean; panel: boolean; frame: RefObject<HTMLDivElement | null>; now: number }) {
  const drag = useRef<{ x: number; from: number; next: Sidebars; raf: number } | null>(null)
  const sep = useRef<HTMLDivElement>(null)
  const span = side === 'left' ? LEFT : side === 'right' ? RIGHT : PANEL
  const to = (px: number) => {
    const sb = getState().ui.sidebars
    return side === 'left'
      ? dragLeft(sb, px, innerWidth, panel)
      : side === 'right'
        ? dragRight(sb, px, innerWidth, places, panel)
        : dragPanel(sb, px, innerWidth, places, focusHere({ ...getState().ui, sidebars: { ...sb, focus: true } }, getState().snap))
  }
  const of = (sb: Sidebars) => (side === 'left' ? sb.left : side === 'right' ? sb.right : sb.panel)
  // the widest this window lets it go, the chat keeping its room
  const max = of(to(Infinity))
  const commit = (sb: Sidebars) => setUI({ sidebars: sb })
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, from: now, next: getState().ui.sidebars, raf: 0 }
    frame.current!.dataset.resizing = ''
    e.currentTarget.dataset.dragging = ''
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const el = frame.current
    if (!d || !el) return
    const dx = e.clientX - d.x
    d.next = to(side === 'left' ? d.from + dx : d.from - dx)
    // the next frame draws the latest width: one layout a frame, however fast the pointer
    if (!d.raf) d.raf = requestAnimationFrame(() => draw(d, el))
    // snapping shut slides like the toggle does; following the pointer doesn't
    if (side === 'left' ? d.next.open : side === 'panel' ? d.next.panelOpen : true) el.dataset.resizing = ''
    else delete el.dataset.resizing
  }
  /** every column at the dragged width, the chat beside them too, straight onto the frame's variables */
  const draw = (d: { next: Sidebars; raf: number }, el: HTMLElement) => {
    d.raf = 0
    const ui = { ...getState().ui, sidebars: d.next }
    const snap = getState().snap
    const drawn = { ...d.next, open: places && placesDrawn(ui, snap) }
    const vars = widths(d.next, drawn, innerWidth, places, panel, focusHere(ui, snap))
    // closing, places and the panel keep the width they slide shut at
    if (side === 'left' && !d.next.open) delete (vars as Partial<typeof vars>)['--left-open']
    if (side === 'panel' && !d.next.panelOpen) delete (vars as Partial<typeof vars>)['--panel-open']
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v)
    sep.current!.ariaValueNow = String(parseInt(vars[side === 'left' ? '--left' : side === 'right' ? '--right' : '--panel']))
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    // the last move's width, drawn now: the store may already hold it, and then React writes nothing
    if (d.raf && frame.current) {
      cancelAnimationFrame(d.raf)
      draw(d, frame.current)
    }
    if (frame.current) delete frame.current.dataset.resizing
    delete e.currentTarget.dataset.dragging
    commit(d.next)
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16
    const grow = side === 'left' ? 1 : -1
    const px =
      e.key === 'ArrowRight' ? now + step * grow : e.key === 'ArrowLeft' ? now - step * grow : e.key === 'Home' ? span.min : e.key === 'End' ? max : null
    if (px === null) return
    e.preventDefault()
    e.stopPropagation()
    // the keys resize; they don't hide places (⌘B does) or the panel (its toggle does)
    commit(to(Math.max(span.min, px)))
  }
  const sb = () => getState().ui.sidebars
  const reset = () =>
    commit(side === 'left' ? { ...sb(), left: BASE.left, open: true } : side === 'right' ? { ...sb(), right: BASE.right } : { ...sb(), panel: BASE.panel, panelOpen: true, wide: false })
  return (
    <div
      ref={sep}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize spaces' : side === 'right' ? 'Resize tasks' : 'Resize the task panel'}
      aria-controls={side === 'left' ? 'places' : side === 'panel' ? 'task-panel' : undefined}
      aria-valuemin={span.min}
      aria-valuemax={max}
      aria-valuenow={now}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={reset}
      onKeyDown={key}
      className={clsx(
        'group absolute inset-y-0 z-4 flex w-2 cursor-col-resize touch-none justify-center focus-visible:outline-none',
        side === 'left' ? 'left-(--left) -translate-x-1/2' : side === 'right' ? 'right-[calc(var(--right)+var(--panel))] translate-x-1/2' : 'right-(--panel) translate-x-1/2',
      )}
    >
      <span className="w-0.5 bg-fg3 not-group-hover:not-group-focus-visible:not-group-data-dragging:opacity-0" />
    </div>
  )
}

/**
 * Shows or hides places (desktop). It sits at the top of places while they show, and at the start of the header
 * beside them while they're hidden; focus follows it from one spot to the other.
 */
export function PlacesToggle({ when, drawer = false }: { when: 'open' | 'closed'; drawer?: boolean }) {
  const width = useWindowWidth()
  const open = useStore((s) => placesDrawn(s.ui, s.snap, width))
  const docked = useStore((s) => placesDocked(s.ui, s.snap, width))
  const desktop = useUI((u) => u.device === 'desktop')
  const drawerOpen = useUI((u) => u.drawer)
  if ((!docked && (!drawer || !desktop || when === 'open')) || (docked && open !== (when === 'open'))) return null
  const label = !docked ? 'Spaces' : open ? 'Hide Spaces' : 'Show Spaces'
  return (
    <IconButton
      label={label}
      aria-expanded={docked ? open : drawerOpen}
      aria-controls={docked ? "places" : undefined}
      data-places-toggle
      onClick={(e) => {
        const focused = document.activeElement === e.currentTarget
        togglePlaces()
        if (focused) requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-places-toggle]')?.focus())
      }}
    >
      <SidebarIcon className={ic} />
    </IconButton>
  )
}
