import { expect, test } from 'bun:test'
import { keysTerm, termInPlace, termInput, touchScreen, typedInBox } from './shown.ts'

// #786: a Claude Code or Codex tab switched to Chat kept showing its terminal: the Assistant's Chat | Terminal rule
// matched it too, its chat key being its terminal
test('a tab switched to Chat shows its chat, on Terminal its terminal', () => {
  expect(termInPlace({ term: 't:vm/t6', tabView: { 't:vm/t6': 'chat' } }, 't:vm/t6')).toBe(false)
  expect(termInPlace({ term: 't:vm/t6', tabView: { 't:vm/t6': 'terminal' } }, 't:vm/t6')).toBe(true)
  expect(termInPlace({ term: 't:vm/t6' }, 't:vm/t6')).toBe(true)
})

test("the Assistant's Chat | Terminal: its terminal on Terminal, its chat on Chat", () => {
  expect(termInPlace({ term: 'c:vm:shop' }, 'c:vm:shop')).toBe(true)
  expect(termInPlace({ term: null }, 'c:vm:shop')).toBe(false)
})

// #787: typing in that tab's Chat box went into its terminal on a desktop-width screen: the keys followed ui.term
test("a tab's Chat box keeps its keys; a terminal shown takes them", () => {
  expect(keysTerm({ term: 't:t6', tabView: { 't:t6': 'chat' } })).toBe(null)
  expect(keysTerm({ term: 't:t6', tabView: { 't:t6': 'terminal' } })).toBe('t:t6')
  expect(keysTerm({ term: 't:t6' })).toBe('t:t6')
  expect(keysTerm({ term: 'c:vm:shop' })).toBe('c:vm:shop')
  expect(keysTerm({ term: null })).toBe(null)
})

// #862: a landscape iPad counts as a desktop by its width: its terminals had no typing box (no on-screen keyboard) and
// no key row
test('a touch screen gets the touch terminal at any width; a mouse-only desktop stays as it was', () => {
  expect(termInput('desktop', true, true)).toEqual({ typed: false, touch: true })
  expect(termInput('desktop', false, true)).toEqual({ typed: false, touch: true })
  expect(termInput('desktop', true, false)).toEqual({ typed: true, touch: false })
  expect(termInput('desktop', false, false)).toEqual({ typed: false, touch: false })
  expect(termInput('tablet', true, false)).toEqual({ typed: false, touch: true })
  expect(termInput('phone', false, false)).toEqual({ typed: false, touch: true })
})

test('a touch screen is any coarse pointer (an iPad with a trackpad too); none without matchMedia', () => {
  expect(touchScreen((q) => ({ matches: q === '(any-pointer: coarse)' }))).toBe(true)
  expect(touchScreen(() => ({ matches: false }))).toBe(false)
  expect(touchScreen(undefined)).toBe(false)
})

test("keys typed in the hidden typing box are the box's; Ctrl+` still goes back to the chat", () => {
  const box = { getAttribute: (n: string) => (n === 'name' ? 'terminal-input' : null) }
  const other = { getAttribute: () => 'message' }
  expect(typedInBox({ target: box, ctrlKey: false, key: 'Escape' })).toBe(true)
  expect(typedInBox({ target: box, ctrlKey: true, key: 'k' })).toBe(true)
  expect(typedInBox({ target: box, ctrlKey: true, key: '`' })).toBe(false)
  expect(typedInBox({ target: other, ctrlKey: false, key: 'Escape' })).toBe(false)
  expect(typedInBox({ target: null, ctrlKey: false, key: 'a' })).toBe(false)
})
