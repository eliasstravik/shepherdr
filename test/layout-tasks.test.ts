// The tasks list: each task's own status line, groups, To do, archiving and an alert's link, in a real browser (layout.ts).
import { describe, expect, test } from 'bun:test'
import type { Page } from 'playwright-core'
import { waiting } from '../shared/alerts.ts'
import { layout, settled } from './layout.ts'

const { browser, world, server, url } = await layout({ everything: true })

describe.skipIf(!browser)("the agent's status line, % done and minutes left", () => {
  for (const [name, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1600, height: 900 }],
  ] as const)
    test(`the dot shows the %, the minutes sit under it, the age stays at the row's end; paused, all of it frozen (${name})`, async () => {
      const page = await browser!.newPage({ viewport, hasTouch: name === 'phone' })
      await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home&tab=tasks`)
      const working = page.getByRole('button', { name: /HP-202 Voice/ })
      await working.waitFor()
      const wtext = (await working.textContent())!
      expect(wtext).toContain('Tracing why mute ends the call')
      expect(wtext).not.toContain('· ~12 min')
      expect(wtext).not.toContain('40%')
      const dot = working.getByRole('img', { name: 'Working, 40% done' })
      expect(await dot.evaluate((d) => getComputedStyle(d).getPropertyValue('--p').trim())).toBe('40%')
      // the minutes: small, under the dot and centred on it, in the dot's orange, level with the status line
      const eta = working.getByText('12m', { exact: true })
      const [d, e, line] = [(await dot.boundingBox())!, (await eta.boundingBox())!, (await working.getByText('Tracing why mute ends the call', { exact: true }).boundingBox())!]
      expect(e.y).toBeGreaterThanOrEqual(d.y + d.height)
      expect(Math.abs(e.x + e.width / 2 - (d.x + d.width / 2))).toBeLessThan(1)
      expect(Math.abs(e.y + e.height / 2 - (line.y + line.height / 2))).toBeLessThan(3)
      expect(e.height).toBeLessThan(line.height + 1)
      const work = await dot.evaluate((x) => getComputedStyle(x).getPropertyValue('--work').trim())
      expect(await eta.evaluate((x, c) => {
        const probe = document.createElement('span')
        probe.style.color = c
        document.body.append(probe)
        const same = getComputedStyle(probe).color === getComputedStyle(x).color
        probe.remove()
        return same
      }, work)).toBe(true)
      expect(wtext).toContain(', about 12 min left')
      // the dot's column keeps its width: the title starts where the other rows' titles do
      const left = (row: import('playwright-core').Locator) => row.evaluate((r) => r.querySelector(':scope > span.flex-1')!.getBoundingClientRect().left)
      expect(await left(working)).toBe(await left(page.getByRole('button', { name: /GTM-16/ })))
      // its age sits at the row's end, whole, as on every row: the title and the status line stop short of it
      const age = await working.evaluate((row) => {
        const [title, age] = [row.querySelector(':scope > span.flex-1')!, row.querySelector<HTMLElement>(':scope > span.tabular-nums')!]
        const [t, a, r] = [title.getBoundingClientRect(), age.getBoundingClientRect(), row.getBoundingClientRect()]
        return { text: age.textContent, gap: a.left - t.right, inside: a.right <= r.right, whole: age.scrollWidth <= age.clientWidth }
      })
      expect(age.text).toBe('8m')
      expect(age.gap).toBeGreaterThanOrEqual(0)
      expect(age).toMatchObject({ inside: true, whole: true })
      // waiting on you: only what it asks, one line like the rows around it; the frozen status line stays in its header
      const paused = page.getByRole('button', { name: /GTM-14/ })
      const text = (await paused.textContent())!
      expect(text).toContain('Asks permission')
      expect(text).not.toMatch(/Moving the skills|Paused|62%|min/)
      const height = (row: import('playwright-core').Locator) => row.evaluate((r) => r.getBoundingClientRect().height)
      expect(await height(paused)).toBe(await height(page.getByRole('button', { name: /GTM-16/ })))
      // an open task: what it does, then the minutes left; no bar along the header's edge
      await working.click()
      await page.getByText(name === 'phone' ? /^Tracing why mute ends the call ?· ~12 min$/ : /^Tracing why mute ends the call ?· ~12 min left$/).waitFor()
      expect(await page.getByRole('progressbar').count()).toBe(0)
      await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home&task=GTM-14`)
      await page.getByText(/^Moving the skills into the template ?· 62%$/).waitFor()
      expect(await page.getByRole('progressbar').count()).toBe(0)
      // a coordinator at work reports no progress: its header keeps its name and its usual subtitle, no %, minutes or bar
      await page.goto(`http://127.0.0.1:${server!.port}/?place=p:vm-str:gtm`)
      await page.getByText('gtm', { exact: true }).first().waitFor()
      const top = await page.evaluate(() => [...document.querySelectorAll('.border-b')].find((el) => !el.closest('#places, nav') && el.textContent?.includes('gtm'))?.textContent ?? '')
      expect(top).toMatch(/Space on vm-str$/)
      expect(top).not.toMatch(/\d+%|~\d+ min|Checking/)
      expect(await page.getByRole('progressbar').count()).toBe(0)
      await page.close()
    }, 30_000)

  test('a narrow tasks sidebar keeps the age whole at the row\'s end and the minutes whole under the dot, in its orange (light and dark)', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const page = await browser!.newPage({ viewport: { width: 1440, height: 800 }, colorScheme: scheme })
      await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home`)
      const sep = page.getByRole('separator', { name: 'Resize tasks' })
      await sep.waitFor()
      // drag the tasks sidebar as narrow as it goes
      const s = (await sep.boundingBox())!
      await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2)
      await page.mouse.down()
      await page.mouse.move(s.x + 400, s.y + s.height / 2, { steps: 6 })
      await page.mouse.up()
      await page.waitForTimeout(350)
      const working = page.getByRole('button', { name: /HP-202 Voice/ })
      const row = (await working.boundingBox())!
      // its age stays whole at the row's end; the title and the status line take the rest
      const room = await working.evaluate((r) => {
        const age = r.querySelector<HTMLElement>(':scope > span.tabular-nums')!
        return { gap: age.getBoundingClientRect().left - r.querySelector(':scope > span.flex-1')!.getBoundingClientRect().right, whole: age.scrollWidth <= age.clientWidth }
      })
      expect(room.gap).toBeGreaterThanOrEqual(0)
      expect(room.whole).toBe(true)
      expect(await working.getByText('· ~12 min').count()).toBe(0)
      // the minutes stay whole inside the row, under the dot
      const end = working.getByText('12m', { exact: true })
      const box = (await end.boundingBox())!
      expect(box.width).toBeGreaterThan(10)
      expect(box.x).toBeGreaterThanOrEqual(row.x)
      // in the dot's orange, apart from what it does, in either theme
      const color = (l: import('playwright-core').Locator) => l.evaluate((e) => getComputedStyle(e).color)
      expect(await color(end)).not.toBe(await color(working.getByText('Tracing why mute ends the call', { exact: true })))
      expect(await color(end)).toBe(await working.getByRole('img', { name: /Working/ }).evaluate((d) => {
        const probe = document.createElement('span')
        probe.style.color = getComputedStyle(d).getPropertyValue('--work')
        document.body.append(probe)
        const c = getComputedStyle(probe).color
        probe.remove()
        return c
      }))
      await page.close()
    }
  }, 30_000)
})

/** the Tasks list's headings (machines, groups), top to bottom, but Automations (and the sidebar's own) */
const headings = (page: Page, within = '') =>
  page.$$eval(`${within}[data-heading]`, (els) => els.filter((el) => !el.closest('#places, nav')).map((el) => (el as HTMLElement).dataset.heading!).filter((l) => l !== 'Automations'))
const pick = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Group tasks' }).click()
  await page.getByRole('menuitemradio', { name: new RegExp(`^${name}$`) }).click()
}
/** each task row's line under its title, by its id */
const subs = (page: Page) =>
  page.$$eval('section[aria-label="Tasks"] li', (li) => Object.fromEntries(li.map((l) => [l.textContent?.match(/^[A-Z]+-[A-Z0-9]+/)?.[0], l.querySelector('.text-xs\\/4')?.textContent ?? ''])))

/** at mac's home space, the lists' chip is all of mac */
function macChip() {
  localStorage.setItem('shepherdr.lists', JSON.stringify({ pinned: false, chips: ['m:mac'], at: 'p:mac:~' }))
}

describe.skipIf(!browser)('grouping a machine\'s tasks', () => {
  const labels = (page: Page) => headings(page, 'section[aria-label="Tasks"] ')
  const phoneLabels = (page: Page) => headings(page)

  test('a machine\'s chip: Status or Space from the Tasks header\'s ⋯, kept on this device; a space has no ⋯', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 1440, height: 800 } })
    await ctx.addInitScript(macChip)
    const page = await ctx.newPage()
    // mac's home space, its chip mac's: mac's tasks
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:mac:~')}`)
    await page.waitForSelector('section[aria-label="Tasks"] li')
    expect(await labels(page)).toEqual(['Needs you', 'To do'])
    await page.getByRole('button', { name: 'Group tasks' }).click()
    // a home space offers Status and Space; Status is checked
    const items = page.getByRole('menuitemradio')
    expect(await items.allTextContents()).toEqual(['Status', 'Space'])
    expect(await items.first().getAttribute('aria-checked')).toBe('true')
    await page.keyboard.press('Escape')
    await pick(page, 'Space')
    expect(await labels(page)).toEqual(['lilla-varlden'])
    // the first space's tasks, Needs you first
    const dots = await page.$$eval('section[aria-label="Tasks"] .overflow-y-auto > div:not([data-filter]) > div:first-child li .dot', (d) => d.map((x) => [...x.classList].find((c) => ['need', 'ready', 'merging', 'work', 'todo', 'done'].includes(c))))
    expect(dots).toEqual(['need', 'need'])
    // kept: after a reload
    await page.reload()
    await page.waitForSelector('section[aria-label="Tasks"] li')
    expect(await labels(page)).toEqual(['lilla-varlden'])
    // a space's own list is by status, with no ⋯
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}`)
    await page.waitForSelector('section[aria-label="Tasks"] li')
    expect(await labels(page)).toEqual(['Needs you', 'Ready', 'Merging', 'To do', 'Done'])
    expect(await page.getByRole('button', { name: 'Group tasks' }).count()).toBe(0)
    await ctx.close()
  }, 30_000)

  test('the main home space: Status across every machine, Machine, Space or Machine › Space; each row says where it is only where nothing else does', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 1024, height: 768 } })
    const page = await ctx.newPage()
    await page.goto(url())
    await page.waitForSelector('section[aria-label="Tasks"] li')
    await page.getByRole('button', { name: 'Group tasks' }).click()
    expect(await page.getByRole('menuitemradio').allTextContents()).toEqual(['Status', 'Machine', 'Space', 'Machine › Space'])
    await page.keyboard.press('Escape')
    // gtm's archived tasks are in no group: the Archived link at the bottom opens them
    expect(await page.getByRole('button', { name: /^Archived\s*2$/ }).count()).toBe(1)
    // by status: one Needs you for every machine, not split by machine again; each row names its machine and space
    expect(await labels(page)).toEqual(['Needs you', 'Ready', 'Merging', 'Working', 'Queued', 'To do', 'Done'])
    let s = await subs(page)
    expect(s['GTM-14']).toBe('vm-str · gtm · → main · Asks permission')
    expect(s['LV-3']).toStartWith('mac · lilla-varlden · ')
    // its pull request's number gives way to where it is
    expect(s['GTM-15']).toBe('vm-str · gtm · → main · Ready to merge')
    await pick(page, 'Machine')
    expect(await labels(page)).toEqual(['mac', 'vm-str'])
    s = await subs(page)
    expect(s['GTM-14']).toBe('gtm · → main · Asks permission')
    await pick(page, 'Space')
    expect(await labels(page)).toEqual(['lilla-varlden', 'gtm', 'herdr-projects'])
    // the heading says the machine, quietly: the rows say neither
    expect(await page.locator('[data-heading="gtm"]').textContent()).toBe('gtm · vm-str6')
    s = await subs(page)
    expect([s['GTM-14'], s['GTM-15']]).toEqual(['→ main · Asks permission', 'PR #128 · → main · Ready to merge'])
    await pick(page, 'Machine › Space')
    expect(await labels(page)).toEqual(['mac', 'lilla-varlden', 'vm-str', 'gtm', 'herdr-projects'])
    expect((await subs(page))['GTM-14']).toBe('→ main · Asks permission')
    // the machine's name a step above its groups' labels
    const weight = (name: string) => page.locator(`[data-heading="${name}"] button > :not(svg)`).first().evaluate((e) => Number(getComputedStyle(e).fontWeight))
    expect(await weight('vm-str')).toBeGreaterThan(await weight('gtm'))
    // a machine's chip keeps its own choice: still by status there, its rows naming only their space
    await ctx.addInitScript(macChip)
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:mac:~')}`)
    await page.waitForSelector('section[aria-label="Tasks"] li')
    expect(await labels(page)).toEqual(['Needs you', 'To do'])
    expect((await subs(page))['LV-3']).toStartWith('lilla-varlden · ')
    // a space's rows say neither
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}`)
    await page.waitForSelector('section[aria-label="Tasks"] li')
    expect((await subs(page))['GTM-14']).toBe('→ main · Asks permission')
    await ctx.close()
  }, 30_000)

  test('a phone: the ⋯ sits at the top right of Tasks, its menu stays on screen', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' })
    await ctx.addInitScript(macChip)
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:mac:~')}&tab=tasks`)
    await page.waitForSelector('li')
    const btn = await page.getByRole('button', { name: 'Group tasks' }).boundingBox()
    expect(btn!.width).toBeGreaterThanOrEqual(44)
    expect(390 - (btn!.x + btn!.width)).toBeLessThan(20)
    await pick(page, 'Space')
    expect(await phoneLabels(page)).toEqual(['lilla-varlden'])
    await page.getByRole('button', { name: 'Group tasks' }).click()
    const menu = await page.getByRole('menu').boundingBox()
    expect(menu!.x).toBeGreaterThanOrEqual(0)
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(390)
    // Chat: the ⋯ is the coordinator's menu again, not this one
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Chat', exact: true }).click()
    expect(await page.getByRole('button', { name: 'Group tasks' }).count()).toBe(0)
    await ctx.close()
  }, 30_000)
})

