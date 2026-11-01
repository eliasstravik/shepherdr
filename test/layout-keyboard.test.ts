// Message-local keys must not also invoke navigation behind the chat.
import { describe, expect, test } from 'bun:test'
import type { Page } from 'playwright-core'
import { layout, still } from './layout.ts'

const { browser, url } = await layout()

/** what wears a focus ring now, by what is drawn on the screen, not by its classes: our blue, or any outline at all
 *  (the browser's own ring is another blue). A text box keeps its own edge while it is typed in (it, and what holds
 *  it, don't count) */
const rings = (page: Page) =>
  page.evaluate(() => {
    const swatch = document.body.appendChild(document.createElement('i'))
    swatch.style.color = 'var(--focus)'
    const blue = getComputedStyle(swatch).color
    swatch.remove()
    const typing = document.activeElement?.closest('input, textarea') ?? null
    return [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => !typing || !el.contains(typing))
      .filter((el) => {
        const [c, after] = [getComputedStyle(el), getComputedStyle(el, '::after')]
        return (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0) || c.boxShadow.includes(blue) || after.boxShadow.includes(blue)
      })
      .map((el) => el.getAttribute('aria-label') ?? el.dataset.flip ?? el.textContent?.slice(0, 30) ?? el.tagName)
  })
const row = (page: Page, id: string) => page.locator(`section[aria-label="Tasks"] li[data-flip="${id}"]`)
/** a task opened with the mouse, or a finger, and then shut by Esc (nothing in it holds the focus) */
const openAndShut = async (page: Page, open: () => Promise<void>) => {
  await open()
  await page.locator('textarea[name=message]').first().waitFor()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('task'))
}

