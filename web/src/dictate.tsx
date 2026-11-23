// The mic in a message box (and in Feedback): dictation only. A voice call is the other thing (the wave button).
// SHEP-334: while it listens, the composer itself is the dictation surface, the way ChatGPT's and Claude's mobile
// composers and Wispr Flow do it: its bottom row becomes Cancel (an X that drops this dictation), a wave drawn from the
// microphone's real level, and Done (a check, where Send was). No record dot, no timer, and no words while you talk:
// the box says "Listening…" and keeps what you typed. On Done, a short "Writing it down…", then the clean text lands
// at the cursor in one go. "Allow the microphone" shows only when the browser really asks (dictation.ts askWhen).
// Every way it fails says why, there. Escape cancels; leaving the chat cancels.
import { useEffect, useRef, useState } from 'react'
import { canDictate, dictate, dictSample, SAY, type Dictation } from './dictation.ts'
import { IDLE, insertAt, step, type DictEvent, type DictState } from './dictstate.ts'
import { getState, has } from './kernel.ts'
import { escapeFirst } from './overlay.tsx'
import { I } from './ui.tsx'
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

/** what the box says while it is the dictation surface (when nothing was typed in it) */
const SAYS: Partial<Record<DictState['k'], string>> = { starting: 'Starting…', asking: 'Waiting for the microphone…', on: 'Listening…', writing: 'Writing it down…' }

/** setText: the box's whole new text (the words go in at its cursor, what was typed stays) */
export function DictateButton({ setText, scope }: { setText: (value: string) => void; scope?: string }) {
  const mic = useRef<HTMLButtonElement>(null)
  const surf = useRef<HTMLDivElement>(null)
  const landed = useRef<number | null>(null)
  // where the cursor was in the box when dictation started
  const at = useRef<{ start: number; end: number } | null>(null)
  const boxOf = () => (mic.current ?? surf.current)?.closest('.cbox')?.querySelector<HTMLTextAreaElement>('textarea') ?? null
  const [s, dispatch] = useDictState((text) => {
    const box = boxOf()
    const r = insertAt(box?.value ?? '', at.current, text)
    setText(r.value)
    landed.current = r.caret
  })
  const live = useRef<Dictation | null>(null)
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
    const box = boxOf()
    if (box && at.current === null) at.current = { start: box.selectionStart ?? box.value.length, end: box.selectionEnd ?? box.value.length }
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
      (p) => dispatch({ t: 'phase', p }),
      ownWords(),
    )
    live.current = d
  }
  const done = () => live.current?.finish()

  // gone (the box closed) or another chat's box: stop, write nothing
  useEffect(() => () => live.current?.cancel(), [])
  useEffect(() => () => cancel(), [scope])
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
  // the box is the surface meanwhile: it says what dictation is doing, and isn't typed into (the words go where its
  // cursor was)
  useEffect(() => {
    const box = boxOf()
    const cbox = box?.closest<HTMLElement>('.cbox')
    if (!box || !cbox) return
    if (active) cbox.dataset.dict = s.k
    else delete cbox.dataset.dict
    box.readOnly = active && s.k !== 'error'
  }, [active, s.k])
  useEffect(() => () => {
    const box = boxOf()
    const cbox = box?.closest<HTMLElement>('.cbox')
    if (cbox) delete cbox.dataset.dict
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
      <button ref={mic} type="button" className="ib" aria-label="Dictate" onClick={start}>
        <I n="mic" />
      </button>
    )

  const asking = s.k === 'asking'
  return (
    <div ref={surf} className={`dsurf ${s.k}`} role="group" aria-label="Dictation">
      {s.k === 'error' ? (
        <>
          <button type="button" className="dbtn" aria-label="Close" onClick={() => dispatch({ t: 'dismiss' })}>
            <I n="x" />
          </button>
          <p className="dsay err" role="alert">
            <I n="warn" c="s16" />
            <span>{s.why}</span>
          </p>
          <button type="button" className="dagain" data-main onClick={start}>
            <I n="mic" c="s16" />
            <span>Try again</span>
          </button>
        </>
      ) : (
        <>
          <button type="button" className="dbtn" aria-label="Cancel dictation" onClick={cancel}>
            <I n="x" />
          </button>
          {asking ? (
            <p className="dsay">
              <I n="mic" c="s16" />
              <span>{SAY.asking}</span>
            </p>
          ) : (
            <Wave on={s.k === 'on'} sample={dictSample} />
          )}
          {s.k === 'writing' ? (
            <button type="button" className="ddone wr" data-main aria-label="Writing it down" aria-disabled="true" onClick={() => undefined}>
              <i className="dspin" aria-hidden />
            </button>
          ) : (
            <button type="button" className="ddone" data-main aria-label="Done" disabled={s.k !== 'on'} onClick={done}>
              <I n="check" />
            </button>
          )}
        </>
      )}
      <span className="vh" role="status">
        {s.k === 'error' ? '' : asking ? SAY.asking : (SAYS[s.k] ?? '')}
      </span>
    </div>
  )
}
