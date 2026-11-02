// The message box and what it sends: files, pictures, long messages, the keyboard, in a real browser (layout.ts).
import { describe, expect, test } from 'bun:test'
import type { Page } from 'playwright-core'
import { startApp } from '../server/app.ts'
import { DemoWorld } from '../server/demo/world.ts'
import type { Source } from '../server/source.ts'
import type { Message } from '../shared/types.ts'
import { layout, pills, settled, type Box } from './layout.ts'
import { builtScreen } from './web.ts'

const { browser, world, server, url } = await layout()

describe.skipIf(!browser)('files in the message box', () => {
  /** a small PNG: a 2x2 picture */
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64')
  for (const [name, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1280, height: 800 }],
  ] as const)
    test(`pictures are thumbnails and the row scrolls on its own (${name})`, async () => {
      const page = await browser!.newPage({ viewport, hasTouch: name === 'phone' })
      await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home`)
      await page.getByRole('button', { name: 'Attach files and more' }).click()
      const files = [...Array.from({ length: 7 }, (_, i) => ({ name: `shot${i}.png`, mimeType: 'image/png', buffer: png })), { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') }]
      await page.setInputFiles('input[name="file"]', files)
      const row = page.getByRole('list', { name: 'Attached files' })
      await row.getByRole('listitem').nth(7).waitFor()
      // every picture loaded as a thumbnail; the PDF is a tile with its name
      await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Attached files"] img')].every((i) => (i as HTMLImageElement).naturalWidth > 0))
      expect(await row.locator('img').count()).toBe(7)
      await expect(row.getByText('notes.pdf')).toBeTruthy()
      // more than fit: the row scrolls sideways, the page doesn't, and the message box stays put
      const box = page.getByRole('textbox', { name: /Message/ })
      const before = await box.boundingBox()
      const sizes = await row.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, page: document.scrollingElement!.scrollWidth }))
      expect(sizes.scroll).toBeGreaterThan(sizes.client)
      expect(sizes.page).toBeLessThanOrEqual(viewport.width)
      await row.evaluate((el) => {
        el.style.scrollBehavior = 'auto'
        el.scrollLeft = 0
      })
      expect(await box.boundingBox()).toEqual(before)
      // taking one out keeps the box focused (the keyboard stays up) and nothing else changes
      await box.focus()
      await row.getByRole('button', { name: 'Remove shot0.png' }).click()
      expect(await row.getByRole('listitem').count()).toBe(7)
      expect(await box.evaluate((el) => el === document.activeElement)).toBe(true)
      // a tap on a thumbnail opens it full screen; Close brings the box back
      await row.getByRole('button', { name: 'Open shot1.png' }).click()
      const viewer = page.getByRole('dialog', { name: 'shot1.png' })
      await viewer.waitFor()
      expect(await viewer.getByRole('img', { name: 'shot1.png' }).evaluate((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)).toBe(true)
      await viewer.getByRole('button', { name: 'Close' }).click()
      await viewer.waitFor({ state: 'detached' })
      expect(await row.getByRole('listitem').count()).toBe(7)
      await page.close()
    }, 30_000)

  test('pasting pictures attaches them; pasting text stays text (phone)', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await page.goto(url())
    const box = page.getByRole('textbox', { name: /Message/ })
    await box.focus()
    const b64 = png.toString('base64')
    // two clipboard screenshots with no real names, as Cmd+V or Paste on an iPhone brings them
    const kept = await box.evaluate((el, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }))
      dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }))
      return el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, b64)
    expect(kept).toBe(false)
    const row = page.getByRole('list', { name: 'Attached files' })
    await row.getByRole('listitem').nth(1).waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Attached files"] img')].every((i) => (i as HTMLImageElement).naturalWidth > 0))
    const names = await row.locator('img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('alt')))
    expect(names).toHaveLength(2)
    for (const n of names) expect(n).toMatch(/^screenshot-\d{4}-\d\d-\d\d-\d{6}-[12]\.png$/)
    // each comes out with its x, like a file from +
    await row.getByRole('button', { name: `Remove ${names[0]}` }).click()
    expect(await row.getByRole('listitem').count()).toBe(1)
    // plain text is left to the browser to paste as usual
    const text = await box.evaluate((el) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', 'hello')
      return el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    expect(text).toBe(true)
    expect(await row.getByRole('listitem').count()).toBe(1)
    await ctx.close()
  }, 30_000)

  test('files dragged onto the chat show a quiet highlight and attach on drop (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(url())
    await page.getByRole('textbox', { name: /Message/ }).waitFor()
    const b64 = png.toString('base64')
    const dt = await page.evaluateHandle((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], 'diagram.png', { type: 'image/png' }))
      dt.items.add(new File(['%PDF'], 'spec.pdf', { type: 'application/pdf' }))
      return dt
    }, b64)
    const target = page.locator('[data-msg]').first()
    await target.dispatchEvent('dragenter', { dataTransfer: dt })
    const note = page.getByRole('status').filter({ hasText: 'Drop to attach' })
    await note.waitFor()
    // crossing into a child and back out doesn't drop the highlight
    await page.locator('[data-composer]').first().dispatchEvent('dragenter', { dataTransfer: dt })
    await target.dispatchEvent('dragleave', { dataTransfer: dt })
    expect(await note.count()).toBe(1)
    await target.dispatchEvent('dragover', { dataTransfer: dt })
    await target.dispatchEvent('drop', { dataTransfer: dt })
    await note.waitFor({ state: 'detached' })
    const row = page.getByRole('list', { name: 'Attached files' })
    await row.getByRole('listitem').nth(1).waitFor()
    expect(await row.getByRole('button', { name: 'Open diagram.png' }).count()).toBe(1)
    expect(await row.getByText('spec.pdf').count()).toBe(1)
    // a drag that leaves without dropping takes the highlight with it
    await target.dispatchEvent('dragenter', { dataTransfer: dt })
    await note.waitFor()
    await target.dispatchEvent('dragleave', { dataTransfer: dt })
    await note.waitFor({ state: 'detached' })
    await page.close()
  }, 30_000)
})

describe.skipIf(!browser)('pictures sent in the chat', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64')
  for (const [name, viewport, count, tile] of [
    ['phone', { width: 390, height: 844 }, 5, 88],
    ['desktop', { width: 1280, height: 800 }, 8, 84],
  ] as const)
    test(`sit side by side as small tiles and open in a viewer that pages through them (${name})`, async () => {
      const page = await browser!.newPage({ viewport, hasTouch: name === 'phone' })
      await page.goto(url())
      await page.getByRole('button', { name: 'Attach files and more' }).click()
      const names = Array.from({ length: count }, (_, i) => `${name}-pic${i}.png`)
      await page.setInputFiles('input[name="file"]', names.map((n) => ({ name: n, mimeType: 'image/png', buffer: png })))
      await page.getByRole('list', { name: 'Attached files' }).getByRole('listitem').nth(count - 1).waitFor()
      await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Attached files"] img')].every((i) => (i as HTMLImageElement).naturalWidth > 0))
      await page.getByRole('button', { name: 'Send' }).click()
      const album = page.getByRole('group', { name: `${count} pictures` }).last()
      await album.waitFor()
      await page.waitForFunction((n) => [...document.querySelectorAll(`[aria-label="${n} pictures"] img`)].every((i) => (i as HTMLImageElement).naturalWidth > 0), count)
      // once it has risen into place
      await settled(page)
      // small tiles, about the size of the ones in the message box, in rows of up to three
      const boxes = await album.locator('[data-msg]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as Box & { height: number }))
      expect(boxes).toHaveLength(Math.min(count, 6))
      for (const b of boxes) expect(Math.round(b.height)).toBe(tile)
      expect(new Set(boxes.slice(0, 3).map((b) => Math.round(b.top))).size).toBe(1)
      expect(new Set(boxes.slice(3).map((b) => Math.round(b.top))).size).toBe(1)
      expect(boxes[3].top).toBeGreaterThan(boxes[0].bottom)
      // the rows line up on the right, like your bubbles, and stay on screen
      expect(Math.round(boxes[2].right)).toBe(Math.round(boxes.at(-1)!.right))
      for (const b of boxes) expect(b.right).toBeLessThanOrEqual(viewport.width)
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(viewport.width)
      // past six, the sixth tile counts every picture not shown
      if (count > 6) {
        const last = album.getByRole('button', { name: `Open ${names[5]} and ${count - 6} more` })
        expect(await last.textContent()).toBe(`+${count - 5}`)
      }
      // a tap opens it full screen, with where it is among the chat's pictures
      await album.getByRole('button', { name: `Open ${names[1]}` }).click()
      let viewer = page.getByRole('dialog', { name: names[1] })
      await viewer.waitFor()
      const [, at, of] = (await viewer.getByText(/^\d+ of \d+$/).textContent())!.match(/^(\d+) of (\d+)$/)!.map(Number)
      expect(of).toBeGreaterThanOrEqual(count)
      if (name === 'desktop') {
        // the arrow keys and the round arrows page through them; Esc closes
        await page.keyboard.press('ArrowRight')
        viewer = page.getByRole('dialog', { name: names[2] })
        await viewer.waitFor()
        expect(await viewer.getByText(`${at + 1} of ${of}`).count()).toBe(1)
        await viewer.getByRole('button', { name: 'Previous picture' }).click()
        await page.getByRole('dialog', { name: names[1] }).waitFor()
        await page.keyboard.press('Escape')
        await page.getByRole('dialog').waitFor({ state: 'detached' })
        // closed in the middle of a slide, it stays closed
        await album.getByRole('button', { name: `Open ${names[1]}` }).click()
        await page.getByRole('dialog', { name: names[1] }).waitFor()
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('Escape')
        await page.getByRole('dialog').waitFor({ state: 'detached' })
        await page.waitForTimeout(400)
        expect(await page.getByRole('dialog').count()).toBe(0)
      } else {
        // a swipe across goes to the next one
        const box = (await viewer.boundingBox())!
        await page.mouse.move(box.width / 2 + 100, box.height / 2)
        await page.mouse.down()
        for (let x = 100; x >= -100; x -= 25) await page.mouse.move(box.width / 2 + x, box.height / 2)
        await page.mouse.up()
        viewer = page.getByRole('dialog', { name: names[2] })
        await viewer.waitFor()
        // a reaction from the viewer lands in that tile's corner
        await viewer.getByRole('button', { name: 'React 👍' }).click()
        await viewer.getByRole('button', { name: 'Close' }).click()
        await viewer.waitFor({ state: 'detached' })
        const tile = album.locator('[data-msg]').nth(2)
        const pill = tile.getByRole('button', { name: '👍 from you' })
        await pill.waitFor()
        const [t, p] = [(await tile.boundingBox())!, (await pill.boundingBox())!]
        expect(p.x).toBeGreaterThanOrEqual(t.x)
        expect(p.x + p.width).toBeLessThanOrEqual(t.x + t.width)
        expect(p.y + p.height).toBeLessThanOrEqual(t.y + t.height)
      }
      await page.close()
    }, 30_000)
})

describe.skipIf(!browser)('a picture that cannot be shown', () => {
  test('is a file tile that keeps its reactions and ways to react (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(url())
    const msg = page.locator('[data-msg="heic-you"]')
    await msg.getByRole('link', { name: 'Download photo.heic' }).waitFor()
    // its reaction stays on its corner, and tapping it adds yours
    const pill = msg.getByRole('button', { name: '👍 from agent' })
    await pill.waitFor()
    const [tile, p] = [(await msg.locator('[data-anchor]').boundingBox())!, (await pill.boundingBox())!]
    expect(p.y).toBeLessThan(tile.y + tile.height)
    expect(p.y + p.height).toBeGreaterThan(tile.y + tile.height)
    // the smiley beside it opens the bar
    await msg.locator('[data-anchor]').hover()
    await msg.getByRole('button', { name: 'React to photo.heic' }).click()
    await page.waitForSelector('[role=dialog][aria-label=React]', { state: 'visible' })
    await page.close()
  }, 30_000)

  test('in an album, a hold on its tile reacts instead of downloading it (phone)', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    let downloads = 0
    page.on('download', () => downloads++)
    await page.goto(url())
    const tile = page.locator('[data-msg="heic-a"] [data-anchor]')
    await page.getByRole('group', { name: '2 pictures' }).getByRole('link', { name: 'Download a.heic' }).waitFor()
    await tile.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    const b = (await tile.boundingBox())!
    const cdp = await ctx.newCDPSession(page)
    const [x, y] = [b.x + b.width / 2, b.y + b.height / 2]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await page.waitForTimeout(600)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForSelector('[role=dialog][aria-label=React]', { state: 'visible' })
    await page.getByRole('button', { name: 'React 👍' }).first().tap()
    await page.locator('[data-msg="heic-a"]').getByRole('button', { name: '👍 from you' }).waitFor()
    expect(downloads).toBe(0)
    await ctx.close()
  }, 30_000)
})

describe.skipIf(!browser)('a long message in the box', () => {
  const long = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} of a long prompt that keeps going.`).join(' ')
  for (const [name, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1280, height: 800 }],
  ] as const)
    test(`the buttons keep their size and spot while the words grow the box upward (${name})`, async () => {
      const page = await browser!.newPage({ viewport, hasTouch: name === 'phone', isMobile: name === 'phone' })
      await page.goto(url())
      const box = page.locator('[data-composer]').first()
      const text = page.locator('textarea[name=message]').first()
      await text.waitFor()
      const rect = (l: typeof box) => l.evaluate((el) => el.getBoundingClientRect().toJSON()) as Promise<Box & { width: number; height: number }>
      const send = page.locator('[data-composer] button[aria-label=Send]').first()
      const plus = page.locator('[data-composer] button[aria-label="Attach files and more"]').first()
      const mic = page.locator('[data-composer] button[aria-label="Talk to type"]').first()
      await text.focus()
      await text.fill('Run the tests again')
      const one = await rect(box)
      const [p0, m0, s0] = await Promise.all([plus, mic, send].map(rect))
      const size = name === 'phone' ? 44 : 34
      for (const r of [p0, m0, s0]) expect([r.width, r.height]).toEqual([size, size])
      // at every length, from one line to past the max height, and with a line break: the same buttons in the same
      // spots, the words between them, and the box taller only upward
      for (const words of [...[1, 2, 3, 8, 30].map((n) => long.split('. ').slice(0, n).join('. ')), 'One\nTwo']) {
        await text.fill(words)
        await page.waitForTimeout(50)
        const [b, t, ...btns] = await Promise.all([box, text, plus, mic, send].map(rect))
        btns.forEach((r, k) => expect(r).toEqual([p0, m0, s0][k]))
        expect(t.left).toBeGreaterThanOrEqual(p0.right)
        expect(t.right).toBeLessThanOrEqual(m0.left)
        expect(Math.abs(b.bottom - one.bottom)).toBeLessThan(0.5)
        expect(b.height).toBeGreaterThanOrEqual(one.height)
        expect(b.height).toBeLessThan(viewport.height * 0.4)
        // every button sits as far from the bottom as from the side
        expect(Math.abs(b.bottom - p0.bottom - (p0.left - b.left))).toBeLessThan(0.5)
        expect(Math.abs(b.bottom - s0.bottom - (b.right - s0.right))).toBeLessThan(0.5)
      }
      expect((await rect(box)).height).toBeGreaterThan(one.height)
      // past the max height the words scroll inside, the end in full view as you type, fading at the cut edge
      await text.fill(long)
      await text.press('End')
      await text.pressSequentially(' And more.')
      await page.waitForTimeout(50)
      const scroll = await text.evaluate((el) => ({
        scrolls: el.scrollHeight > el.clientHeight,
        atEnd: Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) < 2,
        up: el.hasAttribute('data-more-up'),
        down: el.hasAttribute('data-more-down'),
      }))
      expect(scroll).toEqual({ scrolls: true, atEnd: true, up: true, down: false })
      // it stays the same box: still focused, and clearing it brings back the one round row
      expect(await text.evaluate((el) => el === document.activeElement)).toBe(true)
      await text.fill('')
      await page.waitForTimeout(50)
      expect((await rect(box)).height).toBe(one.height)
      await page.close()
    }, 30_000)
  for (const [name, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1280, height: 800 }],
  ] as const)
    test(`the line you type stays in full view, faded only where words are hidden (${name})`, async () => {
      const page = await browser!.newPage({ viewport, hasTouch: name === 'phone', isMobile: name === 'phone' })
      await page.goto(url())
      const text = page.locator('textarea[name=message]').first()
      await text.waitFor()
      const box = () =>
        text.evaluate((el) => {
          const cs = getComputedStyle(el)
          const [pt, pb, lh] = [cs.paddingTop, cs.paddingBottom, cs.lineHeight].map(parseFloat)
          const fade = (v: string) => (v.trim().endsWith('px') ? parseFloat(v) : Infinity)
          return {
            lines: (el.clientHeight - pt - pb) / lh,
            atEnd: Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) < 1,
            up: el.hasAttribute('data-more-up'),
            down: el.hasAttribute('data-more-down'),
            // the fades reach no further in than the padding: never over a whole line
            fades: fade(cs.getPropertyValue('--fade-up')) <= pt && fade(cs.getPropertyValue('--fade-down')) <= pb,
          }
        })
      /** line i (from 0) is in full view, the padding round it clear of the edges, so no fade is on it */
      const shows = (i: number) =>
        text.evaluate((el, i) => {
          const cs = getComputedStyle(el)
          const [pt, pb, lh] = [cs.paddingTop, cs.paddingBottom, cs.lineHeight].map(parseFloat)
          return el.scrollTop <= i * lh + 0.5 && el.scrollTop + el.clientHeight >= pt + (i + 1) * lh + pb - 0.5
        }, i)
      // typing at the end of a long message: whole lines, the end in view, only the top edge fades, and only over the
      // padding
      await text.focus()
      await text.fill(long)
      await text.pressSequentially(' ofc we')
      const b = await box()
      expect(Number.isInteger(b.lines)).toBe(true)
      expect(b).toMatchObject({ atEnd: true, up: true, down: false, fades: true })
      // a phone shows the caret itself after each letter, stopping a little short of the padding: it comes back
      await text.evaluate((el) =>
        document.addEventListener('input', () => queueMicrotask(() => (el.scrollTop = el.scrollHeight - el.clientHeight - parseFloat(getComputedStyle(el).paddingBottom) + 1)), { once: true }),
      )
      await text.press('x')
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      expect(await box()).toMatchObject({ atEnd: true, down: false })
      // typing or moving the caret in the middle: its line comes into full view, the words past it fading at the edge
      const rows = Array.from({ length: 20 }, (_, i) => `line ${i + 1} gjpqy`).join('\n')
      await text.fill(rows)
      await text.evaluate((el, at) => {
        el.scrollTop = 0
        ;(el as HTMLTextAreaElement).setSelectionRange(at, at)
      }, rows.indexOf('\n', rows.indexOf('line 10 ')))
      await text.press('Z')
      expect(await shows(9)).toBe(true)
      expect(await box()).toMatchObject({ up: true, down: true })
      for (let i = 0; i < 10; i++) await text.press('ArrowDown')
      expect(await shows(19)).toBe(true)
      expect(await box()).toMatchObject({ atEnd: true, down: false })
      for (let i = 0; i < 15; i++) await text.press('ArrowUp')
      expect(await shows(4)).toBe(true)
      // a shorter screen (a phone's keyboard up) fits fewer whole lines; taller again, it grows back at once
      const full = (await box()).lines
      await page.setViewportSize({ width: viewport.width, height: 420 })
      await page.waitForTimeout(100)
      const short = (await box()).lines
      expect(Number.isInteger(short)).toBe(true)
      expect(short).toBeLessThan(full)
      await page.setViewportSize(viewport)
      await page.waitForTimeout(100)
      expect((await box()).lines).toBe(full)
      await page.close()
    }, 30_000)
  test('the chat stays on its newest message as the box grows; read further up, it keeps its bottom edge', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await page.goto(url())
    await page.waitForSelector('[data-msg="short-agent"]')
    await page.waitForTimeout(300)
    const text = page.locator('textarea[name=message]').first()
    const list = () => document.querySelector('[data-msg]')!.closest('.overflow-y-auto') as HTMLElement
    const left = () =>
      page.evaluate((l) => {
        const el = (eval(l) as () => HTMLElement)()
        return el.scrollHeight - el.scrollTop - el.clientHeight
      }, list.toString())
    const jump = () => page.$('button[aria-label$="to the latest"]')
    await text.focus()
    await text.fill(long)
    // a chat only a little taller than its view, at its newest message: each letter measures the box, and the chat
    // must not grow for that moment, or it would be pulled up off its newest message and the arrow would show
    await page.evaluate((l) => {
      const el = (eval(l) as () => HTMLElement)()
      const inner = el.firstElementChild as HTMLElement
      for (const c of inner.children) (c as HTMLElement).style.display = 'none'
      const rest = document.createElement('div')
      rest.style.height = `${el.clientHeight + 100}px`
      rest.style.flex = 'none'
      inner.appendChild(rest)
      el.scrollTop = el.scrollHeight
    }, list.toString())
    await page.waitForTimeout(100)
    for (const k of ' ofc we') {
      await text.press(k === ' ' ? 'Space' : k)
      expect(await left()).toBeLessThan(2)
      expect(await jump()).toBeNull()
    }
    // read further up: the chat keeps what was just above the box there as the box grows, and fades under the arrow
    await page.reload()
    await page.waitForSelector('[data-msg="short-agent"]')
    await text.fill('')
    await page.$eval('[data-msg="long-you"]', (m) => m.scrollIntoView({ block: 'end' }))
    await page.waitForSelector('button[aria-label$="to the latest"]')
    expect(await page.$('[data-fade-under-jump]')).not.toBeNull()
    const above = () => page.$eval('[data-msg="long-you"]', (m) => m.closest('.overflow-y-auto')!.getBoundingClientRect().bottom - m.getBoundingClientRect().bottom)
    const before = await above()
    await text.fill(long)
    await page.waitForTimeout(50)
    expect(Math.abs((await above()) - before)).toBeLessThan(1)
    await page.close()
  }, 30_000)
})

