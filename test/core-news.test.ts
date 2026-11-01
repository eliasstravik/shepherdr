import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreSource } from '../server/core/source.ts'
import { CoreTaskNews } from '../server/core/news.ts'
import type { CoreAgent, CoreSpace } from '../server/core/model.ts'
import type { CoreTask } from '../server/core/tasks.ts'
import type { CoreTerminal } from '../server/core/protocol.ts'

async function fixture(work: (f: ReturnType<typeof setup>) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-news-')), source = new CoreSource({ home, socket: '/unused', binary: 'hc', session: 'test', port: 0 })
  try { await work(setup(source)) } finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
}
function setup(source: CoreSource) {
  const local = source.localMachineId(), spaces = [['main-home', local, true], ['remote-home', 'remote', true], ['app', 'remote', false], ['other', 'remote', false]].map(([id, machine, home]) => ({ id: String(id), name: String(id), machine: String(machine), home: !!home, folder: '/repo', base: 'main', prefix: 'APP', mode: 'regular', added: 1 })) as CoreSpace[]
  const terminals = new Map<string, CoreTerminal>()
  for (const space of spaces) {
    source.store.set('space', space.id, space)
    const agent = { chat: space.id, space: space.id, machine: space.machine, role: 'coordinator', kind: 'claude', launch: space.id + '-launch', grant: space.id + '-grant', state: 'idle', started: 1, hook: '/unused' } as CoreAgent
    source.store.set('agent', agent.chat, agent)
    terminals.set(agent.launch, { address: 'holder-' + agent.launch, state: 'live' } as CoreTerminal)
  }
  const task = { id: 'box/APP-1', name: 'Own task', place: 'app', machine: 'remote', chat: 'box/APP-1/Agent', workflow: 'working', kind: 'claude', branch: 'work/one', base: 'main', age: 'now', launchAttempt: 'attempt' } as CoreTask
  const worker = { chat: task.chat, space: task.place, machine: task.machine, role: 'task', kind: 'claude', launch: 'worker', grant: 'worker-grant', state: 'working', started: 1, activityAt: 1, hook: '/unused' } as CoreAgent
  source.store.set('task', task.id, task); source.store.set('agent', worker.chat, worker)
  terminals.set(worker.launch, { address: 'worker', state: 'live', status_ms: 1 } as CoreTerminal)
  source.agents.terminal = agent => terminals.get(agent.launch)
  source.connected = () => true; source.machineConnected = () => true
  source.status = agent => agent?.state === 'working' ? 'work' : 'idle'
  const sent: { chat: string; id: string; text: string; quiet?: boolean }[] = []
  source.saveAndDeliver = (chat, id, text, save, quiet) => { save(); sent.push({ chat, id, text, quiet }) }
  return { source, task, worker, terminals, sent }
}

test('task news reaches its own regular coordinator and main overview once, never unrelated regular spaces', () => fixture(async f => {
  f.task.workflow = 'ready'; f.task.readyAt = 10; f.source.store.set('task', f.task.id, f.task)
  f.source.news.record(f.task, 'ready', 10)
  f.source.news.deliver(10)
  expect(f.sent.map(item => item.chat)).toEqual(['app', 'main-home'])
  expect(f.sent.every(item => item.quiet && item.text.startsWith('<news>'))).toBe(true)
  expect(f.sent.every(item => item.text.includes('"merge":"on its own"'))).toBe(true)
  new CoreTaskNews(f.source).deliver(11)
  expect(f.sent).toHaveLength(2)
  const rows = f.source.store.all<{ state: string; launch: string }>('task-news')
  expect(rows.every(item => item.state === 'queued' && item.launch)).toBe(true)
  expect(f.source.logs.messages('main-home').some(message => message.card?.task === f.task.id)).toBe(true)
}))

test('one task keeps one row in each chat, updated where it stands, and the chat still shows as changed', () => fixture(async f => {
  const rows = (chat: string) => f.source.logs.messages(chat).filter(message => message.card?.task === f.task.id)
  const question = { id: 'one', title: 'Which?', kind: 'Question' as const, choices: [{ label: 'A' }], to: f.task.chat }
  f.source.taskRow('app', f.task, { status: 'work', text: 'Started' }, 10)
  f.source.forwardQuestion(f.task.chat, question)
  f.source.forwardQuestion(f.task.chat, { ...question, id: 'two' })
  f.source.forwardQuestion(f.task.chat, question, 'A')
  f.source.taskRow('app', f.task, { status: 'ready', text: 'Ready: It works' }, 40)
  f.source.news.record(f.task, 'merged', 50)
  expect(rows('app')).toHaveLength(1)
  expect(rows('main-home')).toHaveLength(1)
  expect(rows('app')[0]).toMatchObject({ at: 10, updated: 40, card: { text: 'Ready: It works', status: 'ready' } })
  expect(rows('app')[0].card!.ask!.questions!.map(item => item.id)).toEqual(['two', 'one'])
  expect(rows('main-home')[0].card!.text).toBe('Merged')
  expect(f.source.unread.last().app).toBeGreaterThan(10)
}))

