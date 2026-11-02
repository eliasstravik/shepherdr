// The app as an installed app on a phone or tablet: Back goes one step back inside it, screens push and pop. Opened
// in a real browser (native.ts); skipped where none is installed.
import { describe, expect, test } from 'bun:test'
import type { BrowserContext } from 'playwright-core'
import { GTM, drawerOpen, native, query, settled } from './native.ts'

const { browser, at, phone } = await native()

describe.skipIf(!browser)('Back inside the app (phone)', () => {
  test('task, then place, then the places list it was picked from; the browser Back too', async () => {
    const { ctx, page } = await phone()
    await page.goto(at('place=vm-str/home'))
    await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).click()
    await settled(page)
    expect(await drawerOpen(page)).toBe(true)
    await page.locator('nav[aria-label=Spaces]').getByText('gtm', { exact: true }).click()
    await settled(page)
    expect(query(page).get('place')).toBe('vm-str/gtm')
    await page.getByRole('button', { name: 'Tasks' }).click()
    await page.locator('li', { hasText: 'GTM-14' }).getByRole('button').first().click()
    await page.getByRole('button', { name: 'Back', exact: true }).waitFor()
    expect(query(page).get('task')).toBe('GTM-14')
    // Back: the place, on the tab the task was opened from
    await page.goBack()
    await settled(page)
    expect(query(page).get('task')).toBeNull()
    expect(query(page).get('tab')).toBe('tasks')
    // Back: the places list it was picked from
    await page.goBack()
    await settled(page)
    expect(query(page).get('place')).toBe('vm-str/home')
    expect(await drawerOpen(page)).toBe(true)
    // Back: the drawer shuts, nothing more to go back to inside the app
    await page.goBack()
    await settled(page)
    expect(await drawerOpen(page)).toBe(false)
    await ctx.close()
  }, 30_000)

  test('closing a screen with its own button takes its step out, so Back never lands on it again', async () => {
    const { ctx, page } = await phone()
    await page.goto(at(`${GTM}&tab=tasks`))
    const before = await page.evaluate(() => history.length)
    await page.locator('li', { hasText: 'GTM-14' }).getByRole('button').first().click()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await settled(page)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await page.getByRole('dialog', { name: 'Search or jump to' }).waitFor()
    await page.getByRole('dialog', { name: 'Search or jump to' }).getByRole('button', { name: 'Close' }).click()
    // the steps went back out: what's ahead of us is gone the moment anything new opens
    await page.waitForFunction(() => (history.state as { key: string }).key.includes('"p:vm-str:gtm",null'), null, { polling: 50 })
    await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).click()
    await settled(page)
    expect(await page.evaluate(() => history.length)).toBe(before + 1)
    await ctx.close()
  }, 30_000)

  test("an alert's link to a task opened cold: Back goes to its place", async () => {
    const { ctx, page } = await phone()
    await page.goto(at(`${GTM}&task=GTM-14`))
    await page.getByRole('button', { name: 'Back', exact: true }).waitFor()
    await page.goBack()
    await settled(page)
    expect(query(page).get('place')).toBe('vm-str/gtm')
    expect(query(page).get('task')).toBeNull()
    await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).waitFor()
    await ctx.close()
  }, 30_000)

  test('settings, search and an artifact are steps; Android back closes them', async () => {
    const { ctx, page } = await phone()
    await page.goto(at('place=vm-str/home'))
    await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('region', { name: 'Settings' }).waitFor()
    await page.goBack()
    await page.getByRole('region', { name: 'Settings' }).waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const search = page.getByRole('dialog', { name: 'Search or jump to' })
    await search.waitFor()
    await page.goBack()
    await search.waitFor({ state: 'detached' })
    await ctx.close()
  }, 30_000)
})

describe.skipIf(!browser)('motion', () => {
  test('a task pushes in from the right and pops back out; with reduced motion it just shows', async () => {
    for (const reduced of [false, true]) {
      const ctx: BrowserContext = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: reduced ? 'reduce' : 'no-preference' })
      const page = await ctx.newPage()
      await page.goto(at(`${GTM}&tab=tasks`))
      // where the task's screen is from the moment it is put in until it has settled: a busy machine may run late, so
      // no single moment after the tap is sure to catch it moving
      await page.evaluate(() => {
        const w = window as unknown as { lefts: number[]; stop?: () => void }
        w.lefts = []
        const look = () => {
          const s = document.querySelector('section:has(> div button[aria-label=Back])')
          if (s) w.lefts.push(s.getBoundingClientRect().left)
        }
        const seen = new MutationObserver(look)
        seen.observe(document.body, { childList: true, subtree: true })
        const every = setInterval(look, 10)
        w.stop = () => (seen.disconnect(), clearInterval(every))
      })
      await page.locator('li', { hasText: 'GTM-14' }).getByRole('button').first().click()
      await page.locator('section:has(> div button[aria-label=Back])').waitFor()
      await settled(page)
      const lefts = await page.evaluate(() => {
        const w = window as unknown as { lefts: number[]; stop: () => void }
        w.stop()
        return w.lefts
      })
      if (reduced) expect(Math.max(...lefts)).toBe(0)
      else expect(Math.max(...lefts)).toBeGreaterThan(20)
      expect(await page.$eval('section:has(> div button[aria-label=Back])', (s) => s.getBoundingClientRect().left)).toBe(0)
      await ctx.close()
    }
  }, 30_000)

  test('menus spring out of their button', async () => {
    const { ctx, page } = await phone()
    await page.goto(at('place=vm-str/home'))
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    const scale = await page.getByRole('menu').evaluate((m) => m.getAnimations().length)
    expect(scale).toBeGreaterThan(0)
    await ctx.close()
  }, 30_000)
})

describe.skipIf(!browser)('a tablet', () => {
  test('the drawer flicks out from the edge; a task in the side column swipes back; keys work', async () => {
    const { ctx, page, swipe, flick } = await phone({ width: 820, height: 1180 })
    await page.goto(at(GTM))
    await page.locator('section[aria-label=Tasks] li', { hasText: 'GTM-14' }).getByRole('button').first().click()
    await page.getByRole('button', { name: 'Back', exact: true }).waitFor()
    await settled(page)
    const col = (await page.locator('section:has(> div button[aria-label=Back])').boundingBox())!
    await swipe(col.x + 60, col.y + 26, col.x + col.width - 10, col.y + 26, 150)
    await settled(page)
    await page.waitForURL((u) => !u.searchParams.get('task'))
    expect(query(page).get('task')).toBeNull()
    await flick(6, 600, 76, 600, 80)
    await settled(page)
    expect(await drawerOpen(page)).toBe(true)
    await page.goBack()
    await settled(page)
    expect(await drawerOpen(page)).toBe(false)
    // an iPad's keyboard: ⌘B opens the drawer, Esc shuts it, ? opens Settings at the keys
    await page.keyboard.press('Control+b')
    await settled(page)
    expect(await drawerOpen(page)).toBe(true)
    await page.keyboard.press('Escape')
    await settled(page)
    expect(await drawerOpen(page)).toBe(false)
    await page.keyboard.press('?')
    await page.getByRole('heading', { name: 'Keyboard shortcuts' }).waitFor()
    await page.keyboard.press('Escape')
    await settled(page)
    // a finger gets 44pt rows
    const row = (await page.locator('section[aria-label=Tasks] li').first().boundingBox())!
    expect(row.height).toBeGreaterThanOrEqual(44)
    await ctx.close()
  }, 30_000)
})
