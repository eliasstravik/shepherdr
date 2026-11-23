import { beforeEach, expect, test } from 'bun:test'
import { expire, forgetDone, KEEP_PAST, loadOutbox, partsOf, readNow, settle, showsAs, type Outgoing } from './outbox.ts'
import type { Chat } from '@shared/types.ts'

// What you sent comes back from the agent's log without its id: it takes the pending one's place by its words, files
// and time, by the server's clock against the log's (the agent may be on another machine).
const sent = (o: Partial<Outgoing> = {}): Outgoing => ({ cid: 'c1', chat: 'k', text: 'cool', files: [], at: 1, state: 'sent', serverAt: 10_000, prior: ['old'], ...o })
const chat = (messages: Chat['messages']): Chat => ({ key: 'k', cli: 'Claude Code', messages })

// each test a fresh screen: what came back before is not known
beforeEach(() => forgetDone())

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

// SHEP-312: one whose answer never came (a reload cut it off, its page asked again) was never known by its words
test('without the server time: known by its words, from when this screen sent it', () => {
  const o = sent({ serverAt: undefined, at: 600_000 })
  expect(settle([o], chat([{ id: 'u2', who: 'you', text: 'cool', at: 590_000 }]))).toEqual([])
  // not one of yours from long before it
  const out = [{ ...o, cid: 'c2' }]
  expect(settle(out, chat([{ id: 'u1', who: 'you', text: 'cool', at: 100_000 }]))).toBe(out)
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

// SHEP-93: one stuck on its way stayed under the box while newer messages came in above it
test('one on its way shows right after what was last when it was sent, in the order things were sent', async () => {
  const { anchorOf, placesOf } = await import('./outbox.ts')
  const c = chat([
    { id: 'a1', who: 'agent', text: 'Send them whenever', at: 1 },
    { id: 'q1', who: 'you', text: 'typed', at: 2, waiting: true },
    { id: 'ask:1', who: 'agent', at: 3 },
  ])
  expect(anchorOf(c)).toBe('a1')
  // later: the agent answered something else, and you sent another one that came back
  const ids = [{ id: 'a1' }, { id: 'u2' }, { id: 'a3' }]
  const places = placesOf(ids, [{ cid: 'stuck', after: 'a1' }, { cid: 'next', after: 'a3' }, { cid: 'old' }, { cid: 'gone', after: 'x' }])
  expect(places.get('stuck')).toBe(1)
  expect(places.get('next')).toBe(3)
  // without its anchor: at the end
  expect(places.get('old')).toBe(3)
  expect(places.get('gone')).toBe(3)
})

test('one still sending keeps trying by itself for minutes (a reload resumes it), then fails with its words kept', () => {
  const o = sent({ state: 'sending', serverAt: undefined, at: 0 })
  expect(expire([o], 5 * 60_000)[0].state).toBe('sending')
  const failed = expire([o], 12 * 60_000)[0]
  expect(failed.state).toBe('failed')
  expect(failed.text).toBe('cool')
})

test('two sent at once: once the first is in the chat, the second stays under it', async () => {
  const { placesOf } = await import('./outbox.ts')
  // A and B were sent after a1; A came back from the log (with its id), B is still on its way
  const rows = [{ id: 'a1' }, { id: 'uA', cid: 'A' }, { id: 'uA:f0', cid: 'A' }]
  expect(placesOf(rows, [{ cid: 'B', after: 'a1', before: ['A'] }]).get('B')).toBe(3)
  // without A before it, it would sit right after a1
  expect(placesOf(rows, [{ cid: 'B', after: 'a1' }]).get('B')).toBe(1)
})

// ---------- SHEP-312: a pending copy never outlives its delivered message ----------

test('a message sent mid-turn (steered): the log gives it back with its id, and it goes', () => {
  const o = sent({ cid: 'steer', text: 'also say banana' })
  // first in the CLI's queue (waiting, with its id), then taken in mid-turn
  const [q] = settle([o], chat([{ id: 'q1', who: 'you', text: 'also say banana', at: 10_500, waiting: true, waitsFor: 'queue', cid: 'steer' }]), 11_000)
  expect(q).toMatchObject({ queued: true })
  expect(settle([q], chat([{ id: 'u5', who: 'you', text: 'also say banana', at: 10_900, cid: 'steer' }]), 12_000)).toEqual([])
})

test('a message sent mid-turn whose id the log lost (a restart): known by its words', () => {
  const o = sent({ cid: 'steer', text: 'also say banana' })
  expect(settle([o], chat([{ id: 'a1', who: 'agent', text: 'working', at: 10_100 }, { id: 'u5', who: 'you', text: 'also say banana', at: 10_900 }]), 12_000)).toEqual([])
})

test('held for the agent turn (Ctrl+Enter): it waits, then comes back with its id', () => {
  const o = sent({ cid: 'held', text: 'say cherry', waiting: true, waitsFor: 'turn', serverAt: undefined })
  const out = [o]
  // held: even the same words from before are not it
  expect(settle(out, chat([{ id: 'u1', who: 'you', text: 'say cherry', at: 5_000 }]), 9_000)).toBe(out)
  expect(settle(out, chat([{ id: 'u9', who: 'you', text: 'say cherry', at: 20_000, cid: 'held' }]), 21_000)).toEqual([])
})

test('the text came back with the tag lines and wrapping a send adds: it goes', () => {
  const o = sent({ text: 'Let it finish   6.1,\nthen  go' })
  const back = '<hc reply-to="Done: the seven"/>\n<hc task="TG-1" state="Working" folder="~/a">brief</hc>\nLet it finish 6.1, then go'
  expect(settle([o], chat([{ id: 'u2', who: 'you', text: back, at: 10_800 }]))).toEqual([])
})

test('two identical messages in a row stay two: each takes a message of its own', () => {
  const a = sent({ cid: 'A', text: 'same' }), b = sent({ cid: 'B', text: 'same', serverAt: 10_200 })
  const one = chat([{ id: 'u2', who: 'you', text: 'same', at: 10_800 }])
  // only one is in the log yet: the first goes, the second stays
  const left = settle([a, b], one)
  expect(left.map((o) => o.cid)).toEqual(['B'])
  // and stays on the next update too (the first's message is taken)
  expect(settle(left, one)).toBe(left)
  const two = chat([...one.messages, { id: 'u3', who: 'you', text: 'same', at: 10_900 }])
  expect(settle(left, two)).toEqual([])
})

test("still 'sending' after a reload, though it went in: its words in the log clear it", () => {
  const o = sent({ state: 'sending', serverAt: undefined, at: 20_000 })
  expect(settle([o], chat([{ id: 'u2', who: 'you', text: 'cool', at: 21_000 }]), 30_000)).toEqual([])
})

test("given up on (\"didn't show up\") but it came back late: it goes, never a dead copy", () => {
  const o = sent({ state: 'failed', lost: true, error: "It didn't show up in the chat." })
  expect(settle([o], chat([{ id: 'u2', who: 'you', text: 'cool', at: 200_000 }]), 250_000)).toEqual([])
})

test('the timeout: one that never came back turns into "Not sent" with Retry, never a grey copy for good', () => {
  const o = sent({ at: 0, serverAt: 0 })
  const [f] = expire([o], 3 * 60_000)
  expect(f).toMatchObject({ state: 'failed', lost: true, error: "It didn't show up in the chat." })
  expect(f.text).toBe('cool')
})

test('a stale stored copy from 3.2.1 clears itself on the next load once its message is in the log', () => {
  const store = new Map<string, string>()
  const g = globalThis as { localStorage?: unknown }
  const was = g.localStorage
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) }
  try {
    // kept by 3.2.1: still "sending" (a reload cut it off), no server time, no id in the log
    const stuck = sent({ cid: 'old', state: 'sending', serverAt: undefined, at: Date.now() - 10 * 60_000, prior: [] })
    store.set('shepherdr.outbox.2', JSON.stringify([stuck]))
    const loaded = loadOutbox()
    expect(loaded.map((o) => o.cid)).toEqual(['old'])
    expect(settle(loaded, chat([{ id: 'u7', who: 'you', text: 'cool', at: stuck.at + 2_000 }]))).toEqual([])
  } finally {
    g.localStorage = was
  }
})

