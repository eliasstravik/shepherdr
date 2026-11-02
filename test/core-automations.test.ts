import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreStore } from '../server/core/store.ts'
import { CoreAutomations } from '../server/core/automations.ts'
import type { CoreSource } from '../server/core/source.ts'
import type { CoreSpace } from '../server/core/model.ts'
import type { CoreTask } from '../server/core/tasks.ts'

async function fixture(run: (context: { source: CoreSource; scheduler: CoreAutomations; launches: string[]; tasks: CoreTask[]; space: CoreSpace }) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-automation-')), store = new CoreStore(home)
  const spaces = [{ id: 'p:box:demo', name: 'demo', machine: 'box', folder: '/repo', prefix: 'DEMO', base: 'main' }, { id: 'p:other:demo', name: 'demo', machine: 'other', folder: '/other', prefix: 'DEMO', base: 'main' }] as CoreSpace[]
  const tasks: CoreTask[] = [], launches: string[] = []
  const source = { store, places: { removing: () => false }, connected: () => true, machineConnected: () => true, agents: { get: () => undefined, terminal: () => undefined }, emit() {}, on() {}, settings: { get: () => 'UTC' }, spaces: () => spaces, space: (id: string) => spaces.find(space => space.id === id), tasks: {
    all: () => tasks, busy: () => false, view: (task: CoreTask) => ({ status: task.status }),
    addInSpace: async (space: CoreSpace, input: { title: string; automation: string }) => { launches.push(space.id); const task = { id: `DEMO-${launches.length}`, place: space.id, name: input.title, workflow: 'working', status: 'work', automation: input.automation } as CoreTask; tasks.push(task); return task },
  } } as unknown as CoreSource
  const scheduler = new CoreAutomations(source)
  try { await run({ source, scheduler, launches, tasks, space: spaces[0] }) }
  finally { scheduler.stop(); await scheduler.drain(); store.close(); rmSync(home, { recursive: true, force: true }) }
}

test('due once rule claims before launch, runs once and keeps its task/run across restart', async () => fixture(async ({ source, scheduler, launches, space }) => {
  scheduler.model.add({ place: space.id, name: 'daily', trigger: { time: 'once 2020-01-01 00:00' }, task: { title: 'Check' } }, 0)
  await scheduler.scan(); await scheduler.drain()
  expect(launches).toEqual([space.id])
  expect(scheduler.model.find(space.id, 'daily')).toMatchObject({ on: false, runs: [{ task: 'DEMO-1' }] })
  const restarted = new CoreAutomations(source)
  try { await restarted.scan(); await restarted.drain(); expect(launches).toHaveLength(1) }
  finally { restarted.stop() }
}))

test('lost manual response reuses durable command and paused automation stays paused after run now', async () => fixture(async ({ scheduler, launches, space }) => {
  scheduler.model.add({ place: space.id, name: 'manual', trigger: { on: [{ event: 'ready' }] }, task: { title: 'Check' } })
  scheduler.model.pause(space.id, 'manual', false)
  const action = { type: 'automation' as const, cid: 'manual-run-retry', place: space.id, name: 'manual', op: 'run' as const }
  expect(await scheduler.act(action)).toEqual({ task: 'DEMO-1' })
  expect(await scheduler.act(action)).toEqual({ task: 'DEMO-1' })
  expect(launches).toHaveLength(1)
  expect(scheduler.model.find(space.id, 'manual')?.on).toBe(false)
}))

test('events distinguish identical space names on other machines and suppress automation-added recursion', async () => fixture(async ({ scheduler, launches, tasks, space }) => {
  scheduler.model.add({ place: space.id, name: 'added', trigger: { on: [{ event: 'added' }] }, task: { title: 'Check' } })
  await scheduler.event({ event: 'added', space: 'demo' }, 'p:other:demo'); await scheduler.drain()
  expect(launches).toHaveLength(0)
  tasks.push({ id: 'DEMO-human', name: 'Human', place: space.id, workflow: 'working', status: 'work' } as CoreTask)
  await scheduler.scan(); await scheduler.drain(); await scheduler.scan(); await scheduler.drain()
  expect(launches).toHaveLength(1)
  expect(tasks).toHaveLength(2)
}))

test('restart settles an interrupted claim without launching twice and shutdown refuses new runs', async () => fixture(async ({ source, scheduler, launches, space }) => {
  const automation = scheduler.model.add({ place: space.id, name: 'interrupted', trigger: { on: [{ event: 'ready' }] }, task: { title: 'Check' } })
  const run = { id: 'interrupted-run', automation: automation.id, place: space.id, at: Date.now(), timed: false, state: 'starting' }
  scheduler.model.fired(automation, { error: 'Starting' }, run.at)
  source.store.set('automation-run', run.id, run)
  scheduler.start(); await scheduler.drain()
  expect(scheduler.model.find(space.id, 'interrupted')?.runs?.[0]?.error).toContain('interrupted')
  expect(launches).toHaveLength(0)
  source.quiescing = true
  await expect(scheduler.fire(automation)).rejects.toThrow('stopping')
}))


