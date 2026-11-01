import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreTasks, type CoreTask } from '../server/core/tasks.ts'
import { CoreStore } from '../server/core/store.ts'
import type { CoreSource } from '../server/core/source.ts'
import type { Grant } from '../server/core/mailbox.ts'
import type { Message, UpdateCard } from '../shared/types.ts'
import { seal, unseal, type MailCredential } from '../server/core/envelope.ts'

/** Real local git on CI, fake core boundary; no provider credentials or network needed. */
async function withTask(run: (context: { tasks: CoreTasks; task: CoreTask; grant: Grant; repo: string; worktree: string; git: (cwd: string, ...args: string[]) => void; state: { terminal: string } }) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'shep-task-'))
  const repo = join(root, 'repo'), worktree = join(root, 'worktree')
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Core test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'Core test', GIT_COMMITTER_EMAIL: 'test@localhost' }
  const git = (cwd: string, ...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd, env })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  }
  const init = Bun.spawnSync(['git', 'init', '--initial-branch=main', repo], { env })
  if (init.exitCode !== 0) throw new Error(init.stderr.toString())
  writeFileSync(join(repo, 'example.txt'), 'before\n'); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'base')
  git(repo, 'worktree', 'add', '-b', 'work/1-example', worktree)
  writeFileSync(join(worktree, 'example.txt'), 'after\n'); git(worktree, 'commit', '-am', 'change')
  const store = new CoreStore(join(root, 'home'))
  const task: CoreTask = { id: 'DEMO-1', name: 'Example', desc: 'Change example.txt', place: 'space', machine: 'machine', repo, folder: worktree,
    branch: 'work/1-example', base: 'main', chat: 'DEMO-1/Agent', kind: 'codex', workflow: 'working', status: 'work', mergePolicy: 'ask',
    review: { on: false, kind: 'codex', rounds: 3, mustFix: 'major' }, age: 'now', created: new Date().toISOString(), on: 'test', state: 'Working' }
  store.set('task', task.id, task)
  const state = { terminal: 'live' }
  const grant = { id: 'grant', chat: task.chat, session: 'launch', machine: task.machine, actions: [] } as unknown as Grant
  const source = {
    store, config: { home: store.home }, space: () => ({ id: 'space', name: 'demo', machine: 'machine', folder: repo, mode: 'regular', base: 'main', prefix: 'DEMO', added: 1 }), settings: { get: () => 'off' },
    files: { exec: async (_machine: string, argv: string[], cwd?: string, input?: Uint8Array) => {
      const result = Bun.spawnSync(argv, { cwd, env, stdin: input ?? 'ignore' })
      if (result.exitCode !== 0) throw new Error(result.stderr.toString())
      return result.stdout
    } },
    agents: { all: () => [], get: (chat: string) => chat === task.chat ? { chat, launch: grant.session, grant: grant.id, role: 'task', machine: task.machine, space: task.place, kind: 'codex' } : undefined,
      terminal: () => ({ address: 't1', state: state.terminal }), send: async () => {} },
    browsers: { close: async () => {} }, github: { prs: { comments: async () => [] } },
    core: { current: { terminals: new Map() }, call: async () => ({}) }, saveAndDeliver: (_chat: string, _id: string, _text: string, save: () => void) => save(), status: () => 'idle', connected: () => true, emit: () => {},
    post: (chat: string, message: Message) => store.set(`message:${chat}`, message.id, message),
    taskRow: (chat: string, row: CoreTask, card: UpdateCard) => store.set(`message:${chat}`, `task-row-${row.id}`, { id: `task-row-${row.id}`, who: 'agent', card }),
  } as unknown as CoreSource
  const tasks = new CoreTasks(source)
  tasks.seedIncludes = async () => {} // Native include execution is covered separately in core-worktree-includes.
  try { await run({ tasks, task, grant, repo, worktree, git, state }) }
  finally { store.close(); rmSync(root, { recursive: true, force: true }) }
}

test('merge requires a human card approval for the exact ready commit', async () => {
  await withTask(async ({ tasks, task, grant, repo }) => {
    await tasks.ready(grant, task.id, 'Changed the example')
    await expect(tasks.merge(grant, task.id)).rejects.toThrow('human must approve')
    expect(readFileSync(join(repo, 'example.txt'), 'utf8')).toBe('before\n')
    const ready = tasks.get(task.id)!
    await tasks.answer(ready.mergeQuestion!, 0, task.chat)
    await tasks.merge(grant, task.id)
    expect(readFileSync(join(repo, 'example.txt'), 'utf8')).toBe('after\n')
    expect(tasks.get(task.id)?.workflow).toBe('merged')
    await expect(tasks.merge(grant, task.id)).resolves.toMatchObject({ workflow: 'merged' })
  })
})

test('a merge card carries the exact commit, its files and lines, and says plainly when no checks exist', async () => {
  await withTask(async ({ tasks, task, grant }) => {
    await tasks.ready(grant, task.id, 'Changed the example')
    const ready = tasks.get(task.id)!, store = (tasks as unknown as { source: CoreSource }).source.store
    const card = store.get<Message>(`message:${task.chat}`, ready.mergeQuestion!)!.question!
    expect(card.evidence).toEqual({ commit: ready.readyHead!.slice(0, 7), summary: 'Changed the example',
      diff: { files: 1, added: 1, removed: 1, list: [{ path: 'example.txt', added: 1, removed: 1 }] },
      checks: { state: 'none', text: 'No pull request, so no GitHub checks' } })
  })
})

test('a merge card never shows the checks of another commit', async () => {
  await withTask(async ({ tasks, task, grant, repo, git }) => {
    git(repo, 'update-ref', 'refs/remotes/origin/main', 'main')
    task.pr = { number: 1, url: 'https://github.test/o/r/pull/1' }
    const store = (tasks as unknown as { source: CoreSource }).source.store
    store.set('task', task.id, task)
    tasks.git.remote = async () => 'github.test/o/r'
    tasks.git.ghRun = async () => ''
    let head = ''
    tasks.git.pullRequest = (async (_repo: unknown, _branch: string, checks = true) => checks ? { headRefOid: 'b'.repeat(40), statusCheckRollup: [{ conclusion: 'SUCCESS' }] } : { number: 1, state: 'OPEN', isDraft: false, headRefOid: head = await tasks.git.head({ machine: task.machine, folder: task.folder }), baseRefName: 'main' }) as typeof tasks.git.pullRequest
    await tasks.ready(grant, task.id, 'Changed the example')
    const card = store.get<Message>(`message:${task.chat}`, tasks.get(task.id)!.mergeQuestion!)!.question!
    expect(head).toBeTruthy()
    expect(card.evidence?.checks).toEqual({ state: 'unknown', text: "GitHub's checks are for another commit" })
    expect(card.evidence?.diff?.files).toBe(1)
  })
})

test('a changed commit invalidates an earlier merge card; caller labels cannot authorize another task', async () => {
  await withTask(async ({ tasks, task, grant, worktree, git }) => {
    await tasks.ready(grant, task.id, 'Changed the example')
    const ready = tasks.get(task.id)!
    writeFileSync(join(worktree, 'example.txt'), 'newer\n'); git(worktree, 'commit', '-am', 'newer change')
    await expect(tasks.answer(ready.mergeQuestion!, 0, task.chat)).rejects.toThrow('changed after')
    await expect(tasks.merge({ ...grant, chat: 'OTHER/Agent' }, task.id)).rejects.toThrow('does not own')
    await expect(tasks.merge(grant, task.id)).rejects.toThrow('exact commit ready')
  })
})

