import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactElement } from 'react'
import type { MenuRow } from '@client/kernel.ts'

// SHEP-415: a task is replied to in the space's chat as a message is. A task row's "Reply in chat" (and a slide to the
// right on it) puts the task in the box's reply chip of the chat the person is in; what is sent then names the task
// (service/reply-task.test.ts), and the sent message shows the quoted task. Fake data.

const { getState, setUI } = await import('@client/kernel.ts')
const { closeAll, layersNow } = await import('@client/overlay.tsx')
const { replyToTask, mainChat } = await import('./slide.tsx')
const { taskMenu } = await import('@plugins/tasks/client.tsx')
const { Finger, REPLY_AT } = await import('./press.ts')

const place = (id: string, machine: string) => ({ id, name: id, machine, level: 0, status: 'idle', mode: 'regular', chat: `p:${id}` })
const task = { id: 'vm:SHOP-2', name: 'Fix login', place: 'garden', on: 'vm', status: 'working', agent: { chat: 'vm:SHOP-2/worker' } }
Object.assign(getState(), { snap: { name: '', host: 'mini', user: '', everything: 'home', places: [place('home', 'mini'), place('shop', 'mini'), place('garden', 'vm')], machines: [], tasks: [task], settings: {} } })

afterEach(() => {
  setUI({ reply: {}, pane: null, task: null, max: null, phone: false })
  closeAll()
})

test("Reply in chat puts the task in the reply chip of the chat the person is in, whatever space it is from", () => {
  setUI({ at: 'shop' })
  expect(mainChat()).toBe('p:shop')
  taskMenu({ matches: () => false, setAttribute: () => {}, removeAttribute: () => {} } as unknown as Element, task as never, 'row')
  const [menu] = layersNow()
  const rows = (menu!.render(() => {}) as ReactElement<{ rows: MenuRow[] }>).props.rows
  const labels = rows.map((r) => r.label)
  // the two are told apart: replying here, or writing to its own agent
  expect(labels.slice(0, 2)).toEqual(['Reply in chat', 'Open task'])
  rows[0]!.run?.()
  expect(getState().ui.reply).toEqual({ 'p:shop': { id: 'task:vm:SHOP-2', task: 'vm:SHOP-2', text: 'Fix login' } })
  // the task did not open
  expect(getState().ui.task).toBeNull()
})

test("on a phone the Tasks panel steps aside so the chat's box shows; a task open in the middle gives the chat back", async () => {
  setUI({ at: 'shop', phone: true, pane: 'tasks', task: 'vm:SHOP-2' })
  replyToTask(task)
  expect(getState().ui).toMatchObject({ pane: null, task: null, reply: { 'p:shop': { task: 'vm:SHOP-2' } } })
  setUI({ phone: false, pane: 'tasks', task: null, max: 'vm:SHOP-2' })
  replyToTask(task)
  expect(getState().ui).toMatchObject({ max: null, pane: 'tasks' })
  // let the box's late focus run here, not in another test file that has a document but no CSS (voice/call.test.ts)
  await new Promise((r) => setTimeout(r, 100))
})

test('replying needs no CSS global and survives a fake page with no lookups (another test file may leave one behind)', () => {
  const g = globalThis as { document?: unknown; CSS?: unknown }
  const [doc, css] = [g.document, g.CSS]
  Object.assign(g, { document: { visibilityState: 'visible' }, CSS: undefined })
  try {
    setUI({ at: 'shop' })
    expect(() => replyToTask(task)).not.toThrow()
    expect(getState().ui.reply).toMatchObject({ 'p:shop': { task: 'vm:SHOP-2' } })
  } finally {
    Object.assign(g, { document: doc, CSS: css })
  }
})

test("a task row's slide is a message's: the same mark, and only a slide past it replies", () => {
  const short = new Finger(100, 100, 0)
  short.move(100 + REPLY_AT - 1, 102)
  expect(short.up()).toBe('back')
  const far = new Finger(100, 100, 0)
  expect(far.move(100 + REPLY_AT, 103).crossed).toBe(true)
  expect(far.up()).toBe('reply')
  // the Tasks panel's row and the chat's task line use the one slide the message uses
  const tasks = readFileSync(join(import.meta.dir, '../tasks/client.tsx'), 'utf8')
  expect(tasks).toContain('useSlide(() => replyToTask(t))')
  const chat = readFileSync(join(import.meta.dir, 'client.tsx'), 'utf8')
  expect(chat).toContain('useSlide(() => replyToTask({ id, name: title }))')
  expect(chat).toContain('useSlide(reply, { hold: full, off: sel })')
})

test('a sent reply to a task shows the task above its words, its state beside its title', () => {
  const chat = readFileSync(join(import.meta.dir, 'client.tsx'), 'utf8')
  expect(chat).toContain('msg.reply?.task ? <TaskQuote id={msg.reply.task} title={msg.reply.text} />')
  const send = readFileSync(join(import.meta.dir, '../../src/send.ts'), 'utf8')
  expect(send).toContain('o.reply?.task ? { replyTask: o.reply.task }')
})
