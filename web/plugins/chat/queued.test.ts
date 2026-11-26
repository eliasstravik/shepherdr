import { expect, test } from 'bun:test'
import type { Chat, Question } from '@shared/types.ts'
import type { Outgoing } from '@client/outbox.ts'
import { editedDraft, heldOf, isHeld, ownAsk } from './queued.ts'
import { questionsBelow } from './newest.ts'

// #1560: messages held for the agent's turn are rows over the box (Send now, Edit, Remove) until they go in; while
// its agent's own question is open the box says your words answer it; the scroll pill says how many questions wait below.

const out = (o: Partial<Outgoing>): Outgoing => ({ cid: 'c1', chat: 'k', text: 'hi', files: [], at: 1, state: 'sent', ...o })

test('held: on purpose or waiting for its turn, never a failed one, until the chat has it', () => {
  expect(isHeld(out({ hold: true, state: 'sending' }))).toBe(true)
  expect(isHeld(out({ waiting: true, waitsFor: 'turn' }))).toBe(true)
  expect(isHeld(out({ waitsFor: 'queue' }))).toBe(false)
  expect(isHeld(out({ hold: true, state: 'failed' }))).toBe(false)
  const box = [out({ hold: true }), out({ cid: 'c2', hold: true }), out({ cid: 'c3', chat: 'other', hold: true }), out({ cid: 'c4' })]
  expect(heldOf(box, 'k').map((o) => o.cid)).toEqual(['c1', 'c2'])
  const chat: Chat = { key: 'k', cli: 'claude', messages: [{ id: 'm', who: 'you', cid: 'c1', text: 'hi' }] }
  expect(heldOf(box, 'k', chat).map((o) => o.cid)).toEqual(['c2'])
})

test('Edit puts its words back above what is typed', () => {
  expect(editedDraft('fix it', '')).toBe('fix it')
  expect(editedDraft('fix it', '  ')).toBe('fix it')
  expect(editedDraft('fix it', 'and more')).toBe('fix it\n\nand more')
})

test("the box answers only its own agent's open question", () => {
  const q = (o: Partial<Question>): Question => ({ id: 'q', kind: 'Question', title: 'Which?', to: 'k', choices: [{ label: 'A' }], other: true, ...o }) as Question
  const chat = (question: Question): Chat => ({ key: 'k', cli: 'claude', messages: [{ id: 'm', who: 'agent', question }] })
  expect(ownAsk(chat(q({})))?.id).toBe('q')
  expect(ownAsk(chat(q({ sent: 0 })))).toBeUndefined()
  expect(ownAsk(chat(q({ closed: 'Closed' })))).toBeUndefined()
  expect(ownAsk(chat(q({ other: undefined })))).toBeUndefined()
  expect(ownAsk(chat(q({ by: { ref: 'SHEP-1', chat: 'x/worker' } })))).toBeUndefined()
  expect(ownAsk(undefined)).toBeUndefined()
})

test('the pill counts questions below', () => {
  expect(questionsBelow(1)).toBe('1 question below')
  expect(questionsBelow(3)).toBe('3 questions below')
})