describe.skipIf(!browser)('a focus ring is for the keyboard moving the focus', () => {
  test('a mouse leaves no ring, whatever keys follow it', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    page.setDefaultTimeout(5000)
    try {
      await page.goto(url())
      await row(page, 'GTM-15').waitFor()
      // Esc back to the list: the row it came from keeps the keys' place, without a ring on it
      await openAndShut(page, () => row(page, 'GTM-15').getByRole('button').first().click())
      expect(await rings(page)).toEqual([])
      // a menu opened with the mouse and shut by Esc: the focus goes back to its button
      await row(page, 'GTM-15').hover()
      const more = row(page, 'GTM-15').getByRole('button', { name: 'More for this task' })
      await more.click()
      await page.getByRole('menu').waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('menu').waitFor({ state: 'detached' })
      expect(await more.evaluate((b) => b === document.activeElement && b.matches(':focus-visible'))).toBe(true)
      expect(await rings(page)).toEqual([])
      // a clicked button, and any key after it: Shift, a letter. The browser would show it (:focus-visible)
      const heading = page.locator('section[aria-label="Tasks"] button[aria-pressed="true"]').first()
      await heading.click()
      await page.keyboard.press('Shift')
      expect(await heading.evaluate((b) => b === document.activeElement && b.matches(':focus-visible'))).toBe(true)
      expect(await rings(page)).toEqual([])
      await page.keyboard.press('q')
      expect(await rings(page)).toEqual([])
      // an arrow-like key that moves no focus
      await page.keyboard.press('Home')
      expect(await rings(page)).toEqual([])
    } finally { await page.close() }
  }, 30_000)

  test('a button beside a text box leaves no ring on the box', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    page.setDefaultTimeout(5000)
    try {
      await page.goto(url())
      await page.getByRole('button', { name: 'New section' }).click()
      await page.getByRole('button', { name: 'Pick an emoji' }).click()
      expect(await rings(page)).toEqual([])
    } finally { await page.close() }
  }, 30_000)

  test('typing leaves no ring on what the focus goes to next, and the caret keys are not moving the focus', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    page.setDefaultTimeout(5000)
    try {
      await page.goto(url())
      const box = page.locator('textarea[name=message]').first()
      await box.click()
      await page.keyboard.type('hello')
      await page.keyboard.press('ArrowLeft')
      expect(await rings(page)).toEqual([])
      // a script moves on from a text box: the browser carries its :focus-visible over
      const button = page.locator('section[aria-label="Tasks"] li button').first()
      await button.evaluate((b: HTMLElement) => b.focus())
      expect(await button.evaluate((b) => b.matches(':focus-visible'))).toBe(true)
      expect(await rings(page)).toEqual([])
      await page.mouse.move(640, 300)
      expect(await rings(page)).toEqual([])
      // Tab into the box and then type: the rings stop with the first letter
      await box.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('x')
      await button.evaluate((b: HTMLElement) => b.focus())
      expect(await rings(page)).toEqual([])
    } finally { await page.close() }
  }, 30_000)

  test('Tab, the arrows and J, K show it, until a pointer is pressed', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    page.setDefaultTimeout(5000)
    try {
      await page.goto(url())
      await row(page, 'GTM-15').waitFor()
      // the chat's header, where a click opens nothing
      const press = () => page.mouse.click(560, 18)
      await page.keyboard.press('Tab')
      expect(await rings(page)).toHaveLength(1)
      await page.keyboard.press('Tab')
      expect(await rings(page)).toHaveLength(1)
      // a letter that isn't typed anywhere (a shortcut, say) leaves the keys their ring
      await page.keyboard.press('q')
      expect(await rings(page)).toHaveLength(1)
      await press()
      expect(await rings(page)).toEqual([])
      // a row Esc came back to keeps the cursor's place: a Tab elsewhere doesn't light it again
      await openAndShut(page, () => row(page, 'GTM-15').getByRole('button').first().click())
      await page.keyboard.press('Tab')
      expect(await rings(page)).toHaveLength(1)
      expect(await rings(page)).not.toContain('GTM-15')
      await press()
      expect(await rings(page)).toEqual([])
      await page.reload()
      await row(page, 'GTM-15').waitFor()
      // the tasks' own cursor: not the focus, the same ring
      const cursor = await page.$$eval('section[aria-label="Tasks"] li[data-flip]', (li) => li.slice(0, 2).map((l) => (l as HTMLElement).dataset.flip!))
      await page.keyboard.press('ArrowDown')
      expect(await rings(page)).toEqual([cursor[1]])
      await page.keyboard.press('k')
      expect(await rings(page)).toEqual([cursor[0]])
      await page.keyboard.press('j')
      expect(await rings(page)).toEqual([cursor[1]])
      await press()
      expect(await rings(page)).toEqual([])
      // an arrow that takes the focus somewhere, from a menu the mouse opened
      await row(page, 'GTM-15').hover()
      await row(page, 'GTM-15').getByRole('button', { name: 'More for this task' }).click()
      await page.getByRole('menu').waitFor()
      expect(await rings(page)).toEqual([])
      await page.keyboard.press('ArrowDown')
      expect(await rings(page)).toHaveLength(1)
    } finally { await page.close() }
  }, 30_000)

  test('a finger leaves no ring on a phone', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    page.setDefaultTimeout(5000)
    try {
      await page.goto(url())
      const menu = page.getByRole('button', { name: 'Menu', exact: true })
      // focus put on it by code on a new page: the browser would show it
      await menu.evaluate((b: HTMLElement) => b.focus())
      expect(await menu.evaluate((b) => b.matches(':focus-visible'))).toBe(true)
      expect(await rings(page)).toEqual([])
      await menu.tap()
      await page.getByRole('menu').waitFor()
      expect(await rings(page)).toEqual([])
      await page.touchscreen.tap(195, 600)
      await page.getByRole('menu').waitFor({ state: 'detached' })
      expect(await rings(page)).toEqual([])
    } finally { await page.close() }
  }, 30_000)
})

describe.skipIf(!browser)('chat keyboard ownership', () => {
  test('Enter on a focused message opens reactions and keeps the coordinator chat', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    page.setDefaultTimeout(5000)
    try {
      await page.goto(url())
      const message = page.locator('[data-msg="long-agent"] [data-anchor]')
      await message.waitFor()
      // Initial lazy artifact frames can move the chat; opening reactions during
      // that scroll correctly closes the anchored bar. Wait until the message settles.
      await still(message)
      await message.focus()
      const before = page.url()
      await message.press('Enter')
      await page.locator('[role=dialog][aria-label=React]').waitFor({ state: 'visible' })
      expect(page.url()).toBe(before)
      await page.keyboard.press('Escape')
      await page.locator('[role=dialog][aria-label=React]').waitFor({ state: 'detached' })
      expect(page.url()).toBe(before)
    } finally { await page.close() }
  }, 30_000)
})
