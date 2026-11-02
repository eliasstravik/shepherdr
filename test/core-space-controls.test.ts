import { findCoreSpace } from '../server/core/space-names.ts'
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreSource } from '../server/core/source.ts'
import type { CoreAgent, CoreSpace } from '../server/core/model.ts'
import type { CoreTask } from '../server/core/tasks.ts'
import type { CoreTerminal } from '../server/core/protocol.ts'

async function fixture(work: (f: ReturnType<typeof setup>) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-space-controls-')), f = setup(home)
  try { await work(f) } finally { f.source.stop(); await f.source.pilots.lifecycle.drain(); f.source.mailbox.close(); f.source.store.close(); rmSync(home, { recursive: true, force: true }) }
}
function setup(home: string) {
  const source = new CoreSource({ home, socket: '/unused', session: 'test', binary: 'hc', port: 0 }), machine = source.localMachineId()
  source.core.current.connected = true; source.machineConnected = () => true
  const space: CoreSpace = { id: `p:${machine}:demo`, name: 'demo', machine, folder: join(home, 'project'), base: 'main', prefix: 'DEMO', mode: 'regular', added: 1 }
  const parent = { ...space, id: `p:${machine}:~`, name: '~', home: true, folder: home }
  source.store.set('space', parent.id, parent); source.store.set('space', space.id, space)
  writeFileSync(join(home, 'kept.txt'), 'Preserve files\n')
  const caller: CoreAgent = { chat: parent.id, space: parent.id, machine, role: 'coordinator', kind: 'claude', launch: 'caller', grant: 'caller-grant', hook: '/unused', started: 1, state: 'idle', pid: 41 }
  const coordinator = { ...caller, chat: space.id, space: space.id, launch: 'target', grant: 'target-grant', pid: 42 }
  source.store.set('agent', caller.chat, caller); source.store.set('agent', coordinator.chat, coordinator)
  const terminal = { address: 't2', state: 'live', pid: 42, created_ms: 2, labels: {}, cwd: space.folder } as CoreTerminal
  source.agents.terminal = agent => agent.chat === coordinator.chat ? terminal : { ...terminal, address: 't1', pid: 41, cwd: home }
  const killed: string[] = [], revoked: string[] = []
  source.core.call = async <T>(method: string, input?: unknown) => { if (method === 'terminal.kill') { killed.push((input as { terminal: string }).terminal); terminal.state = 'finished' }; return {} as T }
  source.mailbox.revoke = chat => { revoked.push(chat) }
  source.denyPermissions = () => {}
  source.folders = async (_machine, path) => ({ path, exists: true, dir: true, repo: path, entries: [] })
  source.files.exec = async (_machine, args) => { if (args.join(' ') === 'git symbolic-ref --short HEAD') return Buffer.from('main'); throw Error('Unexpected filesystem command') }
  source.tasks.git.head = async (_repo, ref) => { if (ref !== undefined && ref !== 'main' && ref !== 'next') throw Error('Unknown branch'); return 'a'.repeat(40) }
  return { source, space, caller, coordinator, terminal, killed, revoked, home }
}

test('space CLI renames only display metadata and changes the base only for future tasks', () => fixture(async f => {
  const task = { id: 'DEMO-1', place: f.space.id, machine: f.space.machine, chat: 'DEMO-1/Agent', workflow: 'todo', base: 'main' } as CoreTask
  f.source.store.set('task', task.id, task)
  await f.source.places.cli(f.caller, ['space', 'rename', 'demo', 'renamed'])
  expect(f.source.space(f.space.id)?.name).toBe('demo')
  expect(f.source.snapshot().places.find(place => place.id === f.space.id)?.name).toBe('renamed')
  await f.source.places.cli(f.caller, ['space', 'set', 'base', 'next', '--space', 'renamed'])
  expect(f.source.space(f.space.id)?.base).toBe('next'); expect(f.source.tasks.get(task.id)?.base).toBe('main')
  await expect(f.source.places.cli(f.caller, ['space', 'set', 'base', 'missing', '--space', 'renamed'])).rejects.toThrow('Unknown branch')
  expect(f.source.space(f.space.id)?.base).toBe('next'); expect(f.killed).toEqual([])
  await expect(f.source.places.cli({ ...f.caller, role: 'task' }, ['space', 'rename', 'renamed', 'other'])).rejects.toThrow('coordinator')
}))

