// Checks that could not be read must not look like a PR with no checks.
import { describe, expect, test } from 'bun:test'
import { layout } from './layout.ts'

const { browser, world, server } = await layout()
describe.skipIf(!browser)('pull request checks access', () => {
  test('the existing PR panel shows unreadable checks explicitly', async () => {
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    try {
      await page.route('**/api/worktree?*', async route => {
        if (new URL(route.request().url()).searchParams.get('what') !== 'pr') return route.continue()
        return route.fulfill({ json: { pr: { number: 128, title: 'Example pull request', state: 'open', url: 'https://github.com/example/example/pull/128', checks: [], checksError: 'Could not read GitHub checks.' } } })
      })
      const task = world.tasks.find(task => task.id === 'GTM-15')!
      await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent(task.place)}&task=${encodeURIComponent(task.id)}`)
      await page.getByRole('button', { name: 'Show task panel' }).click()
      await page.getByRole('tab', { name: 'Pull request' }).click()
      const panel = page.locator('#task-panel')
      await panel.getByText('Could not read GitHub checks.', { exact: true }).waitFor()
      expect(await panel.getByText('No checks on it.', { exact: true }).count()).toBe(0)
    } finally { await page.close() }
  }, 30_000)
})
