import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreSource } from '../server/core/source.ts'
import type { CoreAgent, CoreSpace } from '../server/core/model.ts'
import { runChild } from './child.ts'

/** Real private files through a fake core exec boundary, on GitHub only. Checker fakes are not UI proof. */
async function fixture(run: (source: CoreSource, agent: CoreAgent, root: string, shots: { light: string; dark: string }) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'shep-artifacts-')), workspace = join(root, 'workspace')
  mkdirSync(workspace)
  const source = new CoreSource({ home: join(root, 'app'), port: 17887, session: 'test', socket: '/unused', binary: 'hc' })
  const space = { id: 'p:machine:one', name: 'one', machine: 'machine', folder: workspace, base: 'main', prefix: 'ONE', mode: 'regular', added: 1 } as CoreSpace
  const agent: CoreAgent = { chat: space.id, space: space.id, machine: space.machine, role: 'coordinator', kind: 'claude', launch: 'launch', grant: 'grant', hook: '/unused', started: 1, state: 'idle' }
  agent.grant = source.mailbox.issue(agent.chat, agent.launch, agent.machine, ['artifact']).id
  source.agents.terminal = (() => ({ state: 'live', pid: 123 })) as unknown as typeof source.agents.terminal
  source.store.set('space', space.id, space); source.store.set('agent', agent.chat, agent)
  source.agents.bun = async () => process.execPath
  source.files.exec = async (_machine, argv, cwd, input) => {
    return runChild(argv, { cwd, input, env: { ...process.env, HOME: root, USERPROFILE: root } })
  }
  const shots = { light: join(root, 'light.png'), dark: join(root, 'dark.png') }
  writeFileSync(shots.light, 'test picture'); writeFileSync(shots.dark, 'test picture dark')
  source.artifacts.checker = async () => ({ errors: [], warnings: [], shots })
  writeFileSync(join(workspace, 'page.html'), '<p>First</p>')
  writeFileSync(join(workspace, 'data.json'), '{"count":1}')
  try { await run(source, agent, root, shots) }
  finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(root, { recursive: true, force: true }) }
}

test('artifact data/title updates retain HTML, versions prune without losing referenced content, thumbs survive check cleanup', async () => fixture(async (source, agent, root, shots) => {
  const cwd = source.space(agent.space)!.folder
  await source.artifacts.cli(agent, ['artifact', 'new', 'page.html', '--title', 'example'], cwd)
  const id = source.artifacts.list()[0].id
  await source.artifacts.cli(agent, ['artifact', 'update', id, '--data', 'data.json'], cwd)
  expect(source.artifacts.page(id)).toMatchObject({ html: '<p>First</p>', data: { count: 1 } })
  for (let n = 0; n < 21; n++) await source.artifacts.cli(agent, ['artifact', 'update', id, '--title', `Example ${n}`], cwd)
  expect(source.artifacts.list()[0].versions).toHaveLength(20)
  expect(source.artifacts.page(id).html).toBe('<p>First</p>')
  rmSync(shots.light); rmSync(shots.dark)
  expect(await source.artifacts.thumb(id, false)!.text()).toBe('test picture')
  await source.artifacts.act({ type: 'artifact-delete', place: agent.space, artifact: id })
  expect(source.artifacts.list()).toHaveLength(0)
  expect(source.store.get('artifact-id', id)).toBe(id) // Old chat links can never resolve to a reused ID.
}))

