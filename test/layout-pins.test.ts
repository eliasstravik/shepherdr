// Pinned spaces: a space's ⋯ moves it to Pinned, over the sidebar's tree, in a real browser (layout.ts).
import { describe, expect, test } from 'bun:test'
import type { Locator, Page } from 'playwright-core'
import { layout, settled } from './layout.ts'

const { browser, world, url } = await layout()

describe.skipIf(!browser)('pinned spaces', () => {
  /** the sidebar's rows, top to bottom */
  const rows = (page: Page, sel = '#places') => page.$$eval(`${sel} li`, (ls) => ls.map((l) => (l as HTMLElement).innerText.split('\n')[0]))
  const pinned = (page: Page, sel = '#places') => page.$$eval(`${sel} li[data-pin]`, (ls) => ls.map((l) => (l as HTMLElement).innerText.split('\n')[0]))
  const open = (page: Page) => page.$$eval('#places li', (ls) => ls.filter((l) => l.querySelector('[aria-current]')).map((l) => (l as HTMLElement).innerText.split('\n')[0]))
  const at = (page: Page, place: string) => page.waitForFunction((p) => new URL(location.href).searchParams.get('place') === p, place)
  /** a row's ⋯ (tucked away until the pointer is on it), then Pin or Unpin */
  const pin = async (row: Locator, more: string, item = 'Pin') => {
    await row.hover()
    await row.getByRole('button', { name: more }).click()
    await row.page().getByRole('menuitem', { name: item, exact: true }).click()
  }
  const forget = () => {
    world.order = {}
    world.emit('snapshot')
  }

  test("a space's ⋯ moves it to Pinned, out of the tree, spaces only; it walks, drags, folds and unpins back (desktop)", async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    page.setDefaultTimeout(10_000) // Surface the failing locator before the enclosing test deadline.
    try {
      await page.goto(url())
      await page.waitForSelector('#places li')
      // nothing pinned: no Pinned
      expect(await page.getByRole('heading', { name: 'Pinned' }).count()).toBe(0)
      const tree = ['mac', 'home', 'lilla-varlden', 'nas', 'home', 'vm-str', 'home', 'gtm', 'herdr-projects']
      expect(await rows(page)).toEqual(tree)
      // a space, then a home space, from their ⋯, in the wording of a task's; a machine heading has no Pin
      const proj = page.locator('#places li[data-project="p:vm-str:herdr-projects"]')
      const mac = page.locator('#places li[data-project="p:mac:~"]')
      await pin(proj, 'More for herdr-projects')
      await pin(mac, 'More for home')
      await page.getByRole('heading', { name: 'Pinned' }).waitFor()
      await page.waitForFunction(() => document.querySelectorAll('#places li[data-pin]').length === 2)
      // each moved: shown once, in Pinned, its machine after its name
      expect(await rows(page)).toEqual(['Pinned', 'herdr-projects · vm-str', 'home · mac', 'mac', 'lilla-varlden', 'nas', 'home', 'vm-str', 'home', 'gtm'])
      expect(await pinned(page)).toEqual(['herdr-projects · vm-str', 'home · mac'])
      // Pinned has its pin, each space its #, each machine its server (SHE-207): sections side by side, no level over them
      expect(await page.locator('#places li [data-icon]').evaluateAll((s) => s.map((x) => x.getAttribute('data-icon')))).toEqual(['pin', 'hash', 'hash', 'server', 'hash', 'server', 'hash', 'server', 'hash', 'hash'])
      expect(world.order).toEqual({ pinned: ['p:vm-str:herdr-projects', 'p:mac:~'] })
      await page.locator('#places li[data-heading="m:vm-str"]').hover()
      await page.getByRole('button', { name: 'More for vm-str' }).click()
      expect(await page.getByRole('menuitem', { name: 'Pin', exact: true }).count()).toBe(0)
      await page.keyboard.press('Escape')
      // its count and bold, once
      expect(await page.locator('#places').getByLabel('1 needs you, 0 ready · here', { exact: true }).count()).toBe(1)
      expect(await proj.getByLabel('1 needs you, 0 ready · here', { exact: true }).count()).toBe(1)
      expect(Number(await proj.locator('button > span').evaluate((s) => getComputedStyle(s).fontWeight))).toBeGreaterThanOrEqual(600)

      // Unpin puts it back in its place in the tree
      await pin(proj, 'More for herdr-projects', 'Unpin')
      await page.waitForFunction(() => document.querySelectorAll('#places li[data-pin]').length === 1)
      expect(await rows(page)).toEqual(['Pinned', 'home · mac', 'mac', 'lilla-varlden', 'nas', 'home', 'vm-str', 'home', 'gtm', 'herdr-projects'])
      await pin(proj, 'More for herdr-projects')
      await page.waitForFunction(() => document.querySelectorAll('#places li[data-pin]').length === 2)
      expect(await pinned(page)).toEqual(['home · mac', 'herdr-projects · vm-str'])

      // its one row shows open
      await proj.getByRole('button', { name: 'herdr-projects on vm-str, 1 need you, 0 ready here' }).click()
      await at(page, 'vm-str/herdr-projects')
      expect(await open(page)).toEqual(['herdr-projects · vm-str'])

      // Pinned reads as a peer of the machines: the same size, weight, colour and chevron, in line
      const look = (sel: string) =>
        page.locator(sel).evaluate((li) => {
          const name = li.querySelector('h2 span')!
          const chev = li.querySelector('button[aria-expanded]')!.getBoundingClientRect()
          const s = getComputedStyle(name)
          return { size: s.fontSize, weight: s.fontWeight, color: s.color, x: Math.round(name.getBoundingClientRect().left), chev: Math.round(chev.left), h: Math.round(li.getBoundingClientRect().height) }
        })
      expect(await look('#places li[data-heading="pinned"]')).toEqual(await look('#places li[data-heading="m:mac"]'))

      // Alt+↑/↓ walks Pinned first, then the tree, each space once, past the headings
      await mac.getByRole('button', { name: /^home on mac/ }).click()
      await at(page, 'mac/home')
      for (const id of ['vm-str/herdr-projects', 'mac/lilla-varlden', 'nas/home', 'vm-str/home']) {
        await page.keyboard.press('Alt+ArrowDown')
        await at(page, id)
      }
      for (const id of ['nas/home', 'mac/lilla-varlden', 'vm-str/herdr-projects']) {
        await page.keyboard.press('Alt+ArrowUp')
        await at(page, id)
      }
      expect(await open(page)).toEqual(['herdr-projects · vm-str'])

      // dragged into another order, kept for every device
      const b = (await proj.boundingBox())!
      await page.mouse.move(b.x + 40, b.y + b.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + 40, b.y + b.height / 2 - 40, { steps: 8 })
      await page.mouse.up()
      expect(await pinned(page)).toEqual(['herdr-projects · vm-str', 'home · mac'])
      expect(world.order.pinned).toEqual(['p:vm-str:herdr-projects', 'p:mac:~'])
      const other = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
      await other.goto(url())
      await other.waitForSelector('#places li[data-pin]')
      expect(await pinned(other)).toEqual(['herdr-projects · vm-str', 'home · mac'])
      await other.close()

      // folded, Pinned hides every space in it, what waits on you and the open one too, with a red dot for what waits;
      // nas's home can't be reached, so no menu: pinned as another device would
      const pins = world.order.pinned
      world.order = { pinned: [...pins, 'p:nas:~'] }
      world.emit('snapshot')
      await page.waitForFunction(() => document.querySelectorAll('#places li[data-pin]').length === 3)
      await page.getByRole('button', { name: 'Pinned', exact: true }).click()
      expect(await pinned(page)).toEqual([])
      expect(await page.locator('#places li[data-heading="pinned"] [data-inside]').getAttribute('data-inside')).toBe('needs')
      // gone to from search, a folded Pinned opens to show it
      await page.getByRole('button', { name: /^Search or jump to/ }).click()
      await page.getByRole('combobox', { name: 'Search or jump to' }).fill('home nas')
      await page.keyboard.press('Enter')
      await at(page, 'nas/home')
      await page.waitForFunction(() => document.querySelectorAll('#places li[data-pin]').length === 3)
      expect(await open(page)).toEqual(['home · nas'])
      world.order = { pinned: pins }
      world.emit('snapshot')
      await page.waitForFunction(() => document.querySelectorAll('#places li[data-pin]').length === 2)

      // all unpinned: Pinned goes, the tree is as it was
      for (const [row, more] of [
        [proj, 'More for herdr-projects'],
        [mac, 'More for home'],
      ] as const)
        await pin(row, more, 'Unpin')
      await page.getByRole('heading', { name: 'Pinned' }).waitFor({ state: 'detached' })
      expect(world.order.pinned).toEqual([])
      // shown at once last under its machine, then first again (a home space) once the server says
      await page.waitForFunction(() => {
        const ls = [...document.querySelectorAll('#places li')]
        const at = (id: string) => ls.findIndex((l) => l.getAttribute('data-project') === id)
        return at('p:mac:~') >= 0 && at('p:mac:~') < at('p:mac:lilla-varlden')
      })
      expect(await rows(page)).toEqual(tree)
    } finally {
      await page.close()
      forget()
    }
  }, 30_000)

  test('a phone: Pinned tops the drawer, a peer of the machines, each row whole with its machine (phone)', async () => {
    world.order = { pinned: ['p:mac:lilla-varlden', 'p:vm-str:~'] }
    world.emit('snapshot')
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    page.setDefaultTimeout(10_000) // Surface the failing locator before the enclosing test deadline.
    try {
      await page.goto(url())
      await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
      const nav = 'nav[aria-label="Spaces"]'
      await page.locator(`${nav} li[data-pin]`).first().waitFor()
      await settled(page)
      // moved out of the tree; the machines stay, vm-str with the spaces not pinned
      expect(await rows(page, nav)).toEqual(['Pinned', 'lilla-varlden · mac', 'home · vm-str', 'mac', 'home', 'nas', 'home', 'vm-str', 'gtm', 'herdr-projects'])
      // its name and machine fit, nothing cut short
      expect(await page.locator(`${nav} li[data-pin] button > span`).first().evaluate((s) => s.scrollWidth <= s.clientWidth)).toBe(true)
      // a tap opens it, there
      await page.locator(`${nav} li[data-pin="p:mac:lilla-varlden"]`).getByRole('button', { name: /^lilla-varlden on mac/ }).click()
      await at(page, 'mac/lilla-varlden')
    } finally {
      await page.close()
      forget()
    }
  }, 30_000)
})
