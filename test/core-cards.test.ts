import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreSource } from '../server/core/source.ts'
import type { Message, Question } from '../shared/types.ts'

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'core-card-display-'))
  const source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  source.store.set('space', 'space', { id: 'space', name: 'Example', machine: 'machine', folder: '/unused', prefix: 'EX', mode: 'regular', added: 1 })
  source.store.set('agent', 'EX-1/Agent', { chat: 'EX-1/Agent', space: 'space', machine: 'machine', role: 'task', kind: 'claude', launch: 'one', grant: 'current', state: 'idle', started: 1 })
  source.store.set('task', 'EX-1', { id: 'EX-1', chat: 'EX-1/Agent', place: 'space', machine: 'machine', name: 'Example', folder: '/unused', workflow: 'todo', review: { on: false }, age: 'now', created: new Date().toISOString(), kind: 'claude' })
  return { source, close() { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) } }
}
const question: Question = { id: 'permission-one', title: 'Use tool?', kind: 'Question', choices: [{ label: 'Allow once' }, { label: 'Deny' }], to: 'EX-1/Agent' }
function post(source: CoreSource, at = 100) {
  source.post('EX-1/Agent', { id: 'permission-one', who: 'agent', question, at })
  source.forwardQuestion('EX-1/Agent', question)
}
test('expired and replaced permission copies close without changing history or granting authority', async () => {
  const f = fixture()
  try {
    post(f.source)
    const forwarded = f.source.chat('space')!.messages.find(message => message.card?.ask)!
    const at = forwarded.at
    // Already-settled canonical records can outlive an older open chat copy.
    f.source.store.set('permission', question.id, { id: question.id, chat: 'EX-1/Agent', grant: 'current', settled: true, allow: false, expires: 1, question: { ...question, sent: -1, said: 'Permission request expired' } })
    expect(f.source.chat('EX-1/Agent')!.messages[0].question?.sent).toBe(-1)
    const closed = f.source.chat('space')!.messages.find(message => message.card?.ask)!
    expect(closed.card!.ask!.open).toBe(false)
    expect(closed.card!.ask!.questions![0].said).toBe('Permission request expired')
    expect(closed.at).toBe(at)
    await expect(f.source.act({ type: 'answer', chat: 'EX-1/Agent', question: question.id, choice: 0 })).rejects.toThrow('no longer waiting')
    expect(f.source.store.get<{ allow: boolean }>('permission', question.id)?.allow).toBe(false)
    // An unexpired request from another launch closes too, even before a stored copy is reconciled.
    f.source.store.set('permission', question.id, { id: question.id, chat: 'EX-1/Agent', grant: 'previous', expires: Date.now() + 60000, question })
    expect(f.source.chat('space')!.messages.find(message => message.card?.ask)!.card!.ask!.questions![0].said).toContain('Session replaced')
  } finally { f.close() }
})
test('permission expiry refreshes both chats and keeps its authority denied', async () => {
  const f = fixture()
  try {
    post(f.source)
    f.source.store.set('permission', question.id, { id: question.id, chat: 'EX-1/Agent', grant: 'current', expires: Date.now() - 1, question })
    // A normal chat update reconciles pending permission ownership/expiry.
    f.source.post('EX-1/Agent', { id: 'new', who: 'agent', text: 'continued', at: 200 })
    expect(f.source.store.get<{ settled: boolean; allow: boolean }>('permission', question.id)).toMatchObject({ settled: true, allow: false })
    const forwarded = f.source.chat('space')!.messages.find(message => message.card?.ask)!
    expect(forwarded.card!.text).toBe('No longer waiting')
    expect(forwarded.card!.ask!.questions![0].sent).toBe(-1)
    expect(f.source.snapshot().asks['EX-1/Agent']).toBeUndefined()
  } finally { f.close() }
})

