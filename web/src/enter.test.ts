import { afterEach, expect, test } from 'bun:test'
import { enterHint, enterSends, touchOnly } from './enter.ts'

const enter = { key: 'Enter', shiftKey: false }
const shift = { key: 'Enter', shiftKey: true }

// each device: [touch-only, on-screen keyboard up while typing]
const devices = {
  'a desktop, any width': [false, false],
  'a desktop with a touchscreen': [false, false],
  'an iPad with a trackpad keyboard': [false, false],
  'an iPad with a plain hardware keyboard': [true, false],
  'an iPad on its on-screen keyboard': [true, true],
  'a phone': [true, true],
} as const

test('Enter sends on a desktop, a narrow window or a tablet with a keyboard; a new line on a phone', () => {
  const sends = Object.fromEntries(Object.entries(devices).map(([d, [touch, up]]) => [d, enterSends(enter, touch, up)]))
  expect(sends).toEqual({
    'a desktop, any width': true,
    'a desktop with a touchscreen': true,
    'an iPad with a trackpad keyboard': true,
    'an iPad with a plain hardware keyboard': true,
    'an iPad on its on-screen keyboard': false,
    'a phone': false,
  })
})

test('Shift+Enter never sends, anywhere', () => {
  for (const [touch, up] of Object.values(devices)) expect(enterSends(shift, touch, up)).toBe(false)
})

test('Ctrl/Cmd+Enter sends on a desktop (the box holds it until the agent is free)', () => {
  expect(enterSends({ ...enter, ctrlKey: true } as typeof enter, false, false)).toBe(true)
})

test('an IME composing a word keeps its Enter', () => {
  expect(enterSends({ ...enter, isComposing: true }, false, false)).toBe(false)
  // Safari's keydown that ends a composition
  expect(enterSends({ ...enter, keyCode: 229 }, false, false)).toBe(false)
})

test('other keys never send', () => {
  expect(enterSends({ key: 'a', shiftKey: false }, false, false)).toBe(false)
  expect(enterSends({ key: 'Escape', shiftKey: false }, false, false)).toBe(false)
})

const real = globalThis.matchMedia
afterEach(() => { globalThis.matchMedia = real })
const pointers = (fine: boolean, coarse: boolean) => {
  globalThis.matchMedia = ((q: string) => ({ matches: q.includes('fine') ? fine : q.includes('coarse') ? coarse : false })) as unknown as typeof matchMedia
}

test('touch-only is no mouse or trackpad at all, never the width', () => {
  pointers(true, false) // a desktop
  expect(touchOnly()).toBe(false)
  pointers(true, true) // a touchscreen laptop, an iPad with a trackpad
  expect(touchOnly()).toBe(false)
  pointers(false, true) // a phone
  expect(touchOnly()).toBe(true)
})

test("a phone's return key reads as a new line; elsewhere Send", () => {
  pointers(false, true)
  expect(enterHint()).toBe('enter')
  pointers(true, true)
  expect(enterHint()).toBe('send')
})
