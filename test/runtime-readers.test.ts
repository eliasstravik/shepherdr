// What Claude Code and Codex record about what really runs. Each line is a real record, cut down to the fields read.
import { expect, test } from 'bun:test'
import { ClaudeReader } from '../server/common/readers/claude.ts'
import { CodexReader } from '../server/common/readers/codex.ts'
import type { Reader } from '../server/common/readers/types.ts'
import { speedWord } from '../shared/models.ts'

const at = '2026-10-30T20:05:29.899Z', time = Date.parse(at)
const runtimes = (reader: Reader, ...records: object[]) =>
  reader.parse(records.map((r, offset) => ({ text: JSON.stringify(r), offset })), 'log.jsonl').flatMap((e) => (e.kind === 'runtime' ? [{ runtime: e.runtime, replace: e.replace }] : []))

const claudeLine = (extra: object, usage: object = { service_tier: 'standard', speed: 'standard' }) => ({
  type: 'assistant', sessionId: 's', uuid: 'u', timestamp: at, isSidechain: false, effort: 'medium', perTurnEffort: 'medium', requestedModel: 'claude-opus-5-5',
  message: { id: 'm', role: 'assistant', model: 'claude-opus-5-5', usage, content: [{ type: 'text', text: 'ok' }] },
  ...extra,
})
const command = (type: 'user' | 'system', said: string) => {
  const content = `<local-command-stdout>${said}</local-command-stdout>`
  return type === 'user'
    ? { type, sessionId: 's', uuid: 'c', timestamp: at, message: { role: 'user', content } }
    : { type, subtype: 'local_command', sessionId: 's', uuid: 'c', timestamp: at, content, level: 'info' }
}

test('a Claude Code reply says its model, effort and speed', () => {
  expect(runtimes(new ClaudeReader(), claudeLine({}))).toEqual([{ runtime: { model: 'claude-opus-5-5', effort: 'medium', speed: 'normal', source: 'session', at: time }, replace: undefined }])
  expect(runtimes(new ClaudeReader(), claudeLine({}, { speed: 'fast' }))[0].runtime.speed).toBe('fast')
})

test('an older Claude Code reply without effort or speed only reports its model', () => {
  expect(runtimes(new ClaudeReader(), claudeLine({ effort: undefined }, {}))[0].runtime).toEqual({ model: 'claude-opus-5-5', source: 'session', at: time })
})

test('a subagent or a made-up reply says nothing about the main session', () => {
  expect(runtimes(new ClaudeReader(), claudeLine({ isSidechain: true }))).toEqual([])
  const synthetic = claudeLine({}); synthetic.message.model = '<synthetic>'
  expect(runtimes(new ClaudeReader(), synthetic)).toEqual([])
})

test("Claude Code's own /model, /effort and /fast change what shows before its next reply", () => {
  const said = (type: 'user' | 'system', words: string) => runtimes(new ClaudeReader(), { type: 'system', sessionId: 's', timestamp: at }, command(type, words))[0]?.runtime
  expect(said('user', 'Set model to `Haiku 5.5` and saved as your default for new sessions')).toMatchObject({ model: 'Haiku 5.5' })
  expect(said('user', 'Set effort level to high (saved as your default for new sessions): Comprehensive implementation')).toMatchObject({ effort: 'high' })
  expect(said('system', 'Fast mode ON')).toMatchObject({ speed: 'fast' })
  expect(said('system', 'Fast mode OFF')).toMatchObject({ speed: 'normal' })
  expect(said('user', 'Current model: Opus 5.5')).toBeUndefined()
  expect(said('user', 'Fast mode OFF\nFast mode is unavailable on this model')).toMatchObject({ speed: 'normal' })
  expect(said('user', 'Set model to `Sonnet 5.5`\nFast mode OFF')).toMatchObject({ model: 'Sonnet 5.5', speed: 'normal' })
})

const codexContext = (effort: string | null) => ({ timestamp: at, type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort, collaboration_mode: { settings: { model: 'gpt-6.1-sol', reasoning_effort: effort } } } })
const codexSettings = (tier: string | null, effort?: string) => ({ timestamp: at, type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'gpt-6.1-sol', model_provider_id: 'openai', service_tier: tier, reasoning_effort: effort ?? null, approval_policy: 'never' } } })

test("Codex's priority tier is Fast, whatever its config calls it, and its default is Normal", () => {
  expect(runtimes(new CodexReader(), codexSettings('priority'))[0]).toEqual({ replace: true, runtime: { model: 'gpt-6.1-sol', effortDefault: true, speed: 'fast', source: 'session', at: time } })
  expect(runtimes(new CodexReader(), codexSettings('default'))[0].runtime.speed).toBe('normal')
  expect(runtimes(new CodexReader(), codexSettings(null))[0].runtime.speed).toBe('normal')
})

test('Codex records an effort only when one is set: without one its model default runs', () => {
  expect(runtimes(new CodexReader(), codexContext(null))[0].runtime).toEqual({ model: 'gpt-6.1-sol', effortDefault: true, source: 'session', at: time })
  expect(runtimes(new CodexReader(), codexContext('high'))[0].runtime).toEqual({ model: 'gpt-6.1-sol', effort: 'high', source: 'session', at: time })
  expect(runtimes(new CodexReader(), codexSettings('priority', 'low'))[0].runtime).toMatchObject({ effort: 'low', speed: 'fast' })
})

test('speeds read in plain words, and an unknown one stays as logged', () => {
  expect(['standard', 'default', 'priority', 'fast', 'Ultrafast', 'flex', '', null].map(speedWord)).toEqual(['normal', 'normal', 'fast', 'fast', 'ultrafast', 'flex', undefined, undefined])
})
