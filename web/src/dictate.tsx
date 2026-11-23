// The mic in a message box (and in Feedback): dictation only. A voice call is the other thing (the wave button).
// SHEP-314: while it records, the box's bottom row becomes the recording itself, the way ChatGPT's, Claude's and
// WhatsApp's composers do it: Cancel on the left, a wave drawn from the microphone's real level and the time in the
// middle, Done on the right where Send was. The words show above it as they are heard, the way Apple's dictation and
// Wispr Flow write them, then "Writing it down" until they land in the box.
// Every way it fails says why, there. Escape cancels; leaving the chat cancels.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { canDictate, clock, dictate, dictSample, SAY, type Dictation, type Heard } from './dictation.ts'
import { IDLE, NOTHING, shownWords, step, type DictEvent, type DictState } from './dictstate.ts'
import { has } from './kernel.ts'
import { escapeFirst } from './overlay.tsx'
import { I, IB } from './ui.tsx'
import { Wave } from './wave.tsx'
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
  // Escape cancels (or closes the error), before anything else on the page hears it (a dialog it's in stays open)
  useEffect(() => {
    if (!active) return
    const take = () => {
      if (s.k === 'error') dispatch({ t: 'dismiss' })
      else cancel()
      return true
    }
    escapeFirst.add(take)
    return () => void escapeFirst.delete(take)
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
            {shown.partial}
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
            <Wave on={s.k === 'on'} sample={dictSample} />
            <span className="dtime" aria-hidden>
              <i className={`ddot${s.k === 'on' ? ' rec' : ''}`} />
              {s.k === 'on' ? clock(Date.now() - s.since) : s.k === 'writing' ? clock(s.took) : '0:00'}
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
