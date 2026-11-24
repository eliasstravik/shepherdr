import { expect, test } from 'bun:test'
import { ReplyPress, repliesHidden, suggestionOf, suggestionsOn, suggestsOfMessage, SUGGEST_CHARS } from './suggest.ts'
import { SUGGEST_MOST } from '@shared/suggest.ts'
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

test('messages between agents never clear them: one from another Assistant, one this agent sent, then its no-reply', () => {
  const ask = { text: 'Merge it?', suggests: ['yes', 'not yet'] }
  const peerIn = { who: 'you', text: 'Fixed it there', brief: { label: 'Message from Assistant on vmk', from: 'Assistant on vmk' }, relay: { dir: 'from', name: 'Assistant on vmk' } } as Partial<Message>
  const sentOut = { who: 'agent', text: 'Go on', brief: { label: 'Message to Fix login', from: 'Assistant', to: 'Fix login' }, relay: { dir: 'to', name: 'Fix login' } } as Partial<Message>
  const news = { news: { task: 'SHOP-2', ref: 'SHOP-2', mark: 'ready', what: 'is ready', text: 'Fix login' } } as Partial<Message>
  expect(suggestionOf(chat([ask, peerIn]), true)).toEqual({ id: 'm0', texts: ['yes', 'not yet'] })
  expect(suggestionOf(chat([ask, peerIn, sentOut, news]), true)).toEqual({ id: 'm0', texts: ['yes', 'not yet'] })
  // the person writing, or a new reply with words, still does
  expect(suggestionOf(chat([ask, peerIn, { who: 'you', text: 'yes' }]), true)).toBeNull()
  expect(suggestionOf(chat([ask, peerIn, { text: 'Merged.' }]), true)).toBeNull()
  expect(suggestionOf(chat([ask, peerIn, { text: 'Merged?', suggests: ['ok'] }]), true)).toEqual({ id: 'm2', texts: ['ok'] })
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

// A question with options: one bubble per option (up to five), the app filling in what the agent left out (SHEP-436).
const asked = 'Which way should the cards go?\n\n1. **One card per provider** (recommended) — simplest\n2. One card for all, with tabs\n3. A table instead: denser\n4. Other'

test('a question with options gets one bubble per option, made from the list when the agent gave too few, without "Other"', () => {
  expect(suggestionOf(chat([{ text: asked, suggests: ['1'] }]), true)!.texts)
    .toEqual(['1. One card per provider', '2. One card for all, with tabs', '3. A table instead'])
  // none given: the list alone
  expect(suggestionOf(chat([{ text: asked }]), true)!.texts).toHaveLength(3)
  // the agent's own bubble for an option is kept, in the option's place; its others after
  expect(suggestionOf(chat([{ text: asked, suggests: ['2, tabs please', 'status?'] }]), true)!.texts)
    .toEqual(['1. One card per provider', '2, tabs please', '3. A table instead', 'status?'])
  // enough of its own: those, up to five
  expect(suggestionOf(chat([{ text: asked, suggests: ['1, per provider', '2, tabs', '3, a table', '4', '5', '6'] }]), true)!.texts)
    .toEqual(['1, per provider', '2, tabs', '3, a table', '4', '5'])
  // lettered, and at most five; a long option is cut at a word
  const many = 'Pick one?\na) ' + 'Alpha beta gamma delta epsilon zeta eta theta iota' + '\nb) B\nc) C\nd) D\ne) E\nf) F'
  const t = suggestionOf(chat([{ text: many }]), true)!.texts
  expect(t).toEqual(['a. Alpha beta gamma delta', 'b. B', 'c. C', 'd. D', 'e. E'])
  expect(t.every((x) => x.length <= SUGGEST_CHARS)).toBe(true)
})

test('SHEP-463: a reply far over the 30-character limit is left out, never shown cut; a little over stays whole', () => {
  expect(SUGGEST_CHARS).toBe(30)
  const near = 'Walk me through the Clay admin clicks now' // 41: over the limit, under twice it: shown in full
  const far = 'Walk me through every single admin click in the Clay workspace, one by one, slowly' // 82
  expect(suggestionOf(chat([{ text: 'Next?', suggests: ['status?', near, far] }]), true)!.texts).toEqual(['status?', near])
  // only far ones: no bubbles at all
  expect(suggestionOf(chat([{ text: 'Next?', suggests: [far] }]), true)).toBeNull()
  // exactly the most is kept, one more is not (counted in characters, an emoji is one)
  const most = 'x'.repeat(SUGGEST_MOST), over = 'y'.repeat(SUGGEST_MOST + 1)
  expect(suggestsOfMessage({ text: 'Next?', suggests: [most, over, '👍'.repeat(SUGGEST_MOST)] })).toEqual([most, '👍'.repeat(SUGGEST_MOST)])
  // an option's own bubble that is far over: the one made from the option takes its place
  const asked = 'Which way?\n1. One card per provider\n2. A table instead'
  expect(suggestsOfMessage({ text: asked, suggests: ['1, ' + far, '2, a table'] })).toEqual(['1. One card per provider', '2, a table'])
})

test('an ordinary numbered list is no question: steps, a summary, or a question only after the list', () => {
  const steps = 'Done. What changed:\n1. The row scrolls\n2. The cap is five\n3. Tests pass'
  expect(suggestionOf(chat([{ text: steps, suggests: ['Merge it'] }]), true)!.texts).toEqual(['Merge it'])
  expect(suggestionOf(chat([{ text: steps }]), true)).toBeNull()
  expect(suggestionOf(chat([{ text: steps + '\n\nWant me to merge?', suggests: ['Yes'] }]), true)!.texts).toEqual(['Yes'])
  // a question, a list, then more words: not the end of the message
  expect(suggestionOf(chat([{ text: 'Which?\n1. A\n2. B\n\nI lean to A.' }]), true)).toBeNull()
  // out of order, or a single item
  expect(suggestionOf(chat([{ text: 'Which?\n2. A\n3. B' }]), true)).toBeNull()
  expect(suggestionOf(chat([{ text: 'Which?\n1. A' }]), true)).toBeNull()
  // an ordinary reply still shows at most three of the agent's own
  expect(suggestionOf(chat([{ text: 'Merged.', suggests: ['a', 'b', 'c', 'd'] }]), true)!.texts).toEqual(['a', 'b', 'c'])
})
