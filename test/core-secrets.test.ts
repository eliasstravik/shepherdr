import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreSource } from '../server/core/source.ts'
import type { CoreAgent, CoreSpace } from '../server/core/model.ts'

async function fixture(run: (source: CoreSource, agent: CoreAgent) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-secrets-'))
  const source = new CoreSource({ home, port: 17887, session: 'test', socket: '/unused', binary: 'hc' })
  const space = { id: 'p:machine:one', name: 'one', machine: 'machine', folder: '/unused', base: 'main', prefix: 'ONE', mode: 'regular', added: 1 } as CoreSpace
  const agent: CoreAgent = { chat: space.id, space: space.id, machine: space.machine, role: 'coordinator', kind: 'claude', launch: 'launch', grant: 'grant', hook: '/unused', started: 1, state: 'idle' }
  source.store.set('space', space.id, space); source.store.set('agent', agent.chat, agent)
  try { await run(source, agent) }
  finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
}

test('secret use derives scope from the authenticated session, ignoring claimed levels', async () => fixture(async (source, agent) => {
  source.secrets.vault.set('all', 'KEY', 'everywhere-test-value')
  source.secrets.vault.set('p:machine:other', 'KEY', 'other-space-test-value')
  source.secrets.vault.set(agent.space, 'KEY', 'own-space-test-value')
  expect(source.secrets.use(agent, { names: ['KEY'], level: 'p:machine:other', chat: 'other' })).toEqual({ secrets: { KEY: 'own-space-test-value' } })
  expect(() => source.secrets.use({ ...agent, role: 'reviewer' }, { names: ['KEY'] })).toThrow('Reviewers')
  expect(JSON.stringify(source.snapshot())).not.toContain('own-space-test-value')
  expect(JSON.stringify(source.snapshot())).not.toContain('other-space-test-value')
}))

test('secret cards expire on replacement and save only names into chat and delivery records', async () => fixture(async (source, agent) => {
  await source.secrets.cli(agent, ['secret', 'ask', 'DEMO_KEY', '--why', 'Isolated acceptance'])
  const message = source.logs.messages(agent.chat).find(item => item.secret)!
  source.store.set('agent', agent.chat, { ...agent, grant: 'replacement' })
  await expect(source.secrets.act({ type: 'secret', level: agent.space, name: 'DEMO_KEY', value: 'synthetic-value-one', card: { chat: agent.chat, id: message.id } })).rejects.toThrow('expired session')
  expect(source.secrets.vault.has(agent.space, 'DEMO_KEY')).toBe(false)
  source.store.set('agent', agent.chat, agent)
  await source.secrets.act({ type: 'secret', level: agent.space, name: 'DEMO_KEY', value: 'synthetic-value-one', card: { chat: agent.chat, id: message.id } })
  expect(source.logs.messages(agent.chat).find(item => item.id === message.id)?.secret?.saved).toBe('one')
  const records = JSON.stringify(source.store.db.query('SELECT * FROM records').all())
  expect(records).not.toContain('synthetic-value-one')
  expect(records).toContain('DEMO_KEY')
}))

