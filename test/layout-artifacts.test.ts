// Artifacts in the chat and full screen, in a real browser (layout.ts).
import { describe, expect, test } from 'bun:test'
import type { Page } from 'playwright-core'
import { ARTIFACT_HTML } from '../server/demo/artifacts.ts'
import { wrapPage } from '../server/frame.ts'
import { layout } from './layout.ts'

const { browser, world, server } = await layout({ everything: true })

describe.skipIf(!browser)('artifacts', () => {
  const at = (q: string) => `http://127.0.0.1:${server!.port}/?${q}`

  test("a page speaks for you only after you touched it; its Send goes to its keeper's chat", async () => {
    // a page that takes the focus and sends on its own, with nobody touching it
    ARTIFACT_HTML.zz1 = { 1: `<input id="i"><script>document.getElementById('i').focus(); setTimeout(function(){ shepherdr.send('Spoken for you') }, 400)</script>` }
    world.artifacts.push({ id: 'zz1', title: 'Pushy page', place: 'p:vm-str:herdr-projects', at: 1, v: 1, when: 'now', by: 'HP-201 agent', keeper: 'HP-201 agent', versions: [{ n: 1, when: 'now', by: 'HP-201 agent', html: 1 }] })
    world.chat('HP-201/Agent').messages.push({ id: 'pushy', who: 'agent', text: 'A pushy page.', artifact: { id: 'zz1', v: 1 }, at: 0 })
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    const before = world.chat('HP-201/Agent').messages.length
    await page.goto(at('place=p%3Avm-str%3Aherdr-projects&task=HP-201'))
    // no locator until it had its chance: Playwright's own queries count as a person's touch
    await page.waitForTimeout(1500)
    expect(world.chat('HP-201/Agent').messages.length).toBe(before)
    // a tap in the board's own form sends
    const frame = page.frameLocator('iframe[title="Board with the fixed count"]').last()
    await frame.getByText('Grey').tap()
    await frame.getByRole('button', { name: 'Send' }).tap()
    await frame.getByText('Sent: Pinned colour = Grey').waitFor()
    const last = world.chat('HP-201/Agent').messages.at(-1)!
    expect(last).toMatchObject({ who: 'you', answered: 'Sent from "Board with the fixed count"', text: 'Pinned colour: Grey' })
    world.artifacts = world.artifacts.filter((a) => a.id !== 'zz1')
    await page.close()
  }, 30_000)

  /** an artifact of its own in HP-201's chat, by the agent or by you; gone again after the test */
  const posted: string[] = []
  const LONG = 'SHE-120: Keep all 32 chars of a task name · Proof'
  const post = (id: string, title: string, html: string, who: 'agent' | 'you' = 'agent') => {
    ARTIFACT_HTML[id] = { 1: html }
    world.artifacts.push({ id, title, place: 'p:vm-str:herdr-projects', at: 1, v: 1, when: 'now', by: 'HP-201 agent', keeper: 'HP-201 agent', versions: [{ n: 1, when: 'now', by: 'HP-201 agent', html: 1 }] })
    world.chat('HP-201/Agent').messages.push({ id: `post-${id}`, who, text: title, artifact: { id, v: 1 }, at: 0 })
    posted.push(id)
  }
  const unpost = () => {
    world.artifacts = world.artifacts.filter((a) => !posted.includes(a.id))
    const chat = world.chat('HP-201/Agent')
    chat.messages = chat.messages.filter((m) => !(m.artifact && posted.includes(m.artifact.id)))
    posted.length = 0
  }
  /** a frame's box in the chat, and how far its page scrolls */
  const frameOf = async (page: Page, title: string) => {
    const f = page.frameLocator(`[data-card] iframe[title="${title}"]`)
    const box = (await page.locator(`[data-card] iframe[title="${title}"]`).boundingBox())!
    const scroll = await f.locator('html').evaluate((h) => ({ scroll: h.scrollHeight, client: h.clientHeight }))
    return { ...box, ...scroll }
  }
  /** the frame stops changing height */
  const settled = (page: Page, title: string) =>
    page.waitForFunction(
      (t) =>
        new Promise<boolean>((done) => {
          const f = () => document.querySelector(`[data-card] iframe[title="${t}"]`)?.getBoundingClientRect().height ?? 0
          const a = f()
          setTimeout(() => done(a > 96 && f() === a), 400)
        }),
      title,
      { timeout: 10_000 },
    )

  test('a card spans the chat column, and a fixed-size design is scaled to its width, keeping its shape', async () => {
    post('zz2', 'Wide poster', `<meta name="shepherdr-size" content="1200x600"><style>body{background:#c2410c}</style>`)
    for (const viewport of [{ width: 360, height: 780 }, { width: 1280, height: 800 }]) {
      const page = await browser!.newPage({ viewport })
      await page.goto(at('place=p%3Avm-str%3Aherdr-projects&task=HP-201'))
      const card = page.locator('[data-card]').filter({ hasText: 'Wide poster' })
      await card.waitFor()
      await settled(page, 'Wide poster')
      const f = await frameOf(page, 'Wide poster')
      // half its width tall, and nothing blank to scroll into below it
      expect(Math.abs(f.height - f.width / 2)).toBeLessThanOrEqual(1)
      expect(f.scroll).toBeLessThanOrEqual(f.client)
      const c = (await card.boundingBox())!
      const col = await page
        .locator('[data-messages]')
        .filter({ has: card })
        .evaluate((m) => {
          const r = m.getBoundingClientRect()
          const s = getComputedStyle(m)
          return { left: r.left + parseFloat(s.paddingLeft), right: r.right - parseFloat(s.paddingRight) }
        })
      expect(Math.abs(c.x - col.left)).toBeLessThanOrEqual(1)
      expect(Math.abs(c.x + c.width - col.right)).toBeLessThanOrEqual(1)
      // edge to edge: the page fills the card's width
      expect(Math.abs(f.width - c.width)).toBeLessThanOrEqual(1)
      await page.close()
    }
    unpost()
  }, 30_000)

  test('a page is as tall as its content, a tall one stops at the cap and scrolls inside, a 100vh one settles', async () => {
    post('zz3', 'Short page', `<p style="margin:0;height:150px">Short</p>`)
    post('zz4', 'Tall page', `<p style="margin:0;height:3000px">Tall</p>`)
    post('zz5', 'Screen page', `<style>body{display:grid;place-items:center;min-height:100vh;margin:4px}</style><p>Middle</p>`)
    post('zz6', 'Story', `<meta name="shepherdr-size" content="1080x1920"><style>body{background:#2563eb}</style>`)
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(at('place=p%3Avm-str%3Aherdr-projects&task=HP-201'))
    for (const t of ['Short page', 'Tall page', 'Screen page', 'Story']) {
      await page.locator(`[data-card] iframe[title="${t}"]`).scrollIntoViewIfNeeded()
      await settled(page, t)
    }
    // the content and the body's 12px padding on each side
    expect((await frameOf(page, 'Short page')).height).toBe(174)
    const tall = await frameOf(page, 'Tall page')
    expect(tall.height).toBe(Math.round(844 * 0.7))
    expect(tall.scroll).toBeGreaterThan(tall.client)
    // it grows a little with its frame, then stays: nowhere near the cap, and as tall again after the chat is shown again
    const screen = (await frameOf(page, 'Screen page')).height
    expect(screen).toBeLessThan(200)
    // in the app, so it remembers the heights it was told
    await page.evaluate(() => {
      history.pushState(null, '', '?place=p%3Avm-str%3Aherdr-projects&task=HP-202')
      dispatchEvent(new PopStateEvent('popstate'))
    })
    await page.locator('[data-card] iframe[title="Screen page"]').waitFor({ state: 'detached' })
    await page.goBack()
    await page.locator('[data-card] iframe[title="Screen page"]').scrollIntoViewIfNeeded()
    await settled(page, 'Screen page')
    expect((await frameOf(page, 'Screen page')).height).toBe(screen)
    // a tall design fits whole under the cap, centred
    const story = await frameOf(page, 'Story')
    expect(story.height).toBe(Math.round(844 * 0.7))
    expect(story.scroll).toBeLessThanOrEqual(story.client)
    const shown = await page.frameLocator('[data-card] iframe[title="Story"]').locator('body').evaluate((b) => b.getBoundingClientRect().toJSON())
    expect(Math.abs(shown.height - story.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(shown.left - (story.width - shown.width) / 2)).toBeLessThanOrEqual(1)
    await page.close()
    unpost()
  }, 40_000)

  test('margins inside a fixed-size design stay in it; a wide line scrolls sideways; a page held to 100% grows to its content', async () => {
    post('zz9', 'Margins', `<meta name="shepherdr-size" content="1200x630"><style>body{background:#16a34a;margin:30px}h1{margin:40px}</style><h1>Big</h1>`)
    post('zz10', 'Long line', `<p>Words that wrap.</p><pre>${'x'.repeat(400)}</pre>`)
    post('zz11', 'Held page', `<style>html,body{height:100%}</style><p style="height:300px;margin:0">Tall</p>`)
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(at('place=p%3Avm-str%3Aherdr-projects&task=HP-201'))
    for (const t of ['Margins', 'Long line', 'Held page']) {
      await page.locator(`[data-card] iframe[title="${t}"]`).scrollIntoViewIfNeeded()
      await settled(page, t)
    }
    const margins = await frameOf(page, 'Margins')
    expect(Math.abs(margins.height - (margins.width * 630) / 1200)).toBeLessThanOrEqual(1)
    expect(margins.scroll).toBeLessThanOrEqual(margins.client)
    const body = await page.frameLocator('[data-card] iframe[title="Margins"]').locator('body').evaluate((b) => b.getBoundingClientRect().toJSON())
    expect(Math.abs(body.top)).toBeLessThanOrEqual(1)
    expect(Math.abs(body.left)).toBeLessThanOrEqual(1)
    expect(Math.abs(body.width - margins.width)).toBeLessThanOrEqual(1)
    // not scaled: the words keep their size, the line scrolls
    const line = await page.frameLocator('[data-card] iframe[title="Long line"]').locator('html').evaluate((h) => ({ t: document.body.style.transform, wide: h.scrollWidth > h.clientWidth }))
    expect(line).toEqual({ t: '', wide: true })
    expect((await frameOf(page, 'Held page')).height).toBe(324)
    await page.close()
    unpost()
  }, 40_000)

  test("full screen, a fixed-size design fits the screen whole, centred; a card says whose it is like a bubble does", async () => {
    post('zz7', 'Tall story', `<meta name="shepherdr-size" content="1080x1920"><style>body{background:#2563eb}</style>`)
    post('zz8', 'Mine', `<p>Mine</p>`, 'you')
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(at('place=p%3Avm-str%3Aherdr-projects&task=HP-201'))
    // yours: the reply shade and its small corner bottom right; the agent's: the bubble shade, bottom left
    const look = (t: string) =>
      page
        .locator('[data-card]')
        .filter({ hasText: t })
        .evaluate((c) => ({ head: getComputedStyle(c.firstElementChild!).backgroundColor, right: getComputedStyle(c).borderBottomRightRadius, left: getComputedStyle(c).borderBottomLeftRadius }))
    const bubble = (sel: string) => page.locator(sel).first().evaluate((b) => getComputedStyle(b).backgroundColor)
    // and its header names who sent it
    expect(await page.locator('[data-card]').filter({ hasText: 'Mine' }).locator('> div').first().textContent()).toContain('You · v1')
    const mine = await look('Mine')
    const theirs = await look('Tall story')
    expect(mine).toMatchObject({ head: await bubble('.bg-reply'), right: '6px', left: '20px' })
    expect(theirs).toMatchObject({ head: await bubble('.bg-bubble'), right: '20px', left: '6px' })
    await page.goto(at('place=p%3Avm-str%3Aherdr-projects&task=HP-201&artifact=zz7'))
    const frame = page.locator('[role=dialog] iframe')
    // laid out at its size, then scaled
    await page.frameLocator('[role=dialog] iframe').locator('html.shepherdr-fixed').waitFor()
    await page.waitForTimeout(300)
    const box = (await frame.boundingBox())!
    const shown = await page.frameLocator('[role=dialog] iframe').locator('body').evaluate((b) => b.getBoundingClientRect().toJSON())
    expect(Math.abs(shown.height - box.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(shown.width - (1080 * box.height) / 1920)).toBeLessThanOrEqual(1)
    expect(Math.abs(shown.left - (box.width - shown.width) / 2)).toBeLessThanOrEqual(1)
    // the frame has the whole width
    expect(box.width).toBe(1280)
    await page.close()
    unpost()
  }, 30_000)

  test('media fits: as wide as the card and no taller than what shows, in the chat and full screen; a size set on purpose stays', async () => {
    const pic = (w: number, h: number) => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'%3E%3Crect width='${w}' height='${h}' fill='green'/%3E%3C/svg%3E`
    // a tall screenshot, a wide one held to the width with a border (as proofs do), a canvas and a chart by its viewBox
    post(
      'zz12',
      'Media',
      `<style>.shot{width:100%;border:1px solid var(--line)}</style><img id="tall" src="${pic(1000, 3000)}"><img id="wide" class="shot" src="${pic(1920, 1080)}"><canvas id="c" width="1200" height="600"></canvas><svg id="s" width="800" height="400" viewBox="0 0 800 400"></svg><img id="icon" style="width:40px;height:40px;object-fit:cover" src="${pic(100, 50)}">`,
    )
    const sizes = (page: Page, frame: string) =>
      page.frameLocator(frame).locator('html').evaluate((h) => ({
        w: h.clientWidth,
        media: Object.fromEntries([...h.querySelectorAll('img,canvas,svg')].map((e) => [e.id, { w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), right: e.getBoundingClientRect().right }])),
      }))
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(at('place=p%3Avm-str%3Aherdr-projects&task=HP-201'))
    await page.locator('[data-card] iframe[title="Media"]').scrollIntoViewIfNeeded()
    await settled(page, 'Media')
    const cap = Math.round(844 * 0.7)
    const chat = await sizes(page, '[data-card] iframe[title="Media"]')
    for (const id of ['tall', 'wide', 'c', 's']) {
      expect(chat.media[id].right).toBeLessThanOrEqual(chat.w - 12)
      expect(chat.media[id].h).toBeLessThanOrEqual(cap - 24)
    }
    // the tall one at most what shows, less the padding; the others keep their shape
    expect(chat.media.tall.h).toBe(cap - 24)
    expect(Math.abs(chat.media.c.h - chat.media.c.w / 2)).toBeLessThanOrEqual(1)
    expect(Math.abs(chat.media.s.h - chat.media.s.w / 2)).toBeLessThanOrEqual(1)
    expect(chat.media.icon).toMatchObject({ w: 40, h: 40 })
    // full screen: no taller than the screen's frame
    await page.goto(at('place=p%3Avm-str%3Aherdr-projects&task=HP-201&artifact=zz12'))
    await page.frameLocator('[role=dialog] iframe').locator('#tall').waitFor()
    await page.waitForTimeout(300)
    const box = (await page.locator('[role=dialog] iframe').boundingBox())!
    const full = await sizes(page, '[role=dialog] iframe')
    expect(full.media.tall.h).toBe(Math.round(box.height) - 24)
    expect(full.media.wide.right).toBeLessThanOrEqual(full.w - 12)
    await page.close()
    unpost()
  }, 30_000)

  test("the check names media that doesn't fit the page", async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    await page.setContent(wrapPage(`<img style="max-width:none;width:800px;height:100px" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='1'/%3E"><video style="max-height:none;height:2000px"></video>`, { check: true, phone: true }))
    const said = await page.evaluate(() => ((window as unknown as { __shepherdrMedia: () => void }).__shepherdrMedia(), (window as unknown as { __shepherdrCheck: string[] }).__shepherdrCheck))
    expect(said).toEqual(['media: img 1 (800×100 px) is wider than the page (390 px)', 'media: video 1 (300×2000 px) is taller than the screen (844 px)'])
    await page.close()
  })

  test('an earlier post of the same artifact folds to a line that opens that version', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await page.goto(at('place=p%3Avm-str%3Aherdr-projects&task=HP-201'))
    const fold = page.getByRole('button', { name: /Board with the fixed count v1 · newer below/ })
    await fold.waitFor()
    expect(await page.locator('iframe[title="Board with the fixed count"]').count()).toBe(1)
    await fold.tap()
    const dialog = page.getByRole('dialog', { name: 'Board with the fixed count' })
    await dialog.getByText('An older version: v1 of 2.').waitFor()
    await dialog.getByRole('button', { name: 'Show the latest' }).tap()
    await dialog.getByText('An older version').waitFor({ state: 'detached' })
    await page.close()
  }, 30_000)

  test("the phone's Artifacts tab lists the place's; one opens full screen, and Back closes it", async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await page.goto(at('place=vm-str/home'))
    await page.getByRole('button', { name: 'Artifacts' }).tap()
    // the places drawer is drawn all along, hidden: only the rows on screen count
    const rows = page.locator('li[role=button]').filter({ visible: true })
    await rows.first().waitFor()
    expect(await rows.allInnerTexts()).toHaveLength(5)
    await page.getByText('Disk use on vm-str').tap()
    const dialog = page.getByRole('dialog', { name: 'Disk use on vm-str' })
    await dialog.waitFor()
    // it pushes in like a page: measured once it has landed
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))))
    // full screen: as wide and tall as the phone
    const box = (await dialog.boundingBox())!
    expect(box.width).toBeCloseTo(390, 0)
    expect(box.height).toBeCloseTo(844, 0)
    expect(page.url()).toContain('artifact=a6')
    await page.goBack()
    await dialog.waitFor({ state: 'detached' })
    // its row (the dialog's still copy may be fading out over it)
    await page.getByRole('button', { name: /^Disk use on vm-str/ }).waitFor()
    await page.close()
  }, 30_000)

  test('writing beside it reaches its keeper, and the new version swaps in while you look', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(at('place=p%3Amac%3Alilla-varlden&artifact=a7'))
    const dialog = page.getByRole('dialog', { name: 'Upload page draft' })
    await dialog.getByText('v1 · LV-3 agent').waitFor()
    await dialog.getByRole('textbox').fill('Make the button bigger')
    await dialog.getByRole('button', { name: 'Send', exact: true }).click()
    await dialog.getByText("Sent. A new version shows here when it's in.").waitFor()
    expect(world.chat('LV-3/Agent').messages.find((m) => m.text === 'Make the button bigger')).toMatchObject({ who: 'you', answered: 'About "Upload page draft"' })
    await dialog.getByText('Updated to v2').waitFor({ timeout: 8000 })
    await dialog.getByText('v2 · LV-3 agent').waitFor()
    await page.close()
  }, 30_000)

  test('Mark up shows when it is on, with no tooltip', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(at('place=vm-str/home&artifact=a1'))
    const dialog = page.getByRole('dialog', { name: 'This week across machines' })
    const off = dialog.getByRole('button', { name: 'Mark up', exact: true })
    expect(await off.getAttribute('title')).toBeNull()
    expect(await off.textContent()).toContain('Mark up')
    expect(await dialog.getByRole('button', { name: 'Versions', exact: true }).textContent()).toContain(`v${world.artifacts.find((a) => a.id === 'a1')!.v}`)
    const bg = () => dialog.getByRole('button', { name: /^(Mark up|Done marking up)$/ }).evaluate((b) => getComputedStyle(b).backgroundColor)
    const idle = await bg()
    await off.click()
    const on = dialog.getByRole('button', { name: 'Done marking up' })
    expect(await on.getAttribute('aria-pressed')).toBe('true')
    // on: a tint behind it, not only a colour change
    await page.mouse.move(0, 0)
    expect(await bg()).not.toBe(idle)
    await on.click()
    await off.waitFor()
    await page.close()
  }, 30_000)

  test('a version with only new data goes into the open page without a reload', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(at('place=vm-str/home&artifact=a1'))
    const dialog = page.getByRole('dialog', { name: 'This week across machines' })
    const frame = page.frameLocator('[role=dialog] iframe')
    await frame.getByText('tasks merged this week').waitFor()
    await frame.locator('body').evaluate(() => ((window as unknown as { kept: number }).kept = 1))
    await dialog.getByRole('textbox').fill('Fresh numbers please')
    await dialog.getByRole('button', { name: 'Send', exact: true }).click()
    await dialog.getByText('Updated to v4').waitFor({ timeout: 8000 })
    await page.waitForTimeout(300)
    expect(await frame.locator('body').evaluate(() => (window as unknown as { kept?: number }).kept)).toBe(1)
    await page.close()
  }, 30_000)

  test("a task's full name in a title is not cut on the chat card or in the list, on a phone or a desktop", async () => {
    post('zz-long', LONG, '<p>Proof</p>')
    const whole = (loc: ReturnType<Page['locator']>) => loc.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)
    for (const viewport of [{ width: 360, height: 780 }, { width: 1280, height: 800 }]) {
      const page = await browser!.newPage({ viewport })
      await page.goto(at('place=p%3Avm-str%3Aherdr-projects&task=HP-201'))
      const card = page.locator('[data-card]', { hasText: LONG }).locator('button span.line-clamp-3').first()
      await card.waitFor()
      expect(await whole(card)).toBe(true)
      await page.close()
      const list = await browser!.newPage({ viewport })
      await list.goto(at('place=p%3Avm-str%3Aherdr-projects'))
      await list.getByRole('button', { name: 'Artifacts' }).first().click()
      const row = list.getByText(LONG).first()
      await row.waitFor()
      expect(await whole(row)).toBe(true)
      await list.close()
    }
    unpost()
  }, 30_000)
})


describe.skipIf(!browser)('compact artifact tools', () => {
  test('phone tools retain a readable version and named touch controls', async () => {
    const page = await browser!.newPage({ viewport: { width: 320, height: 740 }, hasTouch: true })
    try {
      await page.goto(`http://127.0.0.1:${server!.port}/?artifact=a1`)
      const dialog = page.getByRole('dialog', { name: 'This week across machines' })
      const versions = dialog.getByRole('button', { name: 'Versions', exact: true })
      expect(await versions.textContent()).toContain(`v${world.artifacts.find((a) => a.id === 'a1')!.v}`)
      const mark = dialog.getByRole('button', { name: 'Mark up', exact: true })
      expect((await mark.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await versions.click()
      await dialog.getByRole('menu', { name: 'Versions' }).waitFor()
      await page.keyboard.press('Escape')
      await mark.click()
      expect(await dialog.getByRole('button', { name: 'Done marking up' }).getAttribute('aria-pressed')).toBe('true')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    } finally {
      await page.close()
    }
  })
})
