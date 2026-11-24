// The mic in a message box (and in Feedback): dictation. SHEP-314/SHEP-334: while it records, the box's bottom row
// becomes the recording: a wave drawn from the microphone's real level and the time, no words while you talk; on Done
// the clean text lands at the box's cursor in one go, what was typed stays. "Allow the microphone" shows only when the
// browser really asks (dictation.ts askWhen); until the microphone really hears, a quiet dot and no wave (the wave
// is the signal to start talking: dictation.ts sounds). Every way it fails says why, there. Escape cancels; leaving the chat
// cancels. SHEP-363: no buttons of its own: the mic itself becomes Done (a green check) and the voice call's button
// beside it becomes Cancel (a red X), so nothing moves under the thumb; a call and a dictation never run at once.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { canDictate, clock, dictate, dictSample, SAY, warmMic, type Dictation } from './dictation.ts'
import { IDLE, insertAt, step, type DictEvent, type DictState } from './dictstate.ts'
import { getState, has, holdReload, useUI } from './kernel.ts'
import { escapeFirst } from './overlay.tsx'
import { cx, I } from './ui.tsx'
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

/** dictations running now, on any box: a voice call can't start while one is on (SHEP-363) */
let running = 0
const seen = new Set<() => void>()
/** one dictation starts (true) or ends (false) */
export function dictating(on: boolean) {
  running = Math.max(0, running + (on ? 1 : -1))
  seen.forEach((f) => f())
}
export const isDictating = () => running > 0
/** a dictation has the microphone: no voice call starts during one */
export const canStartCall = () => !isDictating()
/** a voice call has the microphone: no dictation starts during one */
export const canStartDictation = () => !getState().ui.call
export const useDictating = () => useSyncExternalStore((f) => (seen.add(f), () => void seen.delete(f)), isDictating, isDictating)

/** the boxes (their chat keys) whose words came from dictation since their last send: personal analytics' "dictated" */
export const dictatedInto = new Set<string>()

/** One dictation into a box (setText: the box's whole new text; the words go in at its cursor, what was typed stays).
 *  anchor: an element inside the box (.cbox), to find its text. Escape cancels; leaving the chat cancels; it can't
 *  start during a voice call. */
