// The one list of what waits on the human: every kind of request from every chat, once, oldest first.
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreSource } from '../server/core/source.ts'
import { attentionCounts } from '../src/attention.ts'
import type { Question } from '../shared/types.ts'

const card = (id: string, extra: Partial<Question> = {}): Question => ({ id, title: id, kind: 'Question', choices: [{ label: 'Yes' }, { label: 'No' }], to: 'agent', ...extra })

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'core-needs-'))
  const source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  const task = (id: string, place: string, machine: string, extra = {}) => {
    source.store.set('agent', `${id}/Agent`, { chat: `${id}/Agent`, space: place, machine, role: 'task', kind: 'claude', launch: id, grant: id, state: 'idle', started: 1 })
    source.store.set('task', id, { id, chat: `${id}/Agent`, place, machine, name: id, folder: '/unused', workflow: 'working', review: { on: false }, age: 'now', created: new Date().toISOString(), kind: 'claude', ...extra })
  }
  source.store.set('space', 'one', { id: 'one', name: 'one', machine: 'm1', folder: '/one', prefix: 'A', mode: 'regular', added: 1 })
  source.store.set('space', 'two', { id: 'two', name: 'two', machine: 'm2', folder: '/two', prefix: 'B', mode: 'regular', added: 2 })
  source.store.set('agent', 'one', { chat: 'one', space: 'one', machine: 'm1', role: 'coordinator', kind: 'claude', launch: 'c', grant: 'c', state: 'idle', started: 1 })
  task('A-1', 'one', 'm1'); task('B-1', 'two', 'm2')
  const ask = (chat: string, grant: string, id: string, at: number, extra: Partial<Question> = {}) => {
    source.store.set('question', id, { id, chat, grant, question: card(id, extra), answered: false })
    source.store.set(`message:${chat}`, id, { id, who: 'agent', question: card(id, extra), at })
  }
  return { source, ask, task, close() { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) } }
}

test('asks at once on two machines: both listed oldest first, each once, whatever its copies', () => {
  const f = fixture()
  try {
    f.ask('B-1/Agent', 'B-1', 'later', 200)
    f.ask('A-1/Agent', 'A-1', 'first', 100)
    f.ask('one', 'c', 'coordinator', 150)
    // a copy in the coordinator's chat is a record, never a second request
    f.source.forwardQuestion('A-1/Agent', card('first'))
    const snap = f.source.snapshot()
    expect(snap.needs.map(n => [n.id, n.chat, n.place, n.task])).toEqual([['first', 'A-1/Agent', 'one', 'A-1'], ['coordinator', 'one', 'one', undefined], ['later', 'B-1/Agent', 'two', 'B-1']])
    expect(attentionCounts(snap, ['one'])).toEqual({ need: 2, ready: 0 })
    expect(attentionCounts(snap, ['two'])).toEqual({ need: 1, ready: 0 })
    expect(snap.asks).toMatchObject({ 'A-1/Agent': 'first', 'B-1/Agent': 'later', one: 'coordinator' })
  } finally { f.close() }
})

test('a plan and a merge keep their Send; a merge shows in Needs you as its task stays Ready', () => {
  const f = fixture()
  try {
    f.ask('A-1/Agent', 'A-1', 'plan', 100, { kind: 'Plan', steps: ['one'] })
    const task = f.source.tasks.get('B-1')!
    task.workflow = 'ready'; task.readyHead = 'a'.repeat(40); task.mergeQuestion = 'merge'
    f.source.store.set('task', task.id, task)
    f.source.store.set('merge-question', 'merge', { task: task.id, head: task.readyHead })
    f.source.post(task.chat, { id: 'merge', who: 'agent', question: card('merge'), at: 200 })
    const snap = f.source.snapshot()
    expect(snap.needs.map(n => [n.id, !!n.tap])).toEqual([['plan', false], ['merge', false]])
    expect(attentionCounts(snap, ['two'])).toEqual({ need: 1, ready: 1 })
    task.workflow = 'merged'; f.source.store.set('task', task.id, task)
    expect(f.source.snapshot().needs.map(n => n.id)).toEqual(['plan'])
  } finally { f.close() }
})

