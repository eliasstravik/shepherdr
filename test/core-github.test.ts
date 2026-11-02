import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreStore } from '../server/core/store.ts'
import { CoreGitHub, mainCandidates, mainVerdict } from '../server/core/github.ts'
import type { CoreSource } from '../server/core/source.ts'
import type { CoreSpace } from '../server/core/model.ts'
import type { Happened } from '../server/common/trigger.ts'
const sha = 'a'.repeat(40), later = 'b'.repeat(40)
const row = (conclusion: string | null = 'failure', status = 'completed', headSha = sha) => ({ headSha, status, conclusion, url: 'https://github.test/o/r/actions/runs/1', workflowName: 'Check' })

test('main verdict never calls missing, pending, unknown or truncated workflow results green', () => {
  expect(mainVerdict([row()], sha).state).toBe('fail')
  expect(mainVerdict([row('success')], sha).state).toBe('pass')
  for (const runs of [[], [row('cancelled')], [row('success'), row('cancelled')], [row('new_conclusion')], [row(null, 'in_progress')], [row('success', 'completed', later)], Array.from({ length: 100 }, () => row('success'))]) expect(mainVerdict(runs, sha).state).toBe('pending')
  expect(() => mainVerdict([{}], sha)).toThrow('Incomplete')
})

async function fixture(run: (f: { source: CoreSource; monitor: CoreGitHub; space: CoreSpace; events: Happened[]; sent: string[]; calls: string[][]; setRows(rows: unknown): void; setHead(head: string): void }) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-github-')), store = new CoreStore(home)
  const space: CoreSpace = { id: 'space', name: 'Demo', machine: 'machine', folder: '/repo', base: 'main', prefix: 'DEMO', mode: 'regular', added: 1 }
  const now = Date.now(), events: Happened[] = [], sent: string[] = [], calls: string[][] = []
  let rows: unknown = [row()], head = sha
  const source = { store, connected: () => true, machineConnected: () => true, space: (id: string) => id === space.id ? space : undefined, spaces: () => [space], status: () => 'idle',
    agents: { get: () => ({ chat: space.id, launch: 'launch' }), terminal: () => ({ state: 'live' }) },
    tasks: { all: () => [{ place: space.id, base: 'main', workflow: 'merged', pr: { number: 1 }, doneAt: now }], git: {
      remote: async () => 'github.test/o/r', ghRun: async (_repo: unknown, args: string[]) => { calls.push(args); return args.some(arg => arg.includes('/actions/jobs/')) ? 'A harmless compiler error tail' : head }, gh: async (_repo: unknown, args: string[]) => { calls.push(args); if (args.some(arg => arg.includes('/actions/runs/'))) return { total_count: 1, jobs: [{ id: 1, name: 'Check', status: 'completed', conclusion: 'failure' }] }; if (args[0] === 'api') return args.some(arg => arg.includes('?sha=')) ? [...new Set([head, sha])] : [{ sha, message: 'DEMO-1: Example merge' }]; return rows },
    } }, automations: { record: (event: Happened) => { events.push(event); store.set('rule-proof', String(events.length), event) } },
    post: (chat: string, message: { id: string }) => store.set(`message:${chat}`, message.id, message),
    saveAndDeliver: (_chat: string, id: string, _text: string, save: () => void) => store.db.transaction(() => { save(); sent.push(id) })(),
  } as unknown as CoreSource
  const monitor = new CoreGitHub(source)
  try { await run({ source, monitor, space, events, sent, calls, setRows: value => { rows = value }, setHead: value => { head = value } }) }
  finally { monitor.stop(); await monitor.drain(); store.close(); rmSync(home, { recursive: true, force: true }) }
}

test('main-red persists one incident, native notice and rule event across restart; green re-arms it', async () => fixture(async f => {
  await f.monitor.tick()
  expect(f.events.map(event => event.event)).toEqual(['main-red'])
  expect(f.sent).toHaveLength(1)
  expect(f.source.store.all('message:space')).toHaveLength(1)
  const restored = new CoreGitHub(f.source)
  try {
    await restored.watchMain(f.space)
    expect(f.events).toHaveLength(1)
    f.setHead(later); f.setRows([row('failure', 'completed', later)])
    await restored.watchMain(f.space); expect(f.events).toHaveLength(1)
    f.setRows([row(null, 'in_progress', later)])
    await restored.watchMain(f.space)
    expect(f.source.store.all<{ red?: string }>('github-main')[0].red).toBe(sha)
    f.setRows([row('success', 'completed', later)])
    await restored.watchMain(f.space)
    expect(f.source.store.all<{ red?: string }>('github-main')[0].red).toBeUndefined()
    f.setRows([row('failure', 'completed', later)])
    await restored.watchMain(f.space)
    expect(f.events).toHaveLength(2)
    expect(f.calls.some(args => args.includes('--commit') && args.includes(later))).toBe(true)
    expect(f.calls.some(args => args.includes('--hostname') && args.includes('github.test'))).toBe(true)
  } finally { restored.stop() }
}))

