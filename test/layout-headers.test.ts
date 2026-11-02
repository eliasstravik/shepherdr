// Adding a space, the place and Tasks headers, a place's mode pill and a mode card, in a real browser (layout.ts).
import { describe, expect, test } from 'bun:test'
import type { Page } from 'playwright-core'
import type { Message } from '../shared/types.ts'
import { layout, type Box } from './layout.ts'

const { browser, world, server, url } = await layout({ everything: true })

describe.skipIf(!browser)('adding a space', () => {
  test('from the keyboard: N, type to narrow, Enter picks the repo, Enter adds and opens it (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(url())
    await page.waitForSelector('#places li')
    await page.keyboard.press('n')
    const dialog = page.getByRole('dialog', { name: 'New space' })
    await dialog.waitFor()
    // at home: likely repos first, ones already added left out
    await dialog.getByText('Likely repos').waitFor()
    expect(await dialog.getByRole('option', { name: /gtm/ }).count()).toBe(0)
    const folder = dialog.getByRole('combobox', { name: 'Folder' })
    await folder.fill('~/dev/sh')
    await dialog.getByRole('option', { name: /shepherdr/, selected: true }).waitFor()
    await folder.press('Enter')
    expect(await folder.inputValue()).toBe('~/dev/shepherdr')
    await dialog.getByRole('button', { name: 'Create space' }).and(page.locator(':enabled')).waitFor()
    await folder.press('Enter')
    await dialog.waitFor({ state: 'detached' })
    await page.waitForURL(/place=vm-str%2Fshepherdr/)
    await page.close()
  }, 30_000)

  test('Tab completes a repo like a terminal, and Enter adds it (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(url())
    await page.locator('[data-heading="m:vm-str"]').hover()
    await page.getByRole('button', { name: 'New space on vm-str' }).click()
    const dialog = page.getByRole('dialog', { name: 'New space' })
    const folder = dialog.getByRole('combobox', { name: 'Folder' })
    await folder.fill('~/dev/web')
    await dialog.getByRole('option', { name: /website/, selected: true }).waitFor()
    await folder.press('Tab')
    expect(await folder.inputValue()).toBe('~/dev/website/')
    await dialog.getByRole('button', { name: 'Create space' }).and(page.locator(':enabled')).waitFor()
    await folder.press('Enter')
    await dialog.waitFor({ state: 'detached' })
    await page.waitForURL(/place=vm-str%2Fwebsite/)
    await page.close()
  }, 30_000)

  test('the machine is a select: its menu from the keyboard picks another, back at ~; Cancel closes it (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(url())
    await page.waitForSelector('#places li')
    await page.keyboard.press('n')
    const dialog = page.getByRole('dialog', { name: 'New space' })
    // it starts on the machine of the space it was opened from
    const pick = dialog.getByRole('button', { name: 'Machine: vm-str' })
    await dialog.getByRole('combobox', { name: 'Folder' }).fill('~/dev/web')
    await pick.focus()
    await page.keyboard.press('Enter')
    const menu = dialog.getByRole('menu', { name: 'Machines' })
    await menu.waitFor()
    // every machine, the chosen one checked; one out of reach can't be picked
    expect((await menu.getByRole('menuitemradio').allTextContents()).map((t) => t.trim())).toEqual(['mac', 'nasOut of reach', 'vm-str'])
    expect(await menu.getByRole('menuitemradio', { name: 'vm-str', checked: true }).count()).toBe(1)
    expect(await menu.getByRole('menuitemradio', { name: /nas/ }).isDisabled()).toBe(true)
    // the focus starts on the chosen one; up to mac
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('vm-str')
    await page.keyboard.press('ArrowUp')
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('mac')
    await page.keyboard.press('Enter')
    await menu.waitFor({ state: 'detached' })
    await dialog.getByRole('button', { name: 'Machine: mac' }).waitFor()
    expect(await dialog.getByRole('combobox', { name: 'Folder' }).inputValue()).toBe('~/')
    // Escape closes the menu only, then Cancel the dialog
    await dialog.getByRole('button', { name: 'Machine: mac' }).click()
    await menu.waitFor()
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })
    expect(await dialog.isVisible()).toBe(true)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await dialog.waitFor({ state: 'detached' })
    await page.close()
  }, 30_000)

  test('a new folder on another machine becomes a new repo, named as you like (phone)', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await page.goto(url())
    await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).tap()
    // a finger always sees each machine's +; mac's opens the dialog on mac
    await page.getByRole('button', { name: 'New space on mac' }).tap()
    const dialog = page.getByRole('dialog', { name: 'New space' })
    expect(await dialog.getByRole('button', { name: 'Machine: mac' }).count()).toBe(1)
    await dialog.getByRole('option', { name: /recipes/ }).waitFor()
    // a plain folder opens
    await dialog.getByRole('option', { name: /^Desktop/ }).tap()
    await dialog.getByRole('combobox', { name: 'Folder' }).waitFor()
    expect(await dialog.getByRole('combobox', { name: 'Folder' }).inputValue()).toBe('~/Desktop/')
    // the folder opened is still the one to make a space of
    await dialog.getByText('Not a git repo yet.', { exact: false }).waitFor()
    // Cancel and Create share the sheet's width
    const [cancel, create] = await Promise.all(['Cancel', 'Create space'].map((n) => dialog.getByRole('button', { name: n }).boundingBox()))
    expect(Math.abs(cancel!.width - create!.width)).toBeLessThan(1)
    expect(cancel!.y).toBe(create!.y)
    expect(await dialog.getByRole('textbox', { name: 'Name' }).inputValue()).toBe('desktop')
    expect(await dialog.getByRole('button', { name: 'Create space' }).isEnabled()).toBe(true)
    await dialog.getByRole('combobox', { name: 'Folder' }).fill('~/dev/new-app')
    await dialog.getByText('No folder here yet.', { exact: false }).waitFor()
    await dialog.getByRole('textbox', { name: 'Name' }).fill('New app')
    await dialog.getByRole('button', { name: 'Create space' }).tap()
    await dialog.waitFor({ state: 'detached' })
    await page.waitForURL(/place=mac%2Fnew-app/)
    await ctx.close()
  }, 30_000)
})

