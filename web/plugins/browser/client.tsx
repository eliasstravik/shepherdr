// Browser: a task view's tab, as the window's (mods/task-browser and the viewer it runs, bin/herdr-browser-view): the
// task's own agent-browser session, live. Your first click, scroll, touch or key takes it over ("You're driving": the
// agent is told to hold off); Hand back, or a minute without input, gives it back. Its bar says who drives and where it
// is, with Back and Reload. Only while the task has a live agent: it never starts a fresh browser for a finished task.
// The view comes back by itself when it stops (at most every 10 s).
import clsx from 'clsx'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { definePlugin, useUI } from '@client/kernel.ts'
import { Ghost, GlobeIcon, ic, PageBackIcon, ReloadIcon, Small } from '@client/ui.tsx'
import type { BrowserDown, BrowserUp, FrameMeta } from '@shared/browser.ts'
import type { Task } from '@shared/types.ts'
import { fit, keyEvent, modifiers, toPage, type Size } from './input.ts'

type State = Extract<BrowserDown, { type: 'state' }>

/** agent-browser's own page size, until a frame says otherwise */
const DESKTOP = { w: 1280, h: 720 }
/** the view stopped: started again, not more than every 10 s (the window's) */
const RETRY_MS = 10_000
/** quiet this long while you drive: handed back (the window's IDLE_DRIVE_MS) */
const IDLE_DRIVE_MS = 60_000

/** what the key box holds, so a phone's Backspace has something to take */
const HELD = ' '

/** the window's words (mods/task-browser, bin/herdr-browser-view) */
const WORDS = {
  pick: 'Pick a task to see its browser.',
  starting: 'Starting the live view…',
  stopped: 'The live view stopped. Starting it again…',
  looking: "Looking for this task's browser…",
  opening: 'Opening the browser…',
  closed: "This task's browser isn't open.",
  closedMore: 'Its agent opens it when it checks a page; it closes after a while unused.',
  open: 'Open browser',
  driving: "You're driving",
  live: 'Live',
  off: 'Off',
  handBack: 'Hand back',
  back: 'Back',
  reload: 'Reload',
  keys: 'Alt+← back · Ctrl+R reload',
}

/** Frames and controls use Shepherdr's WebSocket; when it stops, it comes back by itself (at most every 10 s) */
function useLink(task: string, onFrame: (data: string, meta: FrameMeta) => void) {
  const [state, setState] = useState<State | null>(null)
  const [stopped, setStopped] = useState(false)
  const ws = useRef<WebSocket | null>(null)
  const frame = useRef(onFrame)
  frame.current = onFrame
  useEffect(() => {
    let gone = false
    let timer: ReturnType<typeof setTimeout>
    let at = 0
    const again = () => {
      if (gone) return
      setStopped(true)
      timer = setTimeout(open, Math.max(500, RETRY_MS - (Date.now() - at)))
    }
    const open = () => {
      at = Date.now()
      const url = new URL(`api/browser?task=${encodeURIComponent(task)}`, location.href)
      url.protocol = url.protocol.replace('http', 'ws')
      const s = new WebSocket(url)
      ws.current = s
      s.onopen = () => setStopped(false)
      s.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as BrowserDown
        if (m.type === 'frame') return frame.current(m.data, m.metadata)
        if (m.type === 'state') setState(m)
        else if (m.type === 'error') s.close()
      }
      s.onclose = again
    }
    open()
    return () => {
      gone = true
      clearTimeout(timer)
      ws.current?.close()
    }
  }, [task])
  const send = useCallback((m: BrowserUp) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m))
  }, [])
  return { state, stopped, send }
}

