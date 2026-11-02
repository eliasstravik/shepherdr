import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { pilotCoreBackend } from '../helper/core-pilot-backend.ts'
import { pilotHook } from '../server/core/pilot-hook.ts'
import { toolHash, type MailCredential } from '../server/core/envelope.ts'

test('contained backend fixes its endpoint credential and cwd outside caller input', async () => {
  const credential = { version: 1, server: 'server', grant: 'grant', machine: 'machine', key: 'private' } satisfies MailCredential
  const calls: unknown[][] = [], endpoint = { binary: '/private/hc', socket: '/private/core.sock' }, signal = new AbortController().signal
  const backend = pilotCoreBackend(endpoint, credential, '/own/worktree', async (...args) => { calls.push(args); return { allow: false } })
  const id = randomUUID()
  await backend.cli(['show'], undefined, id, signal)
  await backend.cli(['heartbeat', 'set'], 'list', randomUUID(), signal)
  await backend.secret(['KEY'], randomUUID(), signal)
  await backend.hook({ hook_event_name: 'Stop', chat: 'forged', cwd: '/other' }, randomUUID(), signal)
  await backend.lease(signal); await backend.reserve(42, signal); await backend.reserve(42, signal)
  for (const call of calls) { expect(call[0]).toBe(endpoint); expect(call[1]).toBe(credential); expect((call[4] as { signal: AbortSignal }).signal).toBe(signal) }
  expect(calls[0]!.slice(2, 4)).toEqual(['cli', { args: ['show'], cwd: '/own/worktree' }])
  expect(calls[1]![3]).toEqual({ args: ['heartbeat', 'set'], cwd: '/own/worktree', stdin: 'list' })
  expect(calls[2]![3]).toEqual({ names: ['KEY'] })
  expect(calls[3]![2]).toBe('pilot')
  expect(calls[3]![3]).toEqual({ op: 'hook', input: { hook_event_name: 'Stop' } })
  expect(calls[4]![3]).toEqual({ op: 'lease' })
  expect(calls[5]![3]).toEqual({ op: 'traffic', bytes: 42 })
  expect((calls[5]![4] as { id: string }).id).not.toBe((calls[6]![4] as { id: string }).id)
})

test('contained hook mapping accepts only the chosen provider tree and strips caller authority', () => {
  const id = randomUUID(), input = { hook_event_name: 'SessionStart', transcript_path: '/home/agent/.claude/projects/repo/session.jsonl', session_id: 'native', chat: 'other', grant: 'forged' }
  const event = pilotHook(input, id, 'claude', '/home/agent', '/private/captures', 100)
  expect(event).toEqual({ id, event: 'SessionStart', at: 100, session: 'native', transcript: '/private/captures/.claude/projects/repo/session.jsonl', agent: undefined, model: undefined, tool: undefined })
  expect(pilotHook({ hook_event_name: 'Stop' }, id, 'codex', '/home/agent', '/private/captures', 101).transcript).toBeUndefined()
  for (const path of ['/etc/secret.jsonl', '/home/agent-other/.claude/projects/x.jsonl', '/home/agent/.claude/projects/../../secret.jsonl', '/home/agent/.claude/projects//x.jsonl', '/home/agent/.codex/sessions/x.jsonl', '/home/agent/.claude/projects/x.jsonl\n']) expect(() => pilotHook({ ...input, transcript_path: path }, id, 'claude', '/home/agent', '/private/captures')).toThrow()
  expect(() => pilotHook({ hook_event_name: 'Unknown' }, id, 'claude', '/home/agent', '/private/captures')).toThrow()
})

test('ordinary hooks keep the ids that tie a result to its card, never the tool input', async () => {
  const calls: unknown[][] = [], input = { command: 'secret'.repeat(100) }
  const backend = pilotCoreBackend('/private/core.sock', { version: 1, server: 'server', grant: 'grant', machine: 'machine', key: 'private' }, '/own', async (...args) => { calls.push(args); return {} })
  await backend.hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'call', turn_id: 'turn', tool_input: input }, randomUUID(), new AbortController().signal)
  const sent = (calls[0]![3] as { input: Record<string, unknown> }).input
  expect(sent).toMatchObject({ tool_use_id: 'call', turn_id: 'turn', tool_hash: toolHash(input) })
  expect(sent.tool_input).toBeUndefined()
})

test('cancelling a published hook sends a separate authenticated deny tombstone', async () => {
  const cancel = new AbortController(), id = randomUUID(), calls: unknown[][] = []
  const credential = { version: 1, server: 'server', grant: 'grant', machine: 'machine', key: 'private' } satisfies MailCredential
  const backend = pilotCoreBackend('/private/core.sock', credential, '/own', async (...args) => {
    calls.push(args)
    if ((args[3] as { op?: string }).op === 'hook') { cancel.abort(); throw Error('Published request interrupted') }
    return {}
  })
  await expect(backend.hook({ hook_event_name: 'PermissionRequest' }, id, cancel.signal)).rejects.toThrow('interrupted')
  expect(calls).toHaveLength(2)
  expect(calls[1]!.slice(1, 4)).toEqual([credential, 'pilot', { op: 'cancel', id }])
  expect((calls[1]![4] as { id: string; signal: AbortSignal }).id).not.toBe(id)
  expect((calls[1]![4] as { signal: AbortSignal }).signal.aborted).toBe(false)
})

test('ordinary hook results never enter core docs; oversized permission input is refused whole', async () => {
  const calls: unknown[][] = [], credential = { version: 1, server: 's', grant: 'g', machine: 'm', key: 'private' } satisfies MailCredential
  const backend = pilotCoreBackend('/core', credential, '/own', async (...args) => { calls.push(args); return {} })
  const signal = new AbortController().signal
  await backend.hook({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_response: 'x'.repeat(500_000), tool_input: { file: 'large' } }, randomUUID(), signal)
  expect(calls[0]![3]).toEqual({ op: 'hook', input: { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_hash: toolHash({ file: 'large' }) } })
  await expect(backend.hook({ hook_event_name: 'PermissionRequest', tool_input: 'x'.repeat(70_000) }, randomUUID(), signal)).rejects.toThrow('mailbox limit')
  await expect(backend.hook({ hook_event_name: 'PermissionRequest', tool_input: 'x'.repeat(17_000) }, randomUUID(), signal)).rejects.toThrow('show in full')
  expect(calls).toHaveLength(1)
})
