// Needs you: one list of what waits on the human, beside the chat. A new card must never move under the thumb, and
// every count must agree with it.
import { describe, expect, test } from 'bun:test'
import { layout, settled, until } from './layout.ts'
import type { Action, Question } from '../shared/types.ts'

const { browser, world, url } = await layout()
const home = 'p:vm-str:~'
const gtm = 'p:vm-str:gtm'
const chips = (id: string, title: string, extra: Partial<Question> = {}): Question => ({ id, title, kind: 'Question', choices: [{ label: 'Allow once' }, { label: 'Deny' }], noNote: true, to: 'agent', ...extra })

describe.skipIf(!browser)('Needs you', () => {
  async function open(width: number) {
    const page = await browser!.newPage({ viewport: { width, height: 900 }, hasTouch: width < 600 })
    page.setDefaultTimeout(5000)
    await page.goto(url() + (width < 600 ? '&tab=needs' : ''))
    if (width >= 600) await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /Needs you/ }).click()
    await page.locator('[data-needs]').waitFor()
    return page
  }
  const top = (page: Awaited<ReturnType<typeof open>>, id: string) => page.locator(`[data-need="${id}"]`).evaluate((el) => el.getBoundingClientRect().top)

  for (const width of [390, 1440]) {
    test(`oldest first, across spaces and machines, and its count agrees with the sidebar (${width}px)`, async () => {
      const page = await open(width)
      try {
        const snap = world.snapshot()
        const ids = await page.locator('[data-need]').evaluateAll((els) => els.map((el) => el.getAttribute('data-need')))
        expect(ids).toEqual(snap.needs.map((n) => n.id))
        expect(await page.locator('[data-need-where]').allTextContents()).toContain('mac · lilla-varlden')
        expect(await page.locator('[data-need-where]').allTextContents()).toContain('vm-str · gtm')
        const badge = page.locator('[aria-label$="· everywhere"]').filter({ visible: true }).first()
        expect(await badge.getAttribute('aria-label')).toBe(`${snap.needs.length} needs you, 0 ready · everywhere`)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      } finally { await page.close() }
    }, 30_000)

    test(`a new card joins the end; an answered one holds its place, and its tap sends only its own (${width}px)`, async () => {
      const task = world.tasks.find((t) => t.id === 'LV-3')!
      const chat = world.chats['p:vm-str:~']
      const sent: Action[] = []
      const act = world.act
      world.act = async (a: Action) => a.type === 'answer' ? (sent.push(a), { ok: true }) : act(a)
      const taskChat = world.chat(task.agent!.chat)
      const added = ['need:one', 'need:two', 'need:late', 'need:new']
      const clean = () => { for (const c of [taskChat, chat]) c.messages = c.messages.filter((m) => !added.includes(m.id)) }
      taskChat.messages.push({ id: 'need:one', who: 'agent', at: Date.now(), question: chips('need:one', 'Allow writing the upload route?') })
      chat.messages.push({ id: 'need:two', who: 'agent', at: Date.now() + 1, question: chips('need:two', 'Mark it ready?') })
      const page = await open(width)
      try {
        const one = page.locator('[data-need="need:one"]'), two = page.locator('[data-need="need:two"]')
        await two.scrollIntoViewIfNeeded()
        const before = await top(page, 'need:two')
        // a new card while the thumb is over this one, even one older than it
        taskChat.messages.push({ id: 'need:late', who: 'agent', at: 1, question: chips('need:late', 'Late from a machine coming back') })
        world.emit('snapshot')
        await page.locator('[data-need="need:late"]').waitFor()
        expect(await top(page, 'need:two')).toBe(before)
        // one tap: permissions send at once, by their own id, with no Send
        expect(await two.getByRole('button', { name: 'Send', exact: true }).count()).toBe(0)
        await two.getByRole('button', { name: 'Send: Deny', exact: true }).click()
        await until(async () => sent.length, (n) => n === 1)
        expect(sent[0]).toMatchObject({ type: 'answer', chat: chat.key, question: 'need:two', choice: 1 })
        // answered above an open card: it stays the height it was, and the one below stays
        const belowBefore = await top(page, 'need:late')
        const height = await one.evaluate((el) => el.getBoundingClientRect().height)
        taskChat.messages.find((m) => m.id === 'need:one')!.question!.sent = 0
        world.emit('snapshot')
        await one.locator('text=No longer waiting').waitFor()
        expect(await one.evaluate((el) => el.getBoundingClientRect().height)).toBe(height)
        expect(await top(page, 'need:late')).toBe(belowBefore)
        expect(await one.getByRole('button', { name: /Allow once|Deny/ }).count()).toBe(0)
      } finally {
        world.act = act
        clean()
        world.emit('snapshot')
        await page.close()
      }
    }, 30_000)
  }

  test('merges, plans and picks of several keep Send; a note typed keeps Send', async () => {
    const page = await open(1440)
    try {
      const merge = page.locator('[data-need]').filter({ hasText: 'Merge GTM-15?' })
      await merge.getByRole('button', { name: 'Merge', exact: true }).waitFor()
      expect(await merge.getByRole('button', { name: 'Send', exact: true }).count()).toBe(1)
      const plan = page.locator('[data-need]').filter({ hasText: 'Plan for GTM-16' })
      expect(await plan.getByRole('button', { name: 'Send', exact: true }).count()).toBe(1)
      const ordinary = page.locator('[data-need]').filter({ hasText: 'Rerun CI on main?' })
      expect(await ordinary.getByRole('button', { name: 'Send', exact: true }).count()).toBe(0)
      await ordinary.getByRole('button', { name: 'Add a note', exact: true }).click()
      await ordinary.getByRole('textbox', { name: 'Note', exact: true }).fill('just once')
      expect(await ordinary.getByRole('button', { name: 'Send', exact: true }).count()).toBe(1)
    } finally { await page.close() }
  }, 30_000)

  test("a task's row in the coordinator's chat has no buttons, and leads to Needs you", async () => {
    const chat = world.chats[home]
    const q = chips('row:q', 'Allow writing files?')
    chat.messages.push({ id: 'row', who: 'agent', at: Date.now(), card: { id: 'row', task: 'LV-3', status: 'need', text: 'Needs you', ask: { chat: 'LV-3/Agent', open: true, questions: [q] } } })
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    try {
      await page.goto(url())
      const row = page.locator('[data-whole="row"]')
      await row.waitFor()
      expect(await row.locator('[data-card]').count()).toBe(0)
      expect(await row.getByRole('button', { name: /Allow once|Deny/ }).count()).toBe(0)
      await row.locator('[data-needs-link]').click()
      await settled(page)
      await page.locator('[data-needs]').waitFor()
    } finally {
      chat.messages = chat.messages.filter((m) => m.id !== 'row')
      await page.close()
    }
  }, 30_000)

  test('a waiter with no card gets a reply box that reaches its own chat', async () => {
    const saved = world.tasks
    const sent: Action[] = []
    const act = world.act
    world.act = async (a: Action) => a.type === 'send' ? (sent.push(a), { ok: true }) : act(a)
    world.tasks = [{ ...saved.find((t) => t.status === 'ready')!, id: 'WAIT-1', place: gtm, status: 'need', sub: 'Waits for your reply: keep the old API?', agent: undefined }]
    const page = await open(1440)
    try {
      const card = page.locator('[data-need="attention"]')
      expect(await card.locator('[data-ask-text]').textContent()).toBe('Waits for your reply: keep the old API?')
      await card.getByRole('textbox', { name: 'Reply to WAIT-1' }).fill('Yes')
      await card.getByRole('button', { name: 'Send', exact: true }).click()
      await until(async () => sent.length, (n) => n === 1)
      expect(sent[0]).toMatchObject({ type: 'send', chat: 'WAIT-1/Agent', text: 'Yes' })
    } finally {
      world.act = act
      world.tasks = saved
      world.emit('snapshot')
      await page.close()
    }
  }, 30_000)
})
