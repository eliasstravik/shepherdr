// Browser: the task's shared browser, an item of its side panel. The agent drives it with agent-browser; you watch it
// live, and take over (your mouse, keys and touches go in) or hand it back at any time. Mark up: tap elements,
// write a note on each (numbered pins mark them on the page), and send the notes together into the task's chat.
import clsx from 'clsx'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { act, definePlugin, useUI } from '@client/kernel.ts'
import { FitIcon, Ghost, GlobeIcon, ic, IconButton, PageBackIcon, PageForwardIcon, MarkUpIcon, Primary, ReloadIcon, Small, UnfitIcon, XIcon } from '@client/ui.tsx'
import { shortUrl, type BrowserDown, type BrowserNote, type BrowserPick, type BrowserUp, type FrameMeta } from '@shared/browser.ts'
import type { Action, Task } from '@shared/types.ts'
import { fit, keyEvent, modifiers, pinAt, shotRect, toPage, toPanel, type Rect, type Size } from './input.ts'

type State = Extract<BrowserDown, { type: 'state' }>

/** agent-browser's own page size, which Fit goes back to */
const DESKTOP = { w: 1280, h: 720 }
/** the agent counts as busy in the browser this long after its last command */
const BUSY_MS = 8000

/** notes not sent yet, by task: they stay while you look at another item or task */
const kept = new Map<string, BrowserNote[]>()

/** what the key box holds, so a phone's Backspace has something to take */
const HELD = ' '

/** the shots of notes not sent yet, by their small copy's address */
const shots = new Map<string, Blob>()
const drop = (p: BrowserPick) => {
  if (!p.thumb) return
  shots.delete(p.thumb)
  URL.revokeObjectURL(p.thumb)
}

/** a note's shot, into the task chat's inbox on the task's machine (where it goes in as an attached file) */
async function upload(chatKey: string, blob: Blob, element: string, number: number) {
  const slug = element.replace(/"[^"]*"?/g, '').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 24) || 'element'
  const body = new FormData()
  body.append('chat', chatKey)
  body.append('file', new File([blob], `note-${number}-${slug}.png`, { type: 'image/png' }))
  const r = (await fetch('api/upload', { method: 'POST', body, headers: { 'x-shepherdr': '1' } })
    .then((x) => x.json())
    .catch(() => null)) as { path?: string } | null
  return r?.path ?? null
}

