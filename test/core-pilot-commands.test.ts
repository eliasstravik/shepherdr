import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreSource } from '../server/core/source.ts'
import type { CoreTask } from '../server/core/tasks.ts'
import type { CoreAgent } from '../server/core/model.ts'

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'shep-pilot-commands-'))
  const source = new CoreSource({ home, socket: '/nonexistent/isolated-core', session: 'isolated', binary: 'hc', port: 0 })
  source.tasks.seedIncludes = async () => {} // Native include copying has a dedicated real-Git fixture.
  source.tasks.git.ensureWorktree = async () => false // This fixture fakes checkout/core I/O; real Git recreation is covered in core-tasks.
  const run = source.pilots.policy.begin('space', 'machine', { harness: { kind: 'claude' }, reviewer: { kind: 'codex' }, hosts: ['api.anthropic.com'], secrets: ['APPROVED_KEY'], approvals: ['merge'], parallel: 1 })
  const grant = source.mailbox.issue('space', 'launch', 'machine', ['cli', 'secret', 'pilot'])
  const agent: CoreAgent = { chat: 'space', space: 'space', machine: 'machine', role: 'coordinator', kind: 'claude', launch: 'launch', grant: grant.id, hook: '/unused', state: 'idle', started: 1, pilot: { run: run.id, home: '/inside', captures: '/outside/captures' } }
  source.store.set('agent', agent.chat, agent); source.pilots.policy.activate(run.id, { chat: agent.chat, launch: agent.launch, role: agent.role })
  const task = { id: 'EX-1', localId: 'EX-1', chat: 'EX-1/Agent', name: 'Own', kind: 'claude', place: 'space', machine: 'machine', pilot: run.id, workflow: 'working', folder: '/repo/work', repo: '/repo', branch: 'work/one', base: 'main', mergePolicy: 'ask', review: { on: true, kind: 'codex', rounds: 3, mustFix: 'major' } } as CoreTask
  source.store.set('task', task.id, task); source.pilots.policy.claim(run.id, task.id, 0)
  const cli = (...args: string[]) => source.pilots.commands.cli(agent, grant, args)
  return { source, run, grant, agent, task, cli, close() { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) } }
}

test('contained task commands use durable ownership, never caller labels or another run’s task', async () => {
  const f = fixture()
  try {
    f.source.store.set('task', 'EX-2', { ...f.task, id: 'EX-2', localId: 'EX-2', chat: 'EX-2/Agent', pilot: undefined })
    expect((await f.cli('task', 'list')).out).toContain('EX-1')
    expect((await f.cli('task', 'list')).out).toContain('EX-2')
    expect((await f.cli('task', 'show', 'EX-2')).out).toContain('EX-2')
    expect((await f.cli('task', 'show', '1')).out).toContain('EX-1')
    await expect(f.cli('task', 'close', 'EX-2', '--run', f.run.id)).rejects.toThrow('does not own')
    await expect(f.cli('space', 'add', '/outside')).rejects.toThrow('needs the human')
    await expect(f.cli('setting', 'coordinator.agent', 'Codex')).rejects.toThrow('needs the human')
    f.source.pilots.policy.stop(f.run.id)
    await expect(f.cli('task', 'show', 'EX-1')).rejects.toThrow('stopped')
  } finally { f.close() }
})

test('secret access and listing obey this run’s saved names even when broader scope contains more', async () => {
  const f = fixture()
  try {
    f.source.secrets.vault.set('all', 'APPROVED_KEY', 'synthetic-approved')
    f.source.secrets.vault.set('all', 'UNAPPROVED_KEY', 'synthetic-unapproved')
    expect((await f.cli('secret', 'list')).out.trim()).toBe('APPROVED_KEY')
    await expect(f.cli('secret', 'ask', 'UNAPPROVED_KEY')).rejects.toThrow('outside this run')
    expect(f.source.pilots.commands.secret(f.agent, { names: ['APPROVED_KEY'], run: 'forged', chat: 'other' })).toEqual({ secrets: { APPROVED_KEY: 'synthetic-approved' } })
    expect(() => f.source.pilots.commands.secret(f.agent, { names: ['APPROVED_KEY', 'UNAPPROVED_KEY'] })).toThrow('outside this run')
  } finally { f.close() }
})