export function useDictation(setText: (value: string) => void, scope: string | undefined, anchor: () => Element | null) {
  const landed = useRef<number | null>(null)
  // where the cursor was in the box when dictation started (null: the box wasn't being typed in, so at its end)
  const at = useRef<{ start: number; end: number } | null>(null)
  const pressed = useRef<{ start: number; end: number } | null | undefined>(undefined)
  const boxOf = () => anchor()?.closest('.cbox')?.querySelector<HTMLTextAreaElement>('textarea') ?? null
  const [s, dispatch] = useDictState((text) => {
    const box = boxOf()
    const r = insertAt(box?.value ?? '', at.current, text)
    setText(r.value)
    if (scope) dictatedInto.add(scope)
    landed.current = r.caret
  })
  const live = useRef<Dictation | null>(null)
  const [, tick] = useState(0)
  const active = s.k !== 'idle'
  // dictating: a newer web app waits (SHEP-337); a call can't start
  useEffect(() => (active ? holdReload() : undefined), [active])
  useEffect(() => {
    if (!active) return
    dictating(true)
    return () => dictating(false)
  }, [active])

  const cancel = () => {
    const d = live.current
    live.current = null
    d?.cancel()
    dispatch({ t: 'cancel' })
  }
  const start = () => {
    if (!canStartDictation()) return
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
  const dismiss = () => dispatch({ t: 'dismiss' })
  /** the mic is being pressed: keep the box's cursor (before the press takes the focus) and wake the microphone */
  const press = () => {
    pressed.current = cursorOf(boxOf())
    warmMic()
  }

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
  // the words landed: on a desktop, the cursor right after them to carry on
  const was = useRef(false)
  useEffect(() => {
    if (!active && was.current) {
      const box = boxOf()
      const caret = landed.current
      if (caret !== null && box && matchMedia('(pointer: fine)').matches) {
        box.focus({ preventScroll: true })
        box.setSelectionRange(caret, caret)
      }
      at.current = null
    }
    was.current = active
  }, [active])
  return { s, start, done, cancel, dismiss, press }
}

/** the recording's own part of the row: the wave and the time, or (only when something must be read) why it didn't
 *  work, or the browser really asking for the microphone. No words while you talk (SHEP-334). */
export function DictRow({ s }: { s: DictState }) {
  return (
    <div className={`dsurf ${s.k}`} role="group" aria-label="Dictation">
      {s.k === 'error' || s.k === 'asking' ? (
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
      ) : s.k === 'starting' ? (
        // getting ready: the microphone isn't really hearing yet, so no wave (the wave is the signal to start
        // talking, and anything said before it would be lost): one quiet dot breathing until the first real sound
        <div className="dctl dready">
          <i className="ddot" />
        </div>
      ) : (
        <div className="dctl">
          <Wave on={s.k === 'on'} sample={dictSample} />
          <span className="dtime" aria-hidden>
            <i className={`ddot${s.k === 'on' ? ' rec' : ''}`} />
            {s.k === 'on' ? clock(Date.now() - s.since) : s.k === 'writing' ? clock(s.took) : '0:00'}
          </span>
        </div>
      )}
      <span className="vh" role="status">
        {s.k === 'asking' ? SAY.asking : s.k === 'starting' ? 'Getting ready' : s.k === 'on' ? 'Recording' : s.k === 'writing' ? 'Writing it down' : ''}
      </span>
    </div>
  )
}

/** In a voice call the box takes no text (the person's call, SHEP-363): it goes quiet, the draft kept for after.
 *  true lets you type and send by Enter during a call. */
export const TEXT_IN_CALL = false

/** The box's two buttons at its right end, the same size and place in every state, icons only (SHEP-363): the mic, and
 *  the round button where Send is. Idle: Dictate, and Talk to Shepherdr while the box is empty (a suggested reply
 *  doesn't count), Send once it has words or files. Dictating: the mic is Done (a green check; a spinner while the
 *  words are written), the round one Cancel (a red X); after a failure, Try again and Close. In a call: Mute or Unmute
 *  yourself, and End call (red). round: false is Feedback's box, which has its own Send: its second button shows only
 *  while dictating, as Cancel. */
export type Slots = { k: 'idle'; filled: boolean } | { k: 'dict'; d: DictState['k'] } | { k: 'call'; muted: boolean }
export function SlotsView({ at, round, on }: { at: Slots; round: boolean; on: { mic: () => void; press?: () => void; second: () => void } }) {
  const a =
    at.k === 'idle'
      ? { icon: 'mic' as const, label: 'Dictate', c: '' }
      : at.k === 'call'
        ? { icon: at.muted ? ('micoff' as const) : ('mic' as const), label: at.muted ? 'Unmute yourself' : 'Mute yourself', c: '', pressed: at.muted }
        : at.d === 'error'
          ? { icon: 'mic' as const, label: 'Try again', c: '' }
          : at.d === 'writing'
            ? { icon: null, label: 'Writing it down', c: 'ok wr', off: true }
            : { icon: 'check' as const, label: 'Done, write it down', c: 'ok', off: at.d !== 'on' }
  const b =
    at.k === 'idle'
      ? at.filled
        ? { icon: 'send' as const, label: 'Send', c: '' }
        : { icon: 'wave' as const, label: 'Talk to Shepherdr', c: '' }
      : at.k === 'call'
        ? { icon: 'end' as const, label: 'End call', c: 'end' }
        : at.d === 'error'
          ? { icon: 'x' as const, label: 'Close', c: '' }
          : { icon: 'x' as const, label: 'Cancel dictation', c: 'end' }
  const off = 'off' in a && a.off
  return (
    <>
      <button type="button" className={cx('ib vs', a.c)} data-slot="mic" aria-label={a.label} aria-pressed={'pressed' in a ? a.pressed : undefined} aria-disabled={off || undefined} onPointerDown={at.k === 'idle' ? on.press : undefined} onClick={() => !off && on.mic()}>
        {a.icon ? <I n={a.icon} /> : <i className="dspin" aria-hidden />}
      </button>
      {round ? (
        <button type="button" className={cx('send vs', b.c)} data-slot="main" aria-label={b.label} onClick={on.second}>
          {/* keyed: a new icon fades in, the button keeps its size */}
          <span key={b.icon} className="vsi">
            <I n={b.icon} c={round ? 's16' : undefined} />
          </span>
        </button>
      ) : (
        at.k !== 'idle' && (
          <button type="button" className={cx('ib vs', b.c)} data-slot="second" aria-label={b.label} onClick={on.second}>
            <I n={b.icon} />
          </button>
        )
      )}
    </>
  )
}

/** Feedback's box: the mic, and while it records the same two places as a chat's box, the call's place for Cancel */
export function DictateButton({ setText, scope }: { setText: (value: string) => void; scope?: string }) {
  const el = useRef<HTMLSpanElement>(null)
  const d = useDictation(setText, scope, () => el.current)
  const call = useUI((u) => u.call)
  if (!has('voice') || call) return null
  const { s } = d
  return (
    <>
      <span ref={el} hidden />
      {s.k !== 'idle' && <DictRow s={s} />}
      <SlotsView at={s.k === 'idle' ? { k: 'idle', filled: false } : { k: 'dict', d: s.k }} round={false} on={{ mic: s.k === 'idle' || s.k === 'error' ? d.start : d.done, press: d.press, second: s.k === 'error' ? d.dismiss : d.cancel }} />
    </>
  )
}
