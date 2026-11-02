import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreStore } from '../server/core/store.ts'
import { CorePilotPolicy, type CorePilotConfig } from '../server/core/pilot-policy.ts'
import { CorePilotLifecycle } from '../server/core/pilot-lifecycle.ts'
import type { CoreSource } from '../server/core/source.ts'
import type { CoreAgent } from '../server/core/model.ts'

async function fixture(work: (f: ReturnType<typeof setup>) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-pilot-stop-')), store = new CoreStore(home)
  try { await work(setup(store)) } finally { store.close(); rmSync(home, { recursive: true, force: true }) }
}
function setup(store: CoreStore) {
  const policy = new CorePilotPolicy(store), run = policy.begin('space', 'machine', { harness: { kind: 'claude' }, reviewer: { kind: 'codex' }, hosts: ['api.anthropic.com'], secrets: [], approvals: ['merge'], parallel: 2 })
  policy.activate(run.id, { chat: 'space', role: 'coordinator', launch: 'coord' })
  const records = ['coord', 'worker', 'retired'].map((launch, i) => ({ chat: i ? 'TASK-1/Agent' : 'space', role: i ? 'task' : 'coordinator', launch, machine: 'machine', space: 'space', pid: 100 + i, pilot: { run: run.id, captures: `/private/${launch}`, home: '/inside' } }) as CoreAgent)
  for (const record of records) store.set('pilot-capture', record.launch, record)
  const terminals = new Map(records.map(record => [record.launch, { address: record.launch, state: 'live', pid: record.pid }]))
  const denied: string[] = [], killed: string[] = [], space = { id: 'space', mode: 'autopilot' }, on = { connected: true }
  const source = { store, tasks: { busy: () => false }, pilots: { policy }, agents: { get: (chat: string) => records.find(agent => agent.chat === chat), all: () => [records[0], records[1]], terminal: (agent: CoreAgent) => terminals.get(agent.launch) }, machineConnected: () => on.connected,
    denyPermissions: (agent: CoreAgent) => { denied.push(agent.launch) }, core: { call: async (_: string, input: { terminal: string }) => { killed.push(input.terminal) } }, space: () => space, emit() {} } as unknown as CoreSource
  return { source, policy, run, records, terminals, killed, denied, space, on, lifecycle: new CorePilotLifecycle(source) }
}
test('stop denies authority immediately, preserves unknown processes and retries retired launches after reconnect', () => fixture(async f => {
  f.on.connected = false
  await f.lifecycle.stop(f.run.id)
  expect(f.policy.get(f.run.id)?.state).toBe('stopping'); expect(f.killed).toEqual([])
  expect(new Set(f.denied)).toEqual(new Set(['coord', 'worker', 'retired']))
  f.on.connected = true; f.terminals.delete('retired')
  await new CorePilotLifecycle(f.source).tick()
  expect(f.killed).toEqual(['coord', 'worker']); expect(f.space.mode).toBe('autopilot')
  for (const terminal of f.terminals.values()) terminal.state = 'finished'
  await f.lifecycle.tick(); expect(f.policy.get(f.run.id)?.state).toBe('stopping')
  f.terminals.set('retired', { address: 'retired', state: 'live', pid: 102 })
  await f.lifecycle.tick(); expect(f.killed.at(-1)).toBe('retired')
  f.terminals.get('retired')!.state = 'finished'
  await f.lifecycle.tick()
  expect(f.policy.get(f.run.id)?.state).toBe('stopped'); expect(f.space.mode).toBe('regular')
}))
test('keep workers stops only old coordinators; later default stop also kills retained and retired workers', () => fixture(async f => {
  await f.lifecycle.stop(f.run.id, true)
  expect(f.killed).toEqual(['coord']); expect(new Set(f.denied)).toEqual(new Set(['coord']))
  f.terminals.get('coord')!.state = 'finished'
  await f.lifecycle.tick()
  expect(f.policy.get(f.run.id)?.state).toBe('workers'); expect(f.space.mode).toBe('regular')
  await f.lifecycle.stop(f.run.id)
  expect(f.killed).toEqual(['coord', 'worker', 'retired'])
  expect(f.policy.get(f.run.id)?.state).toBe('stopping')
}))
test('cleanup refuses a changed process identity and leaves a newer run mode intact', () => fixture(async f => {
  f.terminals.get('coord')!.pid = 999
  await expect(f.lifecycle.stop(f.run.id)).rejects.toThrow('identity')
  expect(f.killed).toEqual([])
  f.terminals.get('coord')!.pid = 100
  for (const terminal of f.terminals.values()) terminal.state = 'finished'
  await f.lifecycle.tick()
  const next = f.policy.begin('space', 'machine', f.run.config)
  f.policy.activate(next.id, { chat: 'space', launch: 'new-coordinator', role: 'coordinator' })
  f.space.mode = 'autopilot'
  await f.lifecycle.tick()
  expect(f.policy.current('space')?.id).toBe(next.id); expect(f.space.mode).toBe('autopilot')
}))

