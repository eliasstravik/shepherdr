import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreSource } from '../server/core/source.ts'
import { CoreCommands } from '../server/core/commands.ts'
import type { CoreAgent, CoreSpace } from '../server/core/model.ts'
import type { CoreTask } from '../server/core/tasks.ts'
import type { Alert } from '../shared/types.ts'
import type { Grant } from '../server/core/mailbox.ts'

async function fixture(work: (f: ReturnType<typeof setup>) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-commands-')), source = new CoreSource({ home, socket: '/unused', binary: 'hc', session: 'test', port: 0 })
  try { await work(setup(source)) } finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
}
function setup(source: CoreSource) {
  const local = source.localMachineId()
  const spaces = [['home', local, true], ['app', local, false], ['remote', 'remote', false]].map(([id, machine, home]) => ({ id: String(id), name: String(id), machine: String(machine), home: !!home, folder: '/repo', base: 'main', prefix: 'APP', mode: 'regular', added: 1 })) as CoreSpace[]
  for (const space of spaces) source.store.set('space', space.id, space)
  const actor = (space: string, role: CoreAgent['role'] = 'coordinator') => {
    const own = spaces.find(item => item.id === space)!, agent = { chat: role === 'coordinator' ? space : `APP-1/${role}`, space, machine: own.machine, role, kind: 'claude', launch: `${space}-${role}-launch`, grant: `${space}-${role}-grant`, hook: '/unused', started: 1, state: 'idle' } as CoreAgent
    source.store.set('agent', agent.chat, agent)
    const grant = { id: agent.grant, chat: agent.chat, machine: agent.machine, session: agent.launch } as Grant
    return { agent, grant, cli: (...args: string[]) => new CoreCommands(source).cli(agent, grant, args) }
  }
  return { source, actor, local }
}

test('regular settings preserve inheritance, use private machine scope and never echo private instructions', () => fixture(async f => {
  const c = f.actor('app')
  await c.cli('set', 'tasks.archiveAfter', '5 days')
  await c.cli('set', 'tasks.archiveAfter', '3 days', '--machine')
  await c.cli('set', 'tasks.archiveAfter', '1 day', '--space', 'app')
  expect(f.source.settings.get('tasks.archiveAfter', 'app')).toBe('1 day')
  expect((await c.cli('show', '--section', 'Tasks'))?.out).toContain('from app')
  await c.cli('unset', 'tasks.archiveAfter', '--space', 'app')
  expect(f.source.settings.get('tasks.archiveAfter', 'app')).toBe('3 days')
  await c.cli('unset', 'tasks.archiveAfter', '--machine')
  expect(f.source.settings.get('tasks.archiveAfter', 'app')).toBe('5 days')
  const reply = await c.cli('set', 'coordinator.instructions', 'Private instruction body', '--space', 'app')
  expect(reply?.out).not.toContain('Private instruction body')
  expect((await c.cli('show'))?.out).not.toContain('Private instruction body')
  await expect(c.cli('set', 'tasks.archiveAfter', '0 days')).rejects.toThrow('Choose')
  await expect(c.cli('set', 'tasks.archiveAfter', '1 day', '--space', 'remote')).rejects.toThrow('your machine')
  await expect(c.cli('set', 'tasks.archiveAfter', '1 day', '--space', 'app', '--machine')).rejects.toThrow('not both')
}))

test('settings refuse worker mutation, forged or stale identity, and unknown controls; model reads stay in scope', () => fixture(async f => {
  const c = f.actor('app'), worker = f.actor('app', 'task')
  await expect(worker.cli('set', 'tasks.archiveAfter', '1 day')).rejects.toThrow('Only a regular coordinator')
  await expect(worker.cli('show', '--machine')).rejects.toThrow('own space')
  await expect(c.cli('models', 'pi')).rejects.toThrow('Claude Code or Codex')
  expect(JSON.parse((await c.cli('models', 'codex'))!.out).map((cli: { kind: string }) => cli.kind)).toEqual(['codex'])
  const commands = new CoreCommands(f.source)
  await expect(commands.cli({ ...c.agent, machine: 'remote' }, c.grant, ['set', 'tasks.archiveAfter', '1 day', '--machine'])).rejects.toThrow('current')
  await expect(commands.cli({ ...c.agent, chat: worker.agent.chat }, c.grant, ['show'])).rejects.toThrow('current')
  f.source.store.set('agent', c.agent.chat, { ...c.agent, launch: 'new' })
  await expect(c.cli('set', 'tasks.archiveAfter', '1 day')).rejects.toThrow('current')
  expect(f.source.settings.get('tasks.archiveAfter', 'app')).toBe('7 days')
}))

test('heartbeat settings return plain schedule words and plans do not enter settings routing', () => fixture(async f => {
  const c = f.actor('app')
  expect((await c.cli('set', 'heartbeat.when', 'FREQ=MINUTELY;INTERVAL=15', '--space', 'app'))?.out).toContain('In words:')
  expect((await c.cli('set', 'heartbeat.on', 'failed', '--space', 'app'))?.out).toContain('In words:')
  expect(await c.cli('plan', '--step', 'Work')).toBeUndefined()
}))

test('main-home task alerts keep current question actions while core reconnects without widening mutation scope', () => fixture(async f => {
  const home = f.actor('home'), project = f.actor('app'), worker = f.actor('remote', 'task')
  const task = { id: 'box/REMOTE-1', localId: 'REMOTE-1', place: 'remote', machine: 'remote', chat: worker.agent.chat, name: 'Remote task', kind: 'claude', workflow: 'working', base: 'main', age: 'now' } as CoreTask
  f.source.store.set('task', task.id, task)
  const question = { id: 'question', title: 'Allow the harmless step?', choices: [{ label: 'Allow once' }, { label: 'Deny' }] }
  f.source.store.set('question', question.id, { id: question.id, chat: task.chat, grant: worker.agent.grant, question, answered: false })
  f.source.connected = () => false // an authenticated unanswered card still waits on the human
  const alerts: Alert[] = []
  f.source.requirePlugin = () => {}
  f.source.on('alert', alert => alerts.push(alert))
  await home.cli('alert', 'Needs your answer', '--body', 'Read the card', '--task', task.id)
  expect(alerts).toHaveLength(1)
  expect(alerts[0]).toMatchObject({ go: { place: 'remote', task: task.id, focus: question.id }, tag: task.id, task: true, card: { chat: task.chat, question: question.id, choices: [{ label: 'Allow once', choice: 0 }, { label: 'Deny', choice: 1 }] } })
  expect(alerts[0]!.body).toContain('Allow once')
  await expect(project.cli('alert', 'No', '--task', task.id)).rejects.toThrow('cannot read')
  await expect(home.cli('alert', 'No', '--task', 'missing')).rejects.toThrow('cannot read')
  f.source.store.set('agent', task.chat, { ...worker.agent, grant: 'replacement' })
  await home.cli('alert', 'Fresh alert', '--task', task.id)
  expect(alerts[1]!.card).toBeUndefined()
  expect(f.source.store.get('question', question.id)).toMatchObject({ answered: false })
}))
