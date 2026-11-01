// Aggregate notifications keep categories separate, in the real sidebar and Tasks navigation.
import { describe, expect, test } from 'bun:test'
import { layout, settled, until } from './layout.ts'

const { browser, world, url } = await layout()
const badge = '[data-attention-badge]'
const place = 'p:vm-str:gtm'

describe.skipIf(!browser)('attention count circles', () => {
  for (const width of [390, 820, 1440]) {
    test(`zero, one-sided, split and capped counts, both themes at ${width}px`, async () => {
      const saved = world.tasks
      const page = await browser!.newPage({ viewport: { width, height: 1000 } })
      page.setDefaultTimeout(5000)
      const template = saved.find((t) => t.status === 'ready')!
      const requests = world.chats[place].messages
      const asks = world.asks
      const others = world.places.filter((p) => p.id !== place && world.chats[p.chat]).map((p) => [p.chat, world.chats[p.chat].messages] as const)
      // No coordinator request in the state matrix, in any space: Needs you counts them all. Scoped counting is checked below.
      world.chats[place].messages = []
      for (const [chat] of others) world.chats[chat].messages = []
      world.asks = {}
      const tasks = (need: number, ready: number) => Array.from({ length: need + ready }, (_, i) => ({
        ...template, id: `BADGE-${i}`, place, status: i < need ? 'need' as const : 'ready' as const,
        agent: undefined,
      }))
      try {
        await page.goto(url().replace('vm-str/home', 'vm-str/gtm'))
        await page.locator('[aria-label^="Message"]').first().waitFor()
        for (const theme of ['light', 'dark']) {
          await page.evaluate((value) => {
            localStorage.setItem('shepherdr.appearance', value)
            dispatchEvent(new StorageEvent('storage', { key: 'shepherdr.appearance' }))
          }, theme)
          for (const [need, ready] of [[0, 0], [1, 0], [0, 1], [2, 3], [12, 108]]) {
            // Neither archived tasks nor tasks in a different space belong to this panel's counts. Its agent's merge
            // card would still wait on Needs you, which counts every space: only the agent's own chat holds one.
            world.tasks = [...tasks(need, ready), { ...template, id: 'ARCHIVED', place, archived: Date.now() }, { ...template, id: 'ELSEWHERE', place: 'p:mac:lilla-varlden', agent: undefined }]
            world.emit('snapshot')
            // Tasks counts Ready alone; what needs you has one number, on Needs you
            const panel = page.locator(`${badge}[aria-label$="panel scope"]`).filter({ visible: true }).first()
            const needs = page.locator(`${badge}[aria-label$="everywhere"]`).filter({ visible: true }).first()
            expect(await until(() => panel.count(), (n) => n === (ready ? 1 : 0))).toBe(ready ? 1 : 0)
            expect(await until(() => needs.count(), (n) => n === (need ? 1 : 0))).toBe(need ? 1 : 0)
            if (!need && !ready) continue
            if (ready) {
              expect(await until(() => panel.getAttribute('aria-label'), (s) => s === `0 needs you, ${ready} ready · panel scope`)).toBe(`0 needs you, ${ready} ready · panel scope`)
              expect(await panel.getAttribute('data-attention-badge')).toBe('ready')
              expect(await panel.locator(':scope > span').allTextContents()).toEqual([ready > 9 ? '9+' : `${ready}`])
            }
            if (need) {
              expect(await until(() => needs.getAttribute('aria-label'), (s) => s === `${need} needs you, 0 ready · everywhere`)).toBe(`${need} needs you, 0 ready · everywhere`)
              expect(await needs.locator(':scope > span').allTextContents()).toEqual([need > 9 ? '9+' : `${need}`])
            }
            const geometry = await (ready ? panel : needs).evaluate((el) => {
              const b = el.getBoundingClientRect()
              return { w: b.width, h: b.height, radius: getComputedStyle(el).borderRadius, fits: [...el.children].every((c) => c.scrollWidth <= c.clientWidth), colour: getComputedStyle(el).color }
            })
            expect(geometry.w).toBe(geometry.h)
            expect(geometry.radius).toBe('50%')
            expect(geometry.fits).toBe(true)
            expect(geometry.colour).toBe(theme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)')
            const row = page.locator(`nav[aria-label="Spaces"] li[data-project="${place}"]`)
            if (!await row.isVisible()) await page.getByRole('button', { name: 'Spaces', exact: true }).click()
            // The hovered desktop row gives the badge's room to its More button.
            await page.mouse.move(width - 1, 1)
            await page.locator('[aria-label^="Message"]').first().focus()
            await row.locator(badge).waitFor()
            expect(await row.locator(badge).getAttribute('aria-label')).toBe(`${need} needs you, ${ready} ready · here`)
            expect(await row.locator(badge).count()).toBe(1)
            // Clicking the same space keeps the existing navigation and closes the phone drawer.
            await row.getByRole('button', { name: /^gtm,/ }).click()
            await settled(page)
            expect(page.url()).toContain('gtm')
            expect(await page.locator('[data-attention]').count()).toBe(0)
            expect(await page.getByText(/^Task updates ·/).count()).toBe(0)
          }
        }
        // A coordinator question counts on its space and on Needs you, which agree.
        world.tasks = tasks(1, 1)
        world.chats[place].messages = requests
        world.asks = asks
        world.emit('snapshot')
        const panel = page.locator(`${badge}[aria-label$="everywhere"]`).filter({ visible: true }).first()
        expect(await until(() => panel.getAttribute('aria-label'), (s) => s === '2 needs you, 0 ready · everywhere')).toBe('2 needs you, 0 ready · everywhere')
        if (!await page.locator(`li[data-project="${place}"]`).isVisible()) await page.getByRole('button', { name: 'Spaces', exact: true }).click()
        expect(await until(() => page.locator(`li[data-project="${place}"] ${badge}`).getAttribute('aria-label'), (s) => s === '2 needs you, 1 ready · here')).toBe('2 needs you, 1 ready · here')
      } finally {
        world.tasks = saved
        world.chats[place].messages = requests
        for (const [chat, messages] of others) world.chats[chat].messages = messages
        world.asks = asks
        world.emit('snapshot')
        await page.close()
      }
    }, 30_000)
  }
})
