import { expect, mock, test } from 'bun:test'

const sent: unknown[] = []
let answer: unknown = { ok: true }
mock.module('@client/kernel.ts', () => ({ act: async (a: unknown) => { sent.push(a); const r = answer; answer = { ok: true }; return r } }))
const { forkChat } = await import('./fork.ts')
const ask = { title: "This task's agent is still running", detail: 'Two agents would edit the same files.', verb: 'Fork anyway', cancel: 'Keep the live one' }

test('#1050: a plain fork goes at once', async () => {
  sent.length = 0
  expect(await forkChat('c1', () => { throw new Error('no ask') })).toBe(true)
  expect(sent).toEqual([{ type: 'fork', chat: 'c1' }])
})

test("#1050: a running task's fork asks; Cancel keeps the live one, OK forks anyway", async () => {
  sent.length = 0
  answer = { ok: false, ask }
  let shown = ''
  expect(await forkChat('c1', (t) => { shown = t; return false })).toBe(false)
  expect(shown).toContain("This task's agent is still running")
  expect(shown).toContain('Cancel: Keep the live one.')
  expect(sent).toEqual([{ type: 'fork', chat: 'c1' }])
  answer = { ok: false, ask }
  expect(await forkChat('c1', () => true)).toBe(true)
  expect(sent.slice(1)).toEqual([{ type: 'fork', chat: 'c1' }, { type: 'fork', chat: 'c1', force: true }])
})