test('a task agent\'s artifact gets the task\'s full name, once, and past the title limit; a coordinator\'s stays as written', async () => fixture(async (source, coordinator) => {
  const cwd = source.space(coordinator.space)!.folder, chat = 'machine/ONE-7/Agent', name = 'Stop Goes in note on every send'
  source.store.set('task', 'machine/ONE-7', { id: 'machine/ONE-7', localId: 'ONE-7', name, chat, place: coordinator.space, machine: coordinator.machine, workflow: 'working' })
  const agent: CoreAgent = { ...coordinator, chat, role: 'task', launch: 'task-launch' }
  agent.grant = source.mailbox.issue(chat, agent.launch, agent.machine, ['artifact']).id
  source.store.set('agent', chat, agent)
  const title = (id: string) => source.artifacts.list().find(artifact => artifact.id === id)!.title
  const made = async (who: CoreAgent, words: string) => /artifact (\S+) /.exec(await source.artifacts.cli(who, ['artifact', 'new', 'page.html', '--title', words], cwd))![1]

  const proof = await made(agent, 'ONE-7: proof')
  expect(title(proof)).toBe(`ONE-7: ${name} · Proof`)
  expect(title(await made(agent, `ONE-7: ${name} · Proof`))).toBe(`ONE-7: ${name} · Proof`)
  await source.artifacts.cli(agent, ['artifact', 'update', proof, '--data', 'data.json'], cwd)
  expect(title(proof)).toBe(`ONE-7: ${name} · Proof`)
  await source.artifacts.cli(agent, ['artifact', 'update', proof, '--title', 'Screens'], cwd)
  expect(title(proof)).toBe(`ONE-7: ${name} · Screens`)
  const long = 'x'.repeat(200)
  const longest = await made(agent, long)
  expect(title(longest)).toBe(`ONE-7: ${name} · X${'x'.repeat(199)}`)
  await source.artifacts.cli(agent, ['artifact', 'update', longest, '--title', title(longest)], cwd)
  await expect(made(agent, long + 'x')).rejects.toThrow('under 200')

  const report = await made(coordinator, 'weekly report')
  expect(title(report)).toBe('Weekly report')
  // a task's agent may update it, but it is still not for that task
  await source.artifacts.cli(agent, ['artifact', 'update', report, '--title', 'Weekly numbers'], cwd)
  expect(title(report)).toBe('Weekly numbers')
  // made for the task, it keeps saying so when the coordinator retitles it; before this, a title stays until it is changed
  await source.artifacts.cli(coordinator, ['artifact', 'update', proof, '--title', 'Final'], cwd)
  expect(title(proof)).toBe(`ONE-7: ${name} · Final`)
  for (let n = 0; n < 21; n++) await source.artifacts.cli(coordinator, ['artifact', 'update', proof, '--title', `Final ${n}`], cwd)
  expect(title(proof)).toBe(`ONE-7: ${name} · Final 20`)
  source.store.set('core-artifact', proof, { ...source.store.get('core-artifact', proof) as object, title: 'ONE-7: Proof' })
  await source.artifacts.cli(agent, ['artifact', 'update', proof, 'page.html'], cwd)
  expect(title(proof)).toBe('ONE-7: Proof')
}))

test('private files and symlink aliases cannot be imported', async () => fixture(async (source, agent, root) => {
  const cwd = source.space(agent.space)!.folder, privateFile = join(source.config.home, 'vault.txt')
  writeFileSync(privateFile, 'SYNTHETIC_PRIVATE_MATERIAL')
  symlinkSync(privateFile, join(cwd, 'innocent.html'))
  await expect(source.artifacts.cli(agent, ['artifact', 'new', 'innocent.html', '--title', 'Unsafe'], cwd)).rejects.toThrow('Private files')
  linkSync(privateFile, join(cwd, 'hardlink.html'))
  await expect(source.artifacts.cli(agent, ['artifact', 'new', 'hardlink.html', '--title', 'Unsafe'], cwd)).rejects.toThrow('regular file')
  expect(source.artifacts.list()).toHaveLength(0)
}))

test('simultaneous updates and delete cannot overwrite each other; stale launch cannot publish', async () => fixture(async (source, agent) => {
  const cwd = source.space(agent.space)!.folder
  await source.artifacts.cli(agent, ['artifact', 'new', 'page.html', '--title', 'Example'], cwd)
  const id = source.artifacts.list()[0].id
  let release!: () => void, entered!: () => void
  const checked = new Promise<void>(resolve => { entered = resolve })
  const previous = source.artifacts.checker
  source.artifacts.checker = async (...args) => { entered(); await new Promise<void>(resolve => { release = resolve }); return previous(...args) }
  const first = source.artifacts.cli(agent, ['artifact', 'update', id, '--data', 'data.json'], cwd)
  await checked
  await expect(source.artifacts.cli(agent, ['artifact', 'update', id, '--title', 'Lost update'], cwd)).rejects.toThrow('being updated')
  await expect(source.artifacts.act({ type: 'artifact-delete', place: agent.space, artifact: id })).rejects.toThrow('being updated')
  source.store.set('agent', agent.chat, { ...agent, grant: 'replacement' })
  release()
  await expect(first).rejects.toThrow('replaced session')
  expect(source.artifacts.list()[0].v).toBe(1)
}))

