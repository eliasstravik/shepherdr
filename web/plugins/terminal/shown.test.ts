import { expect, test } from 'bun:test'
import { keysTerm, termInPlace } from './shown.ts'

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

// #787: typing in that tab's Chat box went into its terminal on a desktop-width screen: the keys followed ui.term
test("a tab's Chat box keeps its keys; a terminal shown takes them", () => {
  expect(keysTerm({ term: 't:t6', tabView: { 't:t6': 'chat' } })).toBe(null)
  expect(keysTerm({ term: 't:t6', tabView: { 't:t6': 'terminal' } })).toBe('t:t6')
  expect(keysTerm({ term: 't:t6' })).toBe('t:t6')
  expect(keysTerm({ term: 'c:vm:shop' })).toBe('c:vm:shop')
  expect(keysTerm({ term: null })).toBe(null)
})