/** latest frame wins: one decoding at a time, the newest waiting */
function useCanvas() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const bitmap = useRef<ImageBitmap | null>(null)
  const busy = useRef(false)
  const next = useRef<string | null>(null)
  const width = useRef(DESKTOP.w)
  const [box, setBox] = useState({ w: 0, h: 0 })
  // the page's size in CSS px: its width as agent-browser says, its height from the picture itself
  const [page, setPage] = useState<Size>(DESKTOP)
  const rect = fit(box, page)

  const draw = useCallback(() => {
    const c = canvas.current
    const b = bitmap.current
    if (!c || !b) return
    const dpr = devicePixelRatio || 1
    const w = c.clientWidth
    const h = c.clientHeight
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    const r = fit({ w, h }, { w: b.width, h: b.height })
    g.imageSmoothingQuality = 'high'
    g.drawImage(b, r.x, r.y, r.w, r.h)
  }, [])

  const decode = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    while (next.current) {
      const data = next.current
      next.current = null
      try {
        const blob = await (await fetch(`data:image/jpeg;base64,${data}`)).blob()
        const b = await createImageBitmap(blob)
        bitmap.current?.close()
        bitmap.current = b
        const w = width.current || b.width
        const h = Math.round((b.height * w) / b.width)
        setPage((was) => (was.w === w && was.h === h ? was : { w, h }))
        draw()
      } catch {
        /* a broken frame: the next one will do */
      }
    }
    busy.current = false
  }, [draw])

  const onFrame = useCallback(
    (data: string, m: FrameMeta) => {
      next.current = data
      width.current = m.deviceWidth
      decode()
    },
    [decode],
  )

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setBox({ w: el.clientWidth, h: el.clientHeight })
      draw()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [draw])

  return { canvas, stage, page, rect, onFrame, hasFrame: () => !!bitmap.current }
}

/** The Browser tab: the live view while the task has a live agent; else, as the window's, a quiet line */
export function BrowserView({ task }: { task: Task; chatKey: string }) {
  // no live agent (never started, ended, done): nothing to watch, and no browser is started for it
  if (!task.agent?.running) return <Line>{WORDS.pick}</Line>
  return <LiveView key={task.id} task={task} />
}

function Line({ children, more, error }: { children: string; more?: string; error?: boolean }) {
  return (
    <div className="grid flex-1 place-items-center p-6 text-center">
      <div className="flex max-w-[380px] flex-col items-center gap-1">
        <Small className={clsx('text-pretty', error ? 'text-need-fg' : 'text-fg3')}>{children}</Small>
        {more ? <Small className="text-pretty text-fg3 opacity-75">{more}</Small> : null}
      </div>
    </div>
  )
}

