import { expect, test } from 'bun:test'
import { Compat } from './compat.ts'
import { HOME } from './paths.ts'

test('a voice answer appears in the task, its space and Everything', () => {
  const c: any = new Compat()
  c.shared = { value: (key: string) => key === 'voice.answers' ? [{ id: 'q1', chat: 'SHOP-2/worker', text: 'Stripe', at: 100 }] : null }
  c.spaceList = [{ id: 'home', folder: HOME, machine: null }, { id: 'sp1', folder: '/shop', machine: null }, { id: 'other', folder: '/other', machine: null }]
  c.rows = [{ ref: 'SHOP-2', space: 'sp1', folder: '/shop', machine: null }]
  const reader: any = { addr: 'log', machine: null, kind: 'claude', conv: { items: [
    { id: 'before', kind: 'agent', text: 'Which provider?', at: 50 },
    { id: 'after', kind: 'agent', text: 'I will use Stripe.', at: 150 },
  ] }, start: 0, pinned: true, state: 'ready', jobs: () => [] }
  const find = (key: string) => c.chat(key, reader, null).messages.find((m: any) => m.byVoice)
  for (const key of ['SHOP-2/worker', 'p:sp1', 'p:home']) expect(find(key)).toMatchObject({ text: 'Stripe', byVoice: true })
  for (const key of ['SHOP-2/worker', 'p:sp1', 'p:home']) {
    const messages = c.chat(key, reader, null).messages
    expect(messages.map((m: any) => m.id)).toEqual(['before', 'voice-answer:q1', 'after'])
  }
  expect(find('p:other')).toBeUndefined()
})
