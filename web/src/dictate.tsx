// The mic in a message box (and in Feedback): dictation only. A voice call is the other thing (the wave button).
// SHEP-314: while it records, the box's bottom row becomes the recording itself, the way ChatGPT's, Claude's and
// WhatsApp's composers do it: Cancel on the left, a wave drawn from the microphone's real level and the time in the
// middle, Done on the right where Send was. The words show above it as they are heard (kept ones in full, the ones
// still being heard lighter, the way Apple's dictation writes them), then "Writing it down" until they land in the box.
// Every way it fails says why, there. Escape cancels; leaving the chat cancels.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { canDictate, clock, dictate, dictSample, SAY, type Dictation, type Heard } from './dictation.ts'
import { IDLE, NOTHING, shownWords, step, type DictEvent, type DictState } from './dictstate.ts'
import { has } from './kernel.ts'
import { still } from './motion.ts'
import { I, IB } from './ui.tsx'
import './dictate.css'

/** the state and the words it writes: each event steps once (no reducer, which StrictMode runs twice), so a write
 *  happens once, from the step that made it */
function useDictState(write: (text: string) => void) {
  const out = useRef(write)
  out.current = write
  const now = useRef<DictState>(IDLE)
  const [s, set] = useState<DictState>(IDLE)
  const dispatch = useRef((e: DictEvent) => {
    const r = step(now.current, e)
    now.current = r.s
    set(r.s)
    if (r.write) out.current(r.write)
  }).current
  return [s, dispatch] as const
}

