import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { canStartCall, canStartDictation, dictating, isDictating, SlotsView, TEXT_IN_CALL, type Slots } from '@client/dictate.tsx'
import { registry, setUI } from '@client/kernel.ts'

// SHEP-363: the message box ends with two buttons, the same size and place in every state, icons only: the mic, and
// the round button where Send is. Box empty: the round one is the voice call; words or files in it: Send. In a call:
// Mute / Unmute yourself and End call. Dictating: Done (a green check, a spinner while writing) and Cancel (a red X).

// the plugins' own code, read (importing the voice plugin loads the call's audio, which call.test.ts fakes first)
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const voice = read('./client.tsx')
const chat = read('../chat/client.tsx')
const app = read('../../src/App.tsx')

const noop = () => {}
const on = { mic: noop, second: noop }
/** the buttons as drawn: slot, class, aria-label, the words shown */
function buttons(at: Slots, round = true) {
  const html = renderToStaticMarkup(<SlotsView at={at} round={round} on={on} />)
  return [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*data-slot="(\w+)"[^>]*aria-label="([^"]*)"[^>]*>(.*?)<\/button>/g)].map((m) => ({
    slot: m[2],
    cls: m[1],
    label: m[3],
    words: m[4].replace(/<[^>]*>/g, '').trim(),
    html: m[0],
  }))
}
const pairs = (at: Slots) => buttons(at).map((x) => [x.slot, x.label])

afterEach(() => {
  setUI({ call: false, callMuted: false })
  while (isDictating()) dictating(false)
})

test('idle: the mic, then the round button: the voice call while the box is empty, Send once it has something', () => {
  expect(pairs({ k: 'idle', filled: false })).toEqual([['mic', 'Dictate'], ['main', 'Talk to Shepherdr']])
  expect(pairs({ k: 'idle', filled: true })).toEqual([['mic', 'Dictate'], ['main', 'Send']])
  // same button, same size: only its icon changes, fading in
  for (const filled of [false, true]) {
    const b = buttons({ k: 'idle', filled })
    expect(b[1].cls).toBe('send vs')
    expect(b[1].html).toContain('class="vsi"')
  }
})

test('dictating: the mic is Done (a green check), the round button is Cancel (a red X), icons only, same places', () => {
  for (const d of ['starting', 'asking', 'on'] as const) {
    const b = buttons({ k: 'dict', d })
    expect(b.map((x) => [x.slot, x.label])).toEqual([['mic', 'Done, write it down'], ['main', 'Cancel dictation']])
    expect(b[0].cls).toBe('ib vs ok')
    expect(b[1].cls).toBe('send vs end')
    expect(b.every((x) => x.words === '' && x.html.includes('<svg'))).toBe(true)
    // Done waits for the recording to be on
    expect(b[0].html.includes('aria-disabled="true"')).toBe(d !== 'on')
  }
  const w = buttons({ k: 'dict', d: 'writing' })
  expect(w[0].label).toBe('Writing it down')
  expect(w[0].html).toContain('dspin')
  expect(w[0].words).toBe('')
  expect(buttons({ k: 'dict', d: 'error' }).map((x) => x.label)).toEqual(['Try again', 'Close'])
})

test('in a call: Mute or Unmute yourself (shown pressed when muted), and End call (red) where Send is', () => {
  const b = buttons({ k: 'call', muted: false })
  expect(b.map((x) => [x.slot, x.label])).toEqual([['mic', 'Mute yourself'], ['main', 'End call']])
  expect(b[0].html).toContain('aria-pressed="false"')
  expect(b[1].cls).toBe('send vs end')
  const m = buttons({ k: 'call', muted: true })
  expect(m[0].label).toBe('Unmute yourself')
  expect(m[0].html).toContain('aria-pressed="true"')
})

test("Feedback's box (its own Send) shows only the mic when idle, and Cancel beside it while dictating", () => {
  expect(buttons({ k: 'idle', filled: true }, false).map((x) => x.label)).toEqual(['Dictate'])
  expect(buttons({ k: 'dict', d: 'on' }, false).map((x) => x.label)).toEqual(['Done, write it down', 'Cancel dictation'])
})

test("a call can't start while dictating", () => {
  expect(canStartCall()).toBe(true)
  dictating(true)
  expect(canStartCall()).toBe(false)
  dictating(false)
  expect(canStartCall()).toBe(true)
  // starting a call asks first, before anything else is set
  const start = voice.slice(voice.indexOf('export function toggleCall'))
  expect(start.indexOf('if (!canStartCall()) return')).toBeGreaterThan(0)
  expect(start.indexOf('if (!canStartCall()) return')).toBeLessThan(start.indexOf('setUI({ call: true'))
})

test("dictation can't start during a call", () => {
  expect(canStartDictation()).toBe(true)
  setUI({ call: true })
  expect(canStartDictation()).toBe(false)
})

test('in a call the box takes no text: nothing is sent, and it goes read-only', () => {
  expect(TEXT_IN_CALL).toBe(false)
  expect(chat).toContain('if (getState().ui.call && !TEXT_IN_CALL) return')
  expect(voice).toMatch(/box\.readOnly = quiet/)
})

test('a suggested reply is never sent as it is: the round button and Enter send only what is in the box', () => {
  const go = chat.slice(chat.indexOf('const go = '), chat.indexOf('const useSug = '))
  expect(go).toContain('const t = text.trim()')
  expect(go).not.toContain('sug?.text')
  expect(chat).toContain('const filled = !!text.trim() || !!files?.length')
})

