// Notifications and the content's scope picker: UI regression coverage for SHE-263.
import { describe, expect, test } from 'bun:test'
import type { Page } from 'playwright-core'
import { layout, settled } from './layout.ts'

const { browser, world, url } = await layout()

/** Settings opens on Everywhere: go to one space's or machine's level */
async function pickLevel(page: Page, name: string) {
  await page.getByRole('button', { name: 'Editing: Everywhere', exact: true }).click()
  await page.getByRole('menuitemradio', { name, exact: true }).click()
  await page.getByRole('button', { name: `Editing: ${name}`, exact: true }).waitFor()
}

describe.skipIf(!browser)('notification settings', () => {
  test('a space edit and reset leave the machine, Everywhere and another home unchanged', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } })
    const before = world.sections
    try {
      await page.goto(url())
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = page.getByRole('region', { name: 'Settings' })
      await pickLevel(page, 'home · vm-str')
      await settings.getByRole('button', { name: 'Notifications', exact: true }).click()
      const rule = settings.getByRole('group', { name: 'Notify', exact: true })
      const value = (level: string) => world.sections.find((s) => s.level === level && s.name === 'Notify')!.rows[0].value
      const others = ['all', 'm:vm-str', 'p:mac:~'].map(value)
      await rule.getByRole('button', { name: 'Off', exact: true }).click()
      await settings.getByRole('button', { name: 'Reset to Needs me', exact: true }).waitFor()
      expect(value('p:vm-str:~')).toBe('Off')
      expect(['all', 'm:vm-str', 'p:mac:~'].map(value)).toEqual(others)
      expect(await settings.textContent()).toContain('Set here')
      expect(await settings.textContent()).toContain('Inherits Needs me · Everywhere')
      await settings.getByRole('button', { name: 'Add this device', exact: true }).waitFor()
      await settings.getByRole('button', { name: 'Reset to Needs me', exact: true }).click()
      await settings.getByRole('button', { name: 'Reset to Needs me', exact: true }).waitFor({ state: 'detached' })
      expect(value('p:vm-str:~')).toBe('Needs me')
      expect(['all', 'm:vm-str', 'p:mac:~'].map(value)).toEqual(others)
      await settings.getByRole('button', { name: 'Plugins', exact: true }).click()
      expect(await settings.getByRole('button', { name: /^Editing:/ }).count()).toBe(0)
      expect(await settings.textContent()).toContain('Editing:Everywhere')
      await settings.getByRole('button', { name: 'Voice', exact: true }).click()
      expect(await settings.getByRole('button', { name: 'Add this device', exact: true }).count()).toBe(0)
      await settings.getByRole('button', { name: 'How tasks work', exact: true }).click()
      const wording = settings.locator('details').first()
      expect(await wording.getAttribute('open')).toBeNull()
      await wording.locator('summary').click()
      expect(await wording.innerText()).toContain('“')
      expect(await settings.textContent()).toContain("Every new task's instructions end with")
    } finally {
      world.stores['vm-str'].set('notify', null, { space: '~' })
      world.sections = before
      world.emit('snapshot')
      await page.close()
    }
  })

  test('twenty machines and duplicate homes can be searched and picked on a phone', async () => {
    const before = { machines: world.machines, places: world.places, sections: world.sections }
    const template = world.places.find((p) => p.id === 'p:vm-str:~')!
    const machines = Array.from({ length: 20 }, (_, i) => `machine-${i + 1}`)
    world.machines = [...world.machines, ...machines.map((m) => ({ ...world.machines[0], id: `m:${m}`, machine: m, name: m }))]
    world.places = [...world.places, ...machines.map((m) => ({ ...template, id: `p:${m}:~`, machine: m, name: 'home' }))]
    world.sections = [...world.sections, ...machines.flatMap((m) => before.sections.filter((s) => s.level === 'm:vm-str' || s.level === template.id).map((s) => ({ ...s, machine: m, level: s.level!.replace('vm-str', m) })))]
    world.emit('snapshot')
    const page = await browser!.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })
    try {
      await page.goto(url())
      await page.getByRole('button', { name: 'Spaces', exact: true }).click()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Editing: Everywhere', exact: true }).click()
      await page.getByRole('textbox', { name: 'Find scope or value' }).fill('home · machine-20')
      const menu = page.getByRole('menu', { name: 'Choices' })
      expect(await menu.getByRole('menuitemradio').count()).toBe(1)
      await menu.getByRole('menuitemradio', { name: 'home · machine-20', exact: true }).click()
      await page.getByRole('button', { name: 'Editing: home · machine-20', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Notifications', exact: true }).click()
      await settled(page)
      const region = page.getByRole('region', { name: 'Notifications', exact: true })
      await region.getByRole('button', { name: 'Editing: home · machine-20', exact: true }).waitFor()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
    } finally {
      Object.assign(world, before)
      world.emit('snapshot')
      await page.close()
    }
  })
})

