// SHEP-311: on Android the page shrinks for the keyboard itself, so the app's height comes from CSS (100dvh) in the same
// frame, with no script in between; only where the page keeps its height under the keyboard (iOS) does it take the
// visible height.
import { expect, test } from 'bun:test'
import { appHeight, keyboardWatch } from './viewport.ts'

test('Android, keyboard down or up: the page is as tall as what shows, so CSS sizes the app', () => {
  expect(appHeight(915, 915)).toBeNull()
  // the window shrank with the keyboard (interactive-widget=resizes-content)
  expect(appHeight(585, 585)).toBeNull()
  // a fraction of a pixel apart is the same height
  expect(appHeight(584.5, 585)).toBeNull()
})

test('iOS, keyboard up: the page keeps its height, the app takes the visible part', () => {
  expect(appHeight(420, 844)).toBe('420px')
  expect(appHeight(420.5, 844)).toBe('420.5px')
})

test('the keyboard is up when the visible height drops by more than a browser bar', () => {
  const up = keyboardWatch()
  expect(up(412, 915)).toBe(false)
  expect(up(412, 860)).toBe(false)
  expect(up(412, 585)).toBe(true)
  expect(up(412, 915)).toBe(false)
})
