import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreStore } from '../server/core/store.ts'
import { checkWords, CoreGitHubPr, prComments } from '../server/core/github-pr.ts'
import type { CoreSource } from '../server/core/source.ts'
import type { CoreTask } from '../server/core/tasks.ts'
const head = 'a'.repeat(40), since = Date.parse('2026-10-30T10:00:00.800Z')
const raw = (id: number, body = 'Please fix this') => ({ id, body, html_url: `https://github.test/o/r/pull/1#issuecomment-${id}`, user: { login: 'reviewer' }, created_at: '2026-10-30T10:00:00Z' })

test('published review time controls drafted line comments and pending drafts remain private', () => {
  const pending = { ...raw(1, ''), state: 'PENDING', submitted_at: null }
  const line = { ...raw(2), pull_request_review_id: 1, path: 'a.ts', line: 3, created_at: '2026-10-29T00:00:00Z' }
  expect(prComments([[line]], 'c', [pending])).toEqual([])
  expect(prComments([[line]], 'c', [])).toEqual([])
  expect(prComments([[line]], 'c', [{ ...pending, state: 'COMMENTED' }])).toEqual([])
  expect(prComments([[line]], 'c', [{ ...pending, state: 'CHANGES_REQUESTED', submitted_at: '2026-10-30T10:00:00Z' }])).toMatchObject([{ id: 'c2', at: Math.floor(since / 1000) * 1000, where: 'a.ts:3' }])
})

async function fixture(run: (f: { source: CoreSource; monitor: CoreGitHubPr; task: CoreTask; sent: { id: string; work: boolean; text: string }[]; setNotes(value: object[]): void; setChecks(value: object[]): void }) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-github-pr-')), store = new CoreStore(home)
  const task = { id: 'DEMO-1', chat: 'DEMO-1/Agent', name: 'Example', place: 'space', machine: 'machine', folder: '/repo/work', branch: 'work/one', workflow: 'ready', pr: { number: 1, url: 'https://github.test/o/r/pull/1' }, readyAt: since, readyHead: head, mergePolicy: 'ask' } as CoreTask
  const sent: { id: string; work: boolean; text: string }[] = []
  let notes: object[] = [], checks: object[] = []
  const source = { store, machineConnected: () => true, status: () => 'idle', agents: { get: () => ({ launch: 'launch' }), terminal: () => ({ state: 'live' }) },
    tasks: { all: () => [task], get: (id: string) => id === task.id ? task : undefined, busy: () => false, git: {
      remote: async () => 'github.test/o/r', pullRequest: async () => ({ number: 1, state: 'OPEN', headRefOid: head, statusCheckRollup: checks }),
      gh: async (_repo: unknown, args: string[]) => [args.at(-1)?.includes('/issues/') ? notes : []],
    } }, emit: () => {}, post: (chat: string, message: { id: string }) => store.set(`message:${chat}`, message.id, message),
    saveAndDeliver: (_chat: string, id: string, text: string, save: () => void, _quiet: boolean, work: boolean) => store.db.transaction(() => { save(); sent.push({ id, text, work }) })(),
  } as unknown as CoreSource
  const monitor = new CoreGitHubPr(source)
  try { await run({ source, monitor, task, sent, setNotes: value => { notes = value }, setChecks: value => { checks = value } }) }
  finally { monitor.stop(); store.close(); rmSync(home, { recursive: true, force: true }) }
}

test('new comments and failed checks persist one actionable follow-up across reconstruction', async () => fixture(async f => {
  f.setNotes([raw(1)]); f.setChecks([{ name: 'Check', conclusion: 'FAILURE', detailsUrl: 'https://github.test/run/1' }])
  await f.monitor.scan(since + 1000)
  expect(f.sent).toHaveLength(1); expect(f.sent[0].work).toBe(true)
  expect(f.sent[0].text).toContain('Please fix this')
  const restored = new CoreGitHubPr(f.source)
  try { await restored.scan(since + 62000); expect(f.sent).toHaveLength(1) } finally { restored.stop() }
  f.setNotes([raw(1), raw(2, 'Another note')])
  await f.monitor.scan(since + 123000); expect(f.sent).toHaveLength(2)
  f.task.mergePolicy = 'auto'; f.setChecks([{ conclusion: 'SUCCESS' }])
  await f.monitor.scan(since + 184000)
  expect(f.sent).toHaveLength(2) // Following up must report Ready again before an automatic merge nudge.
}))

