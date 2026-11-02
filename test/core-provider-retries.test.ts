import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreSource } from '../server/core/source.ts'
import { CoreProviderRetries } from '../server/core/provider-retries.ts'
import type { CoreAgent, CoreSpace } from '../server/core/model.ts'
import type { CoreTask } from '../server/core/tasks.ts'
import type { CoreTerminal } from '../server/core/protocol.ts'
import type { LogEvent } from '../server/common/readers/types.ts'

async function fixture(run: (f: ReturnType<typeof setup>) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-provider-')), source = new CoreSource({ home, socket: '/unused', binary: 'hc', session: 'test', port: 0 })
  try { await run(setup(source)) } finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
}
function setup(source: CoreSource) {
  const space = { id: 'p:machine:app', name: 'app', machine: 'machine', folder: '/repo', base: 'main', prefix: 'APP', mode: 'regular', added: 1 } as CoreSpace
  const task = { id: 'APP-1', name: 'Task', place: space.id, machine: space.machine, chat: 'APP-1/Agent', workflow: 'working', kind: 'claude', branch: 'work/one', base: 'main', age: 'now', launchAttempt: 'attempt' } as CoreTask
  const agent = { chat: task.chat, space: space.id, machine: space.machine, role: 'task', kind: 'claude', launch: 'launch', grant: 'grant', state: 'idle', started: 1, hook: '/unused' } as CoreAgent
  source.store.set('space', space.id, space); source.store.set('task', task.id, task); source.store.set('agent', agent.chat, agent)
  source.connected = () => true; source.machineConnected = () => true
  source.agents.terminal = () => ({ address: 't1', state: 'live' } as CoreTerminal)
  let turn: ReturnType<typeof source.logs.providerTurn> = { complete: true, cut: { kind: 'error', id: 'cut-1', at: 2, text: 'API Error: 529 Overloaded', status: 529 } }
  source.logs.providerTurn = () => turn
  const sent: { id: string; text: string }[] = []
  source.saveAndDeliver = (_chat, id, text, save) => { save(); sent.push({ id, text }) }
  let backups = 0
  source.tasks.providerFallback = async () => { backups++; return false }
  return { source, agent, task, space, sent, turn: (value: typeof turn) => { turn = value }, backups: () => backups }
}

test('native provider cutoffs retry at 1/2/4/8 minutes once each across a controller restart, then need the human', () => fixture(async f => {
  let retries = f.source.providerRetries, now = 1000
  for (const [index, minutes] of [1, 2, 4, 8].entries()) {
    f.turn({ complete: true, cut: { kind: 'error', id: `cut-${index + 1}`, at: now, text: 'API Error: 529 Overloaded', status: 529 } })
    await retries.tick(now)
    expect(retries.get(f.agent)?.due).toBe(now + minutes * 60_000)
    await retries.tick(now + minutes * 60_000 - 1)
    expect(f.sent).toHaveLength(index)
    retries = new CoreProviderRetries(f.source)
    await retries.tick(now + minutes * 60_000)
    await retries.tick(now + minutes * 60_000 + 1)
    expect(f.sent).toHaveLength(index + 1)
    now += minutes * 60_000 + 100
  }
  f.turn({ complete: true, cut: { kind: 'error', id: 'cut-5', at: now, text: 'overloaded', status: 529 } })
  await retries.tick(now); await retries.tick(now + 1)
  expect(retries.get(f.agent)).toMatchObject({ over: true, tries: 5, reason: 'Provider overloaded, still after 5 tries' })
  expect(f.backups()).toBe(1)
  expect(f.source.logs.messages(f.agent.chat).filter(m => m.card)).toHaveLength(1)
}))

test('an explicit message resets retries without immediately rediscovering the same old cutoff', () => fixture(async f => {
  await f.source.providerRetries.tick(1000)
  f.source.providerRetries.clear(f.agent.chat)
  await f.source.providerRetries.tick(100_000)
  expect(f.sent).toHaveLength(0)
  expect(f.source.providerRetries.get(f.agent)).toBeUndefined()
  f.turn({ complete: true, cut: { kind: 'error', id: 'fresh', at: 100_001, text: 'rate limited', status: 429 } })
  await f.source.providerRetries.tick(100_001)
  expect(f.source.providerRetries.get(f.agent)).toMatchObject({ tries: 1, due: 160_001 })
}))

test('incomplete logs, background work, paused tasks, reviewers, replaced launches and unknown machine identity never get a retry', () => fixture(async f => {
  f.turn({ complete: false }); await f.source.providerRetries.tick(0)
  expect(f.source.providerRetries.get(f.agent)).toBeUndefined()
  f.turn({ complete: true, cut: { kind: 'error', id: 'cut', at: 2, text: 'overloaded' } })
  f.task.workflow = 'todo'; f.source.store.set('task', f.task.id, f.task)
  await f.source.providerRetries.tick(1000)
  expect(f.source.providerRetries.get(f.agent)).toBeUndefined()
  f.task.workflow = 'working'; f.source.store.set('task', f.task.id, f.task)
  f.agent.pid = 10; f.source.store.set('agent', f.agent.chat, f.agent)
  await f.source.providerRetries.tick(1000)
  expect(f.source.providerRetries.get(f.agent)).toBeUndefined()
  delete f.agent.pid; f.source.store.set('agent', f.agent.chat, f.agent)
  await f.source.providerRetries.tick(1000)
  expect(f.source.providerRetries.get({ ...f.agent, launch: 'replacement' })).toBeUndefined()
}))