test('process exit never marks workflow merged', async () => {
  await withTask(async ({ tasks, task, state }) => {
    state.terminal = 'finished'
    expect(tasks.view(task).status).toBe('need')
    expect(tasks.get(task.id)?.workflow).toBe('working')
  })
})


test('a fresh ready card and Not yet both revoke an earlier approval', async () => {
  await withTask(async ({ tasks, task, grant }) => {
    await tasks.ready(grant, task.id, 'Changed example')
    await tasks.answer(tasks.get(task.id)!.mergeQuestion!, 0, task.chat)
    expect(tasks.get(task.id)!.approvedHead).toBeDefined()
    await tasks.ready(grant, task.id, 'Changed example again')
    expect(tasks.get(task.id)!.approvedHead).toBeUndefined()
    await tasks.answer(tasks.get(task.id)!.mergeQuestion!, 1, task.chat)
    await expect(tasks.merge(grant, task.id)).rejects.toThrow('human must approve')
  })
})


test('review-on ready requires a finished report for the exact commit', async () => {
  await withTask(async ({ tasks, task, grant }) => {
    task.review.on = true
    // Persist the setting, as the real settings action does.
    const source = (tasks as unknown as { source: CoreSource }).source
    source.store.set('task', task.id, task)
    await expect(tasks.ready(grant, task.id, 'Changed example')).rejects.toThrow('fresh review')
  })
})

test('only the task\'s coordinator adds one review round once all are used', async () => {
  await withTask(async ({ tasks, task, grant }) => {
    const source = (tasks as unknown as { source: CoreSource }).source
    const original = source.agents.get.bind(source.agents), sent: string[] = []
    const seat = (chat: string, role: string, space = task.place) => ({ chat, role, space, launch: chat, grant: chat, machine: task.machine, kind: 'codex' }) as ReturnType<typeof original>
    const seats = [seat('space', 'coordinator'), seat('other', 'coordinator', 'other-space'), seat(`${task.id}/Reviewer-3`, 'reviewer')]
    source.agents.get = key => seats.find(agent => agent!.chat === key) ?? original(key)
    source.agents.launch = (async () => ({ chat: `${task.id}/Reviewer-4`, terminal: 't4', launch: 'review-4' })) as unknown as typeof source.agents.launch
    source.saveAndDeliver = ((_chat: string, _id: string, text: string, save: () => void) => { sent.push(text); save() }) as typeof source.saveAndDeliver
    const as = (chat: string) => ({ ...grant, id: chat, chat, session: chat }) as Grant
    const more = (who: Grant) => tasks.cli(who, ['task', 'review-more', task.id])
    source.store.set('task', task.id, { ...task, review: { ...task.review, on: true }, reviewRound: 2 })

    await expect(more(as('space'))).rejects.toThrow('used 2 of 3')
    source.store.set('task', task.id, { ...tasks.get(task.id)!, reviewRound: 3 })
    await expect(tasks.review(grant, task.id)).rejects.toThrow('only your coordinator can add a round')
    await expect(tasks.ready(grant, task.id, 'Changed example')).rejects.toThrow('only your coordinator can add a round')
    await expect(more(grant)).rejects.toThrow('Only this task’s coordinator')
    await expect(more(as(`${task.id}/Reviewer-3`))).rejects.toThrow('does not own')
    await expect(more(as('other'))).rejects.toThrow('does not own')
    expect(tasks.get(task.id)).toMatchObject({ review: { rounds: 3 } })

    expect((await more(as('space'))).out).toContain('4 review rounds')
    expect(tasks.get(task.id)).toMatchObject({ review: { rounds: 4 }, reviewRoundsAdded: 1 })
    expect(sent).toEqual([expect.stringContaining('one review round')])
    await expect(more(as('space'))).rejects.toThrow('used 3 of 4')

    await tasks.review(grant, task.id)
    expect(tasks.get(task.id)).toMatchObject({ reviewRound: 4 })
    await expect(tasks.review(grant, task.id)).rejects.toThrow('All 4 review rounds are used')
  })
})

test('review relay waits for a successful native turn end, not idle or commentary', async () => {
  await withTask(async ({ tasks, task }) => {
    const source = (tasks as unknown as { source: CoreSource }).source
    const original = source.agents.get.bind(source.agents)
    const chat = `${task.id}/Reviewer-1`
    source.agents.get = key => key === chat ? { chat, launch: 'review-launch', role: 'reviewer', state: 'idle' } as ReturnType<typeof original> : original(key)
    Object.defineProperty(source, 'logs', { value: { messages: () => [{ id: 'comment', who: 'agent', text: 'I will inspect', at: 100 }, { id: 'final', who: 'agent', text: 'No findings', at: 200 }] } })
    source.store.set('task', task.id, { ...task, reviewChat: chat, reviewHead: 'head', reviewRound: 1 })
    await tasks.tick()
    expect(tasks.get(task.id)?.reviewReport).toBeUndefined()
    source.store.set(`event:${chat}`, 'turn', { kind: 'turn-end', id: 'turn', at: 300, aborted: true })
    await tasks.tick()
    expect(tasks.get(task.id)?.reviewReport).toBeUndefined()
    source.store.set(`event:${chat}`, 'turn', { kind: 'turn-end', id: 'turn', at: 300 })
    await tasks.tick()
    expect(tasks.get(task.id)).toMatchObject({ reviewReport: 'No findings', reviewTurn: 'turn' })
  })
})


test('checks-only policy cannot silently squash a repository without GitHub checks', async () => {
  await withTask(async ({ tasks, task, grant, repo }) => {
    task.mergePolicy = 'checks'
    const source = (tasks as unknown as { source: CoreSource }).source
    source.store.set('task', task.id, task)
    await tasks.ready(grant, task.id, 'Changed example')
    await expect(tasks.merge(grant, task.id)).rejects.toThrow('requires verified GitHub checks')
    expect(tasks.get(task.id)?.workflow).toBe('ready')
    expect(readFileSync(join(repo, 'example.txt'), 'utf8')).toBe('before\n')
  })
})

test('headless review relay waits for a successful core holder exit', async () => {
  await withTask(async ({ tasks, task }) => {
    const source = (tasks as unknown as { source: CoreSource }).source
    const original = source.agents.get.bind(source.agents), chat = `${task.id}/Reviewer-1`
    source.agents.get = key => key === chat ? { chat, launch: 'review-launch', role: 'reviewer', transcriptFormat: 'codex-exec', state: 'idle' } as ReturnType<typeof original> : original(key)
    let state = 'live', code = 0
    source.agents.terminal = (() => ({ address: 't1', state, exit_code: code })) as unknown as typeof source.agents.terminal
    Object.defineProperty(source, 'logs', { value: { messages: () => [{ id: 'final', who: 'agent', text: 'No findings', at: 200 }] } })
    source.store.set('task', task.id, { ...task, reviewChat: chat, reviewHead: 'head', reviewRound: 1 })
    source.store.set(`event:${chat}`, 'turn', { kind: 'turn-end', id: 'turn', at: 300 })
    await tasks.tick()
    expect(tasks.get(task.id)?.reviewReport).toBeUndefined()
    state = 'finished'; code = 1
    await tasks.tick()
    expect(tasks.get(task.id)?.reviewReport).toBeUndefined()
    expect(tasks.get(task.id)?.reviewFailure).toBe('review-launch')
    code = 0
    await tasks.tick()
    expect(tasks.get(task.id)?.reviewReport).toBe('No findings')
  })
})


