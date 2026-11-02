import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreSource } from '../server/core/source.ts'
import { CorePilotWakes } from '../server/core/pilot-wakes.ts'
import type { CoreAgent } from '../server/core/model.ts'

async function fixture(work: (f: ReturnType<typeof setup>) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-wakes-')), source = new CoreSource({ home, port: 17899, socket: '/unused', session: 'test', binary: 'hc' })
  try { await work(setup(source)) } finally { source.stop(); await Bun.sleep(0); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
}
function setup(source: CoreSource) {
  const space = { id: 'p:machine:demo', name: 'demo', folder: '/repo', machine: 'machine', base: 'main', prefix: 'DEMO', mode: 'autopilot', added: Date.now() }
  source.store.set('space', space.id, space)
  const run = source.pilots.policy.begin(space.id, space.machine, source.settings.pilot(space.id))
  const agent: CoreAgent = { chat: space.id, space: space.id, machine: space.machine, kind: 'claude', role: 'coordinator', grant: 'grant', launch: 'launch', hook: '/unused', state: 'working', started: Date.now(), pilot: { run: run.id, home: '/inside', captures: '/private' } }
  source.store.set('agent', agent.chat, agent); source.pilots.policy.activate(run.id, { chat: agent.chat, launch: agent.launch, role: 'coordinator' })
  source.agents.terminal = (() => ({ state: 'live' })) as unknown as typeof source.agents.terminal
  source.core.current.connected = true; source.machineConnected = () => true
  const sent: string[] = []
  source.agents.send = async (_chat, text) => {
    sent.push(text)
    source.store.set(`event:${space.id}`, `received-${sent.length}`, { kind: 'user', id: `received-${sent.length}`, text, at: Date.now() })
    for (const row of source.store.all<{ id: string; text: string }>('pending-send')) if (row.text === text) source.store.delete('pending-send', row.id)
  }
  return { source, space, run, agent, sent, idle() { agent.state = 'idle'; source.store.set('agent', agent.chat, agent) } }
}
test('Run now coalesces while working, survives reconstruction, and completes only after its own native receipt', () => fixture(async f => {
  f.source.pilots.wakes.request(f.space.id)
  f.source.pilots.wakes.request(f.space.id)
  const resumed = new CorePilotWakes(f.source)
  resumed.tick(); await Bun.sleep(0); expect(f.sent).toEqual([])
  f.source.store.set(`event:${f.space.id}`, 'old-end', { kind: 'turn-end', id: 'old-end', at: Date.now() + 1000 })
  f.idle(); resumed.tick(); await Bun.sleep(0)
  expect(f.sent).toHaveLength(1)
  resumed.tick()
  expect(f.source.pilots.policy.get(f.run.id)?.last?.outcome).toBe('Received by agent')
  f.source.store.set(`event:${f.space.id}`, 'own-end', { kind: 'turn-end', id: 'own-end', at: Date.now() + 2000 })
  resumed.tick()
  expect(f.source.pilots.policy.get(f.run.id)?.last?.outcome).toBe('Finished')
  expect(f.sent).toHaveLength(1)
}))
test('an interrupted wake is marked uncertain and never automatically sent twice', () => fixture(async f => {
  f.source.pilots.wakes.request(f.space.id); f.idle()
  f.source.quiescing = true
  f.source.pilots.wakes.tick()
  expect(f.sent).toEqual([])
  f.source.quiescing = false
  // Keep the native receipt pending, as if the process or socket disappeared after send.
  f.source.agents.send = async () => {}
  f.source.pilots.wakes.tick(); await Bun.sleep(0)
  const wake = f.source.store.all<{ id: string }>('pilot-wake')[0]
  f.source.store.set('pending-send', wake.id, { id: wake.id, chat: f.space.id, state: 'uncertain' })
  new CorePilotWakes(f.source).tick()
  expect(f.source.pilots.policy.get(f.run.id)?.last?.outcome).toContain('not repeated')
  expect(f.source.store.get('pilot-wake', wake.id)).toMatchObject({ state: 'uncertain' })
}))

test('an empty saved checklist does not spend a provider turn', () => fixture(async f => {
  f.source.heartbeats.write(f.source.space(f.space.id)!, '')
  f.source.pilots.wakes.request(f.space.id); f.idle()
  f.source.pilots.wakes.tick(); await Bun.sleep(0)
  expect(f.sent).toEqual([])
  expect(f.source.pilots.policy.get(f.run.id)?.last?.outcome).toBe('Skipped: empty heartbeat checklist')
}))

test('news arriving during a delivered wake is retained for one later wake rather than lost in coalescing', () => fixture(async f => {
  f.source.pilots.wakes.news({ event: 'ready', title: 'First' }, f.space.id); f.idle()
  f.source.pilots.wakes.tick(); await Bun.sleep(0)
  expect(f.sent).toHaveLength(1)
  f.source.pilots.wakes.news({ event: 'ready', title: 'Second' }, f.space.id)
  f.source.pilots.wakes.tick(); await Bun.sleep(0)
  expect(f.sent).toHaveLength(1)
  f.source.store.set(`event:${f.space.id}`, 'first-end', { kind: 'turn-end', id: 'first-end', at: Date.now() })
  f.source.pilots.wakes.tick(); f.source.pilots.wakes.tick(); await Bun.sleep(0)
  expect(f.sent).toHaveLength(2)
  expect(f.sent[1]).toContain('Second')
  expect(f.sent[1]).not.toContain('First')
}))