describe.skipIf(!browser)('the place header', () => {
  /** the header over the coordinator chat: any status mark in it, and where its title sits */
  const head = (page: import('playwright-core').Page) =>
    page.evaluate(() => {
      const title = [...document.querySelectorAll('.font-semibold')].find((el) => el.textContent?.startsWith('home') && el.closest('.border-b') && !el.closest('#places, nav'))!
      const bar = title.closest('.border-b')!
      // the place's icon (SHE-207) before its name: on a phone the two are centred together
      const icon = title.querySelector('svg')?.getBoundingClientRect()
      return { reading: (bar.querySelector("[data-conversation-head]") ?? bar).getBoundingClientRect().toJSON() as Box, dots: bar.querySelectorAll('.dot').length, icon: icon?.toJSON() as Box | undefined, bar: bar.getBoundingClientRect().toJSON() as Box, title: title.getBoundingClientRect().toJSON() as Box, name: (title.querySelector('span') ?? title).getBoundingClientRect().toJSON() as Box }
    })

  test('no status dot before the place name, the title still sits right', async () => {
    // desktop with its sidebar open: the title follows the conversation reading column
    const desk = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    await desk.goto(url())
    await desk.waitForSelector('#places li')
    const d = await head(desk)
    expect(d.dots).toBe(0)
    expect(Math.abs(d.title.left - d.reading.left - 20)).toBeLessThan(0.5)
    await desk.close()
    // a tablet: the title right after the Spaces button
    const tablet = await browser!.newPage({ viewport: { width: 900, height: 800 } })
    await tablet.goto(url())
    const places = await tablet.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().boundingBox()
    const t = await head(tablet)
    expect(t.dots).toBe(0)
    expect(Math.abs(t.title.left - (places!.x + places!.width) - 10)).toBeLessThan(0.5)
    await tablet.close()
    // a phone: the name centred on the screen
    const phone = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await phone.goto(url())
    await phone.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().waitFor()
    const p = await head(phone)
    expect(p.dots).toBe(0)
    expect(p.icon!.right).toBeLessThanOrEqual(p.name.left)
    expect(Math.abs((p.icon!.left + p.name.right) / 2 - 195)).toBeLessThan(1)
    await phone.close()
  }, 30_000)
})