describe.skipIf(!browser)('folding headings', () => {
  const rows = (page: Page) => page.$$eval('section[aria-label="Tasks"] li[data-flip]', (li) => li.map((l) => l.textContent?.match(/^[A-Z]+-[A-Z0-9]+/)?.[0]))
  const heading = (page: Page, name: string) => page.locator(`section[aria-label="Tasks"] [data-heading="${name}"] button`)
  const labels = (page: Page) => headings(page, 'section[aria-label="Tasks"] ')

  test('a tap folds a heading, its count stays; Alt-click folds its siblings too; kept per view on this device; a filter shows every match', async () => {
    const done = world.tasks.find((t) => t.status === 'done' && t.place === 'p:vm-str:gtm')!
    const extra = Array.from({ length: 7 }, (_, i) => ({ ...done, id: `GTM-D${i}`, name: `Old job ${i}`, report: undefined }))
    world.tasks.push(...extra)
    try {
      const ctx = await browser!.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await ctx.newPage()
      await page.goto(url())
      await page.waitForSelector('section[aria-label="Tasks"] li')
      await pick(page, 'Machine › Space')
      // the sidebar's chevron, pointing down while open
      expect(await heading(page, 'gtm').getAttribute('aria-expanded')).toBe('true')
      await heading(page, 'gtm').click()
      expect(await heading(page, 'gtm').getAttribute('aria-expanded')).toBe('false')
      expect((await rows(page)).some((r) => r?.startsWith('GTM-'))).toBe(false)
      // its count stays
      expect(await heading(page, 'gtm').textContent()).toBe('gtm13')
      // Alt-click on a machine folds every machine; its count stays too
      await heading(page, 'mac').click({ modifiers: ['Alt'] })
      expect(await labels(page)).toEqual(['mac', 'vm-str'])
      expect(await rows(page)).toEqual([])
      expect(await heading(page, 'vm-str').textContent()).toBe('vm-str17')
      // a filter shows its matches, folded or not, and the fold comes back after
      await page.getByPlaceholder('Filter tasks').fill('webhook')
      expect(await rows(page)).toEqual(['GTM-15', 'GTM-18', 'GTM-17'])
      await page.getByPlaceholder('Filter tasks').fill('')
      expect(await rows(page)).toEqual([])
      // kept on this device: after a reload too
      await page.reload()
      await page.waitForSelector('section[aria-label="Tasks"] [data-heading]')
      expect(await rows(page)).toEqual([])
      // Alt-click again opens them all; gtm, folded on its own, stays folded
      await heading(page, 'vm-str').click({ modifiers: ['Alt'] })
      expect(await labels(page)).toEqual(['mac', 'lilla-varlden', 'vm-str', 'gtm', 'herdr-projects'])
      expect((await rows(page)).some((r) => r?.startsWith('LV-'))).toBe(true)
      expect((await rows(page)).some((r) => r?.startsWith('GTM-'))).toBe(false)
      // each view its own: gtm's own Done shows, with its Show all, until folded; Alt-click folds every status
      await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}`)
      await page.waitForSelector('section[aria-label="Tasks"] li')
      await page.getByRole('button', { name: 'Show all 8' }).waitFor()
      await heading(page, 'Done').click()
      expect(await page.getByRole('button', { name: 'Show all 8' }).count()).toBe(0)
      await heading(page, 'Done').click()
      await page.getByRole('button', { name: 'Show all 8' }).waitFor()
      await heading(page, 'Ready').click({ modifiers: ['Alt'] })
      expect(await rows(page)).toEqual([])
      for (const name of ['Needs you', 'Ready', 'Merging', 'To do', 'Done']) expect(await heading(page, name).getAttribute('aria-expanded')).toBe('false')
      await ctx.close()
    } finally {
      world.tasks.splice(world.tasks.length - extra.length, extra.length)
    }
  }, 30_000)

  test('a phone: a heading is a full-width tap target a finger can hit', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}&tab=tasks`)
    await page.waitForSelector('li')
    const box = (await page.locator('[data-heading="Needs you"] button').boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThan(340)
    await page.locator('[data-heading="Needs you"] button').tap()
    expect(await page.locator('[data-heading="Needs you"] button').getAttribute('aria-expanded')).toBe('false')
    expect(await page.locator('li', { hasText: 'GTM-14' }).count()).toBe(0)
    // a row's line stays one line on a phone, all of it inside the row
    await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home&tab=tasks`)
    await page.waitForSelector('li')
    const lines = await page.$$eval('li .text-xs\\/4', (els) => els.map((e) => ({ h: e.getBoundingClientRect().height, over: e.getBoundingClientRect().right > innerWidth })))
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(l).toEqual({ h: lines[0].h, over: false })
    await ctx.close()
  }, 30_000)
})

describe.skipIf(!browser)('grouped tasks and the keyboard', () => {
  test('the arrow keys walk the rows on screen, group by group, past Done ones hidden until Show all', async () => {
    const done = world.tasks.find((t) => t.status === 'done' && t.place === 'p:vm-str:gtm')!
    const extra = Array.from({ length: 7 }, (_, i) => ({ ...done, id: `GTM-D${i}`, name: `Old job ${i}`, report: undefined }))
    world.tasks.push(...extra)
    try {
      const ctx = await browser!.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await ctx.newPage()
      await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home`)
      const taskRows = 'section[aria-label="Tasks"] li[data-flip]'
      await page.waitForSelector(taskRows)
      await page.getByRole('button', { name: 'Group tasks' }).click()
      await page.getByRole('menuitemradio', { name: /^Space/ }).click()
      await page.locator('body').click({ position: { x: 600, y: 500 } })
      // The footer has automation list items too; only task rows belong to the arrow-key order.
      const automations = page.locator('section[aria-label="Tasks"] li[aria-expanded]')
      expect(await automations.count()).toBe(3)
      const rows = await page.$$eval(taskRows, (li) => li.map((l) => (l as HTMLElement).dataset.flip!))
      const focused = () => page.$$eval(taskRows, (li) => (li.find((l) => l.className.includes('var(--focus)')) as HTMLElement | undefined)?.dataset.flip)
      const seen: (string | undefined)[] = []
      for (let i = 0; i < rows.length; i++) {
        if (i) await page.keyboard.press('ArrowDown')
        else await page.keyboard.press('ArrowUp')
        seen.push(await focused())
      }
      // every press lands on the next row you can see, lilla-varlden's, then gtm's five Done ones and straight on to herdr-projects
      expect(seen).toEqual(rows)
      // The footer stays visible, but extra presses stop at the last task, then walk back up.
      await page.keyboard.press('ArrowDown')
      expect(await focused()).toBe(rows.at(-1))
      const back = [await focused()]
      for (let i = 1; i < rows.length; i++) {
        await page.keyboard.press('ArrowUp')
        back.push(await focused())
      }
      expect(back).toEqual([...rows].reverse())
      expect(await automations.count()).toBe(3)
      expect(rows.filter((r) => r?.startsWith('GTM-')).length).toBe(5 + 5)
      await page.getByRole('button', { name: 'Show all 8' }).click()
      expect(await page.locator(taskRows).count()).toBe(rows.length + 3)
      // remembered on this device: a reload still shows them all, and Show less cuts them short again
      await page.reload()
      await page.waitForSelector(taskRows)
      expect(await page.locator(taskRows).count()).toBe(rows.length + 3)
      await page.getByRole('button', { name: 'Show less' }).click()
      expect(await page.locator(taskRows).count()).toBe(rows.length)
      await page.reload()
      await page.waitForSelector(taskRows)
      await page.getByRole('button', { name: 'Show all 8' }).waitFor()
      await ctx.close()
    } finally {
      world.tasks.splice(world.tasks.length - extra.length, extra.length)
    }
  }, 30_000)
})