test('news tells the coordinator the row already shows it, and to stay quiet unless it has more to say', () => fixture(async f => {
  f.task.workflow = 'ready'; f.task.readyAt = 10; f.source.store.set('task', f.task.id, f.task)
  f.source.news.record(f.task, 'ready', 10); f.source.news.deliver(10)
  expect(f.sent[0].text).toContain('live row')
  expect(f.sent[0].text).toContain('no-reply marker unless you have something to add')
}))

test('Ready news carries each task\'s real Merge setting, and other news does not', () => fixture(async f => {
  f.task.workflow = 'ready'; f.task.readyAt = 10
  for (const [policy, words] of [['ask', 'ask the human first'], ['checks', 'after GitHub checks'], ['auto', 'on its own']] as const) {
    f.sent.length = 0; f.task.mergePolicy = policy; f.source.store.set('task', f.task.id, f.task)
    f.source.news.record(f.task, 'ready', 10); f.source.news.deliver(10)
    expect(f.sent[0].text).toContain(`"merge":"${words}"`)
    for (const row of f.source.store.all<{ id: string; state: string }>('task-news')) f.source.store.set('task-news', row.id, { ...row, state: 'cancelled' })
  }
  f.sent.length = 0; f.task.workflow = 'working'; f.source.store.set('task', f.task.id, f.task)
  f.source.news.record(f.task, 'needs-you', 11)
  expect(f.source.store.all<{ state: string; text: string }>('task-news').filter(row => row.state === 'waiting').every(row => !row.text.includes('merge'))).toBe(true)
}))

test('waiting news waits for idle/reconnect, cancels changed evidence, and never starts an absent coordinator', () => fixture(async f => {
  for (const chat of ['app', 'main-home']) f.source.store.set('agent', chat, { ...f.source.agents.get(chat)!, state: 'working' })
  f.source.news.record(f.task, 'stalled', 10)
  f.source.news.deliver(10); expect(f.sent).toHaveLength(0)
  f.source.store.set('agent', f.worker.chat, { ...f.worker, activityAt: 2 })
  for (const chat of ['app', 'main-home']) f.source.store.set('agent', chat, { ...f.source.agents.get(chat)!, state: 'idle' })
  f.source.news.deliver(11); expect(f.sent).toHaveLength(0)
  expect(f.source.store.all<{ state: string }>('task-news').every(item => item.state === 'cancelled')).toBe(true)
  f.source.store.delete('agent', 'main-home')
  f.task.workflow = 'ready'; f.task.readyAt = 12; f.source.store.set('task', f.task.id, f.task)
  f.source.news.record(f.task, 'ready', 12)
  f.source.machineConnected = () => false
  f.source.news.deliver(12); expect(f.sent).toHaveLength(0)
  f.source.machineConnected = () => true
  f.source.news.deliver(13); expect(f.sent.map(item => item.chat)).toEqual(['app'])
}))

test('failure and Ready observations cannot follow a replacement worker or a changed Ready attempt', () => fixture(async f => {
  const failed = { ...f.task, workflow: 'todo' as const, startError: 'Could not start' }
  f.source.store.set('task', failed.id, failed); f.source.news.record(failed, 'failed', 10)
  f.source.store.set('agent', f.worker.chat, { ...f.worker, launch: 'replacement' })
  f.source.news.deliver(11); expect(f.sent).toHaveLength(0)
  const ready = { ...failed, workflow: 'ready' as const, startError: undefined, readyAt: 1 }
  f.source.store.set('task', ready.id, ready); f.source.news.record(ready, 'ready', 12)
  f.source.store.set('task', ready.id, { ...ready, readyAt: 2 })
  f.source.news.deliver(13); expect(f.sent).toHaveLength(0)
}))

test('home Autopilot receives original-space news through its own configured wake path', () => fixture(async f => {
  for (const id of ['main-home', 'remote-home']) f.source.store.set('space', id, { ...f.source.space(id)!, mode: 'autopilot' })
  const wakes: { event: unknown; home: string }[] = []
  f.source.pilots.wakes.news = (event, home) => { wakes.push({ event, home }) }
  const failed = { ...f.task, workflow: 'todo' as const, startError: 'Expected start failure' }
  f.source.store.set('task', failed.id, failed)
  f.source.news.record(failed, 'failed', 10)
  expect(wakes).toEqual([{ home: 'main-home', event: { event: 'failed', title: f.task.name, branch: f.task.branch, space: 'app' } }, { home: 'remote-home', event: { event: 'failed', title: f.task.name, branch: f.task.branch, space: 'app' } }])
  f.source.news.deliver(10)
  expect(f.sent.map(item => item.chat)).toEqual(['app'])
}))