describe.skipIf(!browser)('the Tasks header', () => {
  /** the Tasks column's header: its Tasks | Artifacts tabs, and how they sit beside the chat's header and over the list */
  const head = (page: Page) =>
    page.evaluate(() => {
      const col = document.querySelector('section[aria-label="Tasks"]')!
      const tabs = col.querySelector('[role="group"][aria-label="Show"]')!
      const bar = col.firstElementChild!
      const chatBar = document.querySelector('[aria-label^="Message"]')!.closest('section')!.firstElementChild!
      const rect = (el: Element) => el.getBoundingClientRect().toJSON() as Box
      const shown = (b: Element) => {
        const st = getComputedStyle(b)
        return { pressed: b.getAttribute('aria-pressed'), bg: st.backgroundColor, shadow: st.boxShadow }
      }
      const [needs, tasks, artifacts] = [...tabs.querySelectorAll('button')]
      const count = needs.querySelector('[data-attention-badge]')
      return {
        text: bar.textContent,
        tabs: rect(tabs),
        bar: rect(bar),
        chatBar: rect(chatBar),
        tasks: shown(tasks),
        artifacts: shown(artifacts),
        tab: rect(needs),
        count: count ? rect(count) : null,
        chevron: rect(col.querySelector('[data-heading="Needs you"] svg')!),
      }
    })

  test('Tasks | Artifacts are tabs, the shown one filled; no place name beside them (the chat names it); as tall as the chat header and lined up with the list (desktop, tablet; light, dark)', async () => {
    for (const [width, height] of [
      [1440, 800],
      [820, 1180],
    ]) {
      for (const colorScheme of ['light', 'dark'] as const) {
        const page = await browser!.newPage({ viewport: { width, height }, colorScheme })
        for (const place of ['p:vm-str:~', 'p:mac:lilla-varlden', 'p:vm-str:gtm']) {
          await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent(place)}`)
          await page.waitForSelector('section[aria-label="Tasks"] [role="group"][aria-label="Show"]')
          await page.getByText('Needs you', { exact: true }).first().waitFor()
          const t = await head(page)
          // The tabs keep separate Needs you / Ready counts and the approved filter lock.
          expect(t.text).toMatch(/^Needs you[\d+]*Tasks[\d+]*ArtifactsKeep filters$/)
          expect(t.text).not.toContain('·')
          expect(await page.getByText('everything under it').count()).toBe(0)
          // the shown tab is plainly picked: filled and edged; the other is bare
          expect([t.tasks.pressed, t.artifacts.pressed]).toEqual(['true', 'false'])
          expect(t.tasks.bg).not.toBe(t.artifacts.bg)
          expect(t.tasks.shadow).not.toBe('none')
          expect(t.artifacts.shadow).toBe('none')
          // one line, centred in a header as tall as the chat's, so their bottom lines meet
          expect(t.tabs.bottom - t.tabs.top).toBeLessThan(40)
          expect(Math.abs(t.bar.bottom - t.chatBar.bottom)).toBeLessThan(0.5)
          expect(Math.abs((t.tabs.top + t.tabs.bottom) / 2 - (t.bar.top + t.bar.bottom) / 2)).toBeLessThan(1)
          // the tabs start where the list's group headings do: at their chevrons (the rows' dots), past the icon's own inset
          expect(Math.abs(t.tabs.left - t.chevron.left)).toBeLessThan(4)
          // what waits on you is counted inside the Needs you tab, centred on its line and clear of its end
          expect(t.count).not.toBeNull()
          expect(Math.abs((t.count!.top + t.count!.bottom) / 2 - (t.tab.top + t.tab.bottom) / 2)).toBeLessThan(0.5)
          expect(t.tab.right - t.count!.right).toBeGreaterThanOrEqual(8)
          // and it stays right there with Artifacts shown
          await page.getByRole('button', { name: 'Artifacts', exact: true }).click()
          const still = await page.evaluate(() => {
            const c = document.querySelector('[aria-label="Show"] button [data-attention-badge]')
            return c ? (c.getBoundingClientRect().toJSON() as Box) : null
          })
          expect(still).toEqual(t.count)
          await page.getByRole('button', { name: /^Tasks/ }).first().click()
        }
        await page.close()
      }
    }
  }, 60_000)

  test('no "everything under it" on a phone\'s Tasks tab either', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:mac:lilla-varlden')}`)
    await page.getByRole('button', { name: /Tasks/ }).first().tap()
    await page.getByText('Needs you', { exact: true }).waitFor()
    expect(await page.getByText('everything under it').count()).toBe(0)
    await page.close()
  }, 30_000)
})

describe.skipIf(!browser)("a place's mode pill", () => {
  for (const [name, opts] of [
    ['small phone, dark', { viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true, colorScheme: 'dark' }],
    ['phone, light', { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, colorScheme: 'light' }],
    ['desktop, light', { viewport: { width: 1600, height: 900 }, colorScheme: 'light' }],
    ['desktop, dark', { viewport: { width: 1600, height: 900 }, colorScheme: 'dark' }],
  ] as const)
    test(`only on Autopilot: its red pill, its word always, sits beside the ⋯ menu (on a phone after the subtitle), and a tap opens that menu to switch it off (${name})`, async () => {
      const p = world.places.find((x) => x.id === 'p:vm-str:herdr-projects')!
      const was = p.mode
      await world.act({ type: 'mode', place: p.id, mode: 'autopilot' })
      const phone = !!opts.hasTouch
      const ctx = await browser!.newContext(opts)
      const page = await ctx.newPage()
      await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent(p.id)}`)
      const head = page.locator('[data-chrome]').first()
      const pill = head.locator('button[data-mode]')
      await pill.waitFor()
      const more = head.getByRole('button', { name: 'Menu', exact: true })
      const title = head.getByText(p.name, { exact: true }).first()
      const token = (name: string) =>
        page.evaluate((n) => {
          const s = document.createElement('i')
          s.style.color = `var(${n})`
          document.body.append(s)
          const c = getComputedStyle(s).color
          s.remove()
          return c
        }, name)
      {
        const [label, colour] = ['Autopilot', '--need']
        expect(await pill.getAttribute('aria-label')).toBe('Autopilot is on. Change it')
        // the title's line holds only the name
        const [t, b, m] = [(await title.boundingBox())!, (await pill.boundingBox())!, (await more.boundingBox())!]
        expect(await title.evaluate((e) => !!e.parentElement!.querySelector('[data-mode]'))).toBe(false)
        if (phone) {
          // a phone's header has no room beside the ⋯ for its word: it ends the subtitle line, under the name
          const k = await pill.evaluate((e) => {
            const r = e.previousElementSibling!.getBoundingClientRect()
            return { x: r.x, y: r.y, width: r.width, height: r.height, text: e.previousElementSibling!.textContent }
          })
          expect(k.text).toBe('Space on vm-str')
          expect(Math.abs(k.y + k.height / 2 - (b.y + b.height / 2))).toBeLessThan(2)
          expect(b.x - (k.x + k.width)).toBeWithin(0, 10)
          expect(b.y).toBeGreaterThanOrEqual(t.y + t.height - 1)
          expect(b.x + b.width).toBeLessThan(m.x)
        } else {
          // right beside the ⋯, on its line, at the header's right
          expect(Math.abs(m.y + m.height / 2 - (b.y + b.height / 2))).toBeLessThan(2)
          expect(m.x - (b.x + b.width)).toBeWithin(0, 12)
          expect(b.x).toBeGreaterThan(t.x + t.width)
        }
        // fully round, the dot and the word, whole: never a bare dot, which reads as recording
        expect(await pill.evaluate((e) => parseFloat(getComputedStyle(e).borderRadius) >= e.getBoundingClientRect().height / 2)).toBe(true)
        expect(await pill.innerText()).toBe(label)
        expect(await pill.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        // its dot red, as what needs you: Autopilot works on its own
        expect(await pill.evaluate((e) => getComputedStyle(e, '::before').backgroundColor)).toBe(await token(colour))
        // the word readable on its tint
        {
          const ratio = await pill.evaluate((e) => {
            // paint each colour on a pixel to read it, whatever form it computes to (color-mix gives color(srgb …))
            const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
            const px = (...fills: string[]) => {
              c.clearRect(0, 0, 1, 1)
              for (const f of fills) {
                c.fillStyle = f
                c.fillRect(0, 0, 1, 1)
              }
              return [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)]
            }
            let under: Element | null = e.parentElement
            while (under && getComputedStyle(under).backgroundColor === 'rgba(0, 0, 0, 0)') under = under.parentElement
            const lum = (rgb: number[]) => rgb.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
            const bg = lum(px(getComputedStyle(under ?? document.documentElement).backgroundColor, getComputedStyle(e).backgroundColor))
            const fg = lum(px(getComputedStyle(e).color))
            return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
          })
          expect(ratio).toBeGreaterThan(4.5)
        }
      }
      // a tap opens the ⋯ menu, its switch on; switched off, the header says nothing of the mode
      await pill.click()
      const sw = page.getByRole('menu').getByRole('menuitemcheckbox', { name: 'Autopilot' })
      await sw.waitFor()
      expect(await pill.getAttribute('aria-expanded')).toBe('true')
      expect(await sw.getAttribute('aria-checked')).toBe('true')
      await sw.click()
      await page.waitForFunction(() => !document.querySelector('[data-chrome] [data-mode]'))
      await page.keyboard.press('Escape')
      await page.getByRole('menu').waitFor({ state: 'detached' })
      expect(await head.innerText()).not.toMatch(/Copilot|Autopilot|Manual|Regular/)
      await world.act({ type: 'mode', place: p.id, mode: was })
      await ctx.close()
    }, 30_000)

  test("on a phone a long name gives way: the title truncates, centred, and the pill's word stays whole", async () => {
    const p = world.places.find((x) => x.id === 'p:vm-str:herdr-projects')!
    const [was, name] = [p.mode, p.name]
    p.name = 'tor-gameboy-with-a-really-long-project-name'
    await world.act({ type: 'mode', place: p.id, mode: 'autopilot' })
    const page = await browser!.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent(p.id)}`)
    const head = page.locator('[data-chrome]').first()
    const pill = head.locator('button[data-mode]')
    await pill.waitFor()
    const title = head.getByText(p.name, { exact: true }).first()
    expect(await title.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true)
    const t = (await title.boundingBox())!
    // centred with the place's # before it
    const icon = (await title.locator('xpath=preceding-sibling::*[local-name()="svg"]').boundingBox())!
    expect(Math.abs((icon.x + t.x + t.width) / 2 - 375 / 2)).toBeLessThan(2)
    expect(await pill.innerText()).toBe('Autopilot')
    expect(await pill.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
    const b = (await pill.boundingBox())!
    expect(b.x + b.width).toBeLessThan(375)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    p.name = name
    await world.act({ type: 'mode', place: p.id, mode: was })
    await page.close()
  }, 30_000)
})

