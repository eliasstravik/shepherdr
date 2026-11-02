import { describe, expect, test } from 'bun:test'
import { layout, until } from './layout.ts'

const { browser, world, url } = await layout({ everything: true })

describe.skipIf(!browser)('unified search', () => {
  for (const width of [390, 1440]) test(`scopes, paging and exact destination message (${width}px)`, async () => {
    const source = world.chats['LV-3/Agent']
    const old = source.messages
    source.messages = [...old, ...Array.from({ length: 30 }, (_, n) => ({ id: `search-proof-${n}`, who: 'agent' as const, text: `Search paging needle ${n}`, at: Date.now() + n }))]
    const page = await browser!.newPage({ viewport: { width, height: 900 } })
    page.setDefaultTimeout(5000)
    try {
      await page.goto(url())
      await page.locator('[aria-label^="Message"]').first().waitFor()
      await page.keyboard.press('Control+k')
      const search = page.getByRole('combobox', { name: 'Search or jump to' })
      await search.waitFor()
      expect(await page.getByRole('button', { name: 'Everywhere', exact: true }).getAttribute('aria-pressed')).toBe('true')
      await search.fill('search paging needle')
      const group = page.getByRole('group', { name: 'Messages', exact: true })
      await group.getByRole('option').first().waitFor()
      expect(await group.getByRole('option').count()).toBe(8)
      await group.getByRole('button', { name: /Show more messages/ }).click()
      expect(await group.getByRole('option').count()).toBe(28)
      const hit = group.getByRole('option', { name: /^Search paging needle 29 / })
      await hit.click()
      expect(page.url()).toContain('task=LV-3')
      const target = page.locator('[data-msg="search-proof-29"]')
      await target.waitFor()
      expect(await until(() => target.locator('[data-flash]').count(), n => n > 0)).toBeGreaterThan(0)
      expect(await page.getByRole('searchbox', { name: 'Search in this chat' }).inputValue()).toBe('search paging needle')
      // The old exact chat route remains, alongside a scoped entrance to unified search.
      await page.getByRole('button', { name: 'More', exact: true }).click()
      expect(await page.getByRole('menuitem', { name: 'Search in this chat', exact: true }).count()).toBe(1)
      await page.getByRole('menuitem', { name: 'Open full search' }).click()
      await search.waitFor()
      expect(await page.getByRole('button', { name: 'This chat', exact: true }).getAttribute('aria-pressed')).toBe('true')
      expect(await page.getByRole('button', { name: 'Space: lilla-varlden', exact: true }).count()).toBe(1)
      expect(await page.getByRole('button', { name: 'Machine: mac', exact: true }).count()).toBe(1)
      await search.fill('search paging needle')
      await group.getByRole('option').first().waitFor()
      await page.getByRole('button', { name: 'Everywhere', exact: true }).click()
      expect(await page.getByRole('button', { name: 'Everywhere', exact: true }).getAttribute('aria-pressed')).toBe('true')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    } finally { source.messages = old; await page.close() }
  }, 30_000)

  test('late replies in an earlier batch refresh the open results', async () => {
    const first = world.snapshot().places[0].chat
    const chat = world.chats[first]
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(5000)
    try {
      await page.goto(url())
      await page.locator('[aria-label^="Message"]').first().waitFor()
      await page.keyboard.press('Control+k')
      await page.getByRole('combobox', { name: 'Search or jump to' }).fill('late-stream-needle')
      await page.getByRole('listbox', { name: 'Search results' }).waitFor()
      expect(await until(() => page.getByRole('listbox', { name: 'Search results' }).getAttribute('aria-busy'), value => value === 'false')).toBe('false')
      chat.messages.push({ id: 'late-stream-result', who: 'agent', text: 'A late-stream-needle reply', at: Date.now() })
      world.emit('chat', first)
      await page.getByRole('option', { name: /^A late-stream-needle reply/ }).waitFor()
      expect(await page.getByRole('option').count()).toBe(1)
    } finally {
      chat.messages = chat.messages.filter(m => m.id !== 'late-stream-result')
      await page.close()
    }
  }, 30_000)

  test('duplicate homes keep machine context, artifacts open by identity', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(5000)
    try {
      await page.goto(url())
      await page.locator('[aria-label^="Message"]').first().waitFor()
      await page.keyboard.press('Control+k')
      const search = page.getByRole('combobox', { name: 'Search or jump to' })
      await search.fill('home nas')
      const home = page.getByRole('option').filter({ hasText: 'home · nas' })
      await home.first().waitFor()
      await home.first().click()
      expect(page.url()).toContain('nas%2Fhome')
      await page.keyboard.press('Control+k')
      await search.fill('Upload page draft')
      const artifacts = page.getByRole('group', { name: 'Artifacts', exact: true })
      await artifacts.getByRole('option').first().waitFor()
      await artifacts.getByRole('option').first().click()
      expect(page.url()).toContain('artifact=')
      expect(page.url()).toContain('mac%2Flilla-varlden')
    } finally { await page.close() }
  }, 30_000)
})
