import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreSource } from '../server/core/source.ts'
import { CoreHeartbeats } from '../server/core/heartbeats.ts'
import type { CoreAgent, CoreSpace } from '../server/core/model.ts'

test('heartbeat checklists persist in the explicit core home and cannot cross machine authority', () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-beats-')), source = new CoreSource({ home, port: 17887, binary: 'hc', session: 'test', socket: '/unused' })
  const space = { id: 'p:one:demo', name: 'demo', machine: 'one', home: false } as CoreSpace
  const other = { id: 'p:two:demo', name: 'demo', machine: 'two', home: false } as CoreSpace
  const agent = { role: 'coordinator', machine: 'one', space: space.id } as CoreAgent
  try {
    source.store.set('space', space.id, space); source.store.set('space', other.id, other)
    expect(source.heartbeats.read(space)).toContain('Tasks stuck or stalled')
    source.heartbeats.cli(agent, ['heartbeat', 'set'], '# Heartbeat\n\n- CHECKLIST_OK')
    expect(new CoreHeartbeats(source).read(space)).toBe('# Heartbeat\n\n- CHECKLIST_OK\n')
    expect(source.heartbeats.read(other)).not.toContain('CHECKLIST_OK')
    expect(() => source.heartbeats.cli(agent, ['heartbeat', 'set', other.id], 'wrong machine')).toThrow('Choose a space')
    expect(() => source.heartbeats.cli({ ...agent, role: 'task' }, ['heartbeat', 'set'], 'wrong role')).toThrow('Only a coordinator')
    expect(() => source.heartbeats.cli(agent, ['heartbeat', 'set'])).toThrow('stdin')
    expect(() => source.heartbeats.write(space, 'x'.repeat(65537))).toThrow('64 KiB')
    source.heartbeats.cli(agent, ['heartbeat', 'set'], '')
    expect(new CoreHeartbeats(source).read(space)).toBe('')
    expect(source.heartbeats.cli(agent, ['heartbeat'])).toContain('Autopilot is off')
  } finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
})

test('heartbeat held news, cursor and empty checklist survive restart without extra wakes', () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-beats-')), source = new CoreSource({ home, port: 17887, binary: 'hc', session: 'test', socket: '/unused' })
  const space = { id: 'p:one:demo', name: 'demo', machine: 'one' } as CoreSpace
  try {
    source.store.set('space', space.id, space)
    source.heartbeats.write(space, '')
    source.heartbeats.model.switched(space.id, true, 1000)
    source.heartbeats.model.hold(space.id, 'NEWS_OK')
    const resumed = new CoreHeartbeats(source)
    expect(resumed.model.last(space.id)).toBe(1000)
    expect(resumed.model.beat(space.id, 'space', 2000)).toContain('NEWS_OK')
    expect(resumed.model.beat(space.id, 'space', 3000)).toBeUndefined()
    expect(new CoreHeartbeats(source).model.last(space.id)).toBe(3000)
  } finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
})