test('a turn ended for a running recorded review stays Working until the review ends without reaching the agent', async () => {
  await withTask(async ({ tasks, task }) => {
    const source = (tasks as unknown as { source: CoreSource }).source
    const now = Date.now(), chat = `${task.id}/Reviewer-1`, original = source.agents.get.bind(source.agents)
    const reviewer = { chat, launch: 'review-launch', role: 'reviewer', started: now - 60000, activityAt: now - 1000 }
    const reviewerTerminal = { address: 't2', state: 'live' }, parentTerminal = { address: 't1', state: 'live' }
    const parent = { ...original(task.chat)!, started: now - 600000, activityAt: now - 30000 }
    let reviewerStatus = 'work'
    source.agents.get = key => key === chat ? reviewer as ReturnType<typeof original> : key === task.chat ? parent : undefined
    source.agents.terminal = (agent => agent?.chat === chat ? reviewerTerminal : parentTerminal) as typeof source.agents.terminal
    source.status = (agent => agent?.chat === chat ? reviewerStatus : 'idle') as typeof source.status
    let last: Message[] = [{ id: 'said', who: 'agent', text: 'The reviewer is running. Its report comes next.', at: 1 }]
    Object.defineProperty(source, 'logs', { value: { waiting: () => true, messages: () => last } })
    const saved = { ...task, report: { msg: 'Fixing the bug', progress: 80 } } as CoreTask
    const view = (patch: Partial<CoreTask> = {}) => tasks.view({ ...saved, ...patch })

    expect(view({ reviewChat: undefined })).toMatchObject({ status: 'need', state: 'Needs you' })
    saved.reviewChat = chat
    expect(view()).toMatchObject({ status: 'work', state: 'Working', sub: 'Waiting for review', waitsFor: 'review', report: { msg: 'Waiting for review', progress: 80 } })
    expect(view().agent?.note).toBe('Waiting for review')

    const said = last
    for (const text of ['Which option should I use? I’ll wait for your answer.', 'Which one?\n\nI’ll wait here.', 'Use **this one?**']) {
      last = [{ id: 'asks', who: 'agent', text, at: 2 }]
      expect(view().status).toBe('need')
    }
    last = [{ id: 'link', who: 'agent', text: 'See https://example.test/run?id=7 for the run.', at: 2 }]
    expect(view().status).toBe('work')
    last = [{ id: 'asks', who: 'agent', text: 'Which option should I use?', at: 2 }, { id: 'card', who: 'agent', at: 3 }]
    expect(view()).toMatchObject({ status: 'need', state: 'Needs you' })
    last = [...last, { id: 'answer', who: 'you', text: 'The first', at: 4 }]
    expect(view().status).toBe('work')
    last = said

    reviewerStatus = 'need'
    expect(view()).toMatchObject({ status: 'need', state: 'Needs you' })
    expect(view().waitsFor).toBeUndefined()

    reviewerStatus = 'idle' // Ended its turn: the report is on its way for a moment, then the silence surfaces.
    expect(view().status).toBe('work')
    reviewer.activityAt = reviewer.started = now - 3 * 60000
    expect(view().status).toBe('need')

    reviewerStatus = 'work'; reviewerTerminal.state = 'finished' // Died.
    expect(view().status).toBe('need')
    reviewerTerminal.state = 'live' // Quiet, but within what a stall allows.
    expect(view().status).toBe('work')
    reviewer.activityAt = reviewer.started = now - 21 * 60000 // Stalled.
    expect(view().status).toBe('need')
    reviewer.activityAt = reviewer.started = now - 1000

    saved.reviewTurn = 'turn' // Relayed, until the agent has taken it up.
    parent.activityAt = now - 30000
    expect(view().status).toBe('work')
    parent.activityAt = now
    expect(view().status).toBe('need')
    delete saved.reviewTurn; saved.reviewFailure = 'review-launch'
    expect(view().status).toBe('need')
    delete saved.reviewFailure

    expect(view({ workflow: 'ready' })).toMatchObject({ status: 'ready' })
    expect(view({ workflow: 'ready' }).waitsFor).toBeUndefined()
    source.status = (agent => agent?.chat === chat ? 'work' : 'need') as typeof source.status // A prompt still wins.
    expect(view()).toMatchObject({ status: 'need' })
    source.status = (agent => agent?.chat === chat ? 'work' : 'idle') as typeof source.status
    parentTerminal.state = 'finished' // So does an agent that exited.
    expect(view()).toMatchObject({ status: 'need' })
  })
})


test('CLI and screen mutations cannot race a merge already in flight', async () => withTask(async ({ tasks, task, grant, repo }) => {
  await tasks.ready(grant, task.id, 'Changed example')
  await tasks.answer(tasks.get(task.id)!.mergeQuestion!, 0, task.chat)
  const source = (tasks as unknown as { source: CoreSource }).source, exec = source.files.exec.bind(source.files)
  let release!: () => void, entered!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve })
  source.files.exec = async (...args) => {
    if (args[1][0] === 'git' && args[1][1] === 'merge-tree') { entered(); await new Promise<void>(resolve => { release = resolve }) }
    return exec(...args)
  }
  const merge = tasks.merge(grant, task.id)
  await reached
  try {
    const coordinator = { ...grant, chat: task.place, id: 'coord-grant', session: 'coord-launch' }, get = source.agents.get
    source.agents.get = chat => chat === coordinator.chat ? { chat, launch: coordinator.session, grant: coordinator.id, role: 'coordinator', machine: task.machine, space: task.place, kind: 'codex', hook: '/unused', started: 1, state: 'idle' } : get(chat)
    await expect(tasks.cli(coordinator, ['task', 'close', task.id, '--force'])).rejects.toThrow('finishing another action')
    for (const args of [['todo', task.id], ['task', 'queue', task.id, '--after', 'none']]) await expect(tasks.cli(grant, args)).rejects.toThrow('finishing another action')
    await expect(tasks.act({ type: 'delete', chat: task.chat, force: true })).rejects.toThrow('finishing another action')
    await expect(tasks.ready(grant, task.id, 'Another ready')).rejects.toThrow('finishing another action')
    await expect(tasks.report(grant, task.id, 'Late status', 50)).rejects.toThrow('finishing another action')
    expect(readFileSync(join(repo, 'example.txt'), 'utf8')).toBe('before\n')
  } finally { release() }
  await merge
  expect(tasks.get(task.id)?.workflow).toBe('merged')
  expect(readFileSync(join(repo, 'example.txt'), 'utf8')).toBe('after\n')
}))

