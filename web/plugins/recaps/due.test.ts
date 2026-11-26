import { expect, test } from 'bun:test'
import { AWAY, dueRecap } from './due.ts'
import type { Message } from '@shared/types.ts'

const now = 10 * AWAY
const agent = (at: number, more: Partial<Message> = {}): Message => ({ id: `a${at}`, who: 'agent', text: 'Done.', at, ...more })

test('a recap is due after a while away, when the agent did something since', () => {
  expect(dueRecap([agent(now - 1000)], now - AWAY - 1, now)).toBe(true)
  // back soon, or never looked before: none
  expect(dueRecap([agent(now - 1000)], now - 60_000, now)).toBe(false)
  expect(dueRecap([agent(now - 1000)], undefined, now)).toBe(false)
  // nothing since you looked, or only your own words
  expect(dueRecap([agent(now - 2 * AWAY)], now - AWAY - 1, now)).toBe(false)
  expect(dueRecap([{ id: 'u', who: 'you', text: 'hi', at: now - 1000 }], now - AWAY - 1, now)).toBe(false)
  // a recap came since (Claude Code's own): none
  expect(dueRecap([agent(now - 2000), agent(now - 1000, { recap: 'recap' })], now - AWAY - 1, now)).toBe(false)
  // a heads-up alone isn't news
  expect(dueRecap([agent(now - 1000, { recap: 'heads' })], now - AWAY - 1, now)).toBe(false)
})
