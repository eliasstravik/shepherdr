import { expect, test } from 'bun:test'
import { isEcho } from './echo.ts'

const sent = { text: 'please fix the login page', at: 1000 }

test('the sent words coming back into the empty box are dropped', () => {
  expect(isEcho(sent, '', 'please fix the login page', 1500)).toBe(true)
  expect(isEcho(sent, '', 'page', 1500)).toBe(true)
  expect(isEcho(sent, '', 'login page ', 1500)).toBe(true)
})

test('new typing is kept', () => {
  expect(isEcho(sent, '', 'o', 1500)).toBe(false)
  expect(isEcho(sent, '', 'e', 1500)).toBe(false)
  expect(isEcho(sent, 'pa', 'pag', 1500)).toBe(false)
  expect(isEcho(sent, '', 'page', 4000)).toBe(false)
  expect(isEcho(null, '', 'page', 1500)).toBe(false)
})
