import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot, Task } from '@shared/types.ts'
import { snapshot } from '../../demo/data.ts'

// #1560 (13): the details an agent writes with ready (what changed, how it was checked) show on the review card,
// folded under its summary, as agents are told they do.

mock.module('@plugins/chat/markdown.tsx', () => ({ Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t, withLinks: (t: string) => [t] }))
const snap: Snapshot = snapshot()
const kernel = await import('@client/kernel.ts')
mock.module('@client/kernel.ts', () => ({ ...kernel, useSnap: () => snap }))
const { ReviewCard } = await import('./client.tsx')

const ready = { id: 'SHOP-9', name: 'Fix login', place: snap.places[0]!.id, status: 'ready', state: 'ready', created: '', age: '', repo: 'folder' } as Task
const card = (t: Partial<Task>) => renderToStaticMarkup(<ReviewCard t={{ ...ready, ...t }} ctx="thread" />)
const text = (html: string) => html.replace(/<[^>]+>/g, ' ')

test('details fold under the summary, closed at first', () => {
  const html = card({ summary: 'Login works again', details: '- The form keeps your email\n- Checked with the login tests' })
  expect(text(html)).toContain('Login works again')
  expect(html).toContain('aria-expanded="false"')
  expect(text(html)).toContain('Details')
  expect(html).not.toContain('The form keeps your email')
})

test('no details: no fold', () => {
  expect(text(card({ summary: 'Login works again' }))).not.toContain('Details')
})

test('an older summary too long to read at a glance keeps its first sentence up top and folds the whole', () => {
  const long = `Login works again. ${'The form now keeps the email you typed when the password was wrong, so you only type the password again. '.repeat(2)}`
  const html = card({ summary: long })
  expect(text(html)).toContain('Login works again.')
  expect(text(html)).toContain('Details')
})