describe.skipIf(!browser)('a change moves only its own row', () => {
  for (const [name, viewport] of [
    ['phone', { width: 390, height: 640 }],
    ['desktop', { width: 1440, height: 640 }],
  ] as const)
    test(`a status change keeps the other rows' nodes and what shows stays put; with reduced motion nothing glides (${name})`, async () => {
      const busy = world.tasks.find((t) => t.id === 'HP-202')!
      const extra = Array.from({ length: 12 }, (_, i) => ({ ...busy, id: `HP-W${i}`, name: `Busy job ${i}` }))
      world.tasks.push(...extra)
      const merging = world.tasks.find((t) => t.id === 'GTM-18')!
      const was = { ...merging }
      try {
        const page = await browser!.newPage({ viewport, hasTouch: name === 'phone' })
        await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home&tab=tasks`)
        await page.locator('li[data-flip="HP-W11"]').waitFor()
        // scrolled so Merging and the first busy rows are above what shows: its one task is merged, so that group goes
        const before = await page.evaluate(() => {
          const rows = [...document.querySelectorAll<HTMLElement>('li[data-flip]')]
          let box = rows[0].parentElement!
          while (!/auto|scroll/.test(getComputedStyle(box).overflowY)) box = box.parentElement!
          box.scrollTop = rows.find((r) => r.dataset.flip === 'HP-W3')!.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
          const w = window as unknown as { rows: Map<string, HTMLElement>; box: HTMLElement }
          w.rows = new Map(rows.map((r) => [r.dataset.flip!, r]))
          w.box = box
          const view = box.getBoundingClientRect()
          const seen = rows.filter((r) => r.getBoundingClientRect().top >= view.top && r.getBoundingClientRect().bottom <= view.bottom).map((r) => [r.dataset.flip!, r.getBoundingClientRect().top] as const)
          return { scrolled: box.scrollTop, seen }
        })
        expect(before.scrolled).toBeGreaterThan(0)
        expect(before.seen.length).toBeGreaterThan(3)
        await world.act({ type: 'close', chat: 'GTM-18/Agent', force: true })
        await page.waitForFunction(() => document.querySelector('li[data-flip="GTM-18"]') !== (window as unknown as { rows: Map<string, HTMLElement> }).rows.get('GTM-18'))
        await settled(page)
        const after = await page.evaluate((seen) => {
          const w = window as unknown as { rows: Map<string, HTMLElement>; box: HTMLElement }
          const swapped = [...w.rows].filter(([k, r]) => k !== 'GTM-18' && (!r.isConnected || document.querySelector(`li[data-flip="${k}"]`) !== r)).map(([k]) => k)
          const moved = seen.filter(([k, y]) => k !== 'GTM-18' && Math.abs(w.rows.get(k)!.getBoundingClientRect().top - y) > 1).map(([k]) => k)
          return { swapped, moved, ghosts: w.box.querySelectorAll('[aria-hidden="true"][inert]').length }
        }, before.seen)
        // every other row is the very same node, and what showed is where it showed: the list scrolled to keep it there
        expect(after).toEqual({ swapped: [], moved: [], ghosts: 0 })
        // with reduced motion a change lands at once: nothing glides or fades
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await world.act({ type: 'pause', chat: 'HP-W5/Agent' })
        await page.waitForFunction(() => document.querySelector('li[data-flip="HP-W5"]') !== (window as unknown as { rows: Map<string, HTMLElement> }).rows.get('HP-W5'))
        expect(await page.evaluate(() => document.getAnimations().filter((a) => a.id.startsWith('flip')).length)).toBe(0)
        await page.close()
      } finally {
        world.tasks.splice(world.tasks.indexOf(extra[0]), extra.length)
        Object.assign(merging, was)
      }
    }, 30_000)
})

describe.skipIf(!browser)('To do always shows; Automations only once there is one', () => {
  test('empty, To do says so calmly; Automations and the other groups stay hidden (desktop light and dark, tablet, phone)', async () => {
    for (const colorScheme of ['light', 'dark'] as const) {
      const ctx = await browser!.newContext({ viewport: { width: 1440, height: 800 }, colorScheme })
      const page = await ctx.newPage()
      await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:mac:lilla-varlden')}`)
      const tasks = page.locator('section[aria-label="Tasks"]')
      await tasks.locator('li').first().waitFor()
      expect(await headings(page)).toEqual(['Needs you', 'To do'])
      await expect(tasks.getByText('No tasks to do yet. Ask a coordinator to add one.', { exact: true }).isVisible()).resolves.toBe(true)
      expect(await tasks.getByText(/automations/i).count()).toBe(0)
      await ctx.close()
    }
    // a tablet, the same
    const tablet = await browser!.newPage({ viewport: { width: 900, height: 800 } })
    await tablet.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:mac:lilla-varlden')}`)
    await tablet.getByText('No tasks to do yet. Ask a coordinator to add one.', { exact: true }).waitFor()
    expect(await tablet.locator('section[aria-label="Tasks"]').getByText(/automations/i).count()).toBe(0)
    await tablet.close()
    // and on a phone's Tasks tab
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'light' })
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:mac:lilla-varlden')}&tab=tasks`)
    await page.getByText('No tasks to do yet. Ask a coordinator to add one.', { exact: true }).waitFor()
    expect(await page.getByText(/automations/i).count()).toBe(0)
    await ctx.close()
  }, 30_000)

  test('a place with automations shows the heading, under To do (desktop, tablet, phone)', async () => {
    for (const viewport of [{ width: 1440, height: 800 }, { width: 900, height: 800 }]) {
      const page = await browser!.newPage({ viewport })
      await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}`)
      const tasks = page.locator('section[aria-label="Tasks"]')
      await tasks.locator('li[aria-expanded]', { hasText: 'Flaky tests' }).waitFor()
      const labels = await tasks.locator('[data-heading]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.heading))
      expect(labels.indexOf('Automations')).toBeGreaterThan(labels.indexOf('To do'))
      expect(labels.indexOf('To do')).toBeGreaterThan(-1)
      await page.close()
    }
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}&tab=tasks`)
    await page.locator('li[aria-expanded]', { hasText: 'Flaky tests' }).waitFor()
    await expect(page.getByText('Automations', { exact: true }).isVisible()).resolves.toBe(true)
    await ctx.close()
  }, 30_000)

  test("everything (no chips) shows every space's automations, each under its space's name; one space's keep their plain heading (desktop, phone)", async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home`)
    const tasks = page.locator('section[aria-label="Tasks"]')
    await tasks.locator('li[aria-expanded]', { hasText: 'Flaky tests' }).waitFor()
    const heading = tasks.locator('[data-heading="Automations"]')
    expect(await heading.allInnerTexts()).toEqual([expect.stringMatching(/^Automations · gtm/)])
    expect(await tasks.locator('li[aria-expanded]').count()).toBe(3)
    // one space's own list: the heading as it was, no name
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}`)
    await tasks.locator('li[aria-expanded]', { hasText: 'Flaky tests' }).waitFor()
    expect(await heading.innerText()).not.toContain('·')
    await page.close()
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const phone = await ctx.newPage()
    await phone.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home&tab=tasks`)
    await phone.locator('li[aria-expanded]', { hasText: 'Flaky tests' }).waitFor()
    const label = phone.locator('[data-heading="Automations"]')
    await expect(label.isVisible()).resolves.toBe(true)
    expect(await label.innerText()).toMatch(/^Automations · gtm/)
    expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await ctx.close()
  }, 30_000)

  test('an automation summarizes its trigger and shows its task only when expanded; a tap shows it in full with its next and last runs; run now, pause and remove, no adding or editing (phone)', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' })
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}&tab=tasks`)
    const row = page.locator('li[aria-expanded]', { hasText: 'Flaky tests' })
    await row.waitFor()
    // its trigger in words, in the time zone of Settings
    expect(await row.innerText()).toBe('Flaky tests\nEvery day at 7:00 (Stockholm)')
    expect(await page.locator('li[aria-expanded]', { hasText: 'Dependency bump' }).innerText()).toBe('Dependency bump\nPaused · The last Friday of the month at 8:00 (Stockholm)')
    const event = page.locator('li[aria-expanded]', { hasText: 'Changelog' })
    expect(await event.innerText()).toBe('Changelog\nWhen a task is merged')
    await event.tap()
    const eventDetail = page.locator(`#${await event.getAttribute('aria-controls')}`)
    expect(await eventDetail.locator('dt').allInnerTexts()).toEqual(['When', 'Task', 'Last runs'])
    expect(await eventDetail.locator('dd').nth(1).innerText()).toBe('Update the changelog')
    expect(await event.innerText()).toBe('Changelog\nWhen a task is merged')
    await event.tap()
    expect(await row.getAttribute('aria-expanded')).toBe('false')
    await row.tap()
    expect(await row.getAttribute('aria-expanded')).toBe('true')
    const detail = page.locator(`#${await row.getAttribute('aria-controls')}`)
    expect(await detail.locator('dt').allInnerTexts()).toEqual(['When', 'Next', 'Task', 'Instructions', 'Last runs'])
    // its next three runs
    expect((await detail.locator('dd').nth(1).innerText()).split(' · ')).toHaveLength(3)
    expect(await detail.locator('dd').nth(1).innerText()).toMatch(/7:00$/)
    expect(await detail.locator('dd').nth(2).innerText()).toBe('Rerun the flaky test suite')
    expect(await detail.locator('dd').nth(4).innerText()).toContain('GTM-41')
    // nothing spills sideways
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await detail.getByRole('button', { name: 'Run now' }).tap()
    await detail.getByText('GTM-51').waitFor()
    await detail.getByRole('button', { name: 'Pause' }).tap()
    await row.getByText('Paused · Every day at 7:00').waitFor()
    expect(await detail.locator('dt').allInnerTexts()).not.toContain('Next')
    await detail.getByRole('button', { name: 'Resume' }).tap()
    await detail.getByRole('button', { name: 'Pause' }).waitFor()
    // only agents add or change one, when asked in the chat: no Edit, no New automation
    expect(await detail.getByRole('button').allInnerTexts()).toEqual(['GTM-51', 'GTM-41', 'Run now', 'Pause', 'Remove'])
    expect(await page.getByText('New automation').count()).toBe(0)
    await detail.getByRole('button', { name: 'Remove' }).tap()
    await row.waitFor({ state: 'detached' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await ctx.close()
  }, 30_000)
})

