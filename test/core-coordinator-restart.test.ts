import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreSource } from '../server/core/source.ts'
import type { CoreAgent } from '../server/core/model.ts'
import type { CoreTerminal } from '../server/core/protocol.ts'

async function fixture(work: (f: ReturnType<typeof setup>) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-coordinator-restart-'))
  const f = setup(home)
  try { await work(f) } finally { f.source.stop(); await f.source.pilots.lifecycle.drain(); f.source.mailbox.close(); f.source.store.close(); rmSync(home, { recursive: true, force: true }) }
}
function setup(home: string) {
  const source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  source.tasks.seedIncludes = async () => {} // Native include copying has a dedicated real-Git fixture.
  source.tasks.git.ensureWorktree = async () => false // This fixture fakes checkout/core I/O; real Git recreation is covered in core-tasks.
  const space = { id: 'p:machine:demo', name: 'demo', machine: 'machine', folder: '/repo', base: 'main', prefix: 'DEMO', mode: 'regular' as const, added: 1 }
  const agent = { chat: space.id, space: space.id, machine: space.machine, role: 'coordinator', kind: 'claude', launch: 'old', pid: 100, grant: 'old-grant', hook: '/unused', started: 1, state: 'idle' } as CoreAgent
  const terminal = { address: 't1', state: 'live', pid: 100, created_ms: 1 } as CoreTerminal
  const child = { address: 't2', state: 'live', pid: 101, parent: 't1', created_ms: 2 } as CoreTerminal
  source.store.set('space', space.id, space); source.store.set('agent', agent.chat, agent)
  source.core.current.connected = true
  source.core.current.terminals = new Map([[terminal.address, terminal], [child.address, child]])
  const on = { connected: true, current: terminal as CoreTerminal | undefined }
  source.machineConnected = () => on.connected
  source.agents.terminal = () => on.current
  const revoked: string[] = [], denied: string[] = [], killed: string[] = [], launches: unknown[] = [], saved: unknown[] = []
  source.mailbox.revoke = chat => { revoked.push(chat) }
  source.denyPermissions = who => { denied.push(who.launch) }
  source.settings.checkedAgent = (_level, input) => { if (input.model === 'invalid') throw Error('Choose a model offered by this agent'); return { kind: 'claude', model: input.model, effort: input.effort } }
  source.settings.saveAgent = (...args) => { saved.push(args) }
  source.agents.launch = async (...args) => { launches.push(args); return { ...agent, launch: 'new' } }
  source.core.call = async <T>(_method: string, input?: unknown) => { killed.push((input as { terminal: string }).terminal); return {} as T }
  return { source, space, agent, terminal, child, on, revoked, denied, killed, launches, saved }
}

test('regular restart waits for confirmed exact exit, blocks concurrent changes and leaves task children alive', () => fixture(async f => {
  let killed!: () => void
  const reached = new Promise<void>(resolve => { killed = resolve })
  f.source.core.call = async <T>(_method: string, input?: unknown) => { f.killed.push((input as { terminal: string }).terminal); killed(); return {} as T }
  const restart = f.source.act({ type: 'restart', chat: f.space.id, kind: 'claude', save: true })
  await reached
  expect(f.revoked).toEqual([f.space.id]); expect(f.denied).toEqual(['old'])
  expect(f.source.pilots.lifecycle.busy(f.space.id)).toBe(true)
  expect(f.launches).toHaveLength(0); expect(f.saved).toHaveLength(0)
  await expect(f.source.act({ type: 'restart', chat: f.space.id, kind: 'claude' })).rejects.toThrow('changing')
  let drained = false
  const drain = f.source.pilots.lifecycle.drain().then(() => { drained = true })
  await Bun.sleep(0); expect(drained).toBe(false)
  f.terminal.state = 'finished'
  await restart; await drain
  expect(f.launches).toHaveLength(1); expect(f.saved).toHaveLength(1)
  expect(f.killed).toEqual(['t1']); expect(f.child.state).toBe('live')
}))

test('invalid settings and disconnected identity refuse before stopping the coordinator', () => fixture(async f => {
  await expect(f.source.act({ type: 'restart', chat: f.space.id, kind: 'claude', model: 'invalid' })).rejects.toThrow('offered')
  f.on.connected = false
  await expect(f.source.act({ type: 'restart', chat: f.space.id, kind: 'claude' })).rejects.toThrow('reconnect')
  expect(f.revoked).toEqual([]); expect(f.killed).toEqual([]); expect(f.launches).toEqual([])
}))

