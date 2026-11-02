// What you send and how the chat answers: at once, replies, what the best chats do, in a real browser (layout.ts).
import { describe, expect, test } from 'bun:test'
import type { Page } from 'playwright-core'
import { layout, type Box } from './layout.ts'
import { SETTINGS_HEAD, OLD_HEADS } from '../shared/brief.ts'

const { browser, sending, world, server, url } = await layout()

describe.skipIf(!browser)('what you send shows at once', () => {
  const bubbles = (page: Page, text: string) => page.locator('[data-you] [data-anchor]').filter({ hasText: new RegExp(`^${text}$`) })
  /** has the one bubble of these words become the real message (not one still on its way) */
  const settled = (page: Page, text: string) =>
    page.waitForFunction((t) => {
      const els = [...document.querySelectorAll('[data-you] [data-anchor]')].filter((e) => e.textContent === t)
      return els.length === 1 && !els[0].closest('[data-msg]')!.getAttribute('data-msg')!.startsWith('out:')
    }, text)
  test('full briefs remain one selectable plain-text block, including settings and provenance', async () => {
    const task = world.tasks.find((t) => t.id === 'HP-204')!
    const original = `# Literal **brief** with \`commands\` and <tags>\n\n${task.desc}\n\nKeep instructions after settings.\n${'long-unbroken-text'.repeat(30)}`
    const variants = [original, ...OLD_HEADS.map((head) => original.replace(SETTINGS_HEAD, head)), '# Brief without settings\n\n**Keep this literal too.**']
    for (const [i, text] of variants.entries()) world.chats['p:vm-str:~'].messages.push({ id: `full-brief-${i}`, who: 'you', text, at: Date.now() + i })
    for (const width of [390, 1440]) {
      const page = await browser!.newPage({ viewport: { width, height: 900 } })
      await page.goto(url())
      for (const [i, text] of variants.entries()) {
        const body = page.locator(`[data-msg="full-brief-${i}"] [data-text]`)
        await body.waitFor()
        expect(await body.textContent()).toBe(text)
        expect(await body.locator('strong, b, pre, code, ul, table, hr, [data-settings], [data-changed]').count()).toBe(0)
        expect(await body.locator(':scope > div').count()).toBe(1)
        const selected = await body.evaluate((el) => {
          const selection = window.getSelection()!
          selection.selectAllChildren(el)
          const value = selection.toString()
          selection.removeAllRanges()
          return value
        })
        expect(selected).toBe(text)
        expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      }
      // Ordinary agent replies still render Markdown.
      expect(await page.locator('[data-msg="code-agent"] code').count()).toBeGreaterThan(0)
      await page.close()
    }
  })
  test('it shows the moment you tap Send, faded, then the real one takes its place without being drawn again', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await page.goto(url())
    const box = page.getByRole('textbox', { name: /Message/ })
    await box.waitFor()
    let release!: () => void
    sending.hold = new Promise((r) => (release = r))
    await box.fill('Ship it today')
    await page.getByRole('button', { name: 'Send' }).click()
    // there at once, though the server hasn't answered: faded, and not something to react to yet
    const pending = bubbles(page, 'Ship it today')
    await pending.waitFor()
    expect(await box.inputValue()).toBe('')
    const unit = pending.locator('xpath=../..')
    expect(await unit.evaluate((el) => getComputedStyle(el).opacity)).toBe('0.6')
    expect(await pending.getAttribute('tabindex')).toBeNull()
    await pending.evaluate((el) => ((el as HTMLElement & { mark?: number }).mark = 1))
    // the chat is scrolled down to it
    expect(await page.evaluate(() => { const el = document.querySelector('[data-msg]')!.closest('.overflow-y-auto')!; return el.scrollHeight - el.scrollTop - el.clientHeight })).toBeLessThan(2)
    release()
    sending.hold = null
    // it settles: the same element, now the real message (it can take a reaction), and only one of it
    await settled(page, 'Ship it today')
    expect(await pending.evaluate((el) => (el as HTMLElement & { mark?: number }).mark)).toBe(1)
    await page.waitForFunction(() => [...document.querySelectorAll('[data-anchor]')].some((e) => e.textContent === 'Ship it today' && getComputedStyle(e.parentElement!.parentElement!).opacity === '1'))
    await page.close()
  }, 30_000)
  test('pictures on their way sit in an album at once, and the real ones take their place without loading again', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await page.goto(url())
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64')
    await page.getByRole('button', { name: 'Attach files and more' }).click()
    await page.setInputFiles('input[name="file"]', ['a', 'b'].map((n) => ({ name: `pic-${n}.png`, mimeType: 'image/png', buffer: png })))
    await page.getByRole('list', { name: 'Attached files' }).getByRole('listitem').nth(1).waitFor()
    let release!: () => void
    sending.hold = new Promise((r) => (release = r))
    await page.getByRole('button', { name: 'Send' }).click()
    const album = page.getByRole('group', { name: '2 pictures' }).last()
    await album.waitFor()
    expect(await album.locator('[data-msg^="out:"]').count()).toBe(2)
    await album.locator('img').first().evaluate((el) => ((el as HTMLElement & { mark?: number }).mark = 1))
    release()
    sending.hold = null
    await page.waitForFunction(() => !document.querySelector('[data-msg^="out:"]'))
    expect(await page.getByRole('group', { name: '2 pictures' }).last().locator('img').first().evaluate((el) => (el as HTMLElement & { mark?: number }).mark)).toBe(1)
    await page.close()
  }, 30_000)
  test("one that doesn't go through says so, survives a reload, and can be sent again or taken out", async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await page.goto(url())
    const box = page.getByRole('textbox', { name: /Message/ })
    await box.waitFor()
    sending.fail = true
    for (const t of ['First try', 'Never mind']) {
      await box.fill(t)
      await page.getByRole('button', { name: 'Send' }).click()
    }
    const alerts = page.getByRole('alert').filter({ hasText: 'Not sent' })
    await alerts.nth(1).waitFor()
    expect(await alerts.first().textContent()).toContain('herdr is not answering')
    // the words stay, after a reload too
    await page.reload()
    await bubbles(page, 'First try').waitFor()
    expect(await alerts.count()).toBe(2)
    // Remove takes one out; Retry sends the other, and it shows once, as the real message
    await alerts.nth(1).getByRole('button', { name: 'Remove' }).click()
    await bubbles(page, 'Never mind').waitFor({ state: 'detached' })
    sending.fail = false
    await alerts.first().getByRole('button', { name: 'Retry' }).click()
    await alerts.first().waitFor({ state: 'detached' })
    await settled(page, 'First try')
    expect(await page.evaluate(() => localStorage.getItem('shepherdr.outbox'))).toBeNull()
    await page.close()
  }, 30_000)
  test('one still on its way can be taken out from ⋯ beside it; a reload drops day-old ones', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(url())
    const box = page.getByRole('textbox', { name: /Message/ })
    await box.waitFor()
    let release!: () => void
    sending.hold = new Promise((r) => (release = r))
    await box.fill('Stuck one')
    await page.getByRole('button', { name: 'Send' }).click()
    await bubbles(page, 'Stuck one').waitFor()
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('shepherdr.outbox')!)[0])
    // ⋯ beside it, on hover, offers Remove (before a reload: that cuts the send off, and it fails)
    await bubbles(page, 'Stuck one').hover()
    await page.locator('[data-msg^="out:"]').getByRole('button', { name: 'More' }).click()
    await page.getByRole('menu', { name: 'Message' }).getByRole('menuitem', { name: 'Remove' }).click()
    await bubbles(page, 'Stuck one').waitFor({ state: 'detached' })
    expect(await page.evaluate(() => localStorage.getItem('shepherdr.outbox'))).toBeNull()
    // a day-old one, saved by an earlier visit, is gone after a reload (one for a chat that is gone too, but only with
    // every machine in reach, and this world has one out of reach: outbox.test.ts). Put in as the page loads: the send
    // the reload cuts off saves the outbox as it goes
    await page.addInitScript((o) => {
      const out = [{ ...o, cid: 'new', text: 'Just now', state: 'failed', error: 'Not sent.', at: Date.now() }, { ...o, cid: 'old', text: 'From yesterday', state: 'sent', at: Date.now() - 25 * 3_600_000 }]
      localStorage.setItem('shepherdr.outbox', JSON.stringify(out))
    }, saved)
    await page.reload()
    await bubbles(page, 'Just now').waitFor()
    expect(await bubbles(page, 'From yesterday').count()).toBe(0)
    release()
    sending.hold = null
    await page.close()
  }, 30_000)
})

