import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreStore } from '../server/core/store.ts'
import { CorePilotPolicy, type CorePilotConfig, type PilotActor } from '../server/core/pilot-policy.ts'

const config: CorePilotConfig = { harness: { kind: 'claude' }, reviewer: { kind: 'codex' }, hosts: ['api.anthropic.com'], secrets: ['SYNTHETIC_KEY'], approvals: ['merge'], parallel: 2, traffic: 1000, tokens: 100, runtime: 60_000 }
const coordinator: PilotActor = { chat: 'space', launch: 'coord-1', role: 'coordinator' }
const worker: PilotActor = { chat: 'box/TASK-1/Agent', launch: 'worker-1', role: 'task', task: 'box/TASK-1' }
function fixture(run: (policy: CorePilotPolicy, store: CoreStore) => void) {
  const home = mkdtempSync(join(tmpdir(), 'shep-core-pilot-')), store = new CoreStore(home)
  try { run(new CorePilotPolicy(store), store) } finally { store.close(); rmSync(home, { recursive: true, force: true }) }
}
test('private run ownership survives app reconstruction and replaces only the restarted actor', () => fixture((policy, store) => {
  const input = structuredClone(config), run = policy.begin('space', 'machine', input, 100)
  input.secrets.push('NOT_GRANTED')
  expect(policy.get(run.id)?.config.secrets).toEqual(['SYNTHETIC_KEY'])
  expect(() => policy.begin('space', 'machine', config, 100)).toThrow('already')
  expect(() => policy.actor(run.id, coordinator, 100)).toThrow('belong')
  policy.activate(run.id, coordinator); policy.claim(run.id, worker.task!, 0, 100); policy.bind(run.id, worker)
  const resumed = new CorePilotPolicy(store)
  expect(resumed.actor(run.id, worker, 101).tasks).toEqual(['box/TASK-1'])
  expect(() => resumed.actor(run.id, { ...worker, launch: 'forged-label' }, 101)).toThrow('belong')
  resumed.bind(run.id, { ...worker, launch: 'worker-2' })
  expect(() => resumed.actor(run.id, worker, 101)).toThrow('belong')
  expect(resumed.actor(run.id, coordinator, 101).state).toBe('on')
}))
test('workers share durable traffic and token deltas across reconstructions and cannot bypass a failed budget', () => fixture((policy, store) => {
  const run = policy.begin('space', 'machine', config, 100)
  policy.activate(run.id, coordinator); policy.claim(run.id, worker.task!, 0, 100); policy.bind(run.id, worker)
  expect(policy.traffic(run.id, coordinator, 600, 101)).toBe(600)
  const resumed = new CorePilotPolicy(store)
  expect(resumed.traffic(run.id, worker, 300, 102)).toBe(900)
  expect(() => resumed.traffic(run.id, worker, 101, 103)).toThrow('HTTPS allowance')
  expect(resumed.get(run.id)).toMatchObject({ state: 'failed', traffic: 900 })
  expect(() => policy.command(run.id, coordinator, ['task', 'add'], 104)).toThrow('HTTPS allowance')
  expect(policy.usage(run.id, 'claude:session:usage-1', 30)).toBe(30)
  expect(policy.usage(run.id, 'claude:session:usage-1', 20)).toBe(30)
  expect(new CorePilotPolicy(store).usage(run.id, 'claude:session:usage-1', 40)).toBe(40)
  expect(policy.usage(run.id, 'codex:child:usage-1', 25)).toBe(65)
}))
test('runtime and reported token limits fail closed, and unfinished startup cannot execute product commands', () => fixture(policy => {
  const run = policy.begin('space', 'machine', config, 100)
  expect(() => policy.command(run.id, coordinator, ['show'], 101)).toThrow()
  policy.activate(run.id, coordinator)
  policy.usage(run.id, 'parent', 100)
  expect(() => policy.actor(run.id, coordinator, 101)).toThrow('reported token')
  policy.stopped(run.id)
  const next = policy.begin('space', 'machine', config, 100)
  policy.activate(next.id, coordinator)
  expect(() => policy.actor(next.id, coordinator, 60_100)).toThrow('runtime')
}))
test('keep-workers never grants the stopped coordinator, unknown tasks or new task creation', () => fixture(policy => {
  const run = policy.begin('space', 'machine', config, 100)
  policy.activate(run.id, coordinator); policy.claim(run.id, worker.task!, 0, 100); policy.bind(run.id, worker)
  policy.stop(run.id, true)
  expect(policy.stop(run.id, true).state).toBe('workers')
  expect(() => policy.command(run.id, coordinator, ['show'], 101)).toThrow('belong')
  expect(policy.command(run.id, worker, ['checkpoint', 'saved'], 101).state).toBe('workers')
  expect(() => policy.command(run.id, worker, ['task', 'add'], 101)).toThrow('human')
  expect(() => policy.command(run.id, worker, ['task', 'review-more', worker.task!], 101)).toThrow('human')
  expect(() => policy.bind(run.id, { ...worker, task: 'UNRELATED-1' })).toThrow('own')
  expect(policy.owns(run.id, 'box/TASK-1')).toBe(true)
  expect(policy.owns(run.id, 'TASK-1')).toBe(false)
  expect(() => policy.command(run.id, worker, ['set', 'autopilot.access', 'full'], 101)).toThrow('human')
  policy.stop(run.id); policy.stopped(run.id)
  expect(() => policy.command(run.id, worker, ['show'], 102)).toThrow('stopped')
}))
test('configuration and counters reject invalid limits, private hosts, unsupported adapters and overflow', () => fixture(policy => {
  for (const change of [{ parallel: 0 }, { traffic: Infinity }, { tokens: -1 }, { runtime: NaN }, { hosts: ['127.0.0.1'] }, { hosts: ['*.example.com'] }, { hosts: ['service.local'] }, { hosts: ['a.home.arpa'] }, { secrets: ['KEY=value'] }, { harness: { kind: 'pi' } }]) {
    expect(() => policy.begin('space', 'machine', { ...config, ...change } as CorePilotConfig)).toThrow()
  }
  const run = policy.begin('space', 'machine', config, 100); policy.activate(run.id, coordinator)
  expect(() => policy.claim(run.id, 'TASK-1', 2, 101)).toThrow('parallel')
  expect(() => policy.traffic(run.id, coordinator, -1, 101)).toThrow('reservation')
  expect(() => policy.usage(run.id, 'one', Infinity)).toThrow('observation')
}))

