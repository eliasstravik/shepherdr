// Reactions, scrollbars and typing dots as a phone and a computer draw them, in a real browser (layout.ts).
import { describe, expect, test } from 'bun:test'
import { cardMessage, type UpdateCard } from '../shared/types.ts'
import { layout, pills, settled, type Box } from './layout.ts'

const { browser, world, url } = await layout()

describe.skipIf(!browser)('reactions on a phone', () => {
  test('reactions sit on the bubble\'s bottom right corner and stay on screen, yours and the agent\'s', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(url())
    await page.waitForFunction((sel) => document.querySelectorAll(sel).length >= 6, pills('short-agent'))
    const at = (id: string) =>
      page.$eval(`[data-msg="${id}"]`, (m) => ({
        bubble: m.querySelector('[data-anchor]')!.getBoundingClientRect().toJSON() as Box,
        pills: [...m.querySelectorAll('button[aria-pressed][data-keep-box]')].map((p) => p.getBoundingClientRect().toJSON() as Box),
      }))
    // on a long bubble, the last pill ends just inside its right edge and overlaps its bottom
    for (const id of ['long-you', 'long-agent']) {
      const { bubble, pills } = await at(id)
      const last = pills.at(-1)!
      expect(Math.abs(bubble.right - 10 - last.right)).toBeLessThan(3)
      expect(last.top).toBeLessThan(bubble.bottom)
      expect(last.bottom).toBeGreaterThan(bubble.bottom)
    }
    // six pills on a two-letter bubble grow toward the middle, never off the screen
    for (const id of ['short-you', 'short-agent']) {
      const { pills } = await at(id)
      expect(pills.length).toBe(6)
      for (const box of pills) {
        expect(box.left).toBeGreaterThanOrEqual(0)
        expect(box.right).toBeLessThanOrEqual(390)
      }
    }
    await page.close()
  }, 30_000)

  test('holding a message opens the bar; + opens every emoji; a pill tapped takes yours back', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await page.goto(url())
    await page.waitForSelector('[data-msg="long-agent"] [data-anchor]')
    const cdp = await ctx.newCDPSession(page)
    const touch = async (x: number, y: number, ms: number) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await page.waitForTimeout(ms)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    const box = (await page.$eval('[data-msg="long-agent"] [data-anchor]', (b) => b.getBoundingClientRect().toJSON())) as Box
    const dialog = '[role=dialog][aria-label=React]'
    const gone = () => page.waitForSelector(dialog, { state: 'detached' })
    // a quick tap is only a tap
    await touch(box.left + 30, box.top + 16, 60)
    await page.waitForTimeout(400)
    expect(await page.$(dialog)).toBeNull()
    // a finger landing on a chat that is still scrolling stops it, it doesn't open anything
    await page.evaluate(() => {
      document.dispatchEvent(new Event('touchend'))
      document.dispatchEvent(new Event('scroll'))
    })
    await touch(box.left + 30, box.top + 16, 600)
    await page.waitForTimeout(300)
    expect(await page.$(dialog)).toBeNull()
    // the chat following a reply as it comes in doesn't count
    await page.waitForTimeout(300)
    await page.evaluate(() => document.dispatchEvent(new Event('scroll')))
    await touch(box.left + 30, box.top + 16, 600)
    await page.waitForSelector(dialog, { state: 'visible' })
    await page.keyboard.press('Escape')
    await gone()
    // held down, the bubble eases in before it opens: how far it shrank while pressed, watched from the page itself
    // (the press lasts a moment, too short to catch from here on a busy machine)
    await page.$eval('[data-msg="long-agent"] [data-anchor]', (b) => {
      const w = window as unknown as { press: { on: boolean; scale: number; open: boolean } }
      w.press = { on: false, scale: 1, open: false }
      const look = () => {
        if (!b.hasAttribute('data-pressing')) return
        w.press.on = true
        w.press.open ||= !!document.querySelector('[role=dialog][aria-label=React]')
        if (!w.press.open) w.press.scale = Math.min(w.press.scale, Number(getComputedStyle(b).scale))
      }
      new MutationObserver(look).observe(b, { attributes: true })
      setInterval(look, 10)
    })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.left + 30, y: box.top + 16 }] })
    // it lifts out of a blurred chat while still held: emoji above it, Reply, Copy and Select text below, all on screen
    await page.waitForSelector(dialog, { state: 'visible' })
    const pressed = await page.evaluate(() => (window as unknown as { press: { on: boolean; scale: number } }).press)
    expect(pressed.on).toBe(true)
    expect(pressed.scale).toBeLessThan(1)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(500)
    const lifted = async () =>
      page.$eval(dialog, (d) => {
        const r = (el: Element | null) => el!.getBoundingClientRect().toJSON()
        return {
          row: r(d.querySelector('[aria-label=Reactions]')),
          copy: r(d.querySelector('[aria-hidden=true].absolute.overflow-hidden')),
          menu: d.querySelector('[role=menu]') ? r(d.querySelector('[role=menu]')) : null,
          blur: getComputedStyle(d.firstElementChild!).backdropFilter,
        }
      })
    const open = await lifted()
    expect(open.blur).toContain('blur')
    expect(open.row.bottom).toBeLessThanOrEqual(open.copy.top)
    expect(open.menu!.top).toBeGreaterThanOrEqual(open.copy.bottom)
    for (const b of [open.row, open.copy, open.menu!]) {
      expect(b.top).toBeGreaterThanOrEqual(0)
      expect(b.bottom).toBeLessThanOrEqual(844)
      expect(b.left).toBeGreaterThanOrEqual(0)
      expect(b.right).toBeLessThanOrEqual(390)
    }
    // the agent's message stays on its left, the bar on that side too
    expect(Math.abs(open.copy.left - box.left)).toBeLessThan(2)
    expect(Math.abs(open.row.left - box.left)).toBeLessThan(2)
    expect(await page.$eval('[data-msg="long-agent"] [data-anchor]', (b) => getComputedStyle(b).visibility)).toBe('hidden')
    for (const item of ['Reply', 'Copy', 'Select text']) expect(await page.$(`[role=menuitem]:has-text("${item}")`)).not.toBeNull()
    // the finger lifting off didn't close it; a tap on 🙌 reacts and sets the message back down
    await page.tap('button[aria-label="React 🙌"]')
    await page.waitForSelector(`${pills('long-agent')}[aria-label^="🙌"]`)
    await gone()
    expect(await page.$eval('[data-msg="long-agent"] [data-anchor]', (b) => getComputedStyle(b).visibility)).toBe('visible')
    // a tap outside sets it down too
    await touch(box.left + 30, box.top + 16, 600)
    await page.waitForSelector(dialog, { state: 'visible' })
    await page.waitForTimeout(450)
    await page.touchscreen.tap(195, 30)
    await gone()
    // a message taller than the screen (folded, opened with Show more): the part held shows, with everything still on screen
    await page.$eval('[data-msg="tall-agent"] button[aria-expanded=false]', (b) => (b as HTMLElement).click())
    await page.$eval('[data-msg="tall-agent"]', (m) => m.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(350)
    await touch(100, 500, 600)
    await page.waitForSelector(dialog, { state: 'visible' })
    await page.waitForTimeout(500)
    const tall = await lifted()
    for (const b of [tall.row, tall.copy, tall.menu!]) {
      expect(b.top).toBeGreaterThanOrEqual(0)
      expect(b.bottom).toBeLessThanOrEqual(844)
    }
    expect(tall.row.bottom).toBeLessThanOrEqual(tall.copy.top)
    expect(tall.menu!.top).toBeGreaterThanOrEqual(tall.copy.bottom)
    await page.keyboard.press('Escape')
    await gone()
    // a short screen (the keyboard up, so no bottom bar): the message shrinks so every emoji stays on it; shorter still, the menu gives way
    const noBar = await page.addStyleTag({ content: 'div:has(> [aria-label="View"]) { display: none }' })
    for (const [h, menu] of [
      [300, true],
      [240, false],
    ] as const) {
      await page.evaluate((h) => document.documentElement.style.setProperty('--app-h', `${h}px`), h)
      await page.$eval('[data-msg="tall-agent"]', (m) => m.scrollIntoView({ block: 'start' }))
      await page.waitForTimeout(350)
      // the middle of what shows of it, between the header and the message box
      const y = await page.$eval('[data-msg="tall-agent"] [data-anchor]', (a) => {
        let s = a.parentElement!
        while (getComputedStyle(s).overflowY !== 'auto') s = s.parentElement!
        const v = s.getBoundingClientRect()
        const b = a.getBoundingClientRect()
        return (Math.max(v.top, b.top) + Math.min(v.bottom, b.bottom)) / 2
      })
      await touch(100, y, 600)
      await page.waitForSelector(dialog, { state: 'visible' })
      await page.waitForTimeout(500)
      const short = await page.$eval(dialog, (d) => {
        const r = (el: Element) => el.getBoundingClientRect().toJSON()
        const m = d.querySelector('[role=menu]')!
        return {
          emoji: [...d.querySelectorAll('[aria-label=Reactions] button')].map(r),
          copy: r(d.querySelector('[aria-hidden=true].absolute.overflow-hidden')!),
          menu: getComputedStyle(m).display === 'none' ? null : r(m),
        }
      })
      expect(short.emoji.length).toBe(7)
      for (const b of short.emoji) {
        expect(b.top).toBeGreaterThanOrEqual(0)
        expect(b.bottom).toBeLessThanOrEqual(h)
      }
      expect(short.copy.height).toBeGreaterThan(0)
      expect(short.copy.top).toBeGreaterThanOrEqual(short.emoji[0].bottom)
      expect(short.copy.bottom).toBeLessThanOrEqual(h)
      expect(!!short.menu).toBe(menu)
      if (short.menu) expect(short.menu.bottom).toBeLessThanOrEqual(h)
      await page.keyboard.press('Escape')
      await gone()
    }
    await noBar.evaluate((tag) => (tag as Element).remove())
    await page.evaluate(() => document.documentElement.style.setProperty('--app-h', '844px'))
    await page.$eval('[data-msg="long-agent"]', (m) => m.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(350)
    const at = (await page.$eval('[data-msg="long-agent"] [data-anchor]', (b) => b.getBoundingClientRect().toJSON())) as Box
    const hold = () => touch(at.left + 30, at.top + 16, 600)
    // Reply shows what it answers over the box, and the box takes the typing
    await hold()
    await page.tap('[role=menuitem]:has-text("Reply")')
    const box2 = page.locator('textarea[name=message]')
    await page.waitForSelector('[data-reply-strip]:has-text("It is the clock.")')
    expect(await box2.inputValue()).toBe('')
    expect(await box2.evaluate((el) => el === document.activeElement)).toBe(true)
    await page.tap('button[aria-label="Cancel reply"]')
    await page.waitForSelector('[data-reply-strip]', { state: 'detached' })
    await box2.blur()
    // + opens every emoji as a sheet: search, pick with Enter
    await page.waitForTimeout(350)
    await hold()
    await page.tap('button[aria-label="More emoji"]')
    await page.waitForSelector('section[aria-label="Smileys & people"]')
    const sheet = '[role=dialog][aria-label="Pick an emoji"]'
    // with the keyboard up, the sheet sits on what is left of the screen, search and results above the keyboard
    await page.evaluate(() => document.documentElement.style.setProperty('--app-h', '400px'))
    await page.waitForTimeout(400)
    const up = (await page.$eval(sheet, (d) => d.getBoundingClientRect().toJSON())) as Box
    expect(up.bottom).toBeLessThanOrEqual(401)
    expect(up.top).toBeGreaterThanOrEqual(40)
    await page.evaluate(() => document.documentElement.style.setProperty('--app-h', '844px'))
    await page.waitForTimeout(400)
    expect(((await page.$eval(sheet, (d) => d.getBoundingClientRect().toJSON())) as Box).bottom).toBeGreaterThan(840)
    await page.fill('input[name=emoji-search]', 'rocket')
    await page.press('input[name=emoji-search]', 'Enter')
    const rocket = await page.waitForSelector(`${pills('long-agent')}[aria-label^="🚀"]`)
    // frequently used comes first next time, and in the quick row
    await page.waitForTimeout(350)
    await hold()
    expect(await page.$('[aria-label=Reactions] button[aria-label="React 🚀"]')).not.toBeNull()
    await page.tap('button[aria-label="More emoji"]')
    await page.waitForSelector('section[aria-label="Frequently used"] button[aria-label="rocket"]')
    await page.keyboard.press('Escape')
    // a pill tapped takes yours back, like Slack
    await rocket.tap()
    await page.waitForFunction((sel) => !document.querySelector(sel), `${pills('long-agent')}[aria-label^="🚀"]`)
    // Select text lets the finger select: the message's text is selected, and a hold no longer opens the bar
    await page.waitForTimeout(350)
    await hold()
    await page.tap('[role=menuitem]:has-text("Select text")')
    await gone()
    expect(await page.evaluate(() => getSelection()?.toString())).toContain('It is the clock.')
    expect(await page.$eval('[data-msg="long-agent"] [data-anchor]', (b) => getComputedStyle(b).userSelect)).not.toBe('none')
    await ctx.close()
  }, 60_000)
})

