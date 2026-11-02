// Unread and Notify, as Slack has them, in a real browser (layout.ts): a coordinator's chat with something new makes its
// space's row bold (its own chat only; a heading never is: folded, it hides them and has a quiet dot), reading it on any
// device clears it everywhere, and a muted space (Notify: Off, from its row's menu) stays quiet. Tasks' chats count for
// nothing there.
import { describe, expect, test } from 'bun:test'
import type { Page } from 'playwright-core'
import { notifies } from '../shared/alerts.ts'
import { layout, settled } from './layout.ts'

const { browser, world, url } = await layout({ everything: true })

let n = 0
/** a new message from the agent in a chat: after the demo's own, which count as read */
function say(key: string, text: string) {
  const c = (world.chats[key] ??= { key, cli: 'Claude Code', messages: [] })
  c.messages.push({ id: `new-${++n}`, who: 'agent', text, at: Date.now() + 2000 + n })
  world.emit('chat', key)
  world.emit('snapshot')
}

/** waits until it holds */
async function until(f: () => Promise<boolean> | boolean, what: string) {
  for (let i = 0; i < 60; i++) {
    if (await f()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`timed out: ${what}`)
}

/** a space row's name as it is said: its count, unread, muted (by its name, or its id for a home space) */
const go = (list: string, name: string) => (name.startsWith('p:') ? `${list} li[data-project="${name}"] button[aria-label]:not([aria-expanded]):not([aria-haspopup])` : `${list} li button[aria-label^="${name}"]`)
const said = (page: Page, list: string, name: string) => page.locator(go(list, name)).first().getAttribute('aria-label').catch(() => null)
const weight = (page: Page, list: string, name: string) => page.locator(`${go(list, name)} > span`).first().evaluate((n) => getComputedStyle(n).fontWeight)
/** a heading (Pinned's, a machine's): never bold, never counting */
const plainHeading = async (page: Page, list: string, id: string) => {
  const h = page.locator(`${list} li[data-heading="${id}"]`)
  expect(await h.locator('h2 span').evaluate((n) => getComputedStyle(n).fontWeight)).not.toBe('600')
  expect(await h.locator('[aria-label$="need you here"], [data-autopilot]').count()).toBe(0)
}

describe.skipIf(!browser)('unread and notify', () => {
  test('new messages show bold, a folded machine hides them behind a quiet dot, and opening the chat reads it on every device (desktop, phone)', async () => {
    const desk = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    await desk.goto(url())
    await desk.waitForSelector('#places li')
    const mac = 'p:mac:~'
    expect(await said(desk, '#places', mac)).toBe('home, home space')
    expect(await weight(desk, '#places', mac)).not.toBe('600')

    // a home space's own chat (what was its machine's): its row goes bold
    say(mac, 'Disk use is back under 70%.')
    await until(async () => (await said(desk, '#places', mac)) === 'home, home space, unread', 'mac home unread')
    expect(await weight(desk, '#places', mac)).toBe('600')
    await plainHeading(desk, '#places', 'm:mac')

    // a space's coordinator: its row
    say('p:vm-str:herdr-projects', 'HP-202 is on the call helper.')
    await until(async () => (await said(desk, '#places', 'herdr-projects'))?.endsWith(', unread') ?? false, 'herdr-projects unread')

    // opening the home space reads its chat: the server keeps the mark
    await desk.locator(go('#places', mac)).click()
    await until(async () => (await said(desk, '#places', mac)) === 'home, home space', 'mac home read')
    expect(world.read[mac]).toBeGreaterThan(0)

    // folded, the machine hides the space with something new too; its heading isn't bold, with a quiet dot: red where
    // something waits on you in it (gtm's tasks), else grey for unread
    const dot = (id: string) => desk.locator(`#places li[data-heading="${id}"] [data-inside]`).getAttribute('data-inside', { timeout: 2000 }).catch(() => null)
    await desk.getByRole('button', { name: "Hide vm-str's spaces" }).click()
    await desk.getByRole('button', { name: "Show vm-str's spaces" }).waitFor()
    await desk.mouse.move(900, 400)
    expect(await desk.locator('#places li[data-project="p:vm-str:herdr-projects"]').count()).toBe(0)
    await plainHeading(desk, '#places', 'm:vm-str')
    expect(await dot('m:vm-str')).toBe('needs')
    await desk.getByRole('button', { name: "Show vm-str's spaces" }).click()
    expect(await desk.locator('#places [data-inside]').count()).toBe(0)
    // mac with nothing waiting on you there, and lilla-varlden unread: grey
    const lilla = 'p:mac:lilla-varlden'
    const tasks = world.tasks
    world.tasks = tasks.filter((t) => !t.place.startsWith('p:mac:'))
    world.emit('snapshot')
    say(lilla, 'One more thing.')
    await until(async () => (await said(desk, '#places', 'lilla-varlden')) === 'lilla-varlden, unread', 'lilla-varlden unread, nothing waiting')
    await desk.getByRole('button', { name: "Hide mac's spaces" }).click()
    await desk.mouse.move(900, 400)
    expect(await dot('m:mac')).toBe('unread')
    await desk.getByRole('button', { name: "Show mac's spaces" }).click()
    world.tasks = tasks
    world.emit('snapshot')

    // another device (a phone) sees the same, and reading the space there clears it on the desktop too
    const phone = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await phone.goto(url())
    await phone.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
    const drawer = 'nav[aria-label="Spaces"]'
    await phone.waitForSelector(`${drawer} li`)
    await settled(phone)
    expect(await said(phone, drawer, mac)).toBe('home, home space')
    expect(await said(phone, drawer, 'herdr-projects')).toMatch(/, unread$/)
    expect(await weight(phone, drawer, 'herdr-projects')).toBe('600')
    await phone.goto(url().replace('place=vm-str/home', 'place=vm-str/herdr-projects'))
    await until(() => (world.read['p:vm-str:herdr-projects'] ?? 0) > 0, 'herdr-projects read on the phone')
    await until(async () => !(await said(desk, '#places', 'herdr-projects'))?.endsWith(', unread'), 'herdr-projects read')
    await phone.close()
    await desk.close()
  }, 30_000)

  test("a space's unread and what waits on you there leave its machine's heading plain; folded, only a red dot says so (desktop, phone)", async () => {
    const place = 'p:vm-str:gtm'
    say(place, 'GTM-14 asks for a key.')
    // the demo's gtm has tasks waiting on you: its own count, nobody else's
    expect(world.snapshot().tasks.some((t) => t.place === place && (t.status === 'need' || t.status === 'ready'))).toBe(true)
    const plain = async (page: Page, list: string) => {
      await until(async () => /, \d+ need you, \d+ ready here, unread$/.test((await said(page, list, 'gtm')) ?? ''), 'gtm bold with its count')
      expect(await weight(page, list, 'gtm')).toBe('600')
      await plainHeading(page, list, 'm:vm-str')
    }
    const desk = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    await desk.goto(url().replace('place=vm-str/home', 'place=mac/lilla-varlden'))
    await desk.waitForSelector('#places li')
    await plain(desk, '#places')
    // vm-str folded: gtm goes with its count; the heading still has none, not bold, only its red dot
    await desk.getByRole('button', { name: "Hide vm-str's spaces" }).click()
    await desk.getByRole('button', { name: "Show vm-str's spaces" }).waitFor()
    await desk.mouse.move(900, 400)
    expect(await desk.locator(go('#places', 'gtm')).count()).toBe(0)
    await plainHeading(desk, '#places', 'm:vm-str')
    expect(await desk.locator('#places li[data-heading="m:vm-str"]').getByRole('img', { name: 'Something in it waits on you' }).count()).toBe(1)
    await desk.getByRole('button', { name: "Show vm-str's spaces" }).click()
    await plain(desk, '#places')
    await desk.close()

    const phone = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await phone.goto(url().replace('place=vm-str/home', 'place=mac/lilla-varlden'))
    await phone.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
    const drawer = 'nav[aria-label="Spaces"]'
    await phone.waitForSelector(`${drawer} li`)
    await settled(phone)
    await plain(phone, drawer)
    await phone.close()
    world.read[place] = Date.now() + 60_000
    world.emit('snapshot')
  }, 30_000)

  test("a task's message doesn't mark its space or its home space unread, nor its own row; a task's alerts follow no Notify (desktop)", async () => {
    const desk = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    await desk.goto(url())
    await desk.waitForSelector('#places li')
    const task = desk.locator('section[aria-label="Tasks"] li button').filter({ hasText: 'HP-202' }).first()
    await task.waitFor()
    say('HP-202/Agent', 'The call helper is read; starting on the tests.')
    await desk.waitForTimeout(400)
    expect(world.snapshot().last?.['HP-202/Agent']).toBeUndefined()
    expect(await said(desk, '#places', 'herdr-projects')).not.toContain('unread')
    expect(await said(desk, '#places', 'p:vm-str:~')).not.toContain('unread')
    expect(await task.getAttribute('aria-description')).toBeNull()
    // folded away, the machine's heading has nothing to roll up from it either
    await desk.getByRole('button', { name: "Hide vm-str's spaces" }).click()
    await desk.waitForTimeout(200)
    await plainHeading(desk, '#places', 'm:vm-str')
    await desk.getByRole('button', { name: "Show vm-str's spaces" }).click()
    // a task's alert buzzes even where its project is Off
    expect(notifies({ settings: [{ name: 'Notify', level: 'p:vm-str:herdr-projects', rows: [{ label: 'Notify', key: 'notify', value: 'Off', options: [] }] }] }, { go: { place: 'p:vm-str:herdr-projects', task: 'HP-202' }, task: true })).toBe(true)
    await desk.close()
  }, 30_000)

  test("a row's menu mutes it (Notify: Off): it stays quiet and buzzes nothing; picking what it follows unsets it (desktop)", async () => {
    const desk = await browser!.newPage({ viewport: { width: 1440, height: 800 } })
    await desk.goto(url())
    const row = desk.locator('#places li', { hasText: 'lilla-varlden' })
    await row.hover()
    await row.getByRole('button', { name: 'More for lilla-varlden' }).click()
    const menu = desk.getByRole('menu')
    await menu.getByRole('button', { name: /^Needs me/ }).waitFor()
    await menu.getByRole('button', { name: /^Off/ }).click()
    await until(async () => (await said(desk, '#places', 'lilla-varlden'))?.endsWith(', muted') ?? false, 'lilla-varlden muted')
    const place = 'p:mac:lilla-varlden'
    // its alerts stay off, new messages and what waits on you alike; another place's still buzz
    expect(notifies(world.snapshot(), { go: { place } })).toBe(false)
    expect(notifies(world.snapshot(), { go: { place: 'p:vm-str:gtm' } })).toBe(true)
    expect(notifies(world.snapshot(), { go: { place: 'p:vm-str:gtm' }, message: true })).toBe(false)

    // something new there leaves it quiet
    say(place, 'Pushed the upload page.')
    await until(() => !!world.snapshot().last?.[place], 'the message is in')
    await desk.waitForTimeout(300)
    expect(await said(desk, '#places', 'lilla-varlden')).not.toContain('unread')

    // back to Needs me, which is what it would get anyway: it follows the default again
    await desk.keyboard.press('Escape')
    await row.hover()
    await row.getByRole('button', { name: 'More for lilla-varlden' }).click()
    await desk.getByRole('menu').getByRole('button', { name: /^Needs me/ }).click()
    await until(async () => (await said(desk, '#places', 'lilla-varlden'))?.endsWith(', unread') ?? false, 'lilla-varlden unmuted')
    expect(world.stores.mac.pick('notify', { space: 'lilla-varlden' }).from).toBe('default')

    // Mark as read, from the same menu
    await desk.keyboard.press('Escape')
    await row.hover()
    await row.getByRole('button', { name: 'More for lilla-varlden' }).click()
    await desk.getByRole('menuitem', { name: 'Mark as read' }).click()
    await until(async () => !(await said(desk, '#places', 'lilla-varlden'))?.includes('unread'), 'lilla-varlden read')
    await desk.close()
  }, 30_000)

  test("a phone: holding a home space in the drawer opens its menu, whose Notify All lets every new message buzz; a machine's heading has no Notify", async () => {
    const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await page.goto(url())
    await page.getByRole('button', { name: /^(Show |Hide )?Spaces$/ }).first().click()
    const hold = async (sel: string) => {
      const row = page.locator(sel)
      await row.waitFor()
      await settled(page)
      const box = (await row.boundingBox())!
      const cdp = await ctx.newCDPSession(page)
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] })
      await page.waitForTimeout(700)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    // the heading: New space and Rename section, nothing of a chat
    await hold('nav[aria-label="Spaces"] li[data-heading="m:mac"]')
    await page.getByRole('menuitem', { name: 'New space…' }).waitFor()
    expect(await page.getByRole('menu').getByRole('button', { name: /^All/ }).count()).toBe(0)
    await page.keyboard.press('Escape')
    await hold('nav[aria-label="Spaces"] li[data-project="p:mac:~"]')
    await page.getByRole('menu').getByRole('button', { name: /^All/ }).tap()
    // the hold didn't open it
    expect(page.url()).not.toContain('mac%2Fhome')
    await until(() => notifies(world.snapshot(), { go: { place: 'p:mac:~' }, message: true }), 'mac home on All')
    // set on the home space: only its own chat; the machine's other spaces and other machines don't follow it
    expect(notifies(world.snapshot(), { go: { place: 'p:mac:lilla-varlden' }, message: true })).toBe(false)
    expect(notifies(world.snapshot(), { go: { place: 'p:vm-str:gtm' }, message: true })).toBe(false)
    await ctx.close()
  }, 30_000)
})
