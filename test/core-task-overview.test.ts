import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreSource } from '../server/core/source.ts'
import type { CoreAgent, CoreSpace } from '../server/core/model.ts'
import type { CoreTask } from '../server/core/tasks.ts'
import { seal, unseal, type MailCredential } from '../server/core/envelope.ts'
import type { Grant } from '../server/core/mailbox.ts'

async function fixture(work: (f: ReturnType<typeof setup>) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-task-overview-')), f = setup(home)
  try { await work(f) } finally { f.source.stop(); f.source.mailbox.close(); f.source.store.close(); rmSync(home, { recursive: true, force: true }) }
}
function setup(home: string) {
  const source = new CoreSource({ home, socket: '/unused', binary: 'hc', session: 'test', port: 0 }), local = source.localMachineId()
  const spaces = [['home', local, true], ['app', local, false], ['other', local, false], ['empty', local, false], ['remote-home', 'remote', true], ['remote-app', 'remote', false], ['hidden', local, false]].map(([name, machine, home]) => ({ id: String(name), name: String(name), machine: String(machine), home: Boolean(home), folder: '/repo', base: 'main', prefix: 'APP', mode: 'regular', added: 1, ...(name === 'hidden' ? { removed: 1 } : {}) })) as CoreSpace[]
  for (const space of spaces) source.store.set('space', space.id, space)
  const tasks = [['APP-1', 'app', local], ['OTHER-1', 'other', local], ['remote/APP-1', 'remote-app', 'remote'], ['HIDDEN-1', 'hidden', local]].map(([id, place, machine]) => ({ id, localId: id!.split('/').at(-1), name: id, place, machine, chat: `${id}/Agent`, workflow: 'todo', base: 'main', kind: 'claude', age: 'now' })) as CoreTask[]
  for (const task of tasks) source.store.set('task', task.id, task)
  const actor = (space: string, role: CoreAgent['role'] = 'coordinator', pilot = false) => {
    const own = spaces.find(item => item.id === space)!
    const agent = { chat: role === 'coordinator' ? space : 'APP-1/Agent', space, machine: own.machine, role, kind: 'claude', launch: `launch-${space}-${role}`, grant: `grant-${space}-${role}`, state: 'idle', started: 1, hook: '/unused', ...(pilot ? { pilot: { run: 'contained', home: '/inside', captures: '/outside' } } : {}) } as CoreAgent
    source.store.set('agent', agent.chat, agent)
    return { agent, grant: { id: agent.grant, chat: agent.chat, session: agent.launch, machine: agent.machine } as Grant }
  }
  return { source, tasks, actor }
}

test('main home reads all visible tasks; remote home stays within its machine and project actors within their space', () => fixture(async f => {
  const main = f.actor('home'), remote = f.actor('remote-home'), project = f.actor('app'), worker = f.actor('app', 'task')
  expect(f.source.tasks.list(main.grant).map(task => task.id)).toEqual(['APP-1', 'OTHER-1', 'remote/APP-1'])
  expect(f.source.tasks.list(remote.grant).map(task => task.id)).toEqual(['remote/APP-1'])
  expect(f.source.tasks.list(project.grant).map(task => task.id)).toEqual(['APP-1'])
  expect(f.source.tasks.list(worker.grant).map(task => task.id)).toEqual(['APP-1'])
  expect(f.source.tasks.list(main.grant, false, 'empty')).toEqual([])
  await expect(f.source.tasks.cli(project.grant, ['task', 'show', 'remote/APP-1'])).rejects.toThrow('cannot read')
  expect((await f.source.tasks.cli(main.grant, ['task', 'show', 'remote/APP-1'])).out).toContain('remote/APP-1')
  expect(JSON.parse((await f.source.tasks.cli(main.grant, ['task', 'show', 'APP-1'])).out).id).toBe('APP-1')
  expect(f.source.tasks.resolve(remote.grant, 'APP-1')?.id).toBe('remote/APP-1')
  await expect(f.source.tasks.cli(main.grant, ['task', 'pin', 'remote/APP-1'])).rejects.toThrow('does not own')
  expect(() => f.source.tasks.resolve(main.grant, '1')).toThrow('full task ID')
  expect(f.source.tasks.resolve(project.grant, '1')?.id).toBe('APP-1')
}))

test('overview separates archived tasks, follows renamed scope and refuses stale or forged actor identity', () => fixture(async f => {
  const main = f.actor('home'), project = f.actor('app')
  f.source.store.set('task', 'APP-1', { ...f.tasks[0], archived: 1 })
  f.source.store.set('name', 'app', 'renamed')
  expect(f.source.tasks.list(main.grant, true, 'renamed').map(task => task.id)).toEqual(['APP-1'])
  expect(f.source.tasks.list(main.grant, false, 'renamed')).toEqual([])
  expect(() => f.source.tasks.list(project.grant, false, 'other')).toThrow('scope')
  f.source.store.set('agent', project.agent.chat, { ...project.agent, launch: 'replacement' })
  expect(() => f.source.tasks.list(project.grant)).toThrow('current')
  expect(() => f.source.tasks.list({ ...main.grant, machine: 'remote' })).toThrow('current')
  const containedHome = f.actor('home', 'coordinator', true)
  expect(f.source.tasks.list(containedHome.grant)).toEqual([])
}))