test('a changed finished process identity cannot confirm a coordinator restart', () => fixture(async f => {
  f.source.core.call = async <T>() => { f.terminal.state = 'finished'; f.terminal.pid = 999; return {} as T }
  await expect(f.source.act({ type: 'restart', chat: f.space.id, kind: 'claude', save: true })).rejects.toThrow('identity changed')
  expect(f.launches).toEqual([]); expect(f.saved).toEqual([])
}))

test('lost core state and shutdown prevent replacement; a failed launch does not save new defaults', () => fixture(async f => {
  f.source.core.call = async <T>() => { f.on.current = undefined; return {} as T }
  await expect(f.source.act({ type: 'restart', chat: f.space.id, kind: 'claude' })).rejects.toThrow('pending')
  f.on.current = f.terminal; f.terminal.state = 'finished'; f.source.quiescing = true
  await expect(f.source.pilots.lifecycle.regularRestart(f.space.id, { kind: 'claude' })).rejects.toThrow('stopping')
  f.source.quiescing = false
  f.source.agents.launch = async () => { throw Error('Native harness unavailable') }
  await expect(f.source.act({ type: 'restart', chat: f.space.id, kind: 'claude', save: true })).rejects.toThrow('unavailable')
  expect(f.saved).toEqual([])
}))

function taskRestart(f: ReturnType<typeof setup>) {
  const task = { id: 'DEMO-1', chat: 'DEMO-1/Agent', name: 'Task', desc: 'Wait for go', place: f.space.id, machine: f.space.machine,
    folder: '/worktree', repo: '/repo', branch: 'work/1-task', base: 'main', kind: 'claude', workflow: 'todo', status: 'todo', state: 'To do',
    mergePolicy: 'ask', review: { on: false, kind: 'codex', rounds: 3, mustFix: 'major' }, age: 'now', created: new Date().toISOString(), on: 'test' } as import('../server/core/tasks.ts').CoreTask
  f.source.store.set('task', task.id, task)
  f.source.store.set('agent', task.chat, { ...f.agent, chat: task.chat, role: 'task' })
  f.source.agents.terminal = agent => agent.chat === task.chat ? f.on.current : f.child
  f.source.browsers.close = async () => {}
  return task
}

test('task restart validates settings before revocation and checks identity even for a finished old root', () => fixture(async f => {
  const task = taskRestart(f)
  await expect(f.source.act({ type: 'restart', chat: task.chat, kind: 'claude', model: 'invalid' })).rejects.toThrow('offered')
  expect(f.revoked).toEqual([]); expect(f.killed).toEqual([])
  f.terminal.state = 'finished'; f.terminal.pid = 999
  await expect(f.source.act({ type: 'restart', chat: task.chat, kind: 'claude' })).rejects.toThrow('identity changed')
  expect(f.launches).toEqual([]); expect(f.saved).toEqual([])
}))

test('task restart refuses a substituted exit and saves defaults only after a successful native start', () => fixture(async f => {
  const task = taskRestart(f)
  f.source.core.call = async <T>() => { f.terminal.state = 'finished'; f.terminal.pid = 999; return {} as T }
  await expect(f.source.act({ type: 'restart', chat: task.chat, kind: 'claude', save: true })).rejects.toThrow('identity changed')
  expect(f.launches).toEqual([]); expect(f.saved).toEqual([])
  f.terminal.pid = 100
  f.source.agents.launch = async () => { throw Error('Native launch failed') }
  await expect(f.source.act({ type: 'restart', chat: task.chat, kind: 'claude', save: true })).rejects.toThrow('Native launch failed')
  expect(f.saved).toEqual([])
  f.source.agents.launch = async (...args) => { f.launches.push(args); return { ...f.agent, chat: task.chat, launch: 'new' } }
  await f.source.act({ type: 'restart', chat: task.chat, kind: 'claude', save: true })
  expect(f.launches).toHaveLength(1); expect(f.saved).toHaveLength(1)
  expect(f.source.tasks.get(task.id)?.workflow).toBe('todo')
}))