test('lasting failures ask immediately and an ended successful turn clears the retry record', () => fixture(async f => {
  f.turn({ complete: true, cut: { kind: 'error', id: 'auth', at: 2, text: 'Signed out', status: 401 } })
  await f.source.providerRetries.tick(1)
  expect(f.source.providerRetries.get(f.agent)).toMatchObject({ over: true, reason: 'Signed out' })
  expect(f.sent).toHaveLength(0); expect(f.backups()).toBe(1)
  f.turn({ complete: true }); await f.source.providerRetries.tick(2)
  expect(f.source.providerRetries.get(f.agent)).toBeUndefined()
}))

test('backup records one-shot intent before replacing the old agent and preserves handover across capacity holds', () => fixture(async f => {
  const { CoreTasks } = await import('../server/core/tasks.ts')
  f.source.tasks.providerFallback = CoreTasks.prototype.providerFallback.bind(f.source.tasks)
  f.task.folder = '/work/one'; f.task.repo = '/repo'; f.source.store.set('task', f.task.id, f.task)
  const commands: string[][] = []
  f.source.tasks.git.run = async (_where, args) => { commands.push(args); return args[0] === 'log' ? 'abc123 Existing commit' : ' M unfinished.txt' }
  f.source.logs.outgoing(f.agent.chat, { id: 'human', who: 'you', text: 'Keep unfinished work', at: 1 })
  const internals = f.source.tasks as unknown as { finishForRestart(agent: CoreAgent): Promise<void>; launchNow(task: CoreTask, message?: string): Promise<void> }
  let finishes = 0
  internals.finishForRestart = async () => {
    finishes++
    expect(f.source.tasks.get(f.task.id)?.providerTakeover).toMatchObject({ state: 'starting', from: 'claude', to: 'codex', launch: f.agent.launch })
  }
  internals.launchNow = async (task, message) => {
    expect(message).toContain('Existing commit'); expect(message).toContain('unfinished.txt'); expect(message).toContain('Keep unfinished work')
    task.workflow = 'queued'; task.capacity = 'Machine load'; task.providerTakeover!.state = 'queued'
    f.source.store.set('task', task.id, task)
  }
  expect(await f.source.tasks.providerFallback(f.task.id, f.agent.launch, 'Out of allowance')).toBe(true)
  const saved = f.source.tasks.get(f.task.id)!
  expect(saved.providerTakeover).toMatchObject({ state: 'queued', to: 'codex' })
  expect(saved.providerTakeover?.handover).toContain('unfinished.txt')
  expect(saved.branch).toBe('work/one'); expect(saved.folder).toBe('/work/one')
  expect(f.source.logs.messages(f.agent.chat).some(message => message.card?.text.includes('took over'))).toBe(false)
  expect(await f.source.tasks.providerFallback(f.task.id, f.agent.launch, 'Out of allowance')).toBe(false)
  expect(finishes).toBe(1); expect(commands.map(args => args[0])).toEqual(['log', 'status'])
}))

test('contained tasks never switch provider automatically and interrupted takeover needs an explicit restart', () => fixture(async f => {
  const { CoreTasks } = await import('../server/core/tasks.ts')
  f.source.tasks.providerFallback = CoreTasks.prototype.providerFallback.bind(f.source.tasks)
  f.task.pilot = 'contained'; f.source.store.set('task', f.task.id, f.task)
  expect(await f.source.tasks.providerFallback(f.task.id, f.agent.launch, 'Signed out')).toBe(false)
  delete f.task.pilot
  f.task.providerTakeover = { from: 'claude', to: 'codex', launch: f.agent.launch, at: 10, why: 'Signed out', state: 'starting', handover: 'Existing work' }
  f.source.store.set('task', f.task.id, f.task)
  f.source.tasks.recoverProviderFallbacks()
  expect(f.source.tasks.get(f.task.id)?.startError).toContain('interrupted')
  expect(f.source.tasks.get(f.task.id)?.providerTakeover?.state).toBe('failed')
  expect(await f.source.tasks.providerFallback(f.task.id, f.agent.launch, 'Signed out')).toBe(false)
}))


test('native blocked provider failure can hand over, but blocked or incomplete work without an ended error cannot', () => fixture(async f => {
  f.source.agents.terminal = () => ({ address: 't1', state: 'live', status: { app: 'claude-code', state: 'blocked' } } as CoreTerminal)
  f.turn({ complete: false })
  await f.source.providerRetries.tick(1)
  expect(f.backups()).toBe(0)
  f.turn({ complete: true })
  await f.source.providerRetries.tick(2)
  expect(f.backups()).toBe(0)
  f.turn({ complete: true, cut: { kind: 'error', id: 'native-auth-failed', at: 3, text: 'Invalid API key', code: 'authentication_failed', status: 401 } })
  await f.source.providerRetries.tick(3)
  expect(f.backups()).toBe(1)
  expect(f.source.providerRetries.get(f.agent)).toMatchObject({ over: true, reason: 'Signed out' })
  await f.source.providerRetries.tick(4)
  expect(f.backups()).toBe(1)
}))