describe.skipIf(!browser)('the keyboard, like iMessage and Slack', () => {
  const focused = (page: Page) => page.evaluate(() => (document.activeElement as HTMLTextAreaElement | null)?.name ?? null)
  /** the box lets go: waited for, as a busy page may handle the touch that does it a moment late (checked every 50 ms:
   *  a still page may draw no frames to check on) */
  const letsGo = (page: Page) => page.waitForFunction(() => !(document.activeElement as HTMLTextAreaElement | null)?.name, null, { polling: 50, timeout: 5000 })
  const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
  const tablet = { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true }
  /** the chat open with its long messages, its box focused, and a finger on it */
  const chat = async (size: typeof phone) => {
    const ctx = await browser!.newContext(size)
    const page = await ctx.newPage()
    await page.goto(url())
    await page.locator('textarea[name=message]').first().waitFor()
    await page.waitForSelector('[data-msg="long-agent"]')
    const cdp = await ctx.newCDPSession(page)
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y: y! }] })
    const slide = async (from: [number, number], to: [number, number]) => {
      await touch('touchStart', ...from)
      for (let i = 1; i <= 8; i++) await touch('touchMove', from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8)
      await touch('touchEnd')
    }
    const still = () =>
      page.waitForFunction(
        () =>
          new Promise((done) => {
            const el = document.querySelector('[data-msg]')!.closest('.overflow-y-auto')!
            const at = el.scrollTop
            setTimeout(() => done(el.scrollTop === at), 200)
          }),
      )
    const refocus = async () => {
      await still()
      // (headless Chromium now and then takes a tap after a fling as the fling's stop: tap again)
      for (let i = 0; i < 3 && (await focused(page)) !== 'message'; i++) {
        await page.tap('textarea[name=message]')
        await page.waitForFunction(() => (document.activeElement as HTMLTextAreaElement | null)?.name === 'message', null, { polling: 50, timeout: 1000 }).catch(() => {})
      }
      expect(await focused(page)).toBe('message')
    }
    await refocus()
    const x = page.viewportSize()!.width / 2
    const box = (await page.$eval('[data-composer]', (b) => b.getBoundingClientRect().toJSON())) as Box
    return { ctx, page, touch, slide, still, refocus, x, box }
  }
  test('Send, + and a reaction keep the box (and a phone its keyboard) (phone)', async () => {
    const ctx = await browser!.newContext(phone)
    const page = await ctx.newPage()
    await page.goto(url())
    const text = page.locator('textarea[name=message]').first()
    await text.waitFor()
    await page.waitForSelector('[data-msg="short-agent"]')
    // typed and sent: the box is empty and still has the focus
    await page.tap('textarea[name=message]')
    await text.fill('Run the tests again')
    await page.tap('[data-composer] button[aria-label=Send]')
    await page.waitForFunction(() => !(document.querySelector('textarea[name=message]') as HTMLTextAreaElement).value)
    expect(await focused(page)).toBe('message')
    // + opens its menu with the box still focused, and closes the same way
    await page.tap('[data-composer] button[aria-label="Attach files and more"]')
    await page.getByRole('menu', { name: 'Attach files and more' }).waitFor()
    expect(await focused(page)).toBe('message')
    await page.tap('[data-composer] button[aria-label="Attach files and more"]')
    await page.getByRole('menu', { name: 'Attach files and more' }).waitFor({ state: 'detached' })
    expect(await focused(page)).toBe('message')
    // a reaction pill tapped toggles yours and leaves the box focused
    await page.tap(`${pills('long-agent')}`)
    expect(await focused(page)).toBe('message')
    await ctx.close()
  }, 30_000)
  for (const [name, size] of [
    ['phone', phone],
    ['tablet', tablet],
  ] as const) {
    // as in iMessage: scrolling the chat up and down keeps the box (and the keyboard)
    test(`scrolling the chat keeps the box, sideways and the drawer's swipe too (${name})`, async () => {
      const { ctx, page, touch, slide, still, x, box } = await chat(size)
      // (what should change nothing is given a moment to: nothing to wait for)
      const keeps = async () => {
        await page.waitForTimeout(100)
        expect(await focused(page)).toBe('message')
      }
      // up, down, and up and down again in one go, a long way: the chat scrolls, the keyboard stays
      const top = () => page.evaluate(() => document.querySelector('[data-msg]')!.closest('.overflow-y-auto')!.scrollTop)
      const at = await top()
      await slide([x, 300], [x, 600])
      await still()
      const up = await top()
      expect(up).toBeLessThan(at - 100)
      await slide([x, 600], [x, 200])
      await still()
      expect(await top()).toBeGreaterThan(up + 100)
      await touch('touchStart', x, 250)
      for (const y of [400, 550, 300, 150, 500, box.top - 4]) await touch('touchMove', x, y)
      await touch('touchEnd')
      await keeps()
      // sideways keeps it too, and so does a thumb's arc from the edge that opens the drawer, dipping past the box
      await slide([x, 400], [x - 50, 405])
      await keeps()
      const y0 = box.bottom - 120
      await touch('touchStart', 4, y0)
      for (const [dx, dy] of [[12, 16], [18, 28], [76, 80], [216, 135]]) await touch('touchMove', 4 + dx, y0 + dy)
      await touch('touchEnd')
      // the drawer is out once it has stopped sliding and the app has it open (until then a swipe can't shut it)
      await page.waitForFunction(() => {
        const nav = document.querySelector('nav[aria-label=Spaces]')!
        return Math.round(nav.getBoundingClientRect().left) === 0 && !nav.closest('[inert]')
      }, null, { polling: 50 })
      expect(await focused(page)).toBe('message')
      // (a swipe left shuts the drawer again: gone, and shut in the app too, or its shade still takes the next touch)
      await slide([300, y0], [20, y0])
      await page.waitForFunction(() => {
        const nav = document.querySelector('nav[aria-label=Spaces]')!
        return nav.getBoundingClientRect().right <= 0 && !!nav.closest('[inert]')
      }, null, { polling: 50 })
      expect(await focused(page)).toBe('message')
      await ctx.close()
    }, 30_000)
    // as in iMessage: the keyboard goes once a finger drags down past the box into it, or taps the chat
    test(`a drag down into the keyboard or a tap on the chat lets the box go (${name})`, async () => {
      const { ctx, page, slide, still, refocus, x, box } = await chat(size)
      await slide([x, 300], [x, box.bottom + 12])
      await letsGo(page)
      await refocus()
      // the drag flung the message far below the screen, how far as fast as the finger went: back in view to tap it
      // (a tap off the screen goes nowhere, or now and then somewhere)
      await page.$eval('[data-msg="long-agent"] [data-anchor]', (b) => b.scrollIntoView({ block: 'center' }))
      await still()
      const words = (await page.$eval('[data-msg="long-agent"] [data-anchor]', (b) => b.getBoundingClientRect().toJSON())) as Box
      expect(words.top + 14).toBeGreaterThan(0)
      expect(words.top + 14).toBeLessThan(box.top)
      await page.touchscreen.tap(words.left + 40, words.top + 14)
      await letsGo(page)
      await ctx.close()
    }, 30_000)
  }
  test('a long message in a phone\'s box keeps its big round buttons, round in the corners', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await page.goto(url())
    const text = page.locator('textarea[name=message]').first()
    await text.waitFor()
    await text.fill('One\nTwo\nThree')
    await page.waitForTimeout(50)
    const r = await page.evaluate(() => {
      const box = document.querySelector('[data-composer]')!
      const rect = (el: Element) => el.getBoundingClientRect()
      const send = rect(box.querySelector('button[aria-label=Send]')!)
      return { send: send.height, under: rect(box).bottom - send.bottom, tall: rect(box).height, radius: parseFloat(getComputedStyle(box).borderTopLeftRadius) }
    })
    expect(r.send).toBe(44)
    expect(r.tall).toBeGreaterThan(80)
    // 6px padding round a 44px button, so the corner radius is 6 + 44 / 2: the corner curves around the button
    expect(r.under).toBe(6)
    expect(r.radius).toBe(28)
    await page.close()
  }, 30_000)
  test('a picture growing the chat as it scrolls down keeps it on the newest message, with no arrow over it', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await page.goto(url())
    await page.waitForSelector('[data-msg="short-agent"]')
    await page.waitForTimeout(300)
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const list = () => document.querySelector('[data-msg]')!.closest('.overflow-y-auto') as HTMLElement
    // a little up from the bottom (still following it), then on its way down as a picture loads and grows the list
    await page.evaluate(async ([f, l]) => {
      const frames = eval(f) as () => Promise<void>
      const el = (eval(l) as () => HTMLElement)()
      el.scrollTop = el.scrollHeight - el.clientHeight - 40
      await frames()
      // the picture grows just before the chat hears of the scroll (as a slow one does, between two frames)
      const grow = () => {
        const grown = document.createElement('div')
        grown.style.height = '300px'
        el.firstElementChild!.appendChild(grown)
      }
      document.addEventListener('scroll', grow, { capture: true, once: true })
      el.scrollTop += 20
      await frames()
      await frames()
    }, [frames.toString(), list.toString()])
    const left = await page.evaluate((l) => {
      const el = (eval(l) as () => HTMLElement)()
      return el.scrollHeight - el.scrollTop - el.clientHeight
    }, list.toString())
    expect(left).toBeLessThan(2)
    expect(await page.$('button[aria-label$="to the latest"]')).toBeNull()
    await page.close()
  }, 30_000)
  test('a desktop still sends on Enter, and the jump to the latest sits in the middle', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(url())
    const text = page.locator('textarea[name=message]').first()
    await text.waitFor()
    await page.waitForSelector('[data-msg="short-agent"]')
    await text.click()
    await text.fill('Ship it')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => !(document.querySelector('textarea[name=message]') as HTMLTextAreaElement).value)
    expect(await focused(page)).toBe('message')
    await page.$eval('[data-msg="tall-agent"] button[aria-expanded=false]', (b) => (b as HTMLElement).click())
    await page.$eval('[data-msg="tall-agent"]', (m) => m.scrollIntoView({ block: 'start' }))
    const jump = page.getByRole('button', { name: /jump to the latest/i })
    await jump.waitFor()
    const [j, list] = await Promise.all([jump.boundingBox(), page.locator('[data-msg]').first().locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]').boundingBox()])
    expect(Math.abs(j!.x + j!.width / 2 - (list!.x + list!.width / 2))).toBeLessThan(1)
    await page.close()
  }, 30_000)
})

