// The sidebars and places: modes, the ⋯ menu, the places tree, one machine or many, in a real browser (layout.ts).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Page } from 'playwright-core'
import { PILOT_BLOCKED } from '../shared/types.ts'
import { layout, settled, type Box } from './layout.ts'

const { browser, world, server, url } = await layout()

/** adds vm-str's quiet project: nothing waits on you there and nothing is unread, so folding vm-str hides it (what has
 *  something in it stays in sight). Gives back a function that takes it away again */
async function quietProject() {
  await world.addSpace({ machine: 'vm-str', path: '~/dev/quiet', create: true })
  return () => {
    world.places = world.places.filter((p) => p.id !== 'p:vm-str:quiet')
    world.emit('snapshot')
  }
}

describe.skipIf(!browser)('sidebars', () => {
  const width = (page: import('playwright-core').Page, sel: string) => page.$eval(sel, (el) => Math.round(el.getBoundingClientRect().width))
  const places = '#places'
  const tasks = 'section[aria-label="Tasks"]'
  /** drags a separator's middle by dx */
  const drag = async (page: import('playwright-core').Page, name: string, dx: number) => {
    const b = (await page.getByRole('separator', { name }).boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 6 })
    await page.mouse.up()
  }
  const settled = (page: import('playwright-core').Page) => page.waitForTimeout(350)

  test('drag an inner edge to resize, double-click to reset; this device remembers (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    await page.goto(url())
    await page.getByRole('separator', { name: 'Resize spaces' }).waitFor()
    expect(await width(page, places)).toBe(260)
    expect(await width(page, tasks)).toBe(400)
    await drag(page, 'Resize spaces', 80)
    await drag(page, 'Resize tasks', -100)
    expect(await width(page, places)).toBe(340)
    expect(await width(page, tasks)).toBe(500)
    // no wider than their max, and the chat keeps its room
    await drag(page, 'Resize spaces', 400)
    expect(await width(page, places)).toBe(400)
    // the arrow keys resize a focused edge
    await page.getByRole('separator', { name: 'Resize tasks' }).focus()
    await page.keyboard.press('ArrowLeft')
    await settled(page)
    expect(await width(page, tasks)).toBe(516)
    await page.reload()
    await page.getByRole('separator', { name: 'Resize spaces' }).waitFor()
    expect(await width(page, places)).toBe(400)
    expect(await width(page, tasks)).toBe(516)
    await page.getByRole('separator', { name: 'Resize spaces' }).dblclick()
    await page.getByRole('separator', { name: 'Resize tasks' }).dblclick()
    await settled(page)
    expect(await width(page, places)).toBe(260)
    expect(await width(page, tasks)).toBe(400)
    await page.close()
  }, 30_000)

  test('places hides with its toggle, ⌘B, or dragged narrow, and comes back as wide as it was (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    await page.goto(url())
    const hide = page.getByRole('button', { name: 'Hide Spaces' })
    const show = page.getByRole('button', { name: 'Show Spaces' })
    await drag(page, 'Resize spaces', 60)
    expect(await width(page, places)).toBe(320)
    // the toggle at the top of places; hidden, the chat's header keeps the place's name and the toggle
    await hide.click()
    await settled(page)
    expect(await page.$eval(places, (n) => n.parentElement!.getBoundingClientRect().width)).toBe(0)
    expect(await page.$eval(places, (n) => n.parentElement!.inert)).toBe(true)
    expect(await page.getByRole('separator', { name: 'Resize spaces' }).count()).toBe(0)
    expect(await page.locator('section').first().getByText('home', { exact: true }).isVisible()).toBe(true)
    expect(await page.locator('section').first().getByText('Home · every machine', { exact: true }).isVisible()).toBe(true)
    expect(await show.getAttribute('aria-expanded')).toBe('false')
    // focus follows the toggle to its other spot
    expect(await show.evaluate((b) => b === document.activeElement)).toBe(true)
    await show.click()
    await settled(page)
    expect(await width(page, places)).toBe(320)
    // ⌘B (Ctrl+B) works while typing too
    await page.getByRole('textbox', { name: /Message/ }).focus()
    await page.keyboard.press('Control+b')
    await settled(page)
    expect(await show.isVisible()).toBe(true)
    await page.keyboard.press('Control+b')
    await settled(page)
    expect(await hide.isVisible()).toBe(true)
    // dragged narrow enough, it snaps shut; it stays shut after a reload
    await drag(page, 'Resize spaces', -200)
    await settled(page)
    expect(await show.isVisible()).toBe(true)
    await page.reload()
    await show.waitFor()
    expect(await page.$eval(places, (n) => n.parentElement!.getBoundingClientRect().width)).toBe(0)
    // the sidebar's foot holds Settings alone
    expect(await page.getByText('Keyboard', { exact: true }).count()).toBe(0)
    // and Settings' Keyboard shortcuts lists the key: ? opens it there and shuts it again
    await page.keyboard.press('?')
    const settings = page.getByRole('region', { name: 'Settings' })
    expect(await settings.getByRole('button', { name: 'Keyboard shortcuts' }).getAttribute('aria-current')).toBe('page')
    expect(await settings.getByText('Show or hide Spaces').count()).toBe(1)
    await page.keyboard.press('?')
    expect(await settings.count()).toBe(0)
    await show.click()
    await settled(page)
    expect(await width(page, places)).toBe(320)
    await page.close()
  }, 30_000)

  test('while dragging, the chat beside reflows with every move: nothing overlaps it, nothing jumps on letting go (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    await page.goto(url())
    await page.getByRole('separator', { name: 'Resize spaces' }).waitFor()
    /** the chat's content (its right edge) against the columns either side of it */
    const edges = () =>
      page.evaluate(() => {
        const chat = document.querySelector('#places')!.parentElement!.nextElementSibling!.firstElementChild!.getBoundingClientRect()
        return {
          chatLeft: Math.round(chat.left),
          chatRight: Math.round(chat.right),
          places: Math.round(document.querySelector('#places')!.parentElement!.getBoundingClientRect().right),
          tasks: Math.round(document.querySelector('section[aria-label="Tasks"]')!.getBoundingClientRect().left),
        }
      })
    for (const [name, dx] of [['Resize tasks', -300], ['Resize tasks', 60], ['Resize spaces', 120]] as const) {
      const b = (await page.getByRole('separator', { name }).boundingBox())!
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 6 })
      // a frame later, still held: the chat fills just the room between, as it will after letting go
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      const held = await edges()
      expect(held.chatLeft).toBe(held.places)
      expect(held.chatRight).toBe(held.tasks)
      await page.mouse.up()
      expect(await edges()).toEqual(held)
    }
    await page.close()
  }, 30_000)

  test('available room chooses a drawer at 820/1024/1100 and docking at 1180; resized lists keep chat readable', async () => {
    const page = await browser!.newPage({ viewport: { width: 1024, height: 850 } })
    await page.goto(url())
    await page.getByRole('textbox', { name: 'Message home…' }).waitFor()
    for (const w of [820, 1024, 1100, 1180, 1440]) {
      await page.setViewportSize({ width: w, height: 850 })
      await settled(page)
      const docked = w >= 1180
      expect(await page.getByRole('button', { name: 'Hide Spaces', exact: true }).count()).toBe(docked ? 1 : 0)
      expect(await page.getByRole('button', { name: 'Spaces', exact: true }).count()).toBe(docked ? 0 : 1)
      expect(await page.locator('[data-messages]').first().evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThanOrEqual(480)
      if (!docked) {
        await page.getByRole('button', { name: 'Spaces', exact: true }).click()
        await page.locator('nav[aria-label="Spaces"]:not(#places)').waitFor()
        await page.getByRole('button', { name: 'Close', exact: true }).click()
      }
    }
    await drag(page, 'Resize tasks', -300)
    await page.setViewportSize({ width: 1180, height: 850 })
    await settled(page)
    expect(await page.getByRole('button', { name: 'Spaces', exact: true }).count()).toBe(1)
    expect(await page.locator('[data-messages]').first().evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThanOrEqual(480)
    await page.reload()
    await page.getByRole('button', { name: 'Spaces', exact: true }).waitFor()
    await page.setViewportSize({ width: 1920, height: 850 })
    await page.getByRole('button', { name: 'Hide Spaces', exact: true }).waitFor()
    expect(await width(page, tasks)).toBe(700)
    // Explicitly hidden places and task tools stay hidden on wider windows.
    await page.getByRole('button', { name: 'Hide Spaces', exact: true }).click()
    await page.setViewportSize({ width: 2560, height: 850 })
    await page.getByRole('button', { name: 'Show Spaces', exact: true }).waitFor()
    expect(await page.locator('#task-panel').count()).toBe(0)
    await page.close()
  }, 30_000)

  test('a drawer open while widening does not reopen when the window narrows again', async () => {
    const page = await browser!.newPage({ viewport: { width: 1100, height: 850 } })
    await page.goto(url())
    await page.getByRole('button', { name: 'Spaces', exact: true }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).waitFor()
    await page.setViewportSize({ width: 1180, height: 850 })
    await page.getByRole('button', { name: 'Hide Spaces', exact: true }).waitFor()
    await page.setViewportSize({ width: 1100, height: 850 })
    await settled(page)
    expect(await page.getByRole('button', { name: 'Close', exact: true }).count()).toBe(0)
    await page.getByRole('button', { name: 'Spaces', exact: true }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).waitFor()
    await page.close()
  })

  test('a tablet resizes tasks only; a phone keeps its drawer', async () => {
    const tablet = await browser!.newPage({ viewport: { width: 900, height: 800 } })
    await tablet.goto(url())
    await tablet.getByRole('separator', { name: 'Resize tasks' }).waitFor()
    expect(await tablet.getByRole('separator', { name: 'Resize spaces' }).count()).toBe(0)
    expect(await tablet.getByRole('button', { name: /^(Hide|Show) Spaces$/ }).count()).toBe(0)
    const before = await width(tablet, tasks)
    await drag(tablet, 'Resize tasks', -40)
    expect(await width(tablet, tasks)).toBe(Math.min(before + 40, 900 - 480))
    await tablet.close()
    const phone = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await phone.goto(url())
    await phone.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).waitFor()
    expect(await phone.getByRole('separator').count()).toBe(0)
    expect(await phone.getByRole('button', { name: /^(Hide|Show) Spaces$/ }).count()).toBe(0)
    await phone.close()
  }, 30_000)
})

