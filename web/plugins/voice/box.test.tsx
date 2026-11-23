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
  const go = chat.slice(chat.indexOf('const go = '), chat.indexOf('const pasteNow'))
  expect(go).toContain('const t = text.trim()')
  expect(go).not.toContain('sug?.text')
  expect(chat).toContain('const filled = !!text.trim() || !!files?.length')
})

test("the Tab chip fills the box without focusing it (no phone keyboard); the Tab key keeps the box's focus", () => {
  const chip = chat.match(/<button type="button" className="kbd".*?\}>\n\s*(.*?)\n\s*<\/button>/s)!
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