test('progress is run-private and a worker cannot change another owned task', async () => {
  const f = fixture()
  try {
    await f.cli('progress', 'Finished the first step; next is review')
    expect((await f.cli('progress')).out).toContain('next is review')
    const grant = f.source.mailbox.issue(f.task.chat, 'worker-launch', 'machine', ['cli', 'secret', 'pilot'])
    const worker: CoreAgent = { ...f.agent, chat: grant.chat, grant: grant.id, launch: grant.session, role: 'task' }
    f.source.store.set('agent', worker.chat, worker)
    f.source.pilots.policy.bind(f.run.id, { chat: worker.chat, launch: worker.launch, role: 'task', task: f.task.id })
    f.source.store.set('task', 'EX-3', { ...f.task, id: 'EX-3', localId: 'EX-3', chat: 'EX-3/Agent' })
    f.source.pilots.policy.claim(f.run.id, 'EX-3', 0)
    await expect(f.source.pilots.commands.cli(worker, grant, ['todo', 'EX-3'])).rejects.toThrow('only its own')
    await expect(f.source.pilots.commands.cli(worker, grant, ['progress', 'overwrite'])).rejects.toThrow('Only this run')
    const before = f.source.pilots.policy.get(f.run.id)
    await expect(f.source.pilots.commands.cli(worker, grant, ['checkpoint', '--message', 'unused'])).rejects.toThrow('checkpoint message')
    expect(f.source.pilots.policy.get(f.run.id)).toEqual(before)
  } finally { f.close() }
})

test('a contained To-do native turn still consumes its run’s parallel slot, and expiry blocks another start', () => {
  const f = fixture()
  try {
    f.source.core.current.connected = true
    f.source.machineConnected = () => true
    f.source.store.set('health-sample', 'machine', { at: Date.now(), cores: 8, load: 0, memTotal: 1000, memUsed: 100, disks: [], gpus: [] })
    const first = { ...f.task, workflow: 'todo' as const }
    f.source.store.set('task', first.id, first)
    const worker: CoreAgent = { ...f.agent, chat: first.chat, role: 'task', state: 'working' }
    f.source.store.set('agent', worker.chat, worker)
    f.source.agents.terminal = () => ({ address: 't1', state: 'live', pid: 1 }) as ReturnType<typeof f.source.agents.terminal>
    const next = { ...f.task, id: 'EX-2', chat: 'EX-2/Agent', workflow: 'queued' as const }
    f.source.store.set('task', next.id, next)
    expect(f.source.health.room('machine', next.id)).toContain('Autopilot tasks are working (limit 1)')
    // Native end-of-turn status takes precedence over the older working hook.
    f.source.agents.terminal = () => ({ address: 't1', state: 'live', pid: 1, status: { app: 'codex', state: 'done' } }) as ReturnType<typeof f.source.agents.terminal>
    expect(f.source.health.room('machine', next.id)).toBeUndefined()
    worker.state = 'idle'; f.source.store.set('agent', worker.chat, worker)
    expect(f.source.health.room('machine', next.id)).toBeUndefined()
    const run = f.source.pilots.policy.get(f.run.id)!; run.config.runtime = 1; run.started = 1; f.source.store.set('pilot-run', run.id, run)
    expect(f.source.health.room('machine', next.id)).toContain('runtime limit')
    expect(f.source.pilots.policy.get(run.id)?.state).toBe('failed')
  } finally { f.close() }
})


test('explicit contained start adopts a stopped run task without changing its worktree or review requirement', async () => {
  const f = fixture()
  try {
    f.source.store.set('space', 'space', { id: 'space', name: 'project', machine: 'machine', folder: '/repo', base: 'main', prefix: 'EX', mode: 'autopilot', added: 1 })
    const old = { ...f.run, id: 'old-run', state: 'stopped' as const, tasks: [f.task.id], actors: [] }
    f.source.store.set('pilot-run', old.id, old)
    f.source.store.set('task', f.task.id, { ...f.task, pilot: old.id, workflow: 'todo', readyHead: 'old-head', approvedHead: 'old-head' })
    f.source.machineConnected = () => true
    f.source.health.room = () => undefined
    let launches = 0
    f.source.agents.launch = async (_space, chat, kind, _prompt, options) => {
      launches++
      expect(options?.pilot?.run).toBe(f.run.id)
      expect(options?.folder).toBe('/repo/work')
      expect(options?.resume).toBe(false)
      const worker: CoreAgent = { ...f.agent, chat, kind, role: 'task', launch: 'fresh-contained', pilot: { ...f.agent.pilot!, run: f.run.id } }
      f.source.store.set('agent', chat, worker)
      return worker
    }
    await f.cli('task', 'start', f.task.id)
    expect(launches).toBe(1)
    expect(f.source.tasks.get(f.task.id)).toMatchObject({ pilot: f.run.id, workflow: 'working', folder: '/repo/work', review: { on: true }, mergePolicy: 'ask' })
    expect(f.source.tasks.get(f.task.id)?.approvedHead).toBeUndefined()
    expect(f.source.pilots.policy.get(f.run.id)?.actors).toContainEqual({ chat: f.task.chat, launch: 'fresh-contained', role: 'task', task: f.task.id })
    expect(() => f.source.pilots.policy.actor(old.id, { chat: f.task.chat, launch: 'old-worker', role: 'task', task: f.task.id })).toThrow()
  } finally { f.close() }
})

