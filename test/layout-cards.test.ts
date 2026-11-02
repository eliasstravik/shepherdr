import { describe, expect, test } from 'bun:test'
import { layout } from './layout.ts'
const { browser, world, url } = await layout()
describe.skipIf(!browser)('closed question history', () => {
  test('expired permission stays disabled and says Closed rather than claiming an answer was sent', async () => {
    const chat = world.chats['p:vm-str:~'], old = chat.messages
    chat.messages = [...old, { id: 'closed-card-proof', who: 'agent', at: Date.now(), question: { id: 'closed-proof', kind: 'Question', title: 'Use a tool?', choices: [{ label: 'Allow once' }, { label: 'Deny' }], to: 'Agent', sent: -1, said: 'Permission request expired', closed: 'Permission request expired' } }]
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    page.setDefaultTimeout(5000)
    try {
      await page.goto(url())
      const card = page.locator('[data-whole="closed-card-proof"]')
      await card.getByText('Closed', { exact: true }).waitFor()
      expect(await card.getByRole('button', { name: 'Allow once', exact: true }).isDisabled()).toBe(true)
      expect(await card.getByRole('button', { name: 'Deny', exact: true }).isDisabled()).toBe(true)
      expect(await card.getByRole('button', { name: 'Send', exact: true }).count()).toBe(0)
      expect(await card.textContent()).not.toContain('Sent to')
      expect(await card.textContent()).toContain('Permission request expired')
    } finally { chat.messages = old; await page.close() }
  })
})
