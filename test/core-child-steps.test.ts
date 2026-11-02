import { expect, test } from 'bun:test'
import { CoreChildSteps } from '../server/core/child-steps.ts'

test('child activity caches only the last 200 bounded step summaries, never chat or output bodies', () => {
  const projection = new CoreChildSteps()
  for (let i = 0; i < 10000; i++) {
    projection.apply({ kind: 'agent', id: `reply-${i}`, at: i, text: 'not cached'.repeat(100) })
    projection.apply({ kind: 'step', id: `step-${i}`, at: i, step: 'run', tool: 'Bash', title: 'Ran command', doing: 'Running command', target: 'command', detail: i === 9999 ? 'x'.repeat(100000) : 'printf ok' })
    projection.apply({ kind: 'step-end', id: `step-${i}`, at: i + 1, out: { file: '/native', offset: i } })
  }
  expect(projection.steps.size).toBe(200)
  expect(projection.omitted).toBe(9800)
  expect(projection.steps.get('step-0')).toBeUndefined()
  expect(projection.steps.get('step-9999')?.where?.offset).toBe(9999)
  expect(projection.steps.get('step-9999')?.detail?.length).toBeLessThan(65600)
  expect(projection.steps.get('step-9999')?.detail).toEndWith('… (shortened)')
  projection.apply({ kind: 'step-end', id: 'step-9999', at: 10001, drop: true })
  expect(projection.steps.size).toBe(199)
  projection.reset()
  expect(projection.steps.size).toBe(0)
  expect(projection.omitted).toBe(0)
})
