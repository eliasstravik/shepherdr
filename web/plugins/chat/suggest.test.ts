import { expect, test } from 'bun:test'
import { ReplyPress, repliesHidden, suggestionOf, suggestionsOn } from './suggest.ts'
import type { Chat, Message } from '@shared/types.ts'

const chat = (messages: Partial<Message>[]) => ({ key: 'p:sp1', messages: messages.map((m, i) => ({ id: `m${i}`, who: 'agent', ...m })) }) as Chat

test('the newest agent text carries up to three suggested replies, in order', () => {
  expect(suggestionOf(chat([{ who: 'you', text: 'hi' }, { text: 'Merge it?', suggests: ['Yes, merge it', 'Show me the diff', 'Not yet'] }]), true))
    .toEqual({ id: 'm1', texts: ['Yes, merge it', 'Show me the diff', 'Not yet'] })
  expect(suggestionOf(chat([{ text: 'Merge it?', suggests: ['Yes', 'No'] }]), true)!.texts).toEqual(['Yes', 'No'])
  // more than three: the first three; blanks and repeats drop
  expect(suggestionOf(chat([{ text: 'Q', suggests: ['a', ' ', 'a', 'b', 'c', 'd'] }]), true)!.texts).toEqual(['a', 'b', 'c'])
})

test("an older service's single suggestion is one bubble", () => {
  expect(suggestionOf(chat([{ text: 'Merge it?', suggest: 'yes, merge it' }]), true)).toEqual({ id: 'm0', texts: ['yes, merge it'] })
})

test('nothing after the person wrote, and nothing from an agent reply without suggestions', () => {
  expect(suggestionOf(chat([{ text: 'Merge it?', suggests: ['yes'] }, { who: 'you', text: 'no' }]), true)).toBeNull()
  expect(suggestionOf(chat([{ text: 'Merge it?', suggests: ['yes'] }, { text: 'Merged.' }]), true)).toBeNull()
  expect(suggestionOf(chat([{ text: 'Merge it?', suggests: [] }]), true)).toBeNull()
})

test('rows that are not words (activity, news) never hide or replace them', () => {
  expect(suggestionOf(chat([{ text: 'Merge it?', suggests: ['yes'] }, { activity: undefined, news: undefined } as Partial<Message>]), true))
    .toEqual({ id: 'm0', texts: ['yes'] })
})

test('none with the setting off, nor in an empty chat', () => {
  expect(suggestionOf(chat([{ text: 'Merge it?', suggests: ['yes'] }]), false)).toBeNull()
  expect(suggestionOf(undefined, true)).toBeNull()
  expect(suggestionOf(chat([]), true)).toBeNull()
})

test('they stay whatever is in the box; they hide only dictating, in a call, while the agent replies, while a send is on its way, and once used', () => {
  const idle = { dictating: false, call: false, working: false, sending: false, spent: false }
  expect(repliesHidden(idle)).toBe(false)
  // typing or attaching never hides them: the check takes nothing from the box
  expect(repliesHidden({ ...idle, text: 'a draft', files: 2 } as typeof idle)).toBe(false)
  expect(repliesHidden({ ...idle, dictating: true })).toBe(true)
  expect(repliesHidden({ ...idle, call: true })).toBe(true)
  expect(repliesHidden({ ...idle, working: true })).toBe(true)
  expect(repliesHidden({ ...idle, sending: true })).toBe(true)
  expect(repliesHidden({ ...idle, spent: true })).toBe(true)
})

test('the setting is on unless Settings says off', () => {
  const row = (value: string) => [{ rows: [{ key: 'agents.suggestions', value }] }]
  expect(suggestionsOn(row('on'))).toBe(true)
  expect(suggestionsOn(row('off'))).toBe(false)
  expect(suggestionsOn(undefined)).toBe(true)
})

/** a ReplyPress on a fake clock: run() fires the pending hold */
function pressed() {
  const edits: number[] = []
  let pending: (() => void) | null = null
  const p = new ReplyPress(() => edits.push(1), (f) => ((pending = f), 1), () => (pending = null))
  return { p, edits, run: () => { const f = pending; pending = null; f?.() } }
}

test('a tap sends the reply as it is', () => {
  const { p, edits } = pressed()
  p.down(10, 10)
  p.stop() // the finger lifts before the hold
  expect(p.click()).toBe(true)
  expect(edits).toEqual([])
})

test('a press held puts it in the box to edit, and its click sends nothing', () => {
  const { p, edits, run } = pressed()
  p.down(10, 10)
  run()
  expect(edits).toEqual([1])
  expect(p.click()).toBe(false)
  // the next tap sends again
  p.down(10, 10)
  p.stop()
  expect(p.click()).toBe(true)
})

test("the phone's long-press menu or a right-click edits once, never twice with the hold", () => {
  const { p, edits, run } = pressed()
  p.down(0, 0)
  run()
  p.menu()
  expect(edits).toEqual([1])
  expect(p.click()).toBe(false)
  const b = pressed()
  b.p.menu()
  expect(b.edits).toEqual([1])
})

test('a finger that slides (scrolling the row) is not a hold', () => {
  const { p, edits, run } = pressed()
  p.down(0, 0)
  p.move(30, 0)
  run()
  expect(edits).toEqual([])
})
