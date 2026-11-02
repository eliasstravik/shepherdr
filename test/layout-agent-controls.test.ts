// Composer + launch controls for both chat roles; only GitHub runs these browser tests.
import { describe, expect, test } from 'bun:test'
import { layout } from './layout.ts'

const { browser, world, server } = await layout({ everything: true })

describe.skipIf(!browser)('composer + agent controls', () => {
  test('both chats hide controls until + opens at phone, tablet and desktop widths; picks wait for Restart and cancel changes nothing', async () => {
    const p = world.snapshot().places.find((x) => !x.home)!
    const key = 'GTM-17/Agent'
    for (const [width, colorScheme] of [[320, 'light'], [768, 'dark'], [1440, 'light']] as const) {
      for (const task of [false, true]) {
        const chat = task ? key : p.chat
        world.chats[chat].agent = { kind: 'codex', model: 'gpt-6-sol', effort: 'low', runtime: { model: 'gpt-6.1-sol', effort: 'high', source: 'session', at: Date.now() } }
        world.chats[chat].cli = 'Codex'
        const before = JSON.stringify(world.chats[chat].agent)
        const page = await browser!.newPage({ viewport: { width, height: 900 }, colorScheme })
        page.setDefaultTimeout(10_000) // Surface the failing locator before the enclosing test deadline.
        await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent(p.id)}${task ? '&task=GTM-17' : ''}`)
        const controls = page.locator('[data-agent-controls]:visible').last()
        await page.locator('[data-composer]:visible').last().waitFor()
        expect(await controls.count()).toBe(0)
        await page.locator('[data-composer]:visible button[aria-label="Attach files and more"]').last().click()
        await controls.waitFor()
        await page.getByRole('menuitem', { name: 'File or photo', exact: true }).waitFor()
        expect(await page.locator('[data-restart-hint]').count()).toBe(0)
        expect(await controls.getByRole('menuitem').count()).toBe(4)
        expect(await controls.textContent()).toContain('gpt-6.1-sol')
        await controls.getByRole('menuitem', { name: /^Model:/ }).click()
        const sheet = page.getByRole('alertdialog')
        await sheet.locator('[data-restart]').waitFor()
        expect(await sheet.textContent()).not.toMatch(/Recorded launch|Settings for|unknown|CLI|resumes|meanwhile/)
        expect(await sheet.getByRole('button', { name: 'Model: GPT-6-Sol', exact: true }).count()).toBe(1)
        expect(await sheet.getByRole('switch', { name: new RegExp(`Use for future ${task ? 'task agents' : 'coordinators'}`) }).getAttribute('aria-checked')).toBe('false')
        const box = (await sheet.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
        expect(box.height).toBeLessThan(400)
        await sheet.getByRole('button', { name: /^Agent: / }).click()
        await page.getByRole('menuitemradio', { name: 'Claude Code', exact: true }).click()
        // A model from Codex cannot leak into Claude; the new CLI starts from Default.
        expect(await sheet.getByRole('button', { name: 'Model: Default', exact: true }).count()).toBe(1)
        expect(JSON.stringify(world.chats[chat].agent)).toBe(before)
        await sheet.getByRole('button', { name: 'Cancel', exact: true }).click()
        expect(JSON.stringify(world.chats[chat].agent)).toBe(before)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        await page.close()
      }
    }
  }, 30_000)

  test('missing launch values stay unknown in the popup instead of borrowing Settings defaults', async () => {
    const key = 'GTM-17/Agent'
    world.chats[key].agent = { kind: 'codex' }
    world.chats[key].cli = 'Codex'
    const page = await browser!.newPage({ viewport: { width: 320, height: 844 } })
    page.setDefaultTimeout(10_000) // Surface the failing locator before the enclosing test deadline.
    await page.goto(`http://127.0.0.1:${server!.port}/?place=all&task=GTM-17`)
    await page.locator('[data-composer]:visible button[aria-label="Attach files and more"]').last().click()
    const controls = page.locator('[data-agent-controls]:visible')
    await controls.getByRole('menuitem', { name: 'Model: Not known yet. Select and restart', exact: true }).waitFor()
    expect(await controls.getByRole('menuitem', { name: 'Effort: Not known yet. Select and restart', exact: true }).count()).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    await page.getByRole('button', { name: 'Attach files and more', exact: true }).last().click()
    await controls.waitFor({ state: 'hidden' })
    expect(await controls.count()).toBe(0)
    expect(world.chats[key].agent).toEqual({ kind: 'codex' })
    await page.close()
  }, 30_000)

  test('before an agent starts, the line and the menu say what Settings will use, and the sheet still opens', async () => {
    const key = 'GTM-17/Agent', chat = world.chats[key]
    const saved = chat.agent
    chat.agent = { kind: 'claude', planned: { model: 'claude-haiku-5-5', modelLabel: 'Haiku 5.5' } }
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    page.setDefaultTimeout(10_000) // Surface the failing locator before the enclosing test deadline.
    try {
      await page.goto(`http://127.0.0.1:${server!.port}/?place=all&task=GTM-17`)
      const line = page.locator('[data-agent-line]:visible', { hasText: /^Haiku 5\.5, from Settings$/ }).last()
      await line.waitFor()
      await line.click()
      const controls = page.locator('[data-agent-controls]:visible').last()
      await controls.getByRole('menuitem', { name: 'Model: Haiku 5.5, from Settings. Select and restart', exact: true }).waitFor()
      expect(await controls.getByRole('menuitem', { name: 'Effort: Default, from Settings. Select and restart', exact: true }).count()).toBe(1)
      expect(await controls.getByRole('menuitem', { name: 'Speed: Default. Select and restart', exact: true }).count()).toBe(1)
      expect(await controls.textContent()).not.toContain('Not known yet')
      chat.agent = { kind: 'claude', planned: { model: 'claude-haiku-5-5', modelLabel: 'Haiku 5.5', effort: 'high' } }
      world.emit('chat', key)
      await page.locator('[data-agent-line]:visible', { hasText: /^Haiku 5\.5 · high, from Settings$/ }).last().waitFor({ state: 'attached' })
      // nothing runs yet, so the sheet starts from Settings, here what the demo gives as its want
      await controls.getByRole('menuitem', { name: /^Model: / }).click()
      await page.locator('[data-restart]').waitFor()
    } finally { chat.agent = saved; await page.close() }
  }, 30_000)

  test('the restart sheet says what Default came to where the composer shows an effort', async () => {
    const key = 'GTM-17/Agent', chat = world.chats[key]
    const saved = chat.agent
    chat.agent = { kind: 'claude', runtime: { model: 'claude-opus-5-5', modelLabel: 'Opus 5.5', effort: 'medium', source: 'session', at: Date.now() } }
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    page.setDefaultTimeout(10_000) // Surface the failing locator before the enclosing test deadline.
    try {
      await page.goto(`http://127.0.0.1:${server!.port}/?place=all&task=GTM-17`)
      await page.locator('[data-composer]:visible button[aria-label="Attach files and more"]').last().click()
      await page.locator('[data-agent-controls]:visible').last().getByRole('menuitem', { name: /^Effort: Medium/ }).click()
      const note = page.locator('[data-effort-ran]')
      await note.waitFor()
      expect(await note.textContent()).toBe('Default lets Claude Code choose. It runs medium now.')
    } finally { chat.agent = saved; await page.close() }
  }, 30_000)

  test('default policy shows runtime values in both roles and updates without changing the policy', async () => {
    const p = world.snapshot().places.find((x) => !x.home)!
    for (const chat of [p.chat, 'GTM-17/Agent']) {
      world.chats[chat].agent = { kind: 'codex', runtime: { model: 'config-overridden-model', effort: 'high', source: 'session', at: Date.now() } }
      world.chats[chat].cli = 'Codex'
      const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
      page.setDefaultTimeout(10_000) // Surface the failing locator before the enclosing test deadline.
      await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent(p.id)}${chat.includes('/') ? '&task=GTM-17' : ''}`)
      await page.locator('[data-composer]:visible button[aria-label="Attach files and more"]').last().click()
      const controls = page.locator('[data-agent-controls]:visible').last()
      await controls.getByRole('menuitem', { name: 'Model: config-overridden-model. Select and restart', exact: true }).waitFor()
      world.chats[chat].agent!.runtime = { model: 'changed-live-model', effortUnsupported: true, source: 'session', at: Date.now() }
      world.emit('chat', chat)
      await controls.getByRole('menuitem', { name: 'Model: changed-live-model. Select and restart', exact: true }).waitFor()
      await controls.getByRole('menuitem', { name: 'Effort: Not supported. Select and restart', exact: true }).waitFor()
      expect(world.chats[chat].agent!.model).toBeUndefined()
      expect(world.chats[chat].agent!.effort).toBeUndefined()
      await page.close()
    }
  }, 30_000)

  test('the line under the box shows what runs with no tap, at every width, and never moves the box', async () => {
    const p = world.snapshot().places.find((x) => !x.home)!
    const key = 'GTM-17/Agent'
    for (const [width, height] of [[320, 568], [390, 844], [1440, 900]] as const) {
      for (const chat of [p.chat, key]) {
        const page = await browser!.newPage({ viewport: { width, height } })
        page.setDefaultTimeout(10_000) // Surface the failing locator before the enclosing test deadline.
        const set = (agent: NonNullable<(typeof world.chats)[string]['agent']>, cli = 'Claude Code') => { world.chats[chat].agent = agent; world.chats[chat].cli = cli; world.emit('chat', chat) }
        set({ kind: 'claude', model: 'claude-opus-5-5', modelLabel: 'Opus 5.5', effort: 'high' })
        await page.goto(`http://127.0.0.1:${server!.port}/?place=${encodeURIComponent(p.id)}${chat === key ? '&task=GTM-17' : ''}`)
        const line = page.locator('[data-agent-line]:visible').last()
        const shows = (words: string | RegExp) => page.locator('[data-agent-line]:visible', { hasText: words }).last().waitFor()
        await shows(/^Asked for: Opus 5\.5\s·\shigh$/)
        const box = (await page.locator('[data-composer]:visible').last().boundingBox())!
        set({ kind: 'claude', model: 'claude-opus-5-5', effort: 'high', runtime: { model: 'claude-opus-5-5', modelLabel: 'Opus 5.5', source: 'hook', at: Date.now() } })
        await shows(/^Opus 5\.5\s·\sAsked for: high$/)
        set({ kind: 'claude', runtime: { model: 'claude-opus-5-5', modelLabel: 'Opus 5.5', effort: 'medium', speed: 'fast', source: 'session', at: Date.now() } })
        await shows(/^Opus 5\.5\s·\smedium\s·\sFast$/)
        expect(await line.locator('svg').count()).toBe(1)
        set({ kind: 'claude', runtime: { model: 'claude-opus-5-5', modelLabel: 'Opus 5.5', effort: 'xhigh', speed: 'normal', source: 'session', at: Date.now() } })
        await shows(/^Opus 5\.5\s·\sextra high$/)
        set({ kind: 'codex', runtime: { model: 'an-unknown-very-long-model-id-from-a-newer-cli-than-this-one-and-still-going-on-and-on-past-any-screen', effort: 'high', speed: 'fast', source: 'session', at: Date.now() } }, 'Codex')
        await shows('Fast')
        // the id gives way: effort and speed stay on screen
        const fast = (await line.getByText('Fast').boundingBox())!
        expect(fast.x + fast.width).toBeLessThanOrEqual(width)
        set({ kind: 'codex' }, 'Codex')
        await shows('Codex · Not known yet')
        expect((await page.locator('[data-composer]:visible').last().boundingBox())!.y).toBe(box.y)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        await line.click()
        await page.locator('[data-agent-controls]:visible').last().getByRole('menuitem', { name: 'Speed: Not known yet. Select and restart', exact: true }).waitFor()
        await page.close()
      }
    }
  }, 60_000)

  test('the + menu says what is requested until its records say what runs, Speed included', async () => {
    const key = 'GTM-17/Agent'
    world.chats[key].agent = { kind: 'claude', model: 'claude-opus-5-5', modelLabel: 'Opus 5.5', effort: 'high', speed: 'fast' }
    world.chats[key].cli = 'Claude Code'
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    page.setDefaultTimeout(10_000) // Surface the failing locator before the enclosing test deadline.
    await page.goto(`http://127.0.0.1:${server!.port}/?place=all&task=GTM-17`)
    await page.locator('[data-composer]:visible button[aria-label="Attach files and more"]').last().click()
    const controls = page.locator('[data-agent-controls]:visible').last()
    await controls.getByRole('menuitem', { name: 'Model: Asked for: Opus 5.5. Select and restart', exact: true }).waitFor()
    await controls.getByRole('menuitem', { name: 'Effort: Asked for: High. Select and restart', exact: true }).waitFor()
    await controls.getByRole('menuitem', { name: 'Speed: Asked for: Fast. Select and restart', exact: true }).waitFor()
    world.chats[key].agent!.runtime = { model: 'claude-opus-5-5', modelLabel: 'Opus 5.5', effort: 'high', speed: 'normal', source: 'session', at: Date.now() }
    world.emit('chat', key)
    await controls.getByRole('menuitem', { name: 'Speed: Normal. Select and restart', exact: true }).waitFor()
    await page.close()
  }, 30_000)

  test('Speed picks wait for Restart and go with it; what it was started on is the starting pick', async () => {
    const key = 'GTM-17/Agent'
    world.chats[key].agent = { kind: 'codex', speed: 'fast' }
    world.chats[key].cli = 'Codex'
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    page.setDefaultTimeout(10_000) // Surface the failing locator before the enclosing test deadline.
    await page.goto(`http://127.0.0.1:${server!.port}/?place=all&task=GTM-17`)
    await page.locator('[data-composer]:visible button[aria-label="Attach files and more"]').last().click()
    await page.locator('[data-agent-controls]:visible').last().getByRole('menuitem', { name: /^Speed:/ }).click()
    const sheet = page.getByRole('alertdialog')
    await sheet.getByRole('button', { name: 'Speed: Fast', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Normal', exact: true }).click()
    expect(world.chats[key].agent!.speed).toBe('fast')
    await sheet.getByRole('button', { name: 'Restart', exact: true }).click()
    await sheet.waitFor({ state: 'hidden' })
    expect(world.chats[key].agent!.speed).toBe('normal')
    await page.close()
  }, 30_000)

  test('a retired launch model stays visible, blocks Restart, and can be replaced with Default', async () => {
    const key = 'GTM-17/Agent'
    world.chats[key].agent = { kind: 'codex', model: 'retired-model' }
    world.chats[key].cli = 'Codex'
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    page.setDefaultTimeout(10_000) // Surface the failing locator before the enclosing test deadline.
    await page.goto(`http://127.0.0.1:${server!.port}/?place=all&task=GTM-17`)
    await page.locator('[data-composer]:visible button[aria-label="Attach files and more"]').last().click()
    await page.locator('[data-agent-controls]:visible').last().getByRole('menuitem', { name: /^Model:/ }).click()
    const sheet = page.getByRole('alertdialog')
    await sheet.getByText('retired-model is unavailable.', { exact: false }).waitFor()
    expect(await sheet.getByRole('button', { name: 'Restart', exact: true }).isDisabled()).toBe(true)
    await sheet.getByRole('button', { name: 'Model: retired-model', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Default', exact: true }).click()
    expect(await sheet.getByRole('button', { name: 'Restart', exact: true }).isEnabled()).toBe(true)
    await sheet.getByRole('button', { name: 'Restart', exact: true }).click()
    await sheet.waitFor({ state: 'detached' })
    expect(world.chats[key].agent).toEqual({ kind: 'codex', model: '', effort: '' })
    expect(world.chats[key].messages.at(-1)?.card?.text).toBe('Restarted on Codex')
    await page.close()
  }, 30_000)
})
