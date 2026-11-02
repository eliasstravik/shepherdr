import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { PilotRecords } from '../helper/core-pilot-records.ts'
import { pilotInventory } from '../helper/core-pilot-inventory.ts'
import { CorePilotUsage, pilotReportedUsage } from '../server/core/pilot-usage.ts'
import { CoreSource } from '../server/core/source.ts'
import type { CoreAgent, CoreSpace } from '../server/core/model.ts'
import { runChild } from './child.ts'

const line = (type: string, payload: unknown) => JSON.stringify({ type, timestamp: '2026-10-30T00:00:00Z', payload }) + '\n'
const capture = (records: PilotRecords, file: string, text: string) => records.write({ file, identity: '1:2:0', reset: true, offset: 0, data: Buffer.from(text).toString('base64') })

test('capture inventory pages privately, preserves native primary metadata and rejects traversal', () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-inventory-')), records = new PilotRecords(root)
  try {
    for (let n = 0; n < 130; n++) capture(records, `.codex/sessions/${n}.jsonl`, line('session_meta', { id: randomUUID(), cwd: '/approved', source: n ? 'cli' : { subagent: 'other' } }))
    const first = pilotInventory(root)
    expect(first.files).toHaveLength(128); expect(first.more).toBe(true)
    expect(first.files[0].session).toBeUndefined()
    expect(first.files[1].session).toMatchObject({ cwd: '/approved', source: 'cli' })
    expect(pilotInventory(root, first.next).files).toHaveLength(2)
    expect(() => pilotInventory(root, -1)).toThrow('Invalid')
    expect(() => capture(records, '.codex/sessions/../../outside.jsonl', '{}\n')).toThrow('Invalid')
  } finally { records.close(); rmSync(root, { recursive: true, force: true }) }
})

test('native usage includes helpers, survives reader restart, and discovers only this launch’s primary CLI log', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-usage-')), captures = join(root, 'captures'); mkdirSync(captures, { mode: 0o700 })
  const records = new PilotRecords(captures), source = new CoreSource({ home: join(root, 'app'), socket: '/unused', session: 'isolated', binary: 'hc', port: 0 })
  let now = 10000
  try {
    const machine = source.localMachineId(), space: CoreSpace = { id: 'space', machine, name: 'space', folder: '/approved', base: 'main', prefix: 'EX', mode: 'regular', added: 1 }
    source.store.set('space', space.id, space)
    const run = source.pilots.policy.begin(space.id, machine, { harness: { kind: 'codex' }, reviewer: { kind: 'claude' }, parallel: 1, hosts: ['chatgpt.com'], secrets: [], approvals: [], tokens: 120 })
    const agent: CoreAgent = { chat: space.id, space: space.id, machine, role: 'coordinator', kind: 'codex', launch: 'launch', grant: 'grant', hook: '/unused', started: 1, state: 'starting', pilot: { run: run.id, home: '/inside', captures } }
    source.store.set('agent', agent.chat, agent); source.store.set('pilot-capture', agent.launch, agent)
    source.pilots.policy.activate(run.id, { chat: agent.chat, launch: agent.launch, role: agent.role })
    capture(records, '.codex/sessions/helper.jsonl', line('session_meta', { id: randomUUID(), cwd: '/approved', source: { subagent: 'spawn' } }) + line('event_msg', { type: 'token_count', info: { last_token_usage: { total_tokens: 50 } } }))
    capture(records, '.codex/sessions/wrong-project.jsonl', line('session_meta', { id: randomUUID(), cwd: '/outside', source: 'cli' }))
    capture(records, '.codex/sessions/main.jsonl', line('session_meta', { id: randomUUID(), cwd: '/approved', source: 'cli' }) + line('event_msg', { type: 'token_count', info: { last_token_usage: { total_tokens: 100 } } }))
    const helperUsage = JSON.stringify({ type: 'assistant', isSidechain: true, uuid: randomUUID(), message: { id: 'msg-helper-usage', role: 'assistant', usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 5, output_tokens: 5 }, content: [{ type: 'text', text: 'A native helper reply' }] } }) + '\n'
    capture(records, '.claude/projects/repo/subagents/agent-helper.jsonl', helperUsage)
    // A parent-side copy of that provider message must not count its helper twice.
    capture(records, '.claude/projects/repo/parent.jsonl', helperUsage)
    source.agents.browserRuntime = async () => ({ root: join(import.meta.dir, '..'), bun: process.execPath, bin: '/unused', sessions: '/unused' })
    source.files.exec = async (_machine, argv, cwd, input) => runChild(argv, { cwd, input })
    const usage = new CorePilotUsage(source, () => now)
    await usage.observe(agent)
    expect(source.agents.get(agent.chat)?.transcript).toBe(join(captures, '.codex/sessions/main.jsonl'))
    expect(source.pilots.policy.get(run.id)?.used).toBe(175)
    now += 2000; await usage.observe(agent)
    expect(source.pilots.policy.get(run.id)?.used).toBe(175)
    await new CorePilotUsage(source, () => now).observe(source.agents.get(agent.chat)!)
    expect(source.pilots.policy.get(run.id)?.used).toBe(175)
    expect(() => source.pilots.policy.live(run.id)).toThrow('reported token allowance')
    // A replaced chat must not lose delayed usage from the earlier private capsule journal.
    source.store.set('agent', agent.chat, { ...agent, launch: 'replacement', pilot: undefined })
    await new CorePilotUsage(source, () => now).poll()
    expect(source.pilots.policy.get(run.id)?.used).toBe(175)
    expect(source.agents.get(agent.chat)?.transcript).toBeUndefined()
    const replacement = line('session_meta', { id: randomUUID(), cwd: '/approved', source: { subagent: 'spawn' } }) + line('event_msg', { type: 'token_count', info: { last_token_usage: { total_tokens: 80 } } })
    records.write({ file: '.codex/sessions/helper.jsonl', identity: '1:2:1', reset: true, offset: 0, data: Buffer.from(replacement).toString('base64') })
    now += 2000; await new CorePilotUsage(source, () => now).observe(agent)
    expect(source.pilots.policy.get(run.id)?.used).toBe(255)
  } finally { source.stop(); records.close(); source.mailbox.close(); source.store.close(); rmSync(root, { recursive: true, force: true }) }
})

test('invalid JSON values do not abort later valid usage in a native batch', () => {
  const file = '/captures/.claude/projects/subagents/agent.jsonl'
  const values = ['null', '[]', '5', JSON.stringify({ type: 'assistant', isSidechain: true, message: { id: 'msg-native', usage: { input_tokens: 10, output_tokens: 2 } } })]
  expect(values.map((text, n) => pilotReportedUsage(file, text, n, '1:2:0')).filter(Boolean)).toEqual([{ id: 'claude:msg-native', tokens: 12 }])
})