/** Frames and controls use Shepherdr's WebSocket; remote traffic stays inside core. */
function useLink(task: string, onFrame: (data: string, meta: FrameMeta) => void, onPicked: (m: Extract<BrowserDown, { type: 'picked' }>) => void) {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ended, setEnded] = useState(false)
  const [hover, setHover] = useState<Rect | null>(null)
  const ws = useRef<WebSocket | null>(null)
  const frame = useRef(onFrame)
  const picked = useRef(onPicked)
  frame.current = onFrame
  picked.current = onPicked
  useEffect(() => {
    let gone = false
    let wait = 500
    let timer: ReturnType<typeof setTimeout>
    const open = () => {
      const url = new URL(`api/browser?task=${encodeURIComponent(task)}`, location.href)
      url.protocol = url.protocol.replace('http', 'ws')
      const s = new WebSocket(url)
      ws.current = s
      s.onopen = () => (wait = 500)
      s.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as BrowserDown
        if (m.type === 'frame') return frame.current(m.data, m.metadata)
        if (m.type === 'state') {
          setState(m)
          if (m.connected) setError(null)
        } else if (m.type === 'error') {
          setError(m.message)
          // closed with its task: no coming back for it
          if (m.gone) {
            gone = true
            setEnded(true)
          }
        }
        else if (m.type === 'picked') picked.current(m)
        else if (m.type === 'hover') setHover(m.box)
      }
      s.onclose = () => {
        if (gone) return
        // the server restarts after an update: come back
        timer = setTimeout(open, wait)
        wait = Math.min(wait * 2, 8000)
      }
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
  /** start it again: the error goes until the server says how it went */
  const retry = useCallback(() => {
    setError(null)
    send({ type: 'start' })
  }, [send])
  return { state, error, ended, hover, setHover, send, retry }
}

/** latest frame wins: one decoding at a time, the newest waiting */
function useCanvas() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const bitmap = useRef<ImageBitmap | null>(null)
  const busy = useRef(false)
  const next = useRef<string | null>(null)
  const [meta, setMeta] = useState<FrameMeta>()
  const width = useRef(DESKTOP.w)
  const [box, setBox] = useState({ w: 0, h: 0 })
  // the page's size in CSS px: its width as agent-browser says, its height from the picture itself (the height it
  // reports can be the window's, taller than the page)
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
      // the overlay only moves when the page scrolls or changes size
      setMeta((was) =>
        was && was.deviceWidth === m.deviceWidth && was.deviceHeight === m.deviceHeight && was.scrollOffsetX === m.scrollOffsetX && was.scrollOffsetY === m.scrollOffsetY ? was : m,
      )
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

  /** part of the frame on screen (viewport px) as a picture: a note's shot is what you saw */
  const crop = useCallback(async (r: Rect, of: Size): Promise<Blob | null> => {
    const b = bitmap.current
    if (!b) return null
    const sx = b.width / of.w
    const sy = b.height / of.h
    const c = new OffscreenCanvas(Math.max(1, Math.round(r.w * sx)), Math.max(1, Math.round(r.h * sy)))
    c.getContext('2d')!.drawImage(b, r.x * sx, r.y * sy, r.w * sx, r.h * sy, 0, 0, c.width, c.height)
    return c.convertToBlob({ type: 'image/png' })
  }, [])

  return { canvas, stage, meta, page, rect, box, onFrame, crop, hasFrame: () => !!bitmap.current }
}