describe.skipIf(!browser)('chat agent choices', () => {
  test('Agents explains the chat limit and offers only readable agents', async () => {
    const page = await browser!.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })
    try {
      await page.goto(url())
      await page.getByRole('button', { name: 'Spaces', exact: true }).click()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = page.getByRole('region', { name: 'Settings' })
      await settings.getByRole('button', { name: 'Agents', exact: true }).click()
      expect(await settings.textContent()).toContain('other installed CLIs cannot show replies here')
      expect(await settings.textContent()).toContain('Headless review is separate')
      for (const group of ['Tasks', 'Coordinators', 'Backup']) {
        await settings.getByRole('heading', { name: group, exact: true }).locator('..').getByRole('button', { name: /^Agent:/ }).click()
        const choices = await page.getByRole('menuitemradio').allTextContents()
        expect(choices.map((v) => v.trim())).toEqual(group === 'Backup' ? ['Codex', 'Off', 'Claude Code', 'Pi'] : ['Claude Code', 'Codex', 'Pi'])
        await page.keyboard.press('Escape')
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
    } finally { await page.close() }
  })
})

describe.skipIf(!browser)('Task IDs space settings', () => {
  test('shows only for its space, with two fields and a useful refusal', async () => {
    const { taskIdsSection } = await import('../server/common/task-ids.ts')
    const before = world.sections
    const level = 'p:vm-str:gtm'
    world.sections = [...before, taskIdsSection(level, 'vm-str', 'GAME', 100)]
    world.emit('snapshot')
    const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } })
    try {
      await page.goto(url())
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = page.getByRole('region', { name: 'Settings' })
      expect(await settings.getByRole('button', { name: 'Task IDs', exact: true }).count()).toBe(0)
      await settings.getByRole('button', { name: /^Editing:/ }).click()
      await page.getByRole('menuitemradio', { name: /gtm/ }).click()
      await settings.getByRole('button', { name: 'Task IDs', exact: true }).click()
      expect(await settings.getByRole('textbox').count()).toBe(2)
      expect(await settings.getByRole('textbox', { name: 'Prefix', exact: true }).inputValue()).toBe('GAME')
      expect(await settings.textContent()).toContain('Next task: GAME-100')
      expect(await settings.getByRole('button', { name: /^Reset to/ }).count()).toBe(0)
      expect(await settings.textContent()).not.toContain('The rest follows')
      // Exercise the screen's actual save and refusal handling without teaching the demo world live ID allocation.
      const sent: unknown[] = []
      await page.route('**/api/action', async (route) => {
        const action = route.request().postDataJSON()
        if (action.type !== 'setting' || !action.key.startsWith('taskIds.')) return route.continue()
        sent.push(action)
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Use 100 or higher. Earlier numbers are reserved.' }) })
      })
      await settings.getByRole('textbox', { name: 'Next number' }).fill('7')
      await settings.getByRole('textbox', { name: 'Next number' }).press('Tab')
      await settings.getByRole('status').filter({ hasText: 'Use 100 or higher' }).waitFor()
      expect(sent).toEqual([{ type: 'setting', key: 'taskIds.next', value: '7', place: level }])
    } finally {
      world.sections = before
      world.emit('snapshot')
      await page.close()
    }
  })
})

