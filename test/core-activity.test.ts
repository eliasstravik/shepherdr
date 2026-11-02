import { expect, test } from 'bun:test'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreSource } from '../server/core/source.ts'
import { outputFromLine } from '../server/activity.ts'
import type { LogEvent } from '../server/common/readers/types.ts'
import { runChild } from './child.ts'

test('native activity renders before its reply and reads only a recorded output location through core', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-activity-')), source = new CoreSource({ home: join(root, 'app'), port: 17887, session: 'test', socket: '/unused', binary: 'hc' })
  const file = join(root, 'native.jsonl'), chat = 'chat'
  const result = JSON.stringify({ message: { content: [{ type: 'tool_result', tool_use_id: 'step', content: 'NATIVE_OUTPUT_OK' }] } })
  writeFileSync(file, result + '\n' + 'SHOULD_NOT_BE_READ\n')
  source.store.set('agent', chat, { chat, machine: 'machine', kind: 'claude', launch: 'one', grant: 'grant', hook: '/unused', started: 1, state: 'idle' })
  source.agents.bun = async () => process.execPath
  let calls = 0
  source.files.exec = async (_machine, argv, cwd, input) => {
    calls++
    return runChild(argv, { cwd, input })
  }
  const events: LogEvent[] = [
    { kind: 'turn-start', id: 'turn', at: 1 },
    { kind: 'step', id: 'step', at: 2, step: 'run', tool: 'Bash', title: 'Checked example', doing: 'Checking example', target: 'example', out: { file, offset: 0 } },
    { kind: 'step-end', id: 'step', at: 3 },
    { kind: 'agent', id: 'reply', at: 4, text: 'Done' },
    { kind: 'turn-end', id: 'end', at: 5 },
  ]
  for (const event of events) source.store.set(`event:${chat}`, event.id + event.kind, event)
  try {
    const view = source.activities.chat(chat, [{ id: 'reply', who: 'agent', text: 'Done', at: 4 }], false)
    expect(view.messages[0].activity).toMatchObject({ id: 'turn', steps: 1 })
    expect(view.messages[1].id).toBe('reply')
    expect(await source.activity({ chat, what: 'turn', id: 'turn' })).toMatchObject({ steps: [{ id: 'step', output: true }] })
    expect(calls).toBe(0) // No file reads until the human opens output.
    expect(await source.activity({ chat, what: 'output', id: '/etc/passwd' })).toMatchObject({ error: expect.any(String) })
    expect(calls).toBe(0)
    expect(await source.activity({ chat, what: 'output', id: 'step' })).toEqual({ output: 'NATIVE_OUTPUT_OK', cut: undefined })
    expect(calls).toBe(1)
    const child = join(root, 'child.jsonl')
    writeFileSync(child, [
      { uuid: 'native-child-a', type: 'assistant', timestamp: '2026-10-29T12:00:00Z', message: { id: 'msg', role: 'assistant', content: [{ type: 'tool_use', id: 'child-step', name: 'Bash', input: { command: 'printf CHILD_NATIVE_OK' } }] } },
      { uuid: 'native-child-u', type: 'user', timestamp: '2026-10-29T12:00:01Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'child-step', content: 'CHILD_NATIVE_OK' }] } },
    ].map(line => JSON.stringify(line)).join('\n') + '\n')
    source.store.set(`event:${chat}`, 'job', { kind: 'job', id: 'job', at: 6, job: 'agent', title: 'Check example', log: child })
    expect(await source.activity({ chat, what: 'job', id: 'job' })).toMatchObject({ steps: [{ id: 'child-step', output: true }] })
    expect(await source.activity({ chat, what: 'output', id: 'child-step' })).toMatchObject({ output: 'CHILD_NATIVE_OK' })
    const history = join(root, 'large-child.jsonl')
    const padding = JSON.stringify({ type: 'progress', padding: 'x'.repeat(5 * 1024 * 1024) }) + '\n'
    const childStep = (id: string) => [
      { uuid: id, type: 'assistant', timestamp: '2026-10-29T12:00:02Z', message: { id, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'printf CHILD_LARGE_OK' } }] } },
      { uuid: id + '-result', type: 'user', timestamp: '2026-10-29T12:00:03Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'CHILD_LARGE_OK' }] } },
    ].map(line => JSON.stringify(line)).join('\n') + '\n'
    writeFileSync(history, padding + childStep('large-step'))
    source.store.set(`event:${chat}`, 'large-job', { kind: 'job', id: 'large-job', at: 7, job: 'agent', title: 'Large child', log: history })
    expect(await source.activity({ chat, what: 'job', id: 'large-job' })).toMatchObject({ steps: [], catchingUp: true })
    expect(await source.activity({ chat, what: 'job', id: 'large-job' })).toMatchObject({ steps: [{ id: 'large-step', output: true }] })
    expect(await source.activity({ chat, what: 'output', id: 'large-step' })).toMatchObject({ output: 'CHILD_LARGE_OK' })
    appendFileSync(history, childStep('appended-step'))
    expect(await source.activity({ chat, what: 'job', id: 'large-job' })).toMatchObject({ steps: [{ id: 'large-step' }, { id: 'appended-step' }] })
    const large = join(root, 'shell.output')
    writeFileSync(large, 'x'.repeat(300000) + '\ndone\n')
    source.store.set(`event:${chat}`, 'shell-job', { kind: 'job', id: 'shell-job', at: 7, job: 'shell', title: 'Example', output: large })
    expect(await source.activity({ chat, what: 'job', id: 'shell-job' })).toMatchObject({ output: 'done', cut: true })
    source.store.delete(`event:${chat}`, 'endturn-end')
    expect(source.activities.chat(chat, [], false).live).toBeUndefined()
    expect(source.activities.chat(chat, [], true).live).toMatchObject({ id: 'turn' })
  } finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(root, { recursive: true, force: true }) }
})

test('headless native Codex output is decoded from its recorded event envelope', () => {
  expect(outputFromLine(JSON.stringify({ at: 1, event: { type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'REVIEW_OUTPUT_OK' } } }), 'step')).toBe('REVIEW_OUTPUT_OK')
})