test('checks-ready nudge preserves Ready and never grants ask-mode approval or accepts cancelled checks', async () => {
  for (const mode of ['ask', 'checks', 'auto'] as const) await fixture(async f => {
    f.task.mergePolicy = mode; f.setChecks([{ conclusion: 'CANCELLED' }])
    await f.monitor.scan(since + 1000); expect(f.sent).toHaveLength(0)
    f.setChecks([{ conclusion: 'SUCCESS' }])
    await f.monitor.scan(since + 62000)
    expect(f.sent).toHaveLength(mode === 'ask' ? 0 : 1)
    if (mode !== 'ask') { expect(f.sent[0].work).toBe(false); expect(f.sent[0].text).toContain('grants no new access or merge approval') }
    await f.monitor.scan(since + 123000); expect(f.sent).toHaveLength(mode === 'ask' ? 0 : 1)
  })
})

test('check words never make unfinished or failed checks look green', () => {
  expect(checkWords([])).toEqual({ state: 'none', text: 'None reported yet' })
  expect(checkWords([{ conclusion: 'SUCCESS' }, { state: 'SKIPPED' }])).toEqual({ state: 'passed', text: '2 passed' })
  expect(checkWords([{ conclusion: 'SUCCESS' }, { state: 'PENDING' }])).toEqual({ state: 'running', text: '1 running, 1 passed' })
  expect(checkWords([{ conclusion: 'CANCELLED' }])).toEqual({ state: 'failed', text: '1 failed' })
  expect(checkWords([{ conclusion: 'FAILURE' }, {}, { conclusion: 'SUCCESS' }])).toEqual({ state: 'failed', text: '1 failed, 1 running, 1 passed' })
})

test('the watch keeps the checks of the commit it read, for an open merge card', async () => fixture(async f => {
  f.setChecks([{ conclusion: 'SUCCESS' }, { state: 'PENDING' }])
  await f.monitor.watch(f.task, since + 1000)
  expect(f.source.store.get('github-pr', f.task.id)).toMatchObject({ head, checks: { state: 'running', text: '1 running, 1 passed' } })
}))

test('busy agents retain unseen comments and stale native launches cannot receive them', async () => fixture(async f => {
  f.setNotes([raw(1)]); f.source.status = () => 'work'
  await f.monitor.scan(since + 1000); expect(f.sent).toHaveLength(0)
  f.source.status = () => 'idle'
  const query = f.source.tasks.git.pullRequest.bind(f.source.tasks.git)
  f.source.tasks.git.pullRequest = async (...args) => { const result = await query(...args); f.source.agents.get = (() => ({ launch: 'replacement' })) as unknown as typeof f.source.agents.get; return result }
  await f.monitor.scan(since + 62000)
  expect(f.sent).toHaveLength(0)
  expect(f.source.store.all('github-pr')).toHaveLength(0)
}))

test('large comments are explicitly excerpted in the wake and remain fully readable', async () => fixture(async f => {
  const body = 'x'.repeat(60000); f.setNotes([raw(1, body)])
  await f.monitor.scan(since + 1000)
  expect(f.sent[0].text).toContain('"truncated":true')
  expect(f.sent[0].text.length).toBeLessThan(10000)
  expect((await f.monitor.comments(f.task))[0].body).toBe(body)
}))

test('check-read denial cannot hide published feedback or produce a green-check merge nudge', async () => fixture(async f => {
  const query = f.source.tasks.git.pullRequest.bind(f.source.tasks.git)
  f.source.tasks.git.pullRequest = async (repo, branch, checks = true) => { if (checks) throw Error('Checks HTTP 403'); return query(repo, branch, false) }
  f.task.mergePolicy = 'checks'; f.setNotes([raw(1, 'Please apply this published correction')])
  await f.monitor.scan(since + 1000)
  expect(f.sent).toHaveLength(1)
  expect(f.sent[0]).toMatchObject({ work: true })
  expect(f.sent[0].text).toContain('Please apply this published correction')
  expect(f.sent[0].text).not.toContain('checksReady')
  expect(f.source.store.get<{ error: string }>('github-pr', f.task.id)?.error).toBe('Checks HTTP 403')
  await new CoreGitHubPr(f.source).scan(since + 62000)
  expect(f.sent).toHaveLength(1)
}))