test('a task closing its held-work check cannot concurrently start a merge', async () => withTask(async ({ tasks, task, grant, repo }) => {
  await tasks.ready(grant, task.id, 'Changed example')
  await tasks.answer(tasks.get(task.id)!.mergeQuestion!, 0, task.chat)
  const source = (tasks as unknown as { source: CoreSource }).source, exec = source.files.exec.bind(source.files)
  let release!: () => void, entered!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve })
  source.files.exec = async (...args) => {
    if (args[1][0] === 'git' && args[1][1] === 'worktree' && args[1][2] === 'list') { entered(); await new Promise<void>(resolve => { release = resolve }) }
    return exec(...args)
  }
  const close = tasks.close(tasks.get(task.id)!)
  await reached
  try { await expect(tasks.merge(grant, task.id)).rejects.toThrow('finishing another action') }
  finally { release() }
  expect(await close).toMatchObject({ ok: false, held: ['unmerged commits'] })
  expect(readFileSync(join(repo, 'example.txt'), 'utf8')).toBe('before\n')
  await tasks.merge(grant, task.id)
  expect(tasks.get(task.id)?.workflow).toBe('merged')
}))

test('an unchanged squash-merged branch cleans up without force; a new commit remains protected', async () => {
  await withTask(async ({ tasks, task, grant, repo }) => {
    await tasks.ready(grant, task.id, 'Changed example')
    await tasks.answer(tasks.get(task.id)!.mergeQuestion!, 0, task.chat); await tasks.merge(grant, task.id)
    expect(await tasks.close(tasks.get(task.id)!)).toMatchObject({ ok: true })
    expect(tasks.get(task.id)?.workflow).toBe('merged')
    expect(await tasks.remove(tasks.get(task.id)!)).toMatchObject({ ok: true })
    expect(tasks.get(task.id)).toBeUndefined()
    expect(readFileSync(join(repo, 'example.txt'), 'utf8')).toBe('after\n')
  })
  await withTask(async ({ tasks, task, grant, worktree, git }) => {
    await tasks.ready(grant, task.id, 'Changed example')
    await tasks.answer(tasks.get(task.id)!.mergeQuestion!, 0, task.chat); await tasks.merge(grant, task.id)
    writeFileSync(join(worktree, 'later.txt'), 'KEEP_THIS_WORK\n'); git(worktree, 'add', '.'); git(worktree, 'commit', '-m', 'later work')
    expect(await tasks.remove(tasks.get(task.id)!)).toMatchObject({ ok: false, held: ['unmerged commits'] })
    expect(tasks.get(task.id)).toBeDefined()
    expect(readFileSync(join(worktree, 'later.txt'), 'utf8')).toBe('KEEP_THIS_WORK\n')
  })
})

test('queue edits reject missing/self dependencies and ended tasks without corrupting saved workflow', async () => {
  await withTask(async ({ tasks, task, grant }) => {
    for (const ref of ['MISSING-2', task.id]) {
      await expect(tasks.cli(grant, ['task', 'queue', task.id, '--after', ref])).rejects.toThrow()
      expect(tasks.get(task.id)?.workflow).toBe('working')
      expect(tasks.get(task.id)?.after).toBeUndefined()
    }
    await expect(tasks.cli(grant, ['task', 'queue', task.id])).rejects.toThrow('--after')
    await tasks.close(task, true)
    await expect(tasks.cli(grant, ['task', 'queue', task.id, '--after', 'none'])).rejects.toThrow('already closed')
    expect(tasks.get(task.id)?.workflow).toBe('closed')
  })
})

test('an archived queued task never starts in the queue scheduler', async () => {
  await withTask(async ({ tasks, task }) => {
    // Do not need a mocked launcher: starting this record would reach absent launch fixtures and fail to todo.
    const store = (tasks as unknown as { source: CoreSource }).source.store
    store.set('task', task.id, { ...task, workflow: 'queued', after: [], archived: Date.now() })
    await tasks.tick()
    expect(tasks.get(task.id)?.workflow).toBe('queued')
    expect(tasks.get(task.id)?.startError).toBeUndefined()
  })
})

test('a queued task stays in its queue when its agent says todo', async () => {
  await withTask(async ({ tasks, task, grant }) => {
    const store = (tasks as unknown as { source: CoreSource }).source.store
    store.set('task', task.id, { ...task, workflow: 'queued', after: ['EX-9'] })
    await expect(tasks.cli(grant, ['todo', task.id])).rejects.toThrow('wait for it')
    expect(tasks.get(task.id)).toMatchObject({ workflow: 'queued', after: ['EX-9'] })
  })
})

test('task show reports current workflow instead of its initial cached Working text', async () => {
  await withTask(async ({ tasks, task, grant }) => {
    await tasks.cli(grant, ['todo', task.id])
    const shown = JSON.parse((await tasks.cli(grant, ['task', 'show', task.id])).out)
    expect(shown).toMatchObject({ workflow: 'todo', status: 'todo', state: 'To do' })
  })
})

test('Done auto-archive respects native work, scoped off and unarchive delay without touching files', async () => {
  await withTask(async ({ tasks, task, grant, worktree }) => {
    const source = (tasks as unknown as { source: CoreSource }).source
    const now = Date.now(), day = 86_400_000
    let interval = '7 days', phase = 'working'
    Object.assign(source, { space: () => ({ id: task.place }), settings: { get: () => interval } })
    Object.assign(source.agents, { all: () => [{ ...source.agents.get(task.chat)!, state: phase }] })
    source.store.set('task', task.id, { ...task, workflow: 'closed', doneAt: now - 8 * day, pinned: now - 8 * day })
    expect(tasks.autoArchive(now)).toBe(0) // A live conversation must not vanish.
    phase = 'idle'; interval = 'off'
    expect(tasks.autoArchive(now)).toBe(0)
    interval = '7 days'
    expect(tasks.autoArchive(now)).toBe(1)
    expect(tasks.get(task.id)).toMatchObject({ archived: now })
    expect(tasks.get(task.id)?.pinned).toBeUndefined()
    expect(readFileSync(join(worktree, 'example.txt'), 'utf8')).toBe('after\n')
    await tasks.act({ type: 'archive', chat: task.chat, on: false })
    expect(tasks.get(task.id)?.unarchived).toBeGreaterThanOrEqual(now)
    expect(tasks.autoArchive(now + day)).toBe(0)
    expect(tasks.autoArchive(now + 8 * day)).toBe(1)
    await expect(tasks.cli(grant, ['task', 'show', task.id])).resolves.toHaveProperty('out')
  })
})