describe.skipIf(!browser)('typing in the message box', () => {
  // on a desktop the chat sits between places and tasks, which a phone doesn't draw
  test.each([
    ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
    ['desktop', { viewport: { width: 1600, height: 1000 } }],
  ] as const)('each letter redraws only the box: not the messages, the frame or the lists (%s)', async (_, size) => {
    const ctx = await browser!.newContext(size)
    // React tells a devtools hook about every commit: note the parts that ran, each by the element it draws (or sits in)
    await ctx.addInitScript(() => {
      const w = window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: object; drawn: Element[] | null }
      w.drawn = null
      type Fiber = { tag: number; flags: number; child: Fiber | null; sibling: Fiber | null; return: Fiber | null; alternate: Fiber | null; stateNode: unknown }
      const parts = new Set([0, 1, 11, 14, 15])
      const host = (f: Fiber) => {
        for (let c: Fiber | null = f; c; c = c.child) if (c.tag === 5) return c.stateNode as Element
        for (let r = f.return; r; r = r.return) if (r.tag === 5) return r.stateNode as Element
        return document.body
      }
      w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        renderers: new Map(),
        inject: () => 1,
        checkDCE: () => {},
        onScheduleFiberRoot: () => {},
        onCommitFiberUnmount: () => {},
        onPostCommitFiberRoot: () => {},
        onCommitFiberRoot: (_: number, root: { current: Fiber }) => {
          if (!w.drawn) return
          // as React's devtools do: a part ran if it did work this commit; a subtree it didn't touch keeps its children
          const stack: Fiber[] = [root.current]
          while (stack.length) {
            const f = stack.pop()!
            if (parts.has(f.tag) && f.alternate && f.flags & 1) w.drawn.push(host(f))
            if (f.alternate && f.child === f.alternate.child) continue
            for (let c = f.child; c; c = c.sibling) stack.push(c)
          }
        },
      }
    })
    const page = await ctx.newPage()
    await page.goto(url())
    const box = page.locator('textarea[name=message]')
    await box.waitFor()
    await page.waitForFunction(() => document.querySelectorAll('[data-messages] [data-msg]').length >= 6)
    await box.click()
    await page.waitForTimeout(300)
    await page.evaluate(() => ((window as unknown as { drawn: Element[] }).drawn = []))
    await box.pressSequentially('Run the tests', { delay: 20 })
    await page.waitForTimeout(200)
    const out = await page.evaluate(() => {
      const drawn = (window as unknown as { drawn: Element[] }).drawn
      const composer = document.querySelector('[data-composer]')!.parentElement!
      const say = (el: Element) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}`
      return {
        n: drawn.length,
        messages: drawn.filter((el) => el.closest('[data-messages]')).map(say),
        outside: [...new Set(drawn.filter((el) => !composer.contains(el)).map(say))],
      }
    })
    expect(await box.inputValue()).toBe('Run the tests')
    // the box itself redrew, letter by letter
    expect(out.n).toBeGreaterThanOrEqual(13)
    expect(out.messages).toEqual([])
    expect(out.outside).toEqual([])
    await box.fill('')
    await ctx.close()
  }, 30_000)

  test('in a long chat on a desktop, a letter costs a few ms of layout, not a pass over every message', async () => {
    // a coordinator's chat after a long day, of its own so the other tests keep their chats
    const long = new DemoWorld()
    const gtm = long.places.find((p) => p.name === 'gtm')!
    const now = Date.now()
    long.chats[gtm.chat].messages.unshift(
      ...Array.from({ length: 400 }, (_, i): Message => ({
        id: `long-${i}`,
        who: i % 2 ? 'agent' : 'you',
        text: i % 2 ? `A reply with **bold**, \`code\` and a [link](https://example.com), number ${i}.\n\n- one\n- two` : `Question number ${i}`,
        at: now - (400 - i) * 60_000,
      })),
    )
    const app = startApp({ source: long as unknown as Source, dist: await builtScreen(), port: 0 })
    const ctx = await browser!.newContext({ viewport: { width: 1600, height: 1000 } })
    const page = await ctx.newPage()
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Performance.enable')
    await page.goto(`http://127.0.0.1:${app.port}/?place=${encodeURIComponent(gtm.id)}`)
    const box = page.locator('textarea[name=message]')
    await box.waitFor()
    await page.waitForFunction(() => document.querySelectorAll('[data-messages] [data-msg]').length >= 400)
    // places and tasks show beside the chat
    expect(await page.locator('#places').isVisible()).toBe(true)
    await box.click()
    await page.waitForTimeout(300)
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
    const text = 'Run the tests and tell me'
    const before = await metrics()
    await box.pressSequentially(text, { delay: 30 })
    await page.waitForTimeout(200)
    const after = await metrics()
    const perKey = (k: string) => ((after[k] - before[k]) * 1000) / text.length
    expect(await box.inputValue()).toBe(text)
    // the box grows with its words inside a grid row of a fixed height: the columns beside it (and the 400 messages
    // above it) aren't measured again. It was 30 ms and more a letter when the row sized itself to its content
    expect(perKey('LayoutDuration')).toBeLessThan(5)
    // and no letter restyles or lays out more than a few dozen of the page's 11,000 elements. Counted, not timed: a
    // busy runner takes twice as long over the same work (10 ms of script and style a letter on CI, 6 here). The
    // first key once restyled them all, for the keyboard's rings (data-keys on <html>)
    await box.fill('')
    await box.click()
    // (a trace holds every page of the browser, and other test files' pages work in it meanwhile: only this one's)
    const frame = (await cdp.send('Page.getFrameTree')).frameTree.frame.id
    const events: { name: string; args?: { elementCount?: number; beginData?: { frame?: string; dirtyObjects?: number } } }[] = []
    cdp.on('Tracing.dataCollected', (e) => events.push(...(e.value as unknown as typeof events)))
    const traced = new Promise((done) => cdp.once('Tracing.tracingComplete', done))
    await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['devtools.timeline'] }, transferMode: 'ReportEvents' })
    await box.pressSequentially(text, { delay: 30 })
    await page.waitForTimeout(200)
    await cdp.send('Tracing.end')
    await traced
    expect(await box.inputValue()).toBe(text)
    const most = (name: string, n: (e: (typeof events)[number]) => number | undefined) => Math.max(...events.filter((e) => e.name === name && e.args?.beginData?.frame === frame).map((e) => n(e) ?? 0))
    expect(most('UpdateLayoutTree', (e) => e.args?.elementCount)).toBeGreaterThan(0)
    expect(most('UpdateLayoutTree', (e) => e.args?.elementCount)).toBeLessThan(200)
    expect(most('Layout', (e) => e.args?.beginData?.dirtyObjects)).toBeGreaterThan(0)
    expect(most('Layout', (e) => e.args?.beginData?.dirtyObjects)).toBeLessThan(200)
    await ctx.close()
    app.stop(true)
  }, 60_000)

  test('each chat keeps its own half-typed words, and they come back after a reload', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 844 } })
    const base = `http://127.0.0.1:${server!.port}/`
    const machine = world.snapshot().places.find((p) => p.id === 'p:mac:~')!
    await page.goto(`${base}?place=${encodeURIComponent(machine.id)}`)
    const box = page.locator('textarea[name=message]').first()
    await box.waitFor()
    // a new page load: what the reload on a new build keeps, as it keeps it
    await page.evaluate(() => sessionStorage.setItem('shepherdr.kept', JSON.stringify({ text: { 'p:vm-str:~': 'half a thought' } })))
    await page.goto(`${base}?place=vm-str/home`)
    expect(await box.inputValue()).toBe('half a thought')
    await page.evaluate((id) => {
      history.pushState(null, '', `?place=${encodeURIComponent(id)}`)
      dispatchEvent(new PopStateEvent('popstate'))
    }, machine.id)
    await page.waitForFunction(() => (document.querySelector('textarea[name=message]') as HTMLTextAreaElement)?.dataset.chat !== 'p:vm-str:~')
    expect(await box.inputValue()).toBe('')
    await page.goBack()
    await page.waitForFunction(() => (document.querySelector('textarea[name=message]') as HTMLTextAreaElement)?.dataset.chat === 'p:vm-str:~')
    expect(await box.inputValue()).toBe('half a thought')
    await box.fill('')
    await page.close()
  }, 30_000)
})
