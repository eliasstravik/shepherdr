import { expect, test } from 'bun:test'
import { CoreReviewReader } from '../server/core/review-reader.ts'

test('native exec events preserve IDs and distinguish completed and failed reviews', () => {
  const reader = new CoreReviewReader()
  const raw = [
    { type: 'thread.started', thread_id: 'thread' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item', type: 'agent_message', text: 'No findings' } },
    { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } },
    { type: 'turn.failed', error: { message: 'Provider disconnected' } },
  ]
  const lines = raw.map((event, offset) => ({ text: JSON.stringify({ at: offset + 100, event }), offset: offset * 100 }))
  const events = reader.parse(lines, '/private/review')
  expect(events).toContainEqual({ kind: 'session', id: '/private/review:0', at: 100, sessionId: 'thread', file: '/private/review' })
  expect(events).toContainEqual({ kind: 'agent', id: '/private/review:200', at: 102, text: 'No findings' })
  expect(events.filter(event => event.kind === 'turn-end')).toEqual([
    { kind: 'turn-end', id: '/private/review:300', at: 103 },
    { kind: 'turn-end', id: '/private/review:400', at: 104, aborted: true },
  ])
  expect(reader.parse(lines, '/private/review')).toEqual(events)
})