describe.skipIf(!browser)('replies', () => {
  const strip = '[data-reply-strip]'
  test('on a phone a message slid right is replied to; the sent reply quotes it at once, and its quote jumps back to it', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await page.goto(url())
    const cdp = await ctx.newCDPSession(page)
    const slide = async (x: number, y: number, dx: number, dy: number) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 8, y: y + (dy * i) / 8 }] })
        await page.waitForTimeout(16)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(300)
    }
    await page.waitForSelector('[data-msg="long-agent"] [data-anchor]')
    await page.$eval('[data-msg="long-agent"]', (m) => m.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(300)
    const at = (await page.$eval('[data-msg="long-agent"] [data-anchor]', (b) => b.getBoundingClientRect().toJSON())) as Box
    // a short slide, or one mostly up and down, is nothing
    await slide(at.left + 40, at.top + 16, 30, 0)
    await slide(at.left + 40, at.top + 16, 40, 120)
    expect(await page.$(strip)).toBeNull()
    expect(await page.$('[role=dialog][aria-label=React]')).toBeNull()
    // far enough right: the box replies to it, and the message slides back
    await page.$eval('[data-msg="long-agent"]', (m) => m.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(300)
    const at2 = (await page.$eval('[data-msg="long-agent"] [data-anchor]', (b) => b.getBoundingClientRect().toJSON())) as Box
    await slide(at2.left + 40, at2.top + 16, 110, 6)
    await page.waitForSelector(`${strip}:has-text("It is the clock.")`)
    // a slide right on a message is a reply, never the places drawer coming out
    expect(await page.$eval('nav[aria-label=Spaces]', (n) => n.getBoundingClientRect().right)).toBeLessThanOrEqual(0)
    // one slim line inside the round box, over the words: it starts in line with the + icon, its x over send
    expect(await page.$(`[data-composer] ${strip}`)).not.toBeNull()
    expect(await page.$eval(strip, (b) => b.textContent)).toContain('Replying to home')
    // sent: the reply shows its quote at once, and the box lets the reply go
    let release!: () => void
    sending.hold = new Promise((r) => (release = r))
    await page.locator('textarea[name=message]').fill('Fix the clock then')
    const r = (sel: string) => page.$eval(sel, (b) => b.getBoundingClientRect().toJSON()) as Promise<Box & { width: number; height: number }>
    const [line, x, plus, send] = await Promise.all([r(`${strip} [role=button]`), r(`${strip} button`), r('[data-composer] button[aria-label="Attach files and more"] svg'), r('[data-composer] button[aria-label=Send]')])
    expect(line.height).toBeLessThanOrEqual(32)
    expect(Math.abs(line.left - plus.left)).toBeLessThanOrEqual(1.5)
    expect(Math.abs((x.left + x.right) / 2 - (send.left + send.right) / 2)).toBeLessThanOrEqual(1)
    expect(await page.$eval('[data-msg="long-agent"]', (m) => (m as HTMLElement).style.translate)).toBe('')
    expect(await page.$('[role=dialog][aria-label=React]')).toBeNull()
    await page.getByRole('button', { name: 'Send' }).click()
    const sent = page.locator('[data-you]').filter({ hasText: 'Fix the clock then' })
    await sent.locator('[data-quote][aria-label^="Replying to home"]').waitFor()
    expect(await page.$(strip)).toBeNull()
    // the quote is one line tucked under the top of the reply, and a long one doesn't stretch the short reply
    const [quote, reply] = await Promise.all([sent.locator('[data-quote]'), sent.locator('[data-anchor]')].map((l) => l.evaluate((el) => el.getBoundingClientRect().toJSON()) as Promise<Box & { width: number; height: number }>))
    expect(quote.height).toBeLessThanOrEqual(46)
    expect(quote.bottom).toBeGreaterThan(reply.top)
    expect(quote.bottom).toBeLessThan(reply.top + 12)
    expect(reply.width).toBeLessThan(quote.width)
    release()
    sending.hold = null
    await page.waitForFunction(() => [...document.querySelectorAll('[data-you]')].some((m) => m.textContent?.includes('Fix the clock then') && !m.getAttribute('data-msg')!.startsWith('out:')))
    // the real one keeps the quote; a tap on it brings the message it answers into view, lit up for a moment
    await page.evaluate(() => document.querySelector('[data-msg="tall-agent"]')!.scrollIntoView({ block: 'start' }))
    await page.locator('[data-you]').filter({ hasText: 'Fix the clock then' }).locator('[data-quote]').evaluate((b) => (b as HTMLElement).click())
    await page.waitForSelector('[data-msg="long-agent"] [data-anchor][data-flash]')
    await page.waitForTimeout(600)
    const box = (await page.$eval('[data-msg="long-agent"] [data-anchor]', (b) => b.getBoundingClientRect().toJSON())) as Box
    expect(box.top).toBeGreaterThan(0)
    expect(box.bottom).toBeLessThan(844)
    await page.waitForSelector('[data-msg="long-agent"] [data-anchor][data-flash]', { state: 'detached', timeout: 3000 })
    await ctx.close()
  }, 40_000)
  test('a card answered in the chat quotes that message under its line, and a tap on the quote jumps to it', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    const at = Date.now()
    const said = 'First thing I need is the flaky test rerun once, then skip it if it fails again'
    world.chats['p:vm-str:~'].messages.push(
      { id: 'card-q', who: 'agent', text: 'Rerun CI?', at, question: { id: 'ask:q', title: 'Rerun CI on main?', kind: 'Form', choices: [{ label: 'Rerun it' }, { label: 'Leave it' }], to: 'p:vm-str:~', sent: -1, said, via: 'chat' } },
      { id: 'card-a', who: 'you', text: said, at: at + 1 },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `card-f${i}`, who: 'agent' as const, text: `Filler ${i}\n\n${'More words here. '.repeat(12)}`, at: at + 2 + i })),
    )
    await page.goto(url())
    const quote = page.locator('[data-whole="card-q"] [data-card] [data-quote]')
    await quote.waitFor()
    // under the Answered in chat line, inside the card, in your own shade, and the line doesn't repeat the words
    expect(await page.locator('[data-whole="card-q"] [data-card]').textContent()).not.toContain('“')
    expect(await quote.getAttribute('aria-label')).toStartWith('Answered by You: First thing I need')
    await page.evaluate(() => document.querySelector('[data-whole="card-q"] [data-card] [data-quote]')!.scrollIntoView({ block: 'end' }))
    await page.evaluate(() => document.querySelector('[data-msg]')!.closest('.overflow-y-auto')!.scrollBy(0, -400))
    await quote.evaluate((b) => (b as HTMLElement).click())
    await page.waitForSelector('[data-msg="card-a"] [data-anchor][data-flash]')
    await page.waitForTimeout(600)
    const box = (await page.$eval('[data-msg="card-a"] [data-anchor]', (b) => b.getBoundingClientRect().toJSON())) as Box
    expect(box.top).toBeGreaterThan(0)
    expect(box.bottom).toBeLessThan(844)
    world.chats['p:vm-str:~'].messages = world.chats['p:vm-str:~'].messages.filter((m) => !m.id.startsWith('card-'))
    await page.close()
  }, 30_000)
  test('with a mouse, the reply arrow beside a message replies (a file too); Esc drops the reply', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(url())
    const bubble = await page.waitForSelector('[data-msg="long-you"] [data-anchor]')
    await bubble.hover()
    await page.click('[data-msg="long-you"] button[aria-label=Reply]')
    await page.waitForSelector(`${strip}:has-text("Can you look at the flaky test")`)
    expect(await page.$eval(strip, (b) => b.textContent)).toContain('Replying to You Can you look')
    expect(await page.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('message')
    await page.keyboard.press('Escape')
    await page.waitForSelector(strip, { state: 'detached' })
    // Esc again lets the box go
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => document.activeElement?.getAttribute('name'))).not.toBe('message')
    // a file can be replied to as well
    await page.hover('[data-msg="heic-you"] [data-anchor]')
    await page.click('[data-msg="heic-you"] button[aria-label="Reply to photo.heic"]')
    await page.waitForSelector(`${strip}:has-text("photo.heic")`)
    await page.keyboard.press('Escape')
    await page.close()
  }, 30_000)
  test('a long quote over a short reply reaches past it, and the reply keeps its reactions and buttons by it', async () => {
    const long = world.chats['p:vm-str:~'].messages.find((m) => m.id === 'long-you')!
    const quote = { id: long.id, who: 'you' as const, text: long.text! }
    world.chats['p:vm-str:~'].messages.push(
      { id: 'quoted-ok', who: 'agent', text: 'OK', at: Date.now(), reply: quote, reactions: [{ emoji: '👍', by: 'me' }] },
      { id: 'quoted-file', who: 'you', file: { name: 'clock.log', path: '~/inbox/x-clock.log' }, at: Date.now() + 1, reply: quote },
    )
    ;(world as unknown as { emit(e: string, k: string): void }).emit('chat', 'p:vm-str:~')
    for (const scheme of ['light', 'dark'] as const) {
      const page = await browser!.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: scheme })
      await page.goto(url())
      const msg = page.locator('[data-msg="quoted-ok"]')
      await msg.locator('[data-quote]').waitFor()
      await msg.hover()
      const rect = (l: ReturnType<typeof page.locator>) => l.evaluate((el) => el.getBoundingClientRect().toJSON()) as Promise<Box & { width: number; height: number }>
      const [unit, bubble, q, pill, reply] = await Promise.all([msg, msg.locator('[data-anchor]'), msg.locator('[data-quote]'), msg.locator('button:has-text("👍")'), msg.locator('button[aria-label=Reply]')].map(rect))
      // the message is as wide as its bubble; the quote reaches past it toward the middle, its words in the part that shows
      expect(Math.abs(unit.width - bubble.width)).toBeLessThan(1)
      expect(q.width).toBeGreaterThan(bubble.width * 2)
      expect(Math.abs(q.left - bubble.left - 8)).toBeLessThan(1)
      expect(q.bottom - bubble.top).toBeGreaterThan(4)
      // the reaction sits on the bubble's corner and the reply arrow right beside it
      expect(pill.left).toBeLessThan(bubble.right)
      expect(reply.left - bubble.right).toBeLessThan(60)
      // a file reply carries the quote too, the tile over it; in the shade of the message it quotes, not the page's
      const file = page.locator('[data-msg="quoted-file"]')
      const [fq, tile] = await Promise.all([file.locator('[data-quote]'), file.locator('[data-anchor]')].map(rect))
      expect(fq.bottom).toBeGreaterThan(tile.top)
      const shade = await file.locator('[data-quote]').evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(shade).not.toBe(await page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      await page.close()
    }
    world.chats['p:vm-str:~'].messages = world.chats['p:vm-str:~'].messages.filter((m) => !m.id.startsWith('quoted-'))
    ;(world as unknown as { emit(e: string, k: string): void }).emit('chat', 'p:vm-str:~')
  }, 30_000)
})