describe.skipIf(!browser)("a place's Autopilot", () => {
  test('where it cannot run, the switch is greyed with the reason and asks nothing', async () => {
    const was = world.sections
    const reason = 'Autopilot needs Linux. mac runs macOS.'
    world.sections = was.map((s) => (s.name === 'Autopilot' && s.level === 'p:vm-str:~' ? { ...s, rows: [{ label: PILOT_BLOCKED, key: '', value: reason, fixed: true }, ...s.rows] } : s))
    world.emit('snapshot')
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    try {
      await page.goto(url())
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
      const pop = page.getByRole('menu', { name: 'Menu' })
      const sw = pop.getByRole('menuitemcheckbox', { name: 'Autopilot' })
      await sw.waitFor()
      expect(await sw.isDisabled()).toBe(true)
      await pop.getByText(reason).waitFor()
      // the whole reason, on a phone, not cut off
      expect(await pop.getByText(reason).evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
      expect(await page.getByRole('alertdialog').count()).toBe(0)
    } finally {
      await page.close()
      world.sections = was
      world.emit('snapshot')
    }
  }, 30_000)

  for (const [name, opts] of [
    ['phone, dark', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' }],
    ['phone, light', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'light' }],
    ['desktop, light', { viewport: { width: 1600, height: 900 }, colorScheme: 'light' }],
    ['desktop, dark', { viewport: { width: 1600, height: 900 }, colorScheme: 'dark' }],
  ] as const)
    test(`is a switch at the top of the ⋯ menu, over search and the terminal; a pill beside that menu shows it only while on (${name})`, async () => {
      const ctx = await browser!.newContext(opts)
      const page = await ctx.newPage()
      await page.goto(url())
      await page.getByRole('button', { name: 'Menu', exact: true }).waitFor()
      // with Autopilot off the header says nothing of it
      const pill = page.locator('[data-chrome] button[data-mode]')
      expect(await pill.count()).toBe(0)
      // no switch in the + menu: that keeps files, model and effort
      await page.locator('[data-composer] button[aria-label="Attach files and more"]').first().click()
      await page.getByRole('menuitem', { name: 'File or photo' }).waitFor()
      expect(await page.getByRole('menuitemcheckbox', { name: 'Autopilot' }).count()).toBe(0)
      await page.keyboard.press('Escape')
      // the ⋯ menu: the switch first, then search, the terminal, artifacts; no three-way picker
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
      const pop = page.getByRole('menu', { name: 'Menu' })
      const sw = pop.getByRole('menuitemcheckbox', { name: 'Autopilot' })
      await sw.waitFor()
      expect(await pop.getByRole('menuitem').allTextContents()).toEqual([expect.stringContaining('Search in this chat'), 'Open full search', 'Restart agent…', expect.stringContaining('Terminal'), 'Artifacts'])
      expect(await pop.locator('[role=group]').count()).toBe(0)
      expect(await sw.getAttribute('aria-checked')).toBe('false')
      expect(await pop.getByText('Off: does what you ask').count()).toBe(1)
      // a row as tall as the menu's other rows, its icon in their icon slot, its switch inside
      await settled(page)
      const items = await pop.locator('[role=menuitem]').evaluateAll((bs) => bs.map((b) => ({ h: b.getBoundingClientRect().height, slot: b.firstElementChild!.getBoundingClientRect().left })))
      const row = await sw.evaluate((b) => ({ h: b.getBoundingClientRect().height, slot: b.firstElementChild!.getBoundingClientRect().left }))
      expect(row.h).toBeCloseTo(items[0].h, 1)
      expect(row.slot).toBeCloseTo(items[0].slot, 1)
      const [menu, s] = [(await pop.boundingBox())!, (await sw.boundingBox())!]
      expect(s.x).toBeGreaterThanOrEqual(menu.x)
      expect(s.x + s.width).toBeLessThanOrEqual(menu.x + menu.width + 0.5)
      // a tap only asks: what it replaces and spends, and Cancel leaves it off
      await sw.click()
      const sheet = page.getByRole('alertdialog', { name: /^Turn on Autopilot/ })
      await sheet.waitFor()
      expect(await sheet.innerText()).toContain('replaces this one')
      expect(await sheet.innerText()).toContain('allowance')
      expect(await pop.count()).toBe(0)
      await sheet.getByRole('button', { name: 'Cancel' }).click()
      await sheet.waitFor({ state: 'detached' })
      expect(await pill.count()).toBe(0)
      // on: the pill shows, red, and the switch says so
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
      await sw.click()
      await sheet.getByRole('button', { name: 'Turn on' }).click()
      await pill.waitFor()
      await sheet.waitFor({ state: 'detached' })
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
      await sw.waitFor()
      expect(await sw.getAttribute('aria-checked')).toBe('true')
      expect(await pill.innerText()).toBe('Autopilot')
      expect(await pill.getAttribute('aria-label')).toBe('Autopilot is on. Change it')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      // off again: the pill goes, for the tests after
      await sw.click()
      await page.waitForFunction(() => !document.querySelector('[data-chrome] button[data-mode]'))
      expect(await sw.getAttribute('aria-checked')).toBe('false')
      await ctx.close()
    }, 30_000)

  for (const [name, opts] of [
    ['phone, dark', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' }],
    ['desktop, light', { viewport: { width: 1440, height: 800 }, colorScheme: 'light' }],
  ] as const)
    test(`a sidebar row on Autopilot has a red dot just before its name, clear of the chevrons; no name moves (${name})`, async () => {
      const on = ['p:vm-str:~', 'p:mac:~', 'p:vm-str:gtm']
      const was = on.map((id) => world.places.find((p) => p.id === id)!.mode)
      const ctx = await browser!.newContext(opts)
      const page = await ctx.newPage()
      await page.goto(url())
      // a phone's places are in its drawer
      const side = opts.viewport.width < 600 ? 'nav[aria-label="Spaces"]' : '#places'
      if (side !== '#places') await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
      await page.waitForSelector(`${side} li`)
      await settled(page)
      const rows = () =>
        page.$$eval(`${side} li[data-project]`, (ls) =>
          ls.map((l) => {
            const go = l.querySelector('button[aria-label]:not([aria-expanded]):not([aria-haspopup])')!
            const fold = l.querySelector('button[aria-label^="Show "], button[aria-label^="Hide "]')?.getBoundingClientRect()
            const mark = l.querySelector('[data-autopilot]')
            const m = mark?.getBoundingClientRect()
            // the place's icon, between the mark and the name (SHE-207)
            const icon = mark?.nextElementSibling?.getBoundingClientRect()
            return { said: go.getAttribute('aria-label')!, name: go.getBoundingClientRect().left, fold: fold?.right, icon: icon && { left: icon.left, right: icon.right }, mark: m && { left: m.left, right: m.right, w: m.width, h: m.height, round: parseFloat(getComputedStyle(mark!).borderRadius) >= m.width / 2, hidden: mark!.getAttribute('aria-hidden') } }
          }),
        )
      const before = await rows()
      expect(before.every((r) => !r.mark)).toBe(true)
      for (const id of on) await world.act({ type: 'mode', place: id, mode: 'autopilot' })
      await page.waitForFunction(([s, n]) => document.querySelectorAll(`${s} [data-autopilot]`).length === n, [side, on.length] as const)
      const after = await rows()
      // every name where it was, on Autopilot or not
      expect(after.map((r) => r.name)).toEqual(before.map((r) => r.name))
      for (const r of after.filter((r) => r.mark)) {
        // just before the space's # and its name, clear of the headings' chevrons
        expect(r.icon!.left - r.mark!.right).toBeWithin(0, 6)
        expect(r.name - r.icon!.right).toBeWithin(0, 8)
        if (r.fold !== undefined) expect(r.mark!.left).toBeGreaterThanOrEqual(r.fold)
        // the dot in its round tint, as the header's pill without the word; screen readers hear it in the row's name
        expect(r.mark!.w).toBeWithin(12, 18)
        expect(r.mark!.h).toBe(r.mark!.w)
        expect(r.mark!.round).toBe(true)
        expect(r.mark!.hidden).toBe('true')
        expect(r.said).toContain(', on Autopilot')
      }
      expect(after.filter((r) => r.mark).length).toBe(on.length)
      expect(await page.locator(`${side} [data-autopilot]`).first().evaluate((e) => getComputedStyle(e, '::before').backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      for (const [i, id] of on.entries()) await world.act({ type: 'mode', place: id, mode: was[i] })
      // each switch left a card in its chat: read, for the tests after
      const last = world.snapshot().last ?? {}
      await world.act({ type: 'read', chats: Object.fromEntries(on.map((id) => [id, last[id]])) })
      await page.waitForFunction((s) => !document.querySelector(`${s} [data-autopilot]`), side)
      await ctx.close()
    }, 30_000)

  test("a task's attachment menu keeps files; agent controls live inside it on a small phone", async () => {
    const page = await browser!.newPage({ viewport: { width: 320, height: 640 }, hasTouch: true })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=all&task=GTM-14`)
    await page.locator('[data-composer]').first().waitFor()
    expect(await page.locator('[data-agent-controls]').count()).toBe(0)
    await page.locator('[data-composer] button[aria-label="Attach files and more"]').first().click()
    await page.getByRole('menuitem', { name: 'File or photo' }).waitFor()
    expect(await page.getByRole('combobox', { name: 'Model' }).count()).toBe(0)
    expect(await page.getByRole('group', { name: 'Mode', exact: true }).count()).toBe(0)
    expect(await page.locator('[data-agent-controls] [role=menuitem]').count()).toBe(4)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.close()
  }, 30_000)
})

describe.skipIf(!browser)('the ⋯ menu is one design', () => {
  for (const [name, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1600, height: 900 }],
  ] as const)
    test(`rows share one height, one icon slot and one hint column; no ring after a click (${name})`, async () => {
      const page = await browser!.newPage({ viewport, hasTouch: name === 'phone' })
      await page.goto(url())
      const button = page.getByRole('button', { name: 'Menu', exact: true })
      await button.click()
      await page.getByRole('menu').waitFor()
      await settled(page)
      // a click shows no focus ring: that is for the keyboard; the button is round, so its ring would be too
      expect(await button.evaluate((b) => b.matches(':focus-visible'))).toBe(false)
      expect(await button.evaluate((b) => parseFloat(getComputedStyle(b).borderRadius) >= b.getBoundingClientRect().width / 2)).toBe(true)
      const rows = await page.$$eval('[role=menu] [role^=menuitem]', (rs) =>
        rs.map((r) => {
          const [slot, text, hint] = [...r.children].map((c) => c.getBoundingClientRect())
          return { h: r.getBoundingClientRect().height, slot: slot.left, text: text.left, hint: hint?.right, lines: text.height }
        }),
      )
      expect(rows.length).toBeGreaterThanOrEqual(2)
      for (const r of rows) {
        expect(r.h).toBe(rows[0].h)
        expect(r.slot).toBe(rows[0].slot)
        expect(r.text).toBe(rows[0].text)
        // every row is one line
        expect(r.lines).toBeLessThan(r.h)
      }
      const hints = rows.map((r) => r.hint).filter((x) => x !== undefined)
      expect(new Set(hints).size).toBeLessThanOrEqual(1)
      // the menu's corner is the shared popover corner
      expect(await page.getByRole('menu').evaluate((m) => getComputedStyle(m).borderRadius)).toBe('14px')
      await page.close()
    }, 30_000)

  for (const [name, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1600, height: 900 }],
  ] as const)
    test(`a click or tap outside, Escape or a pick closes it, and the click outside presses nothing under it (${name})`, async () => {
      const page = await browser!.newPage({ viewport, hasTouch: name === 'phone' })
      await page.goto(url())
      const plus = page.getByRole('button', { name: 'Attach files and more' })
      const more = page.getByRole('button', { name: 'Menu', exact: true })
      const menus = page.getByRole('menu')
      const gone = () => menus.waitFor({ state: 'detached' })
      // a tap or click on the chat, well away from it (under the ⋯ menu, which comes down a third of a phone's height)
      const outside = async () => {
        if (name === 'phone') await page.touchscreen.tap(viewport.width / 2, viewport.height / 2)
        else await page.mouse.click(viewport.width / 2, viewport.height / 2)
      }
      await plus.click()
      await menus.waitFor()
      await outside()
      await gone()
      await plus.click()
      await menus.waitFor()
      await page.keyboard.press('Escape')
      await gone()
      // File or photo closes it as the device's picker opens
      await plus.click()
      const chooser = page.waitForEvent('filechooser')
      await page.getByRole('menuitem', { name: 'File or photo' }).click()
      await chooser
      await gone()
      // its own button closes it rather than opening it again
      await plus.click()
      await menus.waitFor()
      await plus.click()
      await gone()
      // the ⋯ the same way, and the click that closes it doesn't open the + under it
      await more.click()
      await menus.waitFor()
      await outside()
      await gone()
      await more.click()
      await menus.waitFor()
      await plus.click()
      await gone()
      await settled(page)
      expect(await menus.count()).toBe(0)
      await page.close()
    }, 30_000)

  test('the keyboard opens it, moves through it with the arrows, and Escape gives the focus back (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    await page.goto(url())
    const button = page.getByRole('button', { name: 'Menu', exact: true })
    await button.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('menu').waitFor()
    const focused = () => page.evaluate(() => document.activeElement?.firstElementChild?.nextElementSibling?.textContent)
    // the Autopilot switch first, a row like the others
    expect(await focused()).toBe('Autopilot')
    await page.keyboard.press('ArrowDown')
    expect(await focused()).toBe('Search in this chat')
    await page.keyboard.press('ArrowDown')
    expect(await focused()).toBe('Open full search')
    await page.keyboard.press('ArrowDown')
    expect(await focused()).toBe('Restart agent…')
    await page.keyboard.press('ArrowDown')
    expect(await focused()).toBe('Terminal')
    await page.keyboard.press('ArrowDown')
    expect(await focused()).toBe('Artifacts')
    await page.keyboard.press('ArrowDown')
    expect(await focused()).toBe('Autopilot')
    await page.keyboard.press('End')
    expect(await focused()).toBe('Artifacts')
    // the focused row shows the ring inside its own corners
    expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineOffset)).toBe('-2px')
    await page.keyboard.press('Escape')
    expect(await page.getByRole('menu').count()).toBe(0)
    expect(await button.evaluate((b) => b === document.activeElement && b.matches(':focus-visible'))).toBe(true)
    // the screen behind it stays: Escape only closed the menu
    expect(new URL(page.url()).searchParams.get('place')).toBe('vm-str/home')
    await page.close()
  }, 30_000)
})

describe.skipIf(!browser)('places, calm like Slack', () => {
  /** each place row: its name (in the button going there), the count on its right, whether its name is bold, and any status mark left in it */
  const rows = (page: import('playwright-core').Page, sel: string) =>
    page.$$eval(`${sel} li`, (ls) =>
      ls.map((l) => {
        const name = l.querySelector('button > span')!
        const badge = l.querySelector('[data-attention-badge]')
        return { name: name.textContent, count: badge ? [...badge.children].reduce((sum, part) => sum + Number(part.textContent), 0) : 0, bold: Number(getComputedStyle(name).fontWeight) >= 600, dots: l.querySelectorAll('.dot').length, text: l.textContent }
      }),
    )
  const check = (rs: Awaited<ReturnType<typeof rows>>) => {
    // no status marks; only rows with something waiting on you have a count, and their names are bold
    expect(rs.every((r) => r.dots === 0)).toBe(true)
    expect(rs.every((r) => r.bold === r.count > 0)).toBe(true)
    // each row counts its own coordinator's chat alone: nothing rolls up from the rows shown under it
    for (const m of ['vm-str', 'mac']) expect(rs.find((r) => r.name === m)!.count).toBe(0)
    expect(rs.some((r) => r.count > 0)).toBe(true)
    // a machine Shepherdr can't reach says so quietly
    expect(rs.find((r) => r.name === 'nas')!.text).toBe("nasCan't reach")
  }

  test('desktop and the phone drawer: no marks, a count only where something waits on you', async () => {
    const desk = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    await desk.goto(url())
    await desk.waitForSelector('#places li')
    check(await rows(desk, '#places'))
    await desk.close()
    const phone = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await phone.goto(url())
    await phone.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
    await phone.waitForSelector('nav[aria-label="Spaces"] li')
    check(await rows(phone, 'nav[aria-label="Spaces"]'))
    await phone.close()
  }, 30_000)

  for (const [name, opts] of [
    ['desktop, light', { viewport: { width: 1440, height: 800 }, colorScheme: 'light' }],
    ['phone, dark', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' }],
  ] as const)
    test(`each place has its icon before its name, grey, lit with the name where it is open or bold; search and Settings' picker show it too (${name})`, async () => {
      const ctx = await browser!.newContext(opts)
      const page = await ctx.newPage()
      await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('m:vm-str')}`)
      const phone = opts.viewport.width < 600
      const side = phone ? 'nav[aria-label="Spaces"]' : '#places'
      if (phone) await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
      await page.waitForSelector(`${side} li`)
      const rs = await page.$$eval(`${side} li`, (ls) =>
        ls.map((l) => {
          const name = l.querySelector('button > span')!
          const icon = l.querySelector('[data-icon]')!
          const [i, n] = [icon.getBoundingClientRect(), name.getBoundingClientRect()]
          return { name: name.textContent, icon: icon.getAttribute('data-icon'), size: i.width, gap: n.left - i.right, color: getComputedStyle(icon).color, nameColor: getComputedStyle(name).color, bold: Number(getComputedStyle(name).fontWeight) >= 600, sel: l.classList.contains('bg-sel') }
        }),
      )
      // each machine's server on its heading (no emoji given), each space's # (its home space first); no level over them
      expect(rs.map((r) => [r.name, r.icon])).toEqual([
        ['mac', 'server'],
        ['home', 'hash'],
        ['lilla-varlden', 'hash'],
        ['nas', 'server'],
        ['home', 'hash'],
        ['vm-str', 'server'],
        ['home', 'hash'],
        ['gtm', 'hash'],
        ['herdr-projects', 'hash'],
      ])
      const fg2 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fg2').trim())
      const rgb = await page.evaluate((c) => {
        const el = document.createElement('i')
        el.style.color = c
        document.body.append(el)
        const v = getComputedStyle(el).color
        el.remove()
        return v
      }, fg2)
      for (const [i, r] of rs.entries()) {
        expect(r.size).toBeWithin(15, 16.5)
        expect(r.gap).toBeWithin(4, 9)
        // a space's: lit with the name on the open row and the bold ones; grey on the rest (nas's home can't be
        // reached: greyer still); a heading's stays quiet
        if (r.icon !== 'hash') continue
        if (r.sel || r.bold) expect(r.color).toBe(r.nameColor)
        else if (i !== 4) expect(r.color).toBe(rgb)
      }
      // a link to the machine from before spaces opens its home space
      expect(rs.findIndex((r) => r.sel)).toBe(6)
      expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).resolves.toBe(true)
      if (!phone) {
        // the header's title has its icon too
        expect(await page.locator('main [data-icon], [data-chrome] [data-icon]').first().getAttribute('data-icon')).toBe('hash')
        // ⌘K: a place's icon where a task has its dot
        await page.keyboard.press('Control+k')
        const list = page.getByRole('listbox', { name: 'Search results' })
        await list.waitFor()
        const first = list.getByRole('option').first().locator('[data-icon]')
        expect(await first.getAttribute('data-icon')).toBe('hash')
        // lit on the row the arrow keys are on, as the sidebar's open row
        expect(await first.evaluate((e) => getComputedStyle(e).color)).toBe(await list.getByRole('option').first().evaluate((e) => getComputedStyle(e).color))
        expect(await list.getByRole('option', { name: /^gtm/ }).locator('[data-icon]').getAttribute('data-icon')).toBe('hash')
        await page.keyboard.press('Escape')
      }
      // Settings' place picker: its value and each choice with its place's icon
      await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}`)
      if (phone) await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
      await page.getByRole('navigation', { name: /^(Show |Hide )?Spaces$/ }).getByRole('button', { name: 'Settings', exact: true }).click()
      const pick = page.getByRole('button', { name: /^Editing: / }).first()
      await pick.waitFor()
      expect(await pick.locator('[data-icon]').getAttribute('data-icon')).toBe('layers')
      await pick.click()
      const menu = page.getByRole('menu', { name: 'Choices' })
      expect(await menu.getByRole('menuitemradio').evaluateAll((ms) => ms.slice(0, 6).map((m) => m.querySelector('[data-icon]')?.getAttribute('data-icon')))).toEqual(['layers', 'server', 'hash', 'hash', 'server', 'hash'])
      await ctx.close()
    }, 30_000)
})

describe.skipIf(!browser)('the places tree', () => {
  let unquiet = () => {}
  beforeAll(async () => {
    unquiet = await quietProject()
  })
  afterAll(() => unquiet())
  const box = (page: Page, sel: string) => page.locator(sel).first().evaluate((n) => n.getBoundingClientRect().toJSON() as Box)
  const row = (page: Page, name: string) => page.locator('#places li', { has: page.getByText(name, { exact: true }) }).first()

  test('each machine heading its own + on hover, opening New space on it; a chevron or a tap folds its spaces, remembered; it opens nothing (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    await page.goto(url())
    await page.waitForSelector('#places li')
    // the + waits for the mouse; the offline machine has none
    const plus = page.getByRole('button', { name: 'New space on mac' })
    const shows = () => plus.evaluate((b) => getComputedStyle(b).opacity === '1' && getComputedStyle(b).position !== 'absolute')
    expect(await shows()).toBe(false)
    await row(page, 'mac').hover()
    expect(await shows()).toBe(true)
    expect(await page.getByRole('button', { name: 'New space on nas' }).count()).toBe(0)
    await plus.click()
    const dialog = page.getByRole('dialog', { name: 'New space' })
    await dialog.getByRole('button', { name: 'Machine: mac' }).waitFor()
    await dialog.getByRole('button', { name: 'Close' }).click()
    // a heading is no place: a tap on its name folds it as its chevron does, and the screen stays where it was
    const at = () => new URL(page.url()).searchParams.get('place')
    await row(page, 'mac').getByRole('button', { name: 'mac', exact: true }).click()
    await page.getByRole('button', { name: "Show mac's spaces" }).waitFor()
    expect(at()).toBe('vm-str/home')
    expect(await row(page, 'mac').getAttribute('aria-current')).toBeNull()
    expect(await row(page, 'mac').locator('[aria-current]').count()).toBe(0)
    expect(await page.locator('#places li[data-heading="m:mac"] [data-autopilot], #places li[data-heading="m:mac"] [data-attention-badge]').count()).toBe(0)
    await row(page, 'mac').getByRole('button', { name: 'mac', exact: true }).click()
    await page.getByRole('button', { name: "Hide mac's spaces" }).waitFor()
    expect(at()).toBe('vm-str/home')
    // its ⋯ has New space, New section and Rename machine, nothing of a chat (no Notify, no Mark as read, no Pin)
    await row(page, 'mac').hover()
    await page.getByRole('button', { name: 'More for mac' }).click()
    const menu = page.getByRole('menu', { name: 'mac' })
    expect((await menu.getByRole('menuitem').allTextContents()).map((t) => t.trim())).toEqual(['New space…', 'New section…', 'Rename machine…'])
    await page.keyboard.press('Escape')
    // folded, every vm-str space goes, those waiting on you and the open home too; its heading has a red dot for them,
    // no count (it makes room for the + and ⋯ while the pointer is on it, as a count does)
    await page.getByRole('button', { name: "Hide vm-str's spaces" }).click()
    await page.mouse.move(900, 400)
    await page.locator('#places li', { hasText: 'quiet' }).waitFor({ state: 'detached' })
    expect(await page.locator('#places li[data-project][data-machine="m:vm-str"]').count()).toBe(0)
    expect(await page.locator('#places li[aria-current], #places li:has([aria-current])').count()).toBe(0)
    expect(await row(page, 'vm-str').locator('[data-attention-badge]').count()).toBe(0)
    expect(await row(page, 'vm-str').getByRole('img', { name: 'Something in it waits on you' }).count()).toBe(1)
    expect(at()).toBe('vm-str/home')
    // the screen remembers it, and the chevron brings them back
    await page.reload()
    await page.getByRole('button', { name: "Show vm-str's spaces" }).waitFor()
    expect(await page.locator('#places li', { hasText: 'quiet' }).count()).toBe(0)
    await page.getByRole('button', { name: "Show vm-str's spaces" }).click()
    await page.locator('#places li', { hasText: 'quiet' }).waitFor()
    // the keyboard reaches the +: Tab from the chevron to the name, then on to it
    await page.mouse.move(900, 400)
    await row(page, 'mac').locator('button').first().focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('New space on mac')
    expect(await shows()).toBe(true)
    await page.close()
  }, 30_000)

  test('folded, a machine hides every space in it, the open one too; going to one of them from elsewhere opens it (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    const names = () => page.$$eval('#places li', (ls) => ls.map((l) => (l as HTMLElement).innerText.split('\n')[0]))
    const at = () => new URL(page.url()).searchParams.get('place')
    await page.goto(url().replace('place=vm-str/home', 'place=p%3Avm-str%3Aquiet'))
    await page.getByRole('button', { name: "Hide vm-str's spaces" }).click()
    await page.getByRole('button', { name: "Show vm-str's spaces" }).waitFor()
    await page.mouse.move(900, 400)
    // quiet stays open, out of sight; gtm and herdr-projects wait on you, so the heading has a red dot, not a count
    expect(await names()).toEqual(['mac', 'home', 'lilla-varlden', 'nas', 'home', 'vm-str'])
    expect(at()).toBe('vm-str/quiet')
    expect(await row(page, 'vm-str').locator('[data-attention-badge]').count()).toBe(0)
    expect(await row(page, 'vm-str').getByRole('img', { name: 'Something in it waits on you' }).count()).toBe(1)
    // remembered; Alt+↑ from the hidden one goes to the space shown above where it sits, and leaves the fold as it is
    await page.reload()
    await page.getByRole('button', { name: "Show vm-str's spaces" }).waitFor()
    await page.locator('[data-composer] textarea').focus()
    await page.keyboard.press('Alt+ArrowUp')
    await page.waitForFunction(() => new URL(location.href).searchParams.get('place') === 'nas/home')
    expect(await names()).toEqual(['mac', 'home', 'lilla-varlden', 'nas', 'home', 'vm-str'])
    // gone to from elsewhere (search), its machine opens
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog', { name: 'Search or jump to' })
    await dialog.getByRole('option', { name: /^gtm/ }).first().click()
    await page.locator('#places li', { hasText: 'quiet' }).waitFor()
    expect(await row(page, 'vm-str').getByRole('img').count()).toBe(0)
    await page.close()
  }, 30_000)

  test("machines are sections side by side, as Pinned is: no level over them, their small chevrons at the left edge, their spaces' # under their names, as Slack's (desktop)", async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    await page.goto(url())
    await page.waitForSelector('#places li')
    expect(await page.locator('#places li[data-heading]').evaluateAll((ls) => ls.map((l) => l.getAttribute('data-heading')))).toEqual(['m:mac', 'm:nas', 'm:vm-str'])
    const chevrons = await page.locator('#places li[data-heading] > button[aria-label^="Hide"]').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().left)))
    expect(new Set(chevrons).size).toBe(1)
    const left = (name: string) => page.$eval(`#places li:has-text("${name}") button > span`, (l) => l.getBoundingClientRect().left)
    expect(await left('vm-str')).toBeLessThan(await left('gtm'))
    // a space's # under its machine's name, as a Slack channel's sits under its section's (SHE-225); the chevron near
    // the edge
    const icon = (sel: string) => page.locator(sel).locator('[data-icon]').first().evaluate((i) => Math.round(i.getBoundingClientRect().left))
    const name = await page.locator('#places li[data-heading="m:vm-str"] h2 span').evaluate((n) => Math.round(n.getBoundingClientRect().left))
    expect(Math.abs((await icon('#places li[data-project="p:vm-str:gtm"]')) - name)).toBeLessThanOrEqual(1)
    const side = await page.locator('#places').evaluate((n) => n.getBoundingClientRect().left)
    expect(chevrons[0] - side).toBeLessThanOrEqual(14)
    await page.close()
  }, 30_000)

  test('a narrow sidebar cuts names short; the + and counts stay inside', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.addInitScript(() => localStorage.setItem('shepherdr.sidebars', JSON.stringify({ left: 200, right: 400, open: true })))
    await page.goto(url())
    await page.waitForSelector('#places li')
    await row(page, 'vm-str').hover()
    const side = await box(page, '#places')
    for (const sel of ['#places button[aria-label="New space on vm-str"]', '#places [data-attention-badge]', '#places li:has-text("herdr-projects")']) {
      expect((await box(page, sel)).right).toBeLessThanOrEqual(side.right)
    }
    await page.close()
  }, 30_000)
})

