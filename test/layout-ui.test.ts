// The UI pass (SHE-81): Settings, appearance and the rest, in a real browser (layout.ts).
import { describe, expect, test } from 'bun:test'
import { layout, settled } from './layout.ts'
import type { Locator } from 'playwright-core'

const { browser, server, world } = await layout()

describe.skipIf(!browser)('the UI pass (SHE-81)', () => {
  const at = (q: string) => `http://127.0.0.1:${server!.port}/?${q}`

  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['tablet', { width: 1024, height: 768 }],
  ] as const)
    test(`hover titles stay limited to the verified legacy attention, target and filter hints (${name})`, async () => {
      const page = await browser!.newPage({ viewport, hasTouch: name === 'tablet' })
      // an artifact frame's title only names it to screen readers
      const titled = () => page.evaluate(() => [...document.querySelectorAll('[title]:not(iframe):not([data-attention-badge]):not([title^="Merges into "]):not([aria-label^="Keep filters:"]):not([aria-label^="Filters kept:"]), svg title')].map((e) => e.outerHTML.slice(0, 120)))
      await page.goto(at('place=p:mac:lilla-varlden&task=LV-3'))
      await page.locator('[data-card]').first().waitFor()
      expect(await titled()).toEqual([])
      await page.goto(at('place=vm-str/home&tab=tasks'))
      await page.locator('[data-msg]').first().waitFor()
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Autopilot' }).waitFor()
      expect(await titled()).toEqual([])
      await page.close()
    }, 30_000)

  test('V and M while typing in search or an artifact type letters; they start no call', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(at('place=vm-str/home'))
    await page.getByRole('button', { name: /^Search or jump to/ }).click()
    const box = page.getByRole('combobox', { name: 'Search or jump to' })
    await box.waitFor()
    await page.keyboard.type('vm')
    expect(await box.inputValue()).toBe('vm')
    expect(await page.getByRole('button', { name: 'End call' }).count()).toBe(0)
    await page.keyboard.press('Escape')
    await page.goto(at('place=vm-str/home&artifact=a1'))
    const ask = page.getByRole('dialog').getByRole('textbox')
    await ask.click()
    await page.keyboard.type('v')
    expect(await ask.inputValue()).toBe('v')
    expect(await page.getByRole('button', { name: 'End call' }).count()).toBe(0)
    await page.close()
  }, 30_000)

  test("a tablet's first key adds Keyboard shortcuts to Settings, and the page shown stays in view", async () => {
    const page = await browser!.newPage({ viewport: { width: 834, height: 1112 }, hasTouch: true })
    await page.goto(at('place=vm-str/home'))
    await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const nav = page.getByRole('navigation', { name: 'Sections' })
    expect(await nav.getByRole('button', { name: 'Keyboard shortcuts' }).count()).toBe(0)
    await nav.getByRole('button', { name: 'Plugins' }).click()
    await page.keyboard.press('ArrowDown')
    await nav.getByRole('button', { name: 'Keyboard shortcuts' }).waitFor()
    expect(await nav.locator('[aria-current=page]').textContent()).toBe('Plugins')
    // and ? opens it
    await page.keyboard.press('?')
    expect(await nav.locator('[aria-current=page]').textContent()).toBe('Keyboard shortcuts')
    await page.close()
  }, 30_000)

  test("a phone's Settings lists its sections in groups, as iOS's does; one opens over the list and Back goes back to it", async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await page.goto(at('place=vm-str/home'))
    await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('region', { name: 'Settings' })
    const list = settings.getByRole('navigation', { name: 'Sections' })
    await list.waitFor()
    // (once it has slid in)
    await page.waitForTimeout(600)
    // no strip of tabs that scrolls sideways: every section is a row of the list, whole
    for (const name of ['How tasks work', 'Agents', 'Appearance System', 'Machines']) {
      const r = (await list.getByRole('button', { name, exact: true }).boundingBox())!
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.x + r.width).toBeLessThanOrEqual(390.5)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    // whichever space it was opened from, it starts on Everywhere; the picker switches to a machine's or a space's
    await settings.getByRole('button', { name: 'Editing: Everywhere' }).click()
    await page.getByRole('menuitemradio', { name: 'gtm · vm-str' }).click()
    await settings.getByRole('button', { name: 'Editing: gtm · vm-str' }).waitFor()
    // a space has no Machine page: a machine's capacity is its own
    expect(await list.getByRole('button', { name: 'Machine', exact: true }).count()).toBe(0)
    await list.getByRole('button', { name: 'Agents' }).click()
    const agents = settings.getByRole('region', { name: 'Agents' })
    await agents.waitFor()
    // where an inherited value comes from, and a reset for one set here
    expect(await agents.textContent()).toContain('From vm-str')
    await agents.getByRole('button', { name: 'Reset to Claude Code' }).waitFor()
    await agents.getByRole('button', { name: 'Back', exact: true }).click()
    await agents.waitFor({ state: 'detached' })
    await settings.getByRole('button', { name: 'Editing: gtm · vm-str' }).click()
    await page.getByRole('menuitemradio', { name: 'Everywhere' }).click()
    await list.getByRole('button', { name: 'How tasks work' }).click()
    const section = settings.getByRole('region', { name: 'How tasks work' })
    await section.waitFor()
    // the keys (brief.plan) are for agents, not on the screen; the brief's end reads as words, not code
    expect(await section.textContent()).not.toContain('brief.plan')
    expect(await section.locator('pre').count()).toBe(0)
    await section.getByRole('button', { name: 'Back' }).click()
    await section.waitFor({ state: 'detached' })
    await list.getByRole('button', { name: 'Agents' }).waitFor()
    // the system's Back goes from a section to the list, then out of Settings
    await list.getByRole('button', { name: 'Tasks', exact: true }).click()
    await settings.getByRole('region', { name: 'Tasks' }).waitFor()
    await page.goBack()
    await settings.getByRole('region', { name: 'Tasks' }).waitFor({ state: 'detached' })
    await page.goBack()
    await settings.waitFor({ state: 'detached' })
    await page.close()
  }, 30_000)

  test("Settings' place picker is the app's own menu, themed: the sidebar's tree, scrolling when long, by keyboard too (SHE-205)", async () => {
    // eight more spaces on vm-str, each with its defaults: more places than the menu shows at once
    const was = { places: world.places, sections: world.sections }
    const gtm = world.places.find((p) => p.id === 'p:vm-str:gtm')!
    const more = Array.from({ length: 8 }, (_, i) => `zz-${i + 1}`)
    world.places = [...world.places, ...more.map((name) => ({ ...gtm, id: `p:vm-str:${name}`, name, chat: `chat:${name}` }))]
    world.sections = [...world.sections, ...more.flatMap((name) => was.sections.filter((x) => x.level === gtm.id).map((x) => ({ ...x, level: `p:vm-str:${name}` })))]
    world.emit('snapshot')
    const ctx = await browser!.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' })
    const page = await ctx.newPage()
    try {
      await page.goto(at(`place=${encodeURIComponent(gtm.id)}`))
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = page.getByRole('region', { name: 'Settings' })
      const pick = settings.getByRole('button', { name: 'Editing: Everywhere' })
      await pick.click()
      const menu = page.getByRole('menu', { name: 'Choices' })
      await menu.waitFor()
      // none of the device's own pickers, which Chrome on Linux draws white
      expect(await settings.locator('select').count()).toBe(0)
      expect(await menu.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)')
      // Everywhere, then each machine with its spaces under it, its home space first, in the sidebar's order
      const rows = menu.getByRole('menuitemradio')
      const names = (await rows.allTextContents()).map((t) => t.trim())
      expect(names.slice(0, 8)).toEqual(['Everywhere', 'mac', 'home · mac', 'lilla-varlden · mac', 'vm-str', 'home · vm-str', 'gtm · vm-str', 'herdr-projects · vm-str'])
      expect(names.slice(-8)).toEqual(more.map((n) => `${n} · vm-str`))
      // each name after its place's icon, as the sidebar's (SHE-207)
      const textX = (name: string) => menu.getByRole('menuitemradio', { name, exact: true }).locator('span span span').evaluate((el) => el.getBoundingClientRect().left)
      const [allX, machineX, projectX] = [await textX('Everywhere'), await textX('vm-str'), await textX('gtm · vm-str')]
      expect(machineX).toBeGreaterThan(allX)
      expect(projectX).toBeGreaterThan(machineX)
      // Settings opens on Everywhere, wherever it was opened from
      expect(await menu.getByRole('menuitemradio', { name: 'Everywhere', exact: true }).getAttribute('aria-checked')).toBe('true')
      // too many to show whole: it scrolls, the menu stays on the screen
      const box = (await menu.boundingBox())!
      expect(box.y + box.height).toBeLessThanOrEqual(800)
      expect(await menu.locator('> div').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
      // the keyboard walks it, the row it reaches scrolled into view, and Enter picks
      await page.keyboard.press('End')
      const last = menu.getByRole('menuitemradio', { name: 'zz-8 · vm-str' })
      expect(await last.evaluate((el) => el === document.activeElement)).toBe(true)
      const inView = async () => {
        const [r, m] = [(await last.boundingBox())!, (await menu.boundingBox())!]
        return r.y >= m.y && r.y + r.height <= m.y + m.height
      }
      expect(await inView()).toBe(true)
      await page.keyboard.press('Home')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await menu.waitFor({ state: 'detached' })
      await settings.getByRole('button', { name: 'Editing: mac' }).waitFor()
      // Esc closes it, the focus back on the picker
      await settings.getByRole('button', { name: 'Editing: mac' }).click()
      await menu.waitFor()
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'detached' })
      expect(await settings.getByRole('button', { name: 'Editing: mac' }).evaluate((el) => el === document.activeElement)).toBe(true)
      // and so does a click outside it, leaving the level as it was
      await settings.getByRole('button', { name: 'Editing: mac' }).click()
      await menu.waitFor()
      await page.mouse.click(900, 700)
      await menu.waitFor({ state: 'detached' })
      await settings.getByRole('button', { name: 'Editing: mac' }).waitFor()
      // a phone on its side: the menu fits the room it has, and scrolls
      const phone = await browser!.newPage({ viewport: { width: 600, height: 360 }, hasTouch: true, isMobile: true })
      await phone.goto(at(`place=${encodeURIComponent(gtm.id)}`))
      await phone.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).click()
      await phone.getByRole('button', { name: 'Settings', exact: true }).click()
      await phone.getByRole('button', { name: 'Editing: Everywhere' }).click()
      const small = phone.getByRole('menu', { name: 'Choices' })
      await small.waitFor()
      await settled(phone)
      const b = (await small.boundingBox())!
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.y + b.height).toBeLessThanOrEqual(360)
      expect(await small.getByRole('menuitemradio', { name: 'gtm · vm-str' }).isVisible()).toBe(true)
      await phone.close()
    } finally {
      await ctx.close()
      Object.assign(world, was)
      world.emit('snapshot')
    }
  }, 30_000)

  test("Settings → Autopilot: one Heartbeat, schedule/events, agent and collapsed access (phone)", async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await page.goto(at(`place=${encodeURIComponent('p:vm-str:gtm')}`))
    await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('region', { name: 'Settings' })
    const list = settings.getByRole('navigation', { name: 'Sections' })
    await settings.getByRole('button', { name: 'Editing: Everywhere' }).click()
    await page.getByRole('menuitemradio', { name: 'gtm · vm-str' }).click()
    await settings.getByRole('button', { name: 'Editing: gtm · vm-str' }).waitFor()
    await list.getByRole('button', { name: 'Autopilot' }).click()
    const pilot = settings.getByRole('region', { name: 'Autopilot' })
    await pilot.waitFor()
    const text = (await pilot.textContent())!
    // the rule in words with its next runs, never as written; the news that wakes it at once
    for (const words of ['Heartbeat', 'Every 30 minutes (Stockholm)', 'Next: ', 'Events', 'All news', 'Ask the coordinator for anything else', 'Agent', 'HEARTBEAT.md', 'Access and limits']) expect(text).toContain(words)
    for (const words of ['FREQ=', 'RRULE', 'Quiet hours', 'Heartbeat every', 'Max new tasks']) expect(text).not.toContain(words)
    // a preset: picked, it is the rule in words at once, set here with a Reset back to the default
    const presets = pilot.getByRole('group', { name: 'When' })
    expect(await presets.getByRole('button').allInnerTexts()).toEqual(['15 min', '30 min', '1 hour', 'Workdays'])
    expect(await presets.getByRole('button', { name: '30 min' }).getAttribute('aria-pressed')).toBe('true')
    await presets.getByRole('button', { name: 'Workdays' }).click()
    await pilot.getByText('Every 30 minutes, 8:00-18:00, Monday to Friday (Stockholm)', { exact: true }).waitFor()
    expect(await presets.getByRole('button', { name: 'Workdays' }).getAttribute('aria-pressed')).toBe('true')
    await pilot.getByRole('button', { name: "Reset to Everywhere's" }).click()
    await pilot.getByText('Every 30 minutes (Stockholm)', { exact: true }).waitFor()
    // the news: all, or none that waits for the heartbeat
    const news = pilot.getByRole('group', { name: 'Events' })
    // in words, not the button of the same name
    const words = (w: string) => pilot.getByRole('paragraph').filter({ hasText: new RegExp(`^${w}$`) })
    await news.getByRole('button', { name: 'None: it waits' }).click()
    await words('No news').waitFor()
    await news.getByRole('button', { name: 'All news' }).click()
    await words('All news').waitFor()
    const doc = pilot.getByRole('textbox', { name: 'Heartbeat' })
    expect(await doc.inputValue()).toContain('Tasks stuck or stalled')
    const typography = await doc.evaluate((el) => ({ font: getComputedStyle(el).fontFamily, size: getComputedStyle(el).fontSize }))
    expect(typography.font).not.toContain('mono')
    expect(parseFloat(typography.size)).toBeGreaterThanOrEqual(16)
    expect(await doc.evaluate((el) => el.closest('.font-mono, .shadow-box-focus') !== null)).toBe(false)
    expect(await pilot.locator('details').filter({ has: page.locator('summary', { hasText: 'Access and limits' }) }).getAttribute('open')).toBeNull()
    // Save shows only once it changed
    expect(await pilot.getByRole('button', { name: 'Save' }).count()).toBe(0)
    await doc.fill('- Keep the live link working\n- Ship the onboarding flow')
    await pilot.getByRole('button', { name: 'Save' }).click()
    await pilot.getByRole('button', { name: 'Save' }).waitFor({ state: 'detached' })
    expect(await doc.inputValue()).toBe('- Keep the live link working\n- Ship the onboarding flow')
    await doc.fill('unsaved change')
    await pilot.getByRole('button', { name: 'Undo', exact: true }).click()
    expect(await doc.inputValue()).toBe('- Keep the live link working\n- Ship the onboarding flow')
    await doc.fill('Saved with keyboard\n' + 'Long plain text that wraps. '.repeat(25))
    await doc.press('Control+s')
    await pilot.getByRole('button', { name: 'Save', exact: true }).waitFor({ state: 'detached' })
    expect(await doc.inputValue()).toContain('Saved with keyboard')
    expect(await doc.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.close()
  }, 30_000)

  test('each setting has the control its value needs, and every page fits a 375px phone, light and dark (SHE-206)', async () => {
    for (const colorScheme of ['light', 'dark'] as const) {
      const ctx = await browser!.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, colorScheme })
      const page = await ctx.newPage()
      await page.goto(at(`place=${encodeURIComponent('p:vm-str:~')}`))
      await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).click()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = page.getByRole('region', { name: 'Settings' })
      const list = settings.getByRole('navigation', { name: 'Sections' })
      // a machine's own defaults: picked, as a machine has no space of its own to open them from
      await settings.getByRole('button', { name: 'Editing: Everywhere' }).click()
      await page.getByRole('menuitemradio', { name: 'vm-str', exact: true }).click()
      await settings.getByRole('button', { name: 'Editing: vm-str' }).waitFor()
      const open = async (name: string) => {
        await list.getByRole('button', { name, exact: true }).click()
        const region = settings.getByRole('region', { name })
        await region.waitFor()
        await settled(page)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
        // every control inside the screen's edges, and every value whole (none cut short with …)
        for (const box of await region.locator('dd > *').all()) {
          const r = (await box.boundingBox())!
          expect(r.x + r.width).toBeLessThanOrEqual(375)
        }
        // Ignore invisible sizing spans and content inside a closed disclosure.
        expect(await region.locator('dd .truncate').evaluateAll((els) => els.filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && e.scrollWidth > e.clientWidth).map((e) => e.textContent))).toEqual([])
        return region
      }
      const back = async (region: Locator) => {
        await region.getByRole('button', { name: 'Back', exact: true }).click()
        await region.waitFor({ state: 'detached' })
      }
      // on or off: a switch
      const machine = await open('Machine')
      expect(await machine.getByRole('switch', { name: 'herdr stops answering' }).getAttribute('aria-checked')).toBe('true')
      expect(await machine.getByRole('button', { name: 'More: Max tasks working at once' }).count()).toBe(1)
      await back(machine)
      const tasks = await open('How tasks work')
      expect(await tasks.getByRole('switch', { name: 'Review' }).getAttribute('aria-checked')).toBe('true')
      await back(tasks)
      // a few short choices: segments, the one picked pressed
      const notify = await open('Notifications')
      const seg = notify.getByRole('group', { name: 'Notify' })
      expect(await seg.getByRole('button', { name: 'Needs me' }).getAttribute('aria-pressed')).toBe('true')
      await notify.getByRole('button', { name: 'Add this device' }).waitFor()
      await back(notify)
      // one with no other choice is only its words; an action is a button
      const alerts = await open('Voice')
      expect(await alerts.getByRole('button', { name: /ElevenLabs/ }).count()).toBe(0)
      expect(await alerts.getByRole('button', { name: 'Add this device' }).count()).toBe(0)
      await back(alerts)
      for (const name of ['Agents', 'Tasks', 'Autopilot', 'Time zone']) await back(await open(name))
      await ctx.close()
    }
  }, 60_000)

  test('Appearance: System, Light or Dark, kept on this device, on the page before its first paint, the bars and artifacts too', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'light' })
    const page = await ctx.newPage()
    await page.goto(at('place=vm-str/home'))
    const look = () =>
      page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        bar: document.querySelector<HTMLMetaElement>('meta[name=theme-color]')!.content,
        bg: getComputedStyle(document.body).backgroundColor,
      }))
    expect((await look()).theme).toBe('light')
    await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Appearance System' }).click()
    await page.getByRole('radiogroup', { name: 'Appearance' }).getByText('Dark', { exact: true }).click()
    expect(await page.getByRole('radio', { name: 'Dark', exact: true }).isChecked()).toBe(true)
    expect(await look()).toMatchObject({ theme: 'dark', bar: '#0b0b0d' })
    // Tailwind's dark variant follows the pick, not the device's own mode
    const card = await page.getByRole('radiogroup', { name: 'Appearance' }).evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(card).toBe('rgb(28, 28, 32)')
    // the device turning dark or light doesn't change a pick of its own
    await page.emulateMedia({ colorScheme: 'light' })
    expect((await look()).theme).toBe('dark')
    // a reload paints dark from the start: the page's first script sets it, before the app's code
    const seen: string[] = []
    await page.exposeFunction('seenTheme', (t: string) => seen.push(t))
    await page.addInitScript(() => document.addEventListener('readystatechange', () => document.readyState === 'interactive' && (window as unknown as { seenTheme: (t: string) => void }).seenTheme(document.documentElement.dataset.theme ?? '')))
    await page.reload()
    await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).waitFor()
    expect(seen[0]).toBe('dark')
    expect((await look()).bar).toBe('#0b0b0d')
    // an artifact opens in the app's dark, and is told when it changes
    const frame = page.frameLocator('iframe').first()
    expect(await frame.locator('html').getAttribute('class')).toContain('shepherdr-dark')
    await page.evaluate(() => localStorage.setItem('shepherdr.appearance', 'light'))
    await page.reload()
    expect(await look()).toMatchObject({ theme: 'light', bar: '#ffffff' })
    // System follows the device, as it changes
    await page.evaluate(() => localStorage.removeItem('shepherdr.appearance'))
    await page.reload()
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    expect(await page.locator('iframe').first().evaluate((f: HTMLIFrameElement) => f.src)).toContain('&theme=')
    await ctx.close()
  }, 30_000)
})