describe.skipIf(!browser)("a task's one menu", () => {
  const ROW = ['Open in split view', 'Pin', 'Restart agent…', 'Stop…', 'Done', 'Delete…']

  test('a row and its chat offer the same actions; no Pause or Archive', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:herdr-projects')}`)
    const row = page.locator('section[aria-label="Tasks"] li', { hasText: 'Voice call drops on mute' })
    await row.waitFor()
    // the ⋯ is tucked away until the pointer is on the row
    const more = row.getByRole('button', { name: 'More for this task' })
    expect(await more.evaluate((b) => getComputedStyle(b).opacity)).toBe('0')
    await row.hover()
    expect(await more.evaluate((b) => getComputedStyle(b).opacity)).toBe('1')
    await more.click()
    expect(await page.getByRole('menu').getByRole('menuitem').allTextContents()).toEqual(ROW)
    await page.keyboard.press('Escape')
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:herdr-projects')}&task=HP-202`)
    await page.getByRole('button', { name: 'More', exact: true }).click()
    const items = await page.getByRole('menu', { name: 'More' }).getByRole('menuitem').allTextContents()
    expect(items.slice(-5)).toEqual(ROW.slice(1))
    await page.close()
  }, 30_000)

  test('Stop asks first, from the chat too, and the task goes to To do', async () => {
    const busy = world.tasks.find((t) => t.id === 'HP-202')!
    const before = { ...busy }
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:herdr-projects')}&task=HP-202`)
    const more = page.getByRole('button', { name: 'More', exact: true })
    await more.click()
    await page.getByRole('menuitem', { name: 'Stop…' }).click()
    const ask = page.getByRole('alertdialog', { name: 'Stop HP-202?' })
    await ask.waitFor()
    await page.keyboard.press('Escape')
    await ask.waitFor({ state: 'detached' })
    expect(busy.status).toBe('work')
    await more.click()
    await page.getByRole('menuitem', { name: 'Stop…' }).click()
    await ask.getByRole('button', { name: 'Stop', exact: true }).click()
    await ask.waitFor({ state: 'detached' })
    expect(busy.status).toBe('todo')
    Object.assign(busy, before)
    await page.close()
  }, 30_000)

  test('an archived task keeps Unarchive and Delete in its ⋯, and Archived at the bottom brings it back', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}`)
    const tasks = page.locator('section[aria-label="Tasks"]')
    const link = tasks.getByRole('button', { name: /^Archived\s*2$/ })
    await link.waitFor()
    await link.click()
    await tasks.getByText('Archived', { exact: true }).first().waitFor()
    const back = tasks.locator('li', { hasText: 'GTM-11' })
    await back.hover()
    await back.getByRole('button', { name: 'More for this task' }).click()
    await page.getByRole('menuitem', { name: 'Delete…' }).waitFor()
    expect(await page.getByRole('menuitem', { name: 'Stop…' }).count()).toBe(0)
    await page.getByRole('menuitem', { name: 'Unarchive' }).click()
    await back.waitFor({ state: 'detached' })
    // Esc leaves the Archived view; the task is in its list again
    await page.locator('body').click({ position: { x: 600, y: 500 } })
    await page.keyboard.press('Escape')
    await tasks.locator('li', { hasText: 'GTM-11' }).waitFor()
    await world.act({ type: 'archive', chat: 'GTM-11/Agent', on: true })
    await page.close()
  }, 30_000)

  test('a phone: every row shows its ⋯, a tap opens the menu and a held row does too', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent('p:vm-str:gtm')}&tab=tasks`)
    const row = page.locator('li', { hasText: 'GTM-17' })
    await row.waitFor()
    const more = row.getByRole('button', { name: 'More for this task' })
    expect(await more.isVisible()).toBe(true)
    expect(await more.evaluate((b) => getComputedStyle(b).opacity)).toBe('1')
    await more.tap()
    await page.getByRole('menuitem', { name: 'Delete…' }).waitFor()
    expect(page.url()).not.toContain('task=')
    await page.keyboard.press('Escape')
    await page.getByRole('menu').waitFor({ state: 'detached' })
    const box = (await row.boundingBox())!
    const cdp = await ctx.newCDPSession(page)
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] })
    await page.waitForTimeout(700)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.getByRole('menuitem', { name: 'Delete…' }).waitFor()
    // the hold didn't open the task
    expect(page.url()).not.toContain('task=')
    const menu = (await page.getByRole('menu').boundingBox())!
    expect(menu.x).toBeGreaterThanOrEqual(0)
    expect(menu.x + menu.width).toBeLessThanOrEqual(390)
    await ctx.close()
  }, 30_000)
})

