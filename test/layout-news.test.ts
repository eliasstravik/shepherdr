// Coordinator history stays in the dated message stream, including status-only updates.
import { describe, expect, test } from 'bun:test'
import { cardMessage, type Message } from '../shared/types.ts'
import { layout, pills } from './layout.ts'

const { browser, world, url } = await layout()

describe.skipIf(!browser)('coordinator update history', () => {
  test('many updates stay visible in time order beside replies and unanswered cards, at every screen size and theme', async () => {
    const chat = world.chats['p:vm-str:~']
    const before = chat.messages
    const at = Date.now() - 86_400_000
    const history: Message[] = Array.from({ length: 40 }, (_, i) => cardMessage({
      id: `history-${i}`, task: 'LV-3', status: i % 2 ? 'done' : 'ready', text: i % 2 ? 'is merged' : 'is ready to merge',
    }, at + i * 1000))
    history[4].reactions = [{ emoji: '👍', by: 'me' }]
    history.push(
      { id: 'history-reply', who: 'you', text: 'Keep this update here', at: at + 4500, reply: { id: 'history-4', who: 'agent', text: history[4].text! } },
      cardMessage({ id: 'history-permission', task: 'LV-3', status: 'need', text: 'needs you', ask: { chat: 'LV-3/Agent', open: true, questions: [{ id: 'history:q', kind: 'Question', title: 'Allow writing files?', choices: [{ label: 'Allow' }, { label: 'Deny' }], to: 'LV-3 agent' }] } }, at + 5500),
      { id: 'history-question', who: 'agent', at: at + 6500, question: { id: 'history:colour', kind: 'Form', title: 'Which colour?', choices: [{ label: 'Blue' }, { label: 'Green' }], to: 'home' } },
    )
    // Deliberately shuffled: rendering must use timestamps, not a separate status bucket or insertion order.
    chat.messages = [...history].reverse()
    const expected = [...history].sort((a, b) => a.at! - b.at!).map((m) => m.id)
    try {
      for (const width of [390, 820, 1440]) for (const colorScheme of ['light', 'dark'] as const) {
        const page = await browser!.newPage({ viewport: { width, height: 900 }, colorScheme })
        try {
          await page.goto(url())
          await page.locator('[data-msg="history-39"]').waitFor()
          expect(await page.getByText(/^Task updates ·/).count()).toBe(0)
          expect(await page.locator('[data-attention]').count()).toBe(0)
          expect(await page.locator('[data-messages]').getByText(/\d+ need you · \d+ ready/).count()).toBe(0)
          expect(await page.locator('[data-messages] [data-whole]').evaluateAll((els) => els.map((el) => el.getAttribute('data-whole')))).toEqual(expected)
          for (const id of expected) expect(await page.locator(`[data-whole="${id}"]`).isVisible()).toBe(true)
          expect(await page.locator(pills('history-4')).getAttribute('aria-pressed')).toBe('true')
          const reply = page.locator('[data-msg="history-reply"]')
          expect(await reply.textContent()).toContain(history[4].text!)
          // A task's card is a row here, with nothing to answer: only the coordinator's own card has buttons.
          const permission = page.locator('[data-whole="history-permission"]')
          expect(await permission.locator('[data-card]').count()).toBe(0)
          expect(await permission.locator('[data-needs-link]').count()).toBe(1)
          expect(await page.locator('[data-whole="history-question"] [data-card]').getByRole('button', { name: 'Blue', exact: true }).isEnabled()).toBe(true)
          await page.reload()
          await page.locator('[data-msg="history-39"]').waitFor()
          expect(await page.locator('[data-messages] [data-whole]').evaluateAll((els) => els.map((el) => el.getAttribute('data-whole')))).toEqual(expected)
        } finally { await page.close() }
      }
    } finally { chat.messages = before }
  }, 30_000)
})
