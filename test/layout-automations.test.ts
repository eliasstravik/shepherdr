import { describe, expect, test } from 'bun:test'
import { layout, still } from './layout.ts'

const { browser, server } = await layout({ everything: true })
describe.skipIf(!browser)('automation actions after a lost response', () => {
  test('phone retry keeps the same run ID and prevents a different action until confirmed', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    const commands: { cid: string; op: string }[] = []
    let saved: unknown
    try {
      await page.route('**/api/action', async route => {
        const action = route.request().postDataJSON()
        if (action.type !== 'automation') return route.continue()
        commands.push(action)
        if (commands.length === 1) {
          saved = await (await route.fetch()).json()
          return route.abort('failed') // The server completed the action, but its response was lost.
        }
        return route.fulfill({ json: saved })
      })
      await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}&tab=tasks`)
      const row = page.locator('li[aria-expanded]', { hasText: 'Flaky tests' })
      await row.click()
      const detail = page.locator(`#${await row.getAttribute('aria-controls')}`)
      await detail.getByRole('button', { name: 'Run now' }).click()
      await detail.getByText('The action was not confirmed.', { exact: false }).waitFor()
      // The completed server action inserts its run while the lost-response error arrives separately.
      // Wait for that snapshot and its layout before tapping a button that just moved.
      await detail.getByText('GTM-51', { exact: true }).waitFor()
      const pause = detail.getByRole('button', { name: 'Pause', exact: true })
      await still(pause)
      await pause.click()
      await detail.getByText('Confirm the previous action', { exact: false }).waitFor()
      expect(commands).toHaveLength(1)
      const retry = detail.getByRole('button', { name: 'Run now' })
      await still(retry)
      await retry.click()
      await detail.getByText('GTM-51', { exact: true }).waitFor()
      expect(commands).toHaveLength(2)
      expect(commands[1].cid).toBe(commands[0].cid)
      expect(commands[1].op).toBe('run')
    } finally { await page.close() }
  })
})
