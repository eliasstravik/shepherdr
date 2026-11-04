import { expect, test } from 'bun:test'
import { expire, KEEP_PAST, loadOutbox, partsOf, settle, type Outgoing } from './outbox.ts'
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

// SHEP-22: ones with pictures stayed under everything newer, kept on the phone for good
const pics = [{ name: 'a.png', path: '~/.config/herdr-app/data/chat-attach/web-1-a.png' }, { name: 'b.png', path: '~/.config/herdr-app/data/chat-attach/web-2-b.png' }]

test('its words back, its pictures only as how many (Claude Code\'s "[Image #1]"): it is in', () => {
  const o = sent({ text: 'thumbnails broken', files: pics })
  expect(settle([o], chat([{ id: 'u2', who: 'you', at: 10_800, text: 'thumbnails broken' }, { id: 'u2:n', who: 'you', at: 10_800, images: 2 }]))).toEqual([])
})

test('the server gave it back its id: it is in, whatever the words', () => {
  const o = sent({ text: 'thumbnails broken', files: pics })
  expect(settle([o], chat([{ id: 'u2', who: 'you', at: 10_800, text: 'thumbnails brokenand more', cid: 'c1' }]))).toEqual([])
})

test('pictures alone still need their files', () => {
  const out = [sent({ text: '', files: pics })]
  expect(settle(out, chat([{ id: 'u2:n', who: 'you', at: 10_800, images: 2 }]))).toBe(out)
})

test('came back changed (two in one), the log moved past it: it goes a minute later, never stuck under the rest', () => {
  const o = sent({ text: 'thumbnails broken', files: pics })
  const moved = chat([{ id: 'u2', who: 'you', at: 10_800, text: 'thumbnails brokenand more' }, { id: 'a1', who: 'agent', at: 20_000, text: 'ok' }, { id: 'u3', who: 'you', at: 30_000, text: 'hi' }])
  const [past] = settle([o], moved, 50_000)
  expect(past).toMatchObject({ pastAt: 50_000 })
  expect(settle([past], moved, 51_000)).toEqual([past])
  expect(expire([past], 50_000 + KEEP_PAST - 1)).toEqual([past])
  expect(expire([past], 50_000 + KEEP_PAST + 1)).toEqual([])
  // one that failed after it went in goes too
  const [lost] = settle([{ ...o, state: 'failed', lost: true }], moved, 50_000)
  expect(lost).toMatchObject({ pastAt: 50_000 })
})

test('nothing of yours after it: it stays (the agent may take it later)', () => {
  const out = [sent({ text: 'thumbnails broken', files: pics })]
  expect(settle(out, chat([{ id: 'a1', who: 'agent', at: 20_000, text: 'ok' }, { id: 'u0', who: 'you', at: 9_000, text: 'before' }]), 50_000)).toBe(out)
})

test("one that didn't go through stays for Retry", () => {
  const out = [sent({ state: 'failed', error: "That agent isn't running." })]
  expect(settle(out, chat([{ id: 'u3', who: 'you', at: 30_000, text: 'hi' }]), 50_000)).toBe(out)
})

test('what the old name kept is dropped once', () => {
  const store = new Map<string, string>([['shepherdr.outbox', JSON.stringify([sent({ at: Date.now() })])]])
  const g = globalThis as { localStorage?: unknown }
  const was = g.localStorage
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) }
  try {
    expect(loadOutbox()).toEqual([])
    expect(store.has('shepherdr.outbox')).toBe(false)
  } finally {
    g.localStorage = was
  }
})
