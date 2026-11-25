import { expect, test } from 'bun:test'
import { focusAfterKey } from './keyrow.ts'

test("a tap on the key row never focuses the terminal's box, so the phone's keyboard stays as it was", () => {
  expect(focusAfterKey('touch')).toBe(false)
  expect(focusAfterKey('pen')).toBe(false)
  // a mouse click, or Enter on the button: the box takes the keys, as before
  expect(focusAfterKey('mouse')).toBe(true)
  expect(focusAfterKey('')).toBe(true)
})
