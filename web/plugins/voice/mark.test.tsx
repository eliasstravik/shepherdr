import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CallPhase } from './call.ts'
import { CallButtonsView, CallMarkView } from './mark.tsx'

// SHEP-326: a voice call shows no words anywhere: no Listening… or Speaking…, no captions of either side. Its state is
// the live wave and the Mute and End call buttons; a screen reader still hears their names (aria-label, never shown).

/** the words a page would show: everything between tags, none of the attributes */
const shown = (html: string) => html.replace(/<[^>]*>/g, '').trim()
const PHASES: CallPhase[] = ['connecting', 'listening', 'thinking', 'working', 'speaking', 'reconnecting']
const quiet = () => ({ level: 0, who: null })
const noop = () => {}

test('the call shows no words in any state, on a phone or a desktop, muted or not', () => {
  for (const phase of PHASES)
    for (const muted of [false, true])
      for (const phone of [false, true]) {
        const html = renderToStaticMarkup(
          <>
            <CallMarkView phone={phone} phase={phase} muted={muted} sample={quiet} />
            <CallButtonsView phone={phone} muted={muted} onMute={noop} onEnd={noop} />
          </>,
        )
        expect(shown(html)).toBe('')
        expect(html).not.toContain('role="status"')
        expect(html).toContain('<canvas')
        // the names are for screen readers only
        expect(html).toContain(`aria-label="Voice call, ${muted ? 'muted' : phase === 'thinking' ? 'working' : phase}"`)
        expect(html).toContain('aria-label="End call"')
        expect(html).toContain(muted ? 'aria-label="Unmute yourself"' : 'aria-label="Mute yourself"')
      }
})

test('while it connects the wave is still dots that breathe; once live it draws the sound', () => {
  expect(renderToStaticMarkup(<CallMarkView phone={false} phase="connecting" muted={false} sample={quiet} />)).toContain('vmark wait')
  const live = renderToStaticMarkup(<CallMarkView phone phase="speaking" muted={false} sample={quiet} />)
  expect(live).toContain('class="vmark ph"')
  expect(live).toContain('class="vwave"')
})
