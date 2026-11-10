import { expect, test } from 'bun:test'
import { setDown } from './leave.ts'

// #788: Fork or Rewind from a held message's menu faded the overlay out but left it up, invisible, catching every tap
test('a pick from the held message closes the overlay, then runs', () => {
  const done: string[] = []
  setDown(() => done.push('close'), () => done.push('fork'))()
  expect(done).toEqual(['close', 'fork'])
})

test('setting it down with nothing picked just closes it', () => {
  const done: string[] = []
  setDown(() => done.push('close'))()
  expect(done).toEqual(['close'])
})
