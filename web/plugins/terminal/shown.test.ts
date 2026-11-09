import { expect, test } from 'bun:test'
import { termInPlace } from './shown.ts'

// #786: a Claude Code or Codex tab switched to Chat kept showing its terminal: the Assistant's Chat | Terminal rule
// matched it too, its chat key being its terminal
test('a tab switched to Chat shows its chat, on Terminal its terminal', () => {
  expect(termInPlace({ term: 't:vm/t6', tabView: { 't:vm/t6': 'chat' } }, 't:vm/t6')).toBe(false)
  expect(termInPlace({ term: 't:vm/t6', tabView: { 't:vm/t6': 'terminal' } }, 't:vm/t6')).toBe(true)
  expect(termInPlace({ term: 't:vm/t6' }, 't:vm/t6')).toBe(true)
})

test("the Assistant's Chat | Terminal: its terminal on Terminal, its chat on Chat", () => {
  expect(termInPlace({ term: 'c:vm:shop' }, 'c:vm:shop')).toBe(true)
  expect(termInPlace({ term: null }, 'c:vm:shop')).toBe(false)
})
