import { expect, test } from 'bun:test'
import type { Chat, Message } from '@shared/types.ts'
import { cardsAfter, cardsNow, ENOUGH, stillLoading, TRIES, wantsEarlier } from './hold.ts'

const msg = (id: string, at: number, more: Partial<Message> = {}): Message => ({ id, who: 'agent', at, text: 'Hi', ...more })
const news = (id: string, at: number): Message => msg(id, at, { text: undefined, news: { task: 't', ref: 'T-1', mark: 'other', what: 'news', text: 'x' } })
const chat = (messages: Message[], more: Partial<Chat> = {}): Chat => ({ key: 'p:a', messages, cli: 'claude', ...more })
const done = (key: string, at: number) => ({ key, at, past: true })
const review = { key: 'review:live', at: 5 }

test('no task rows while the chat has not come yet, or its log is still being found', () => {
  const cards = [done('a', 1), done('b', 2), review]
  expect(cardsNow(cards, undefined)).toEqual([])
  expect(cardsNow(cards, chat([], { notice: 'opening' }))).toEqual([])
  expect(stillLoading(undefined, 0)).toBe(true)
})

test('once its messages are in, every card shows', () => {
  const cards = [done('a', 1), done('b', 2), review]
  expect(cardsNow(cards, chat([msg('m', 3)], { top: true }))).toEqual(cards)
  // a chat that truly has nothing yet still shows its cards
  expect(cardsNow(cards, chat([], { top: true }))).toEqual(cards)
})

test('with earlier pages left, a done line from before the oldest message waits for its page; a live card never does', () => {
  const live = { key: 'review:old', at: 1 }
  const c = chat([msg('m1', 10), msg('m2', 11), msg('m3', 12)], { earlier: true })
  expect(cardsNow([done('old', 5), done('new', 11), live], c).map((x) => x.key)).toEqual(['new', 'review:old'])
})

test('a newest page of task rows only: earlier pages, held as loading until a real message is in', () => {
  const rows = chat([news('n1', 1), news('n2', 2)], { earlier: true })
  expect(wantsEarlier(rows, 0)).toBe(true)
  expect(stillLoading(rows, 0)).toBe(true)
  expect(cardsNow([done('a', 3)], rows, 0)).toEqual([])
  // one message in: it shows, and reads on for a few more
  const one = chat([msg('m', 0), news('n1', 1)], { earlier: true })
  expect(stillLoading(one, 1)).toBe(false)
  expect(wantsEarlier(one, 1)).toBe(true)
  // enough, or the log's start, or out of tries: it stops
  expect(wantsEarlier(chat(Array.from({ length: ENOUGH }, (_, i) => msg(`m${i}`, i)), { earlier: true }), 1)).toBe(false)
  expect(wantsEarlier(chat([news('n1', 1)], { top: true }), 0)).toBe(false)
  expect(wantsEarlier(rows, TRIES)).toBe(false)
  expect(stillLoading(rows, TRIES)).toBe(false)
})

// #1475: a Ready card stayed where the task first said ready, above what was said after it
test('a waiting card goes below the newest later message it follows; a done line and its earlier ones stay', () => {
  const msgs = [{ at: 100 }, { at: 200, news: { task: 'T-1' } }, { at: 300, news: { task: 'T-2' } }, { at: 400 }] as Message[]
  const any = () => true
  expect(cardsAfter([{ key: 'r', at: 150, after: any }], msgs)[0]!.at).toBe(401)
  // in a space's chat, only its own task's rows
  expect(cardsAfter([{ key: 'r', at: 150, after: (m) => m.news?.task === 'T-1' }], msgs)[0]!.at).toBe(201)
  // a row of the same moment (its own "ready" line) keeps the order it had
  expect(cardsAfter([{ key: 'r', at: 200, after: (m) => m.news?.task === 'T-1' }], msgs)[0]!.at).toBe(200)
  // a past card (Done) and a card without `after` keep their place
  expect(cardsAfter([{ key: 'd', at: 150, past: true, after: any }, { key: 's', at: 150 }], msgs).map((c) => c.at)).toEqual([150, 150])
  // nothing later: unchanged
  expect(cardsAfter([{ key: 'r', at: 500, after: any }], msgs)[0]!.at).toBe(500)
})