describe.skipIf(!browser)('a single machine', () => {
  /** the other machines go away (or come back): the screen gets the new spaces at once */
  let all: { places: typeof world.places; machines: typeof world.machines } | null = null
  const machines = (only: boolean) => {
    if (only && !all) all = { places: world.places, machines: world.machines }
    if (only && all) Object.assign(world, { places: all.places.filter((p) => p.machine === 'vm-str'), machines: all.machines.filter((m) => m.machine === 'vm-str') })
    if (!only && all) Object.assign(world, all)
    if (!only) all = null
    world.emit('snapshot')
  }
  /** the sidebar's lines, counts left out */
  const sidebar = (page: Page, sel: string) => page.$eval(sel, (n) => (n as HTMLElement).innerText.split('\n').filter((l) => l && !/^\d+$/.test(l)))

  test('a single machine: its heading on top, its home space first under it, its own +', async () => {
    machines(true)
    try {
      // a link to All machines from before lands on the home space, and the address says so
      const desk = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
      await desk.goto(url().replace('place=vm-str/home', 'place=all'))
      await desk.waitForURL(/place=vm-str%2Fhome/)
      await desk.waitForSelector('#places li')
      const side = await sidebar(desk, '#places')
      expect(side).not.toContain('All machines')
      expect(side).not.toContain('Projects')
      expect(side.slice(side.indexOf('vm-str'), side.indexOf('Settings'))).toEqual(['vm-str', 'home', 'gtm', 'herdr-projects'])
      // a tree: the spaces sit in under the machine
      const left = (name: string) => desk.$eval(`#places li:has-text("${name}") button > span`, (l) => l.getBoundingClientRect().left)
      expect(await left('gtm')).toBeGreaterThan(await left('vm-str'))
      await desk.locator('#places li', { hasText: 'vm-str' }).hover()
      expect(await desk.locator('#places').getByRole('button', { name: 'New space on vm-str' }).isVisible()).toBe(true)
      // the chat header says what the space is
      expect(await desk.locator('section').first().getByText('Home space', { exact: true }).isVisible()).toBe(true)
      // search: no All machines either
      await desk.keyboard.press('Control+k')
      const dialog = desk.getByRole('dialog', { name: 'Search or jump to' })
      await dialog.waitFor()
      await dialog.getByRole('option', { name: /gtm/ }).first().waitFor()
      expect(await dialog.getByRole('option', { name: /All machines/ }).count()).toBe(0)
      await desk.close()
      // the phone drawer
      const phone = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
      await phone.goto(url())
      await phone.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
      await phone.waitForSelector('nav[aria-label="Spaces"] li')
      const drawer = await sidebar(phone, 'nav[aria-label="Spaces"]')
      expect(drawer).not.toContain('All machines')
      expect(drawer.slice(drawer.indexOf('vm-str'), drawer.indexOf('Settings'))).toEqual(['vm-str', 'home', 'gtm', 'herdr-projects'])
      await phone.close()
    } finally {
      machines(false)
    }
  }, 30_000)

  test('when the others go, their sections go and the screen stays; they come back, so do they', async () => {
    const desk = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    const headings = () => desk.locator('#places li[data-heading]').evaluateAll((ls) => ls.map((l) => l.getAttribute('data-heading')))
    try {
      await desk.goto(url())
      await desk.locator('#places li[data-heading="m:mac"]').waitFor()
      machines(true)
      await desk.locator('#places li[data-heading="m:mac"]').waitFor({ state: 'detached' })
      expect(await headings()).toEqual(['m:vm-str'])
      expect(new URL(desk.url()).searchParams.get('place')).toBe('vm-str/home')
      machines(false)
      await desk.locator('#places li[data-heading="m:mac"]').waitFor()
      expect(await headings()).toEqual(['m:mac', 'm:nas', 'm:vm-str'])
    } finally {
      machines(false)
      await desk.close()
    }
  }, 30_000)
})

