// The mic in a message box (and in Feedback): dictation only. A voice call is the other thing (the wave button).
// SHEP-314: while it records, the box's bottom row becomes the recording itself, the way ChatGPT's, Claude's and
// WhatsApp's composers do it: Cancel on the left, a wave drawn from the microphone's real level and the time in the
// middle, Done on the right where Send was. SHEP-334: that row is all it shows. No "Listening…" and no words while you
// talk; on Done the clean text lands at the box's cursor in one go, what was typed stays. "Allow the microphone" shows
// only when the browser really asks (dictation.ts askWhen). Every way it fails says why, there. Escape cancels;
// leaving the chat cancels.
import { useEffect, useRef, useState } from 'react'
import { canDictate, clock, dictate, dictSample, SAY, warmMic, type Dictation } from './dictation.ts'
import { IDLE, insertAt, step, type DictEvent, type DictState } from './dictstate.ts'
import { getState, has } from './kernel.ts'
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

/** the person's own words for the writing to get right: their spaces' and machines' names */
function ownWords(): string[] {
  const snap = getState().snap
  if (!snap) return []
  return [...(snap.places ?? []).map((p) => p.name), ...(snap.machines ?? []).map((m) => m.name)].filter((w): w is string => typeof w === 'string')
}

/** The box's cursor, read as the mic is pressed (before the press takes the focus): only while the box is being
 *  typed in; else null, and the words go at its end (a box restored from a draft says its cursor is at 0). */
export function cursorOf(box: HTMLTextAreaElement | null): { start: number; end: number } | null {
  if (!box || document.activeElement !== box) return null
  return { start: box.selectionStart ?? box.value.length, end: box.selectionEnd ?? box.value.length }
}

/** setText: the box's whole new text (the words go in at its cursor, what was typed stays) */
export function DictateButton({ setText, scope }: { setText: (value: string) => void; scope?: string }) {
  const mic = useRef<HTMLButtonElement>(null)
  const surf = useRef<HTMLDivElement>(null)
  const landed = useRef<number | null>(null)
  // where the cursor was in the box when dictation started (null: the box wasn't being typed in, so at its end)
  const at = useRef<{ start: number; end: number } | null>(null)
  const pressed = useRef<{ start: number; end: number } | null | undefined>(undefined)
  const boxOf = () => (mic.current ?? surf.current)?.closest('.cbox')?.querySelector<HTMLTextAreaElement>('textarea') ?? null
  const [s, dispatch] = useDictState((text) => {
    const box = boxOf()
    const r = insertAt(box?.value ?? '', at.current, text)
    setText(r.value)
    landed.current = r.caret
  })
  const live = useRef<Dictation | null>(null)
  const [, tick] = useState(0)
  const active = s.k !== 'idle'

  const cancel = () => {
    const d = live.current
    live.current = null
    d?.cancel()
    dispatch({ t: 'cancel' })
  }
  const start = () => {
    live.current?.cancel()
    landed.current = null
    // a fresh dictation: the cursor as it was when the mic was pressed; Try again keeps the first one's
    if (s.k === 'idle') at.current = pressed.current ?? null
    pressed.current = undefined
    if (!canDictate()) {
      dispatch({ t: 'start' })
      return dispatch({ t: 'fail', why: 'This browser has no microphone to dictate with.' })
    }
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
      ownWords(),
    )
    live.current = d
  }
  const done = () => live.current?.finish()

  // gone (the box closed) or another chat's box: stop, write nothing
  useEffect(() => () => live.current?.cancel(), [])
  useEffect(() => () => cancel(), [scope])
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
  // the box isn't typed into meanwhile: the words go where its cursor was, and what was typed stays as it is
  useEffect(() => {
    const box = boxOf()
    if (box) box.readOnly = active && s.k !== 'error'
  }, [active, s.k])
  useEffect(() => () => {
    const box = boxOf()
    if (box) box.readOnly = false
  }, [])
  // focus: on the surface's main button while it shows (keyboard: Enter is Done; a phone's keyboard steps aside),
  // then back where it belongs
  const was = useRef(false)
  useEffect(() => {
    if (active && !was.current) surf.current?.querySelector<HTMLButtonElement>('[data-main]')?.focus({ preventScroll: true })
    if (!active && was.current) {
      const box = boxOf()
      const caret = landed.current
      // the words landed: on a desktop, the cursor right after them to carry on; else back on the mic (no phone
      // keyboard pops up)
      if (caret !== null && box && matchMedia('(pointer: fine)').matches) {
        box.focus({ preventScroll: true })
        box.setSelectionRange(caret, caret)
      } else if (document.activeElement === document.body || !document.activeElement) mic.current?.focus({ preventScroll: true })
      at.current = null
    }
    was.current = active
  }, [active])

  if (!has('voice')) return null
  if (!active)
    return (
      <button ref={mic} type="button" className="ib" aria-label="Dictate" onPointerDown={() => { pressed.current = cursorOf(boxOf()); warmMic() }} onClick={start}>
        <I n="mic" />
      </button>
    )

  return (
    <div ref={surf} className={`dsurf ${s.k}`} role="group" aria-label="Dictation">
      {/* only words that need reading: why it didn't work, or the browser really asking for the microphone */}
      {(s.k === 'error' || s.k === 'asking') && (
        <div className="dwords">
          {s.k === 'error' ? (
            <p className="derr" role="alert">
              <I n="warn" c="s16" />
              <span>{s.why}</span>
            </p>
          ) : (
            <p className="dhint">{SAY.asking}</p>
          )}
        </div>
      )}
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
        {s.k === 'asking' ? SAY.asking : s.k === 'on' ? 'Recording' : s.k === 'writing' ? 'Writing it down' : ''}
      </span>
    </div>
  )
}