test('an interrupted start is failed and cleaned up after app reconstruction, never activated from labels', () => fixture(async f => {
  f.policy.stop(f.run.id); f.policy.stopped(f.run.id)
  const next = f.policy.begin('space', 'machine', f.run.config)
  f.space.mode = 'autopilot'
  await new CorePilotLifecycle(f.source).tick()
  expect(f.policy.get(next.id)).toMatchObject({ state: 'stopped', error: expect.stringContaining('start was interrupted') })
  expect(f.space.mode).toBe('regular')
}))

test('a failed coordinator replacement keeps workers and cumulative limits instead of failing their run', () => fixture(async f => {
  const worker = { chat: f.records[1].chat, launch: f.records[1].launch, role: 'task' as const, task: 'TASK-1' }
  f.policy.claim(f.run.id, worker.task, 0); f.policy.bind(f.run.id, worker)
  f.policy.traffic(f.run.id, worker, 100)
  f.terminals.get('coord')!.state = 'finished'
  // The explicit replacement reaches runtime preparation but fails before creating another holder.
  Object.assign(f.source, { logs: { messages: () => [] }, heartbeats: { read: () => '# Do nothing' } })
  f.source.agents.launch = async () => { throw Error('Runtime preparation unavailable') }
  await expect(f.lifecycle.restart('space')).rejects.toThrow('Runtime preparation unavailable')
  expect(f.policy.get(f.run.id)).toMatchObject({ state: 'on', traffic: 100, error: expect.stringContaining('Workers remain contained') })
  expect(f.policy.actor(f.run.id, worker).state).toBe('on')
  expect(() => f.policy.actor(f.run.id, { chat: 'space', launch: 'coord', role: 'coordinator' })).toThrow('belong')
  expect(f.terminals.get('worker')?.state).toBe('live')
  expect(f.killed).toEqual([])
}))

test('default stop waits for accepted task mutations after holders finish; retained workers may continue', () => fixture(async f => {
  f.policy.claim(f.run.id, 'TASK-1', 0)
  for (const terminal of f.terminals.values()) terminal.state = 'finished'
  let changing = true
  f.source.tasks.busy = () => changing
  await f.lifecycle.stop(f.run.id)
  expect(f.policy.get(f.run.id)?.state).toBe('stopping')
  changing = false
  await f.lifecycle.tick()
  expect(f.policy.get(f.run.id)?.state).toBe('stopped')
}))

test('a start where Autopilot cannot run refuses before touching the coordinator', async () => {
  let began = false
  const source = { space: () => ({ id: 'space', machine: 'mac' }), settings: { pilotBlock: () => 'Autopilot needs Linux. mac runs macOS.' }, pilots: { policy: { begin() { began = true } } } } as unknown as CoreSource
  expect(() => new CorePilotLifecycle(source).start('space', {} as CorePilotConfig)).toThrow('runs macOS')
  expect(began).toBe(false)
})
