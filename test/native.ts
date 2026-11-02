// The app as an installed app on a phone or tablet, shared by the native*.test.ts files: the demo world served from
// the screen built once (web.ts) and opened in a real browser, one of each per file; skipped where none is installed.
import { afterAll } from 'bun:test'
import type { Browser, Page } from 'playwright-core'
import { startApp } from '../server/app.ts'
import { DemoWorld } from '../server/demo/world.ts'
import type { Source } from '../server/source.ts'
import { launch } from './chromium.ts'
import { builtScreen } from './web.ts'

export const GTM = 'place=vm-str/gtm'

/** what has finished sliding in (the endless ones, like typing dots, aside) */
export const settled = (page: Page) =>
  page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))))

/** where the places drawer's left edge is: 0 open, its minus width shut */
export const drawerAt = (page: Page) => page.$eval('nav[aria-label=Spaces]', (n) => Math.round(n.getBoundingClientRect().left))
export const drawerOpen = async (page: Page) => (await page.$('[inert] > nav[aria-label=Spaces]')) === null && (await drawerAt(page)) === 0
export const query = (page: Page) => new URL(page.url()).searchParams

/** a browser and the demo world served to it, closed once the file's tests are done */
export async function native() {
  const browser: Browser | null = await launch()
  if (!browser) return { browser, at: (_q: string) => '', phone: undefined as unknown as ReturnType<typeof phoneIn> }
  const server = startApp({ source: new DemoWorld() as unknown as Source, dist: await builtScreen(), port: 0 })
  afterAll(async () => {
    await browser.close()
    server.stop(true)
  })
  return { browser, at: (q: string) => `http://127.0.0.1:${server.port}/?${q}`, phone: phoneIn(browser) }
}

/** a phone with a finger: swipes go through the browser's own touch handling (CDP), like a real one */
const phoneIn = (browser: Browser) => async (o: { width?: number; height?: number; dark?: boolean } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: o.width ?? 390, height: o.height ?? 844 }, hasTouch: true, isMobile: true, colorScheme: o.dark ? 'dark' : 'light' })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  const swipe = async (x0: number, y0: number, x1: number, y1: number, ms = 180) => {
    const steps = 12
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] })
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] })
      await page.waitForTimeout(ms / steps)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  /** a quick flick, timed as a finger does it: a move every 16ms, let go 8ms after the last (the browser may fold
   *  them into one or two moves, as a phone does); `hold`: held still that long before letting go */
  const flick = async (x0: number, y0: number, x1: number, y1: number, ms = 80, hold = 0) => {
    const steps = Math.max(1, Math.round(ms / 16))
    const t0 = Date.now() / 1000
    const sends = [cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }], timestamp: t0 })]
    for (let i = 1; i <= steps; i++)
      sends.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }], timestamp: t0 + i * 0.016 }))
    sends.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + steps * 0.016 + 0.008 + hold / 1000 }))
    await Promise.all(sends)
  }
  /** a finger put down and moved step by step, held there: where the drawer's right edge is after each step */
  const drag = async (pts: [number, number][]) => {
    const at: number[] = []
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] })
    for (const [x, y] of pts.slice(1)) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
      await page.waitForTimeout(20)
      at.push(await page.$eval('nav[aria-label=Spaces]', (n) => n.getBoundingClientRect().right))
    }
    return { at, up: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
  }
  return { ctx, page, swipe, flick, drag }
}
