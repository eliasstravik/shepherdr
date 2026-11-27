// Run with a built app: bun run build && bun web/demo/scroll-check.ts [demo URL]
import assert from 'node:assert/strict'
import { chromium, type Page } from 'playwright-core'
import { chrome } from './tap-check.ts'
import { EV } from './data.ts'
import type { Chat, Message } from '../shared/types.ts'

const demo = process.argv[2] ? null : await startDemo()
const base = process.argv[2] ?? demo!.url
const shop = 'p:mac-mini:shop'
const task = 'SHOP-15'
const taskChat = `${task}/worker`
const messages: Message[] = Array.from({ length: 2500 }, (_, i) => ({
  id: `line-${i}`, who: 'agent', text: `History message ${i}`,
}))
const newest = '[data-msg="line-2499"]'

async function startDemo() {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  const server = Bun.spawn(['bun', new URL('./serve.ts', import.meta.url).pathname, String(port)], { stdout: 'ignore', stderr: 'inherit' })
  const url = `http://127.0.0.1:${port}/`
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) return { server, url } } catch { /* still starting */ }
    await Bun.sleep(100)
  }
  server.kill()
  throw new Error('The built demo did not start')
}

const frames = (page: Page) => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
const gap = (page: Page, chat = EV) => page.locator(`[data-scroll="${chat}"]`).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
const bottom = async (page: Page, why: string, chat = EV) => {
  await frames(page)
  const distance = await gap(page, chat)
  assert.ok(distance <= 1, `${why}: ${distance}px from the bottom`)
}

async function history(page: Page, initial: Message[] = [], earlier = false) {
  const chats = new Map<string, Chat>()
  let send: ((s: string) => void) | undefined
  const chat = (key: string, rows: Message[], more = false) => ({ key, messages: rows, cli: 'claude' as const, earlier: more, top: !more })
  for (const key of [EV, shop, taskChat]) chats.set(key, chat(key, initial, earlier))
  await page.routeWebSocket('**/api/ws', (ws) => {
    const demo = ws.connectToServer()
    send = (data) => ws.send(data)
    demo.onMessage((data) => {
      const reply = JSON.parse(String(data))
      if (reply.type === 'chat' && chats.has(reply.chat.key)) ws.send(JSON.stringify({ type: 'chat', chat: chats.get(reply.chat.key) }))
      else ws.send(data)
    })
  })
  const update = (rows: Message[], key = EV, more = false) => {
    const next = chat(key, rows, more)
    chats.set(key, next)
    send?.(JSON.stringify({ type: 'chat', chat: next }))
  }
  const open = (params: Record<string, string>) => send?.(JSON.stringify({ type: 'go', url: `./?${new URLSearchParams(params)}` }))
  return { update, open }
}

