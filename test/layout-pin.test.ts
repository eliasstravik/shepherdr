// The Tasks and Artifacts lists' chips: they follow the space picked (its own tasks, the main home space's too), × and
// + Filter edit them (a space or a whole machine; none, everything), and the pin keeps them whatever is picked, a task
// from them opening in the middle beside them; kept on this device, a pin to a place from before as its chips. In a
// real browser (layout.ts).
import { describe, expect, test } from 'bun:test'
import type { Page } from 'playwright-core'
import { layout } from './layout.ts'

const { browser, server } = await layout()
const at = (q: string) => `http://127.0.0.1:${server!.port}/?${q}`

/** the chips the lists show, by what they are ("p:vm-str:gtm", "m:mac") */
const chips = (page: Page) => page.locator('[data-chip]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.chip))

/** + Filter, then a place of its tree */
async function add(page: Page, name: string) {
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menu', { name: 'Filter by place' }).getByRole('menuitemcheckbox', { name, exact: true }).click()
}

describe.skipIf(!browser)('the lists’ chips', () => {
  test('a desktop: they follow the space picked; × and + Filter edit them, none is everything; another space, its own again', async () => {
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    page.setDefaultTimeout(10_000) // Surface the failing locator before the enclosing test deadline.
    await page.goto(at('place=vm-str/home'))
    const list = page.getByRole('region', { name: 'Tasks' })
    // The verified main Home defaults to cross-machine Needs you and Ready.
    await list.getByRole('button', { name: /GTM-14 Bundle/ }).waitFor()
    expect(await chips(page)).toEqual([])
    expect(await list.getByRole('button', { name: /GTM-17 Changelog/ }).count()).toBe(0)
    await page.locator('#places').getByRole('button', { name: /^gtm\b/ }).click()
    const gtm16 = list.getByRole('button', { name: /GTM-16 Docs/ })
    const lv3 = list.getByRole('button', { name: /LV-3 Upload page/ })
    await gtm16.waitFor()
    expect(await chips(page)).toEqual(['p:vm-str:gtm'])
    expect(await lv3.count()).toBe(0)
    // a space's rows say neither its machine nor its space
    expect(await gtm16.textContent()).not.toContain('vm-str')

    // a whole machine more: its tasks too, each row saying its machine and space
    await add(page, 'mac')
    await lv3.waitFor()
    expect(await chips(page)).toEqual(['p:vm-str:gtm', 'm:mac'])
    expect(await lv3.textContent()).toContain('mac · lilla-varlden')
    expect(await gtm16.textContent()).toContain('vm-str · gtm')
    // the search narrows within them
    await list.getByRole('searchbox', { name: 'Filter tasks' }).fill('upload')
    await gtm16.waitFor({ state: 'detached' })
    expect(await lv3.isVisible()).toBe(true)
    // and stays while the chips change
    await list.getByRole('button', { name: 'Remove mac' }).click()
    await lv3.waitFor({ state: 'detached' })
    expect(await list.getByRole('searchbox', { name: 'Filter tasks' }).inputValue()).toBe('upload')
    await add(page, 'mac')
    await lv3.waitFor()
    expect(await gtm16.count()).toBe(0)
    await list.getByRole('searchbox', { name: 'Filter tasks' }).fill('')
    await gtm16.waitFor()
    // × takes one off
    await list.getByRole('button', { name: 'Remove gtm · vm-str' }).click()
    await gtm16.waitFor({ state: 'detached' })
    expect(await chips(page)).toEqual(['m:mac'])
    // none left: everything, every machine's
    await list.getByRole('button', { name: 'Remove mac' }).click()
    await gtm16.waitFor()
    expect(await chips(page)).toEqual([])
    expect(await list.getByRole('group', { name: 'Showing' }).textContent()).toContain('Everything')
    expect(await lv3.isVisible()).toBe(true)
    expect(await list.getByRole('button', { name: /HP-201 Pinned count/ }).isVisible()).toBe(true)
    // following, another space puts its own chip back
    await page.locator('#places').getByRole('button', { name: /^herdr-projects\b/ }).click()
    await page.getByRole('textbox', { name: 'Message herdr-projects…' }).waitFor()
    await lv3.waitFor({ state: 'detached' })
    expect(await chips(page)).toEqual(['p:vm-str:herdr-projects'])
    await page.close()
  }, 30_000)

  test('a desktop: pinned, the chips stay while the middle goes to a space and to a task, kept on this device; unpinned, they follow again', async () => {
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    page.setDefaultTimeout(10_000) // Surface the failing locator before the enclosing test deadline.
    await page.goto(at('place=p:vm-str:gtm'))
    const list = page.getByRole('region', { name: 'Tasks' })
    await list.getByRole('button', { name: /GTM-16 Docs/ }).waitFor()
    await add(page, 'lilla-varlden · mac')
    const lv3 = list.getByRole('button', { name: /LV-3 Upload page/ })
    await lv3.waitFor()
    // what the filter says stays as they're pinned
    const box = list.getByRole('searchbox', { name: 'Filter tasks' })
    await box.fill('upload')
    await list.getByRole('button', { name: 'Keep filters: hold them when switching space' }).click()
    const pin = list.getByRole('button', { name: 'Filters kept: tap to follow the space picked' })
    expect(await pin.getAttribute('aria-pressed')).toBe('true')
    expect(await box.inputValue()).toBe('upload')
    expect(await list.getByRole('button', { name: /GTM-16 Docs/ }).count()).toBe(0)
    await box.fill('')

    // another space: its chat in the middle, the chips stay
    await page.locator('li[data-project="p:vm-str:~"]').getByRole('button', { name: /^home\b/ }).click()
    await page.getByRole('textbox', { name: 'Message home…' }).waitFor()
    expect(await chips(page)).toEqual(['p:vm-str:gtm', 'p:mac:lilla-varlden'])
    expect(await lv3.isVisible()).toBe(true)

    // a task from them opens in the middle, the list beside it, its row marked
    await lv3.click()
    await page.getByRole('textbox', { name: 'Message LV-3…' }).waitFor()
    expect(await page.getByRole('textbox', { name: 'Message home…' }).count()).toBe(0)
    expect(await lv3.getAttribute('aria-current')).toBe('true')
    const chat = (await page.getByRole('textbox', { name: 'Message LV-3…' }).boundingBox())!
    expect(chat.x + chat.width).toBeLessThan((await list.boundingBox())!.x)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('textbox', { name: /^Message (home|lilla-varlden)…$/ }).waitFor()

    // Artifacts show what the same chips hold, the same pin on them
    await list.getByRole('button', { name: 'Artifacts' }).click()
    const arts = page.getByRole('region', { name: 'Artifacts' })
    await arts.getByRole('button', { name: /Upload page draft/ }).waitFor()
    expect(await arts.getByRole('button', { name: /This week across machines/ }).count()).toBe(0)
    expect(await arts.getByRole('button', { name: 'Filters kept: tap to follow the space picked' }).isVisible()).toBe(true)
    await arts.getByRole('button', { name: /^Tasks/ }).click()

    // kept on this device
    await page.reload()
    await list.getByRole('button', { name: 'Filters kept: tap to follow the space picked' }).waitFor()
    expect(await chips(page)).toEqual(['p:vm-str:gtm', 'p:mac:lilla-varlden'])

    // unpinned, they follow the space picked again, and a task opens over the list as before
    await list.getByRole('button', { name: 'Filters kept: tap to follow the space picked' }).click()
    await list.getByRole('button', { name: 'Keep filters: hold them when switching space' }).waitFor()
    // Main Home's unlocked default still includes LV-3 because it needs you.
    await lv3.waitFor()
    expect(await chips(page)).toEqual([])
    await page.locator('#places').getByRole('button', { name: /^gtm\b/ }).click()
    expect(await chips(page)).toEqual(['p:vm-str:gtm'])
    await list.getByRole('button', { name: /GTM-16 Docs/ }).click()
    await page.getByRole('textbox', { name: 'Message GTM-16…' }).waitFor()
    expect(await page.getByRole('textbox', { name: 'Message gtm…' }).isVisible()).toBe(true)
    await page.close()
  }, 30_000)

  test('a pin to a place from before comes back as its chips: the main home space’s everything, a home space’s its machine', async () => {
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    page.setDefaultTimeout(10_000) // Surface the failing locator before the enclosing test deadline.
    await page.goto(at('place=p:vm-str:gtm'))
    const list = page.getByRole('region', { name: 'Tasks' })
    for (const [pin, want] of [
      ['p:vm-str:~', []],
      ['p:mac:~', ['m:mac']],
      ['p:vm-str:herdr-projects', ['p:vm-str:herdr-projects']],
    ] as const) {
      await page.evaluate((id) => {
        localStorage.removeItem('shepherdr.lists')
        localStorage.setItem('shepherdr.pin', id)
      }, pin)
      await page.reload()
      await list.getByRole('button', { name: 'Filters kept: tap to follow the space picked' }).waitFor()
      expect(await chips(page)).toEqual([...want])
      expect(await page.evaluate(() => localStorage.getItem('shepherdr.pin'))).toBeNull()
    }
    await page.close()
  }, 30_000)

  test('a phone: the Tasks tab’s chips scroll sideways, + Filter staying in view; pinned, they stay while the drawer picks another space', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    page.setDefaultTimeout(10_000) // Surface the failing locator before the enclosing test deadline.
    await page.goto(at('place=p:vm-str:gtm&tab=tasks'))
    await page.getByRole('button', { name: /GTM-16 Docs/ }).waitFor()
    for (const name of ['mac', 'herdr-projects · vm-str', 'nas']) await add(page, name)
    const row = page.getByRole('group', { name: 'Showing' })
    const { scroll, client } = await row.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
    expect(scroll).toBeGreaterThan(client)
    // the page itself doesn't scroll sideways, and + Filter is whole on screen
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    const plus = (await page.getByRole('button', { name: 'Filter', exact: true }).boundingBox())!
    expect(plus.x + plus.width).toBeLessThanOrEqual(390)

    await page.getByRole('button', { name: 'Keep filters: hold them when switching space' }).click()
    await page.getByRole('button', { name: 'Filters kept: tap to follow the space picked' }).waitFor()
    // the top bar says so, naming the first chip and how many more
    expect(await page.getByText('gtm · vm-str +3', { exact: true }).isVisible()).toBe(true)
    // another space from the drawer, then its Tasks tab: the pinned chips still
    await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).click()
    await page.locator('li[data-project="p:vm-str:~"]').getByRole('button', { name: /^home\b/ }).click()
    await page.getByRole('textbox', { name: 'Message home…' }).waitFor()
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: /^Tasks/ }).click()
    await page.getByRole('button', { name: /LV-3 Upload page/ }).waitFor()
    expect(await chips(page)).toEqual(['p:vm-str:gtm', 'm:mac', 'p:vm-str:herdr-projects', 'm:nas'])
    // Unlocked main Home returns to cross-machine attention.
    await page.getByRole('button', { name: 'Filters kept: tap to follow the space picked' }).click()
    await page.getByRole('button', { name: /LV-3 Upload page/ }).waitFor()
    expect(await chips(page)).toEqual([])
    expect(await page.getByRole('button', { name: /GTM-17 Changelog/ }).count()).toBe(0)
    await page.close()
  }, 30_000)
})