test('a browser error or missing check screenshots refuses publication', async () => fixture(async (source, agent) => {
  const cwd = source.space(agent.space)!.folder
  source.artifacts.checker = async () => ({ errors: ['script error'], warnings: [], shots: { light: '/missing', dark: '/missing' } })
  await expect(source.artifacts.cli(agent, ['artifact', 'new', 'page.html', '--title', 'Example'], cwd)).rejects.toThrow('script error')
  source.artifacts.checker = async () => ({ errors: [], warnings: [], skipped: 'Browser unavailable' })
  await expect(source.artifacts.cli(agent, ['artifact', 'new', 'page.html', '--title', 'Example'], cwd)).rejects.toThrow('could not be checked')
  expect(source.artifacts.list()).toHaveLength(0)
}))


test('revoking an unchanged session during validation refuses publication', async () => fixture(async (source, agent) => {
  const cwd = source.space(agent.space)!.folder, checker = source.artifacts.checker
  source.artifacts.checker = async (...args) => {
    source.mailbox.revoke(agent.chat)
    return checker(...args)
  }
  await expect(source.artifacts.cli(agent, ['artifact', 'new', 'page.html', '--title', 'Example'], cwd)).rejects.toThrow('replaced session')
  expect(source.artifacts.list()).toHaveLength(0)
}))

test('artifact space selection accepts visible aliases and refuses ambiguous aliases', async () => fixture(async (source, agent) => {
  source.store.set('name', agent.space, 'renamed-one')
  expect(await source.artifacts.cli(agent, ['artifact', 'list', '--space', 'renamed-one'], '/unused')).toBe('No artifacts here yet.')
  const other = { ...source.space(agent.space)!, id: 'p:machine:two', name: 'two' }
  source.store.set('space', other.id, other); source.store.set('name', other.id, 'renamed-one')
  await expect(source.artifacts.cli(agent, ['artifact', 'list', '--space', 'renamed-one'], '/unused')).rejects.toThrow('unambiguous')
}))


test('artifact keeper labels use friendly names while note delivery keeps canonical ownership', async () => fixture(async (source, agent) => {
  await source.artifacts.cli(agent, ['artifact', 'new', 'page.html', '--title', 'Naming proof'], source.space(agent.space)!.folder)
  const id = source.artifacts.list()[0].id
  expect(source.artifacts.list()[0].keeper).toBe('one')
  source.store.set('name', agent.space, 'Renamed space')
  expect(source.artifacts.list()[0].keeper).toBe('Renamed space')
  let target = ''
  source.saveAndDeliver = (chat, _id, _text, save) => { target = chat; save() }
  expect(await source.artifacts.act({ type: 'artifact-note', place: agent.space, artifact: id, v: 1, note: 'A harmless note' })).toEqual({ to: 'Renamed space' })
  expect(target).toBe(agent.chat)
  const taskChat = 'ONE-1/Agent'
  source.store.set('task', 'ONE-1', { id: 'ONE-1', chat: taskChat, workflow: 'working', place: agent.space })
  source.store.set('agent', taskChat, { ...agent, chat: taskChat, role: 'task' })
  const record = source.store.get<{ versions: { chat: string }[] }>('core-artifact', id)!
  record.versions.at(-1)!.chat = taskChat; source.store.set('core-artifact', id, record)
  expect(source.artifacts.list()[0].keeper).toBe('ONE-1 agent')
  source.store.set('task', 'ONE-1', { id: 'ONE-1', chat: taskChat, workflow: 'closed', place: agent.space })
  expect(source.artifacts.list()[0].keeper).toBe('Renamed space')
}))