test('two matching events in one scan each keep a durable run while one automation is busy', async () => fixture(async ({ source, scheduler, launches, tasks, space }) => {
  scheduler.model.add({ place: space.id, name: 'ready', trigger: { on: [{ event: 'ready' }] }, task: { title: 'Check each' } })
  const first = { id: 'HUMAN-1', name: 'First', place: space.id, workflow: 'working', status: 'work' } as CoreTask
  const second = { ...first, id: 'HUMAN-2', name: 'Second' }
  tasks.push(first, second)
  await scheduler.scan(); await scheduler.drain()
  first.workflow = second.workflow = 'ready'
  first.status = second.status = 'ready'
  await scheduler.scan(); await scheduler.drain()
  expect(launches).toHaveLength(2)
  expect(source.store.all<{ state: string }>('automation-run').filter(run => run.state === 'done')).toHaveLength(2)
  await scheduler.scan(); await scheduler.drain()
  expect(launches).toHaveLength(2)
}))


test('an unrelated explicit event rule cannot grant another machine implicit-space authority', async () => fixture(async ({ scheduler, launches, space }) => {
  scheduler.model.add({ place: space.id, name: 'mixed', trigger: { on: [{ event: 'ready' }, { event: 'merged', space: 'other' }] }, task: { title: 'Check' } })
  await scheduler.event({ event: 'ready', space: 'demo' }, 'p:other:demo'); await scheduler.drain()
  expect(launches).toHaveLength(0)
  await scheduler.event({ event: 'ready', space: 'demo' }, space.id); await scheduler.drain()
  expect(launches).toHaveLength(1)
}))

test('invalid schedule returns a useful refusal before creating an automation', async () => fixture(async ({ scheduler, space }) => {
  const agent = { role: 'coordinator', machine: space.machine, space: space.id } as Parameters<CoreAutomations['cli']>[0]
  await expect(scheduler.cli(agent, ['automation', 'add', 'Check', '--task', 'Check', '--when', 'every 5 minutes'])).rejects.toThrow('RRULE')
  expect(scheduler.model.list).toHaveLength(0)
  await expect(scheduler.cli({ ...agent, role: 'task' }, ['automation', 'list'])).rejects.toThrow('Only a coordinator')
}))

test('confirmed failures emit once across restart; intentional To-do stops and offline machines do not fail', async () => fixture(async ({ source, scheduler, tasks, launches, space }) => {
  scheduler.model.add({ place: space.id, name: 'failure', trigger: { on: [{ event: 'failed' }] }, task: { title: 'Investigate' } })
  const task = { id: 'FAILED-1', chat: 'FAILED-1/Agent', place: space.id, machine: space.machine, name: 'Failed', workflow: 'working', status: 'need' } as CoreTask
  tasks.push(task)
  const terminal = { state: 'finished', exit_code: 1, reason: 'exited' }
  source.agents.get = ((chat: string) => chat === task.chat ? { launch: 'launch', started: 1 } : undefined) as unknown as typeof source.agents.get
  source.agents.terminal = (() => terminal) as unknown as typeof source.agents.terminal
  await scheduler.scan(); await scheduler.drain()
  expect(launches).toHaveLength(1)
  const restored = new CoreAutomations(source)
  try { await restored.scan(); await restored.drain(); expect(launches).toHaveLength(1) } finally { restored.stop() }
  task.workflow = 'todo'; await scheduler.scan(); await scheduler.drain(); expect(launches).toHaveLength(1)
  task.workflow = 'working'; source.machineConnected = () => false
  await scheduler.scan(); await scheduler.drain(); expect(launches).toHaveLength(1)
}))

