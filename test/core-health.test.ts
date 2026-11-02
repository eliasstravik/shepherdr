import { darwinAvailableMemory } from '../helper/core-health.ts'
import type { Message } from '../shared/types.ts'
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreHealth } from '../server/core/health.ts'
import { CoreStore } from '../server/core/store.ts'
import { CoreSettings } from '../server/core/settings.ts'
import type { CoreSource } from '../server/core/source.ts'
import type { CoreTask } from '../server/core/tasks.ts'
import type { CoreFiles } from '../server/core/files.ts'

async function fixture(run: (context: { source: CoreSource; health: CoreHealth; tasks: CoreTask[]; state: { load: number; memory: number; online: boolean }; calls: string[][]; events: string[]; posts: Message[] }) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-health-')), store = new CoreStore(home), tasks: CoreTask[] = [], calls: string[][] = [], events: string[] = [], posts: Message[] = []
  const state = { load: 2, memory: 40, online: true }
  const source = { store, connected: () => true, machineConnected: () => state.online, machineIds: () => ['box'], quiescing: false,
    agents: { bun: async () => process.execPath, get: () => undefined }, automations: { zone: () => 'UTC', event: async () => { events.push('health') } },
    snapshot: () => ({ machines: [{ id: 'm:box', machine: 'box', name: 'Readable box' }] }),
    spaces: () => [{ id: 'p:box:~', machine: 'box', home: true }], tasks: { all: () => tasks, get: (id: string) => tasks.find(task => task.id === id), view: (task: CoreTask) => ({ ...task, status: 'work' }), tick: async () => {} }, post(_chat: string, message: Message) { posts.push(message) }, emit() {}, retryPending() {},
    files: { exec: async (_machine: string, argv: string[]) => { calls.push(argv); return Buffer.from(JSON.stringify({ at: Date.now(), cores: 8, load: state.load, memTotal: 1000, memUsed: state.memory * 10, disks: [], gpus: [] })) } },
  } as unknown as CoreSource
  Object.assign(source, { settings: new CoreSettings(store, {} as CoreFiles, () => [], id => id, () => {}) })
  const health = new CoreHealth(source)
  try { await run({ source, health, tasks, state, calls, events, posts }) }
  finally { health.stop(); await health.drain(); store.close(); rmSync(home, { recursive: true, force: true }) }
}

test('core samples one machine through exec, holds unknown/stale/overloaded starts and excludes own reservation', async () => fixture(async ({ source, health, tasks, state, calls }) => {
  expect(health.room('box')).toContain('checking')
  await health.refresh()
  expect(calls[0].slice(0, 2)).toEqual([process.execPath, '-e'])
  expect(health.room('box')).toBeUndefined()
  source.settings.set('machine.maxTasks', '1', 'm:box')
  tasks.push({ id: 'DEMO-1', machine: 'box', workflow: 'working' } as CoreTask)
  expect(health.room('box')).toContain('limit 1')
  expect(health.room('box', 'DEMO-1')).toBeUndefined()
  tasks[0].workflow = 'todo'; tasks[0].reservedAt = Date.now()
  expect(health.room('box')).toContain('limit 1')
  tasks[0].reservedAt = Date.now() - 61_000
  expect(health.room('box')).toBeUndefined()

  state.load = 9; await health.refresh()
  expect(health.room('box')).toContain('CPU')
  state.load = 1; state.memory = 81; await health.refresh()
  expect(health.room('box')).toContain('memory')
  const sample = source.store.get<{ at: number }>('health-sample', 'box')!
  sample.at -= 100_000; source.store.set('health-sample', 'box', sample)
  expect(health.room('box')).toContain('checking')
  state.online = false
  expect(health.room('box')).toContain('reconnecting')
}))

test('health events use hysteresis and persisted watch prevents repeats after restart', async () => fixture(async ({ source, health, state, events, posts }) => {
  state.memory = 95
  await health.refresh(); await health.refresh()
  expect(events).toHaveLength(1)
  expect(posts[0].card?.health?.machine).toBe('Readable box')
  const resumed = new CoreHealth(source)
  try {
    await resumed.refresh(); expect(events).toHaveLength(1)
    state.memory = 80; await resumed.refresh()
    expect(events).toHaveLength(2)
    expect(resumed.view('box')).toMatchObject({ engine: 'core', herdr: true, max: 10 })
  } finally { resumed.stop(); await resumed.drain() }
}))

