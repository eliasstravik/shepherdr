import { expect, test } from 'bun:test'
import { outOfView } from './away.ts'

// The reminder above the box shows only while a waiting card is out of the chat's view (SHEP-419).

const view = { top: 100, bottom: 700 }
const card = (id: string, top: number, bottom: number) => ({ id, words: `${id} asks you`, top, bottom })

test('no reminder while the waiting card is in view, even partly', () => {
  expect(outOfView([card('q1', 300, 400)], view)).toBeNull()
  expect(outOfView([card('q1', 50, 150)], view)).toBeNull()
  expect(outOfView([], view)).toBeNull()
})

test('a reminder once the waiting card scrolled away, above or below', () => {
  expect(outOfView([card('q1', -300, 80)], view)).toEqual({ id: 'q1', words: 'q1 asks you' })
  expect(outOfView([card('q1', 720, 800)], view)?.id).toBe('q1')
})

test('of several out of view, the newest', () => {
  expect(outOfView([card('old', -600, -500), card('new', -200, -100), card('seen', 300, 400)], view)?.id).toBe('new')
})