test('a task waiting for its own review raises no stalled news, then its needs-you once the wait ends', async () => fixture(async ({ source, scheduler, tasks, space }) => {
  const start = 1000000, agent = { launch: 'live', started: start, activityAt: start }, terminal = { state: 'live' }
  const task = { id: 'WAIT-1', chat: 'WAIT-1/Agent', place: space.id, machine: space.machine, name: 'Waits', workflow: 'working', status: 'work', reportedAt: start, report: { eta: 1, msg: 'Working', progress: 1 } } as CoreTask
  tasks.push(task)
  const recorded: string[] = []
  Object.defineProperty(source, 'news', { value: { record: (_task: CoreTask, event: string) => recorded.push(event), deliver() {} } })
  source.agents.get = ((chat: string) => chat === task.chat ? agent : undefined) as unknown as typeof source.agents.get
  source.agents.terminal = (() => terminal) as unknown as typeof source.agents.terminal
  const view = source.tasks.view
  source.tasks.view = (item => ({ ...view(item), waitsFor: 'review' })) as typeof source.tasks.view
  await scheduler.scan(start); await scheduler.scan(start + 30 * 60000)
  expect(recorded).not.toContain('stalled')
  source.tasks.view = (item => ({ ...view(item), status: 'need' })) as typeof source.tasks.view
  await scheduler.scan(start + 31 * 60000)
  expect(recorded).toContain('needs-you')
}))

test('quiet and over-estimate stalls persist and re-arm only with new activity or a new report', async () => fixture(async ({ source, scheduler, tasks, launches, space }) => {
  scheduler.model.add({ place: space.id, name: 'stall', trigger: { on: [{ event: 'stalled' }] }, task: { title: 'Inspect stall' } })
  const start = 1000000, agent = { launch: 'live', started: start, activityAt: start }, terminal = { state: 'live' }
  const task = { id: 'SLOW-1', chat: 'SLOW-1/Agent', place: space.id, machine: space.machine, name: 'Slow', workflow: 'working', status: 'work', reportedAt: start, report: { eta: 1, msg: 'Working', progress: 1 } } as CoreTask
  tasks.push(task)
  source.agents.get = ((chat: string) => chat === task.chat ? agent : undefined) as unknown as typeof source.agents.get
  source.agents.terminal = (() => terminal) as unknown as typeof source.agents.terminal
  await scheduler.scan(start + 19 * 60000); await scheduler.drain(); expect(launches).toHaveLength(0)
  await scheduler.scan(start + 22 * 60000); await scheduler.drain(); expect(launches).toHaveLength(1)
  const restored = new CoreAutomations(source)
  try { await restored.scan(start + 23 * 60000); await restored.drain(); expect(launches).toHaveLength(1) } finally { restored.stop() }
  agent.activityAt = start + 24 * 60000
  await scheduler.scan(start + 25 * 60000); await scheduler.drain(); expect(launches).toHaveLength(1)
  await scheduler.scan(start + 45 * 60000); await scheduler.drain(); expect(launches).toHaveLength(2)
  task.reportedAt = start + 46 * 60000; agent.activityAt = task.reportedAt
  await scheduler.scan(start + 68 * 60000); await scheduler.drain(); expect(launches).toHaveLength(3)
}))

test('identical setup errors are new failures only for a new accepted launch attempt', async () => fixture(async ({ source, scheduler, tasks, launches, space }) => {
  scheduler.model.add({ place: space.id, name: 'setup', trigger: { on: [{ event: 'failed' }] }, task: { title: 'Investigate setup' } })
  const task = { id: 'SETUP-1', place: space.id, machine: space.machine, name: 'Setup', workflow: 'todo', status: 'need', startError: 'Same failure', launchAttempt: 'first' } as CoreTask
  tasks.push(task)
  await scheduler.scan(); await scheduler.drain(); expect(launches).toHaveLength(1)
  const restored = new CoreAutomations(source)
  try {
    await restored.scan(); await restored.drain(); expect(launches).toHaveLength(1)
    task.launchAttempt = 'second'
    await restored.scan(); await restored.drain(); expect(launches).toHaveLength(2)
    await restored.scan(); await restored.drain(); expect(launches).toHaveLength(2)
  } finally { restored.stop() }
}))

test('removed spaces keep timed and queued rules dormant until re-add', async () => fixture(async ({ source, scheduler, launches, space }) => {
  scheduler.model.add({ place: space.id, name: 'timed-hidden', trigger: { time: 'once 2020-01-01 00:00' }, task: { title: 'Timed' } }, 0)
  scheduler.model.add({ place: space.id, name: 'event-hidden', trigger: { on: [{ event: 'ready' }] }, task: { title: 'Event' } })
  scheduler.record({ event: 'ready', space: space.name }, space.id)
  const lookup = source.space.bind(source)
  let hidden = true
  source.space = id => hidden && id === space.id ? undefined : lookup(id)
  await scheduler.scan(); await scheduler.drain()
  expect(launches).toEqual([])
  expect(scheduler.model.find(space.id, 'timed-hidden')?.runs).toBeUndefined()
  hidden = false
  await scheduler.scan(); await scheduler.drain()
  expect(launches).toEqual([space.id, space.id])
  expect(scheduler.model.find(space.id, 'event-hidden')?.runs?.[0]?.task).toBeDefined()
}))