test('queueing a task retains its slot until the native turn really becomes idle', async () => fixture(async ({ source, health, tasks }) => {
  await health.refresh()
  source.settings.set('machine.maxTasks', '1', 'm:box')
  const state = { value: 'working' }
  Object.assign(source.agents, { get: () => ({ state: state.value }), terminal: () => ({ state: 'live' }) })
  source.status = () => state.value === 'working' ? 'work' : 'idle'
  tasks.push({ id: 'DEMO-1', machine: 'box', chat: 'DEMO-1/Agent', workflow: 'queued', reservedAt: Date.now() - 120_000, reservedChats: ['DEMO-1/Agent'] } as CoreTask)
  expect(health.room('box')).toContain('limit 1')
  state.value = 'idle'
  expect(health.room('box')).toBeUndefined()
}))

test('a native task needing a human frees its slot without changing workflow or losing a reviewer reservation', async () => fixture(async ({ source, health, tasks }) => {
  await health.refresh()
  source.settings.set('machine.maxTasks', '1', 'm:box')
  const activity = { main: 'need', reviewer: 'idle', terminal: 'live' }
  const main = { chat: 'DEMO-1/Agent' }, reviewer = { chat: 'DEMO-1/Reviewer-1' }
  Object.assign(source.agents, { get: (chat: string) => chat === main.chat ? main : reviewer, terminal: () => activity.terminal === 'missing' ? undefined : { state: activity.terminal } })
  source.status = agent => (agent?.chat === main.chat ? activity.main : activity.reviewer) as ReturnType<CoreSource['status']>
  source.tasks.view = task => ({ ...task, status: activity.main }) as ReturnType<CoreSource['tasks']['view']>
  tasks.push({ id: 'DEMO-1', machine: 'box', chat: main.chat, workflow: 'working', reservedChats: [main.chat, reviewer.chat], reservedAt: Date.now() - 120_000 } as CoreTask)
  expect(health.room('box')).toBeUndefined()
  expect(tasks[0].workflow).toBe('working')
  activity.terminal = 'missing'
  expect(health.room('box')).toContain('limit 1')
  activity.terminal = 'finished'
  expect(health.room('box')).toBeUndefined()
  activity.terminal = 'live'
  activity.reviewer = 'work'
  expect(health.room('box')).toContain('limit 1')
  activity.reviewer = 'idle'; activity.main = 'work'
  expect(health.room('box')).toContain('limit 1')
  activity.main = 'need'; tasks[0].reservedAt = Date.now()
  expect(health.room('box')).toContain('limit 1')
}))


test('macOS reclaimable inactive and speculative pages do not hold healthy starts', () => {
  // Free pages alone imply 98% used, but cached pages can be reclaimed.
  const sample = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 20000.\nPages inactive: 260000.\nPages speculative: 10000.\nPages purgeable: 10000.\n'
  const total = 16 * 2 ** 30
  expect(darwinAvailableMemory(sample, total)).toBe(290000 * 16384)
  expect(100 * (total - darwinAvailableMemory(sample, total)) / total).toBeLessThan(80)
  expect(darwinAvailableMemory(sample.replace('16384', '4096'), total)).toBe(290000 * 4096)
  expect(darwinAvailableMemory(sample, 1024)).toBe(1024)
})

test('macOS malformed or missing memory statistics refuse a fresh sample', () => {
  expect(() => darwinAvailableMemory('Pages free: 1.', 1024)).toThrow()
  expect(() => darwinAvailableMemory('page size of 16384 bytes\nPages free: 1.\nPages inactive: 2.', 1024)).toThrow('incomplete')
  expect(() => darwinAvailableMemory('page size of 0 bytes\nPages free: 1.\nPages inactive: 2.\nPages speculative: 3.', 1024)).toThrow('invalid')
})
