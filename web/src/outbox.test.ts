import { expect, test } from 'bun:test'
import { partsOf, settle, type Outgoing } from './outbox.ts'
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
  const o = sent({ text: '', files: [{ name: 'a.png', path: '~/.config/herdr-app/data/chat-attach/a.png' }] })
  expect(settle([o], chat([{ id: 'u2:f0', who: 'you', at: 10_800, file: { name: 'a.png', path: '/var/put/p1/a.png' } }]))).toEqual([])
})

test('without the server time it waits', () => {
  const out = [sent({ serverAt: undefined })]
  expect(settle(out, chat([{ id: 'u2', who: 'you', text: 'cool', at: 10_800 }]))).toBe(out)
})

test('a file the agent got as a path: on a line after the words, where it landed', () => {
  const o = sent({ text: 'web file test', files: [{ name: 'n.txt', path: '~/.config/herdr-app/data/chat-attach/web-1-n.txt' }] })
  expect(settle([o], chat([{ id: 'u2', who: 'you', at: 10_800, text: 'web file test\n\n/var/state/herdr-core/files/t1/web-1-n.txt' }]))).toEqual([])
  const alone = sent({ text: '', files: o.files })
  expect(settle([alone], chat([{ id: 'u2', who: 'you', at: 10_800, text: '/var/state/herdr-core/files/t1/web-1-n.txt' }]))).toEqual([])
})

test('other words with its path are not it', () => {
  const out = [sent({ text: 'web file test', files: [{ name: 'n.txt', path: '~/a/web-1-n.txt' }] })]
  expect(settle(out, chat([{ id: 'u2', who: 'you', at: 10_800, text: 'something else\n/b/web-1-n.txt' }]))).toBe(out)
})

test("in the CLI's queue (typed while it works): it shows there, quietly, then the real one takes its place", () => {
  const queued = chat([{ id: 'q9', who: 'you', text: 'cool', at: 10_100, waiting: true, waitsFor: 'queue', cid: 'c1' }])
  const [o] = settle([sent()], queued)
  expect(o).toMatchObject({ state: 'sent', waiting: true, queued: true })
  expect(partsOf(o, queued)).toEqual([])
  // taken: it shows again until the log has it, then goes
  const [back] = settle([o], chat([]), 11_000)
  expect(back).toMatchObject({ wentAt: 11_000 })
  expect(settle([back], chat([{ id: 'u2', who: 'you', text: 'cool', at: 10_900 }]))).toEqual([])
})