describe.skipIf(!browser)('private instruction settings', () => {
  test('phone editing saves only its role and scope; undo, blank and reset preserve inheritance', async () => {
    const store = world.stores['vm-str']
    const key = 'task.instructions'
    store.set(key, 'Everywhere task rule.')
    world.sections = (await import('../server/demo/data.ts')).settings(world.stores)
    world.emit('snapshot')
    const page = await browser!.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })
    try {
      await page.goto(url())
      await page.getByRole('button', { name: 'Spaces', exact: true }).click()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await pickLevel(page, 'home · vm-str')
      await page.getByRole('button', { name: 'Private instructions', exact: true }).click()
      const panel = page.getByRole('region', { name: 'Private instructions', exact: true })
      await panel.getByRole('button', { name: 'Editing: home · vm-str', exact: true }).waitFor()
      const task = panel.getByRole('textbox', { name: 'Task agents', exact: true })
      expect(await task.inputValue()).toBe('Everywhere task rule.')
      await task.fill('Unsaved rule.')
      await panel.getByRole('button', { name: 'Undo', exact: true }).click()
      expect(await task.inputValue()).toBe('Everywhere task rule.')
      await task.fill('Task-only home rule.\nSecond line.')
      await panel.getByRole('button', { name: 'Save', exact: true }).click()
      await panel.getByRole('button', { name: 'Reset to private rules', exact: true }).waitFor()
      expect(store.get(key, '~')).toBe('Task-only home rule.\nSecond line.')
      expect(store.get(key)).toBe('Everywhere task rule.')
      expect(store.get('coordinator.instructions', '~')).toBe('')
      expect(store.get('reviewer.instructions', '~')).toBe('')
      await task.fill('')
      await panel.getByRole('button', { name: 'Save', exact: true }).click()
      await panel.getByRole('button', { name: 'Save', exact: true }).waitFor({ state: 'detached' })
      expect(store.get(key, '~')).toBe('')
      await panel.getByRole('button', { name: 'Reset to private rules', exact: true }).click()
      await panel.getByRole('button', { name: 'Reset to private rules', exact: true }).waitFor({ state: 'detached' })
      expect(await task.inputValue()).toBe('Everywhere task rule.')
      expect(await panel.textContent()).toContain('When rules take effect')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
    } finally {
      store.set(key, null, { space: '~' })
      store.set(key, null)
      world.sections = (await import('../server/demo/data.ts')).settings(world.stores)
      world.emit('snapshot')
      await page.close()
    }
  })
})

describe.skipIf(!browser)('repository base', () => {
  test('editing the space default keeps existing task targets', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } })
    const before = world.bases['p:vm-str:gtm']
    try {
      await page.goto(url().replace('vm-str/home', 'vm-str/gtm'))
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = page.getByRole('region', { name: 'Settings' })
      await pickLevel(page, 'gtm · vm-str')
      await settings.getByRole('button', { name: 'Repository', exact: true }).click()
      const input = settings.getByRole('textbox', { name: 'Base branch', exact: true })
      await input.fill('develop')
      await input.press('Tab')
      await settled(page)
      expect(world.bases['p:vm-str:gtm']).toBe('develop')
      expect(world.tasks.find((t) => t.id === 'GTM-15')!.base).toBe('main')
      await settings.getByRole('button', { name: 'Close', exact: true }).click()
      await page.getByRole('button', { name: /Ready GTM-15 Fix webhook/ }).click()
      await page.getByText('Merges into main', { exact: true }).filter({ visible: true }).first().waitFor()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByText('Merges into main', { exact: true }).filter({ visible: true }).first().waitFor()
    } finally {
      world.bases['p:vm-str:gtm'] = before
      world.emit('snapshot')
      await page.close()
    }
  })
})