describe.skipIf(!browser)('removing a space', () => {
  /** the demo world as it was: removing takes its tasks too */
  const keep = () => {
    const was = { places: world.places, tasks: world.tasks }
    return () => {
      Object.assign(world, was)
      world.emit('snapshot')
    }
  }

  test("a space row's ⋯ removes it from Shepherdr, asked first; its folder stays; open, its home space takes its place; a home space has no Remove (desktop)", async () => {
    const back = keep()
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await page.goto(`http://127.0.0.1:${server.port}/?place=${encodeURIComponent('p:vm-str:gtm')}`)
      const row = page.locator('#places li', { hasText: 'gtm' })
      const more = row.getByRole('button', { name: 'More for gtm' })
      await more.waitFor()
      // tucked away until the pointer is on the row
      expect(await more.evaluate((b) => getComputedStyle(b).opacity)).toBe('0')
      await row.hover()
      expect(await more.evaluate((b) => getComputedStyle(b).opacity)).toBe('1')
      await more.click()
      // beside its row, past the sidebar's edge: it covers none of the rows under it
      const box = (await page.getByRole('menu').boundingBox())!
      const at = (await row.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(at.x + at.width)
      expect(Math.abs(box.y - at.y)).toBeLessThan(8)
      expect(await page.getByRole('menuitem').last().textContent()).toContain('Remove from Shepherdr…')
      await page.getByRole('menuitem', { name: 'Remove from Shepherdr…', exact: true }).click()
      const ask = page.getByRole('alertdialog', { name: 'Remove gtm from Shepherdr?' })
      await ask.waitFor()
      const words = (await ask.textContent())!
      expect(words).toContain('Its files and folder stay on disk.')
      expect(words).toContain('Its 5 open tasks hide with it')
      // Escape keeps it, and the focus goes back to its ⋯
      await page.keyboard.press('Escape')
      await ask.waitFor({ state: 'detached' })
      expect(await more.evaluate((b) => b === document.activeElement)).toBe(true)
      // no ring for that: it was the mouse's menu. It shows once the keyboard moves the focus back to it, and goes at
      // the press of a pointer
      const ring = () => more.evaluate((b) => getComputedStyle(b).boxShadow)
      expect(await ring()).toBe('none')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      expect(await more.evaluate((b) => b === document.activeElement)).toBe(true)
      expect(await ring()).not.toBe('none')
      await page.evaluate(() => dispatchEvent(new PointerEvent('pointerdown')))
      expect(await ring()).toBe('none')
      // a right click opens the same menu
      await row.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Remove from Shepherdr…', exact: true }).click()
      await ask.getByRole('button', { name: 'Remove' }).click()
      await row.waitFor({ state: 'detached' })
      await page.waitForURL(/place=vm-str%2Fhome/)
      // its tasks fade out of the home space's list, then are gone
      await page.locator('section[aria-label="Tasks"]').getByText('GTM-17').waitFor({ state: 'detached', timeout: 2000 })
      // the home space's menu renames it but has no Remove
      const home = page.locator('#places li[data-home]').filter({ hasText: 'home' }).last()
      await home.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Rename', exact: true }).waitFor()
      expect(await page.getByRole('menuitem', { name: 'Remove from Shepherdr…', exact: true }).count()).toBe(0)
      await page.keyboard.press('Escape')
      expect(await world.act({ type: 'space-remove', place: 'p:vm-str:~' })).toEqual({ ok: false, error: "home is vm-str's home space: it can be renamed, not removed." })
    } finally {
      await page.close()
      back()
    }
  }, 30_000)

  test('a space with a task at work is not removed: it says which', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(url())
    const row = page.locator('#places li', { hasText: 'herdr-projects' })
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Remove from Shepherdr…', exact: true }).click()
    const ask = page.getByRole('alertdialog', { name: 'herdr-projects can’t be removed yet' })
    await ask.waitFor()
    expect(await ask.textContent()).toContain('HP-202 is still working. Stop it or let it finish first.')
    expect(await ask.getByRole('button', { name: 'Remove' }).count()).toBe(0)
    await ask.getByRole('button', { name: 'OK' }).click()
    await ask.waitFor({ state: 'detached' })
    expect(await row.count()).toBe(1)
    await page.close()
  }, 30_000)

  test('a phone: holding a space in the drawer opens its menu; the question slides up, whole, dark too', async () => {
    const back = keep()
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' })
    const page = await ctx.newPage()
    try {
      await page.goto(url())
      await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
      const row = page.locator('nav[aria-label="Spaces"] li', { hasText: 'lilla-varlden' })
      await row.waitFor()
      expect(await row.getByRole('button', { name: 'More for lilla-varlden' }).isVisible()).toBe(false)
      // the drawer has slid in
      await settled(page)
      const box = (await row.boundingBox())!
      const cdp = await ctx.newCDPSession(page)
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] })
      await page.waitForTimeout(700)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.getByRole('menuitem', { name: 'Remove from Shepherdr…', exact: true }).tap()
      // the hold didn't open the space
      expect(page.url()).not.toContain('lilla-varlden')
      const ask = page.getByRole('alertdialog', { name: 'Remove lilla-varlden from Shepherdr?' })
      await ask.waitFor()
      await settled(page)
      const b = (await ask.boundingBox())!
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(390)
      expect(b.y + b.height).toBeLessThanOrEqual(844)
      await ask.getByRole('button', { name: 'Remove' }).tap()
      await row.waitFor({ state: 'detached' })
    } finally {
      await ctx.close()
      back()
    }
  }, 30_000)
})