test('task controls require a coordinator and lists separate archived tasks in its own machine and space', async () => {
  await withTask(async ({ tasks, task, grant }) => {
    const source = (tasks as unknown as { source: CoreSource }).source
    for (const command of ['pin', 'unpin', 'pause', 'archive', 'unarchive', 'delete', 'close']) {
      await expect(tasks.cli(grant, ['task', command, task.id])).rejects.toThrow('Only a coordinator')
    }
    source.agents.get = (() => ({ chat: grant.chat, launch: grant.session, grant: grant.id, role: 'coordinator', machine: task.machine, space: task.place, kind: 'codex', hook: '/unused', started: 1, state: 'idle' })) as typeof source.agents.get
    source.store.set('task', 'OTHER-1', { ...task, id: 'OTHER-1', machine: 'other' })
    source.store.set('task', 'OTHER-2', { ...task, id: 'OTHER-2', place: 'other' })
    expect(tasks.list(grant).map(t => t.id)).toEqual([task.id])
    await tasks.cli(grant, ['task', 'pin', task.id]); expect(tasks.get(task.id)?.pinned).toBeNumber()
    await tasks.cli(grant, ['task', 'archive', task.id])
    expect(tasks.get(task.id)?.pinned).toBeUndefined()
    expect(tasks.list(grant)).toEqual([])
    expect(tasks.list(grant, true).map(t => t.id)).toEqual([task.id])
    await tasks.cli(grant, ['task', 'unarchive', task.id]); expect(tasks.list(grant).map(t => t.id)).toEqual([task.id])
    await tasks.cli(grant, ['task', 'pause', task.id]); expect(tasks.get(task.id)?.workflow).toBe('todo')
    await tasks.cli(grant, ['task', 'unpin', task.id]); expect(tasks.get(task.id)?.pinned).toBeUndefined()
  })
})

test('close removes a clean fully-contained worktree and branch but keeps its summary and chat record', async () => {
  await withTask(async ({ tasks, task, worktree, git, repo }) => {
    git(worktree, 'reset', '--hard', 'main')
    expect(await tasks.close(task, false, 'Nothing to merge', 'Checked the original file')).toMatchObject({ ok: true, kept: [] })
    expect(tasks.get(task.id)).toMatchObject({ workflow: 'closed', said: 'Nothing to merge', facts: 'Checked the original file' })
    expect(Bun.spawnSync(['git', 'show-ref', '--verify', `refs/heads/${task.branch}`], { cwd: repo }).exitCode).not.toBe(0)
    expect(existsSync(worktree)).toBe(false)
  })
})

test('confirmed close preserves held commits and uncommitted work even with force', async () => {
  await withTask(async ({ tasks, task, worktree }) => {
    writeFileSync(join(worktree, 'unfinished.txt'), 'KEEP_UNFINISHED')
    expect(await tasks.close(task)).toMatchObject({ ok: false, held: ['uncommitted changes', 'unmerged commits'] })
    expect(tasks.get(task.id)?.workflow).toBe('working')
    expect(await tasks.close(task, true)).toMatchObject({ ok: true, kept: ['uncommitted changes', 'unmerged commits'] })
    expect(readFileSync(join(worktree, 'unfinished.txt'), 'utf8')).toBe('KEEP_UNFINISHED')
    expect(tasks.get(task.id)?.workflow).toBe('closed')
  })
})

test('close rechecks work written during shutdown and performs browser cleanup once with final intent', async () => {
  await withTask(async ({ tasks, task, worktree, git }) => {
    git(worktree, 'reset', '--hard', 'main')
    const source = (tasks as unknown as { source: CoreSource }).source
    let calls = 0
    source.browsers.close = async (_id: string, forget?: boolean) => {
      calls++; expect(forget).toBe(true)
      writeFileSync(join(worktree, 'late.txt'), 'KEEP_LATE_WRITE')
    }
    expect(await tasks.close(task)).toMatchObject({ ok: false, stopped: true, held: ['uncommitted changes'] })
    expect(calls).toBe(1)
    expect(tasks.get(task.id)?.workflow).toBe('working')
    expect(readFileSync(join(worktree, 'late.txt'), 'utf8')).toBe('KEEP_LATE_WRITE')
  })
})

test('GitHub follow-up work clears stale ready approval while an internal checks-ready nudge preserves it', async () => {
  for (const internal of [false, true]) await withTask(async ({ tasks, task, grant }) => {
    await tasks.ready(grant, task.id, 'Changed example')
    await tasks.answer(tasks.get(task.id)!.mergeQuestion!, 0, task.chat)
    await tasks.deliver(task.id, task.chat, '<github>Observed follow-up</github>', internal)
    expect(tasks.get(task.id)?.workflow).toBe(internal ? 'ready' : 'working')
    expect(!!tasks.get(task.id)?.approvedHead).toBe(internal)
  })
})

test('authenticated comment drill-down preserves full bodies and returns one bounded comment at a time', async () => {
  await withTask(async ({ tasks, task, grant }) => {
    const source = (tasks as unknown as { source: CoreSource }).source, body = '😀☃\\\"\n'.repeat(12000)
    source.github.prs.comments = async () => [{ id: 'i1', at: 1, who: 'reviewer', body, url: 'https://github.test/1' }, { id: 'i2', at: 2, who: 'reviewer', body: 'Second', url: 'https://github.test/2' }]
    const credential: MailCredential = { version: 1, grant: 'grant', server: 'server', machine: task.machine, key: Buffer.alloc(32, 7).toString('base64') }
    let from = 0, complete = '', last: { next?: number } = {}, pages = 0
    do {
      const response = await tasks.cli(grant, ['checks', task.id, '--comments', '--from', String(from)])
      const envelope = seal(credential, `comment-${pages}`, 'response', response)
      const decoded = unseal(credential, `comment-${pages}`, 'response', envelope) as { out: string }
      const page = JSON.parse(decoded.out)
      expect(page.comments).toHaveLength(1)
      expect(page.comments[0].body).not.toContain('�')
      complete += page.comments[0].body; last = page; pages++
      if (page.nextFrom === undefined) break
      expect(page.nextFrom).toBeGreaterThan(from); from = page.nextFrom
    } while (pages < 100)
    expect(pages).toBeGreaterThan(1); expect(complete).toBe(body); expect(last.next).toBe(1)
    const second = JSON.parse((await tasks.cli(grant, ['checks', task.id, '--comments', '--offset', '1'])).out)
    expect(second.comments[0].id).toBe('i2'); expect(second.next).toBeUndefined()
    await expect(tasks.cli(grant, ['checks', task.id, '--comments', '--offset', '-1'])).rejects.toThrow('offset')
    await expect(tasks.cli({ ...grant, chat: 'another' }, ['checks', task.id, '--comments'])).rejects.toThrow('no longer current')
  })
})

function finishableTask(tasks: CoreTasks, state: { terminal: string }, killed: () => void = () => {}) {
  const source = (tasks as unknown as { source: CoreSource }).source
  const task = tasks.all()[0]!, agent = source.agents.get(task.chat)!
  const terminal = { address: 't1', pid: 1, created_ms: 1, get state() { return state.terminal }, labels: {} } as import('../server/core/protocol.ts').CoreTerminal
  source.machineConnected = () => true
  Object.assign(source, { mailbox: { revoke() {} }, logs: { cleanupComplete: () => true } })
  source.denyPermissions = () => {}
  source.agents.all = () => [agent]; source.agents.terminal = () => terminal
  ;(source.core.current.terminals as Map<string, typeof terminal>).set('t1', terminal)
  source.core.call = async <T>(method: string) => { if (method === 'terminal.kill') { killed(); state.terminal = 'finished' }; return {} as T }
  return source
}