test('adoption refuses retained, disconnected and unconfirmed retired workers before granting new authority', async () => {
  const f = fixture()
  try {
    const old = { ...f.run, id: 'old-run', state: 'workers' as const, tasks: [f.task.id], actors: [] }
    f.source.store.set('pilot-run', old.id, old)
    f.source.store.set('task', f.task.id, { ...f.task, pilot: old.id, workflow: 'todo' })
    f.source.machineConnected = () => true
    await expect(f.cli('task', 'start', f.task.id)).rejects.toThrow('previous Autopilot')
    f.source.store.set('pilot-run', old.id, { ...old, state: 'stopped' })
    f.source.store.set('pilot-capture', 'retired', { ...f.agent, chat: f.task.chat, launch: 'retired', role: 'task', pilot: { ...f.agent.pilot!, run: old.id } })
    await expect(f.cli('task', 'start', f.task.id)).rejects.toThrow('exits must be confirmed')
    f.source.machineConnected = () => false
    await expect(f.cli('task', 'start', f.task.id)).rejects.toThrow('reconnect')
    expect(f.source.tasks.get(f.task.id)?.pilot).toBe(old.id)
  } finally { f.close() }
})

test('human task restart waits for its old PID and replaces a stopped contained profile with a fresh regular session', async () => {
  const f = fixture()
  try {
    f.source.store.set('space', 'space', { id: 'space', name: 'project', machine: 'machine', folder: '/repo', base: 'main', prefix: 'EX', mode: 'regular', added: 1 })
    f.source.pilots.policy.stop(f.run.id); f.source.pilots.policy.stopped(f.run.id)
    f.source.store.set('task', f.task.id, { ...f.task, workflow: 'todo' })
    const worker: CoreAgent = { ...f.agent, chat: f.task.chat, role: 'task', launch: 'old-worker', terminal: 't1', pid: 42 }
    f.source.store.set('agent', worker.chat, worker); f.source.store.set('pilot-capture', worker.launch, worker)
    f.source.store.set('agent', f.agent.chat, { ...f.agent, pilot: undefined, launch: 'regular-coordinator' })
    let state = 'live', launches = 0
    f.source.machineConnected = () => true; f.source.health.room = () => undefined
    f.source.agents.terminal = agent => agent.chat === worker.chat ? { address: 't1', pid: 42, state } as ReturnType<typeof f.source.agents.terminal> : { address: 't0', state: 'live', pid: 1 } as ReturnType<typeof f.source.agents.terminal>
    f.source.core.call = async () => { setTimeout(() => { state = 'finished' }, 30); return {} as never }
    f.source.agents.launch = async (_space, chat, kind, _prompt, options) => {
      expect(_prompt).toContain('wait for the human’s go'); expect(_prompt).not.toContain('<go>')
      expect(state).toBe('finished'); expect(options?.pilot).toBeUndefined(); expect(options?.resume).toBe(false)
      launches++; const fresh: CoreAgent = { ...worker, chat, kind, pilot: undefined, launch: 'new-regular' }; f.source.store.set('agent', chat, fresh); return fresh
    }
    await f.source.tasks.act({ type: 'restart', chat: f.task.chat, kind: 'claude' })
    expect(launches).toBe(1)
    expect(f.source.tasks.get(f.task.id)?.pilot).toBeUndefined()
    expect(f.source.tasks.get(f.task.id)?.folder).toBe(f.task.folder)
  } finally { f.close() }
})