describe.skipIf(!browser)('what the best chats do', () => {
  test('a code block copies from its corner, a bit of code copies when tapped, and links open in a new tab', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await ctx.newPage()
    await page.goto(url())
    const msg = page.locator('[data-msg="code-agent"]')
    await msg.waitFor()
    expect(await msg.locator('a').getAttribute('target')).toBe('_blank')
    expect(await msg.locator('a').getAttribute('rel')).toContain('noopener')
    await msg.getByRole('button', { name: 'Copy code' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('bun run check')
    // it says so, to a screen reader too
    expect(await msg.getByRole('button', { name: 'Copied' }).getAttribute('data-copied')).toBe('')
    await msg.locator('code[data-copy]').first().click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('bun test')
    // markup inside a title or picture text stays text: nothing in a reply can become a live element
    world.chats['p:vm-str:~'].messages.push({ id: 'hostile', who: 'agent', text: '[x](http://a "<code><img src=x onerror=alert(1)>") ![a <pre>](http://b) `ok`', at: Date.now() })
    ;(world as unknown as { emit(e: string, k: string): void }).emit('chat', 'p:vm-str:~')
    await page.locator('[data-msg="hostile"]').waitFor()
    expect(await page.locator('[data-msg="hostile"] [onerror], [data-msg="hostile"] .code').count()).toBe(0)
    expect(await page.locator('[data-msg="hostile"] code[data-copy]').count()).toBe(1)
    // a link's title is no tooltip
    expect(await page.locator('[data-msg="hostile"] [title]').count()).toBe(0)
    world.chats['p:vm-str:~'].messages = world.chats['p:vm-str:~'].messages.filter((m) => m.id !== 'hostile')
    ;(world as unknown as { emit(e: string, k: string): void }).emit('chat', 'p:vm-str:~')
    await ctx.close()
  }, 30_000)
  test('a long reply folds to Show more and opens; days get a line; a finger sliding left shows the times', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await page.goto(url())
    const tall = page.locator('[data-msg="tall-agent"]')
    await tall.waitFor()
    const more = tall.getByRole('button', { name: 'Show more' })
    expect((await tall.locator('[data-anchor]').boundingBox())!.height).toBeLessThan(420)
    await more.evaluate((b) => (b as HTMLElement).click())
    await tall.getByRole('button', { name: 'Show less' }).waitFor()
    expect((await tall.locator('[data-anchor]').boundingBox())!.height).toBeGreaterThan(900)
    await tall.getByRole('button', { name: 'Show less' }).evaluate((b) => (b as HTMLElement).click())
    expect(await page.getByText('Today', { exact: true }).count()).toBe(1)
    // slide a message left: the chat follows the finger and every time comes in at the right
    await page.$eval('[data-msg="long-agent"]', (m) => m.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(300)
    const at = (await page.$eval('[data-msg="long-agent"] [data-anchor]', (b) => b.getBoundingClientRect().toJSON())) as Box
    const cdp = await ctx.newCDPSession(page)
    const [x, y] = [at.left + 200, at.top + 16]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - i * 12, y }] })
    await page.waitForTimeout(50)
    const time = page.locator('[data-msg="long-agent"]').locator('xpath=../..').locator('time')
    const t = (await time.boundingBox())!
    expect(t.x + t.width).toBeLessThanOrEqual(390)
    expect(await time.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(400)
    expect(await time.evaluate((el) => getComputedStyle(el).opacity)).toBe('0')
    expect(await page.$('[data-reply-strip]')).toBeNull()
    await ctx.close()
  }, 30_000)
  test('scrolled up, an arrow counts the new replies and jumps down; a New line marks where they begin', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(url())
    await page.waitForSelector('[data-msg="short-agent"]')
    await page.$eval('[data-msg="tall-agent"] button[aria-expanded=false]', (b) => (b as HTMLElement).click())
    await page.$eval('[data-msg="tall-agent"]', (m) => m.scrollIntoView({ block: 'start' }))
    const jump = page.getByRole('button', { name: /jump to the latest/i })
    await jump.waitFor()
    expect(await jump.getAttribute('aria-label')).toBe('Jump to the latest')
    world.chats['p:vm-str:~'].messages.push({ id: 'news-1', who: 'agent', text: 'GTM-15 is merged.', at: Date.now() })
    ;(world as unknown as { emit(e: string, k: string): void }).emit('chat', 'p:vm-str:~')
    await page.waitForFunction(() => document.querySelector('button[aria-label$="jump to the latest" i]')?.getAttribute('aria-label')?.startsWith('1 new'))
    expect(await page.$eval('[data-new-line] + *', (el) => !!el.querySelector('[data-msg="news-1"]'))).toBe(true)
    await jump.click()
    await jump.waitFor({ state: 'detached' })
    // it eases down to the newest
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-msg]')!.closest('.overflow-y-auto')!
      return el.scrollHeight - el.scrollTop - el.clientHeight < 4
    })
    await page.close()
  }, 30_000)
  test('search in a chat finds words, newest first, steps through them and marks them', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(url())
    await page.waitForSelector('[data-msg="long-agent"]')
    await page.getByRole('button', { name: /^Menu/ }).click()
    await page.getByRole('menuitem', { name: 'Search in this chat' }).click()
    const input = page.getByRole('searchbox', { name: 'Search in this chat' })
    expect(await input.evaluate((el) => el === document.activeElement)).toBe(true)
    await input.fill('clock')
    const status = page.locator('[role=search] [role=status]')
    await page.waitForFunction(() => /^\d+ of \d+$/.test(document.querySelector('[role=search] [role=status]')?.textContent ?? ''))
    const [n, of] = (await status.textContent())!.split(' of ').map(Number)
    expect(n).toBe(of)
    expect(of).toBeGreaterThanOrEqual(2)
    await page.waitForSelector('[data-anchor][data-flash]')
    await input.press('Enter')
    expect(await status.textContent()).toBe(`${of - 1} of ${of}`)
    expect(await page.evaluate(() => (CSS as unknown as { highlights: Map<string, { size: number }> }).highlights.get('find')?.size ?? 0)).toBeGreaterThanOrEqual(2)
    // a new reply that matches doesn't move you off the match you stepped to
    const looked = await status.textContent()
    world.chats['p:vm-str:~'].messages.push({ id: 'clock-news', who: 'agent', text: 'The clock fix is merged.', at: Date.now() })
    ;(world as unknown as { emit(e: string, k: string): void }).emit('chat', 'p:vm-str:~')
    await page.waitForFunction((n) => document.querySelector('[role=search] [role=status]')?.textContent?.endsWith(`of ${n}`), of + 1)
    expect(await status.textContent()).toBe(looked!.replace(/of \d+/, `of ${of + 1}`))
    // closed, the marks go
    await input.press('Escape')
    await page.getByRole('search').waitFor({ state: 'detached' })
    expect(await page.evaluate(() => (CSS as unknown as { highlights: Map<string, unknown> }).highlights.has('find'))).toBe(false)
    await page.getByRole('button', { name: /^Menu/ }).click()
    await page.getByRole('menuitem', { name: 'Search in this chat' }).click()
    await input.fill('zzz nothing')
    await page.waitForFunction(() => document.querySelector('[role=search] [role=status]')?.textContent === 'No matches')
    await page.getByRole('button', { name: 'Close search' }).click()
    await page.getByRole('search').waitFor({ state: 'detached' })
    await page.close()
  }, 30_000)
  for (const [name, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['tablet', { width: 900, height: 800 }],
    ['desktop', { width: 1600, height: 900 }],
  ] as const)
    test(`a task's chat searches from its ⋯ menu, first, like a coordinator's; no search button of its own (${name})`, async () => {
      const page = await browser!.newPage({ viewport, hasTouch: name === 'phone', isMobile: name === 'phone' })
      await page.goto(`http://127.0.0.1:${server!.port}/?place=p:vm-str:gtm&task=GTM-14`)
      const more = page.getByRole('button', { name: 'More', exact: true })
      await more.waitFor()
      expect(await page.getByRole('button', { name: 'Search in this chat' }).count()).toBe(0)
      await more.click()
      const rows = page.getByRole('menu', { name: 'More' }).getByRole('menuitem')
      expect(await rows.first().textContent()).toBe('Search in this chat')
      await rows.first().click()
      await page.getByRole('menu').waitFor({ state: 'detached' })
      const input = page.getByRole('searchbox', { name: 'Search in this chat' })
      expect(await input.evaluate((el) => el === document.activeElement)).toBe(true)
      await input.press('Escape')
      await page.getByRole('search').waitFor({ state: 'detached' })
      await page.close()
    }, 30_000)
})


