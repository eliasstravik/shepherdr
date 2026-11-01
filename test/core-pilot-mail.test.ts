import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreSource } from '../server/core/source.ts'
import type { CoreAgent } from '../server/core/model.ts'
import type { CoreTerminal } from '../server/core/protocol.ts'
import type { Grant } from '../server/core/mailbox.ts'

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'shep-pilot-mail-'))
  const source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  source.store.set('space', 'space', { id: 'space', name: 'Example', machine: 'machine', folder: '/unused', prefix: 'EX', mode: 'regular', added: 1 })
  const grant = source.mailbox.issue('space', 'launch', 'machine', ['pilot'])
  const run = source.pilots.policy.begin('space', 'machine', { harness: { kind: 'claude' }, reviewer: { kind: 'codex' }, hosts: [], secrets: [], approvals: ['merge'], parallel: 1, traffic: 100 })
  const agent: CoreAgent = { chat: 'space', space: 'space', machine: 'machine', role: 'coordinator', kind: 'claude', launch: 'launch', grant: grant.id, hook: '/unused', state: 'starting', started: Date.now(), pid: 10, pilot: { run: run.id, home: '/home/inside', captures: '/private/captures', pending: true } }
  source.store.set('agent', agent.chat, agent)
  const terminal: CoreTerminal = { address: 't1', state: 'live', pid: 10, labels: {}, argv: [], cwd: '/unused', created_ms: 1, cols: 80, rows: 24 }
  source.agents.terminal = () => terminal
  const activate = () => source.pilots.policy.activate(run.id, { chat: agent.chat, launch: agent.launch, role: agent.role })
  const mail = (args: unknown, id = randomUUID(), caller: Grant = grant, record = source.agents.get(agent.chat)!) => source.pilots.mail(record, caller, { action: 'pilot', args, created: Date.now(), expires: Date.now() + 60_000 }, id)
  return { source, grant, run, agent, terminal, activate, mail, close() { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) } }
}

test('private actor lease waits for terminal-run binding; caller labels cannot establish it', async () => {
  const f = fixture()
  try {
    const lease = f.mail({ op: 'lease', role: 'coordinator', run: f.run.id })
    f.activate(); await lease
    await expect(f.mail({ op: 'lease' }, randomUUID(), { ...f.grant, id: 'forged' })).rejects.toThrow('identity')
    await expect(f.mail({ op: 'lease' }, randomUUID(), f.grant, { ...f.agent, pilot: undefined })).rejects.toThrow('identity')
    f.terminal.pid = 20
    await expect(f.mail({ op: 'lease' })).rejects.toThrow('replaced')
  } finally { f.close() }
})

test('contained traffic and hooks use the private actor and mapped capture tree', async () => {
  const f = fixture()
  try {
    f.activate()
    expect(await f.mail({ op: 'traffic', bytes: 40, run: 'forged', chat: 'other' })).toEqual({ used: 40, left: 60 })
    await f.mail({ op: 'hook', input: { hook_event_name: 'SessionStart', session_id: 'native', transcript_path: '/home/inside/.claude/projects/repo/native.jsonl', chat: 'other' } })
    expect(f.source.agents.get('space')).toMatchObject({ session: 'native', transcript: '/private/captures/.claude/projects/repo/native.jsonl', state: 'idle' })
    await expect(f.mail({ op: 'hook', input: { hook_event_name: 'PermissionRequest', tool_input: 'x'.repeat(17_000) } })).rejects.toThrow('show in full')
    expect(f.source.agents.get('space')?.state).toBe('idle')
    expect(f.source.store.all('permission')).toHaveLength(0)
    await expect(f.mail({ op: 'traffic', bytes: 61 })).rejects.toThrow('HTTPS allowance')
    expect(f.source.pilots.policy.get(f.run.id)).toMatchObject({ state: 'failed', traffic: 40 })
    await expect(f.mail({ op: 'hook', input: { hook_event_name: 'Stop' } })).rejects.toThrow('HTTPS allowance')
  } finally { f.close() }
})

test('a headless reviewer marked working can still wait for its first private binding', async () => {
  const f = fixture()
  try {
    f.activate()
    const grant = f.source.mailbox.issue('EX-1/Reviewer-1', 'review-launch', 'machine', ['pilot'])
    const agent: CoreAgent = { ...f.agent, chat: grant.chat, grant: grant.id, launch: grant.session, role: 'reviewer', state: 'working', transcriptFormat: 'codex-exec' }
    f.source.store.set('task', 'EX-1', { id: 'EX-1', chat: 'EX-1/Agent', place: 'space', machine: 'machine', pilot: f.run.id })
    f.source.store.set('agent', agent.chat, agent)
    f.source.pilots.policy.claim(f.run.id, 'EX-1', 0)
    const lease = f.mail({ op: 'lease' }, randomUUID(), grant, agent)
    f.source.pilots.policy.bind(f.run.id, { chat: agent.chat, launch: agent.launch, role: 'reviewer', task: 'EX-1' }); await lease
    expect(f.source.agents.get(agent.chat)?.pilot?.pending).toBe(false)
  } finally { f.close() }
})

test('cancellation denies both an already-open permission and a hook that arrives later', async () => {
  const f = fixture()
  try {
    f.activate()
    const id = randomUUID(), input = { op: 'hook', input: { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'example' } } }
    const waiting = f.mail(input, id)
    expect(f.source.store.get('permission', id)).toBeDefined()
    await f.mail({ op: 'cancel', id })
    expect(await waiting).toEqual({ allow: false })
    await expect(f.source.act({ type: 'answer', chat: 'space', question: id, choice: 0 })).rejects.toThrow('This card has closed')
    expect(f.source.store.get<{ allow?: boolean }>('permission', id)?.allow).toBe(false)
    const early = randomUUID()
    await f.mail({ op: 'cancel', id: early })
    expect(await f.mail(input, early)).toEqual({ allow: false })
    expect(f.source.store.get('permission', early)).toBeUndefined()
    // A different grant cannot cancel this grant's request, even if it knows its ID.
    const other = f.source.mailbox.issue('other', 'other-launch', 'machine', ['pilot'])
    const own = randomUUID(), open = f.mail(input, own)
    f.source.cancelPermission(other, own)
    expect(f.source.store.get<{ grant: string; settled?: boolean }>('permission', own)).toMatchObject({ grant: f.grant.id })
    expect(f.source.store.get<{ settled?: boolean }>('permission', own)?.settled).not.toBe(true)
    await f.mail({ op: 'cancel', id: own }); expect(await open).toEqual({ allow: false })
  } finally { f.close() }
})

test('a confirmed finished process closes its pending permission while unknown connectivity does not', async () => {
  const f = fixture()
  try {
    f.activate()
    const id = randomUUID(), waiting = f.mail({ op: 'hook', input: { hook_event_name: 'PermissionRequest', tool_name: 'Read' } }, id)
    f.source.agents.terminal = () => undefined
    f.source.post('space', { id: 'unknown', who: 'agent', text: 'resync', at: Date.now() })
    expect(f.source.store.get<{ settled?: boolean }>('permission', id)?.settled).not.toBe(true)
    f.source.agents.terminal = () => ({ ...f.terminal, state: 'finished' })
    f.source.post('space', { id: 'ended', who: 'agent', text: 'ended', at: Date.now() })
    expect(await waiting).toEqual({ allow: false })
    expect(f.source.store.get<{ question: { closed: string } }>('permission', id)?.question.closed).toContain('Agent stopped')
  } finally { f.close() }
})