test('a clean research answer becomes Done without a code review and waits for native idle before cleanup', async () => {
  await withTask(async ({ tasks, task, grant, repo, worktree, git, state }) => {
    git(worktree, 'reset', '--hard', 'main')
    const source = (tasks as unknown as { source: CoreSource }).source
    task.review.on = true; source.store.set('task', task.id, task)
    let status = 'work', stopped = 0
    source.status = () => status as ReturnType<CoreSource['status']>
    finishableTask(tasks, state, () => { stopped++ })
    const answer = await tasks.cli(grant, ['ready', task.id, '--summary', 'Research answer completed', '--facts', 'No code changes'])
    expect(answer.out).toContain('Done; nothing to merge')
    expect(tasks.get(task.id)).toMatchObject({ workflow: 'closed', said: 'Research answer completed', facts: 'No code changes', cleanupPending: true })
    expect(tasks.get(task.id)?.mergeQuestion).toBeUndefined()
    await tasks.tick(); expect(stopped).toBe(0); expect(existsSync(worktree)).toBe(true)
    status = 'idle'
    await tasks.tick()
    expect(stopped).toBe(1); expect(existsSync(worktree)).toBe(false)
    expect(await tasks.git.branchHead({ machine: task.machine, folder: repo }, task.branch)).toBeUndefined()
    expect(tasks.get(task.id)?.cleanupPending).toBeUndefined()
    await expect(tasks.cli(grant, ['todo', task.id])).rejects.toThrow('Done')
    await expect(tasks.act({ type: 'pause', chat: task.chat })).rejects.toThrow('Done')
    await expect(tasks.deliver(task.id, task.chat, 'Start again')).rejects.toThrow('Done')
    await expect(tasks.act({ type: 'restart', chat: task.chat })).rejects.toThrow('Done')
  })
})

test('finished cleanup preserves a late native write and reports retained work', async () => {
  await withTask(async ({ tasks, task, grant, worktree, git, state }) => {
    git(worktree, 'reset', '--hard', 'main')
    const source = (tasks as unknown as { source: CoreSource }).source
    await tasks.ready(grant, task.id, 'Answer completed')
    finishableTask(tasks, state, () => { writeFileSync(join(worktree, 'late.txt'), 'Retain this\n') })
    await tasks.tick()
    expect(readFileSync(join(worktree, 'late.txt'), 'utf8')).toBe('Retain this\n')
    expect(tasks.get(task.id)).toMatchObject({ workflow: 'closed', kept: ['uncommitted changes'] })
    expect(tasks.get(task.id)?.cleanupPending).toBeUndefined()
    expect(source.store.all<Message>(`message:${task.chat}`).some(message => message.text?.includes('Kept its work'))).toBe(true)
  })
})

test('a branch-read error is not treated as an absent branch during finished cleanup', async () => {
  await withTask(async ({ tasks, task, grant, worktree, git, state }) => {
    git(worktree, 'reset', '--hard', 'main')
    const source = (tasks as unknown as { source: CoreSource }).source
    await tasks.ready(grant, task.id, 'Answer completed')
    finishableTask(tasks, state)
    const original = tasks.git.branchHead.bind(tasks.git)
    tasks.git.branchHead = async () => { throw Error('Core disconnected while reading refs') }
    await tasks.tick()
    expect(existsSync(worktree)).toBe(true)
    expect(tasks.get(task.id)).toMatchObject({ workflow: 'closed', cleanupPending: true, cleanupError: expect.stringContaining('disconnected') })
    tasks.git.branchHead = original
    source.store.set('task', task.id, { ...tasks.get(task.id)!, cleanupChecked: 0 })
    await tasks.tick(); expect(existsSync(worktree)).toBe(false)
    expect(tasks.get(task.id)?.cleanupPending).toBeUndefined()
  })
})

test('automatic finished cleanup retains a checkout used by an unrelated core terminal', async () => {
  await withTask(async ({ tasks, task, grant, worktree, git, state }) => {
    git(worktree, 'reset', '--hard', 'main')
    await tasks.ready(grant, task.id, 'Answer completed')
    const source = finishableTask(tasks, state)
    const other = { address: 't9', state: 'live', cwd: worktree + '/subfolder', pid: 99, created_ms: 99, labels: {} } as import('../server/core/protocol.ts').CoreTerminal
    ;(source.core.current.terminals as Map<string, typeof other>).set('t9', other)
    await tasks.tick()
    expect(existsSync(worktree)).toBe(true)
    expect(other.state).toBe('live')
    expect(tasks.get(task.id)).toMatchObject({ cleanupPending: true, cleanupError: expect.stringContaining('Another core terminal') })
    other.state = 'finished'
    source.store.set('task', task.id, { ...tasks.get(task.id)!, cleanupChecked: 0 })
    await tasks.tick(); expect(existsSync(worktree)).toBe(false)
  })
})

test('deferred cleanup removes an exact squashed task branch while preserving its merge on main', async () => {
  await withTask(async ({ tasks, task, grant, repo, worktree, state }) => {
    await tasks.ready(grant, task.id, 'Changed example')
    await tasks.answer(tasks.get(task.id)!.mergeQuestion!, 0, task.chat)
    const merged = await tasks.merge(grant, task.id)
    expect(merged.cleanupPending).toBe(true)
    finishableTask(tasks, state)
    await tasks.tick()
    expect(existsSync(worktree)).toBe(false)
    expect(await tasks.git.branchHead({ machine: task.machine, folder: repo }, task.branch)).toBeUndefined()
    expect(await tasks.git.contains({ machine: task.machine, folder: repo }, 'main', merged.mergeCommit!)).toBe(true)
    expect(readFileSync(join(repo, 'example.txt'), 'utf8')).toBe('after\n')
  })
})

test('deferred cleanup retains commits made after the recorded squash head', async () => {
  await withTask(async ({ tasks, task, grant, worktree, git, state }) => {
    await tasks.ready(grant, task.id, 'Changed example')
    await tasks.answer(tasks.get(task.id)!.mergeQuestion!, 0, task.chat)
    await tasks.merge(grant, task.id)
    writeFileSync(join(worktree, 'later.txt'), 'Keep later commit\n'); git(worktree, 'add', '.'); git(worktree, 'commit', '-m', 'later work')
    finishableTask(tasks, state)
    await tasks.tick()
    expect(readFileSync(join(worktree, 'later.txt'), 'utf8')).toBe('Keep later commit\n')
    expect(tasks.get(task.id)).toMatchObject({ workflow: 'merged', kept: ['unmerged commits'] })
    expect(tasks.get(task.id)?.cleanupPending).toBeUndefined()
  })
})

for (const empty of ['none', 'nothing', '-', ' NONE ']) test(`queue clearing accepts ${JSON.stringify(empty)} without changing an active workflow`, () => withTask(async ({ tasks, task, grant }) => {
  task.after = ['OLD-1']
  const result = await tasks.cli(grant, ['task', 'queue', task.id, '--after', empty])
  expect(result.out).toContain('No dependencies remain')
  expect(tasks.get(task.id)).toMatchObject({ after: [], workflow: 'working' })
}))

test('task view separates explicit native waiting from process idle and retains workflow precedence', () => withTask(async ({ tasks, task }) => {
  const source = (tasks as unknown as { source: CoreSource }).source
  let waiting = false
  Object.defineProperty(source, 'logs', { value: { waiting: () => waiting } })
  expect(tasks.view(task).status).toBe('work')
  waiting = true
  expect(tasks.view(task)).toMatchObject({ status: 'need', state: 'Needs you' })
  source.status = () => 'work'
  expect(tasks.view(task).status).toBe('work')
  source.status = () => 'idle'
  expect(tasks.view({ ...task, workflow: 'todo' }).status).toBe('todo')
  expect(tasks.view({ ...task, workflow: 'ready' }).status).toBe('ready')
  expect(tasks.view({ ...task, workflow: 'closed' }).status).toBe('done')
}))

