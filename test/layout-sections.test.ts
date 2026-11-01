// Sections of the sidebar, as Slack's (SHE-225): one at the top from the header's +, one inside a machine from its ⋯;
// spaces move in from their ⋯ or by a drag onto a heading, and back; renamed, folded, deleted. In a real browser (layout.ts).
import { describe, expect, test } from 'bun:test'
import type { Locator, Page } from 'playwright-core'
import { layout, settled } from './layout.ts'

const { browser, world, url } = await layout()

describe.skipIf(!browser)('sections', () => {
  /** the sidebar's rows, top to bottom, by name (a section's emoji is its icon, not its name) */
  const rows = (page: Page, sel = '#places') =>
    page.$$eval(`${sel} li`, (ls) =>
      ls.map((l) => {
        const emoji = l.querySelector('[data-icon="emoji"]')?.textContent
        return (l as HTMLElement).innerText.split('\n').filter((t) => t !== emoji)[0]
      }),
    )
  const at = (page: Page, place: string) => page.waitForFunction((p) => new URL(location.href).searchParams.get('place') === p, place)
  const forget = () => {
    world.order = {}
    world.groups = {}
    world.emit('snapshot')
  }
  /** makes a section in the dialog: its name, then Create */
  const make = async (page: Page, name: string) => {
    const box = page.getByRole('textbox', { name: 'Section name' })
    await box.waitFor()
    await box.fill(name)
    await page.getByRole('button', { name: 'Create' }).click()
    await box.waitFor({ state: 'detached' })
  }
  /** a space's ⋯, Move to section, then where */
  const move = async (row: Locator, more: string, to: string) => {
    await row.hover()
    await row.getByRole('button', { name: more }).click()
    await row.page().getByRole('menuitem', { name: 'Move to section' }).click()
    await row.page().getByRole('menuitem', { name: to, exact: true }).click()
  }
  const idOf = (name: string) => Object.entries(world.groups).find(([, d]) => d.name === name)![0]

  test('made at the top and in a machine; spaces move in from their ⋯ and by a drag, show their machine at the top, fold, walk, rename and delete back (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await page.goto(url())
      await page.waitForSelector('#places li')
      expect(await rows(page)).toEqual(['mac', 'home', 'lilla-varlden', 'nas', 'home', 'vm-str', 'home', 'gtm', 'herdr-projects'])

      // the header's + makes one at the top; a machine's ⋯ one inside it, its menu saying Rename machine
      await page.getByRole('button', { name: 'New section' }).click()
      await make(page, 'Clients')
      await page.locator('#places li[data-heading="m:vm-str"]').click({ button: 'right' })
      expect(await page.getByRole('menuitem').allInnerTexts()).toEqual(['New space…', 'New section…', 'Rename machine…'])
      await page.getByRole('menuitem', { name: 'New section…' }).click()
      await make(page, 'Labs')
      await page.locator('#places li[data-heading]', { hasText: 'Labs' }).waitFor()
      expect(world.groups[idOf('Clients')]).toEqual({ name: 'Clients' })
      expect(world.groups[idOf('Labs')]).toEqual({ name: 'Labs', machine: 'vm-str' })
      // an empty one shows; Pinned doesn't while it holds nothing
      expect(await rows(page)).toEqual(['Clients', 'mac', 'home', 'lilla-varlden', 'nas', 'home', 'vm-str', 'home', 'gtm', 'herdr-projects', 'Labs'])

      // Move to section offers the machine's sections, those at the top, and the machine; where it is says Here
      const gtm = page.locator('#places li[data-project="p:vm-str:gtm"]')
      await gtm.hover()
      await gtm.getByRole('button', { name: 'More for gtm' }).click()
      await page.getByRole('menuitem', { name: 'Move to section' }).click()
      expect((await page.getByRole('menuitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())).toEqual(['Move to section', 'Labs', 'Pinned', 'Clients', 'vm-str Here'])
      expect(await page.getByRole('menuitem', { name: /^vm-str/ }).isDisabled()).toBe(true)
      await page.getByRole('menuitem', { name: 'Labs', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('#places li[data-project="p:vm-str:gtm"]')?.getAttribute('data-section')?.startsWith('s:'))
      // a mac space can't go in vm-str's
      const lilla = page.locator('#places li[data-project="p:mac:lilla-varlden"]')
      await lilla.hover()
      await lilla.getByRole('button', { name: 'More for lilla-varlden' }).click()
      await page.getByRole('menuitem', { name: 'Move to section' }).click()
      expect(await page.getByRole('menuitem', { name: 'Labs', exact: true }).count()).toBe(0)
      await page.getByRole('menuitem', { name: 'Clients', exact: true }).click()
      // at the top it shows its machine, as Pinned does; in a machine's section, it sits in under it
      await page.locator('#places li', { hasText: 'lilla-varlden · mac' }).waitFor()
      expect(await rows(page)).toEqual(['Clients', 'lilla-varlden · mac', 'mac', 'home', 'nas', 'home', 'vm-str', 'home', 'herdr-projects', 'Labs', 'gtm'])
      // as Slack's: each space's # under its heading's name; a machine's section one small step in
      const x = (sel: string) => page.locator(sel).locator('[data-icon]').first().evaluate((e) => Math.round(e.getBoundingClientRect().left))
      const text = (sel: string) => page.locator(sel).locator('h2 span').first().evaluate((e) => Math.round(e.getBoundingClientRect().left))
      expect(Math.abs((await x('#places li[data-project="p:mac:lilla-varlden"]')) - (await text('#places li[data-heading^="s:"]:not([data-machine])')))).toBeLessThanOrEqual(1)
      expect(Math.abs((await x('#places li[data-project="p:vm-str:gtm"]')) - (await text('#places li[data-heading^="s:"][data-machine]')))).toBeLessThanOrEqual(1)
      expect(await x('#places li[data-project="p:vm-str:gtm"]')).toBe((await x('#places li[data-project="p:vm-str:~"]')) + 12)
      expect(world.order[idOf('Labs')]).toEqual(['p:vm-str:gtm'])

      // its count and bold go with it
      expect(await gtm.getByLabel('4 needs you, 1 ready · here', { exact: true }).count()).toBe(1)

      // a drag onto a heading moves it in: herdr-projects onto Clients, last; the heading lights up on the way
      const hp = page.locator('#places li[data-project="p:vm-str:herdr-projects"]')
      const from = (await hp.boundingBox())!
      const to = (await page.locator('#places li[data-heading^="s:"]', { hasText: 'Clients' }).boundingBox())!
      await page.mouse.move(from.x + 60, from.y + from.height / 2)
      await page.mouse.down()
      await page.mouse.move(from.x + 60, to.y + to.height / 2, { steps: 10 })
      expect(await page.locator('#places li[data-drop-over="heading"]').innerText()).toContain('Clients')
      await page.mouse.up()
      await page.locator('#places li', { hasText: 'herdr-projects · vm-str' }).waitFor()
      expect(await rows(page)).toEqual(['Clients', 'lilla-varlden · mac', 'herdr-projects · vm-str', 'mac', 'home', 'nas', 'home', 'vm-str', 'home', 'Labs', 'gtm'])
      expect(world.order[idOf('Clients')]).toEqual(['p:mac:lilla-varlden', 'p:vm-str:herdr-projects'])
      // the press it ended with opened nothing
      expect(page.url()).not.toContain('herdr-projects')

      // another device sees it all
      const other = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
      await other.goto(url())
      await other.locator('#places li', { hasText: 'herdr-projects · vm-str' }).waitFor()
      expect(await rows(other)).toEqual(await rows(page))
      await other.close()

      // Alt+↓ walks them as they show: Clients' spaces first, then the machines, a machine's section last
      await page.locator('#places li[data-project="p:mac:lilla-varlden"]').getByRole('button', { name: /^lilla-varlden/ }).click()
      await at(page, 'mac/lilla-varlden')
      for (const id of ['vm-str/herdr-projects', 'mac/home', 'nas/home', 'vm-str/home', 'vm-str/gtm']) {
        await page.keyboard.press('Alt+ArrowDown')
        await at(page, id)
      }
      await page.keyboard.press('Alt+ArrowUp')
      await at(page, 'vm-str/home')

      // folded, a section hides its spaces with a dot for what waits; vm-str folded hides Labs too
      await page.locator('#places li[data-heading^="s:"]', { hasText: 'Clients' }).getByRole('button', { name: 'Clients', exact: true }).click()
      expect(await page.locator('#places li[data-heading^="s:"]', { hasText: 'Clients' }).locator('[data-inside]').getAttribute('data-inside')).toBe('needs')
      await page.locator('#places li[data-heading="m:vm-str"]').getByRole('button', { name: 'vm-str', exact: true }).click()
      expect(await rows(page)).toEqual(['Clients', 'mac', 'home', 'nas', 'home', 'vm-str'])
      // gone to from search, both open again to show it
      await page.getByRole('button', { name: /^Search or jump to/ }).click()
      await page.getByRole('combobox', { name: 'Search or jump to' }).fill('gtm')
      await page.keyboard.press('Enter')
      await at(page, 'vm-str/gtm')
      await page.locator('#places li[data-project="p:vm-str:gtm"]').waitFor()
      // search lists the spaces in the sidebar's order
      await page.getByRole('button', { name: /^Search or jump to/ }).click()
      const found = await page.getByRole('option').allInnerTexts()
      await page.keyboard.press('Escape')
      const order = ['lilla-varlden', 'herdr-projects', 'home', 'home', 'home', 'gtm']
      expect(found.map((t) => t.split('\n')[0]).filter((t) => order.includes(t))).toEqual(order)
      await page.locator('#places li[data-heading^="s:"]', { hasText: 'Clients' }).getByRole('button', { name: 'Clients', exact: true }).click()

      // renamed from its ⋯, an emoji too
      const clients = page.locator('#places li[data-heading^="s:"]', { hasText: 'Clients' })
      await clients.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Rename section…' }).click()
      const name = page.getByRole('textbox', { name: 'Section name' })
      await name.fill('Customers')
      await page.getByRole('button', { name: 'Pick an emoji' }).click()
      await page.getByRole('textbox', { name: 'Search emoji' }).fill('rocket')
      await page.getByRole('button', { name: 'rocket', exact: true }).click()
      await page.getByRole('button', { name: 'Emoji 🚀: change it' }).waitFor()
      await page.getByRole('button', { name: 'Save' }).click()
      await page.locator('#places li[data-heading^="s:"]', { hasText: 'Customers' }).locator('[data-icon="emoji"]').waitFor()
      // a name another section at the top has is refused
      await page.getByRole('button', { name: 'New section' }).click()
      await page.getByRole('textbox', { name: 'Section name' }).fill('customers')
      await page.getByText('Another section is called customers.').waitFor()
      expect(await page.getByRole('button', { name: 'Create' }).isDisabled()).toBe(true)
      await page.keyboard.press('Escape')

      // Pin: Pinned is one of them, at the top; its ⋯ renames it but never deletes it, and it keeps its pin
      const home = page.locator('#places li[data-project="p:mac:~"]')
      await home.hover()
      await home.getByRole('button', { name: 'More for home' }).click()
      await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
      await page.locator('#places li[data-heading="pinned"]').waitFor()
      await page.locator('#places li[data-heading="pinned"]').click({ button: 'right' })
      expect(await page.getByRole('menuitem').allInnerTexts()).toEqual(['Rename section…'])
      await page.getByRole('menuitem', { name: 'Rename section…' }).click()
      expect(await page.getByRole('button', { name: 'Pick an emoji' }).count()).toBe(0)
      await page.getByRole('textbox', { name: 'Section name' }).fill('Favourites')
      await page.getByRole('button', { name: 'Save' }).click()
      await page.locator('#places li[data-heading="pinned"]', { hasText: 'Favourites' }).locator('[data-icon="pin"]').waitFor()
      expect(world.snapshot().sections?.[0]).toMatchObject({ id: 'pinned', name: 'Favourites' })
      expect((await rows(page)).slice(0, 5)).toEqual(['Favourites', 'home · mac', 'Customers', 'lilla-varlden · mac', 'herdr-projects · vm-str'])

      // deleted, asked first: its spaces back under their machines, where they were
      await page.locator('#places li[data-heading^="s:"]', { hasText: 'Customers' }).click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Delete section…' }).click()
      const ask = page.getByRole('alertdialog', { name: 'Delete Customers?' })
      await ask.getByText('Its 2 spaces go back under their machines, where they were.').waitFor()
      await ask.getByRole('button', { name: 'Delete' }).click()
      await ask.waitFor({ state: 'detached' })
      await page.locator('#places li[data-heading^="s:"]', { hasText: 'Customers' }).waitFor({ state: 'detached' })
      expect(await rows(page)).toEqual(['Favourites', 'home · mac', 'mac', 'lilla-varlden', 'nas', 'home', 'vm-str', 'home', 'herdr-projects', 'Labs', 'gtm'])
      // back out of Labs from its ⋯: under vm-str, where it was
      await move(page.locator('#places li[data-project="p:vm-str:gtm"]'), 'More for gtm', 'vm-str')
      // shown at once last, then where it was once the server says
      await page.waitForFunction(() => {
        const ls = [...document.querySelectorAll('#places li')]
        const at = (id: string) => ls.findIndex((l) => l.getAttribute('data-project') === id)
        return !ls[at('p:vm-str:gtm')]?.hasAttribute('data-section') && at('p:vm-str:gtm') < at('p:vm-str:herdr-projects')
      })
      expect((await rows(page)).slice(6)).toEqual(['vm-str', 'home', 'gtm', 'herdr-projects', 'Labs'])
    } finally {
      await page.close()
      forget()
    }
  }, 40_000)

  test('a home space drags like any other, and goes into a section (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    try {
      await page.goto(url())
      const home = page.locator('#places li[data-project="p:vm-str:~"]')
      await home.waitFor()
      const b = (await home.boundingBox())!
      await page.mouse.move(b.x + 60, b.y + b.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + 60, b.y + b.height / 2 + 60, { steps: 8 })
      await page.mouse.up()
      await page.waitForFunction(() => [...document.querySelectorAll('#places li')].at(-1)?.hasAttribute('data-home'))
      expect((await rows(page)).slice(5)).toEqual(['vm-str', 'gtm', 'herdr-projects', 'home'])
      expect(world.order['m:vm-str']).toEqual(['p:vm-str:gtm', 'p:vm-str:herdr-projects', 'p:vm-str:~'])
      // and into a section; its menu still has no Remove
      await page.getByRole('button', { name: 'New section' }).click()
      await make(page, 'Homes')
      await move(home, 'More for home', 'Homes')
      await page.locator('#places li', { hasText: 'home · vm-str' }).waitFor()
      await home.click({ button: 'right' })
      expect(await page.getByRole('menuitem', { name: 'Remove', exact: true }).count()).toBe(0)
      await page.keyboard.press('Escape')
    } finally {
      await page.close()
      forget()
    }
  }, 30_000)

  test('a phone: the header has its +, a space moves from its held menu and shows its machine, whole (phone)', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    try {
      await page.goto(url())
      await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
      const nav = 'nav[aria-label="Spaces"]'
      await page.locator(`${nav} li`).first().waitFor()
      await settled(page)
      await page.getByRole('button', { name: 'New section' }).tap()
      await make(page, 'Clients')
      await page.locator(`${nav} li[data-heading^="s:"]`).waitFor()
      // a finger holds gtm: its menu, Move to section, Clients
      const g = (await page.locator(`${nav} li[data-project="p:vm-str:gtm"]`).boundingBox())!
      const cdp = await ctx.newCDPSession(page)
      const pt = { x: g.x + g.width / 2, y: g.y + g.height / 2 }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] })
      await page.waitForTimeout(700)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.getByRole('menuitem', { name: 'Move to section' }).tap()
      await page.getByRole('menuitem', { name: 'Clients', exact: true }).tap()
      await page.locator(`${nav} li`, { hasText: 'gtm · vm-str' }).waitFor()
      await settled(page)
      expect(await rows(page, nav)).toEqual(['Clients', 'gtm · vm-str', 'mac', 'home', 'lilla-varlden', 'nas', 'home', 'vm-str', 'home', 'herdr-projects'])
      // its name and machine fit, nothing cut short, nothing past the drawer
      expect(await page.locator(`${nav} li[data-project="p:vm-str:gtm"] button > span`).first().evaluate((s) => s.scrollWidth <= s.clientWidth)).toBe(true)
      const w = await page.locator(nav).evaluate((n) => n.scrollWidth <= n.clientWidth)
      expect(w).toBe(true)
    } finally {
      await ctx.close()
      forget()
    }
  }, 30_000)
})