test('task chat overview reads native product messages with bounded lines and text, without granting mutation authority', () => fixture(async f => {
  const main = f.actor('home'), project = f.actor('app')
  for (let i = 0; i < 3; i++) f.source.post('remote/APP-1/Agent', { id: `reply-${i}`, who: 'agent', text: String(i) + 'x'.repeat(3000), at: i + 1 })
  const result = JSON.parse((await f.source.tasks.cli(main.grant, ['task', 'chat', 'remote/APP-1', '--limit', '2'])).out)
  expect(result.messages).toHaveLength(2); expect(result.messages[0].text).toStartWith('1'); expect(result.messages[0].text).toHaveLength(2000); expect(result.messages[0].textTruncated).toBe(true)
  await expect(f.source.tasks.cli(project.grant, ['task', 'chat', 'remote/APP-1'])).rejects.toThrow('cannot read')
  await expect(f.source.tasks.cli(main.grant, ['task', 'chat', 'remote/APP-1', '--limit', '101'])).rejects.toThrow('1 to 100')
}))

const credential: MailCredential = { version: 1, grant: 'grant', server: 'server', machine: 'machine', key: Buffer.alloc(32, 7).toString('base64') }
function response(result: { out: string; code: number }) {
  const sealed = seal(credential, 'overview', 'response', result)
  return JSON.parse((unseal(credential, 'overview', 'response', sealed) as { out: string }).out)
}

test('large task details survive real mailbox bounds and UTF-8 continuation, refusing mixed revisions', () => fixture(async f => {
  const main = f.actor('home'), task = { ...f.tasks[0]!, desc: '😀☃\\\"\n'.repeat(12000), facts: 'Full facts '.repeat(10000) }
  f.source.store.set('task', task.id, task)
  let from = 0, revision = '', json = '', pages = 0
  do {
    const args = ['task', 'show', task.id, '--from', String(from), ...(revision ? ['--revision', revision] : [])]
    const page = response(await f.source.tasks.cli(main.grant, args))
    expect(page.data).not.toContain('�'); json += page.data; pages++
    revision = page.revision; from = page.nextFrom
  } while (from !== undefined)
  expect(pages).toBeGreaterThan(1)
  expect(JSON.parse(json)).toMatchObject({ desc: task.desc, facts: task.facts })
  const first = response(await f.source.tasks.cli(main.grant, ['task', 'show', task.id]))
  f.source.store.set('task', task.id, { ...task, facts: 'Changed later' })
  await expect(f.source.tasks.cli(main.grant, ['task', 'show', task.id, '--from', String(first.nextFrom), '--revision', first.revision])).rejects.toThrow('changed')
}))

test('overview summary pages never include full briefs or exceed a sealed mailbox response', () => fixture(async f => {
  const main = f.actor('home')
  for (let i = 0; i < 100; i++) f.source.store.set('task', `EXTRA-${i}`, { ...f.tasks[0]!, id: `EXTRA-${i}`, localId: `EXTRA-${i}`, name: '😀'.repeat(50), desc: 'Huge private brief '.repeat(10000) })
  const seen: string[] = []
  let next: string | undefined
  do {
    const page = response(await f.source.tasks.cli(main.grant, ['task', 'list', ...(next ? ['--after', next] : [])]))
    expect(page.tasks.length).toBeGreaterThan(0); expect(page.tasks.length).toBeLessThanOrEqual(50)
    for (const task of page.tasks) { expect(task.desc).toBeUndefined(); seen.push(task.id) }
    next = page.next
  } while (next)
  expect(seen).toHaveLength(103); expect(new Set(seen).size).toBe(seen.length)
  await expect(f.source.tasks.cli(main.grant, ['task', 'list', '--after', 'missing'])).rejects.toThrow('cursor')
}))

test('chat tail pages remain bounded and older messages stay reachable by cursor', () => fixture(async f => {
  const main = f.actor('home')
  for (let i = 0; i < 30; i++) f.source.post('remote/APP-1/Agent', { id: `reply-${i}`, who: 'agent', text: '😀\\\"\n'.repeat(3000), file: { name: 'Output', path: '/long/' + 'x'.repeat(5000) }, at: i + 1 })
  const seen = new Set<string>()
  let before: string | undefined
  do {
    const page = response(await f.source.tasks.cli(main.grant, ['task', 'chat', 'remote/APP-1', '--limit', '100', ...(before ? ['--before', before] : [])]))
    expect(page.messages.length).toBeGreaterThan(0)
    for (const message of page.messages) { expect(seen.has(message.id)).toBe(false); seen.add(message.id); expect(message.textTruncated).toBe(true); expect(message.fileTruncated).toBe(true) }
    before = page.before
  } while (before)
  expect(seen.size).toBe(30)
}))
