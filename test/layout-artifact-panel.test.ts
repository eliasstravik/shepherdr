// An artifact shown in the side panel: from full screen or its card in the chat, it fills the right-hand Artifacts list
// beside the chat (a task's own Artifacts tab when its chat covers that list; a phone's Artifacts tab), kept per place
// on reload. In a real browser (layout.ts).
import { describe, expect, test } from 'bun:test'
import { layout, still } from './layout.ts'

const { browser, server } = await layout()
const at = (q: string) => `http://127.0.0.1:${server!.port}/?${q}`

describe.skipIf(!browser)('an artifact in the side panel', () => {
  test('a desktop: from full screen, beside the chat, kept on reload, per place, back to the list, full screen and closed', async () => {
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    // LV-3's artifact, from another space, over the main home space
    await page.goto(at('place=vm-str/home&artifact=a7'))
    const dialog = page.getByRole('dialog', { name: 'Upload page draft' })
    await dialog.getByRole('button', { name: 'Show in side panel' }).click()
    await dialog.waitFor({ state: 'detached' })
    const side = page.getByRole('region', { name: 'Artifacts', exact: true })
    const shown = side.getByRole('region', { name: 'Upload page draft' })
    await shown.locator('iframe[title="Upload page draft"]').waitFor()
    // beside the chat, filling the column
    const chat = (await page.getByRole('textbox', { name: /^Message home/ }).boundingBox())!
    const box = (await shown.boundingBox())!
    const col = (await side.boundingBox())!
    expect(chat.x + chat.width).toBeLessThan(box.x)
    expect(Math.abs(box.width - col.width)).toBeLessThanOrEqual(2)
    expect((await shown.locator('iframe').boundingBox())!.height).toBeGreaterThan(600)

    // kept on reload
    await page.reload()
    await shown.locator('iframe').waitFor()

    // another place's list is its own
    await page.getByRole('button', { name: /^gtm\b/ }).click()
    await page.getByRole('textbox', { name: 'Message gtm…' }).waitFor()
    await shown.waitFor({ state: 'detached' })
    await side.waitFor()
    await page.goBack()
    await shown.locator('iframe').waitFor()

    // full screen again, and closed: still beside the chat
    await shown.getByRole('button', { name: 'Open full screen' }).click()
    await dialog.getByRole('button', { name: 'Close' }).last().click()
    await dialog.waitFor({ state: 'detached' })
    await shown.waitFor()

    // back to the list
    await shown.getByRole('button', { name: 'Back to Artifacts' }).click()
    await side.getByLabel('Filter artifacts').waitFor()

    // from its card in the chat; closed, the tasks show again
    const card = page.locator('[data-card]').filter({ hasText: 'This week across machines' })
    await card.getByRole('button', { name: 'Show in side panel' }).click()
    const week = side.getByRole('region', { name: 'This week across machines' })
    await week.locator('iframe').waitFor()
    await week.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('region', { name: 'Tasks', exact: true }).waitFor()
    await page.close()
  }, 30_000)

  test('pinned, it shows in the pinned list, whichever place is picked', async () => {
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    await page.goto(at('place=vm-str/home'))
    const side = page.getByRole('region', { name: 'Tasks', exact: true })
    await side.getByRole('button', { name: 'Keep filters: hold them when switching space' }).click()
    await page.getByRole('button', { name: /^gtm\b/ }).click()
    await page.getByRole('textbox', { name: 'Message gtm…' }).waitFor()
    // LV-3's artifact full screen over gtm, then beside it
    await page.evaluate(() => history.pushState(null, '', `${location.search}&artifact=a7`))
    await page.goBack()
    await page.goForward()
    const dialog = page.getByRole('dialog', { name: 'Upload page draft' })
    await dialog.getByRole('button', { name: 'Show in side panel' }).click()
    const shown = page.getByRole('region', { name: 'Artifacts', exact: true }).getByRole('region', { name: 'Upload page draft' })
    await shown.locator('iframe').waitFor()
    expect(await page.getByRole('button', { name: 'Filters kept: tap to follow the space picked' }).isVisible()).toBe(true)
    expect(await page.getByRole('textbox', { name: 'Message gtm…' }).isVisible()).toBe(true)
    // another place picked: the pinned list keeps it
    await page.getByRole('button', { name: /^herdr-projects\b/ }).click()
    await page.getByRole('textbox', { name: 'Message herdr-projects…' }).waitFor()
    expect(await shown.isVisible()).toBe(true)
    await page.close()
  }, 30_000)

  test("a desktop with a task open: its card goes to the task's own Artifacts tab, beside its chat", async () => {
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    await page.goto(at('place=p%3Avm-str%3Aherdr-projects&task=HP-201'))
    const title = 'Board with the fixed count'
    const card = page.locator('[data-card]').filter({ has: page.locator(`iframe[title="${title}"]`) })
    const show = card.getByRole('button', { name: 'Show in side panel' })
    // the frames in the chat take their pages' heights as they load, moving the card: a click before then misses
    await still(show)
    await show.click()
    const panel = page.getByRole('tabpanel', { name: 'Artifacts' })
    const shown = panel.getByRole('region', { name: title })
    await shown.locator('iframe').waitFor()
    expect(await page.getByRole('textbox', { name: 'Message HP-201…' }).isVisible()).toBe(true)
    // closed, the panel hides
    await shown.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Show task panel' }).waitFor()
    await page.close()
  }, 30_000)

  test("a phone: from full screen's ⋯ to the Artifacts tab; closed, the chat again", async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await page.goto(at('place=vm-str/home&artifact=a1'))
    const dialog = page.getByRole('dialog', { name: 'This week across machines' })
    await dialog.getByRole('button', { name: 'More' }).tap()
    await page.getByRole('menuitem', { name: 'Show in Artifacts tab' }).tap()
    await dialog.waitFor({ state: 'detached' })
    expect(await page.getByRole('button', { name: 'Artifacts', exact: true }).getAttribute('aria-pressed')).toBe('true')
    const shown = page.getByRole('region', { name: 'This week across machines' })
    await shown.locator('iframe').waitFor()
    const box = (await shown.boundingBox())!
    expect(box.width).toBeGreaterThan(380)
    await page.reload()
    await shown.locator('iframe').waitFor()
    await shown.getByRole('button', { name: 'Close' }).tap()
    await page.getByRole('textbox', { name: /^Message home/ }).waitFor()
    await page.close()
  }, 30_000)
})
