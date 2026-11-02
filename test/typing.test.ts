// The typing dots follow the agent's real status: on while it works on a reply, off when it stops, waits on the human
// or only its background work runs.
import { describe, expect, test } from 'bun:test'
import { typing } from '../plugins/chat/typing.ts'
import type { LogEvent } from '../server/common/readers/types.ts'
import type { Chat, Message, Question } from '../shared/types.ts'

const chat = (working: boolean | undefined, messages: Message[] = [], more: Partial<Chat> = {}): Chat => ({ key: 'c', cli: 'Claude Code', messages, working, ...more })
const q = (sent?: number): Question => ({ id: 'q', title: 'Rerun CI?', kind: 'Question', choices: [{ label: 'Yes' }, { label: 'No' }], to: 'x', sent })

describe('typing dots', () => {
  test('on while the agent works, whether you wrote or it started on its own', () => {
    expect(typing(chat(true, [{ id: '1', who: 'you', text: 'Go' }]))).toBe(true)
    expect(typing(chat(true, [{ id: '1', who: 'agent', text: 'Done.' }]))).toBe(true)
    expect(typing(chat(true))).toBe(true)
  })
  test('off once it is idle, blocked or finished', () => {
    expect(typing(chat(undefined, [{ id: '1', who: 'you', text: 'Go' }]))).toBe(false)
    expect(typing(chat(true, [], { finished: true }))).toBe(false)
  })
  test('off while its last card waits on the human; on again once answered', () => {
    expect(typing(chat(true, [{ id: '1', who: 'agent', question: q() }]))).toBe(false)
    expect(typing(chat(true, [{ id: '1', who: 'agent', question: q(0) }]))).toBe(true)
    // what you write while its menu is up waits under the card: still waiting on you
    expect(typing(chat(true, [{ id: '1', who: 'agent', question: q() }, { id: '2', who: 'you', text: 'hm', waiting: true }]))).toBe(false)
  })
  test('off while no message you will see is on its way', () => {
    const done = [{ id: '1', who: 'agent' as const, text: 'Research is running.' }]
    expect(typing(chat(true, done, { background: true }))).toBe(false)
  })
})
