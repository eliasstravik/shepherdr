// What an agent does, calmly and in words, in a real browser (layout.ts): a turn's steps as a few quiet rows, what it
// does now in one line, and a tag above the message box while background work runs, each opening one level deeper.
import { describe, expect, test } from 'bun:test'
import { layout } from './layout.ts'

const { browser, server, world } = await layout()
const at = (q: string) => `http://127.0.0.1:${server?.port}/?${q}`
const HP202 = at('place=p%3Avm-str%3Aherdr-projects&task=HP-202')
const GTM15 = at('place=p%3Avm-str%3Agtm&task=GTM-15')

describe.skipIf(!browser)('activity', () => {
  test('a step that errored stays quiet and says so; only failed tests are red', async () => {
    const chat = world.chats['GTM-15/Agent'], old = chat.messages
    const row = { kind: 'search' as const, steps: [] }
    chat.messages = [...old, { id: 'quiet-step', who: 'agent', at: Date.now(), text: 'Nothing to change.', activity: { id: 'quiet', at: Date.now(), steps: 2, failed: 2, rows: [
      { ...row, key: 'a', text: 'Searched for failed', failed: 1 },
      { ...row, key: 'b', text: 'Ran the tests: 1 failed', failed: 1 },
    ] } }]
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    try {
      await page.goto(GTM15)
      const rows = page.locator('[data-row="a"] > button, [data-row="b"] > button')
      await rows.first().waitFor()
      expect((await rows.nth(0).innerText()).replace(/\s+/g, ' ')).toBe('Searched for failed had an error')
      const fill = (i: number) => rows.nth(i).locator('svg').evaluate((s) => getComputedStyle(s).fill)
      expect(await fill(0)).not.toBe(await fill(1))
    } finally { chat.messages = old; await page.close() }
  })

  test('a finished turn is a few quiet rows in words before its reply; a row opens to its command and output, a diff in its colours (phone)', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await page.goto(GTM15)
    const block = page.locator('[data-activity]')
    await block.waitFor()
    // the three rows that say most, in words, and how many more: no command line anywhere
    const rows = block.locator('[data-row] > button')
    expect(await rows.allInnerTexts()).toEqual([
      expect.stringMatching(/^Edited 2 files: webhook\.ts, webhook\.test\.ts\s*\+7 −2$/),
      'Ran the webhook tests: 1 failed, 1 passed',
      'Ran the webhook tests: 3 passed',
    ])
    expect(await block.locator('[data-more]').innerText()).toMatch(/^5 more · \d+m$/)
    expect(await block.innerText()).not.toMatch(/bun test|2>&1|\/w\/gtm/)
    // calm: no bubble, each row one line (a phone's rows are 36px for a finger; two lines would be 56), before the reply
    // it led to
    const first = (await rows.first().boundingBox())!
    expect(first.height).toBeLessThan(44)
    expect(await rows.first().evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
    const reply = (await page.getByText('Done. It now checks the raw body').boundingBox())!
    expect(first.y).toBeLessThan(reply.y)
    // a failed run shows its failure; a tap opens its command and its output at once
    const failed = rows.nth(1)
    expect(await failed.locator('svg').evaluate((s) => getComputedStyle(s).fill)).not.toBe(await rows.nth(2).locator('svg').evaluate((s) => getComputedStyle(s).fill))
    await failed.tap()
    expect(await failed.getAttribute('aria-expanded')).toBe('true')
    await block.getByText('bun test webhook 2>&1 | tail -20').waitFor()
    await block.locator('pre', { hasText: '1 fail' }).waitFor()
    // the edits: each file's step, and its diff on a tap
    await rows.first().tap()
    await block.getByRole('button', { name: /^Edited webhook\.test\.ts/ }).tap()
    const plus = block.locator('pre span', { hasText: "+test('accepts a re-encoded body'" })
    await plus.waitFor()
    expect(await plus.evaluate((e) => getComputedStyle(e).color)).not.toBe(await block.locator('pre span', { hasText: '@@' }).first().evaluate((e) => getComputedStyle(e).color))
    // the rest
    await block.locator('[data-more]').tap()
    await block.locator('[data-row] > button', { hasText: 'Asked a subagent to review the signature fix' }).waitFor()
    expect(await rows.allInnerTexts()).toEqual([
      'Searched the code for “verifySignature”',
      'Read 4 files: webhook.ts, webhook.test.ts, crypto.ts +1',
      expect.stringMatching(/Edited 2 files: webhook\.ts, webhook\.test\.ts/),
      'Ran the webhook tests: 1 failed, 1 passed',
      'Ran the webhook tests: 3 passed',
      'Asked a subagent to review the signature fix',
      'Checked the types',
      'Committed the changes',
    ])
    await page.close()
  }, 30_000)

  test('while it works: what it does now in words, ticking; background work in a tag above the message box (phone)', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await page.goto(HP202)
    const live = page.locator('[data-live] > button')
    await live.waitFor()
    expect(await live.innerText()).toMatch(/^Reading mute\.test\.ts\s*\d+m \d+s$/)
    // no bubble and no typing dots: one quiet line
    expect(await live.evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
    expect(await page.locator('.typing').count()).toBe(0)
    const before = await live.innerText()
    await page.waitForTimeout(1100)
    expect(await live.innerText()).not.toBe(before)
    // its rows so far open in place
    await live.tap()
    await page.locator('[data-live] [data-row]', { hasText: 'Asked a subagent: Review the mute fix' }).waitFor()
    await page.locator('[data-live] [data-row]', { hasText: 'Read 3 files: call.ts, voice.ts, mute.test.ts' }).waitFor()

    // the tag sits centered just above the message box, so it never scrolls away; background agents are subagents
    const tag = page.locator('button[data-jobs]')
    expect(await tag.innerText()).toBe('1 subagent · 1 shell')
    const t = (await tag.boundingBox())!
    const composer = (await page.getByRole('textbox', { name: /Message HP-202/ }).boundingBox())!
    expect(t.y + t.height).toBeLessThanOrEqual(composer.y)
    expect(Math.abs(t.x + t.width / 2 - 195)).toBeLessThan(2)
    // a tap: each piece, what it does now and for how long; then one piece's own steps, and back
    await tag.tap()
    const sheet = page.getByRole('dialog', { name: 'In the background' })
    await sheet.waitFor()
    await sheet.getByText('Subagent · Reading call.test.ts').waitFor()
    await sheet.getByText('Shell · … running layout-voice').waitFor()
    await sheet.getByRole('button', { name: /Review the mute fix/ }).tap()
    const job = page.getByRole('dialog', { name: 'Review the mute fix' })
    await job.getByText('Searched for “onended”').waitFor()
    await job.getByRole('button', { name: 'Back' }).tap()
    await sheet.getByRole('button', { name: /Running tests/ }).tap()
    await page.getByRole('dialog', { name: 'Running tests' }).locator('pre', { hasText: 'mute keeps the call' }).waitFor()
    await page.close()
  }, 30_000)

  test('a coordinator shows its turns’ rows too, with no background words in its header; no task row shows background work (desktop, dark)', async () => {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' })
    await page.goto(at('place=p%3Avm-str%3Aherdr-projects'))
    const rows = page.locator('[data-activity] [data-row] > button')
    await rows.first().waitFor()
    expect(await rows.allInnerTexts()).toEqual(['Checked the task list', 'Checked GTM-15’s pull request checks', 'Read HEARTBEAT.md'])
    expect(await page.locator('[data-chrome]').first().innerText()).not.toMatch(/background|running|working/)
    const row = page.locator('section[aria-label="Tasks"] li', { hasText: 'Voice call drops on mute' })
    await row.waitFor()
    expect(await row.locator('[data-jobs]').count()).toBe(0)
    expect(await row.innerText()).not.toMatch(/agent|shell|running/)
    await page.close()
  }, 30_000)
})

describe.skipIf(!browser)('activity log catch-up', () => {
  test('the background job sheet shows incomplete history honestly', async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await page.route('**/api/activity?*', route => route.fulfill({ json: { steps: [], catchingUp: true, warning: 'A native log record exceeds the 64 MiB display limit and was skipped.' } }))
    await page.goto(HP202)
    await page.locator('button[data-jobs]').tap()
    await page.getByRole('button', { name: /Review the mute fix/ }).tap()
    await page.getByText('Loading the rest of this log…').waitFor()
    await page.getByText('A native log record exceeds the 64 MiB display limit and was skipped.').waitFor()
    expect(await page.getByText('No steps yet.').count()).toBe(0)
    await page.close()
  })
})
