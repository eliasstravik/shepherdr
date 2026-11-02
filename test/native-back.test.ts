// A swipe goes back on a phone: from a task, settings and a task's side panel. Opened in a real browser (native.ts);
// skipped where none is installed.
import { describe, expect, test } from 'bun:test'
import { GTM, native, query, settled } from './native.ts'

const { browser, at, phone } = await native()

describe.skipIf(!browser)('swipes back (phone)', () => {
  test('a short flick right on a task goes back', async () => {
    const { ctx, page, flick } = await phone()
    await page.goto(at(`${GTM}&task=GTM-14`))
    await page.getByRole('button', { name: 'Back', exact: true }).waitFor()
    await settled(page)
    await flick(6, 400, 76, 400, 80)
    await settled(page)
    await page.waitForURL((u) => !u.searchParams.get('task'))
    expect(query(page).get('task')).toBeNull()
    await ctx.close()
  }, 30_000)

  test("a swipe across a task's chat goes back to the place, the place following the finger in", async () => {
    const { ctx, page, swipe } = await phone()
    await page.goto(at(`${GTM}&task=GTM-14`))
    await page.getByRole('button', { name: 'Back', exact: true }).waitFor()
    await settled(page)
    // a short slow drag springs back
    await swipe(150, 40, 230, 40, 500)
    await settled(page)
    expect(query(page).get('task')).toBe('GTM-14')
    await swipe(150, 40, 380, 40, 150)
    await settled(page)
    await page.waitForURL((u) => !u.searchParams.get('task'))
    expect(query(page).get('task')).toBeNull()
    expect(query(page).get('place')).toBe('vm-str/gtm')
    await ctx.close()
  }, 30_000)

  test('settings and a task\'s side panel screens swipe back too, from across them or their very edge', async () => {
    const { ctx, page, swipe } = await phone()
    await page.goto(at('place=vm-str/home'))
    await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('region', { name: 'Settings' })
    await settings.waitFor()
    await settled(page)
    await swipe(150, 400, 385, 400, 150)
    await settings.waitFor({ state: 'detached' })
    // a phone's settings section goes back to their list, from across it or its very edge, one step at a time
    await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await settings.waitFor()
    for (const x of [150, 3]) {
      await settings.getByRole('button', { name: 'Agents' }).click()
      const agents = settings.getByRole('region', { name: 'Agents' })
      await agents.waitFor()
      await settled(page)
      await swipe(x, 400, 385, 400, 150)
      await agents.waitFor({ state: 'detached' })
      expect(await settings.count()).toBe(1)
      await settled(page)
    }
    await page.goBack()
    await settings.waitFor({ state: 'detached' })
    // a diff scrolls sideways: its very edge still goes back
    await page.goto(at(`${GTM}&task=GTM-14&item=terminal`))
    const sheet = page.getByRole('dialog', { name: /· GTM-14$/ })
    await sheet.waitFor()
    await settled(page)
    await swipe(3, 500, 380, 500, 150)
    await sheet.waitFor({ state: 'detached' })
    expect(query(page).get('item')).toBeNull()
    expect(query(page).get('task')).toBe('GTM-14')
    await ctx.close()
  }, 30_000)

})
