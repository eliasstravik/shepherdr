import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreSource } from '../server/core/source.ts'
import { prepareHome } from '../server/core/home.ts'
import { CoreTaskRelocation } from '../server/core/task-relocation.ts'
import type { CoreTask } from '../server/core/tasks.ts'
import { runChild } from './child.ts'

async function fixture(run: (source: CoreSource, task: CoreTask, root: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'shep-task-move-')), repo = join(root, 'repo'), folder = join(root, 'app/worktrees/old')
  prepareHome(join(root, 'app'))
  mkdirSync(repo); mkdirSync(join(root, 'app/worktrees'), { recursive: true })
  const git = (...args: string[]) => { const p = Bun.spawnSync(['git', ...args], { cwd: repo }); if (p.exitCode) throw Error(p.stderr.toString()) }
  git('init', '--initial-branch=main'); git('config', 'user.name', 'CI proof'); git('config', 'user.email', 'proof@example.invalid')
  writeFileSync(join(repo, 'kept.txt'), 'base'); git('add', '.'); git('commit', '-m', 'base'); git('worktree', 'add', '-b', 'work/one', folder)
  writeFileSync(join(folder, 'unfinished.txt'), 'PRESERVE_UNFINISHED')
  const source = new CoreSource({ home: join(root, 'app'), socket: '/unused', session: 'test', binary: 'hc', port: 0 })
  const task = { id: 'EX-1', chat: 'EX-1/Agent', name: 'Existing', place: 'space', machine: 'machine', repo, folder, branch: 'work/one', base: 'main', kind: 'claude', workflow: 'todo', review: { on: true, kind: 'codex', rounds: 3, mustFix: 'major' }, mergePolicy: 'ask' } as CoreTask
  source.store.set('space', 'space', { id: 'space', name: '../../never-follow-display-name', machine: 'machine', folder: repo, base: 'main', prefix: 'EX', mode: 'autopilot', added: 1 })
  source.store.set('task', task.id, task)
  source.agents.pilotWorktreeRoot = async () => join(root, 'safe-cache')
  mkdirSync(join(root, 'app/sessions'), { mode: 0o700 })
  source.agents.browserRuntime = async () => ({ root: join(import.meta.dir, '..'), bun: process.execPath, bin: '/unused', sessions: join(root, 'app/sessions') })
  source.files.exec = async (_machine, argv, cwd, input) => {
    return runChild(argv, { cwd, input })
  }
  try { await run(source, task, root) }
  finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(root, { recursive: true, force: true }) }
}

test('checked worktree adoption preserves uncommitted bytes and uses an opaque cache path', async () => fixture(async (source, task, root) => {
  const old = task.folder
  const exec = source.files.exec.bind(source.files)
  let moveArgs: Parameters<typeof source.files.exec> | undefined
  source.files.exec = async (...args) => { if (args[1][1]?.endsWith('core-worktree-move.ts')) moveArgs = args; return exec(...args) }
  await new CoreTaskRelocation(source).adopt(task)
  expect(task.folder.startsWith(join(root, 'safe-cache/adopted/EX-1-'))).toBe(true)
  expect(existsSync(old)).toBe(false)
  expect(readFileSync(join(task.folder, 'unfinished.txt'), 'utf8')).toBe('PRESERVE_UNFINISHED')
  expect(await source.tasks.git.run({ machine: task.machine, folder: task.folder }, ['status', '--porcelain'])).toContain('unfinished.txt')
  expect(source.store.get('task-relocation', task.id)).toBeUndefined()
  expect(moveArgs).toBeDefined()
  expect((await exec(...moveArgs!)).toString()).toBe('WORKTREE_MOVE_CONFIRMED') // Same uncertain request is safe after its first effect.
  const folder = task.folder
  await new CoreTaskRelocation(source).adopt(task)
  expect(task.folder).toBe(folder)
}))

test('an uncertain move is not replayed, and its registered destination can be recovered later', async () => fixture(async (source, task) => {
  const exec = source.files.exec.bind(source.files)
  let moves = 0
  source.files.exec = async (...args) => {
    if (args[1][1]?.endsWith('core-worktree-move.ts')) { moves++; await exec(...args); throw Error('Response lost after effect') }
    return exec(...args)
  }
  await expect(new CoreTaskRelocation(source).adopt(task)).rejects.toThrow('unconfirmed')
  expect(moves).toBe(1)
  await expect(new CoreTaskRelocation(source).adopt(task)).rejects.toThrow('90 seconds')
  expect(moves).toBe(1)
  const intent = source.store.get<any>('task-relocation', task.id)!
  source.store.set('task-relocation', task.id, { ...intent, until: 0 })
  await new CoreTaskRelocation(source).adopt(task)
  expect(moves).toBe(1)
  expect(task.folder).toBe(intent.to)
  expect(readFileSync(join(task.folder, 'unfinished.txt'), 'utf8')).toBe('PRESERVE_UNFINISHED')
  expect(source.store.get('task-relocation', task.id)).toBeUndefined()
}))

test('in-flight adoption reserves its run before awaiting cleanup, and stop prevents a fresh worker launch', async () => fixture(async (source, task) => {
  const run = source.pilots.policy.begin(task.place, task.machine, { harness: { kind: 'claude' }, reviewer: { kind: 'codex' }, hosts: ['api.anthropic.com'], secrets: [], approvals: ['merge'], parallel: 1 })
  const grant = source.mailbox.issue(task.place, 'coord-launch', task.machine, ['cli', 'pilot'])
  source.store.set('agent', task.place, { chat: task.place, space: task.place, machine: task.machine, role: 'coordinator', kind: 'claude', launch: grant.session, grant: grant.id, hook: '/unused', state: 'idle', started: 1, pilot: { run: run.id, home: '/unused', captures: '/unused' } })
  source.pilots.policy.activate(run.id, { chat: task.place, launch: grant.session, role: 'coordinator' })
  source.machineConnected = () => true
  let entered!: () => void, release!: () => void, launches = 0
  const waiting = new Promise<void>(resolve => { entered = resolve }), blocked = new Promise<void>(resolve => { release = resolve })
  source.browsers.close = async () => { entered(); await blocked }
  source.agents.launch = async () => { launches++; throw Error('Unexpected worker') }
  const starting = source.tasks.start(grant, task.id).then(() => undefined, error => error as Error)
  await waiting
  expect(source.pilots.policy.get(run.id)?.tasks).toContain(task.id)
  expect(source.tasks.busy(task.id)).toBe(true)
  source.store.set('task', 'EX-2', { ...task, id: 'EX-2', chat: 'EX-2/Agent' })
  await expect(source.tasks.start(grant, 'EX-2')).rejects.toThrow('maximum parallel')
  source.pilots.policy.stop(run.id)
  release()
  expect((await starting)?.message).toContain('stopped')
  expect(launches).toBe(0)
  expect(source.tasks.get(task.id)?.pilot).toBeUndefined()
  const moved = source.tasks.get(task.id)!.folder
  expect(readFileSync(join(moved, 'unfinished.txt'), 'utf8')).toBe('PRESERVE_UNFINISHED')
}))