test('remove and re-add keep identity, task history, settings, chat and files while stopping only its coordinator', () => fixture(async f => {
  const task = { id: 'DEMO-1', name: 'Retained', place: f.space.id, machine: f.space.machine, chat: 'DEMO-1/Agent', workflow: 'todo', base: 'main', kind: 'claude', age: 'now' } as CoreTask
  f.source.store.set('task', task.id, task); f.source.store.set(`message:${f.space.id}`, 'history', { id: 'history', who: 'agent', text: 'Keep this', at: 1 })
  f.source.store.set('setting', `${f.space.id}:task.instructions`, 'Keep private defaults')
  await f.source.act({ type: 'space-remove', place: f.space.id })
  expect(f.source.space(f.space.id)).toBeUndefined(); expect(f.source.snapshot().tasks).toEqual([])
  expect(f.source.tasks.get(task.id)).toMatchObject({ base: 'main', place: f.space.id })
  expect(f.killed).toEqual(['t2']); expect(f.revoked).toEqual([f.space.id])
  expect(readFileSync(join(f.home, 'kept.txt'), 'utf8')).toBe('Preserve files\n')
  expect(await f.source.addSpace({ machine: f.space.machine, path: f.space.folder })).toEqual({ place: f.space.id })
  expect(f.source.snapshot().tasks.map(task => task.id)).toEqual(['DEMO-1'])
  expect(f.source.store.get(`message:${f.space.id}`, 'history')).toMatchObject({ text: 'Keep this' })
  expect(f.source.store.get('setting', `${f.space.id}:task.instructions`)).toBe('Keep private defaults')
}))

test('home, working tasks and active containment prevent removal', () => fixture(async f => {
  await expect(f.source.places.remove(f.caller.space)).rejects.toThrow('home')
  f.source.store.set('task', 'DEMO-1', { id: 'DEMO-1', place: f.space.id, workflow: 'working' })
  await expect(f.source.places.remove(f.space.id)).rejects.toThrow('work running')
  f.source.store.delete('task', 'DEMO-1')
  f.source.pilots.policy.begin(f.space.id, f.space.machine, { harness: { kind: 'claude' }, reviewer: { kind: 'codex' }, hosts: [], secrets: [], approvals: ['merge'], parallel: 1 })
  await expect(f.source.places.remove(f.space.id)).rejects.toThrow('Autopilot')
  expect(f.killed).toEqual([]); expect(f.source.space(f.space.id)).toBeDefined()
}))

test('removal gates an accepted creation before persistence and preserves state on an unknown exit', () => fixture(async f => {
  let entered!: () => void, release!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve })
  f.source.core.call = async <T>() => { entered(); await new Promise<void>(resolve => { release = resolve }); return {} as T }
  const removing = f.source.places.remove(f.space.id)
  await reached
  expect(f.source.places.removing(f.space.id)).toBe(true)
  await expect(f.source.tasks.addInSpace(f.space, { title: 'Race', brief: 'Wait' })).rejects.toThrow('repository space')
  await expect(f.source.addSpace({ machine: f.space.machine, path: f.space.folder })).rejects.toThrow('being removed')
  f.source.agents.terminal = () => undefined
  release(); await expect(removing).rejects.toThrow('pending')
  expect(f.source.space(f.space.id)).toBeDefined(); expect(f.source.places.removing(f.space.id)).toBe(false)
}))

test('a changed actor after base validation cannot overwrite the current space', () => fixture(async f => {
  f.source.tasks.git.head = async () => { f.source.store.set('agent', f.caller.chat, { ...f.caller, launch: 'replacement' }); return 'a'.repeat(40) }
  await expect(f.source.places.cli(f.caller, ['space', 'set', 'base', 'next', '--space', 'demo'])).rejects.toThrow('changed')
  expect(f.source.space(f.space.id)?.base).toBe('main')
}))

test('active and removed display aliases stay reserved across rename, add and re-add', () => fixture(async f => {
  await f.source.places.cli(f.caller, ['space', 'rename', 'demo', 'renamed'])
  await expect(f.source.addSpace({ machine: f.space.machine, path: join(f.home, 'another'), name: 'renamed' })).rejects.toThrow()
  await f.source.places.remove(f.space.id)
  const other = { ...f.space, id: `p:${f.space.machine}:other`, name: 'other', folder: join(f.home, 'other') }
  f.source.store.set('space', other.id, other)
  expect(await f.source.act({ type: 'rename', id: other.id, name: 'renamed' })).toMatchObject({ ok: false })
  expect(await f.source.act({ type: 'rename', id: other.id, name: 'demo' })).toMatchObject({ ok: false })
  await expect(f.source.addSpace({ machine: f.space.machine, path: join(f.home, 'another'), name: 'renamed' })).rejects.toThrow()
  expect(await f.source.addSpace({ machine: f.space.machine, path: f.space.folder })).toEqual({ place: f.space.id })
  expect(f.source.snapshot().places.find(place => place.id === f.space.id)?.name).toBe('renamed')
}))

test('an outlive-parent task child prevents removal even when its private old root is finished', () => fixture(async f => {
  const task = { id: 'DEMO-1', name: 'Retained', place: f.space.id, machine: f.space.machine, chat: 'DEMO-1/Agent', workflow: 'todo', base: 'main' } as CoreTask
  f.source.store.set('task', task.id, task)
  const worker = { ...f.caller, chat: task.chat, space: f.space.id, role: 'task' as const, launch: 'worker', pid: 43 }
  f.source.store.set('agent-launch', worker.launch, worker)
  const root = { ...f.terminal, address: 't3', pid: 43, state: 'finished' }, child = { ...f.terminal, address: 't4', pid: 44, parent: 't3', state: 'live' }
  ;(f.source.core.current.terminals as Map<string, CoreTerminal>).set('t3', root)
  ;(f.source.core.current.terminals as Map<string, CoreTerminal>).set('t4', child)
  const terminal = f.source.agents.terminal.bind(f.source.agents)
  f.source.agents.terminal = agent => agent.launch === worker.launch ? root : terminal(agent)
  await expect(f.source.places.remove(f.space.id)).rejects.toThrow('work running')
  expect(f.killed).toEqual([]); expect(child.state).toBe('live'); expect(f.source.space(f.space.id)).toBeDefined()
  child.state = 'finished'
  await f.source.places.remove(f.space.id)
  expect(f.killed).toEqual(['t2'])
}))

