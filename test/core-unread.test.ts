import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreUnread } from '../server/core/unread.ts'
import { CoreSource } from '../server/core/source.ts'
import { attentionCounts } from '../src/attention.ts'

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'core-unread-'))
  const source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  return { source, home, close() { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) } }
}
test('read marks advance monotonically, clamp future marks, and persist across server instances', () => {
  const f = fixture()
  try {
    const at = Date.now() + 100
    expect(f.source.unread.saw('coordinator', at)).toBe(true)
    expect(f.source.unread.saw('coordinator', at - 1)).toBe(false)
    expect(f.source.unread.saw('coordinator', NaN)).toBe(false)
    f.source.unread.mark({ coordinator: at, '*': 9e15, unknown: 9e15 })
    f.source.unread.mark({ coordinator: at - 10 })
    const baseline = f.source.unread.read()['*']
    f.source.unread.saw('coordinator', at + 1)
    expect(f.source.unread.read().coordinator).toBe(at)
    f.source.unread.mark({ coordinator: 9e15 })
    const restarted = new CoreUnread(f.source.store)
    expect(restarted.read().coordinator).toBe(at + 1)
    expect(restarted.read()['*']).toBe(baseline)
    expect(restarted.read().unknown).toBeUndefined()
  } finally { f.close() }
})
test('human sends stay quiet; incoming messages advance unread and only coordinator text produces message alerts', async () => {
  const f = fixture(), at = Date.now() + 100, alerts: unknown[] = []
  try {
    const space = { id: 'p:machine:demo', name: 'demo', machine: 'machine', folder: '/repo', prefix: 'DEMO', mode: 'regular', added: 1 }
    f.source.store.set('space', space.id, space)
    f.source.on('alert', alert => alerts.push(alert))
    f.source.post(space.id, { id: 'human', who: 'you', text: 'hello', at })
    expect(f.source.snapshot().last![space.id]).toBeUndefined()
    f.source.logs.outgoing(space.id, { id: 'native', who: 'agent', text: 'reply', at: at + 1 })
    expect(f.source.snapshot().last![space.id]).toBe(at + 1); expect(alerts).toHaveLength(1)
    f.source.post(space.id, { id: 'card', who: 'agent', card: { id: 'card', status: 'work', text: 'task news' }, at: at + 2 })
    f.source.post('task/Agent', { id: 'task', who: 'agent', text: 'task reply', at: at + 3 })
    expect(alerts).toHaveLength(1)
    await f.source.act({ type: 'read', chats: { [space.id]: at + 2 } })
    expect(f.source.snapshot().read![space.id]).toBe(at + 2)
    f.source.settings.set('notify', 'Off', space.id)
    expect(f.source.snapshot().settings.find(section => section.name === 'Notify' && section.level === space.id)?.rows[0].value).toBe('Off')
  } finally { f.close() }
})
test('multiple original coordinator questions count separately; expired or replaced permissions do not count', () => {
  const f = fixture(), at = Date.now()
  try {
    const space = { id: 'p:machine:demo', name: 'demo', machine: 'machine', folder: '/repo', prefix: 'DEMO', mode: 'regular', added: 1 }
    f.source.store.set('space', space.id, space)
    f.source.store.set('agent', space.id, { chat: space.id, space: space.id, machine: space.machine, role: 'coordinator', grant: 'current', launch: 'one', kind: 'claude', started: 1, state: 'idle' })
    for (const id of ['q1', 'q2']) f.source.store.set('question', id, { id, chat: space.id, grant: 'current', answered: false, question: { id, title: id, choices: [] } })
    for (const [id, grant, expires] of [['expired', 'current', at - 1], ['replaced', 'old', at + 60000]] as const) f.source.store.set('permission', id, { id, chat: space.id, grant, expires, settled: false,
      question: { id, title: id, choices: [{ label: 'Allow once' }, { label: 'Deny' }], to: space.id } })
    const snapshot = f.source.snapshot()
    expect(snapshot.needs.map(need => need.id)).toEqual(['q1', 'q2'])
    expect(attentionCounts(snapshot, [space.id])).toEqual({ need: 2, ready: 0 })
    f.source.store.set('agent', space.id, { chat: space.id, space: space.id, machine: space.machine, role: 'coordinator', grant: 'replacement', launch: 'two', kind: 'claude', started: 1, state: 'idle' })
    expect(f.source.snapshot().asks[space.id]).toBeUndefined()
  } finally { f.close() }
})
