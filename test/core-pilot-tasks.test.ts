import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreSource } from '../server/core/source.ts'
import { CorePilotRepositories } from '../server/core/pilot-repositories.ts'
import type { Grant } from '../server/core/mailbox.ts'
import type { CoreAgent, CoreSpace } from '../server/core/model.ts'
import { runChild } from './child.ts'

// Real Git and checked helper on GitHub; native provider launch is a recorded core boundary, not acceptance proof.
test('managed workers and fresh reviewers inherit the private run and checked worktree boundary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-tasks-')), repo = join(root, 'repo')
  const source = new CoreSource({ home: join(root, 'app'), socket: '/unused', session: 'isolated', binary: 'hc', port: 0 })
  const machine = source.localMachineId(), space: CoreSpace = { id: `p:${machine}:example`, name: 'example', machine, folder: repo, base: 'main', prefix: 'EX', mode: 'regular', added: 1 }
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'proof@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'proof@example.invalid' }
  const execute = (argv: string[], cwd?: string, input?: Uint8Array) => { const p = Bun.spawnSync(argv, { cwd, env, stdin: input ?? 'ignore' }); if (p.exitCode) throw Error(p.stderr.toString()); return p.stdout }
  const starts: { role?: string; readOnly?: boolean; pilot?: { run: string; hosts: string[]; deadline?: number; repo: string }; folder?: string; kind: string; parent?: CoreAgent }[] = []
  try {
    execute(['git', 'init', '-b', 'main', repo]); execute(['git', 'config', 'user.name', 'Fixture'], repo); execute(['git', 'config', 'user.email', 'proof@example.invalid'], repo); writeFileSync(join(repo, 'base.txt'), 'before\n'); execute(['git', 'add', '.'], repo); execute(['git', 'commit', '-m', 'Base'], repo)
    source.store.set('space', space.id, space); source.core.current.connected = true
    source.store.set('health-sample', machine, { at: Date.now(), cores: 8, load: 0, memTotal: 1000, memUsed: 100, disks: [], gpus: [] })
    source.files.exec = async (_machine, argv, cwd, input) => runChild(argv, { cwd, env, input })
    source.core.call = async <T>(method: string) => { if (method !== 'terminal.label') throw Error(method); return {} as T }
    source.agents.pilotWorktreeRoot = async () => join(root, 'pilot-worktrees')
    source.agents.browserRuntime = async () => ({ root: join(import.meta.dir, '..'), bun: process.execPath, bin: '/unused', sessions: '/unused' })
    source.agents.terminal = agent => agent ? { address: agent.chat, state: 'live', pid: 1 } as ReturnType<typeof source.agents.terminal> : undefined
    source.agents.send = async () => {}
    source.agents.launch = async (_space, chat, kind, _prompt, options) => {
      starts.push({ ...options, kind })
      const record: CoreAgent = { chat, space: space.id, machine, kind, role: options?.role || 'coordinator', state: 'idle', launch: chat, grant: chat, hook: '/unused', started: 1, terminal: chat,
        pilot: options?.pilot ? { run: options.pilot.run, home: '/inside', captures: '/outside/captures' } : undefined }
      source.store.set('agent', chat, record); return record
    }
    const run = source.pilots.policy.begin(space.id, machine, { harness: { kind: 'claude' }, reviewer: { kind: 'codex' }, parallel: 2, hosts: ['api.anthropic.com', 'chatgpt.com'], secrets: [], approvals: ['merge'], runtime: 60000 })
    const grant = source.mailbox.issue(space.id, 'coordinator', machine, ['cli', 'pilot'])
    const coordinator: CoreAgent = { chat: space.id, space: space.id, machine, kind: 'claude', role: 'coordinator', state: 'idle', launch: grant.session, grant: grant.id, hook: '/unused', started: 1, pilot: { run: run.id, home: '/inside', captures: '/outside/captures' } }
    source.store.set('agent', coordinator.chat, coordinator); source.pilots.policy.activate(run.id, { chat: coordinator.chat, launch: coordinator.launch, role: 'coordinator' })
    new CorePilotRepositories(source.store).remember(machine, repo, [repo])
    const task = await source.tasks.add(grant, { title: 'Contained task', brief: 'Change the scratch file only.', later: true })
    expect(task).toMatchObject({ pilot: run.id, kind: 'claude', review: { kind: 'codex' }, mergePolicy: 'ask' })
    expect(task.folder.startsWith(join(root, 'pilot-worktrees') + '/')).toBe(true)
    expect(starts[0]).toMatchObject({ role: 'task', folder: task.folder, pilot: { run: run.id, repo, hosts: run.config.hosts, deadline: run.started + 60000 } })
    expect(source.pilots.policy.get(run.id)?.actors).toContainEqual({ chat: task.chat, launch: task.chat, role: 'task', task: task.id })
    expect(source.tasks.get(task.id)?.workflow).toBe('todo')
    await source.tasks.deliver(task.id, task.chat, 'Go: change the scratch file only')
    expect(source.tasks.get(task.id)?.workflow).toBe('working')
    writeFileSync(join(task.folder, 'base.txt'), 'contained change\n')
    const worker = source.agents.get(task.chat)!
    const workerGrant = { id: worker.grant, session: worker.launch, chat: worker.chat, machine, actions: ['cli', 'pilot'] } as unknown as Grant
    expect((await source.pilots.commands.cli(worker, workerGrant, ['checkpoint', 'Contained checkpoint'])).out).toContain('Checkpoint:')
    expect(execute(['git', 'show', 'HEAD:base.txt'], task.folder).toString()).toBe('contained change\n')
    await source.tasks.review(grant, task.id)
    expect(starts[1]).toMatchObject({ role: 'reviewer', readOnly: true, kind: 'codex', pilot: { run: run.id, repo } })
    expect(source.pilots.policy.get(run.id)?.actors.some(actor => actor.role === 'reviewer' && actor.task === task.id)).toBe(true)
    await expect(source.tasks.add(grant, { title: 'Wrong harness', brief: 'Must not start', kind: 'codex' })).rejects.toThrow('selected agent')
    const custom = await source.tasks.add(grant, { title: 'One-task settings', brief: 'Wait for go; no edits.', later: true, kind: 'claude', model: 'default', reviewer: 'codex', reviewerModel: 'default', settings: { 'brief.review': 'off', 'review.rounds': '1', 'review.mustFix': 'critical', 'brief.merge': 'on its own' } })
    expect(custom).toMatchObject({ review: { on: false, kind: 'codex', rounds: 1, mustFix: 'critical' }, mergePolicy: 'ask', model: undefined, overrides: { 'brief.review': 'off', 'task.agent': 'claude', 'reviewer.agent': 'codex' } })
    expect(source.settings.get('brief.review', space.id)).toBe('on')
    expect(source.settings.get('review.rounds', space.id)).toBe('3 rounds')
    await expect(source.tasks.add(grant, { title: 'Wrong reviewer', brief: 'Must not start', reviewer: 'claude' })).rejects.toThrow('selected agent')
    source.pilots.policy.stop(run.id)
    await expect(source.tasks.review(grant, task.id)).rejects.toThrow('stopped')
    expect(starts).toHaveLength(3)
  } finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(root, { recursive: true, force: true }) }
})