export function BrowserView({ task, chatKey }: { task: Task; chatKey: string }) {
  const ui = useUI()
  const phone = ui.device === 'phone'
  const touch = ui.device !== 'desktop'
  const cv = useCanvas()
  const [notes, setNotesState] = useState<BrowserNote[]>(() => kept.get(task.id) ?? [])
  const [draft, setDraft] = useState<{ id: number; at: { x: number; y: number }; tap: { x: number; y: number }; pick?: BrowserPick; error?: string; comment: string } | null>(null)
  const [annotate, setAnnotate] = useState(() => (kept.get(task.id)?.length ?? 0) > 0)
  const [address, setAddress] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const picks = useRef(0)
  const keys = useRef<HTMLTextAreaElement>(null)
  const setNotes = (f: (n: BrowserNote[]) => BrowserNote[]) =>
    setNotesState((was) => {
      const n = f(was)
      kept.set(task.id, n)
      return n
    })
  const drafted = useRef(draft)
  drafted.current = draft
  // what the page said about your tap; its shot is cropped from the frame on screen, and goes to the task's machine
  // only with the notes
  const onPicked = async (m: Extract<BrowserDown, { type: 'picked' }>) => {
    const d = drafted.current
    if (!d || d.id !== m.id) return
    if (!m.pick) return setDraft({ ...d, error: m.error ?? 'Nothing there to note.' })
    const r = shotRect(m.pick, d.tap, cv.page)
    const blob = r ? await cv.crop(r, cv.page).catch(() => null) : null
    const thumb = blob ? URL.createObjectURL(blob) : undefined
    if (blob && thumb) shots.set(thumb, blob)
    setDraft((x) => (x && x.id === m.id ? { ...x, pick: { ...m.pick!, thumb } } : x))
  }
  const link = useLink(task.id, cv.onFrame, onPicked)
  const st = link.state
  const you = st?.driver === 'you'
  const busy = !you && st?.agentAgo !== undefined && st.agentAgo < BUSY_MS
  const fitted = !!st && (st.viewport.w !== DESKTOP.w || st.viewport.h !== DESKTOP.h)

  // "busy" fades on its own once the agent stops
  const [, tick] = useState(0)
  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => tick((n) => n + 1), BUSY_MS)
    return () => clearTimeout(t)
  }, [busy, st])

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(null), 2200)
    return () => clearTimeout(t)
  }, [hint])

  const local = (e: { clientX: number; clientY: number }) => {
    const r = cv.stage.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const onPage = (e: { clientX: number; clientY: number }) => toPage(local(e), cv.rect, cv.page)

  /* ---------- your input, while you drive ---------- */

  const lastMove = useRef(0)
  const mouse = (e: ReactPointerEvent<HTMLDivElement>, eventType: 'mousePressed' | 'mouseReleased' | 'mouseMoved') => {
    const p = onPage(e)
    if (!p) return
    const button = eventType === 'mouseMoved' ? (e.buttons & 1 ? 'left' : 'none') : (['left', 'middle', 'right'][e.button] ?? 'left')
    link.send({ type: 'input_mouse', eventType, x: p.x, y: p.y, button, clickCount: eventType === 'mouseMoved' ? 0 : Math.max(1, e.detail), modifiers: modifiers(e) })
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (annotate) return pickAt(e)
    if (!you) {
      if (e.pointerType !== 'touch') setHint('Take over to use the page')
      return
    }
    if (e.pointerType === 'touch') return
    // the click is the page's: the key box keeps the focus
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    if (!touch) keys.current?.focus({ preventScroll: true })
    mouse(e, 'mousePressed')
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return
    const now = performance.now()
    if (now - lastMove.current < 30) return
    lastMove.current = now
    if (annotate) {
      const p = onPage(e)
      if (p) link.send({ type: 'hover', x: p.x, y: p.y })
      return
    }
    if (you) mouse(e, 'mouseMoved')
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (annotate || !you || e.pointerType === 'touch') return
    mouse(e, 'mouseReleased')
  }

  // wheel and touch need listeners that may stop the page behind from scrolling
  useEffect(() => {
    const el = cv.stage.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (!you || annotate) return
      e.preventDefault()
      const p = onPage(e)
      if (p) link.send({ type: 'input_mouse', eventType: 'mouseWheel', x: p.x, y: p.y, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: modifiers(e) })
    }
    const touches = (eventType: string) => (e: TouchEvent) => {
      if (!you || annotate) return
      e.preventDefault()
      const touchPoints = [...e.touches].flatMap((t) => {
        const p = onPage(t)
        return p ? [{ ...p, id: t.identifier }] : []
      })
      link.send({ type: 'input_touch', eventType, touchPoints })
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

  /** keys go in from a hidden text box: a key press as itself; what a phone keyboard or a paste types, as text */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (!you || e.nativeEvent.isComposing || e.key === 'Unidentified' || e.key === 'Process') return
    // paste goes in as text (onPaste)
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') return
    const k = keyEvent(e, 'keyDown')
    if (!k) return
    e.preventDefault()
    link.send(k)
  }
  const onKeyUp = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (!you || e.nativeEvent.isComposing) return
    const k = keyEvent(e, 'keyUp')
    if (k) link.send(k)
  }

  /** what a phone keyboard typed into the key box (its keys often come as "Unidentified"): the box holds one space, so
   *  Backspace shows as that space gone, and a new line as Enter */
  const tap = (key: string, code: string) => {
    for (const t of ['keyDown', 'keyUp'] as const) {
      const k = keyEvent({ key, code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }, t)
      if (k) link.send(k)
    }
  }
  const typed = (v: string) => {
    if (!v.startsWith(HELD)) return tap('Backspace', 'Backspace')
    v.slice(HELD.length)
      .split('\n')
      .forEach((part, i) => {
        if (i) tap('Enter', 'Enter')
        if (part) link.send({ type: 'text', text: part })
      })
  }

  /* ---------- annotate ---------- */

  const pickAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = onPage(e)
    if (!p) return
    // a draft with words in it stays until it is added or dropped
    if (draft?.comment.trim()) return setHint('Add or drop this note first')
    const id = ++picks.current
    setDraft({ id, at: local(e), tap: p, comment: '' })
    link.setHover(null)
    link.send({ type: 'pick', id, x: p.x, y: p.y })
  }

  const addDraft = () => {
    if (!draft?.pick || !draft.comment.trim()) return
    const n = { comment: draft.comment.trim(), pick: draft.pick }
    setNotes((ns) => [...ns, n])
    setDraft(null)
  }

  const sending = useRef(false)
  const preparedNotes = useRef<{ fingerprint: string; action: Extract<Action, { type: 'browser-notes' }> } | null>(null)
  const sendNotes = async () => {
    const all = draft?.pick && draft.comment.trim() ? [...notes, { comment: draft.comment.trim(), pick: draft.pick }] : notes
    if (!all.length || !st || sending.current) return
    sending.current = true
    try {
      await sendAll(all, st)
    } catch (error) { setHint((error as Error).message) } finally {
      sending.current = false
    }
  }
  const sendAll = async (all: BrowserNote[], st: State) => {
    const fingerprint = JSON.stringify({ all, url: st.url, title: st.title, viewport: st.viewport })
    if (preparedNotes.current?.fingerprint !== fingerprint) {
      const out = await Promise.all(
        all.map(async (n, index) => {
          const blob = n.pick.thumb && shots.get(n.pick.thumb)
          const shot = blob ? await upload(chatKey, blob, n.pick.element, index + 1) : null
          return { comment: n.comment, pick: { ...n.pick, thumb: undefined, ...(shot ? { shot } : {}) } }
        }),
      )
      preparedNotes.current = { fingerprint, action: { type: 'browser-notes', cid: crypto.randomUUID(), chat: chatKey, url: st.url, title: st.title || undefined, viewport: st.viewport, notes: out } }
    }
    await act(preparedNotes.current.action)
    preparedNotes.current = null
    all.forEach((n) => drop(n.pick))
    if (draft?.pick) drop(draft.pick)
    setNotes(() => [])
    setDraft(null)
    setAnnotate(false)
    setSent(`${all.length === 1 ? '1 note' : `${all.length} notes`} sent to the agent.`)
    setTimeout(() => setSent(null), 3000)
  }

  const toggleAnnotate = () => {
    setAnnotate((a) => !a)
    link.setHover(null)
    if (annotate && !draft?.comment.trim()) {
      if (draft?.pick) drop(draft.pick)
      setDraft(null)
    }
  }

  const go = () => {
    if (address === null) return
    const url = address.trim()
    setAddress(null)
    if (url) link.send({ type: 'go', url })
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  const fitPanel = () => link.send(fitted ? { type: 'viewport', ...DESKTOP } : { type: 'viewport', w: Math.round(cv.box.w), h: Math.round(cv.box.h) })

  const pins = [...notes.map((n) => n.pick), ...(draft?.pick ? [draft.pick] : [])]
  const showing = st?.connected && cv.hasFrame()
  const shown = st ? (address ?? (st.url && st.url !== 'about:blank' ? shortUrl(st.url) : '')) : ''

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* the address and the way about */}
      {/* as tall as the other items' bars */}
      <div className="flex min-h-9 shrink-0 items-center gap-1 border-b border-line px-1.5 phone:min-h-11">
        <IconButton label="Back" disabled={!you} onClick={() => link.send({ type: 'back' })}>
          <PageBackIcon className={ic} />
        </IconButton>
        {phone ? null : (
          <IconButton label="Forward" disabled={!you} onClick={() => link.send({ type: 'forward' })}>
            <PageForwardIcon className={ic} />
          </IconButton>
        )}
        <IconButton label="Reload" disabled={!you} onClick={() => link.send({ type: 'reload' })}>
          <ReloadIcon className={ic} />
        </IconButton>
        <input
          name="address"
          aria-label="Address"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          readOnly={!you}
          placeholder={you ? 'Type an address' : 'No page yet'}
          value={shown}
          onFocus={(e) => {
            if (!you) return
            setAddress(st?.url && st.url !== 'about:blank' ? st.url : '')
            requestAnimationFrame(() => e.target.select())
          }}
          onBlur={() => setAddress(null)}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') go()
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
          }}
          className="h-7 min-w-0 flex-1 truncate rounded-full bg-bubble px-3 text-[0.8125rem] text-fg outline-none placeholder:text-fg3 read-only:text-fg2 focus:shadow-box-focus phone:h-10 phone:text-[1rem]"
        />
        <IconButton label={annotate ? 'Done marking up' : 'Mark up: point at things on the page to leave notes'} pressed={annotate} onClick={toggleAnnotate}>
          <MarkUpIcon />
        </IconButton>
      </div>

      {/* who drives */}
      <div className={clsx('flex min-h-9 shrink-0 items-center gap-2 pr-1.5 pl-3 text-[0.8125rem] phone:min-h-11 phone:text-[0.875rem]', you ? 'bg-accent/8' : 'bg-well')} aria-live="polite">
        <span className={clsx('size-2 shrink-0 rounded-full', you ? 'bg-accent' : busy ? 'bg-work motion-safe:animate-pulse' : 'bg-muted')} aria-hidden="true" />
        <div className="min-w-0 flex-1 truncate">
          <span className="font-medium text-fg">{you ? 'You’re driving' : 'Agent is driving'}</span>
          <span className="text-fg3">{you ? ' · the agent waits' : busy ? ' · at work' : ' · idle'}</span>
        </div>
        <IconButton label={fitted ? `Back to ${DESKTOP.w}×${DESKTOP.h}` : 'Fit the page to this panel'} pressed={fitted} disabled={!you} onClick={fitPanel}>
          {fitted ? <UnfitIcon className={ic} /> : <FitIcon className={ic} />}
        </IconButton>
        {you ? <Ghost onClick={() => link.send({ type: 'handback' })}>Hand back</Ghost> : <Ghost onClick={() => link.send({ type: 'take' })}>Take over</Ghost>}
      </div>

      {/* the page */}
      <div
        ref={cv.stage}
        role="application"
        aria-label={`The shared browser${st?.url ? `: ${st.url}` : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => annotate && link.setHover(null)}
        onContextMenu={(e) => you && e.preventDefault()}
        className={clsx(
          'relative min-h-0 flex-1 overflow-hidden bg-well select-none',
          annotate ? 'cursor-crosshair' : you ? 'cursor-default' : 'cursor-not-allowed',
          (you || annotate) && 'touch-none',
        )}
      >
        <canvas ref={cv.canvas} className="absolute inset-0 size-full" aria-hidden="true" />
        {annotate || you ? (
          <div
            className={clsx('pointer-events-none absolute outline-2 -outline-offset-2', annotate ? 'outline-focus outline-dashed' : 'outline-accent')}
            style={{ left: cv.rect.x, top: cv.rect.y, width: cv.rect.w, height: cv.rect.h }}
          />
        ) : null}
        {annotate && link.hover ? <Outline r={link.hover} rect={cv.rect} page={cv.page} /> : null}
        {annotate &&
          pins.map((p, i) => {
            const at = pinAt(p, st?.url ?? '', cv.meta, cv.rect, cv.page)
            return at ? <Pin key={i} n={i + 1} x={at.x} y={at.y} /> : null
          })}
        {annotate && draft && !draft.pick && !draft.error ? <Pin n={notes.length + 1} x={draft.at.x} y={draft.at.y} waiting /> : null}
        <textarea
          ref={keys}
          name="browser-keys"
          aria-label="Type into the page"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          tabIndex={you ? 0 : -1}
          className="pointer-events-none absolute top-0 left-0 size-px opacity-0"
          value={HELD}
          onFocus={(e) => e.target.setSelectionRange(HELD.length, HELD.length)}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onChange={(e) => you && typed(e.target.value)}
          onPaste={(e) => {
            e.preventDefault()
            const t = e.clipboardData.getData('text')
            if (you && t) link.send({ type: 'text', text: t })
          }}
        />
        {!showing ? (
          // over the canvas, which may still hold the last page (often a white one)
          <div className="absolute inset-0 grid place-items-center bg-well p-6 text-center">
            <div className="flex max-w-xs flex-col items-center gap-3">
              <Small className={clsx('text-pretty', link.error ? 'text-need-fg' : 'text-fg3')}>{link.error ?? (st && !st.connected ? 'The browser is closed.' : 'Starting the browser…')}</Small>
              {!link.ended && (link.error || (st && !st.connected)) ? (
                <Ghost onClick={link.retry}>{link.error ? 'Try again' : 'Open it again'}</Ghost>
              ) : null}
            </div>
          </div>
        ) : null}
        {hint ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
            <div className="rounded-full bg-fg px-3 py-1.5 text-[0.8125rem] text-bg shadow-toast">{hint}</div>
          </div>
        ) : null}
      </div>

      {touch && you && !annotate ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2">
          <Ghost onClick={() => keys.current?.focus()}>Keyboard</Ghost>
          <Small>Type into the page with your keyboard.</Small>
        </div>
      ) : null}

      {annotate || notes.length || sent ? (
        <Notes
          notes={notes}
          draft={draft}
          sent={sent}
          annotate={annotate}
          onDraft={(comment) => setDraft((d) => (d ? { ...d, comment } : d))}
          onAdd={addDraft}
          onDrop={() => {
            if (draft?.pick) drop(draft.pick)
            setDraft(null)
          }}
          onRemove={(i) => {
            drop(notes[i].pick)
            setNotes((ns) => ns.filter((_, j) => j !== i))
          }}
          onSend={sendNotes}
        />
      ) : null}
    </div>
  )
}

/** a numbered pin, as Mark up's on pages */
function Pin({ n, x, y, waiting }: { n: number; x: number; y: number; waiting?: boolean }) {
  return (
    <span
      className={clsx(
        // Mark up's numbered mark, ringed in the page colour
        'pointer-events-none absolute grid h-[18px] min-w-[18px] -translate-1/2 place-items-center rounded-full bg-focus px-[5px] text-[0.6875rem] font-semibold text-white tabular-nums shadow-[0_0_0_2px_var(--bg)] phone:h-[22px] phone:min-w-[22px] phone:text-[0.8125rem]',
        waiting && 'motion-safe:animate-pulse',
      )}
      style={{ left: x, top: y }}
    >
      {n}
    </span>
  )
}

/** the element under the pointer, outlined, in Mark up */
function Outline({ r, rect, page }: { r: Rect; rect: Rect; page: { w: number; h: number } }) {
  const a = toPanel({ x: r.x, y: r.y }, rect, page)
  const b = toPanel({ x: r.x + r.w, y: r.y + r.h }, rect, page)
  return <div className="pointer-events-none absolute rounded-[3px] bg-focus/10 outline-2 outline-focus" style={{ left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y }} />
}

function Notes({
  notes,
  draft,
  sent,
  annotate,
  onDraft,
  onAdd,
  onDrop,
  onRemove,
  onSend,
}: {
  notes: BrowserNote[]
  draft: { pick?: BrowserPick; error?: string; comment: string } | null
  sent: string | null
  annotate: boolean
  onDraft: (s: string) => void
  onAdd: () => void
  onDrop: () => void
  onRemove: (i: number) => void
  onSend: () => void
}) {
  const count = notes.length + (draft?.pick && draft.comment.trim() ? 1 : 0)
  // a finger taps, a mouse clicks
  const touch = matchMedia('(pointer: coarse)').matches
  return (
    <div className="flex max-h-[45%] shrink-0 flex-col gap-2 overflow-y-auto border-t border-line p-3">
      {sent ? <Small className="text-ready">{sent}</Small> : null}
      {notes.length ? (
        <ol className="flex flex-col gap-1.5" role="list">
          {notes.map((n, i) => (
            <li key={i} className="flex items-start gap-2 text-[0.8125rem]/5 phone:text-[0.875rem]/5">
              <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-focus px-[5px] text-[0.6875rem] font-semibold text-white tabular-nums phone:mt-px phone:h-[22px] phone:min-w-[22px] phone:text-[0.8125rem]">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-fg2">{n.pick.element}</div>
                <div className="text-fg">{n.comment}</div>
              </div>
              <IconButton label={`Remove note ${i + 1}`} onClick={() => onRemove(i)}>
                <XIcon className={ic} />
              </IconButton>
            </li>
          ))}
        </ol>
      ) : null}
      {draft ? (
        <div className="flex flex-col gap-2 rounded-box bg-bubble p-2.5">
          {draft.error ? (
            <Small className="text-need">{draft.error}</Small>
          ) : !draft.pick ? (
            <Small>Looking at what you tapped…</Small>
          ) : (
            <>
              <div className="flex items-start gap-2.5">
                {draft.pick.thumb ? <img src={draft.pick.thumb} alt="" className="max-h-16 max-w-24 shrink-0 rounded-[calc(var(--box-radius)-var(--spacing)*2.5)] object-contain shadow-[0_0_0_1px_var(--line2)]" /> : null}
                <div className="min-w-0 flex-1 text-[0.8125rem]/5 phone:text-[0.875rem]/5">
                  <div className="truncate font-medium text-fg">{draft.pick.element}</div>
                  <div className="truncate font-mono text-[0.75rem] text-fg3">{draft.pick.selector}</div>
                </div>
              </div>
              <input
                name="browser-note"
                aria-label={`Note ${notes.length + 1}`}
                autoFocus
                placeholder="What should change?"
                value={draft.comment}
                onChange={(e) => onDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') onAdd()
                  if (e.key === 'Escape') onDrop()
                }}
                className="h-8 min-w-0 rounded-full bg-bg px-3 text-[0.8125rem] shadow-[inset_0_0_0_1px_var(--line2)] outline-none focus:shadow-box-focus phone:h-11 phone:text-[1rem]"
              />
            </>
          )}
          <div className="flex gap-2">
            {draft.pick ? (
              <Ghost disabled={!draft.comment.trim()} onClick={onAdd}>
                Add note
              </Ghost>
            ) : null}
            <Ghost onClick={onDrop}>Drop</Ghost>
          </div>
        </div>
      ) : annotate && !sent ? (
        <Small>{notes.length ? `${touch ? 'Tap' : 'Click'} something else to add a note.` : `${touch ? 'Tap' : 'Click'} something on the page to leave a note on it.`}</Small>
      ) : null}
      {count ? (
        <div>
          <Primary onClick={onSend}>Send {count === 1 ? '1 note' : `${count} notes`} to the agent</Primary>
        </div>
      ) : null}
    </div>
  )
}

/** why a task has no browser to show: merged, the plugin off on its machine, or agent-browser missing there */
export function browserOff(t: Task): string | null {
  if (t.status === 'done') return `${t.id} is done: its browser was closed.`
  if (!t.browser) return "The shared browser is off on this task's machine."
  return t.browser.ready ? null : (t.browser.hint ?? "The shared browser isn't installed on this task's machine.")
}

export default definePlugin({
  name: 'browser',
  setup(reg) {
    reg.taskPanel.push({ id: 'browser', order: 50, label: 'Browser', Icon: GlobeIcon, useOff: browserOff, View: BrowserView })
  },
})