test('task, automation and heartbeat commands resolve renamed spaces to the same machine-scoped ID', () => fixture(async f => {
  await f.source.places.cli(f.caller, ['space', 'rename', 'demo', 'renamed'])
  const grant = { chat: f.caller.chat, session: f.caller.launch, id: f.caller.grant, machine: f.caller.machine } as import('../server/core/mailbox.ts').Grant
  let selected: string | undefined
  f.source.tasks.addInSpace = async space => { selected = space.id; return { id: 'DEMO-1' } as CoreTask }
  await f.source.tasks.add(grant, { title: 'Alias', brief: 'Wait', space: 'renamed' })
  expect(selected).toBe(f.space.id)
  await f.source.automations.cli(f.caller, ['automation', 'add', 'Alias rule', '--space', 'renamed', '--task', 'Later', '--on', 'ready'])
  expect(f.source.automations.model.find(f.space.id, 'Alias rule')).toBeDefined()
  expect(f.source.heartbeats.cli(f.caller, ['heartbeat', 'set', 'renamed'], 'Keep alias checklist')).toContain('saved')
  expect(f.source.heartbeats.read(f.space)).toBe('Keep alias checklist\n')
  await expect(f.source.places.cli({ ...f.caller, machine: 'other' }, ['space', 'rename', 'renamed', 'wrong'])).rejects.toThrow('machine')
}))

test('real core snapshots expose repository and ID pages; UI edits preserve existing tasks and validate branches', async () => fixture(async f => {
  const existing = { id: 'DEMO-1', chat: 'DEMO-1/Agent', place: f.space.id, machine: f.space.machine, workflow: 'todo', base: 'main' } as CoreTask
  f.source.store.set('task', existing.id, existing)
  expect(f.source.chat(f.coordinator.chat)).toMatchObject({ cli: 'Claude Code', agent: { kind: 'claude' } })
  const settings = f.source.snapshot().settings!
  for (const name of ['Plugins', 'Machines']) { const page = settings.find(page => page.name === name); expect(page).toBeDefined(); expect(page?.level).toBeUndefined(); expect(page?.global).toBeUndefined() }
  expect(settings.find(page => page.name === 'Machines')?.rows[0].value).toBe('Main · reachable')
  let pages = settings.filter(page => page.level === f.space.id)
  expect(pages.find(page => page.name === 'Repository')?.rows[0]).toMatchObject({ key: 'space.base', value: 'main' })
  expect(pages.find(page => page.name === 'Task IDs')?.rows.map(row => row.key)).toEqual(['taskIds.prefix', 'taskIds.next'])
  await f.source.act({ type: 'setting', place: f.space.id, key: 'space.base', value: 'next' })
  expect(f.source.space(f.space.id)?.base).toBe('next')
  expect(f.source.tasks.get(existing.id)?.base).toBe('main')
  await expect(f.source.act({ type: 'setting', place: f.space.id, key: 'space.base', value: 'missing' })).rejects.toThrow('Unknown branch')
  expect(f.source.space(f.space.id)?.base).toBe('next')
  await f.source.act({ type: 'setting', place: f.space.id, key: 'taskIds.prefix', value: 'NEW' })
  await f.source.act({ type: 'setting', place: f.space.id, key: 'taskIds.next', value: '40' })
  pages = f.source.snapshot().settings!.filter(page => page.level === f.space.id)
  expect(pages.find(page => page.name === 'Task IDs')?.rows.map(row => row.value)).toEqual(['NEW', '40'])
  expect(f.source.tasks.get(existing.id)?.id).toBe('DEMO-1')
}))


test('home retains its familiar display name, canonical key, both aliases and explicit renames', () => fixture(async f => {
  const home = f.source.space(f.caller.space)!
  expect(home.name).toBe('~') // Existing rewrite records need no mutation.
  expect(f.source.snapshot().places.find(place => place.id === home.id)?.name).toBe('home')
  for (const alias of ['home', '~', home.id]) expect(findCoreSpace(f.source, home.machine, alias)?.id).toBe(home.id)
  f.source.store.set('name', home.id, 'My home')
  expect(f.source.snapshot().places.find(place => place.id === home.id)?.name).toBe('My home')
  expect(findCoreSpace(f.source, home.machine, 'My home')?.id).toBe(home.id)
  expect(f.source.places.names(home.machine)).toContain('home')
  expect(f.source.space(home.id)?.name).toBe('~')
}))
