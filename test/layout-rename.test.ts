// Renaming a space from its row's menu, in the row itself, in a real browser (layout.ts): Enter keeps the new name,
// Escape the old, and the new one shows everywhere the old did. A space's name follows the space rules as it is typed.
// A machine's section is renamed in a dialog, as Slack's: its emoji and its name. Only the name changes: its id stays.
import { describe, expect, test } from 'bun:test'
import { layout, settled } from './layout.ts'

const { browser, world, url } = await layout()

describe.skipIf(!browser)('renaming spaces and machines', () => {
  test('a space renames in its row, a machine in Rename machine: Enter keeps it, Escape does not, a name taken or against the rules is refused; it shows in the header, tasks and search (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    page.setDefaultTimeout(10_000) // Surface the failing locator before the enclosing test deadline.
    try {
      await page.goto(url().replace('place=vm-str/home', 'place=vm-str/gtm'))
      const places = page.locator('#places')
      const gtm = places.locator('li[data-project="p:vm-str:gtm"]')
      await gtm.waitFor()

      // Escape keeps the old name
      await gtm.hover()
      await gtm.getByRole('button', { name: 'More for gtm' }).click()
      await page.getByRole('menuitem', { name: 'Rename' }).click()
      const box = gtm.getByRole('textbox', { name: 'New name for gtm' })
      await box.waitFor()
      expect(await box.evaluate((n) => n === document.activeElement)).toBe(true)
      await page.keyboard.type('Nope')
      await page.keyboard.press('Escape')
      await box.waitFor({ state: 'detached' })
      expect(world.places.find((p) => p.id === 'p:vm-str:gtm')!.name).toBe('gtm')

      // a name another space on its machine has is refused in the box; typed, it follows the rules (lowercase, - for a
      // space)
      await gtm.hover()
      await gtm.getByRole('button', { name: 'More for gtm' }).click()
      await page.getByRole('menuitem', { name: 'Rename' }).click()
      await box.waitFor()
      await page.keyboard.type('Herdr-Projects')
      expect(await box.getAttribute('aria-invalid')).toBe('true')
      await page.keyboard.press('Enter')
      expect(await box.isVisible()).toBe(true)

      expect(await box.inputValue()).toBe('herdr-projects')
      await box.fill('home')
      expect(await box.getAttribute('aria-invalid')).toBe('true')

      // Enter keeps the new one: the id stays, the name shows wherever the old one did
      await box.fill('')
      await page.keyboard.type('Go  to market')
      expect(await box.inputValue()).toBe('go-to-market')
      await page.keyboard.press('Enter')
      await box.waitFor({ state: 'detached' })
      expect(world.places.find((p) => p.id === 'p:vm-str:gtm')!.name).toBe('go-to-market')
      await gtm.getByRole('button', { name: /^go-to-market/ }).waitFor()
      await page.getByRole('textbox', { name: 'Message go-to-market…' }).waitFor()
      expect(new URL(page.url()).searchParams.get('place')).toBe('vm-str/go-to-market')
      expect(world.tasks.filter((t) => t.place === 'p:vm-str:gtm').length).toBeGreaterThan(0)

      // a machine too, from a right click: Rename machine, its name selected in the dialog's box; Enter saves
      const vm = places.locator('li[data-heading="m:vm-str"]')
      await vm.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Rename machine…' }).click()
      const name = page.getByRole('textbox', { name: 'Machine name' })
      await name.waitFor()
      expect(await name.evaluate((n: HTMLInputElement) => n === document.activeElement && n.selectionEnd! - n.selectionStart! === n.value.length)).toBe(true)
      await page.keyboard.type('Work VM')
      await page.keyboard.press('Enter')
      await vm.getByRole('button', { name: 'Work VM', exact: true }).waitFor()
      await name.waitFor({ state: 'detached' })
      expect(world.machines.find((m) => m.id === 'm:vm-str')!.machine).toBe('vm-str')
      // the header says where it is
      await page.getByText('Space on Work VM').waitFor()

      // every task (the main machine's home space, its chip taken off), by status: each saying its machine's and space's
      // new names
      await places.locator('li[data-project="p:vm-str:~"]').getByRole('button', { name: /^home/ }).click()
      const tasks = page.locator('section[aria-label="Tasks"]')
      // Home already includes every machine; explicitly choose Everything to
      // inspect ordinary tasks too, beyond its default attention-only view.
      await tasks.getByRole('button', { name: 'Filter', exact: true }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Everything', exact: true }).click()
      await tasks.locator('li', { hasText: 'Work VM · go-to-market' }).first().waitFor()

      // a home space is renamed as any space, by the same rules
      expect(await world.act({ type: 'rename', id: 'p:vm-str:~', name: 'My base' })).toMatchObject({ ok: false })
      await world.act({ type: 'rename', id: 'p:vm-str:~', name: 'base' })
      await places.locator('li[data-project="p:vm-str:~"]').getByRole('button', { name: /^base/ }).waitFor()

      // search finds it by its new name
      await page.keyboard.press('Control+k')
      await page.keyboard.type('go to')
      await page.getByRole('option', { name: /go-to-market/ }).first().waitFor()
      await page.keyboard.press('Escape')
    } finally {
      await world.act({ type: 'rename', id: 'p:vm-str:gtm', name: '' })
      await world.act({ type: 'rename', id: 'm:vm-str', name: '' })
      await world.act({ type: 'rename', id: 'p:vm-str:~', name: '' })
      await page.close()
    }
  }, 30_000)

  for (const [device, opts] of [
    ['desktop', { viewport: { width: 1440, height: 800 } }],
    ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
  ] as const)
    test(`a machine's emoji, as a Slack section's: picked in Rename machine, shown before its name for every device, removed back to its server; a taken name is refused, Cancel keeps all (${device})`, async () => {
      const ctx = await browser!.newContext(opts)
      const page = await ctx.newPage()
      const phone = device === 'phone'
      const list = phone ? 'nav[aria-label="Spaces"]' : '#places'
      const open = async () => {
        if (phone && !(await page.locator(list).isVisible())) await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
        await page.locator(`${list} li[data-heading="m:mac"]`).dispatchEvent('contextmenu')
        await page.getByRole('menuitem', { name: 'Rename machine…' }).click()
        await page.getByRole('dialog', { name: 'Rename machine' }).waitFor()
      }
      const icon = () => page.locator(`${list} li[data-heading="m:mac"] [data-icon]`).first()
      try {
        await page.goto(url())
        if (phone) await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
        await page.locator(`${list} li[data-heading="m:mac"]`).waitFor()
        await settled(page)
        expect(await icon().getAttribute('data-icon')).toBe('server')
        await open()
        const dialog = page.getByRole('dialog', { name: 'Rename machine' })
        // Save waits for a change; a name another machine has is refused
        expect(await dialog.getByRole('button', { name: 'Save' }).isDisabled()).toBe(true)
        await dialog.getByRole('textbox', { name: 'Machine name' }).fill('VM-STR')
        await dialog.getByText('Another machine has that name.').waitFor()
        expect(await dialog.getByRole('button', { name: 'Save' }).isDisabled()).toBe(true)
        // Cancel keeps all as it was
        await dialog.getByRole('button', { name: 'Cancel' }).click()
        await dialog.waitFor({ state: 'detached' })
        expect(world.machines.find((m) => m.id === 'm:mac')).toMatchObject({ name: 'mac' })
        // the emoji button at the left of the name opens every emoji; a search, a pick, then Save
        await open()
        await dialog.getByRole('button', { name: 'Pick an emoji' }).click()
        await dialog.getByRole('textbox', { name: 'Search emoji' }).fill('rocket')
        await dialog.getByRole('button', { name: 'rocket', exact: true }).click()
        await dialog.getByRole('button', { name: 'Emoji 🚀: change it' }).waitFor()
        expect(await dialog.getByRole('textbox', { name: 'Search emoji' }).count()).toBe(0)
        // inside the screen, whole
        const b = (await dialog.boundingBox())!
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.x + b.width).toBeLessThanOrEqual(opts.viewport.width)
        await dialog.getByRole('button', { name: 'Save' }).click()
        await dialog.waitFor({ state: 'detached' })
        expect(world.machines.find((m) => m.id === 'm:mac')?.emoji).toBe('🚀')
        if (phone && !(await page.locator(list).isVisible())) await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
        await page.waitForFunction((sel) => document.querySelector(`${sel} li[data-heading="m:mac"] [data-icon]`)?.textContent === '🚀', list)
        expect(await icon().getAttribute('data-icon')).toBe('emoji')
        // its emoji sits where the server was: the name doesn't move
        const other = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
        await other.goto(url())
        await other.locator('#places li[data-heading="m:mac"] [data-icon="emoji"]').waitFor()
        const at = (sel: string) => other.locator(sel).evaluate((n) => Math.round(n.getBoundingClientRect().left))
        expect(await at('#places li[data-heading="m:mac"] h2 span')).toBe(await at('#places li[data-heading="m:vm-str"] h2 span'))
        await other.close()
        // Remove emoji: its server again
        await open()
        await dialog.getByRole('button', { name: 'Emoji 🚀: change it' }).click()
        await dialog.getByRole('button', { name: /^Remove emoji/ }).click()
        await dialog.getByRole('button', { name: 'Pick an emoji' }).waitFor()
        await dialog.getByRole('button', { name: 'Save' }).click()
        await dialog.waitFor({ state: 'detached' })
        expect(world.machines.find((m) => m.id === 'm:mac')?.emoji).toBeUndefined()
        if (phone && !(await page.locator(list).isVisible())) await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
        await page.locator(`${list} li[data-heading="m:mac"] [data-icon="server"]`).waitFor()
      } finally {
        await world.act({ type: 'rename', id: 'm:mac', name: '', emoji: '' })
        await ctx.close()
      }
    }, 30_000)

  test('a phone: a held row opens the menu, Rename makes its name a box, Done on the keyboard keeps it', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    try {
      await page.goto(url())
      await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
      const row = page.locator('nav[aria-label="Spaces"] li[data-project="p:mac:lilla-varlden"]')
      await row.waitFor()
      await settled(page)
      const b = (await row.boundingBox())!
      const cdp = await ctx.newCDPSession(page)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] })
      await page.waitForTimeout(700)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.getByRole('menuitem', { name: 'Rename' }).tap()
      const box = row.getByRole('textbox', { name: 'New name for lilla-varlden' })
      await box.waitFor()
      // 16px or more: a phone doesn't zoom in on it; it stays inside the drawer
      expect(await box.evaluate((n) => parseFloat(getComputedStyle(n).fontSize))).toBeGreaterThanOrEqual(16)
      const r = (await box.boundingBox())!
      expect(r.x + r.width).toBeLessThanOrEqual(390)
      await box.fill('Kids')
      await page.keyboard.press('Enter')
      await row.getByRole('button', { name: /^kids/ }).waitFor()
      // the hold didn't open the space
      expect(page.url()).not.toContain('lilla-varlden')
    } finally {
      await world.act({ type: 'rename', id: 'p:mac:lilla-varlden', name: '' })
      await ctx.close()
    }
  }, 30_000)
})
