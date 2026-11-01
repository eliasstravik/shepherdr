// Choice cards: answers on one tap, deliberate approvals and accessible controls.
import { describe, expect, test } from 'bun:test'
import { layout } from './layout.ts'
import type { Action } from '../shared/types.ts'

const until = async (f: () => boolean, ms = 5000) => {
  for (const t0 = Date.now(); !f(); await Bun.sleep(20)) if (Date.now() - t0 > ms) throw new Error('timed out')
}
const { browser, server, world, url } = await layout()

describe.skipIf(!browser)('answer cards', () => {
  const at = (q: string) => `http://127.0.0.1:${server!.port}/?${q}`

  test('a choice button sends once; Add a note keeps a draft and explicit Send', async () => {
    const chat = world.chats['p:vm-str:~']
    const q = { id: 'fast:q', title: 'Which colour?', kind: 'Form' as const, choices: [{ label: 'Blue' }, { label: 'Green' }], to: 'home' }
    chat.messages.push({ id: 'fast-copy', who: 'agent', at: Date.now(), question: q })
    const sent: Action[] = []
    const act = world.act
    let finish: (() => void) | undefined
    world.act = async (a: Action) => {
      if (a.type !== 'answer') return act(a)
      sent.push(a)
      await new Promise<void>((resolve) => { finish = resolve })
      return { ok: true }
    }
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
    try {
      await page.goto(url())
      const card = page.locator('[data-whole="fast-copy"] [data-card]')
      await card.waitFor()
      expect(await card.getByRole('button', { name: 'Send', exact: true }).count()).toBe(0)
      const blue = card.getByRole('button', { name: 'Send: Blue', exact: true })
      expect((await blue.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      expect(await blue.getAttribute('aria-pressed')).toBeNull()
      await card.getByRole('button', { name: 'Add a note', exact: true }).tap()
      const note = card.getByRole('textbox', { name: 'Note', exact: true })
      expect(await note.evaluate((el) => el === document.activeElement)).toBe(true)
      await note.fill('the darker one')
      expect(await note.inputValue()).toBe('the darker one')
      await card.getByRole('button', { name: 'Green', exact: true }).tap()
      expect(sent.length).toBe(0)
      const send = card.getByRole('button', { name: 'Send', exact: true })
      await send.focus()
      await page.keyboard.press('Enter')
      await until(() => sent.length === 1)
      expect(sent[0]).toMatchObject({ type: 'answer', chat: chat.key, question: q.id, choice: 1, note: 'the darker one' })
      expect(await send.isDisabled()).toBe(true)
      finish!()
      // A successful request stays locked while its answered snapshot is still on the way.
      await page.waitForTimeout(100)
      expect(await send.isDisabled()).toBe(true)
      // A new card: Enter on the clearly named choice sends without a second Send.
      chat.messages.find((m) => m.id === 'fast-copy')!.question = { ...q, id: 'fast:next' }
      await page.reload()
      await blue.focus()
      await page.keyboard.press('Enter')
      await until(() => sent.length === 2)
      expect(sent[1]).toMatchObject({ type: 'answer', chat: chat.key, question: 'fast:next', choice: 0 })
      expect(await blue.isDisabled()).toBe(true)
      await blue.evaluate((el: HTMLButtonElement) => el.click())
      expect(sent.length).toBe(2)
      finish!()
    } finally {
      finish?.()
      world.act = act
      chat.messages = chat.messages.filter((m) => m.id !== 'fast-copy')
      await page.close()
    }
  }, 30_000)

  test('a typed answer brings Send back; emptied, its choices send on a tap again', async () => {
    const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(at('place=p:mac:lilla-varlden&task=LV-3'))
    const card = page.locator('[data-card]').filter({ hasText: 'Which upload limit?' })
    await card.waitFor()
    expect(await card.locator('[data-card-source]').count()).toBe(0)
    const send = card.getByRole('button', { name: 'Send', exact: true })
    expect(await send.count()).toBe(0)
    await card.getByRole('textbox', { name: 'Other answer' }).fill('1 GB')
    expect(await send.isDisabled()).toBe(false)
    await card.getByRole('textbox', { name: 'Other answer' }).fill('')
    expect(await send.count()).toBe(0)
    expect(await card.getByRole('button', { name: /^Send: 50 MB per file/ }).count()).toBe(1)
    await page.close()
  }, 30_000)

  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]] as const)
    test(`a permission reads as words and sends on a tap in the chat, its Don't ask again saying what it allows (${name})`, async () => {
      const chat = world.chats['p:vm-str:~']
      const q = { id: 'perm:q', title: 'Run: touch hello.txt', kind: 'Question' as const, screen: 'Create empty hello.txt', noNote: true, always: 1, to: 'home',
        choices: [{ label: 'Allow once' }, { label: 'Don’t ask again', description: 'Run touch hello.txt in this project' }, { label: 'Deny' }] }
      chat.messages.push({ id: 'perm-copy', who: 'agent', at: Date.now(), question: q })
      const sent: Action[] = []
      const act = world.act
      world.act = async (a: Action) => a.type === 'answer' ? (sent.push(a), { ok: true }) : act(a)
      const page = await browser!.newPage({ viewport, hasTouch: name === 'phone' })
      try {
        await page.goto(url())
        const card = page.locator('[data-whole="perm-copy"] [data-card]')
        await card.waitFor()
        expect(await card.locator('[data-card-title]').textContent()).toBe('Run: touch hello.txt')
        expect(await card.textContent()).toContain('Create empty hello.txt')
        expect(await card.getByRole('button', { name: 'Send', exact: true }).count()).toBe(0)
        expect(await card.getByRole('button', { name: 'Add a note', exact: true }).count()).toBe(0)
        await card.getByRole('button', { name: /^Send: Don’t ask again.*Run touch hello\.txt in this project/ }).click()
        await until(() => sent.length === 1)
        expect(sent[0]).toMatchObject({ type: 'answer', chat: chat.key, question: q.id, choice: 1 })
      } finally {
        world.act = act
        chat.messages = chat.messages.filter((m) => m.id !== 'perm-copy')
        await page.close()
      }
    }, 30_000)

  test('a merge and a plan keep pick and Send in the chat', async () => {
    const chat = world.chats['p:vm-str:~']
    const cards = [
      { id: 'merge-copy', question: { id: 'merge:q', title: 'Merge HP-9?', kind: 'Question' as const, choices: [{ label: 'Merge' }, { label: 'Not yet' }], to: 'home' } },
      { id: 'plan-copy', question: { id: 'plan:q', title: 'Plan to approve', kind: 'Plan' as const, noteRequiredFor: 1, steps: ['One'], choices: [{ label: 'Approve the plan' }, { label: 'Send it back with a note' }], to: 'home' } },
    ]
    chat.messages.push(...cards.map((c) => ({ ...c, who: 'agent' as const, at: Date.now() })))
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 } })
    try {
      await page.goto(url())
      for (const { id } of cards) {
        const card = page.locator(`[data-whole="${id}"] [data-card]`)
        await card.waitFor()
        expect(await card.getByRole('button', { name: 'Send', exact: true }).count()).toBe(1)
        expect(await card.getByRole('button', { name: /^Send: / }).count()).toBe(0)
      }
    } finally {
      chat.messages = chat.messages.filter((m) => !cards.some((c) => c.id === m.id))
      await page.close()
    }
  }, 30_000)

  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['phone', { width: 390, height: 844 }],
  ] as const)
    test(`a long question wraps on its card (${name}), the ? on its first line, and each choice's description in grey under it`, async () => {
      const title = "Should the rebuilt workflow also read the founders' own LinkedIn profiles and recent posts, or only the company page as before?"
      world.chats['p:vm-str:~'].messages.push({
        id: 'long-q',
        who: 'agent',
        at: Date.now(),
        question: { id: 'menu:long-q', title, kind: 'Form', to: 'home', asks: 'Claude Code asks', choices: [{ label: 'Company page only', description: 'Same as before: just the company page' }, { label: 'Company page and founders', description: "Also read each founder's profile" }] },
      })
      const page = await browser!.newPage({ viewport, hasTouch: name === 'phone' })
      await page.goto(url())
      const card = page.locator('[data-whole="long-q"] [data-card]')
      await card.waitFor()
      const head = card.locator('[data-card-title]')
      // all of it, over more than one line
      expect(await head.textContent()).toBe(title)
      const t = await head.evaluate((el) => ({ lines: el.getClientRects().length, h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight), top: el.getBoundingClientRect().top, cut: el.scrollWidth > el.clientWidth }))
      expect(t.h).toBeGreaterThan(t.lh * 1.5)
      expect(t.cut).toBe(false)
      // the ? sits in the middle of the first line
      const icon = (await head.evaluate((el) => el.previousElementSibling!.getBoundingClientRect().toJSON())) as { top: number; height: number }
      expect(Math.abs(icon.top + icon.height / 2 - (t.top + t.lh / 2))).toBeLessThan(1.5)
      // the label on its line, the description in grey below it
      const choice = card.getByRole('button', { name: /^Company page only/ })
      const [label, desc] = await choice.evaluate((b) => [...b.querySelectorAll('span > span')].map((s) => ({ bottom: s.getBoundingClientRect().bottom, top: s.getBoundingClientRect().top, color: getComputedStyle(s).color })))
      expect(desc.top).toBeGreaterThanOrEqual(label.bottom - 1)
      expect(desc.color).not.toBe(label.color)
      world.chats['p:vm-str:~'].messages = world.chats['p:vm-str:~'].messages.filter((m) => m.id !== 'long-q')
      await page.close()
    }, 30_000)

})
