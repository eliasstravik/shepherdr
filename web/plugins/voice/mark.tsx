// SHEP-326: a voice call's parts on screen, with no words anywhere: a live wave of whoever is talking (the agent in
// blue, you in the text colour; still dots that breathe while it connects). A screen reader hears its name (aria-label),
// never shown. Its Mute and End call are the message box's own buttons (dictate.tsx SlotsView). Kept apart from the
// call's audio so it can be checked on its own.
import type { Sample } from '@client/meter.ts'
import { cx } from '@client/ui.tsx'
import { Wave } from '@client/wave.tsx'
import type { CallPhase } from './call.ts'

/** what a screen reader hears of the call (never shown) */
const SAID: Record<CallPhase, string> = { connecting: 'connecting', reconnecting: 'reconnecting', listening: 'listening', thinking: 'working', working: 'working', speaking: 'speaking' }
/** the agent's voice in blue, yours in the text colour */
const tint = (s: Sample) => (s.who === 'agent' ? '--blue' : null)

export function CallMarkView({ phase, muted, sample }: { phase: CallPhase; muted: boolean; sample: () => Sample }) {
  const live = phase !== 'connecting' && phase !== 'reconnecting'
  return (
    <span className={cx('vmark', !live && 'wait')} role="img" aria-label={`Voice call, ${muted ? 'muted' : SAID[phase]}`}>
      <Wave on={live} sample={sample} className="vwave" tint={tint} />
    </span>
  )
}
