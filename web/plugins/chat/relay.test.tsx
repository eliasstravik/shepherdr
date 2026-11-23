import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Relay } from '@shared/types.ts'
import { relayLabel, relayState, relayWhy } from './relay.ts'

const realMarkdown = await import('./markdown.tsx')
mock.module('./markdown.tsx', () => ({ ...realMarkdown, Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t }))
const { RelayRow } = await import('./client.tsx')

// SHEP-368: a message between agents is one quiet row as a turn's "Ran 4 commands": whom it went to or who sent it,
// its time, whether it got there; folded until tapped, then its words (and files) under it.

const AT = new Date(2026, 10, 23, 9, 14).getTime()
const draw = (r: Relay, open = false, text = 'Can you check the disk?') => renderToStaticMarkup(<RelayRow r={r} text={text} at={AT} startOpen={open} />)

test('each kind of row says whom it went to or who sent it, never as a bubble', () => {
  expect(relayLabel({ dir: 'to', name: '#root on vm-demo', how: 'assistant' })).toBe('Message to #root on vm-demo')
  expect(relayLabel({ dir: 'to', name: 'Fix login', how: 'reply' })).toBe('Message to Fix login')
  expect(relayLabel({ dir: 'to', name: 'Fix login', how: 'fix' })).toBe('Message to Fix login')
  expect(relayLabel({ dir: 'to', name: 'Assistant', how: 'hc' })).toBe('Message to Assistant')
  expect(relayLabel({ dir: 'from', name: 'Everything on Mac' })).toBe('Message from Everything on Mac')
  expect(relayLabel({ dir: 'from', name: 'Fix login' })).toBe('Message from Fix login')
  const html = draw({ dir: 'to', name: '#root on vm', state: 'delivered' })
  expect(html).toContain('class="fold quiet relay"')
  expect(html).not.toContain('class="b ')
  expect(html).toContain('9:14')
})

test('folded, its words are not drawn; opened, they are, with the files it came with', () => {
  const closed = draw({ dir: 'from', name: '#shop', files: ['quotes.pdf'] })
  expect(closed).toContain('aria-expanded="false"')
  expect(closed).not.toContain('Can you check the disk?')
  expect(closed).not.toContain('quotes.pdf')
  const open = draw({ dir: 'from', name: '#shop', files: ['quotes.pdf'] }, true)
  expect(open).toContain('aria-expanded="true"')
  expect(open).toContain('class="quietb relayb"')
  expect(open).toContain('Can you check the disk?')
  expect(open).toContain('quotes.pdf')
})

test('whether it got there: delivered, waiting and not delivered, with why once opened; a received one says nothing', () => {
  expect(relayState({ dir: 'to', name: 'x', state: 'delivered' })).toEqual({ word: 'Delivered' })
  expect(relayState({ dir: 'to', name: 'x', state: 'waiting' })).toEqual({ word: 'Waiting', tone: 'amber' })
  expect(relayState({ dir: 'to', name: 'x', state: 'failed' })).toEqual({ word: 'Not delivered', tone: 'red' })
  expect(relayState({ dir: 'to', name: 'x' })).toEqual({ word: '' })
  expect(relayState({ dir: 'from', name: 'x', state: 'delivered' })).toEqual({ word: '' })
  expect(relayWhy({ dir: 'to', name: 'x', state: 'waiting', why: 'the person is writing to it' })).toBe('Not delivered yet: the person is writing to it. It goes by itself.')
  expect(relayWhy({ dir: 'to', name: 'x', state: 'failed', why: "studio can't be reached" })).toBe("Not delivered: studio can't be reached.")
  expect(relayWhy({ dir: 'to', name: 'x', state: 'delivered' })).toBe('')
  const failed = draw({ dir: 'to', name: 'x', state: 'failed', why: "studio can't be reached" })
  expect(failed).toContain('c-red')
  expect(failed).toContain('Not delivered')
  expect(failed).not.toContain("can&#x27;t be reached")
  expect(draw({ dir: 'to', name: 'x', state: 'failed', why: "studio can't be reached" }, true)).toContain('studio can&#x27;t be reached')
  expect(draw({ dir: 'to', name: 'x', state: 'waiting' })).toContain('Waiting')
})