async function firstPosition(page: Page, marker: string) {
  await page.evaluate((selector) => {
    const results = document.body.dataset
    delete results.firstGap
    const observer = new MutationObserver(() => {
      const end = document.querySelector(selector)
      const sc = end?.closest('.scroll')
      if (!sc?.clientHeight) return
      results.firstGap = String(sc.scrollHeight - sc.clientHeight - sc.scrollTop)
      observer.disconnect()
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }, marker)
}

/** A late size and two writes, as from a tall agent screen in a much shorter pane. */
async function terminal(page: Page) {
  let send: ((data: string | Buffer) => void) | undefined
  await page.routeWebSocket('**/api/terminal?*', (ws) => {
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw))
      ws.send(JSON.stringify({ type: 'ack', id: msg.id }))
      if (msg.type === 'open') send = (data) => ws.send(data)
    })
  })
  return async (key: string) => {
    const box = page.locator(`[data-term="${key}"]`)
    await box.waitFor()
    await box.locator('.xterm-rows').waitFor()
    await frames(page)
    assert.ok(send, 'terminal requested its stream')
    const shell = key.startsWith('sh:')
    send(JSON.stringify({ type: 'size', cols: 42, rows: shell ? 10 : 115 }))
    send(Buffer.from(Array.from({ length: 90 }, (_, i) => `Output row ${i}\r\n`).join('') + 'First prompt'))
    const atFoot = async (text: string) => {
      const row = box.getByText(text, { exact: true })
      await row.waitFor()
      // xterm replaces row nodes on redraw. Measure from the box, which stays mounted.
      const visible = await box.evaluate((el, text) => {
        const row = [...el.querySelectorAll('.xterm-rows > div')].find((row) => row.textContent?.replace(/\s+/g, ' ').trim() === text)
        if (!row) return false
        const { top, bottom } = row.getBoundingClientRect()
        const view = el.getBoundingClientRect()
        return top >= view.top && bottom <= view.bottom + 1
      }, text)
      assert.ok(visible, `${text} is in the terminal's viewport as soon as it draws`)
    }
    await atFoot('First prompt')
    send(Buffer.from('\r\nNew prompt'))
    await atFoot('New prompt')
    const viewport = page.viewportSize()!
    if (viewport.width < 600) {
      await page.setViewportSize({ ...viewport, height: 510 })
      await frames(page)
      await atFoot('New prompt')
      await page.setViewportSize(viewport)
    }
    if (shell) await box.locator('..').locator('.tcap').dispatchEvent('wheel', { deltaY: -650 })
    else await box.evaluate((el) => { el.scrollTop = 0 })
    await frames(page)
    assert.equal(await box.getByText('New prompt', { exact: true }).count(), shell ? 0 : 1, 'terminal can scroll into history')
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    await atFoot('New prompt')
    send = undefined
  }
}