test('unknown GitHub responses retain red and unsent news waits for an idle current coordinator', async () => fixture(async f => {
  f.source.status = () => 'work'
  await f.monitor.tick()
  expect(f.sent).toHaveLength(0)
  f.source.tasks.git.gh = async () => { throw Error('GitHub disconnected') }
  await f.monitor.watchMain(f.space)
  expect(f.source.store.all<{ red?: string; error?: string }>('github-main')[0]).toMatchObject({ red: sha, error: 'GitHub disconnected' })
  f.source.status = () => 'idle'
  await f.monitor.tick(Date.now() + 61000)
  expect(f.sent).toHaveLength(1)
  await f.monitor.tick(Date.now() + 122000)
  expect(f.sent).toHaveLength(1)
}))

test('a changing base or removed space cannot publish stale main news', async () => fixture(async f => {
  let reads = 0
  f.source.tasks.git.ghRun = async () => ++reads === 1 ? sha : later
  await f.monitor.watchMain(f.space)
  expect(f.events).toHaveLength(0)
  expect(f.source.store.all<{ error?: string }>('github-main')[0].error).toContain('base changed')
  f.source.space = () => undefined
  await f.monitor.watchMain(f.space)
  expect(f.events).toHaveLength(0)
}))

test('waiting main news is cancelled after a base change or a confirmed green result', async () => {
  for (const change of ['base', 'green']) await fixture(async f => {
    f.source.status = () => 'work'
    await f.monitor.tick(); expect(f.sent).toHaveLength(0)
    if (change === 'base') f.space.base = 'develop'
    else { f.setRows([row('success')]); await f.monitor.watchMain(f.space) }
    f.source.status = () => 'idle'
    await f.monitor.tick(Date.now() + 61000)
    expect(f.sent).toHaveLength(0)
    expect(f.source.store.all<{ state: string }>('github-notice')[0].state).toBe('cancelled')
  })
})

test('a failed publication transaction does not swallow the red incident on retry', async () => fixture(async f => {
  const record = f.source.automations.record
  f.source.automations.record = () => { throw Error('Could not save event') }
  await f.monitor.watchMain(f.space)
  expect(f.source.store.all('message:space')).toEqual([])
  expect(f.source.store.all('github-notice')).toEqual([])
  expect(f.source.store.all<{ red?: string }>('github-main')[0].red).toBeUndefined()
  f.source.automations.record = record
  await f.monitor.watchMain(f.space)
  expect(f.events).toHaveLength(1)
  expect(f.source.store.all('github-notice')).toHaveLength(1)
}))

test('main-red title filters use a known task title, never a workflow name as a task title', async () => fixture(async f => {
  await f.monitor.watchMain(f.space)
  expect(f.events[0].title).toBeUndefined()
  f.setRows([row('success')]); await f.monitor.watchMain(f.space)
  f.source.tasks.all = (() => [{ id: 'DEMO-1', name: 'Actual merged task', machine: f.space.machine, repo: f.space.folder, place: f.space.id, base: 'main', workflow: 'merged', pr: { number: 1 }, doneAt: Date.now(), mergeCommit: sha }]) as unknown as typeof f.source.tasks.all
  f.setRows([row()]); await f.monitor.watchMain(f.space)
  expect(f.events[1].title).toBe('Actual merged task')
}))

test('newer pending branch commits do not hide an older failed commit, and only a confirmed green re-arms it', async () => fixture(async f => {
  f.setHead(later); f.setRows([row(null, 'in_progress', later), row()])
  await f.monitor.tick()
  expect(f.events).toHaveLength(1)
  expect(f.source.store.all<{ red?: string }>('github-main')[0].red).toBe(sha)
  const notice = f.source.store.all<{ text: string }>('github-notice')[0]
  expect(JSON.parse(notice.text)).toMatchObject({ head: sha, context: { merged: [{ sha, title: 'DEMO-1: Example merge' }], logTail: '\nCheck\nA harmless compiler error tail' } })
  f.setRows([row('success', 'completed', later), row()])
  await f.monitor.watchMain(f.space)
  expect(f.source.store.all<{ red?: string; green?: string }>('github-main')[0]).toMatchObject({ green: later })
  expect(f.source.store.all<{ red?: string }>('github-main')[0].red).toBeUndefined()
  expect(f.events).toHaveLength(1)
}))
test('candidate order comes from verified base history; unrelated runs and pending results are not verdicts', () => {
  const other = 'c'.repeat(40)
  expect(mainCandidates([row('failure', 'completed', other), row(null, 'in_progress', later), row()], [later, sha]).map(candidate => candidate.head)).toEqual([sha])
  expect(() => mainCandidates([row()], ['not-a-sha'])).toThrow('history')
})
test('a candidate becoming pending during confirmation never clears a saved red incident', async () => fixture(async f => {
  await f.monitor.watchMain(f.space)
  f.setHead(later)
  f.source.tasks.git.gh = async <T>(_repo: unknown, args: string[]) => (args[0] === 'api' ? [later, sha] : args.includes('--commit') ? [row(null, 'in_progress', later)] : [row('success', 'completed', later)]) as T
  await f.monitor.watchMain(f.space)
  expect(f.source.store.all<{ red?: string }>('github-main')[0].red).toBe(sha)
}))
