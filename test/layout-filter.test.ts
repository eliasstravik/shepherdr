// Filtering a place's Tasks and Artifacts lists as you type, in a real browser (layout.ts).
import { describe, expect, test } from 'bun:test'
import { layout } from './layout.ts'

const { browser, server, world } = await layout({ everything: true })

const ids = (rows: import('playwright-core').Locator) => rows.evaluateAll((li) => li.map((l) => l.textContent?.match(/[A-Z]+-\d+/)?.[0]))

describe.skipIf(!browser)('filtering the tasks', () => {
  test('by id, title or status line, Done and Archived ones too; Esc clears it, then leaves it; Enter opens the first; F gets to it', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home`)
    const tasks = page.locator('section[aria-label="Tasks"]')
    const box = tasks.getByRole('searchbox', { name: 'Filter tasks' })
    await box.waitFor()
    // F, from anywhere but a box, puts you in it
    await page.locator('body').click({ position: { x: 600, y: 500 } })
    await page.keyboard.press('f')
    expect(await box.evaluate((b) => b === document.activeElement)).toBe(true)
    // the id and the title: archived ones after the rest, under Archived; the Archived link goes
    await page.keyboard.type('gtm')
    await tasks.getByText('Archived', { exact: true }).waitFor()
    expect(await ids(tasks.locator('li'))).toEqual(['GTM-14', 'GTM-16', 'GTM-15', 'GTM-18', 'GTM-17', 'GTM-12', 'GTM-11', 'GTM-9'])
    // every word, in any order and case: the status line counts too
    await box.fill('mute TRACING')
    await tasks.locator('li').first().getByText('HP-202').waitFor()
    expect(await ids(tasks.locator('li'))).toEqual(['HP-202'])
    // nothing found, said calmly
    await box.fill('zzz')
    await tasks.getByText('No tasks match “zzz”.').waitFor()
    // Esc clears it and the whole list is back; again, it leaves the box
    await page.keyboard.press('Escape')
    expect(await box.inputValue()).toBe('')
    await page.keyboard.press('Escape')
    expect(await box.evaluate((b) => b === document.activeElement)).toBe(false)
    // Enter opens the first one left
    await box.fill('webhook signature')
    await page.keyboard.press('Enter')
    await page.getByText('Merge GTM-15?').waitFor()
    await page.close()
  }, 30_000)

  test('a phone: the box is at the top of Tasks, finger-sized, its text 16px so it does not zoom; its x clears it', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home&tab=tasks`)
    const box = page.getByRole('searchbox', { name: 'Filter tasks' })
    await box.waitFor()
    expect(await box.evaluate((b) => getComputedStyle(b).fontSize)).toBe('16px')
    expect((await box.evaluate((b) => b.parentElement!.getBoundingClientRect().height))).toBeGreaterThanOrEqual(44)
    await box.tap()
    await box.fill('slack')
    expect(await ids(page.locator('li'))).toEqual(['GTM-12'])
    await page.getByRole('button', { name: 'Clear' }).tap()
    expect(await box.inputValue()).toBe('')
    await page.getByText('HP-202', { exact: true }).waitFor()
    await page.close()
  }, 30_000)
})

describe.skipIf(!browser)('filtering the artifacts', () => {
  test('by title or the task that made it; nothing found is said calmly', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home`)
    await page.getByRole('button', { name: 'Artifacts', exact: true }).click()
    const list = page.locator('section[aria-label="Artifacts"]')
    const box = list.getByRole('searchbox', { name: 'Filter artifacts' })
    await box.fill('deck')
    await list.getByText('Onboarding deck').waitFor()
    expect(await list.locator('li').count()).toBe(1)
    await box.fill('hp-201')
    await list.getByText('Board with the fixed count').waitFor()
    expect(await list.locator('li').count()).toBe(1)
    await box.fill('zzz')
    await list.getByText('No artifacts match “zzz”.').waitFor()
    // a project lists its own only, and the Tasks tab comes back
    await page.goto(`http://127.0.0.1:${server!.port}/?place=p%3Avm-str%3Agtm`)
    await page.getByRole('button', { name: 'Artifacts', exact: true }).click()
    await list.getByText('Onboarding deck').waitFor()
    expect(await list.locator('li').count()).toBe(1)
    await page.getByRole('button', { name: /^Tasks/ }).click()
    await page.locator('section[aria-label="Tasks"]').waitFor()
    await page.close()
  }, 30_000)
})

