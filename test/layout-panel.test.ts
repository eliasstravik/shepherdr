// A task's side panel: terminal, files, diff, pull request and browser, in a real browser (layout.ts).
import { describe, expect, test } from 'bun:test'
import type { Page, WebSocketRoute } from 'playwright-core'
import { Browsers, browserEnv } from '../server/demo/browser.ts'
import { fakeAgentBrowser } from './fake-agent-browser.ts'
import { layout, settled, until } from './layout.ts'

const { browser, world, server } = await layout()

describe.skipIf(!browser)("a task's side panel", () => {
  const task = (id: string) => `http://127.0.0.1:${server!.port}/?place=p:vm-str:gtm&task=${id}`
  const width = (page: Page, sel: string) => page.$eval(sel, (el) => Math.round(el.getBoundingClientRect().width))

  test('widening a compact task/tool view subscribes to its split chats again', async () => {
    const page = await browser!.newPage({ viewport: { width: 1024, height: 850 } })
    await page.addInitScript(() => {
      localStorage.setItem('shepherdr.sidebars', JSON.stringify({ panelOpen: true, focus: false }))
      localStorage.setItem('shepherdr.panes', JSON.stringify({ panes: [{ kind: 'place', id: 'p:vm-str:~' }, { kind: 'place', id: 'p:vm-str:gtm' }], pane: -1, sizes: [1, 1] }))
    })
    const watches: string[][] = []
    page.on('websocket', (socket) => socket.on('framesent', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload))
        if (message.type === 'watch') watches.push(message.chats)
      } catch { /* other socket traffic */ }
    }))
    await page.goto(task('GTM-14'))
    await page.getByRole('button', { name: 'Show gtm', exact: true }).waitFor()
    expect(await until(() => Promise.resolve(watches.at(-1)?.length), (n) => n === 1)).toBe(1)
    await page.setViewportSize({ width: 1920, height: 1000 })
    expect(await until(() => Promise.resolve(watches.at(-1)?.length), (n) => n === 3)).toBe(3)
    await page.close()
  })

  test('a panel kept open while resizing preserves readable task chat and can give the coordinator its room back', async () => {
    const page = await browser!.newPage({ viewport: { width: 1920, height: 900 } })
    await page.goto(task('GTM-14'))
    await page.getByRole('button', { name: 'Show task panel', exact: true }).click()
    await page.getByRole('button', { name: 'Hide gtm', exact: true }).waitFor()
    // Open on a wide screen (no saved focus), then shrink below the room for chat + task + tool.
    await page.setViewportSize({ width: 1024, height: 850 })
    await settled(page)
    await page.getByRole('button', { name: 'Show gtm', exact: true }).waitFor()
    const chat = page.locator('section:has(textarea[aria-label="Message GTM-14…"])').last()
    expect((await chat.boundingBox())!.width).toBeGreaterThanOrEqual(360)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024)
    await page.getByRole('button', { name: 'Show gtm', exact: true }).click()
    await page.getByRole('button', { name: 'Show task panel', exact: true }).waitFor()
    await page.getByRole('textbox', { name: 'Message gtm…' }).waitFor()
    await page.setViewportSize({ width: 2560, height: 1000 })
    await settled(page)
    // Width alone never opens a tool.
    expect(await page.getByRole('button', { name: 'Show task panel', exact: true }).count()).toBe(1)
    await page.close()
  })

  test('a toggle in the task header opens it beside the chat; its width and item stay after a reload (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    await page.goto(task('GTM-15'))
    const toggle = page.getByRole('button', { name: 'Show task panel' })
    await toggle.click()
    const tabs = page.getByRole('tablist', { name: 'Task panel' }).getByRole('tab')
    expect(await tabs.allTextContents()).toEqual(['Terminal', 'Files', 'Diff', 'Pull request', 'Browser', 'Artifacts'])
    expect(await page.getByRole('tab', { name: 'Diff' }).getAttribute('aria-selected')).toBe('true')
    expect(await width(page, '#task-panel')).toBe(560)
    // the chat beside it keeps its room
    const chat = await page.$eval('section:has(textarea[aria-label^="Message GTM-15"])', (s) => s.getBoundingClientRect().width)
    expect(chat).toBeGreaterThanOrEqual(320)
    // dragged wider: tasks give way, the chat keeps its room
    const sep = (await page.getByRole('separator', { name: 'Resize the task panel' }).boundingBox())!
    await page.mouse.move(sep.x + sep.width / 2, sep.y + 200)
    await page.mouse.down()
    await page.mouse.move(sep.x + sep.width / 2 - 60, sep.y + 200, { steps: 4 })
    await page.mouse.up()
    expect(await width(page, '#task-panel')).toBe(620)
    await page.getByRole('tab', { name: 'Files' }).click()
    await page.reload()
    await page.getByRole('tab', { name: 'Files', selected: true }).waitFor()
    expect(await width(page, '#task-panel')).toBe(620)
    // hidden, it is out of the way and out of reach
    await page.getByRole('button', { name: 'Hide task panel' }).first().click()
    await page.waitForTimeout(350)
    expect(await page.$eval('#task-panel', (n) => n.parentElement!.inert)).toBe(true)
    expect(await page.$eval('#task-panel', (n) => Math.round(n.parentElement!.getBoundingClientRect().width))).toBe(0)
    await page.reload()
    await page.getByRole('button', { name: 'Show task panel' }).waitFor()
    // a coordinator chat has none
    await page.getByRole('button', { name: 'Back' }).click()
    expect(await page.getByRole('button', { name: /task panel$/ }).count()).toBe(0)
    expect(await page.$('#task-panel')).toBeNull()
    await page.close()
  }, 30_000)

  test("focus hides the coordinator's chat for the task: by itself on a narrow window, with its toggle or F; the panel widens (desktop)", async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(task('GTM-15'))
    const coordinator = 'section:has(textarea[aria-label^="Message gtm"])'
    const shown = () => page.$eval(coordinator, (s) => Math.round(s.parentElement!.getBoundingClientRect().width))
    // each width is read once it has slid there (until)
    const panelWidth = () => width(page, '#task-panel')
    await page.locator(coordinator).waitFor()
    expect(await shown()).toBeGreaterThan(300)
    // the panel opened on a window this narrow: the coordinator's chat and places slide shut, out of reach
    await page.getByRole('button', { name: 'Show task panel' }).click()
    expect(await until(shown, (w) => w === 0)).toBe(0)
    expect(await page.$eval(coordinator, (s) => s.parentElement!.inert)).toBe(true)
    // its toggle shows it is on, as the panel's does
    expect(await page.getByRole('button', { name: 'Show gtm' }).getAttribute('aria-pressed')).toBe('true')
    expect(await until(() => page.$eval('#places', (n) => Math.round(n.parentElement!.getBoundingClientRect().width)), (w) => w === 0)).toBe(0)
    expect(await until(() => width(page, 'section:has(textarea[aria-label^="Message GTM-15"])'), (w) => w === 1440 - 560)).toBe(1440 - 560)
    // widened, the panel takes all but the chat's least, and stays so after a reload
    await page.getByRole('button', { name: 'Widen the task panel' }).click()
    expect(await until(panelWidth, (w) => w === 1440 - 360)).toBe(1440 - 360)
    await page.reload()
    await page.getByRole('button', { name: 'Narrow the task panel' }).waitFor()
    expect(await until(panelWidth, (w) => w === 1440 - 360)).toBe(1440 - 360)
    // its toggle brings the coordinator's chat back, the panel at its own width
    await page.getByRole('button', { name: 'Show gtm' }).click()
    expect(await until(shown, (w) => w >= 360)).toBeGreaterThanOrEqual(360)
    expect(await page.getByRole('button', { name: 'Hide gtm' }).getAttribute('aria-pressed')).toBe('false')
    expect(await page.getByRole('button', { name: 'Widen the task panel' }).count()).toBe(1)
    // F and back; ⇧F widens; closing the panel ends the focus it brought
    await page.keyboard.press('f')
    expect(await until(shown, (w) => w === 0)).toBe(0)
    await page.keyboard.press('f')
    expect(await until(shown, (w) => w >= 360)).toBeGreaterThanOrEqual(360)
    await page.keyboard.press('Shift+F')
    expect(await until(panelWidth, (w) => w === 1440 - 360)).toBe(1440 - 360)
    await page.getByRole('button', { name: 'Hide task panel' }).first().click()
    expect(await until(shown, (w) => w > 300)).toBeGreaterThan(300)
    // a tablet: the task's chat takes the whole screen, and gives it back
    await page.setViewportSize({ width: 900, height: 800 })
    await page.getByRole('button', { name: 'Hide gtm' }).click()
    expect(await until(shown, (w) => w === 0)).toBe(0)
    expect(await until(() => width(page, 'section:has(textarea[aria-label^="Message GTM-15"])'), (w) => w === 900)).toBe(900)
    await page.getByRole('button', { name: 'Show gtm' }).click()
    expect(await until(shown, (w) => w > 300)).toBeGreaterThan(300)
    await page.close()
  }, 30_000)

  test('Diff: the changed files as a tree with their counts, a file opens as its unified diff, highlighted (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    await page.goto(task('GTM-15'))
    await page.getByRole('button', { name: 'Show task panel' }).click()
    await page.getByRole('tab', { name: 'Diff' }).click()
    const panel = page.locator('#task-panel')
    await panel.getByText('4 files changed').waitFor()
    expect(await panel.getByText('+23').first().isVisible()).toBe(true)
    // folders show open, a lone folder joined with its folder
    const rows = panel.getByRole('tree', { name: 'Changed files' }).getByRole('treeitem')
    expect(await rows.evaluateAll((rs) => rs.map((r) => r.textContent))).toEqual(['src/webhooks', 'handler.ts+4−3M (Changed)', 'legacy.ts−3D (Deleted)', 'signature.ts+6−3M (Changed)', 'test', 'signature.test.ts+13A (Added)'])
    await rows.filter({ hasText: 'signature.ts' }).first().click()
    const diff = panel.getByRole('table', { name: 'Changes in src/webhooks/signature.ts' })
    await diff.waitFor()
    expect(await diff.locator('tr[data-line=add]').count()).toBe(6)
    expect(await diff.locator('tr[data-line=del]').count()).toBe(3)
    // highlight.js loads on its own and colours the code
    await diff.locator('.hljs-keyword').first().waitFor()
    // a line added is washed green, one taken out red, in light and dark
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      // the app follows the device's mode a moment later, from its own listener
      await page.waitForFunction((s) => document.documentElement.dataset.theme === s, scheme)
      const bg = await diff.locator('tr[data-line=add]').first().evaluate((r) => getComputedStyle(r).backgroundColor)
      expect(bg).toMatch(scheme === 'light' ? /rgba\(48, 164, 108/ : /rgba\(61, 214, 140/)
    }
    // the keyboard walks the tree (a narrow panel shows the list or a file: back to the list first)
    await panel.getByRole('button', { name: 'Changed files' }).click()
    await rows.first().focus()
    await page.keyboard.press('ArrowLeft')
    expect(await rows.count()).toBe(3)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await panel.getByRole('table', { name: 'Changes in src/webhooks/handler.ts' }).waitFor()
    await page.close()
  }, 30_000)

  test('Files: browse and read the worktree, find a file by name; Pull request shows its state and checks (desktop)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    await page.goto(task('GTM-15'))
    await page.getByRole('button', { name: 'Show task panel' }).click()
    await page.getByRole('tab', { name: 'Files' }).click()
    const panel = page.locator('#task-panel')
    const tree = panel.getByRole('tree', { name: 'Files' })
    await tree.getByRole('treeitem', { name: 'src' }).click()
    await tree.getByRole('treeitem', { name: 'server.ts' }).click()
    await panel.locator('.code-view').getByText('Bun', { exact: false }).first().waitFor()
    expect(await panel.locator('.code-view tr').count()).toBe(10)
    await panel.getByRole('button', { name: 'All files' }).click()
    await panel.getByRole('textbox', { name: 'Find a file' }).fill('sig')
    expect(await panel.getByRole('list', { name: 'Files found' }).getByRole('listitem').count()).toBe(2)
    await panel.getByRole('listitem').filter({ hasText: 'signature.test.ts' }).click()
    await panel.locator('.code-view').getByText('re-encoded').waitFor()
    // a binary file says so
    await panel.getByRole('button', { name: 'All files' }).click()
    await panel.getByRole('textbox', { name: 'Find a file' }).fill('logo')
    await panel.getByRole('listitem').first().click()
    await panel.getByText('A binary file: nothing to read here.').waitFor()
    await page.getByRole('tab', { name: 'Pull request' }).click()
    await panel.getByRole('heading', { name: 'Fix webhook signature check' }).waitFor()
    expect(await panel.getByText('#128').isVisible()).toBe(true)
    expect(await panel.getByText('1 running · 2 passed').isVisible()).toBe(true)
    expect(await panel.getByRole('link', { name: 'Open on GitHub' }).getAttribute('href')).toBe('https://github.com/example/gtm/pull/128')
    // another tab after it draws its own view
    await page.getByRole('tab', { name: 'Diff' }).click()
    await panel.getByText('4 files changed').waitFor()
    // a task with no PR: greyed out, with a short hint
    await page.goto(task('GTM-14'))
    const pr = page.getByRole('tab', { name: 'Pull request' })
    await pr.and(page.locator('[data-off]:not([title])')).waitFor()
    await page.close()
  }, 30_000)

  test("Terminal is an item: a click puts the keys into it, Ctrl+` opens it and goes back to the chat (desktop)", async () => {
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    await page.goto(task('GTM-14'))
    const box = page.getByRole('textbox', { name: /Message GTM-14/ })
    await box.waitFor()
    // no terminal button in the header any more: the panel holds it
    expect(await page.getByRole('button', { name: 'Terminal' }).count()).toBe(0)
    await page.keyboard.press('Control+`')
    await page.getByRole('tab', { name: 'Terminal', selected: true }).waitFor()
    const screen = page.locator('#task-panel [role=log][aria-label=Terminal]')
    await screen.getByText('GTM-14 agent').waitFor()
    await page.waitForFunction(() => document.activeElement?.matches('#task-panel [role=log]'))
    await page.keyboard.type('hi')
    await screen.getByText('> hi').waitFor()
    // Esc goes in too, and doesn't close the task
    await page.keyboard.press('Escape')
    expect(page.url()).toContain('task=GTM-14')
    await page.keyboard.press('Control+`')
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Message GTM-14'))
    // typing in the chat stays in the chat
    await page.keyboard.type('x')
    expect(await box.inputValue()).toBe('x')
    await page.close()
  }, 30_000)

  /** a terminal's screen: its pane's columns, the font it draws at, its rows, how wide it is and its box */
  const drawn = (page: Page, sel: string) =>
    page.$eval(sel, (el) => {
      const box = el as HTMLElement
      return {
        cols: Number(box.dataset.cols),
        font: Number(box.dataset.font),
        rows: [...box.querySelectorAll('.xterm-rows > div')].map((r) => r.textContent!.replace(/\s+$/, '')),
        wide: box.scrollWidth,
        width: box.clientWidth,
        radius: getComputedStyle(box).borderRadius,
      }
    })
  const ruled = (rows: string[]) => rows.filter((r) => /^─+$/.test(r))

  test("a terminal is drawn at its pane's own width: no line wraps, the font fits the columns, one quiet hint (desktop)", async () => {
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    // the coordinator's, flipping its chat
    await page.goto(`http://127.0.0.1:${server!.port}/?place=p:vm-str:gtm`)
    await page.getByRole('textbox', { name: /Message gtm/ }).waitFor()
    await page.keyboard.press('Control+`')
    const coord = '[role=log][aria-label=Terminal]'
    await page.locator(coord).getByText('gtm · Claude Code').waitFor()
    let t = await drawn(page, coord)
    expect(t.cols).toBe(100)
    // the rulers each fill one row, the whole width: none breaks into several
    expect(ruled(t.rows).map((r) => r.length)).toEqual([100, 100])
    expect(t.rows.at(-1)).toContain('bypass permissions on')
    // a wide box keeps the font calm; nothing goes past its edge; no card around it
    expect(t.font).toBe(13)
    expect(t.wide).toBe(t.width)
    expect(t.radius).toBe('0px')
    // the hint is one line of words
    const lines = await page.getByText('Keys go to the terminal · Ctrl+` back to the chat').evaluate((el) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      return r.getClientRects().length
    })
    expect(lines).toBe(1)
    await page.keyboard.press('Control+`')
    // a task's, in its side panel: the font shrinks so the 100 columns fit the panel
    await page.goto(task('GTM-14'))
    await page.getByRole('textbox', { name: /Message GTM-14/ }).waitFor()
    await page.keyboard.press('Control+`')
    const panel = '#task-panel [role=log][aria-label=Terminal]'
    await page.locator(panel).getByText('GTM-14 agent').waitFor()
    t = await drawn(page, panel)
    expect(ruled(t.rows).map((r) => r.length)).toEqual([100, 100])
    expect(t.font).toBeGreaterThanOrEqual(8)
    expect(t.font).toBeLessThan(13)
    expect(t.wide).toBe(t.width)
    expect(await page.locator('#task-panel').getByText('Click to type · Ctrl+` back to the chat').count()).toBe(1)
    // over the drawn lines, Ctrl and the wheel (a trackpad's pinch) zoom, and the wheel then pans the wider screen
    const drawnLines = page.locator(`${panel} .xterm-screen`)
    await drawnLines.hover()
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -300)
    await page.keyboard.up('Control')
    await page.waitForFunction((s) => Number(document.querySelector<HTMLElement>(s)!.dataset.font) === 24, panel)
    await drawnLines.hover()
    await page.mouse.wheel(200, 0)
    await page.waitForFunction((s) => document.querySelector(s)!.scrollLeft > 0, panel)
    // a click on the drawn screen still puts the keys into it
    await page.keyboard.press('Control+`')
    await page.locator(panel).click()
    await page.keyboard.type('yo')
    await page.locator(panel).getByText('> yo').waitFor()
    await page.close()
  }, 30_000)

  test("a live terminal is drawn at the terminal's own size, whatever the view's: told by the server, followed when it moves", async () => {
    const snapshot = world!.snapshot.bind(world)
    world!.snapshot = () => ({ ...snapshot(), terminalTransport: 'core' })
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    const from: { type: string; text?: string; cols?: number }[] = []
    let core: WebSocketRoute | undefined
    const paint = (ws: WebSocketRoute, cols: number, rows: number) => {
      ws.send(JSON.stringify({ type: 'size', cols, rows }))
      // what Claude Code draws: its text at the top, a whole-width ruler, its prompt pinned to the last row
      ws.send(Buffer.from(`\x1b[H\x1b[2JHello from the top\r\n${'─'.repeat(cols)}\x1b[${rows};1H> prompt`))
    }
    await page.routeWebSocket(/\/api\/terminal/, (ws) => {
      core = ws
      ws.onMessage((raw) => {
        const message = JSON.parse(String(raw))
        from.push(message)
        if (message.type === 'open') paint(ws, 200, 120)
        ws.send(JSON.stringify({ type: 'ack', id: message.id }))
      })
    })
    await page.goto(task('GTM-14'))
    await page.getByRole('textbox', { name: /Message GTM-14/ }).waitFor()
    await page.keyboard.press('Control+`')
    const panel = '#task-panel [role=log][aria-label=Terminal]'
    await page.locator(panel).getByText('> prompt').waitFor()
    const shown = async () => {
      const t = await drawn(page, panel)
      return { ...t, rows: t.rows.filter(Boolean), lines: await page.$eval(panel, (el) => [...el.querySelectorAll<HTMLElement>('.xterm-rows > div')].filter((r) => r.offsetHeight).length) }
    }
    let t = await until(shown, (v) => v.cols === 200)
    expect(t.cols).toBe(200)
    // nothing wraps: the ruler fills one row; too wide for the panel, it pans at the smallest font
    expect(ruled(t.rows).map((r) => r.length)).toEqual([200])
    expect(t.font).toBe(8)
    expect(t.wide).toBeGreaterThan(t.width)
    // the blank rows of a tall terminal fold: the prompt pinned to its row 120 sits under the text, in view
    expect(t.lines).toBeLessThan(10)
    const prompt = await page.locator(panel).getByText('> prompt').boundingBox()
    const box = await page.locator(panel).boundingBox()
    expect(prompt!.y + prompt!.height).toBeLessThanOrEqual(box!.y + box!.height)
    // resizing the window says no size to the server
    await page.setViewportSize({ width: 1300, height: 800 })
    await page.waitForTimeout(200)
    expect(from.map((m) => m.type)).toEqual(['open'])
    expect(from[0].cols).toBeUndefined()
    // keys still go in
    await page.locator(panel).click()
    await page.keyboard.type('y')
    await until(() => Promise.resolve(from.at(-1)?.type), (v) => v === 'text')
    expect(from.at(-1)!.text).toBe('y')
    // something else moved the terminal: the view follows, from a clean paint
    paint(core!, 90, 30)
    t = await until(shown, (v) => v.cols === 90)
    expect(ruled(t.rows).map((r) => r.length)).toEqual([90])
    expect(t.rows.filter((r) => r.includes('prompt'))).toEqual(['> prompt'])
    world!.snapshot = snapshot
    await page.close()
  }, 30_000)

  test("on a phone it pans sideways where the font would be too small, and two fingers zoom it", async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await page.goto(`${task('GTM-14')}&item=terminal`)
    const sel = '[role=dialog] [role=log][aria-label=Terminal]'
    await page.locator(sel).getByText('GTM-14 agent').waitFor()
    let t = await drawn(page, sel)
    expect(ruled(t.rows).map((r) => r.length)).toEqual([100, 100])
    expect(t.font).toBe(8)
    expect(t.wide).toBeGreaterThan(t.width)
    // the page itself never zooms: the screen pans, and pinches go to it
    expect(await page.$eval(sel, (el) => getComputedStyle(el).touchAction)).toBe('pan-x pan-y')
    const pinch = (from: number, to: number) =>
      page.$eval(
        sel,
        (el, [from, to]) => {
          const at = (id: number, x: number) => new Touch({ identifier: id, target: el, clientX: x, clientY: 300 })
          const fire = (type: string, gap: number) =>
            el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [at(1, 195 - gap / 2), at(2, 195 + gap / 2)], bubbles: true, cancelable: true }))
          fire('touchstart', from)
          fire('touchmove', to)
          fire('touchend', to)
        },
        [from, to],
      )
    await pinch(100, 200)
    await page.waitForFunction((s) => Number(document.querySelector<HTMLElement>(s)!.dataset.font) === 16, sel)
    // pinched in all the way, it stops; out all the way, the whole width shows
    await pinch(50, 400)
    await page.waitForFunction((s) => Number(document.querySelector<HTMLElement>(s)!.dataset.font) === 24, sel)
    await pinch(400, 10)
    await page.waitForFunction((s) => Number(document.querySelector<HTMLElement>(s)!.dataset.font) < 8, sel)
    t = await drawn(page, sel)
    expect(t.wide).toBe(t.width)
    expect(await page.getByText('Tap to type · pinch to zoom').count()).toBe(1)
    await page.close()
  }, 30_000)

  test("a phone opens the items from the task header's ⋯ as full-screen sheets; Back closes one", async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await page.goto(task('GTM-14'))
    await page.getByRole('button', { name: 'More', exact: true }).click()
    const menu = page.getByRole('menu', { name: 'More' })
    // like a coordinator's: Search in this chat first, then the items; no search button of its own in the header
    expect(await menu.getByRole('menuitem').allTextContents()).toEqual(['Search in this chat', 'Open full search', 'Terminal', 'Files', 'Diff', 'Pull request', 'Browser', 'Artifacts', 'Pin', 'Restart agent…', 'Stop…', 'Done', 'Delete…'])
    expect(await page.getByRole('button', { name: 'Search in this chat' }).count()).toBe(0)
    // no PR: greyed out; opened, it says why
    await menu.locator('[role=menuitem][data-off]', { hasText: 'Pull request' }).click()
    await page.getByRole('dialog', { name: 'Pull request · GTM-14' }).getByText(/pull request/i).first().waitFor()
    await page.getByRole('button', { name: 'Back to the chat' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await menu.getByRole('menuitem', { name: 'Files' }).click()
    const sheet = page.getByRole('dialog', { name: 'Files · GTM-14' })
    await sheet.waitFor()
    await settled(page)
    const box = (await sheet.boundingBox())!
    expect(box).toMatchObject({ x: 0, y: 0, width: 390, height: 844 })
    expect(page.url()).toContain('item=files')
    await sheet.getByRole('treeitem', { name: 'README.md' }).click()
    await sheet.getByText('Go-to-market workflows').waitFor()
    // the list and the file take turns; All files goes back to the list
    expect(await sheet.getByRole('tree').isVisible()).toBe(false)
    await sheet.getByRole('button', { name: 'All files' }).click()
    expect(await sheet.getByRole('tree').isVisible()).toBe(true)
    await page.goBack()
    await sheet.waitFor({ state: 'detached' })
    expect(page.url()).toContain('task=GTM-14')
    expect(page.url()).not.toContain('item=')
    // the sheet's own Back does the same
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Diff' }).click()
    await page.getByRole('dialog', { name: 'Diff · GTM-14' }).getByText("GTM-14 hasn't changed anything against main yet.").waitFor()
    await page.getByRole('button', { name: 'Back to the chat' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    expect(page.url()).not.toContain('item=')
    expect(page.url()).toContain('task=GTM-14')
    await page.close()
  }, 30_000)

  test("a tablet opens them from the task header's ⋯ too, over the whole screen; a merged task's files are greyed out", async () => {
    const page = await browser!.newPage({ viewport: { width: 900, height: 800 } })
    await page.goto(task('GTM-15'))
    expect(await page.getByRole('button', { name: /task panel$/ }).count()).toBe(0)
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Pull request' }).click()
    const sheet = page.getByRole('dialog', { name: 'Pull request · GTM-15' })
    await sheet.getByRole('heading', { name: 'Fix webhook signature check' }).waitFor()
    await settled(page)
    expect(await sheet.boundingBox()).toMatchObject({ x: 0, y: 0, width: 900, height: 800 })
    await page.keyboard.press('Escape')
    await sheet.waitFor({ state: 'detached' })
    expect(page.url()).not.toContain('item=')
    await page.goto(task('GTM-12'))
    await page.getByRole('button', { name: 'More', exact: true }).click()
    // its pull request (#45) is still there to open
    expect(await page.locator('[role=menuitem][data-off]').allTextContents()).toEqual(['Files', 'Diff', 'Browser', 'Artifacts'])
    await page.close()
  }, 30_000)

  test("Artifacts in a chat's ⋯ lists only that chat's, opens one, and is greyed where it has none (task and coordinator)", async () => {
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home&task=HP-201`)
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menu', { name: 'More' }).locator('[role=menuitem]:not([data-off])', { hasText: 'Artifacts' }).click()
    const panel = page.getByRole('tabpanel', { name: 'Artifacts' })
    await panel.getByText('Board with the fixed count').waitFor()
    expect(await panel.locator('li').count()).toBe(1)
    await panel.getByText('Board with the fixed count').click()
    await page.waitForURL(/artifact=a5/)
    await page.keyboard.press('Escape')
    // a task whose chat made none: greyed, and it says so
    await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home&task=GTM-14`)
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menu', { name: 'More' }).locator('[role=menuitem][data-off]', { hasText: 'Artifacts' }).click()
    await page.getByText("GTM-14's chat has no artifacts yet.").waitFor()
    // a coordinator's: its list in place of the chat, Back to the chat after
    await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home`)
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    await page.getByRole('menu', { name: 'Menu' }).locator('[role=menuitem]:not([data-off])', { hasText: 'Artifacts' }).click()
    const list = page.locator('section', { has: page.getByText('Artifacts in this chat') })
    await list.waitFor()
    expect(await list.locator('li').allTextContents()).toEqual([expect.stringContaining('Disk use on vm-str'), expect.stringContaining('This week across machines')])
    await page.getByRole('button', { name: 'Back to the chat' }).click()
    await page.locator('textarea[aria-label^="Message home"]').waitFor()
    await page.close()
  }, 30_000)

  test('the Browser item, where the task’s machine has no browser, is greyed with what to do', async () => {
    const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
    await page.goto(task('GTM-15'))
    await page.getByRole('button', { name: 'Show task panel' }).click()
    await page.getByRole('tab', { name: 'Browser' }).click()
    await page.getByText('The demo has no browser: start it with SHEPHERDR_DEMO_BROWSER=1.').waitFor()
    expect(await page.getByRole('application').count()).toBe(0)
    await page.close()
  }, 30_000)

  test('the Browser panel: watch the agent, take over and click, mark it up with a pin, send the note into the chat', async () => {
    const fake = fakeAgentBrowser()
    const was = world.browsers
    const b = new Browsers({ bin: fake.bin, env: (t) => ({ ...browserEnv(t), AGENT_BROWSER_NAMESPACE: 'layout-test', ...fake.env }), host: 'vm-str', user: () => 'Elias', working: () => false, tell: () => undefined })
    world.browsers = b
    const until = async (f: () => boolean) => {
      for (let i = 0; !f(); i++) {
        if (i > 200) throw new Error('timed out')
        await new Promise((r) => setTimeout(r, 25))
      }
    }
    try {
      await until(() => b.status().ready)
      // a frame of the page: any picture will do
      const paint = await browser!.newPage({ viewport: { width: 640, height: 360 } })
      await paint.setContent('<body style="margin:0;background:#2563eb"><h1 style="color:white;margin:40px">Settings</h1></body>')
      const jpeg = (await paint.screenshot({ type: 'jpeg' })).toString('base64')
      await paint.close()
      const page = await browser!.newPage({ viewport: { width: 1600, height: 900 } })
      await page.goto(task('GTM-15'))
      await page.getByRole('button', { name: 'Show task panel' }).click()
      await page.getByRole('tab', { name: 'Browser' }).click()
      await until(() => fake.streamSocks.size > 0)
      fake.toPanels({ type: 'frame', seq: 1, data: jpeg, metadata: { deviceWidth: 1280, deviceHeight: 720, scrollOffsetX: 0, scrollOffsetY: 0 } })
      await page.getByText('Agent is driving').waitFor()
      const stage = page.getByRole('application')
      // the agent drives: a click goes nowhere
      await stage.click()
      await page.getByText('Take over to use the page').waitFor()
      expect(fake.fromPanel).toEqual([])
      await page.getByRole('button', { name: 'Take over' }).click()
      await page.getByText('You’re driving').waitFor()
      await stage.click()
      await until(() => fake.fromPanel.some((m) => m.type === 'input_mouse' && m.eventType === 'mousePressed'))
      expect(fake.fromPanel.find((m) => m.eventType === 'mousePressed')).toMatchObject({ x: 640, y: 360, button: 'left' })
      // Mark up: a tap is a note, with its pin, not a click
      await page.getByRole('button', { name: /^Mark up/ }).click()
      const clicks = fake.fromPanel.length
      await stage.click()
      const note = page.getByRole('textbox', { name: 'Note 1' })
      await note.fill('Make it say “Save changes”')
      await note.press('Enter')
      await page.getByText('Make it say “Save changes”').waitFor()
      expect(await stage.getByText('1', { exact: true }).count()).toBe(1)
      expect(fake.fromPanel.slice(clicks).filter((m) => m.type === 'input_mouse' && m.eventType !== 'mouseMoved')).toEqual([])
      await page.getByRole('button', { name: 'Send 1 note to the agent' }).click()
      await page.getByText('1 note sent to the agent.').waitFor()
      const sent = world.chats['GTM-15/Agent'].messages.at(-1)
      expect(sent?.text).toBe('Notes in the browser on localhost:5173/settings:\n1. button "Save": Make it say “Save changes”')
      await page.close()
    } finally {
      await b.close('GTM-15')
      world.browsers = was
      fake.stop()
    }
  }, 30_000)
  test('the Browser panel when it won’t start: the message covers the last page in the theme’s colours (no white box in dark), and Try again starts it', async () => {
    const fake = fakeAgentBrowser()
    const was = world.browsers
    const b = new Browsers({ bin: fake.bin, env: (t) => ({ ...browserEnv(t), AGENT_BROWSER_NAMESPACE: 'layout-test', ...fake.env }), host: 'vm-str', user: () => 'Elias', working: () => false, tell: () => undefined })
    world.browsers = b
    const until = async (f: () => boolean) => {
      for (let i = 0; !f(); i++) {
        if (i > 200) throw new Error('timed out')
        await new Promise((r) => setTimeout(r, 25))
      }
    }
    try {
      await until(() => b.status().ready)
      // a white page, as most are
      const paint = await browser!.newPage({ viewport: { width: 640, height: 360 } })
      await paint.setContent('<body style="background:#fff"></body>')
      const white = (await paint.screenshot({ type: 'jpeg' })).toString('base64')
      await paint.close()
      const frame = () => fake.toPanels({ type: 'frame', seq: 1, data: white, metadata: { deviceWidth: 1280, deviceHeight: 720, scrollOffsetX: 0, scrollOffsetY: 0 } })
      const page = await browser!.newPage({ viewport: { width: 1600, height: 900 }, colorScheme: 'dark' })
      await page.goto(task('GTM-15'))
      await page.getByRole('button', { name: 'Show task panel' }).click()
      await page.getByRole('tab', { name: 'Browser' }).click()
      await until(() => fake.streamSocks.size > 0)
      frame()
      await page.getByText('Agent is driving').waitFor()
      // another agent-browser takes the session's daemon: the stream goes, and starting again fails
      fake.state({ clash: 99 })
      fake.streamSocks.forEach((s) => s.close())
      const why = page.getByText(/^Another agent-browser/)
      await why.waitFor({ timeout: 10_000 })
      const cover = why.locator('xpath=../..')
      const bg = await cover.evaluate((e) => getComputedStyle(e).backgroundColor)
      expect(bg).not.toBe('rgba(0, 0, 0, 0)')
      expect(bg).not.toBe('rgb(255, 255, 255)')
      expect(bg).toBe(await page.getByRole('application').evaluate((e) => getComputedStyle(e).backgroundColor))
      // fixed meanwhile: Try again starts it, with no stale error left
      fake.state()
      await page.getByRole('button', { name: 'Try again' }).click()
      await until(() => fake.streamSocks.size > 0)
      frame()
      await why.waitFor({ state: 'detached' })
      expect(await page.getByRole('button', { name: 'Try again' }).count()).toBe(0)
      await page.close()
    } finally {
      await b.close('GTM-15')
      world.browsers = was
      fake.stop()
    }
  }, 30_000)
})