test('failed creation returns its saved task ID and never hides the surviving record behind a raw start error', async () => {
  const { CoreSource } = await import('../server/core/source.ts')
  const home = mkdtempSync(join(tmpdir(), 'shep-task-start-error-')), source = new CoreSource({ home, socket: '/unused', binary: 'hc', session: 'test', port: 0 })
  try {
    const space = { id: 'space', name: 'project', machine: source.localMachineId(), folder: '/isolated/repo', base: 'main', prefix: 'APP', mode: 'regular' as const, added: 1 }
    source.store.set('space', space.id, space)
    source.files.exec = async () => Buffer.alloc(0)
    source.agents.worktreeRoot = async () => '/isolated/worktrees'
    source.tasks.git.addWorktree = async () => { throw Error('Missing requested base') }
    await expect(source.tasks.addInSpace(space, { title: 'Failure proof', brief: 'Full brief', base: 'missing' })).rejects.toThrow('APP-1 was saved but could not start: Missing requested base')
    expect(source.tasks.all()).toHaveLength(1)
    expect(source.tasks.get('APP-1')).toMatchObject({ workflow: 'todo', startError: 'Missing requested base' })
    expect(source.agents.get('APP-1/Agent')).toBeUndefined()
  } finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
})

test('Stop removes a clean landed checkout and branch; reopening recreates them without deleting chat', () => withTask(async ({ tasks, task, grant, repo, worktree, git }) => {
  git(worktree, 'reset', '--hard', 'main')
  const source = (tasks as unknown as { source: CoreSource }).source
  source.store.set(`message:${task.chat}`, 'retained', { id: 'retained', who: 'agent', text: 'Retained proof' })
  await tasks.stop(grant, task.id)
  expect(tasks.get(task.id)).toMatchObject({ workflow: 'todo', kept: [] })
  expect(existsSync(worktree)).toBe(false)
  expect(await tasks.git.branchHead({ machine: task.machine, folder: repo }, task.branch)).toBeUndefined()
  expect(source.store.get(`message:${task.chat}`, 'retained')).toBeDefined()
  await tasks.git.ensureWorktree({ machine: task.machine, folder: repo }, worktree, task.branch, task.base)
  expect(readFileSync(join(worktree, 'example.txt'), 'utf8')).toBe('before\n')
}))

test('Stop preserves uncommitted bytes and unmerged commits for a later restart', () => withTask(async ({ tasks, task, grant, repo, worktree }) => {
  writeFileSync(join(worktree, 'unfinished.txt'), 'UNFINISHED_BYTES\n')
  const old = await tasks.git.head({ machine: task.machine, folder: worktree })
  await tasks.stop(grant, task.id)
  expect(tasks.get(task.id)).toMatchObject({ workflow: 'todo', kept: ['uncommitted changes', 'unmerged commits'] })
  expect(readFileSync(join(worktree, 'unfinished.txt'), 'utf8')).toBe('UNFINISHED_BYTES\n')
  await tasks.git.ensureWorktree({ machine: task.machine, folder: repo }, worktree, task.branch, task.base)
  expect(await tasks.git.head({ machine: task.machine, folder: worktree })).toBe(old)
}))

for (const verb of ['close', 'delete']) test(`CLI ${verb} returns failure when held work prevents completion`, () => withTask(async ({ tasks, task, grant, worktree }) => {
  const source = (tasks as unknown as { source: CoreSource }).source
  const get = source.agents.get, coordinator = { ...grant, chat: task.place, id: 'coord-grant', session: 'coord-launch' }
  source.agents.get = chat => chat === coordinator.chat ? { chat, launch: coordinator.session, grant: coordinator.id, role: 'coordinator', machine: task.machine, space: task.place, kind: 'codex', hook: '/unused', started: 1, state: 'idle' } : get(chat)
  writeFileSync(join(worktree, 'held.txt'), 'HELD_BYTES\n')
  const result = await tasks.cli(coordinator, ['task', verb, task.id])
  expect(result.code).toBe(1)
  expect(JSON.parse(result.out)).toMatchObject({ ok: false, held: ['uncommitted changes', 'unmerged commits'] })
  expect(tasks.get(task.id)).toBeDefined()
  expect(readFileSync(join(worktree, 'held.txt'), 'utf8')).toBe('HELD_BYTES\n')
}))

test('Ready promotes only its confirmed exact-head draft PR and records the final body before the ready card', () => withTask(async ({ tasks, task, grant }) => {
  const head = await tasks.git.head({ machine: task.machine, folder: task.folder }), calls: { args: string[]; input?: string }[] = []
  task.pr = { number: 7, url: 'https://github.test/o/r/pull/7' }
  const source = (tasks as unknown as { source: CoreSource }).source
  source.store.set('task', task.id, task)
  tasks.git.remote = async () => 'github.test/o/r'
  tasks.git.pullRequest = async (_repo, _branch, checks) => { expect(checks).toBe(false); return { number: 7, url: task.pr!.url, state: 'OPEN', isDraft: true, headRefOid: head, baseRefName: task.base, statusCheckRollup: [] } }
  tasks.git.ghRun = async (_repo, args, _timeout, input) => { calls.push({ args, input }); expect(tasks.get(task.id)?.workflow).toBe('working'); return '' }
  await tasks.ready(grant, task.id, 'Changed the sample', 'Only example.txt')
  expect(calls.map(c => c.args.slice(0, 3))).toEqual([['pr', 'edit', '7'], ['pr', 'ready', '7']])
  expect(calls[0].input).toBe('Changed the sample\n\nFacts: Only example.txt')
  expect(tasks.get(task.id)?.workflow).toBe('ready')
}))

test('a PR lookup failure never creates another PR or reports Ready', () => withTask(async ({ tasks, task, grant }) => {
  const calls: string[][] = [], run = tasks.git.run.bind(tasks.git)
  tasks.git.remote = async () => 'github.test/o/r'
  tasks.git.run = async (repo, args, ...rest) => { if (args[0] === 'push') return ''; return run(repo, args, ...rest) }
  tasks.git.findPullRequest = async () => { throw Error('GitHub identity unavailable') }
  tasks.git.ghRun = async (_repo, args) => { calls.push(args); return '' }
  await expect(tasks.pr(grant, task.id)).rejects.toThrow('GitHub identity unavailable')
  expect(calls).toEqual([])
  expect(tasks.get(task.id)?.pr).toBeUndefined()
  expect(tasks.get(task.id)?.workflow).toBe('working')
}))

