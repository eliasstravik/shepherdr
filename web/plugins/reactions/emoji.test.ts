import { expect, test } from 'bun:test'
import { EMOJI } from './emoji.ts'

test('the first reaction choices match the design', () => {
  expect(EMOJI).toEqual(['👍', '❤️', '😂', '🎉', '👀', '🙏'])
})