describe.skipIf(!browser)('held messages', () => {
  test('an ordinary message never shows a waiting note, on phone or desktop', async () => {
    for (const [i, width] of [390, 1440].entries()) {
      const page = await browser!.newPage({ viewport: { width, height: 844 } })
      let release = () => {}
      try {
        await page.goto(url())
        const box = page.getByRole('textbox', { name: /Message/ })
        await box.waitFor()
        await page.evaluate(() => {
          const look = () => {
            const said = [...document.querySelectorAll('[data-you]')].some((el) => /Goes in once|Waiting for your answer/.test(el.textContent ?? ''))
            if (said) (window as Window & { noted?: boolean }).noted = true
          }
          new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true })
        })
        sending.hold = new Promise((r) => (release = r))
        await box.fill(`Nothing holds this ${i}`)
        await page.getByRole('button', { name: 'Send' }).click()
        await page.locator('[data-you] [data-anchor]').filter({ hasText: `Nothing holds this ${i}` }).waitFor()
        release()
        sending.hold = null
        await page.waitForFunction(
          (t) => [...document.querySelectorAll('[data-you] [data-anchor]')].some((e) => e.textContent === t && !e.closest('[data-msg]')!.getAttribute('data-msg')!.startsWith('out:')),
          `Nothing holds this ${i}`,
        )
        expect(await page.evaluate(() => !!(window as Window & { noted?: boolean }).noted)).toBe(false)
      } finally {
        release()
        sending.hold = null
        await page.close()
      }
    }
  }, 30_000)
  test('links to the blocking question without answering or offering Send now', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    try {
      await page.goto(`${url()}&task=GTM-14`)
      const held = page.locator('[data-msg]').filter({ hasText: 'Also update the README.' })
      await held.getByText('Waiting for your answer above.', { exact: false }).waitFor()
      const link = held.getByRole('button', { name: 'Go to question' })
      await link.click()
      expect(await page.locator('[data-flash]').textContent()).toContain('Allow: rm -rf template/skills/old?')
      expect(await page.getByRole('button', { name: 'Send now', exact: true }).count()).toBe(0)
      expect(world.chat('GTM-14/Agent').messages.find((m) => m.question?.id === 'f4')?.question?.sent).toBeUndefined()
      expect(await held.isVisible()).toBe(true)
    } finally {
      await page.close()
    }
  })
})