describe.skipIf(!browser)('Settings opens on Everywhere', () => {
  for (const [name, viewport, phone] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 900 }, false]] as const)
    test(`from any space, with "for this space only" on each row (${name})`, async () => {
      const before = world.sections
      const page = await browser!.newPage({ viewport, hasTouch: phone, isMobile: phone })
      try {
        await page.goto(url().replace('vm-str/home', 'vm-str/gtm'))
        if (phone) await page.getByRole('button', { name: 'Spaces', exact: true }).click()
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        const settings = page.getByRole('region', { name: 'Settings' })
        await settings.getByRole('button', { name: 'Editing: Everywhere', exact: true }).waitFor()
        await settings.getByRole('button', { name: 'How tasks work', exact: true }).click()
        await settled(page)
        const only = page.getByRole('button', { name: 'For this space only: gtm' })
        expect(await only.count()).toBeGreaterThan(3)
        const review = world.sections.find((s) => s.level === 'all' && s.rows.some((r) => r.key === 'brief.review'))!
        const value = review.rows.find((r) => r.key === 'brief.review')!.value
        // the row goes to that space's page; Everywhere's value stays
        await only.first().click()
        await page.getByRole('button', { name: 'Editing: gtm · vm-str', exact: true }).first().waitFor()
        expect(await page.getByRole('button', { name: 'For this space only: gtm' }).count()).toBe(0)
        expect(world.sections.find((s) => s.level === 'all' && s.rows.some((r) => r.key === 'brief.review'))!.rows.find((r) => r.key === 'brief.review')!.value).toBe(value)
      } finally {
        await page.close()
        world.sections = before
        world.emit('snapshot')
      }
    }, 30_000)

  test('a row says when the space sets its own; a new secret saves Everywhere unless switched to this space', async () => {
    const before = world.sections
    world.sections = before.map((s) => (s.level === 'p:vm-str:gtm' ? { ...s, rows: s.rows.map((r) => (r.key === 'review.mustFix' ? { ...r, value: 'minor', inherits: { value: 'major', from: 'Everywhere' }, from: undefined } : r)) } : s))
    world.emit('snapshot')
    const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } })
    const saved: { level: string }[] = []
    await page.route('**/api/action', async (route) => {
      const action = route.request().postDataJSON()
      if (action.type !== 'secret') return route.continue()
      saved.push(action)
      await route.fulfill({ json: { ok: true } })
    })
    try {
      await page.goto(url().replace('vm-str/home', 'vm-str/gtm'))
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = page.getByRole('region', { name: 'Settings' })
      await settings.getByRole('button', { name: 'How tasks work', exact: true }).click()
      await settings.getByRole('button', { name: 'gtm sets its own' }).waitFor()
      await settings.getByRole('button', { name: 'Secrets', exact: true }).click()
      const add = async (name: string) => {
        await settings.getByRole('button', { name: 'Add a secret' }).click()
        await settings.getByRole('textbox', { name: 'Name' }).fill(name)
        await settings.getByLabel('Value').fill('not-a-secret')
      }
      await add('EVERYWHERE_KEY')
      await settings.getByRole('button', { name: 'Save', exact: true }).click()
      await settings.getByRole('button', { name: 'Editing: Everywhere', exact: true }).waitFor()
      await add('SPACE_KEY')
      await settings.getByRole('switch', { name: 'For this space only: gtm' }).click()
      await settings.getByRole('button', { name: 'Save', exact: true }).click()
      await settings.getByRole('button', { name: 'Editing: gtm · vm-str', exact: true }).first().waitFor()
      expect(saved.map((x) => x.level)).toEqual(['all', 'p:vm-str:gtm'])
    } finally {
      await page.close()
      world.sections = before
      world.emit('snapshot')
    }
  }, 30_000)
})