describe.skipIf(!browser)('a mode card', () => {
  test("Autopilot switched on or off shows as one small card in the place's chat, its icon beside the first line, on screen, phone and desktop", async () => {
    const p = world.snapshot().places.find((x) => !x.home)!
    await world.act({ type: 'mode', place: p.id, mode: 'autopilot' })
    await world.act({ type: 'mode', place: p.id, mode: 'regular' })
    for (const [phone, scheme] of [[true, 'light'], [true, 'dark'], [false, 'light'], [false, 'dark']] as const) {
      const width = phone ? 390 : 1280
      const ctx = await browser!.newContext({ viewport: { width, height: 844 }, hasTouch: phone, isMobile: phone, colorScheme: scheme })
      const page = await ctx.newPage()
      await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent(p.id)}`)
      const card = page.locator('[data-mode-card]').last()
      await card.waitFor()
      expect(await card.textContent()).toBe('Autopilot off · does what you ask')
      const { box, icon, word } = await card.evaluate((el) => ({
        box: el.getBoundingClientRect().toJSON() as Box,
        icon: el.querySelector('svg')!.getBoundingClientRect().toJSON() as Box,
        word: el.querySelector('b')!.getBoundingClientRect().toJSON() as Box,
      }))
      expect(box.left).toBeGreaterThanOrEqual(0)
      expect(box.right).toBeLessThanOrEqual(width)
      expect(Math.abs((icon.top + icon.bottom) / 2 - (word.top + word.bottom) / 2)).toBeLessThan(2)
      await ctx.close()
    }
  }, 30_000)
})

describe.skipIf(!browser)('a coordinator working in the background', () => {
  test('says nothing of it: no word in its header, no dots, nothing in the sidebar (the main home space, a machine’s home space, a space; desktop and phone)', async () => {
    const places = ['p:vm-str:~', 'p:mac:~', 'p:vm-str:herdr-projects'].map((id) => world.places.find((p) => p.id === id)!)
    const done: Message = { id: 'bg-reply', who: 'agent', text: 'Research is running.', at: Date.now() }
    const chats = places.map((p) => (world.chats[p.chat] ??= { key: p.chat, cli: 'Claude Code', messages: [] }))
    const was = chats.map((c) => ({ working: c.working, background: c.background }))
    for (const c of chats) Object.assign(c, { working: true, background: true, messages: [...c.messages, done] })
    for (const phone of [false, true]) {
      const page = await browser!.newPage(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 800 } })
      for (const p of places) {
        await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent(p.id)}`)
        await page.getByText('Research is running.').first().waitFor()
        expect(await page.locator('[data-chrome]').first().innerText()).not.toContain('background')
        expect(await page.locator('.typing').count()).toBe(0)
        expect(await page.locator('body').innerText()).not.toContain('working in background')
      }
      await page.close()
    }
    chats.forEach((c, i) => {
      Object.assign(c, was[i])
      c.messages = c.messages.filter((m) => m.id !== 'bg-reply')
    })
  }, 30_000)
})