async function runChecks() {
  const browser = await chromium.launch({ executablePath: chrome(), ignoreDefaultArgs: ['--disable-back-forward-cache'] })
  try {
    for (const [width, colorScheme] of [[390, 'dark'], [1280, 'light'], [390, 'light'], [1280, 'dark']] as const) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, colorScheme, hasTouch: width < 600 })
      page.setDefaultTimeout(8000)
      try {
        const { update, open } = await history(page)
        const checkTerminal = await terminal(page)
        await page.goto(base)
        const sc = page.locator(`[data-scroll="${EV}"]`)
        await sc.waitFor()
        await firstPosition(page, newest)
        update(messages.slice(-100))
        await sc.locator(newest).waitFor()
        assert.equal(await page.locator('body').getAttribute('data-first-gap'), '0', 'first visible history layout')
        await bottom(page, 'first history page')
        update(messages)
        await sc.locator('[data-msg="line-0"]').waitFor({ state: 'attached' })
        await bottom(page, 'older history added')

        let releaseImage!: () => void
        const imageReady = new Promise<void>((resolve) => { releaseImage = resolve })
        await page.route('**/api/file?*late.svg*', async (route) => {
          await imageReady
          await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="100%" height="100%" fill="green"/></svg>' })
        })
        const media: Message = { id: 'late-picture', who: 'you', file: { name: 'late.svg', path: 'late.svg' } }
        const code: Message = { id: 'code', who: 'agent', text: '```sh\necho "one"\necho "two"\n```' }
        update([...messages, media, code])
        const pic = sc.locator('[data-msg="late-picture"] img')
        await pic.waitFor({ state: 'attached' })
        releaseImage()
        await pic.evaluate((img: HTMLImageElement) => { img.loading = 'eager'; return img.decode() })
        await bottom(page, 'late image and code')

        if (width < 600) {
          await page.getByRole('textbox', { name: 'Message Shepherdr' }).focus()
          await page.setViewportSize({ width, height: 510 })
          await bottom(page, 'keyboard opens')
          await page.setViewportSize({ width, height: 844 })
          await bottom(page, 'keyboard closes')
        }
        await sc.evaluate((el) => { el.scrollTop -= 2400 })
        await frames(page)
        const at = await sc.evaluate((el) => el.scrollTop)
        const latest: Message[] = [...messages, media, code, { id: 'new', who: 'agent', text: 'New answer' }]
        update(latest)
        await sc.locator('[data-msg="new"]').waitFor({ state: 'attached' })
        await frames(page)
        assert.equal(await sc.evaluate((el) => el.scrollTop), at, 'new output must leave a reader in place')
        await page.getByRole('button', { name: '1 new message, go to the newest' }).click()
        await bottom(page, 'new messages button')

        await sc.evaluate((el) => { el.scrollTop -= 2400 })
        await frames(page)
        await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
        await bottom(page, 'restored page')

        await sc.evaluate((el) => { el.scrollTop -= 2400 })
        await frames(page)
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
        await bottom(page, 'returned to tab')

        await sc.evaluate((el) => { el.scrollTop -= 2400 })
        await frames(page)
        open({ place: EV })
        await bottom(page, 'notification opens the same chat')

        update(messages.slice(-100), shop)
        open({ place: shop })
        await page.locator(`[data-scroll="${shop}"] ${newest}`).waitFor()
        await bottom(page, 'another space opens', shop)

        update(messages.slice(-100), taskChat, true)
        open({ place: shop, max: task })
        await page.locator(`[data-scroll="${taskChat}"] ${newest}`).waitFor()
        await bottom(page, 'task opens directly into the main view', taskChat)

        await page.route('**/api/action', async (route) => {
          const action = route.request().postDataJSON()
          if (action?.type === 'earlier' && action.chat === taskChat) update(messages, taskChat)
          await route.continue()
        })
        open({ place: shop, task, focus: 'line-1800' })
        const target = page.locator(`[data-scroll="${taskChat}"] [data-msg="line-1800"]`)
        await target.waitFor()
        assert.ok(await target.evaluate((el) => {
          const box = el.closest('.scroll')!.getBoundingClientRect()
          const row = el.getBoundingClientRect()
          return Math.abs((row.top + row.bottom - box.top - box.bottom) / 2) < 2
        }), 'the linked message is shown even when it comes in a later page')
        open({ place: shop, task })
        await bottom(page, 'task reopened', taskChat)
        const taskScroll = page.locator(`.pane [data-scroll="${taskChat}"]`)
        await taskScroll.evaluate((el) => { el.scrollTop -= 1200 })
        await page.locator('.pane .toend').click()
        await bottom(page, 'jump to the newest from the task pane', taskChat)

        await page.getByRole('button', { name: 'View as terminal', exact: true }).last().click()
        await checkTerminal(taskChat)
        await page.getByRole('button', { name: 'View as chat', exact: true }).click()
        await bottom(page, 'from terminal back to task chat', taskChat)

        await page.getByRole('region', { name: 'tasks' }).getByRole('button', { name: 'More', exact: true }).click()
        await page.getByRole('menuitemcheckbox', { name: /^Terminal\b/ }).click()
        await checkTerminal(`sh:task:${task}`)
        await page.getByRole('button', { name: 'Close the terminal' }).click()

        open({ place: EV })
        await sc.locator(newest).waitFor()
        await bottom(page, 'switch back to first chat')
        await page.getByRole('region', { name: 'Chat' }).getByRole('button', { name: 'Everything', exact: true }).click()
        await page.getByRole('menuitemcheckbox', { name: /^Terminal\b/ }).click()
        await checkTerminal(`sh:${EV}`)
        await page.getByRole('button', { name: 'Close the terminal' }).click()
        console.log(`${width}px ${colorScheme}: chats and terminal open at the bottom`)
      } finally {
        await page.close()
      }
    }
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await page.addInitScript(() => addEventListener('pageshow', (e) => { document.body.dataset.restored = String(e.persisted) }))
    await page.goto(base)
    const sc = page.locator(`[data-scroll="${EV}"]`)
    await sc.locator('[data-msg]').first().waitFor()
    await bottom(page, 'initial page before browser Back')
    await sc.evaluate((el) => { el.scrollTop = 20 })
    await frames(page)
    assert.ok(await gap(page) > 100)
    await page.goto('data:text/html,<p>Another page</p>')
    await page.goBack({ waitUntil: 'commit' })
    await sc.locator('[data-msg]').first().waitFor()
    await bottom(page, 'browser Back')
    console.log(`Browser Back reopened at the bottom (restored from cache: ${await page.locator('body').getAttribute('data-restored')})`)
  } finally {
    await browser.close()
  }
}

try {
  await runChecks()
} finally {
  demo?.server.kill()
}
