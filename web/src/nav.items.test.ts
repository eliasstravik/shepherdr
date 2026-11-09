import { expect, test } from 'bun:test'
import { itemOfUrl, screenOfUrl } from './nav.ts'

// Files and Changes are no longer a task's tabs (SHEP-143): an old link to them opens its Pull request (TabBody shows
// the chat when the task has none)
test("an old link to a task's Files or Changes opens its Pull request", () => {
  expect(itemOfUrl('files')).toBe('pr')
  expect(itemOfUrl('diff')).toBe('pr')
  expect(itemOfUrl('terminal')).toBe('terminal')
  expect(itemOfUrl(null)).toBe(null)
  expect(screenOfUrl('?task=SHOP-2&item=diff', false, () => 'chat').sheet).toBe('pr')
  expect(screenOfUrl('?task=SHOP-2&item=artifacts', false, () => 'chat').sheet).toBe('artifacts')
})
