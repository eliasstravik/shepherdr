import { expect, test } from 'bun:test'
import { settle, type Outgoing } from './outbox.ts'
import type { Chat } from '@shared/types.ts'

// What you sent comes back from the agent's log without its id: it takes the pending one's place by its words, files
// and time, by the server's clock against the log's (the agent may be on another machine).
const sent = (o: Partial<Outgoing> = {}): Outgoing => ({ cid: 'c1', chat: 'k', text: 'cool', files: [], at: 1, state: 'sent', serverAt: 10_000, prior: ['old'], ...o })
const chat = (messages: Chat['messages']): Chat => ({ key: 'k', cli: 'Claude Code', messages })

test('the real message takes its place', () => {
  expect(settle([sent()], chat([{ id: 'old', who: 'you', text: 'cool', at: 1 }, { id: 'u2', who: 'you', text: 'cool', at: 10_800 }]))).toEqual([])
})

test('its machine clock a little behind', () => {
  expect(settle([sent()], chat([{ id: 'u2', who: 'you', text: 'cool', at: 7_000 }]))).toEqual([])
})

test('an older one of yours is not it', () => {
  const out = [sent()]
  expect(settle(out, chat([{ id: 'old', who: 'you', text: 'cool', at: 10_500 }, { id: 'u1', who: 'you', text: 'cool', at: 1_000 }]))).toBe(out)
})

test('nor what another agent sent', () => {
  const out = [sent()]
  expect(settle(out, chat([{ id: 'u2', who: 'agent', text: 'cool', at: 10_800 }]))).toBe(out)
})

test("a file that landed on the agent's machine", () => {
  const o = sent({ text: '', files: [{ name: 'a.png', path: '/home/x/.config/herdr-app/data/chat-attach/a.png' }] })
  expect(settle([o], chat([{ id: 'u2:f0', who: 'you', at: 10_800, file: { name: 'a.png', path: '/Users/x/.herdr/put/p1/a.png' } }]))).toEqual([])
})

test('without the server time it waits', () => {
  const out = [sent({ serverAt: undefined })]
  expect(settle(out, chat([{ id: 'u2', who: 'you', text: 'cool', at: 10_800 }]))).toBe(out)
})
