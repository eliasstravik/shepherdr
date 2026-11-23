import { afterEach, expect, test } from 'bun:test'
import { getState, setOutbox, setUI } from '@client/kernel.ts'
import { send } from '@client/send.ts'

// A suggested reply tapped goes alone: exactly its text, while the draft's files and quoted reply stay in the box.
// The outbox is emptied at once after each send, so its delivery stops before it reaches the network.

afterEach(() => {
  setOutbox(() => [])
  setUI({ files: {}, reply: {} })
})

const draft = () => {
  setUI({
    files: { 'p:shop': [{ name: 'plan.png', path: '/tmp/plan.png' }] },
    reply: { 'p:shop': { id: 'm1', text: 'Merge it?' } },
  } as never)
}

test('a tapped reply sends only its text; the box keeps its files and its quoted reply', () => {
  draft()
  send('p:shop', 'p:shop', 'Yes, merge it', false, true)
  const [out] = getState().outbox
  setOutbox(() => [])
  expect(out!.text).toBe('Yes, merge it')
  expect(out!.files).toEqual([])
  expect(out!.reply).toBeUndefined()
  expect(getState().ui.files['p:shop']).toHaveLength(1)
  expect(getState().ui.reply['p:shop']?.id).toBe('m1')
})

test('a message from the box still takes its files and quoted reply with it, and empties them', () => {
  draft()
  send('p:shop', 'p:shop', 'here it is')
  const [out] = getState().outbox
  setOutbox(() => [])
  expect(out!.files.map((f) => f.name)).toEqual(['plan.png'])
  expect(out!.reply?.id).toBe('m1')
  expect(getState().ui.files['p:shop']).toBeUndefined()
  expect(getState().ui.reply['p:shop']).toBeUndefined()
})