test('an open merge card shows the checks of its own commit and the proof that came after ready', () => {
  const f = fixture(), head = 'a'.repeat(40), q = { ...question, id: 'merge-live', title: 'Merge EX-1?', evidence: { commit: 'aaaaaaa', checks: { state: 'running' as const, text: '1 running' } } }
  try {
    const task = f.source.tasks.get('EX-1')!
    task.workflow = 'ready'; task.readyHead = head; task.mergeQuestion = q.id
    f.source.store.set('task', task.id, task); f.source.store.set('merge-question', q.id, { task: task.id, head })
    f.source.post(task.chat, { id: q.id, who: 'agent', question: q, at: 100 })
    const shown = () => f.source.chat(task.chat)!.messages[0].question!.evidence!
    f.source.store.set('github-pr', task.id, { head: 'b'.repeat(40), checks: { state: 'failed', text: '1 failed' } })
    expect(shown().checks.text).toBe('1 running')
    f.source.store.set('github-pr', task.id, { head, checks: { state: 'passed', text: '3 passed' } })
    expect(shown().checks.text).toBe('3 passed')
    expect(shown().proof).toBeUndefined()
    f.source.store.set('core-artifact', 'pf', { id: 'pf', title: 'EX-1: Proof', place: 'space', at: 2, versions: [{ n: 1, at: 2, by: 'x', chat: task.chat, html: 1 }] })
    f.source.store.set('core-artifact', 'no', { id: 'no', title: 'Other task: Proof', place: 'space', at: 3, versions: [{ n: 1, at: 3, by: 'x', chat: 'EX-2/Agent', html: 1 }] })
    expect(shown().proof).toEqual({ id: 'pf', title: 'EX-1: Proof' })
  } finally { f.close() }
})

test('merged and replaced merge cards close in original and forwarded chats without granting an answer', async () => {
  const f = fixture(), q = { ...question, id: 'merge-proof', title: 'Merge EX-1?', choices: [{ label: 'Merge' }, { label: 'Not yet' }] }
  try {
    const task = f.source.tasks.get('EX-1')!
    task.workflow = 'ready'; task.readyHead = 'a'.repeat(40); task.mergeQuestion = q.id
    f.source.store.set('task', task.id, task)
    f.source.store.set('merge-question', q.id, { task: task.id, head: task.readyHead })
    f.source.post(task.chat, { id: q.id, who: 'agent', question: q, at: 100 })
    f.source.forwardQuestion(task.chat, q)
    expect(f.source.chat(task.chat)!.messages[0].question?.closed).toBeUndefined()
    task.workflow = 'merged'; f.source.store.set('task', task.id, task)
    expect(f.source.chat(task.chat)!.messages[0].question).toMatchObject({ sent: -1, closed: 'This task is already merged' })
    const forwarded = f.source.chat('space')!.messages.find(m => m.card?.ask)!
    expect(forwarded.card?.ask?.open).toBe(false)
    expect(forwarded.card?.ask?.questions?.[0].closed).toBe('This task is already merged')
    expect(f.source.chat(task.chat)!.messages[0].at).toBe(100)
    expect(f.source.tasks.get(task.id)?.approvedHead).toBeUndefined()
    await expect(f.source.tasks.answer(q.id, 0, task.chat)).rejects.toThrow('no longer current')
    task.workflow = 'ready'; task.mergeQuestion = 'new-request'; f.source.store.set('task', task.id, task)
    expect(f.source.chat(task.chat)!.messages[0].question?.closed).toBe('This merge request is no longer current')
  } finally { f.close() }
})


test('health cards display machine names without rewriting stored identity or historical labels', () => {
  const f = fixture()
  try {
    const machine = f.source.localMachineId()
    f.source.store.set('name', `m:${machine}`, 'Readable computer')
    const original: Message = { id: 'health-proof', who: 'agent', card: { id: 'health-proof', text: 'CPU crossed its alert limit', health: { machine, level: 'over' } } }
    expect(f.source.cards.messages('space', [original])[0].card?.health?.machine).toBe('Readable computer')
    expect(original.card?.health?.machine).toBe(machine)
    const historical: Message = { ...original, card: { ...original.card!, health: { machine: 'Previously named computer', level: 'over' } } }
    expect(f.source.cards.messages('space', [historical])[0].card?.health?.machine).toBe('Previously named computer')
  } finally { f.close() }
})
