import { afterEach, beforeEach, expect, test } from 'bun:test'
import { dismiss, hold, lasts, MAX, reset, toast, toasts } from './toasts.ts'

// Toasts stay long enough to read, wait while hovered, focused or in a background tab, and stack.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
beforeEach(reset)
afterEach(reset)

test('a short confirmation stays a few seconds; words and errors make it longer', () => {
  expect(lasts('Copied', 'ok')).toBe(3000)
  expect(lasts('Copied')).toBeGreaterThanOrEqual(4000)
  const long = 'Voice could not start because the microphone is in use by another app on this computer right now.'
  expect(lasts(long, 'info')).toBeGreaterThan(lasts('Saved', 'info'))
  expect(lasts(long, 'error')).toBeGreaterThan(lasts(long, 'info'))
  expect(lasts('Oops', 'error')).toBeGreaterThanOrEqual(7000)
  // an asked-for time is the least it stays
  expect(lasts('Hi', 'ok', 10_000)).toBe(10_000)
  // never forever by its words alone
  expect(lasts('word '.repeat(500), 'error')).toBe(30_000)
})

test('several stack, the oldest gives way past the most, the same words take the old one\'s place', () => {
  toast('a')
  toast('b')
  toast('a')
  expect(toasts().map((t) => t.text)).toEqual(['b', 'a'])
  for (let i = 0; i < MAX + 2; i++) toast(`n${i}`)
  expect(toasts()).toHaveLength(MAX)
  expect(toasts().at(-1)?.text).toBe(`n${MAX + 1}`)
})

test('closed by its button, or by its time', async () => {
  const id = toast('x', { busy: true, ms: 30 })
  toast('y', { sticky: true })
  dismiss(toast('z'))
  expect(toasts().map((t) => t.text)).toEqual(['x', 'y'])
  await wait(60)
  expect(toasts().map((t) => t.text)).toEqual(['y'])
  expect(toasts().some((t) => t.id === id)).toBe(false)
})

test('hovered, focused or in the background: its time waits, then goes on from where it was', async () => {
  toast('x', { busy: true, ms: 80 })
  await wait(40)
  hold('hover', true)
  hold('hidden', true)
  await wait(100)
  expect(toasts()).toHaveLength(1)
  hold('hover', false)
  await wait(100)
  expect(toasts()).toHaveLength(1) // still in the background
  hold('hidden', false)
  await wait(20)
  expect(toasts()).toHaveLength(1) // about 40 ms were left, not a fresh 80
  await wait(60)
  expect(toasts()).toHaveLength(0)
})

test('a new toast while hovered waits too', async () => {
  hold('focus', true)
  toast('x', { busy: true, ms: 20 })
  await wait(50)
  expect(toasts()).toHaveLength(1)
  hold('focus', false)
  await wait(50)
  expect(toasts()).toHaveLength(0)
})