test('observed GitHub merge requires the saved PR URL, exact Ready head and base before recording Done', () => withTask(async ({ tasks, task }) => {
  const source = (tasks as unknown as { source: CoreSource }).source
  const head = await tasks.git.head({ machine: task.machine, folder: task.folder })
  task.workflow = 'ready'; task.readyHead = head; task.pr = { number: 7, url: 'https://github.test/o/r/pull/7' }
  source.store.set('task', task.id, task)
  const pr = { ...task.pr, state: 'MERGED', headRefOid: head, baseRefName: task.base, mergeCommit: { oid: head } }
  for (const wrong of [{ ...pr, url: 'https://github.test/other/repo/pull/7' }, { ...pr, headRefOid: 'b'.repeat(40) }, { ...pr, baseRefName: 'other' }, { ...pr, state: 'OPEN' }]) expect(await tasks.observedMerge(task.id, wrong)).toBe(false)
  expect(tasks.get(task.id)?.workflow).toBe('ready')
  expect(await tasks.observedMerge(task.id, pr)).toBe(true)
  expect(tasks.get(task.id)).toMatchObject({ workflow: 'merged', mergeCommit: head, externalMerge: true, baseSyncPending: true, cleanupPending: true })
  expect(await tasks.observedMerge(task.id, pr)).toBe(false)
}))

test('a stray file in the base checkout leaves a merge alone, and a file the merge would overwrite stops it by name', () => withTask(async ({ tasks, task, grant, repo }) => {
  await tasks.ready(grant, task.id, 'Changed the example')
  await tasks.answer(tasks.get(task.id)!.mergeQuestion!, 0, task.chat)
  writeFileSync(join(repo, 'stray.txt'), 'STRAY_BYTES\n')
  writeFileSync(join(repo, 'example.txt'), 'HUMAN_EDIT\n')
  await expect(tasks.merge(grant, task.id)).rejects.toThrow("own copy of example.txt would be overwritten")
  expect(readFileSync(join(repo, 'example.txt'), 'utf8')).toBe('HUMAN_EDIT\n')
  expect(tasks.get(task.id)?.workflow).toBe('ready')
  writeFileSync(join(repo, 'example.txt'), 'before\n')
  await tasks.merge(grant, task.id)
  expect(tasks.get(task.id)?.workflow).toBe('merged')
  expect(readFileSync(join(repo, 'example.txt'), 'utf8')).toBe('after\n')
  expect(readFileSync(join(repo, 'stray.txt'), 'utf8')).toBe('STRAY_BYTES\n')
}))

test('a file the base checkout ignores is still protected from a merge that adds it', () => withTask(async ({ tasks, task, grant, repo, worktree, git }) => {
  writeFileSync(join(repo, '.git', 'info', 'exclude'), 'local.env\n')
  writeFileSync(join(worktree, 'local.env'), 'TASK\n'); git(worktree, 'add', '-f', 'local.env'); git(worktree, 'commit', '-m', 'add')
  writeFileSync(join(repo, 'local.env'), 'HUMAN\n')
  await tasks.ready(grant, task.id, 'Added a file')
  await tasks.answer(tasks.get(task.id)!.mergeQuestion!, 0, task.chat)
  await expect(tasks.merge(grant, task.id)).rejects.toThrow('own copy of local.env would be overwritten')
  expect(readFileSync(join(repo, 'local.env'), 'utf8')).toBe('HUMAN\n')
}))

test('confirmed GitHub base sync preserves dirty work and then fast-forwards only the confirmed remote base', () => withTask(async ({ tasks, task, repo, worktree, git }) => {
  const source = (tasks as unknown as { source: CoreSource }).source, remote = join(repo, '..', 'remote.git')
  git(repo, 'init', '--bare', remote); git(repo, 'remote', 'add', 'origin', remote)
  git(worktree, 'push', 'origin', 'HEAD:refs/heads/main')
  task.workflow = 'merged'; task.baseSyncPending = true; task.cleanupPending = true; task.mergeCommit = await tasks.git.head({ machine: task.machine, folder: worktree })
  source.store.set('task', task.id, task)
  writeFileSync(join(repo, 'stray.txt'), 'STRAY_BYTES\n'); writeFileSync(join(repo, 'example.txt'), 'BASE_BYTES\n')
  await tasks.syncBase(task.id)
  expect(tasks.get(task.id)).toMatchObject({ baseSyncPending: true })
  expect(tasks.get(task.id)?.baseSyncError).toContain('own copy of example.txt would be overwritten')
  await tasks.tick()
  expect(tasks.get(task.id)?.cleanupPending).toBe(true)
  expect(readFileSync(join(repo, 'example.txt'), 'utf8')).toBe('BASE_BYTES\n')
  writeFileSync(join(repo, 'example.txt'), 'before\n')
  await tasks.syncBase(task.id)
  expect(tasks.get(task.id)?.baseSyncPending).toBeUndefined()
  expect(tasks.get(task.id)?.baseSyncError).toBeUndefined()
  expect(readFileSync(join(repo, 'example.txt'), 'utf8')).toBe('after\n')
  expect(readFileSync(join(repo, 'stray.txt'), 'utf8')).toBe('STRAY_BYTES\n')
}))

test('task pushes accept its own rebase with a lease but preserve someone else’s remote update', () => withTask(async ({ tasks, task, repo, worktree, git }) => {
  const remote = join(repo, '..', 'remote.git'), location = { machine: task.machine, folder: worktree }
  git(repo, 'init', '--bare', remote); git(repo, 'remote', 'add', 'origin', remote)
  const first = await tasks.git.pushTaskBranch(location, task.branch)
  writeFileSync(join(repo, 'base-added.txt'), 'BASE_ADDITION\n'); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'advance base')
  git(worktree, 'rebase', 'main')
  const second = await tasks.git.pushTaskBranch(location, task.branch, first)
  expect(second).not.toBe(first)
  const foreign = await tasks.git.head({ machine: task.machine, folder: repo })
  git(repo, '--git-dir=' + remote, 'update-ref', `refs/heads/${task.branch}`, foreign, second)
  writeFileSync(join(worktree, 'example.txt'), 'next\n'); git(worktree, 'commit', '-am', 'next task change')
  await expect(tasks.git.pushTaskBranch(location, task.branch, second)).rejects.toThrow()
  expect(await tasks.git.run(location, ['ls-remote', '--heads', 'origin', `refs/heads/${task.branch}`])).toBe(`${foreign}\trefs/heads/${task.branch}`)
}))


test('task ages use saved creation, status, completion and archive times without mutating workflow', () => withTask(async ({ tasks, task }) => {
  const now = Date.now(), source = (tasks as unknown as { source: CoreSource }).source
  task.created = new Date(now - 2 * 3600000).toISOString()
  task.updatedAt = now - 45 * 60000
  task.reportedAt = now - 10 * 60000
  source.store.set('automation-seen', task.id, { status: 'work', at: now - 5 * 60000 })
  const original = JSON.stringify(task)
  expect(tasks.view(task).age).toBe('5m')
  expect(tasks.view({ ...task, workflow: 'todo' }).age).toBe('2h')
  expect(tasks.view({ ...task, workflow: 'closed', doneAt: now - 30 * 60000 }).age).toBe('30m')
  expect(tasks.view({ ...task, workflow: 'closed', doneAt: now - 30 * 60000, archived: now - 3 * 86400000 }).age).toBe('3d')
  expect(JSON.stringify(task)).toBe(original)
}))


test('public task CLI names retain familiar labels while internal launch kinds stay unchanged', () => withTask(async ({ tasks, task }) => {
  expect(tasks.view(task)).toMatchObject({ on: 'Codex', agent: { cli: 'Codex' } })
  expect(task.kind).toBe('codex')
}))
