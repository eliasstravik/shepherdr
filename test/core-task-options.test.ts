import { expect, test } from 'bun:test'
import { parseArgs, one } from '../server/common/args.ts'
import { taskOptions, validateTaskSettings } from '../server/core/task-options.ts'

test('one-task aliases preserve 2.0 precedence without changing inherited settings', () => {
  const parsed = parseArgs(['task', 'add', 'Example', '--desc', 'Full brief', '--agent', 'claude', '--set', 'agent=codex', '--set', 'review=off', '--set', 'review.mustFix=critical', '--set', 'rounds=2 rounds', '--set', 'reviewer.model=default', '--set', 'merge="ask me first"'])
  expect(taskOptions(parsed)).toEqual({ 'brief.review': 'off', 'review.mustFix': 'critical', 'review.rounds': '2 rounds', 'brief.merge': 'ask me first' })
  expect(one(parsed, 'agent')).toBe('codex')
  expect(one(parsed, 'reviewer-model')).toBe('default')
  expect(one(parsed, 'desc')).toBe('Full brief')
  expect(validateTaskSettings({ 'review.rounds': '1.0round' })).toEqual({ 'review.rounds': '1 round' })
})

test('unknown and bare add flags and unsupported one-task values refuse instead of silently disappearing', () => {
  for (const args of [['--mystery', 'x'], ['--reviewer-model'], ['--after'], ['--set', 'review.rounds=0'], ['--set', 'review.rounds=11'], ['--set', 'review=maybe'], ['--set', 'merge=auto'], ['--set', 'space.base=other'], ['--set', '__proto__=x'], ['--set', 'constructor=x']]) {
    expect(() => taskOptions(parseArgs(['task', 'add', 'Example', ...args]))).toThrow()
  }
  expect(validateTaskSettings({ 'review.rounds': '10', 'review.mustFix': 'trivial' })).toEqual({ 'review.rounds': '10 rounds', 'review.mustFix': 'trivial' })
})
