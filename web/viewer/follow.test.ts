import { expect, test } from 'bun:test'
import { lookOnce } from './follow.ts'
import * as R from '@core/recipe.js'

const { withIds } = R as any
const meta = { id: 'a', title: 'A', version: 2, versions: [] }

test('an unreadable recipe never counts as shown, so the next look tries it again (#1108)', async () => {
  let recipe: unknown = null   // the server answered, but nothing readable
  const get = async (url: string) => (url.includes('/recipe') ? recipe : meta)
  await expect(lookOnce(get, 'api/x', null, 0, () => {}, withIds)).rejects.toThrow()
  recipe = { recipe: 1, blocks: [{ type: 'text', text: 'hi' }] }
  const next = await lookOnce(get, 'api/x', null, 0, () => {}, withIds)
  expect(next?.v).toBe(2)
  expect((next as any).blocks[0].id).toBe('b1')
  // shown now: the next look only reads the record
  expect(await lookOnce(get, 'api/x', null, 2, () => {}, withIds)).toBeNull()
})