describe.skipIf(!browser)('reactions with reduced motion', () => {
  test('a hold still opens everything, without the bubble shrinking or flying', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce', colorScheme: 'dark' })
    const page = await ctx.newPage()
    await page.goto(url())
    const bubble = await page.waitForSelector('[data-msg="long-agent"] [data-anchor]')
    await page.waitForTimeout(400)
    const b = (await bubble.boundingBox())!
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + 30, y: b.y + 16 }] })
    await page.waitForTimeout(330)
    expect(await bubble.evaluate((el) => getComputedStyle(el).scale)).toBe('none')
    await page.waitForTimeout(200)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const lift = await page.waitForSelector('[role=dialog][aria-label=React] .overflow-hidden', { state: 'visible' })
    expect(await lift.evaluate((el) => el.getAnimations().length)).toBe(0)
    expect(await page.$('[role=menuitem]:has-text("Reply")')).not.toBeNull()
    await ctx.close()
  }, 30_000)
})

describe.skipIf(!browser)('reactions with a mouse', () => {
  test('a smiley shows beside a message on hover and opens the bar; text still selects', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(url())
    const bubble = await page.waitForSelector('[data-msg="long-agent"] [data-anchor]')
    const smiley = await page.$('[data-msg="long-agent"] button[aria-label=React]')
    // the smiley and the reply arrow show together
    expect(await smiley!.evaluate((b) => getComputedStyle(b.parentElement!).opacity)).toBe('0')
    await bubble.hover()
    await page.waitForFunction((b) => getComputedStyle(b!.parentElement!).opacity === '1', smiley)
    expect(await page.$('[data-msg="long-agent"] button[aria-label=Reply]')).not.toBeNull()
    // a click on the bubble opens nothing: dragging across it selects its text
    const b = (await bubble.boundingBox())!
    await page.mouse.move(b.x + 20, b.y + 18)
    await page.mouse.down()
    await page.mouse.move(b.x + 200, b.y + 18, { steps: 5 })
    await page.mouse.up()
    expect((await page.evaluate(() => getSelection()?.toString() ?? '')).length).toBeGreaterThan(5)
    expect(await page.$('[role=dialog][aria-label=React]')).toBeNull()
    await smiley!.click()
    await page.waitForSelector('[role=dialog][aria-label=React]', { state: 'visible' })
    await page.click('button[aria-label="More emoji"]')
    // beside the message, not a sheet; the search takes the typing
    const picker = await page.waitForSelector('[role=dialog][aria-label="Pick an emoji"]', { state: 'visible' })
    expect((await picker.boundingBox())!.width).toBeLessThan(400)
    expect(await page.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('emoji-search')
    await page.keyboard.press('Escape')
    expect(await page.$('[role=dialog][aria-label="Pick an emoji"]')).toBeNull()
    await page.close()
  }, 30_000)
})