test('a reload never brings a cleared one back, even when another tab writes its older outbox', async () => {
  const { saveOutbox } = await import('./outbox.ts')
  const store = new Map<string, string>()
  const g = globalThis as { localStorage?: unknown }
  const was = g.localStorage
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) }
  try {
    const o = sent({ cid: 'x', at: Date.now(), serverAt: 10_000 })
    // this tab sees it come back
    expect(settle([o], chat([{ id: 'u2', who: 'you', text: 'cool', at: 10_800, cid: 'x' }]))).toEqual([])
    // another tab, a screen that knew nothing of it, writes its old outbox back
    forgetDone()
    saveOutbox([o])
    expect(JSON.parse(store.get('shepherdr.outbox.2') ?? '[]')).toEqual([])
    // and a reload doesn't show it
    store.set('shepherdr.outbox.2', JSON.stringify([o]))
    forgetDone()
    expect(loadOutbox()).toEqual([])
  } finally {
    g.localStorage = was
  }
})

// SHEP-329: a message in the agent never looks dead: dimmed only on its way or held on purpose, then sent, then read
test('sent once it is in the agent, its queue included; dimmed only on its way or held', () => {
  expect(showsAs(sent({ state: 'sending' }))).toEqual({ pending: true })
  expect(showsAs(sent())).toEqual({ mark: 'sent' })
  expect(showsAs(sent({ waiting: true, queued: true, waitsFor: 'queue' }))).toEqual({ mark: 'sent' })
  expect(showsAs(sent({ waiting: true, waitsFor: 'turn' }))).toEqual({ pending: true })
  expect(showsAs(sent({ state: 'failed', error: 'no' }))).toEqual({ failed: 'no' })
})

test('read: yours from the log, not one in its queue nor one on its way', () => {
  expect(readNow({ id: 'u1', who: 'you', text: 'hi', at: 1 })).toBe(true)
  expect(readNow({ id: 'q1', who: 'you', text: 'hi', at: 1, waiting: true, waitsFor: 'queue' })).toBe(false)
  expect(readNow({ id: 'out:c1', who: 'you', text: 'hi', at: 1 })).toBe(false)
  expect(readNow({ id: 'a1', who: 'agent', text: 'hi', at: 1 })).toBe(false)
})
