import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreSource } from '../server/core/source.ts'
import type { CoreAgent, CoreSpace } from '../server/core/model.ts'
import type { Grant } from '../server/core/mailbox.ts'

test('answer and delivery are durable while offline, and stale cards cannot answer a replacement', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-question-'))
  const source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  try {
    const agent: CoreAgent = { chat: 'space', space: 'space', machine: 'machine', role: 'coordinator', kind: 'codex', launch: 'launch-one', grant: 'grant-one', hook: '/unused', state: 'idle', started: Date.now() }
    source.store.set('agent', agent.chat, agent)
    source.store.set('space', 'space', { id: 'space', name: 'Example', machine: 'machine', folder: '/unused', base: 'main', prefix: 'EX', mode: 'regular', added: 1 } satisfies CoreSpace)
    const grant = { chat: agent.chat, id: agent.grant } as Grant
    const first = source.questions.create(grant, ['ask', 'Continue?', '--choice', 'Yes', '--choice', 'No'])
    await source.questions.answer({ type: 'answer', chat: agent.chat, question: first, choice: 0 })
    expect(source.questions.open()).toHaveLength(0)
    expect(source.store.get('pending-send', `answer-${first}`)).toMatchObject({ chat: agent.chat, launch: agent.launch, state: 'queued' })
    const second = source.questions.create(grant, ['ask', 'Approve?', '--choice', 'Yes'])
    source.store.set('agent', agent.chat, { ...agent, grant: 'grant-two', launch: 'launch-two' })
    await expect(source.questions.answer({ type: 'answer', chat: agent.chat, question: second, choice: 0 })).rejects.toThrow('replaced')
    expect(source.store.get('pending-send', `answer-${second}`)).toBeUndefined()
    expect(source.questions.open()).toHaveLength(0)
    source.questions.reconcile(agent.chat)
    expect(source.store.get<{ question: { sent: number } }>('question', second)?.question.sent).toBe(-1)
  } finally { source.stop(); await Promise.resolve(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
})


test('a queued answer never launches a replacement for a finished session', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-answer-session-'))
  const source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  try {
    source.store.set('agent', 'chat', { chat: 'chat', space: 'chat', machine: 'machine', role: 'coordinator', kind: 'codex', launch: 'old', grant: 'grant', hook: '/unused', state: 'idle', started: 1 } satisfies CoreAgent)
    source.store.set('space', 'chat', { id: 'chat', name: 'Example', machine: 'machine', folder: '/unused', base: 'main', prefix: 'EX', mode: 'regular', added: 1 } satisfies CoreSpace)
    source.connected = () => true
    source.agents.terminal = () => ({ state: 'finished' }) as ReturnType<typeof source.agents.terminal>
    source.agents.launch = async () => { throw new Error('must never launch') }
    source.saveAndDeliver('chat', 'answer-one', '<answer>Approve</answer>', () => {})
    await Promise.resolve(); await Promise.resolve()
    expect(source.store.get('pending-send', 'answer-one')).toMatchObject({ state: 'uncertain', launch: 'old' })
    expect(source.agents.get('chat')?.launch).toBe('old')
    expect(source.chat('chat')?.messages.find(message => message.id === 'delivery-answer-one')?.text).toContain('could not confirm delivery')
  } finally { source.stop(); await Promise.resolve(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
})