test('task restart refuses a disconnected or changed process without launching a replacement', async () => {
  const f = fixture()
  try {
    const worker: CoreAgent = { ...f.agent, chat: f.task.chat, role: 'task', pid: 42 }
    f.source.store.set('agent', worker.chat, worker)
    f.source.machineConnected = () => false
    let launches = 0; f.source.agents.launch = async () => { launches++; throw Error('Unexpected launch') }
    await expect(f.source.tasks.act({ type: 'restart', chat: worker.chat })).rejects.toThrow('unconfirmed')
    f.source.machineConnected = () => true
    f.source.agents.terminal = () => ({ address: 't1', state: 'live', pid: 43 }) as ReturnType<typeof f.source.agents.terminal>
    await expect(f.source.tasks.act({ type: 'restart', chat: worker.chat })).rejects.toThrow('identity changed')
    expect(launches).toBe(0)
  } finally { f.close() }
})

test('an unsupported regular-to-contained restart is refused before stopping the healthy old worker', async () => {
  const f = fixture()
  try {
    f.source.store.set('task', f.task.id, { ...f.task, pilot: undefined })
    f.source.store.set('agent', f.task.chat, { ...f.agent, chat: f.task.chat, role: 'task', pilot: undefined, pid: 42 })
    f.source.agents.terminal = () => ({ address: 't1', state: 'live', pid: 42 }) as ReturnType<typeof f.source.agents.terminal>
    f.source.machineConnected = () => true
    let kills = 0; f.source.core.call = async () => { kills++; return {} as never }
    await expect(f.source.tasks.act({ type: 'restart', chat: f.task.chat })).rejects.toThrow('worktree moved')
    expect(kills).toBe(0)
    expect(f.source.tasks.get(f.task.id)?.pilot).toBeUndefined()
  } finally { f.close() }
})

test('contained coordinator controls only owned tasks and archived lists remain scoped', async () => {
  const f = fixture()
  try {
    f.source.store.set('task', 'EX-2', { ...f.task, id: 'EX-2', localId: 'EX-2', chat: 'EX-2/Agent', pilot: undefined })
    await f.cli('task', 'pin', 'EX-1')
    expect(f.source.tasks.get('EX-1')?.pinned).toBeNumber()
    await expect(f.cli('task', 'pin', 'EX-2')).rejects.toThrow('does not own')
    f.source.store.set('task', f.task.id, { ...f.source.tasks.get(f.task.id), archived: Date.now() })
    expect((await f.cli('task', 'list')).out).not.toContain('EX-1')
    expect((await f.cli('task', 'list', '--archived')).out).toContain('EX-1')
    expect((await f.cli('task', 'list', '--archived')).out).not.toContain('EX-2')
    await f.cli('task', 'unarchive', 'EX-1')
    expect(f.source.tasks.get('EX-1')?.archived).toBeUndefined()
  } finally { f.close() }
})

test('contained mode-off is only the private current coordinator’s own run and refuses broad controls', async () => {
  const f = fixture()
  try {
    await expect(f.cli('mode', 'autopilot', '--why', 'No')).rejects.toThrow('needs the human')
    await expect(f.cli('mode', 'other-space', 'regular', '--why', 'No')).rejects.toThrow('needs the human')
    await expect(f.cli('mode', 'regular', '--keep-workers', '--why', 'No')).rejects.toThrow('Use mode')
    await expect(f.cli('mode', 'regular')).rejects.toThrow('--why')
    const grant = f.source.mailbox.issue(f.task.chat, 'worker-launch', 'machine', ['cli', 'pilot'])
    const worker: CoreAgent = { ...f.agent, chat: grant.chat, grant: grant.id, launch: grant.session, role: 'task' }
    f.source.store.set('agent', worker.chat, worker)
    f.source.pilots.policy.bind(f.run.id, { chat: worker.chat, launch: worker.launch, role: 'task', task: f.task.id })
    await expect(f.source.pilots.commands.cli(worker, grant, ['mode', 'regular', '--why', 'No'])).rejects.toThrow('needs the human')
    const other = f.source.pilots.policy.begin('other', 'machine', f.run.config)
    expect((await f.cli('mode', 'regular', '--why', 'Repeated failures')).out).toContain('Stop requested')
    expect(f.source.pilots.policy.get(f.run.id)?.state).toBe('stopping')
    expect(f.source.pilots.policy.get(other.id)?.state).toBe('starting')
    expect(f.source.tasks.get(f.task.id)?.folder).toBe('/repo/work')
    await expect(f.cli('mode', 'regular', '--why', 'Repeat')).rejects.toThrow('stopped')
  } finally { f.close() }
})
