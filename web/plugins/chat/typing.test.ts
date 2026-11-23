import { expect, test } from 'bun:test'
import { signOf } from './typing.ts'
import type { Chat, Message, TurnActivity } from '@shared/types.ts'

const msgs = (...m: Partial<Message>[]) => m.map((x, i) => ({ id: `m${i}`, who: 'agent', ...x })) as Message[]
const chat = (c: Partial<Chat>, messages: Message[] = msgs({ who: 'you', text: 'do it' })) => ({ key: 'p:sp1', cli: 'claude', messages, ...c }) as Chat
const turn = (t: Partial<TurnActivity> = {}) => ({ id: 't1', at: 1, rows: [], steps: 0, ...t }) as TurnActivity
const step = (doing: string, title = '') => ({ kind: 'run', doing, title, target: '' }) as unknown as TurnActivity['now']

test('a working agent with nothing written yet shows the sign alone, no step', () => {
  expect(signOf(chat({ working: true }))).toEqual({ step: '' })
})

test('the step it is on: its status line first, else the tool it runs', () => {
  expect(signOf(chat({ working: true, doing: 'Changing the checkout button', live: turn({ now: step('Running bun test') }) }))).toEqual({ step: 'Changing the checkout button' })
  expect(signOf(chat({ working: true, live: turn({ now: step('Running bun test') }) }))).toEqual({ step: 'Running bun test' })
  expect(signOf(chat({ working: true, live: turn({ now: step('', 'Ran bun test') }) }))).toEqual({ step: 'Ran bun test' })
  expect(signOf(chat({ working: true, live: turn() }))).toEqual({ step: '' })
})

test('one line: breaks in a step become spaces', () => {
  expect(signOf(chat({ working: true, doing: 'Writing\n  tests ' }))?.step).toBe('Writing tests')
})

test('between words: after a reply mid-turn it stays below it while the next step runs', () => {
  expect(signOf(chat({ working: true, live: turn({ now: step('Reading app.ts') }) }, msgs({ who: 'you', text: 'go' }, { text: 'On it.' })))).toEqual({ step: 'Reading app.ts' })
})

test('gone when the turn ends, with or without words', () => {
  expect(signOf(chat({ working: false }, msgs({ who: 'you', text: 'go' }, { text: 'Done.' })))).toBeNull()
  expect(signOf(chat({ working: false }))).toBeNull()
  expect(signOf(chat({ working: true, live: turn({ end: 2 }), background: true }))).toBeNull()
})

test('gone when the agent stopped, crashed or finished', () => {
  expect(signOf(chat({ working: true, notice: 'ended' }))).toBeNull()
  expect(signOf(chat({ working: true, notice: 'gone' }))).toBeNull()
  expect(signOf(chat({ working: true, finished: true, live: turn() }))).toBeNull()
})

test('not for background work alone, nor while its question waits on you', () => {
  expect(signOf(chat({ working: true, background: true }))).toBeNull()
  expect(signOf(chat({ working: true, live: turn() }, msgs({ text: 'Which one?', question: { options: [] } as unknown as Message['question'] })))).toBeNull()
  expect(signOf(undefined)).toBeNull()
})