test("the Tab chip fills the box without focusing it (no phone keyboard); the Tab key keeps the box's focus", () => {
  const chip = chat.match(/<button type="button" className="ib kbd".*?\}>\n\s*(.*?)\n\s*<\/button>/s)!
  expect(chip[0]).toContain('aria-label="Use suggestion"')
  expect(chip[0]).toContain('onPointerDown={keepFocus}')
  expect(chip[0]).toContain('onMouseDown={keepFocus}')
  expect(chip[0]).toContain('onClick={() => useSug()}')
  // the tab icon at every width, no "Tab" word
  expect(chip[1]).toBe('<I n="tab" c="s16" />')
  const use = chat.slice(chat.indexOf('const useSug = '), chat.indexOf('const filled'))
  expect(use).toContain('if (key) ref.current?.focus()')
  expect(chat).toContain('return useSug(true)')
  // a tap that takes no focus: the default of a pointer down is what moves the focus
  expect(chat).toContain('export const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault()')
})

test('the voice call button is gone from the header and the phone bottom bar; it is the box\'s round button', () => {
  expect(voice).not.toMatch(/reg\.(header|bar|barEnd|barAbove)\b/)
  expect(voice).toContain('reg.views.boxEnd = BoxEnd')
  expect('barEnd' in registry || 'barAbove' in registry).toBe(false)
  expect(app).not.toMatch(/barEnd|barAbove|Talk to Shepherdr/)
})

test("the Tab chip is one of the box's icon buttons: centred over the round button and on the text line", () => {
  const css = read('../../src/ds.css')
  const kbd = css.match(/\.crow>\.kbd\{([^}]*)\}/)![1]
  // the icon-button size and radius (.ib), no outline of its own
  expect(chat).toContain('className="ib kbd"')
  expect(css).not.toMatch(/\.kbd\{[^}]*(width|height|box-shadow|border)/)
  // the same right inset as the round button (the bar's 6px padding plus half the size difference): one centre line
  expect(css).toMatch(/\.cbar\{[^}]*padding:0 6px 6px/)
  expect(kbd).toContain('margin-right:calc(6px + (var(--send) - var(--ib))/2)')
  // centred on the first text line: the textarea's 10px top padding plus half its 24px line
  expect(css).toMatch(/textarea\.cin\{[^}]*padding:10px 16px/)
  expect(css).toMatch(/\.cin\{[^}]*line-height:24px/)
  expect(kbd).toContain('align-self:flex-start')
  expect(kbd).toContain('margin-top:calc(22px - var(--ib)/2)')
  // a long suggestion truncates before the chip
  expect(css).toContain('.crow .cin{flex:1;min-width:0;text-overflow:ellipsis}')
})

// 3.2.3's broken dictation: the row ran out of the box, the wave read nothing, Done and Cancel were loud filled discs
// that sat lower than the idle buttons. web/demo/dict-check.ts checks all of it in a real Chrome; these keep the causes.
const allCss = read('../../src/dictate.css') + read('../../src/ds.css')
const wave = read('../../src/wave.tsx')
const dictation = read('../../src/dictation.ts')

test("the wave's canvas fills its box and never sizes it (its pixel count once widened the row past the box)", () => {
  expect(wave).toMatch(/<span className=\{`wv \$\{className\}/)
  expect(allCss).toContain('.wv>canvas{position:absolute;inset:0;display:block;width:100%;height:100%}')
  // the recording's row: one column that can shrink to nothing, clipped to the box
  expect(allCss).toMatch(/\.dsurf\{[^}]*grid-template-columns:minmax\(0,1fr\)[^}]*overflow:hidden/)
})

test("Done and Cancel / End call are the idle buttons' size and place, in the app's own green and red, quiet", () => {
  // nothing changes their size; only an error's longer row sets them at its foot
  expect(allCss).not.toMatch(/\.cbar:has\(>\.dsurf\)\{align-items/)
  expect(allCss).not.toMatch(/\.(ib|send)[^{]*\.(ok|end)[^{]*\{[^}]*(width|height|padding)/)
  // the app's tokens, never a hard-coded colour or a white icon on a filled disc
  const ok = allCss.match(/\.ib\.vs\.ok,[^{]*\{([^}]*)\}/)![1]!
  const end = allCss.match(/\.send\.vs\.end,[^{]*\{([^}]*)\}/)![1]!
  expect(ok).toContain('color:var(--green)')
  expect(end).toContain('color:var(--red)')
  for (const r of [ok, end]) expect(r).not.toMatch(/#[0-9a-f]{3,6}|#fff/i)
})

test("the call's wave fills the row up to the mic", () => {
  expect(allCss).not.toMatch(/\.vmark\{[^}]*max-width/)
  expect(allCss).toMatch(/\.vmark\{[^}]*flex:1 1 0/)
})

test("the microphone's level reaches the wave whatever the live words do", () => {
  const on = dictation.slice(dictation.indexOf('level = meter(c)'))
  // the meter leads out to the speakers, silent, so the graph pulls it on every browser
  expect(on.indexOf('level.connect(hush).connect(c.destination)')).toBeGreaterThan(0)
  // the audio is made to run even when the live words' module fails or never loads
  expect(on).toMatch(/Promise\.race\(\[loaded\.then/)
  expect(on.slice(on.indexOf('} catch {'))).toMatch(/^\} catch \{[^]*?void running\(c\)/)
})
