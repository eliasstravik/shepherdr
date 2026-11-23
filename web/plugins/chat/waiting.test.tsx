import { expect, mock, test } from 'bun:test'

const realMarkdown = await import('./markdown.tsx')
mock.module('./markdown.tsx', () => ({ ...realMarkdown, Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t }))
const { waitingIn } = await import('./client.tsx')

// Which cards still wait for an answer: only those get the reminder above the box; an answered one is just a row
// where it was (SHEP-419).

const thread = { chat: 'p:sp1', place: 'sp1', where: 'chat' } as never
const q = (id: string, more: object = {}) => ({ msg: { id, who: 'agent', at: 1, question: { id, title: 'Turn it on?', choices: [], by: { ref: 'T-1', title: 'Watch build', chat: 'T-1/worker' }, ...more } } }) as never

test('an open question waits, named by its task', () => {
  expect(waitingIn([q('q1')], thread)).toEqual([{ id: 'q1', words: 'Watch build asks you' }])
})

test('an answered or closed question does not', () => {
  expect(waitingIn([q('q1', { sent: 0 }), q('q2', { closed: 'Answered in the terminal' })], thread)).toEqual([])
})

test('a secret asked for waits until it is saved', () => {
  const s = (saved?: string) => ({ msg: { id: 's', who: 'agent', at: 1, secret: { id: 's1', name: 'API_KEY', why: '', levels: [], ...(saved ? { saved } : {}) } } }) as never
  expect(waitingIn([s()], thread)).toEqual([{ id: 's1', words: 'A secret is asked for: API_KEY' }])
  expect(waitingIn([s('Saved')], thread)).toEqual([])
})