describe.skipIf(!browser)('the order of places', () => {
  /** the sidebar's places, top to bottom */
  const order = (page: Page, sel = '#places') => page.$$eval(`${sel} li`, (ls) => ls.map((l) => (l as HTMLElement).innerText.split('\n')[0]))
  const forget = () => {
    world.order = {}
    world.emit('snapshot')
  }
  /** drags a row's middle by dy with the mouse */
  const drag = async (page: Page, name: string, dy: number) => {
    const b = (await page.locator('#places li', { hasText: name }).first().boundingBox())!
    await page.mouse.move(b.x + 40, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + 40, b.y + b.height / 2 + dy, { steps: 8 })
    await page.mouse.up()
  }

  test('A to Z at first, each home space first until dragged; a mouse drags a machine with its spaces, or a space among its own; every device sees it (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    try {
      await page.goto(url())
      await page.waitForSelector('#places li')
      expect(await order(page)).toEqual(['mac', 'home', 'lilla-varlden', 'nas', 'home', 'vm-str', 'home', 'gtm', 'herdr-projects'])
      // vm-str up above mac: its spaces come along, and the press it ends with opens nothing
      await drag(page, 'vm-str', -250)
      expect(await order(page)).toEqual(['vm-str', 'home', 'gtm', 'herdr-projects', 'mac', 'home', 'lilla-varlden', 'nas', 'home'])
      expect(page.url()).toContain('place=vm-str%2Fhome')
      expect(world.order).toEqual({ all: ['m:vm-str', 'm:mac', 'm:nas'] })
      // herdr-projects up past gtm and the home space, as any space (SHE-225); it can't leave its machine
      await drag(page, 'herdr-projects', -200)
      expect(await order(page)).toEqual(['vm-str', 'herdr-projects', 'home', 'gtm', 'mac', 'home', 'lilla-varlden', 'nas', 'home'])
      expect(world.order['m:vm-str']).toEqual(['p:vm-str:herdr-projects', 'p:vm-str:~', 'p:vm-str:gtm'])
      // the keyboard: Alt+Shift+↓ on a focused space moves it one down
      await page.locator('#places li', { hasText: 'herdr-projects' }).getByRole('button', { name: /^herdr-projects/ }).focus()
      await page.keyboard.press('Alt+Shift+ArrowDown')
      await page.waitForFunction(() => [...document.querySelectorAll('#places li')][2]?.textContent?.includes('herdr-projects'))
      expect(await order(page)).toEqual(['vm-str', 'home', 'herdr-projects', 'gtm', 'mac', 'home', 'lilla-varlden', 'nas', 'home'])
      // and the home space moves the same way
      await page.locator('#places li[data-home][data-machine="m:vm-str"]').getByRole('button', { name: /^home/ }).focus()
      await page.keyboard.press('Alt+Shift+ArrowDown')
      await page.waitForFunction(() => [...document.querySelectorAll('#places li')][2]?.hasAttribute('data-home'))
      expect(await order(page)).toEqual(['vm-str', 'herdr-projects', 'home', 'gtm', 'mac', 'home', 'lilla-varlden', 'nas', 'home'])
      // another device has it too
      const other = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
      await other.goto(url())
      await other.waitForSelector('#places li')
      expect(await order(other)).toEqual(['vm-str', 'herdr-projects', 'home', 'gtm', 'mac', 'home', 'lilla-varlden', 'nas', 'home'])
      await other.close()
      // a new space slots in A to Z among the rest: after the last one before it A to Z
      await world.addSpace({ machine: 'vm-str', path: '~/dev/apps/hop', create: true })
      await page.locator('#places li', { hasText: 'hop' }).waitFor()
      expect(await order(page)).toEqual(['vm-str', 'herdr-projects', 'home', 'gtm', 'hop', 'mac', 'home', 'lilla-varlden', 'nas', 'home'])
    } finally {
      await page.close()
      world.places = world.places.filter((p) => !['hop'].includes(p.name))
      forget()
    }
  }, 30_000)

  test('a finger holds a space (its menu opens), slides it (the menu goes), and lets go: it lands there (phone)', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    try {
      await page.goto(url())
      await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
      const nav = 'nav[aria-label="Spaces"]'
      const row = page.locator(`${nav} li`, { hasText: 'herdr-projects' })
      await row.waitFor()
      await settled(page)
      const box = (await row.boundingBox())!
      const cdp = await ctx.newCDPSession(page)
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await page.waitForTimeout(600)
      await page.getByRole('menuitem', { name: 'Remove from Shepherdr…', exact: true }).waitFor()
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 8 }] })
      expect(await page.getByRole('menuitem', { name: 'Remove from Shepherdr…', exact: true }).count()).toBe(0)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await settled(page)
      expect(await order(page, nav)).toEqual(['mac', 'home', 'lilla-varlden', 'nas', 'home', 'vm-str', 'home', 'herdr-projects', 'gtm'])
      // it opened nothing, and the list didn't scroll away
      expect(page.url()).not.toContain('herdr-projects')
      expect(world.order).toEqual({ 'm:vm-str': ['p:vm-str:~', 'p:vm-str:herdr-projects', 'p:vm-str:gtm'] })
      // a finger that moves at once scrolls, and moves nothing
      const g = (await page.locator(`${nav} li`, { hasText: 'gtm' }).boundingBox())!
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: g.y + g.height / 2 }] })
      for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: g.y + g.height / 2 - i * 10 }] })
      await page.waitForTimeout(600)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await settled(page)
      expect(await order(page, nav)).toEqual(['mac', 'home', 'lilla-varlden', 'nas', 'home', 'vm-str', 'home', 'herdr-projects', 'gtm'])
      expect(await page.getByRole('menuitem').count()).toBe(0)
    } finally {
      await ctx.close()
      forget()
    }
  }, 30_000)

  test('Alt+↑/↓ goes to the space above or below as it shows, headings and folded ones skipped, typing in its box (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    const box = page.locator('[data-composer] textarea')
    const at = () => new URL(page.url()).searchParams.get('place')
    const unquiet = await quietProject()
    try {
      await page.goto(url())
      await page.waitForSelector('#places li')
      expect(await order(page)).toEqual(['mac', 'home', 'lilla-varlden', 'nas', 'home', 'vm-str', 'home', 'gtm', 'herdr-projects', 'quiet'])
      // from the message box, typing: vm-str's home is the last-but-three; up goes past the vm-str heading to nas's home
      await box.focus()
      await page.keyboard.press('Alt+ArrowUp')
      await page.waitForFunction(() => new URL(location.href).searchParams.get('place') === 'nas/home')
      await page.keyboard.press('Alt+ArrowUp')
      await page.waitForFunction(() => new URL(location.href).searchParams.get('place') === 'mac/lilla-varlden')
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA')
      await page.keyboard.type('hi')
      expect(await box.inputValue()).toBe('hi')
      await page.keyboard.press('Alt+ArrowUp')
      await page.waitForFunction(() => new URL(location.href).searchParams.get('place') === 'mac/home')
      // the top stays the top
      await page.keyboard.press('Alt+ArrowUp')
      await page.waitForTimeout(200)
      expect(at()).toBe('mac/home')
      // vm-str folded: every space in it is skipped, those waiting on you too; nas's home is the last
      await page.getByRole('button', { name: "Hide vm-str's spaces" }).click()
      await page.locator('#places li[data-home]').nth(1).getByRole('button', { name: /^home/ }).click()
      await page.waitForFunction(() => new URL(location.href).searchParams.get('place') === 'nas/home')
      await page.keyboard.press('Alt+ArrowDown')
      await page.waitForTimeout(200)
      expect(at()).toBe('nas/home')
      await page.keyboard.press('Alt+ArrowUp')
      await page.waitForFunction(() => new URL(location.href).searchParams.get('place') === 'mac/lilla-varlden')
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA')
      await page.getByRole('button', { name: "Show vm-str's spaces" }).click()
    } finally {
      unquiet()
      await page.close()
    }
  }, 30_000)
})
