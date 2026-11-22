// The mic in a message box (and in Feedback): dictation only. Tap to talk, tap again when done: the words land in the
// box. A voice call is the other thing (the wave button). While it records the mic is a red pill with the time and how
// loud you are (SHEP-307: a barely darker button left people unsure it was on); every way it fails says why.
import { useEffect, useRef, useState } from 'react'
import { canDictate, clock, dictate, dictSample, SAY, type Dictation, type Phase } from './dictation.ts'
import { has, notice } from './kernel.ts'
import { I, IB } from './ui.tsx'
import './dictate.css'

const BARS = 4

export function DictateButton({ write }: { write: (text: string) => void }) {
  const [phase, setPhase] = useState<Phase | null>(null)
  const [since, setSince] = useState(0)
  const [, tick] = useState(0)
  const levels = useRef<number[]>(Array(BARS).fill(0))
  const live = useRef<Dictation | null>(null)
  useEffect(() => () => live.current?.cancel(), [])
  // the time and the level move while it records
  useEffect(() => {
    if (phase !== 'on') return
    const t = setInterval(() => {
      levels.current = [...levels.current.slice(1), dictSample().level]
      tick((n) => n + 1)
    }, 100)
    return () => clearInterval(t)
  }, [phase])
  // the browser's microphone question still open: say what it waits for
  useEffect(() => {
    if (phase !== 'asking') return
    const t = setTimeout(() => notice(SAY.asking), 1200)
    return () => clearTimeout(t)
  }, [phase])
  if (!has('voice')) return null
  const stop = () => {
    live.current = null
    setPhase(null)
  }
  const toggle = () => {
    if (live.current) {
      live.current.finish()
      return
    }
    if (!canDictate()) return notice('This browser has no microphone to dictate with.')
    levels.current = Array(BARS).fill(0)
    live.current = dictate(
      (text) => {
        stop()
        if (text) write(text)
      },
      (why) => {
        stop()
        notice(why)
      },
      undefined,
      (p) => {
        if (p === 'on') setSince(Date.now())
        setPhase(p)
      },
    )
  }
  if (!phase) return <IB icon="mic" label="Dictate" pressed={false} onClick={toggle} />
  const label = phase === 'asking' ? 'Waiting for the microphone, tap to stop' : phase === 'on' ? 'Done dictating' : 'Writing it down'
  return (
    <button type="button" className={`ib dict${phase === 'asking' ? ' ask' : phase === 'writing' ? ' wr' : ''}`} aria-label={label} aria-pressed onClick={toggle}>
      {phase === 'asking' ? (
        <>
          <I n="mic" />
          <span>Allow mic</span>
        </>
      ) : (
        <>
          <span className="dot" />
          <span>{phase === 'writing' ? 'Writing' : clock(Date.now() - since)}</span>
          {phase === 'on' && (
            <span className="lv" aria-hidden>
              {levels.current.map((l, i) => (
                <i key={i} style={{ height: `${3 + Math.round(13 * Math.min(1, l * 1.6))}px` }} />
              ))}
            </span>
          )}
        </>
      )}
    </button>
  )
}