test('an ordinary card sends on a tap; an archived task and a removed space wait on no one', () => {
  const f = fixture()
  try {
    f.ask('A-1/Agent', 'A-1', 'yes-no', 100)
    f.ask('B-1/Agent', 'B-1', 'gone', 200)
    expect(f.source.snapshot().needs.find(n => n.id === 'yes-no')?.tap).toBe(true)
    f.task('A-1', 'one', 'm1', { archived: 5 })
    expect(f.source.snapshot().needs.map(n => n.id)).toEqual(['gone'])
    f.source.store.set('space', 'two', { id: 'two', name: 'two', machine: 'm2', folder: '/two', prefix: 'B', mode: 'regular', added: 2, removed: 1 })
    expect(f.source.snapshot().needs).toEqual([])
  } finally { f.close() }
})

test('an agent that waits with no card shows what it last said, and the reply quotes that', () => {
  const f = fixture()
  try {
    const view = f.source.tasks.view.bind(f.source.tasks)
    f.source.tasks.view = (task: Parameters<typeof view>[0]) => ({ ...view(task), status: 'need' as const, sub: 'Waits for your reply' })
    f.source.post('A-1/Agent', { id: 'said', who: 'agent', text: 'Keep the old API around?', at: 100 })
    expect(f.source.snapshot().needs.find(n => n.task === 'A-1')).toMatchObject({ id: 'attention', text: 'Keep the old API around?', reply: 'said' })
    // nothing said yet: why it waits
    expect(f.source.snapshot().needs.find(n => n.task === 'B-1')).toMatchObject({ id: 'attention', text: 'Waits for your reply' })
  } finally { f.close() }
})

test('a coordinator that ended its turn on a question waits; one that only reported does not', () => {
  const f = fixture()
  try {
    f.source.status = () => 'idle'
    f.source.post('one', { id: 'done', who: 'agent', text: 'A-1 is merged.', at: 100 })
    expect(f.source.snapshot().needs).toEqual([])
    f.source.post('one', { id: 'ask', who: 'agent', text: 'Should I start the next one?', at: 200 })
    expect(f.source.snapshot().needs).toMatchObject([{ id: 'attention', chat: 'one', at: 200, text: 'Should I start the next one?', reply: 'ask' }])
    expect(f.source.snapshot().needs[0].task).toBeUndefined()
    expect(attentionCounts(f.source.snapshot(), ['one'])).toEqual({ need: 1, ready: 0 })
    // still at work, it may yet answer itself
    f.source.status = () => 'work'
    expect(f.source.snapshot().needs).toEqual([])
    f.source.status = () => 'idle'
    f.source.post('one', { id: 'yes', who: 'you', text: 'Yes', at: 300 })
    expect(f.source.snapshot().needs).toEqual([])
  } finally { f.close() }
})

test('a reviewer blocked at its own screen with no card still counts', () => {
  const f = fixture()
  try {
    f.source.store.set('agent', 'A-1/Reviewer', { chat: 'A-1/Reviewer', space: 'one', machine: 'm1', role: 'reviewer', kind: 'claude', launch: 'r', grant: 'r', state: 'idle', started: 1 })
    f.source.agents.terminal = ((agent: { chat: string }) => agent.chat === 'A-1/Reviewer' ? { state: 'live', status: { state: 'blocked' } } : undefined) as unknown as typeof f.source.agents.terminal
    expect(f.source.snapshot().needs.map(n => [n.id, n.chat, n.task])).toEqual([['attention', 'A-1/Reviewer', 'A-1']])
  } finally { f.close() }
})

test('a reviewer asking counts: its task keeps its status, but the card waits on the human all the same', () => {
  const f = fixture()
  try {
    f.source.store.set('agent', 'A-1/Reviewer', { chat: 'A-1/Reviewer', space: 'one', machine: 'm1', role: 'reviewer', kind: 'claude', launch: 'r', grant: 'r', state: 'idle', started: 1 })
    f.source.store.set('permission', 'tool', { id: 'tool', chat: 'A-1/Reviewer', grant: 'r', expires: Date.now() + 60_000, at: 5, question: card('tool') })
    expect(f.source.snapshot().needs.map(n => [n.id, n.task, n.at])).toEqual([['tool', 'A-1', 5]])
  } finally { f.close() }
})
