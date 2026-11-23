import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, Message, Task, TaskBrief } from '@shared/types.ts'
import { briefFrom, deliveryWord, looksLong, startWords } from './brief.ts'

// the formatted words need a browser (DOMPurify): here they are drawn as they are; every other export stays the real one
const realMarkdown = await import('./markdown.tsx')
mock.module('./markdown.tsx', () => ({ ...realMarkdown, Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t }))
const { BriefMessage } = await import('./client.tsx')

// SHEP-330: a task's page is never blank. Its brief is the first message; until its agent is at work, words say why.

const task = (x: Partial<Task>): Task => ({ id: 'SHOP-3', name: 'Bigger card', place: 'p:local:shop', status: 'work', state: 'working', on: 'mac', created: '', age: '', ...x }) as Task
const agent = { chat: 'SHOP-3/worker', role: 'worker', cli: 'claude', status: 'work' as const, running: true, age: '', note: '' }
const brief = (b: Partial<TaskBrief> = {}): TaskBrief => ({ title: 'Bigger card', text: 'Make the card bigger.', from: 'Assistant', state: 'sent', ...b })
const chat = (messages: Partial<Message>[], x: Partial<Chat> = {}): Chat => ({ key: 'SHOP-3/worker', cli: 'claude', messages: messages.map((m, i) => ({ id: `m${i}`, who: 'agent', ...m })) as Message[], ...x })
const briefMsg = (state: TaskBrief['state']) => ({ id: 'b', who: 'you' as const, taskBrief: brief({ state }) })
const draw = (b: TaskBrief) => renderToStaticMarkup(<BriefMessage msg={{ id: 'b', who: 'you', taskBrief: b }} b={b} />)

test('the brief before its agent starts: from the Assistant, its title and words, not sent yet', () => {
  const html = draw(brief({ state: 'waiting' }))
  expect(html).toContain('From the Assistant')
  expect(html).toContain('Bigger card')
  expect(html).toContain('Make the card bigger.')
  expect(html).toContain('Not sent yet')
})

test('the brief once its agent started: sent, then read', () => {
  expect(draw(brief({ state: 'sent' }))).toContain('Sent')
  expect(draw(brief({ state: 'read' }))).toContain('Read')
  expect([deliveryWord('waiting'), deliveryWord('sent'), deliveryWord('read')]).toEqual(['Not sent yet', 'Sent', 'Read'])
  expect(briefFrom('shop')).toBe('From the Assistant in #shop')
})

test('a long brief starts folded with Show all; a short one shows whole', () => {
  const long = `Make the card bigger.\n\nDo:\n${Array.from({ length: 12 }, (_, i) => `- step ${i + 1}`).join('\n')}`
  expect(looksLong(long)).toBe(true)
  expect(looksLong('Make the card bigger.')).toBe(false)
  expect(looksLong('x'.repeat(400))).toBe(true)
  const html = draw(brief({ text: long }))
  expect(html).toContain('bbody clip fade')
  expect(html).toContain('Show all')
  const short = draw(brief())
  expect(short).not.toContain('Show all')
  expect(short).not.toContain('fade')
})

test('its Settings are folded away: one Settings row, its lines not drawn until opened', () => {
  const html = draw(brief({ settings: ['Review: off', 'Merge: after checks'] }))
  expect(html).toContain('Settings')
  expect(html).toContain('aria-expanded="false"')
  expect(html).not.toContain('Review: off')
})

test('queued and scheduled say what they wait for; to do says it waits for a go', () => {
  expect(startWords(task({ status: 'queued', afterTitle: 'Fix login' }), undefined)).toBe('Queued. It starts when “Fix login” is done.')
  expect(startWords(task({ status: 'queued' }), undefined)).toBe('Queued. It starts when the tasks before it are done.')
  expect(startWords(task({ status: 'scheduled', left: '6h' }), undefined)).toBe('Scheduled. It starts in 6h.')
  expect(startWords(task({ status: 'todo' }), undefined)).toBe('Not started yet. It starts when you say go.')
})

test('starting: its agent is up with only the brief in its chat; the words go once it says or does anything', () => {
  // to do with its agent starting, or Working with its log not opened yet
  expect(startWords(task({ status: 'todo', agent, started: 1 }), chat([briefMsg('sent')], { notice: 'opening' }))).toBe('Its agent is starting.')
  expect(startWords(task({ status: 'work', agent }), chat([briefMsg('sent')]))).toBe('Its agent is starting.')
  // at work: the working sign says so instead
  expect(startWords(task({ status: 'work', agent }), chat([briefMsg('read')], { working: true }))).toBe('')
  // its words or steps came
  expect(startWords(task({ status: 'work', agent }), chat([briefMsg('read'), { text: 'On it.' }]))).toBe('')
  expect(startWords(task({ status: 'work', agent }), chat([briefMsg('read'), { activity: { id: 'a', at: 1, rows: [], steps: 1 } }]))).toBe('')
  // its chat not here yet: nothing guessed
  expect(startWords(task({ status: 'work', agent }), undefined)).toBe('')
  // ready, needs you, done: nothing to add
  expect(startWords(task({ status: 'ready', agent }), chat([briefMsg('read')]))).toBe('')
})