test('per-pass delivery is bounded per coordinator and old settled receipts can be pruned without replay', () => fixture(async f => {
  f.task.workflow = 'ready'; f.task.readyAt = 1; f.source.store.set('task', f.task.id, f.task)
  const other = { ...f.task, id: 'APP-2', chat: 'APP-2/Agent', readyAt: 2 }; f.source.store.set('task', other.id, other)
  f.source.news.record(f.task, 'ready', 1)
  f.source.news.record(other, 'ready', 2)
  f.source.news.deliver(3)
  expect(f.sent).toHaveLength(2)
  f.source.news.deliver(4)
  expect(f.sent).toHaveLength(4)
  f.source.news.deliver(8 * 86400000)
  expect(f.source.store.all('task-news')).toHaveLength(0)
  expect(f.sent).toHaveLength(4)
}))

test('an overdue ETA remains news across fresh activity but a changed report invalidates it', () => fixture(async f => {
  const task = { ...f.task, report: { msg: 'Working', progress: 10, eta: 5 }, reportedAt: 1 }
  f.source.store.set('task', task.id, task)
  const now = 30 * 60000
  f.source.news.record(task, 'stalled', now, { overReport: 1 })
  f.source.store.set('agent', f.worker.chat, { ...f.worker, activityAt: now + 1 })
  f.source.news.deliver(now + 2)
  expect(f.sent).toHaveLength(2)
  f.source.news.record(task, 'stalled', now + 3, { overReport: 1 })
  f.source.store.set('task', task.id, { ...task, reportedAt: now + 4 })
  f.source.news.deliver(now + 5)
  expect(f.sent).toHaveLength(2)
  expect(f.source.store.all<{ state: string }>('task-news').filter(item => item.state === 'cancelled')).toHaveLength(2)
}))

test('coalescing later quiet news retains an undelivered still-overdue estimate after fresh activity', () => fixture(async f => {
  const task = { ...f.task, report: { msg: 'Working', progress: 10, eta: 5 }, reportedAt: 1 }
  f.source.store.set('task', task.id, task)
  for (const chat of ['app', 'main-home']) f.source.store.set('agent', chat, { ...f.source.agents.get(chat)!, state: 'working' })
  const now = 30 * 60000
  f.source.news.record(task, 'stalled', now, { overReport: 1 })
  f.source.news.deliver(now); expect(f.sent).toHaveLength(0)
  f.source.news.record(task, 'stalled', now + 1, { quietLife: 1 })
  f.source.news.deliver(now + 1); expect(f.sent).toHaveLength(0)
  f.source.store.set('agent', f.worker.chat, { ...f.worker, activityAt: now + 2 })
  for (const chat of ['app', 'main-home']) f.source.store.set('agent', chat, { ...f.source.agents.get(chat)!, state: 'idle' })
  f.source.news.deliver(now + 3)
  expect(f.sent.map(item => item.chat)).toEqual(['app', 'main-home'])
  expect(f.source.store.all<{ state: string }>('task-news').filter(item => item.state === 'queued')).toHaveLength(2)
}))

test('coalescing one busy target never repeats an overdue cause already delivered to another', () => fixture(async f => {
  const task = { ...f.task, report: { msg: 'Working', progress: 10, eta: 5 }, reportedAt: 1 }
  f.source.store.set('task', task.id, task)
  f.source.store.set('agent', 'app', { ...f.source.agents.get('app')!, state: 'working' })
  const now = 30 * 60000
  f.source.news.record(task, 'stalled', now, { overReport: 1 })
  f.source.news.deliver(now)
  expect(f.sent.map(item => item.chat)).toEqual(['main-home'])
  f.source.news.record(task, 'stalled', now + 1, { quietLife: 1 })
  f.source.store.set('agent', f.worker.chat, { ...f.worker, activityAt: now + 2 })
  f.source.store.set('agent', 'app', { ...f.source.agents.get('app')!, state: 'idle' })
  f.source.news.deliver(now + 3)
  expect(f.sent.map(item => item.chat)).toEqual(['main-home', 'app'])
}))


test('regular coordinators keep the legacy no-echo behavior for task creation', () => fixture(async f => {
  f.source.news.record(f.task, 'added', 10)
  f.source.news.deliver(11)
  expect(f.sent).toEqual([])
  expect(f.source.store.all('task-news')).toEqual([])
  expect(f.source.logs.messages('main-home')).toEqual([])
}))