describe.skipIf(!browser)("an alert's link", () => {
  /** a page that remembers what was lit up last (data-lit): the light lasts a moment, and a slow machine may still be
   *  scrolling there when it goes */
  const open = async (viewport = { width: 390, height: 844 }) => {
    const page = await browser!.newPage({ viewport })
    await page.addInitScript(() =>
      new MutationObserver((ms) => {
        for (const m of ms) {
          const el = m.target as Element
          if (!el.hasAttribute('data-flash')) continue
          for (const was of document.querySelectorAll('[data-lit]')) was.removeAttribute('data-lit')
          el.setAttribute('data-lit', '')
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-flash'] }),
    )
    return page
  }
  const flashed = (page: Page) =>
    page.waitForFunction(() => {
      const f = document.querySelector('[data-lit]')
      const b = f?.getBoundingClientRect()
      // once it has scrolled there
      if (!f || !b || b.top < 0 || b.top > innerHeight - 100) return null
      return { card: f.hasAttribute('data-card'), msg: f.closest('[data-whole]')?.getAttribute('data-whole'), inView: true }
    })
  test("opened cold, it shows the task's card in view, lit up, its buttons ready; the address forgets the card", async () => {
    const t = world.snapshot().tasks.find((x) => x.id === 'GTM-16')!
    const plan = world.chat('GTM-16/Agent').messages.find((m) => m.question?.kind === 'Plan')!
    const page = await open()
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent(t.place)}&task=GTM-16&focus=${encodeURIComponent(plan.question!.id)}`)
    const f = await (await flashed(page)).jsonValue()
    expect(f).toEqual({ card: true, msg: plan.id, inView: true })
    expect(await page.locator('[data-lit]').getByRole('button', { name: 'Send', exact: true }).isVisible()).toBe(true)
    expect(new URL(page.url()).searchParams.has('focus')).toBe(false)
    expect(new URL(page.url()).searchParams.get('task')).toBe('GTM-16')
    await page.close()
  }, 30_000)

  test("a coordinator's question and a done task's card, in the space's chat", async () => {
    const place = 'p:vm-str:gtm'
    const ask = world.chat(place).messages.find((m) => m.question && m.question.sent === undefined)!
    const done = world.chat(place).messages.find((m) => m.card?.task === 'GTM-12')!
    const page = await open()
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent(place)}&focus=${encodeURIComponent(ask.question!.id)}`)
    expect(await (await flashed(page)).jsonValue()).toEqual({ card: true, msg: ask.id, inView: true })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent(place)}&focus=${encodeURIComponent(done.id)}`)
    expect(await (await flashed(page)).jsonValue()).toMatchObject({ msg: done.id, inView: true })
    await page.close()
  }, 30_000)

  test('a message far up the chat comes into view', async () => {
    const page = await open()
    // as slow as a phone, still drawing the chat while it glides up (it used to pull the chat back down)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home&focus=code-agent`)
    const f = await (await flashed(page)).jsonValue()
    expect(f).toMatchObject({ card: false, msg: 'code-agent', inView: true })
    await page.close()
  }, 30_000)

  test('a tap on an alert with the app open goes to the card without reloading', async () => {
    const page = await open()
    await page.goto(url())
    await page.waitForSelector('[data-msg="short-agent"]')
    await page.evaluate(() => ((window as unknown as { kept: number }).kept = 1))
    const t = world.snapshot().tasks.find((x) => x.id === 'HP-201')!
    const q = world.chat('HP-201/Agent').messages.find((m) => m.question)!
    await page.evaluate((u) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open', url: u } })), `./?place=${encodeURIComponent(t.place)}&task=HP-201&focus=${encodeURIComponent(q.question!.id)}`)
    const f = await (await flashed(page)).jsonValue()
    expect(f).toMatchObject({ card: true, inView: true })
    expect(new URL(page.url()).searchParams.get('task')).toBe('HP-201')
    expect(await page.evaluate(() => (window as unknown as { kept?: number }).kept)).toBe(1)
    await page.close()
  }, 30_000)

  test('the window title counts what waits on you, as the app icon does', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 844 } })
    await page.goto(url())
    const n = waiting(world.snapshot()).count
    expect(n).toBeGreaterThan(0)
    await page.waitForFunction((t) => document.title === t, `(${n}) Shepherdr`)
    await page.close()
  }, 30_000)

  test('the app icon gets the same count, where the device has one', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    await page.addInitScript(() => {
      const w = window as unknown as { badges: unknown[] }
      w.badges = []
      Object.assign(navigator, { setAppBadge: async (n: number) => void w.badges.push(n), clearAppBadge: async () => void w.badges.push('clear') })
    })
    await page.goto(url())
    const n = waiting(world.snapshot()).count
    await page.waitForFunction((n) => (window as unknown as { badges: unknown[] }).badges.at(-1) === n, n)
    await page.close()
  }, 30_000)
})