describe.skipIf(!browser)('clear phone task titles', () => {
  test('a long task name can be expanded while its ID and progress stay visible', async () => {
    const task = world.tasks.find((t) => t.id === 'GTM-14')!
    const was = task.name
    const name = 'Bundle skills into the template with clear instructions for every machine and every new project'
    task.name = name
    const page = await browser!.newPage({ viewport: { width: 320, height: 740 }, hasTouch: true })
    try {
      await page.goto(`${url()}&task=GTM-14`)
      const title = page.getByRole('button', { name: `Show full task title: ${name}` })
      await title.waitFor()
      const header = page.locator('[data-chrome]').filter({ has: title })
      expect(await header.textContent()).toContain('GTM-14 · Claude Code')
      expect(await header.textContent()).toContain('62%')
      expect(await title.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true)
      await title.click()
      const expanded = page.getByRole('button', { name: `Collapse task title: ${name}` })
      expect(await expanded.getAttribute('aria-expanded')).toBe('true')
      expect(await expanded.evaluate((e) => e.scrollHeight <= e.clientHeight + 1)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    } finally {
      task.name = was
      await page.close()
    }
  })
})

describe.skipIf(!browser)('conversation header alignment', () => {
  test('space and task headers follow their reading column on very wide screens', async () => {
    const page = await browser!.newPage({ viewport: { width: 2560, height: 1000 } })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/gtm`)
    await page.getByRole('textbox', { name: 'Message gtm…' }).waitFor()
    const aligned = async () => page.locator('[data-conversation-head]').first().evaluate((head) => {
      const messages = head.closest('section')!.querySelector('[data-messages]')!
      const h = head.getBoundingClientRect(), m = messages.getBoundingClientRect()
      return Math.abs(h.left - m.left) < 1 && Math.abs(h.width - m.width) < 1
    })
    expect(await aligned()).toBe(true)
    await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/gtm&task=GTM-14`)
    await page.getByRole('textbox', { name: 'Message GTM-14…' }).waitFor()
    await page.getByRole('button', { name: 'Hide gtm', exact: true }).click()
    await page.getByRole('button', { name: 'Show gtm', exact: true }).waitFor()
    const taskHead = page.locator('section:has(textarea[aria-label="Message GTM-14…"]) > [data-chrome] [data-conversation-head]').last()
    expect(await taskHead.evaluate((head) => {
      const messages = head.closest('section')!.querySelector('[data-messages]')!
      return Math.abs(head.getBoundingClientRect().left - messages.getBoundingClientRect().left) < 1
    })).toBe(true)
    await page.close()
  })
})