export function DictateButton({ write, scope }: { write: (text: string) => void; scope?: string }) {
  const [s, dispatch] = useDictState((text) => {
    write(text)
    landed.current = true
  })
  const [words, setWords] = useState<Heard>(NOTHING)
  const live = useRef<Dictation | null>(null)
  const surf = useRef<HTMLDivElement>(null)
  const mic = useRef<HTMLButtonElement>(null)
  const landed = useRef(false)
  const [, tick] = useState(0)
  const said = useRef<HTMLDivElement>(null)
  const active = s.k !== 'idle'

  const cancel = () => {
    const d = live.current
    live.current = null
    d?.cancel()
    dispatch({ t: 'cancel' })
  }
  const start = () => {
    live.current?.cancel()
    if (!canDictate()) {
      dispatch({ t: 'start' })
      return dispatch({ t: 'fail', why: 'This browser has no microphone to dictate with.' })
    }
    setWords(NOTHING)
    landed.current = false
    dispatch({ t: 'start' })
    const d = dictate(
      (text) => {
        if (live.current === d) live.current = null
        dispatch({ t: 'end', text })
      },
      (why) => {
        if (live.current === d) live.current = null
        dispatch({ t: 'fail', why })
      },
      undefined,
      (p) => dispatch({ t: 'phase', p, at: Date.now() }),
      setWords,
    )
    live.current = d
  }
  const done = () => live.current?.finish()

  // gone (the box closed) or another chat's box: stop, write nothing
  useEffect(() => () => live.current?.cancel(), [])
  useEffect(() => () => cancel(), [scope])
  // the browser's microphone question still open: say what it waits for
  useEffect(() => {
    if (s.k !== 'asking' || s.slow) return
    const t = setTimeout(() => dispatch({ t: 'slow' }), 1200)
    return () => clearTimeout(t)
  }, [s])
  // the time moves while it records
  useEffect(() => {
    if (s.k !== 'on') return
    const t = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(t)
  }, [s.k])
  // Escape cancels (or closes the error), before anything else on the page hears it
  useEffect(() => {
    if (!active) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return
      e.preventDefault()
      e.stopPropagation()
      if (s.k === 'error') dispatch({ t: 'dismiss' })
      else cancel()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [active, s.k])
  // focus: on the surface's main button while it shows (keyboard: Enter is Done), then back where it belongs
  const was = useRef(false)
  useEffect(() => {
    if (active && !was.current) surf.current?.querySelector<HTMLButtonElement>('[data-main]')?.focus({ preventScroll: true })
    if (!active && was.current) {
      // the words landed: on a desktop, into the box to edit them; else back on the mic (no phone keyboard pops up)
      const box = mic.current?.closest('.cbox')?.querySelector<HTMLTextAreaElement>('textarea')
      if (landed.current && box && matchMedia('(pointer: fine)').matches) {
        box.focus({ preventScroll: true })
        box.setSelectionRange(box.value.length, box.value.length)
      } else if (document.activeElement === document.body || !document.activeElement) mic.current?.focus({ preventScroll: true })
    }
    was.current = active
  }, [active])

  // the newest words stay in view: scrolled to the end as they come, the older ones fading at the top
  useLayoutEffect(() => {
    const el = said.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    el.classList.toggle('more', el.scrollTop > 0)
  }, [words, s.k])

  if (!has('voice')) return null
  if (!active)
    return (
      <button ref={mic} type="button" className="ib" aria-label="Dictate" onClick={start}>
        <I n="mic" />
      </button>
    )

  const shown = shownWords(words)
  const heard = !!(shown.said || shown.partial)
  return (
    <div ref={surf} className={`dsurf ${s.k}`} role="group" aria-label="Dictation">
      <div ref={said} className="dwords" aria-hidden={s.k !== 'error'}>
        {s.k === 'error' ? (
          <p className="derr" role="alert">
            <I n="warn" c="s16" />
            <span>{s.why}</span>
          </p>
        ) : s.k === 'asking' ? (
          <p className="dhint">{s.slow ? SAY.asking : 'Starting the microphone…'}</p>
        ) : heard ? (
          <p className="dsaid">
            {shown.said}
            <span className="dpart">{shown.partial}</span>
          </p>
        ) : (
          <p className="dhint">{s.k === 'writing' ? 'Writing it down…' : 'Listening…'}</p>
        )}
      </div>
      <div className="dctl">
        {s.k === 'error' ? (
          <>
            <IB icon="x" label="Close" onClick={() => dispatch({ t: 'dismiss' })} />
            <span className="sp" />
            <button type="button" className="ddone" data-main onClick={start}>
              <I n="mic" c="s16" />
              <span>Try again</span>
            </button>
          </>
        ) : (
          <>
            <IB icon="x" label="Cancel dictation" onClick={cancel} />
            <Wave on={s.k === 'on'} />
            <span className="dtime" aria-hidden>
              <i className={`ddot${s.k === 'on' ? ' rec' : ''}`} />
              {s.k === 'on' ? clock(Date.now() - s.since) : '0:00'}
            </span>
            {s.k === 'writing' ? (
              <button type="button" className="ddone wr" data-main aria-label="Writing it down" aria-disabled="true" onClick={() => undefined}>
                <i className="dspin" aria-hidden />
                <span>Writing</span>
              </button>
            ) : (
              <button type="button" className="ddone" data-main aria-label="Done, write it down" disabled={s.k !== 'on'} onClick={done}>
                <I n="check" c="s16" />
                <span>Done</span>
              </button>
            )}
          </>
        )}
      </div>
      <span className="vh" role="status">
        {s.k === 'asking' ? (s.slow ? SAY.asking : 'Starting the microphone') : s.k === 'on' ? 'Recording' : s.k === 'writing' ? 'Writing it down' : ''}
      </span>
    </div>
  )
}

/** bars kept for the wave: one per BAR+GAP pixels, the newest on the right */
const BAR = 3
const GAP = 2
/** a new bar about every 60 ms: speech's syllables show as peaks */
const EVERY = 60

/** The wave: drawn from the microphone's real level (dictSample), scrolling left as you speak; still dots before a
 *  sound and frozen once Done is pressed. With reduced motion: a calm level meter that fills and empties, no scroll. */
function Wave({ on }: { on: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const bars = useRef<number[]>([])
  const calm = useRef(still())
  useEffect(() => {
    const c = ref.current
    if (!c) return
    let raf = 0
    let last = 0
    let smooth = 0
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const dpr = devicePixelRatio || 1
      const w = c.clientWidth
      const h = c.clientHeight
      if (!w || !h) return
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
      }
      const g = c.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      g.fillStyle = getComputedStyle(c).color
      const level = on ? dictSample().level : 0
      if (calm.current) {
        // reduced motion: one bar that fills with how loud you are, eased so it doesn't flicker
        smooth += (level - smooth) * 0.2
        g.globalAlpha = 0.18
        round(g, 0, h / 2 - 2, w, 4)
        g.globalAlpha = 1
        if (smooth > 0.01) round(g, 0, h / 2 - 2, Math.max(4, w * Math.min(1, smooth * 1.4)), 4)
        return
      }
      const n = Math.max(1, Math.floor((w + GAP) / (BAR + GAP)))
      if (on && now - last >= EVERY) {
        last = now
        bars.current.push(level)
        if (bars.current.length > n) bars.current.splice(0, bars.current.length - n)
      }
      const b = bars.current
      for (let i = 0; i < n; i++) {
        const v = b[b.length - n + i]
        const x = w - (n - i) * (BAR + GAP) + GAP
        // before any sound: a row of still dots; a sound: a bar as tall as it was loud
        const bh = v === undefined ? 2 : Math.max(2, Math.min(h, h * Math.min(1, v * 1.5)))
        // the oldest bars fade at the left edge
        g.globalAlpha = (v === undefined ? 0.25 : 1) * Math.min(1, (i + 1) / (n * 0.25))
        round(g, x, (h - bh) / 2, BAR, bh)
      }
      g.globalAlpha = 1
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [on])
  return <canvas ref={ref} className={`dwave${on ? '' : ' off'}`} aria-hidden />
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = Math.min(w, h) / 2
  g.beginPath()
  if (g.roundRect) g.roundRect(x, y, w, h, r)
  else g.rect(x, y, w, h)
  g.fill()
}
