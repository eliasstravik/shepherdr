import { expect, test } from 'bun:test'
import { suggestionOf, suggestionsOn } from './suggest.ts'
import type { Chat, Message } from '@shared/types.ts'

const chat = (messages: Partial<Message>[]) => ({ key: 'p:sp1', messages: messages.map((m, i) => ({ id: `m${i}`, who: 'agent', ...m })) }) as Chat

test('the newest agent text with a suggestion is the ghost text', () => {
  expect(suggestionOf(chat([{ who: 'you', text: 'hi' }, { text: 'Merge it?', suggest: 'yes, merge it' }]), true))
    .toEqual({ id: 'm1', text: 'yes, merge it' })
})

test('nothing after the person wrote, and nothing from an agent reply without a suggestion', () => {
  expect(suggestionOf(chat([{ text: 'Merge it?', suggest: 'yes' }, { who: 'you', text: 'no' }]), true)).toBeNull()
  expect(suggestionOf(chat([{ text: 'Merge it?', suggest: 'yes' }, { text: 'Merged.' }]), true)).toBeNull()
})

test('rows that are not words (activity, news) never hide or replace a suggestion', () => {
  expect(suggestionOf(chat([{ text: 'Merge it?', suggest: 'yes' }, { activity: undefined, news: undefined } as Partial<Message>]), true))
    .toEqual({ id: 'm0', text: 'yes' })
})

test('a suggestion never shows with the setting off, nor in an empty chat', () => {
  expect(suggestionOf(chat([{ text: 'Merge it?', suggest: 'yes' }]), false)).toBeNull()
  expect(suggestionOf(undefined, true)).toBeNull()
  expect(suggestionOf(chat([]), true)).toBeNull()
})

test('the setting is on unless Settings says off', () => {
  const row = (value: string) => [{ rows: [{ key: 'agents.suggestions', value }] }]
  expect(suggestionsOn(row('on'))).toBe(true)
  expect(suggestionsOn(row('off'))).toBe(false)
  expect(suggestionsOn(undefined)).toBe(true)
})
