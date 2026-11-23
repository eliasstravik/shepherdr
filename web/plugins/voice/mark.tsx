// SHEP-326: a voice call's parts on screen, with no words anywhere: a live wave of whoever is talking (the agent in
// blue, you in the text colour; still dots that breathe while it connects), Mute and End call. A screen reader hears
// their names (aria-label), which are never shown. Kept apart from the call's audio so it can be checked on its own.
import type { Sample } from '@client/meter.ts'
import { cx, I } from '@client/ui.tsx'
import { Wave } from '@client/wave.tsx'
import type { CallPhase } from './call.ts'

/** what a screen reader hears of the call (never shown) */
const SAID: Record<CallPhase, string> = { connecting: 'connecting', reconnecting: 'reconnecting', listening: 'listening', thinking: 'working', working: 'working', speaking: 'speaking' }
/** the agent's voice in blue, yours in the text colour */
const tint = (s: Sample) => (s.who === 'agent' ? '--blue' : null)

export function CallMarkView({ phone, phase, muted, sample }: { phone: boolean; phase: CallPhase; muted: boolean; sample: () => Sample }) {
  const live = phase !== 'connecting' && phase !== 'reconnecting'
  return (
    <span className={cx('vmark', phone && 'ph', !live && 'wait')} role="img" aria-label={`Voice call, ${muted ? 'muted' : SAID[phase]}`}>
      <Wave on={live} sample={sample} className="vwave" tint={tint} />
    </span>
  )
}

/** Mute (shown pressed, with a struck-through mic, when muted) and End call (red) */
export function CallButtonsView({ phone, muted, onMute, onEnd }: { phone: boolean; muted: boolean; onMute: () => void; onEnd: () => void }) {
  const c = phone ? 'vbtn' : 'ib'
  const z = phone ? 's22' : ''
  return (
    <>
      <button type="button" className={c} aria-pressed={muted} aria-label={muted ? 'Unmute yourself' : 'Mute yourself'} onClick={onMute}><I n={muted ? 'micoff' : 'mic'} c={z} /></button>
      <button type="button" className={cx(c, 'end')} aria-label="End call" onClick={onEnd}><I n="end" c={z} /></button>
    </>
  )
}
