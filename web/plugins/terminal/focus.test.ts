import { expect, test } from 'bun:test'
import { mirrorFocus } from './focus.ts'

test("the box's focus and blur reach xterm's textarea as events", () => {
  const seen: string[] = []
  const textarea = new EventTarget()
  textarea.addEventListener('focus', () => seen.push('focus'))
  textarea.addEventListener('blur', () => seen.push('blur'))
  mirrorFocus(textarea, true)
  mirrorFocus(textarea, false)
  expect(seen).toEqual(['focus', 'blur'])
  // before xterm has opened there is no textarea yet: nothing to tell
  expect(() => mirrorFocus(undefined, true)).not.toThrow()
})