describe.skipIf(!browser)('scrollbars', () => {
  test('a list being scrolled shows its scrollbar, and hides it a moment after it stops', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 400 } })
    await page.goto(url())
    const list = await page.waitForSelector('[data-msg="long-you"]').then((m) => m.evaluateHandle((m) => m.closest('.overflow-y-auto')!))
    await page.waitForFunction((l) => !l.hasAttribute('data-scrolling'), list)
    await list.evaluate((l) => l.scrollBy(0, -100))
    await page.waitForFunction((l) => l.hasAttribute('data-scrolling'), list)
    await page.waitForFunction((l) => !l.hasAttribute('data-scrolling'), list, { timeout: 3000 })
    await page.close()
  }, 30_000)
})

describe.skipIf(!browser)('typing dots', () => {
  const working = (on: boolean) => {
    world.chats['p:vm-str:~'].working = on || undefined
    world.emit('chat', 'p:vm-str:~')
  }
  const dots = '[role=status].typing'
  for (const [name, opts] of [
    ['phone, dark, reduced motion', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce', colorScheme: 'dark' }],
    ['desktop, light', { viewport: { width: 1280, height: 800 }, colorScheme: 'light' }],
  ] as const)
    test(`show at the bottom on the agent's side while it works, and go when it stops (${name})`, async () => {
      const ctx = await browser!.newContext(opts)
      const page = await ctx.newPage()
      await page.goto(url())
      await page.waitForSelector('[data-msg="short-agent"]')
      expect(await page.$(dots)).toBeNull()
      // at the bottom, the dots come into view under the last message
      working(true)
      const el = await page.waitForSelector(dots, { state: 'visible' })
      await page.waitForTimeout(400)
      const box = (await el.boundingBox())!
      const last = (await page.$eval('[data-msg="short-agent"]', (m) => m.getBoundingClientRect().toJSON())) as { left: number; bottom: number }
      expect(box.y).toBeGreaterThan(last.bottom)
      expect(Math.abs(box.x - last.left)).toBeLessThan(2)
      expect(box.y + box.height).toBeLessThanOrEqual(opts.viewport.height)
      expect(await el.innerText()).toContain('is working')
      // the agent's bubble shade and mirrored corners
      expect(await el.evaluate((d) => getComputedStyle(d).borderBottomLeftRadius)).toBe('6px')
      const moving = await el.evaluate((d) => [...d.querySelectorAll('i')].map((i) => getComputedStyle(i).animationName))
      expect(moving).toEqual(opts.reducedMotion === 'reduce' ? ['none', 'none', 'none'] : ['typing', 'typing', 'typing'])
      working(false)
      await page.waitForSelector(dots, { state: 'detached' })
      // scrolled up to read, the dots don't move what you read
      const top = await page.$eval('[data-msg="tall-agent"]', (m) => {
        const box = m.closest('.overflow-y-auto')!
        box.scrollTop = 200
        return box.scrollTop
      })
      await page.waitForTimeout(100)
      working(true)
      await page.waitForSelector(dots, { state: 'attached' })
      await page.waitForTimeout(300)
      expect(await page.$eval('[data-msg="tall-agent"]', (m) => m.closest('.overflow-y-auto')!.scrollTop)).toBe(top)
      working(false)
      await page.waitForSelector(dots, { state: 'detached' })
      await ctx.close()
    }, 30_000)
})

describe.skipIf(!browser)('a news card', () => {
  // every kind of news card: one line of a few words, the PR link set apart on it, never a summary under it
  const pr = { number: 40, url: 'https://github.com/x/y/pull/40' }
  const said = `Failed enrichments now retry on their own: ${'three tries with a growing wait, each logged in the run, '.repeat(4)}and that is all.`
  const cards: UpdateCard[] = [
    { id: 'pr-ready', task: 'SHE-115', status: 'ready', text: 'is ready to merge', pr },
    { id: 'pr-need', task: 'SHE-116', status: 'need', text: 'needs you: Asks which colour to use', pr },
    { id: 'pr-wrong', task: 'SHE-117', status: 'need', text: `needs you: Went wrong: ${'the check failed on main twice and then once more '.repeat(3)}`, pr },
    { id: 'pr-stalled', task: 'SHE-118', status: 'work', text: 'may be stuck: quiet for 25m' },
    // a card posted before cards went to one line still carries its summary: it doesn't show
    { id: 'pr-merged', task: 'SHE-119', status: 'done', text: 'is merged', detail: `${said} Facts: PR #40 · commit 1a2b3c4`, pr } as UpdateCard,
    { id: 'pr-closed', task: 'SHE-120', status: 'done', text: 'is done, nothing to merge' },
    { id: 'pr-red', red: 'main', text: 'went red: Check failed' },
    { id: 'pr-health', health: { level: 'over', machine: 'vm-str' }, text: 'CPU load is high: 9.1' },
  ]
  for (const width of [390, 1280])
    test(`is one line, its words cut short where they don't fit, at ${width} px`, async () => {
      if (!world.chats['p:vm-str:~'].messages.some((m) => m.id === 'pr-ready')) world.chats['p:vm-str:~'].messages.push(...cards.map((c) => cardMessage(c, Date.now() - 20)))
      const page = await browser!.newPage({ viewport: { width, height: 844 } })
      await page.goto(url())
      await page.waitForSelector('[data-msg="pr-health"] [data-anchor]')
      // Every update starts visible in the normal chat stream.
      expect(await page.getByText(/^Task updates ·/).count()).toBe(0)
      for (const c of cards) expect(await page.locator(`[data-msg="${c.id}"]`).isVisible()).toBe(true)
      for (const c of cards) {
        const got = await page.$eval(`[data-msg="${c.id}"]`, (m) => {
          const card = m.querySelector('[data-anchor]') as HTMLElement
          const link = card.querySelector('[data-pr]')
          const words = card.querySelector('b')!.parentElement!
          const line = parseFloat(getComputedStyle(words).lineHeight)
          return {
            text: card.innerText.replace(/\s+/g, ' ').trim(),
            cut: words.scrollWidth > words.clientWidth,
            words: words.getBoundingClientRect().height,
            line,
            link: link?.getBoundingClientRect().toJSON() as Box | undefined,
            box: card.getBoundingClientRect().toJSON() as Box,
          }
        })
        expect(got.words).toBeLessThanOrEqual(got.line + 1)
        expect(got.text).not.toContain('retry')
        expect(got.text).not.toContain('Facts')
        if (c.pr) {
          expect(got.text).toEndWith('· PR #40')
          expect(got.link!.right).toBeLessThanOrEqual(got.box.right)
          expect(got.link!.top).toBeGreaterThanOrEqual(got.box.top)
          expect(got.link!.bottom).toBeLessThanOrEqual(got.box.bottom)
        }
        if (c.id === 'pr-wrong') expect(got.cut).toBe(true)
        else if (!got.cut) expect(got.text).toStartWith(`${c.task ?? c.red ?? c.health?.machine} ${c.text.trim()}`)
      }
      await page.close()
    }, 30_000)
})

describe.skipIf(!browser)('an artifact card', () => {
  /** the week's board in the home chat: a card of its own, after the words it came with */
  const card = () => world.chats['p:vm-str:~'].messages.find((m) => m.artifact?.id === 'a1' && !m.text)!
  const title = () => world.artifacts.find((a) => a.id === 'a1')!.title
  const shots = process.env.SHOTS

  test('on a phone, held by its title row it lifts with the emoji and Reply; a reaction sits under it, and a reply quotes its title and version', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await page.goto(url())
    const id = card().id
    const sel = `[data-msg="${id}"]`
    await page.waitForSelector(`${sel} [data-anchor] [data-card]`)
    await page.$eval(sel, (m) => m.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(300)
    const cdp = await ctx.newCDPSession(page)
    const head = async () => (await page.$eval(`${sel} [data-card] > div`, (b) => b.getBoundingClientRect().toJSON())) as Box
    const hold = async () => {
      const h = await head()
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: h.left + 60, y: (h.top + h.bottom) / 2 }] })
      await page.waitForTimeout(600)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    // held on its title: the bar and Reply, no Copy (it has no words), and the full screen view stays shut
    await hold()
    const dialog = await page.waitForSelector('[role=dialog][aria-label=React]', { state: 'visible' })
    await settled(page)
    if (shots) await page.screenshot({ path: `${shots}/phone-lifted.png` })
    expect(await page.$('[role=menuitem]:has-text("Reply")')).not.toBeNull()
    expect(await page.$('[role=menuitem]:has-text("Copy")')).toBeNull()
    expect(await page.$(`[role=dialog][aria-label="${title()}"]`)).toBeNull()
    // an emoji: a pill on the card's bottom right corner, and the card has it
    await dialog.$('button[aria-label="React 👀"]').then((b) => b!.tap())
    await page.waitForSelector(`${sel} button[aria-label="👀 from you"]`)
    expect(card().reactions).toEqual([{ emoji: '👀', by: 'me' }])
    const [box, pill] = await Promise.all([page.$eval(`${sel} [data-card]`, (b) => b.getBoundingClientRect().toJSON() as Box), page.$eval(`${sel} button[aria-label="👀 from you"]`, (b) => b.getBoundingClientRect().toJSON() as Box)])
    expect(pill.top).toBeLessThan(box.bottom)
    expect(pill.bottom).toBeGreaterThan(box.bottom)
    expect(Math.abs(box.right - 10 - pill.right)).toBeLessThan(3)
    if (shots) await page.screenshot({ path: `${shots}/phone-reacted.png` })
    // slid right by its title row: the box replies to it by its title and version
    await page.waitForSelector('[role=dialog][aria-label=React]', { state: 'detached' })
    const h = await head()
    const [x, y] = [h.left + 60, (h.top + h.bottom) / 2]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (110 * i) / 8, y: y + 2 }] })
      await page.waitForTimeout(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const quoted = `${title()} · v1`
    await page.waitForSelector(`[data-reply-strip]:has-text("${quoted}")`)
    if (shots) await page.screenshot({ path: `${shots}/phone-replying.png` })
    await page.locator('textarea[name=message]').fill('Make the bars blue')
    await page.getByRole('button', { name: 'Send' }).click()
    const sent = page.locator('[data-you]').filter({ hasText: 'Make the bars blue' })
    const quote = sent.locator('[data-quote]')
    await quote.waitFor()
    expect(await quote.textContent()).toContain(quoted)
    expect(world.chats['p:vm-str:~'].messages.at(-1)).toMatchObject({ text: 'Make the bars blue', reply: { id, text: quoted, artifact: true } })
    if (shots) await page.screenshot({ path: `${shots}/phone-sent.png` })
    // its quote jumps back to the card and lights it up
    await quote.tap()
    await page.waitForSelector(`${sel} [data-anchor][data-flash]`)
    // it glides there
    await page.waitForFunction((s) => {
      const b = document.querySelector(s)!.getBoundingClientRect()
      return b.bottom > 0 && b.top < innerHeight
    }, `${sel} [data-card]`)
    await ctx.close()
    card().reactions = undefined
  }, 30_000)

  test('with a mouse, the smiley and reply arrow show beside it on hover, inside the chat', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(url())
    const sel = `[data-msg="${card().id}"]`
    await page.waitForSelector(`${sel} [data-card]`)
    await page.$eval(sel, (m) => m.scrollIntoView({ block: 'center' }))
    await page.hover(`${sel} [data-card] > div`)
    const smiley = page.locator(`${sel} button[aria-label=React]`)
    await page.waitForFunction((s) => getComputedStyle(document.querySelector(s)!.parentElement!).opacity === '1', `${sel} button[aria-label=React]`)
    if (shots) await page.screenshot({ path: `${shots}/desktop-hover.png` })
    // beside the card, within the messages' column
    const [col, b, r] = await Promise.all([
      page.$eval(`${sel}`, (m) => m.closest('[data-messages]')!.getBoundingClientRect().toJSON() as Box),
      smiley.evaluate((e) => e.getBoundingClientRect().toJSON() as Box),
      page.$eval(`${sel} button[aria-label=Reply]`, (e) => e.getBoundingClientRect().toJSON() as Box),
    ])
    const box = (await page.$eval(`${sel} [data-card]`, (e) => e.getBoundingClientRect().toJSON())) as Box
    expect(b.left).toBeGreaterThanOrEqual(box.right)
    expect(r.right).toBeLessThanOrEqual(col.right)
    await smiley.click()
    await page.waitForSelector('[role=dialog][aria-label=React]', { state: 'visible' })
    await page.keyboard.press('Escape')
    await page.click(`${sel} button[aria-label=Reply]`)
    await page.waitForSelector(`[data-reply-strip]:has-text("${title()} · v1")`)
    expect(await page.$eval('[data-reply-strip]', (s) => !!s.querySelector('svg'))).toBe(true)
    await page.close()
  }, 30_000)
})
