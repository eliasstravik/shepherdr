// The app as an iPhone shows it: Safari's engine (WebKit), at the sizes of an app on the home screen, from the iPhone 15
// down to the smallest (an SE, and 320px wide in Display Zoom). What a narrow screen, a finger and Safari need: tabs
// and menus that fit, targets a finger finds, boxes Safari doesn't zoom into, and room left over the keyboard.
import { describe, expect, test } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { devices, type Page } from 'playwright-core'
import { SCREENS, splashName } from '../scripts/splash.ts'
import { layout, settled } from './layout.ts'

const { browser, server } = await layout({ webkit: true })

/** each one's page as an app on the home screen: the screen less the status bar */
const PHONES = {
  'iPhone 15': { width: 393, height: 793 },
  'iPhone SE (3rd gen)': { width: 375, height: 647 },
  'iPhone SE': { width: 320, height: 548 },
} as const
type Phone = keyof typeof PHONES

async function open(phone: Phone, q: string, colorScheme: 'light' | 'dark' = 'light') {
  const ctx = await browser!.newContext({ ...devices[phone], viewport: PHONES[phone], colorScheme, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${server!.port}/?${q}`)
  return page
}
const done = (page: Page) => page.context().close()

/** what a finger lands on at a spot, as the element's own (or one inside it) */
const lands = (page: Page, sel: string, dx: number, dy: number) =>
  page.locator(sel).first().evaluate((e, [dx, dy]) => {
    const r = e.getBoundingClientRect()
    const at = document.elementFromPoint(r.x + r.width / 2 + dx, (dy < 0 ? r.top : r.bottom) + dy)
    return !!at && e.contains(at)
  }, [dx, dy])

describe.skipIf(!browser)('an iPhone', () => {
  for (const phone of Object.keys(PHONES) as Phone[])
    test(`the bottom bar's tabs fit with their words whole, beside Search (${phone})`, async () => {
      const page = await open(phone, 'place=vm-str/gtm', phone === 'iPhone SE' ? 'dark' : 'light')
      const bar = page.getByRole('group', { name: 'View' })
      await bar.waitFor()
      const fit = await bar.evaluate((g) => {
        const search = g.nextElementSibling!.getBoundingClientRect()
        const tabs = [...g.querySelectorAll('button')]
        return {
          whole: tabs.every((t) => t.scrollWidth <= t.clientWidth + 1),
          apart: tabs.every((t, i) => i === 0 || tabs[i - 1].getBoundingClientRect().right <= t.getBoundingClientRect().left + 1),
          beside: g.getBoundingClientRect().right <= search.left,
          inside: search.right <= innerWidth,
          icons: tabs.map((t) => getComputedStyle(t.querySelector('svg')!).display !== 'none'),
        }
      })
      expect(fit).toMatchObject({ whole: true, apart: true, beside: true, inside: true })
      // four tabs and Search: a phone has room for the words only
      expect(fit.icons).toEqual(fit.icons.map(() => false))
      await done(page)
    }, 30_000)

  test('every box takes 16px type or more, so Safari never zooms the page in on a tap', async () => {
    const small: string[] = []
    const check = async (page: Page, where: string) => {
      await settled(page)
      const found = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('input:not([type=checkbox], [type=radio], [type=range], [type=file]), textarea, select')]
          .filter((e) => e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 16)
          .map((e) => e.getAttribute('aria-label') ?? e.getAttribute('placeholder') ?? e.getAttribute('name') ?? e.tagName),
      )
      small.push(...found.map((f) => `${where}: ${f}`))
    }
    const page = await open('iPhone SE (3rd gen)', 'place=vm-str/gtm')
    await page.getByRole('textbox', { name: 'Message gtm…' }).waitFor()
    await check(page, 'chat')
    await page.getByRole('button', { name: 'Tasks', exact: false }).first().click()
    await page.getByRole('searchbox', { name: 'Filter tasks' }).waitFor()
    await check(page, 'tasks')
    await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).click()
    await page.getByRole('button', { name: 'New space on vm-str' }).click()
    await page.getByRole('combobox', { name: 'Folder' }).waitFor()
    await check(page, 'new space')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Search' }).last().click()
    await page.getByRole('dialog').getByRole('combobox').or(page.getByRole('dialog').getByRole('searchbox')).first().waitFor()
    await check(page, 'search')
    expect(small).toEqual([])
    await done(page)
  }, 30_000)

  test("the filter chips' × and + Filter take a finger's 44px, past their 36px pills", async () => {
    const page = await open('iPhone SE (3rd gen)', 'place=vm-str/gtm&tab=tasks')
    const x = 'button[aria-label="Remove gtm · vm-str"]'
    const add = 'button[aria-haspopup=menu]:has-text("Filter")'
    await page.locator(x).waitFor()
    for (const sel of [x, add]) {
      expect((await page.locator(sel).boundingBox())!.height).toBe(36)
      expect([await lands(page, sel, 0, 3), await lands(page, sel, 0, -3)]).toEqual([true, true])
    }
    await done(page)
  }, 30_000)

  test("a space's menu, held in the drawer, stays on the screen, however narrow", async () => {
    for (const phone of ['iPhone SE (3rd gen)', 'iPhone SE'] as const) {
      const page = await open(phone, 'place=vm-str/gtm')
      await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).click()
      const row = page.locator('nav li:has(button[aria-label^="gtm,"])').first()
      await row.waitFor()
      await settled(page)
      await row.dispatchEvent('contextmenu')
      const menu = page.getByRole('menu', { name: 'gtm' })
      await menu.waitFor()
      await settled(page)
      const r = (await menu.boundingBox())!
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.x + r.width).toBeLessThanOrEqual(PHONES[phone].width)
      await done(page)
    }
  }, 30_000)

  test("an artifact full screen keeps its title whole, its version and age on the line under it", async () => {
    const page = await open('iPhone SE (3rd gen)', 'place=vm-str/gtm&tab=artifacts')
    await page.getByText('Onboarding deck').first().click()
    const title = page.locator('[role=dialog] .font-semibold, .font-semibold').filter({ hasText: 'Onboarding deck' }).last()
    await title.waitFor()
    await settled(page)
    const t = await title.evaluate((e) => ({ whole: e.scrollWidth <= e.clientWidth, under: e.nextElementSibling!.getBoundingClientRect().top >= e.getBoundingClientRect().bottom - 1, meta: e.nextElementSibling!.textContent }))
    expect(t).toMatchObject({ whole: true, under: true })
    expect(t.meta).toMatch(/^v1 · /)
    await done(page)
  }, 30_000)

  test("New space with the keyboard up keeps the folders in view; Cancel and Create come back once it's down", async () => {
    const page = await open('iPhone SE (3rd gen)', 'place=vm-str/gtm')
    await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).click()
    await page.getByRole('button', { name: 'New space on vm-str' }).click()
    const folder = page.getByRole('combobox', { name: 'Folder' })
    await folder.waitFor()
    await settled(page)
    const create = page.getByRole('button', { name: 'Create space' })
    expect(await create.isVisible()).toBe(true)
    // the keyboard comes up: the page is as tall as what's left over it
    await folder.focus()
    await page.setViewportSize({ width: 375, height: 647 - 260 })
    await create.waitFor({ state: 'hidden' })
    await settled(page)
    const list = (await page.getByRole('listbox', { name: 'Folders' }).boundingBox())!
    expect(list.height).toBeGreaterThan(2 * 44)
    expect(list.y + list.height).toBeLessThanOrEqual(647 - 260)
    // and down again
    await folder.blur()
    await page.setViewportSize({ width: 375, height: 647 })
    await create.waitFor()
    await done(page)
  }, 30_000)

  test("a task chat's tool rows are 36px for a finger, and a reaction's pill takes a tap 8px past its edge", async () => {
    const page = await open('iPhone 15', 'place=vm-str/gtm&task=GTM-15')
    const row = page.locator('[data-row] > button').first()
    await row.waitFor()
    for (const h of await page.locator('[data-row] > button').evaluateAll((b) => b.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(36)
    const pill = 'button[aria-pressed][data-keep-box]'
    await page.locator(pill).first().scrollIntoViewIfNeeded()
    expect(await lands(page, pill, 0, 6)).toBe(true)
    await done(page)
  }, 30_000)
})

describe('the launch screen', () => {
  test("each iPhone size has a light and a dark one at its exact pixels, which index.html picks by the screen's own mode", () => {
    const root = join(import.meta.dir, '..')
    const html = readFileSync(join(root, 'index.html'), 'utf8')
    for (const [w, h, r] of SCREENS)
      for (const theme of ['light', 'dark'] as const) {
        const file = splashName(w, h, r, theme)
        expect(html).toContain(`media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait) and (prefers-color-scheme: ${theme})" href="${file}"`)
        const png = join(root, 'public', file)
        expect(existsSync(png)).toBe(true)
        const b = readFileSync(png)
        expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([w * r, h * r])
      }
  })
})