test('repeated stop cannot weaken cleanup, revive stopped actors or recover a failed run', () => fixture(policy => {
  const run = policy.begin('space', 'machine', config, 100)
  policy.activate(run.id, coordinator); policy.claim(run.id, worker.task!, 0, 100); policy.bind(run.id, worker)
  expect(() => policy.stopped(run.id)).toThrow('Stop this run')
  policy.stop(run.id)
  expect(policy.stop(run.id, true).state).toBe('stopping')
  policy.stopped(run.id)
  expect(policy.stop(run.id, true).state).toBe('stopped')
  expect(() => policy.command(run.id, worker, ['show'], 101)).toThrow('stopped')
  const next = policy.begin('space', 'machine', config, 102)
  policy.activate(next.id, coordinator); policy.fail(next.id, 'broker lost')
  expect(policy.stop(next.id, true).state).toBe('failed')
  expect(() => policy.actor(next.id, coordinator, 103)).toThrow('broker lost')
}))

test('coordinator replacement revokes only its actor and retains worker identity and cumulative limits', () => fixture(policy => {
  const run = policy.begin('space', 'machine', config)
  policy.activate(run.id, coordinator); policy.claim(run.id, worker.task!, 0); policy.bind(run.id, worker)
  policy.traffic(run.id, coordinator, 100); policy.usage(run.id, 'native-message', 10)
  policy.detachCoordinator(run.id)
  expect(() => policy.actor(run.id, coordinator)).toThrow('belong')
  expect(policy.actor(run.id, worker).state).toBe('on')
  const next = { ...coordinator, launch: 'coord-2' }
  policy.replaceCoordinator(run.id, next, { kind: 'codex' })
  expect(policy.actor(run.id, next)).toMatchObject({ started: run.started, traffic: 100, used: 10, config: { harness: { kind: 'codex' } } })
  expect(policy.actor(run.id, worker).tasks).toEqual([worker.task!])
  policy.stop(run.id)
  expect(() => policy.replaceCoordinator(run.id, { ...next, launch: 'coord-3' }, { kind: 'claude' })).toThrow()
}))