function LiveView({ task }: { task: Task }) {
  const ui = useUI()
  const touch = ui.device !== 'desktop'
  const cv = useCanvas()
  const link = useLink(task.id, cv.onFrame)
  const [opening, setOpening] = useState(false)
  const keys = useRef<HTMLTextAreaElement>(null)
  const st = link.state
  const you = st?.driver === 'you'
  const live = !!st?.connected && cv.hasFrame()
  useEffect(() => {
    if (st?.connected) setOpening(false)
  }, [st?.connected])

  // a minute without your input while you drive: handed back (the window's)
  const lastInput = useRef(0)
  const linkSend = link.send
  useEffect(() => {
    if (!you) return
    const t = setInterval(() => Date.now() - lastInput.current > IDLE_DRIVE_MS && linkSend({ type: 'handback' }), 5000)
    return () => clearInterval(t)
  }, [you, linkSend])
  const send = (m: BrowserUp) => {
    lastInput.current = Date.now()
    link.send(m)
  }

  const local = (e: { clientX: number; clientY: number }) => {
    const r = cv.stage.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const onPage = (e: { clientX: number; clientY: number }) => toPage(local(e), cv.rect, cv.page)

  /* ---------- your input: the first click, scroll, touch or key takes it over ---------- */

  const lastMove = useRef(0)
  const mouse = (e: ReactPointerEvent<HTMLDivElement>, eventType: 'mousePressed' | 'mouseReleased' | 'mouseMoved') => {
    const p = onPage(e)
    if (!p) return
    const button = eventType === 'mouseMoved' ? (e.buttons & 1 ? 'left' : 'none') : (['left', 'middle', 'right'][e.button] ?? 'left')
    send({ type: 'input_mouse', eventType, x: p.x, y: p.y, button, clickCount: eventType === 'mouseMoved' ? 0 : Math.max(1, e.detail), modifiers: modifiers(e) })
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!live || e.pointerType === 'touch') return
    // the click is the page's: the key box keeps the focus
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    if (!touch) keys.current?.focus({ preventScroll: true })
    mouse(e, 'mousePressed')
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    // a move alone doesn't take it over
    if (!you || e.pointerType === 'touch') return
    const now = performance.now()
    if (now - lastMove.current < 30) return
    lastMove.current = now
    mouse(e, 'mouseMoved')
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!live || e.pointerType === 'touch') return
    mouse(e, 'mouseReleased')
  }

  // wheel and touch need listeners that may stop the page behind from scrolling
  useEffect(() => {
    const el = cv.stage.current
    if (!el || !live) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = onPage(e)
      if (p) send({ type: 'input_mouse', eventType: 'mouseWheel', x: p.x, y: p.y, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: modifiers(e) })
    }
    const touches = (eventType: string) => (e: TouchEvent) => {
      e.preventDefault()
      const touchPoints = [...e.touches].flatMap((t) => {
        const p = onPage(t)
        return p ? [{ ...p, id: t.identifier }] : []
      })
      send({ type: 'input_touch', eventType, touchPoints })
    }
    const start = touches('touchStart')
    const move = touches('touchMove')
    const end = touches('touchEnd')
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('touchstart', start, { passive: false })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end, { passive: false })
    el.addEventListener('touchcancel', end, { passive: false })
    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  })

  /** keys go in from a hidden text box: a key press as itself; what a phone keyboard or a paste types, as text.
   *  Alt+← goes back and Ctrl+R (F5) reloads, as the window's view. */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (e.altKey && e.key === 'ArrowLeft') return (e.preventDefault(), send({ type: 'back' }))
    if ((e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'r') || e.key === 'F5') return (e.preventDefault(), send({ type: 'reload' }))
    if (e.nativeEvent.isComposing || e.key === 'Unidentified' || e.key === 'Process') return
    // paste goes in as text (onPaste)
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') return
    const k = keyEvent(e, 'keyDown')
    if (!k) return
    e.preventDefault()
    send(k)
  }
  const onKeyUp = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (e.nativeEvent.isComposing) return
    const k = keyEvent(e, 'keyUp')
    if (k) send(k)
  }
  /** what a phone keyboard typed into the key box: the box holds one space, so Backspace shows as that space gone,
   *  and a new line as Enter */
  const tap = (key: string, code: string) => {
    for (const t of ['keyDown', 'keyUp'] as const) {
      const k = keyEvent({ key, code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }, t)
      if (k) send(k)
    }
  }
  const typed = (v: string) => {
    if (!v.startsWith(HELD)) return tap('Backspace', 'Backspace')
    v.slice(HELD.length)
      .split('\n')
      .forEach((part, i) => {
        if (i) tap('Enter', 'Enter')
        if (part) send({ type: 'text', text: part })
      })
  }

  // what shows when there's no picture: the window's words for each state
  const note: { text: string; more?: string; open?: boolean; error?: boolean; fix?: string } | null = link.stopped
    ? { text: WORDS.stopped }
    : !st
      ? { text: WORDS.starting }
      : opening
        ? { text: WORDS.opening }
        : st.error
          ? { ...fixOf(st.error), error: true, open: true }
          : st.closed
            ? { text: WORDS.closed, more: WORDS.closedMore, open: true }
            : !live
              ? { text: WORDS.looking }
              : null
  const url = (st?.url || '').replace(/^https?:\/\//, '')
  const bar = 'press-dim inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[0.8125rem] text-fg2 hover:bg-hover hover:text-fg coarse:h-9 phone:text-[0.875rem]'

  return (
    <div className="@container/pane flex min-h-0 flex-1 flex-col">
      {/* the page */}
      <div
        ref={cv.stage}
        role="application"
        aria-label={`The task's browser${st?.url ? `: ${st.url}` : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => you && e.preventDefault()}
        className={clsx('relative min-h-0 flex-1 overflow-hidden bg-well select-none', live && 'touch-none')}
      >
        <canvas ref={cv.canvas} className="absolute inset-0 size-full" aria-hidden="true" />
        {you ? <div className="pointer-events-none absolute outline-2 -outline-offset-2 outline-accent" style={{ left: cv.rect.x, top: cv.rect.y, width: cv.rect.w, height: cv.rect.h }} /> : null}
        <textarea
          ref={keys}
          name="browser-keys"
          aria-label="Type into the page"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          tabIndex={live ? 0 : -1}
          className="pointer-events-none absolute top-0 left-0 size-px opacity-0"
          value={HELD}
          onFocus={(e) => e.target.setSelectionRange(HELD.length, HELD.length)}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onChange={(e) => typed(e.target.value)}
          onPaste={(e) => {
            e.preventDefault()
            const t = e.clipboardData.getData('text')
            if (t) send({ type: 'text', text: t })
          }}
        />
        {note ? (
          // over the canvas, which may still hold the last page
          <div className="absolute inset-0 grid place-items-center bg-well p-6 text-center">
            <div className="flex max-w-[380px] flex-col items-center gap-1">
              <Small className={clsx('text-pretty', note.error ? 'break-words text-need-fg' : 'text-fg3')}>{note.text}</Small>
              {note.fix ? (
                <Small className="mt-1 text-fg2">
                  Fix it: <code className="whitespace-nowrap font-mono select-all">{note.fix}</code>
                </Small>
              ) : null}
              {note.more ? <Small className="text-pretty text-fg3 opacity-75">{note.more}</Small> : null}
              {note.open ? (
                <Ghost className="mt-2" onClick={() => (setOpening(true), link.send({ type: 'open' }))}>
                  {WORDS.open}
                </Ghost>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* its bar, as the window's: who drives and where it is; Hand back, Back, Reload */}
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-t border-line pr-1.5 pl-3 text-[0.8125rem] phone:min-h-11 phone:text-[0.875rem]" aria-live="polite">
        <span className={clsx('shrink-0 font-medium', live ? (you ? 'text-work-fg' : 'text-ready-fg') : 'text-fg3')}>
          {live ? `● ${you ? WORDS.driving : WORDS.live}` : `○ ${WORDS.off}`}
        </span>
        <span className="min-w-0 flex-1 truncate text-fg3">{live ? url : ''}</span>
        {live && !touch ? <span className="hidden shrink-0 text-fg3 @[36rem]/pane:inline">{WORDS.keys}</span> : null}
        {live && you ? (
          <button type="button" className={bar} onClick={() => link.send({ type: 'handback' })}>
            {WORDS.handBack}
          </button>
        ) : null}
        {live ? (
          <>
            <button type="button" className={bar} onClick={() => send({ type: 'back' })}>
              <PageBackIcon className={ic} />
              {WORDS.back}
            </button>
            <button type="button" className={bar} onClick={() => send({ type: 'reload' })}>
              <ReloadIcon className={ic} />
              {WORDS.reload}
            </button>
          </>
        ) : null}
      </div>

      {/* a phone or tablet has no keyboard of its own: this brings up its on-screen one for the page */}
      {touch && live ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2">
          <Ghost onClick={() => keys.current?.focus()}>Keyboard</Ghost>
          <Small>Type into the page with your keyboard.</Small>
        </div>
      ) : null}
    </div>
  )
}

/** a browser error's own words and, apart, the one command that fixes it (herdr-browser ends with "Fix it: <command>") */
function fixOf(error: string): { text: string; fix?: string } {
  const m = /^(.*?)\s*Fix it: (.+)$/s.exec(error)
  return m ? { text: m[1], fix: m[2].trim() } : { text: error }
}

/** why a task's browser can't be watched here: another machine's (the window's words, from the service), or the
 *  browser off on its machine. A task with no live agent says so in its own view (BrowserView). */
export function browserOff(t: Task): string | null {
  if (!t.browser) return "The shared browser is off on this task's machine."
  return t.browser.ready ? null : (t.browser.hint ?? "The shared browser isn't installed on this task's machine.")
}

export default definePlugin({
  name: 'browser',
  setup(reg) {
    reg.taskPanel.push({ id: 'browser', order: 50, label: 'Browser', Icon: GlobeIcon, useOff: browserOff, View: BrowserView })
  },
})