describe.skipIf(!browser)('Home attention defaults', () => {
  test('fresh global Home separates actionable work by space, search overrides it, explicit scope and lock win', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    // This file’s other cases explicitly select Everything. Here exercise a fresh device.
    await page.addInitScript(() => localStorage.removeItem('shepherdr.lists'))
    await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home`)
    const panel = page.locator('section[aria-label="Tasks"]')
    await panel.getByText('Actionable · all machines', { exact: true }).waitFor()
    await panel.getByRole('button', { name: 'gtm · Ready · vm-str 1', exact: true }).waitFor()
    expect(await ids(panel.locator('li'))).toContain('LV-3')
    expect(await ids(panel.locator('li'))).not.toContain('HP-202')
    const search = panel.getByRole('searchbox', { name: 'Filter tasks' })
    await search.fill('HP-202')
    await panel.getByText('HP-202', { exact: true }).waitFor()
    await search.fill('')
    await panel.getByRole('button', { name: 'Show all tasks', exact: true }).click()
    await panel.getByText('HP-202', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Keep filters: hold them when switching space', exact: true }).click()
    await page.getByRole('button', { name: /^lilla-varlden,/ }).click()
    await panel.getByText('HP-202', { exact: true }).waitFor()
    expect(await panel.getByText('Everything', { exact: true }).count()).toBe(1)
    await page.close()
  })
})

describe.skipIf(!browser)('no chat attention summary and quiet health', () => {
  test('phone and desktop, light and dark: Home and space chats have cards without aggregate disclosures', async () => {
    for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark'] as const) {
      const page = await browser!.newPage({ viewport: { width, height: 900 }, colorScheme })
      try {
        for (const place of ['vm-str/home', 'p:mac:~', 'p:vm-str:gtm']) {
          await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent(place)}`)
          const messages = page.locator('[data-messages]')
          await messages.waitFor()
          expect(await messages.locator('[data-attention]').count()).toBe(0)
          expect(await messages.getByText(/\d+ need you · \d+ ready/).count()).toBe(0)
          expect(await messages.getByText(/^Task updates ·/).count()).toBe(0)
          if (place === 'p:vm-str:gtm') {
            await messages.getByText('Rerun CI on main?', { exact: true }).waitFor()
            await messages.getByRole('button', { name: /Needs you GTM-14 needs you/ }).waitFor()
            await messages.getByRole('button', { name: /Ready GTM-15 is ready/ }).waitFor()
          }
        }
      } finally {
        await page.close()
      }
    }
  })

  test('plan limits: the foot beside Settings says the least left, a tap every window, its refill and its age', async () => {
    for (const width of [390, 1440]) {
      const page = await browser!.newPage({ viewport: { width, height: 900 } })
      try {
        await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home`)
        if (width === 390) await page.getByRole('button', { name: 'Spaces' }).click()
        const chip = page.getByRole('button', { name: /^Plan limits: 12% left/ })
        await chip.waitFor()
        const glance = await chip.textContent()
        expect(glance).toContain('ago') // The tightest number is hours old and says so at a glance.
        expect(glance).toContain('2 unknown') // The mac's Claude Code and its refilled window aren't hidden behind the numbers there are.
        await chip.click()
        const limits = page.getByRole('dialog', { name: 'Plan limits' })
        await limits.waitFor()
        const words = (await limits.textContent())!
        for (const seen of ['On vm-str', 'On mac', 'Claude Code', 'Codex · Pro', 'Codex · Plus', '90% left', '59% left', '32% left', 'On nas', 'No plan limits', 'Unknown. Can\'t read it safely here', 'Last read failed: Codex took too long to answer', 'not read since']) expect(words).toContain(seen)
        expect(words).toContain('Refills ')
        expect(words).not.toContain('88% left') // Refilled since it was read: no number claims to be now's.
        const box = (await limits.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
        if (width === 1440) expect(box.width).toBeLessThanOrEqual(400)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.keyboard.press('Escape')
        await limits.waitFor({ state: 'detached' })
      } finally {
        await page.close()
      }
    }
  })

  test('chat stays free of aggregate summaries with matching or filtered Tasks, preserving questions and health', async () => {
    const page = await browser!.newPage({ viewport: { width: 820, height: 1180 } })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=p:mac:~`)
    const panel = page.locator('section[aria-label="Tasks"]')
    await panel.getByText('LV-3', { exact: true }).waitFor()
    expect(await page.locator('[data-attention]').count()).toBe(0)
    await panel.getByRole('searchbox', { name: 'Filter tasks' }).fill('LV-3')
    expect(await page.locator('[data-attention]').count()).toBe(0)
    expect(await page.getByText(/^Task updates ·/).count()).toBe(0)
    await page.getByRole('button', { name: /^Machine health/ }).click()
    const health = page.getByRole('dialog', { name: 'mac health' })
    await health.waitFor()
    expect(await health.textContent()).toContain('Alert limit crossed')
    expect(await health.textContent()).toContain('18%') // Healthy CPU still available beside the disk warning.
    await page.keyboard.press('Escape')
    await page.goto(`http://127.0.0.1:${server!.port}/?place=p:vm-str:gtm`)
    await page.getByText('Rerun CI on main?', { exact: true }).waitFor()
    expect(await page.locator('[data-attention]').count()).toBe(0)
    expect(await page.getByText(/4 need you/).count()).toBe(0)
    // What needs you is counted once, on Needs you, which holds the coordinator's question too; Tasks shows Ready alone.
    expect(await panel.getByLabel(/^\d+ needs you, 0 ready · everywhere$/).count()).toBe(1)
    expect(await panel.getByLabel('0 needs you, 1 ready · panel scope', { exact: true }).count()).toBe(1)
    await page.close()
  })
})

describe.skipIf(!browser)('Home on a single machine', () => {
  test('host Home remains actionable when there are no peers', async () => {
    const places = world.places
    const machines = world.machines
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      world.places = places.filter((p) => p.machine === world.snapshot().host).map((p) => p.home ? { ...p, level: 1 } : p)
      world.machines = machines.filter((m) => m.machine === world.snapshot().host)
      await page.addInitScript(() => localStorage.removeItem('shepherdr.lists'))
      await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home`)
      const panel = page.locator('section[aria-label="Tasks"]')
      await panel.getByText('Actionable · all machines', { exact: true }).waitFor()
      expect(await ids(panel.locator('li'))).toContain('GTM-15')
      expect(await ids(panel.locator('li'))).not.toContain('HP-202')
    } finally {
      world.places = places
      world.machines = machines
      await page.close()
    }
  })
})