test('a secret saved in Settings closes every card it reaches, and only those', async () => fixture(async (source, agent) => {
  const other: CoreAgent = { ...agent, chat: 'ONE-1/Agent', role: 'task', launch: 'second', grant: 'second' }
  source.store.set('agent', other.chat, other)
  const alerts: { clear?: boolean }[] = []
  source.on('alert', alert => alerts.push(alert as { clear?: boolean }))
  await source.secrets.cli(agent, ['secret', 'ask', 'DEMO_KEY', '--why', 'First'])
  await source.secrets.cli(other, ['secret', 'ask', 'DEMO_KEY', '--why', 'Second'])
  await source.secrets.cli(agent, ['secret', 'ask', 'OTHER_KEY', '--why', 'Unrelated'])
  source.store.set('space', 'p:machine:two', { id: 'p:machine:two', name: 'two', machine: 'other-machine', folder: '/unused', base: 'main', prefix: 'TWO', mode: 'regular', added: 1 } as CoreSpace)
  await source.secrets.act({ type: 'secret', level: 'p:machine:two', name: 'DEMO_KEY', value: 'out-of-reach' })
  expect(source.secrets.open()).toHaveLength(3)
  await source.secrets.act({ type: 'secret', level: 'all', name: 'DEMO_KEY', value: 'synthetic-value' })
  expect(source.secrets.open().map(request => request.ask.name)).toEqual(['OTHER_KEY'])
  for (const chat of [agent.chat, other.chat]) expect(source.logs.messages(chat).find(item => item.secret?.name === 'DEMO_KEY')?.secret?.saved).toBe('Everywhere')
  expect(source.store.all<{ id: string; text: string }>('pending-send').filter(item => item.id.startsWith('secret-saved-')).map(item => item.text.includes('DEMO_KEY'))).toEqual([true, true])
  expect(alerts.filter(alert => alert.clear)).toHaveLength(2)
}))

test('corrupt vault diagnostics never echo stored material', async () => fixture(async (source) => {
  const fs = await import('node:fs')
  fs.writeFileSync(join(source.config.home, 'vault.json'), 'DO_NOT_DISCLOSE invalid JSON', { mode: 0o600 })
  expect(() => source.secrets.vault.pick(['KEY'], ['all'])).toThrow('fix or move')
  try { source.secrets.vault.pick(['KEY'], ['all']) } catch (error) { expect(String(error)).not.toContain('DO_NOT_DISCLOSE') }
}))


test('an older helper receives the owning launch command path, never secret values', async () => fixture(async (source, agent) => {
  agent.command = '/private/current/helper/bin/shepherdr'
  source.store.set('agent', agent.chat, agent)
  source.secrets.vault.set(agent.space, 'DEMO', 'synthetic-value')
  await expect(source.secrets.cli(agent, ['secret', 'run', 'DEMO'])).rejects.toThrow('/private/current/helper/bin/shepherdr')
  try { await source.secrets.cli(agent, ['secret', 'run', 'DEMO']) } catch (error) { expect(String(error)).not.toContain('synthetic-value') }
}))

test('human operator set and removal preserve scope, reject command-word values, and are not mailbox verbs', async () => fixture(async (source, agent) => {
  source.localMachineId = () => agent.machine
  source.store.set('name', agent.space, 'renamed-one')
  await source.secrets.operator(['secret', 'set', 'KEY', '--space', 'renamed-one'], 'scoped-fixture\n')
  expect(source.secrets.use(agent, { names: ['KEY'] }).secrets.KEY).toBe('scoped-fixture')
  await expect(source.secrets.operator(['secret', 'set', 'KEY', 'never-a-value'], 'replacement')).rejects.toThrow('Use secret')
  await expect(source.secrets.cli(agent, ['secret', 'set', 'KEY'])).rejects.toThrow('Settings')
  await expect(source.secrets.operator(['secret', 'set', 'KEY', '--space', 'missing'], 'replacement')).rejects.toThrow('Choose a space')
  await expect(source.secrets.operator(['secret', 'set', 'KEY', '--machine', '--space', 'one'], 'replacement')).rejects.toThrow('Use secret')
  await source.secrets.operator(['secret', 'set', 'KEY'], 'global-fixture')
  await source.secrets.operator(['secret', 'rm', 'KEY', '--space', 'renamed-one'])
  expect(source.secrets.use(agent, { names: ['KEY'] }).secrets.KEY).toBe('global-fixture')
  await source.secrets.operator(['secret', 'remove', 'KEY'])
  expect(() => source.secrets.use(agent, { names: ['KEY'] })).toThrow('No secret')
  expect(JSON.stringify(source.store.db.query('SELECT * FROM records').all())).not.toContain('scoped-fixture')
}))
