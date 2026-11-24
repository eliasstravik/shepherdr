import { expect, test } from 'bun:test'
import type { Message } from '@shared/types.ts'
import { commandMode, commandOf } from './command.ts'

test('the box runs ! lines as commands only for agents that have a shell for them', () => {
  expect(commandMode('!ls', 'claude')).toBe('run')
  expect(commandMode('! git status', 'codex')).toBe('run')
  expect(commandMode('!ls', 'gemini')).toBe('cant')
  // its agent not known yet (a chat still starting): the command goes
  expect(commandMode('!ls', undefined)).toBe('run')
  expect(commandMode('hi', 'claude')).toBe(null)
  expect(commandMode('!', 'claude')).toBe(null)
})

test("a command row's state: the log's, else how yours is going", () => {
  const out = (text: string): Message => ({ id: 'out:c1', who: 'you', cid: 'c1', text })
  expect(commandOf({ id: 'k1', who: 'you', text: '!ls', command: { state: 'failed', out: 'no' } }, {})).toBe('failed')
  expect(commandOf(out('!ls'), { pending: true })).toBe('sending')
  expect(commandOf(out('!ls'), { mark: 'sent' })).toBe('running')
  expect(commandOf(out('!ls'), { failed: 'offline' })).toBe('unsent')
  expect(commandOf(out('hello'), { mark: 'sent' })).toBe(null)
  // a plain message from the log that happens to start with ! is no command row
  expect(commandOf({ id: 'u1', who: 'you', text: '!important' }, {})).toBe(null)
})
