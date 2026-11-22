// SHEP-243: a push alert's buttons, as the service worker (web/public/sw.js) handles them on a phone or a watch: run in a
// sandbox with a fake registration, server and notifications.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { alreadyHandled } from '@shared/alerts.ts'

const SRC = readFileSync(join(import.meta.dir, '../public/sw.js'), 'utf8')
const SCOPE = 'https://box.example.test/shepherdr/'

type Shown = { title: string; options: any }
function worker(answer: (body: any) => { status: number; body: unknown }, opts: { max?: number; reply?: boolean } = {}) {
  const listeners: Record<string, (e: any) => void> = {}
  const shown: Shown[] = []
  const posted: any[] = []
  const opened: string[] = []
  const closed: string[] = []
  const live: any[] = []
  const reg = {
    scope: SCOPE,
    showNotification: async (title: string, options: any) => { shown.push({ title, options }); live.push({ title, tag: options.tag, data: options.data, close: () => closed.push(title) }) },
    getNotifications: async (f?: { tag?: string }) => live.filter((n) => !f?.tag || n.tag === f.tag),
  }
  class NotificationEvent { notification: any; action = ""; reply?: string }
  if (opts.reply === false) delete (NotificationEvent.prototype as any).reply
  else (NotificationEvent.prototype as any).reply = null
  const fetch = async (url: URL | string, init?: any) => {
    const u = String(url)
    if (u.endsWith('api/waiting')) return new Response(JSON.stringify({ count: 0, tags: [] }))
    const body = JSON.parse(init.body)
    posted.push({ url: u, headers: init.headers, body })
    const r = answer(body)
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status })
  }
  const self: any = {
    registration: reg,
    navigator: {},
    clients: { matchAll: async () => [], openWindow: async (u: string) => { opened.push(u) }, claim: async () => undefined },
    addEventListener: (k: string, fn: (e: any) => void) => { listeners[k] = fn },
    skipWaiting: () => undefined,
  }
  const ctx = vm.createContext({ self, fetch, URL, Response, Promise, JSON, Number, Array, setTimeout: (f: () => void) => f(), Notification: { maxActions: opts.max ?? 2 }, NotificationEvent })
  vm.runInContext(SRC, ctx)
  const waits: Promise<unknown>[] = []
  const push = async (payload: unknown) => {
    listeners.push({ data: { json: () => payload }, waitUntil: (p: Promise<unknown>) => waits.push(p) })
    await Promise.all(waits)
  }
  const click = async (action: string, reply?: string) => {
    const n = live.at(-1)
    const e = { notification: { ...n, ...shown.at(-1)!.options, title: shown.at(-1)!.title, close: () => closed.push(n.title), actions: shown.at(-1)!.options.actions ?? [], timestamp: 42 }, action, reply, waitUntil: (p: Promise<unknown>) => waits.push(p) }
    listeners.notificationclick(e)
    await Promise.all(waits)
  }
  return { push, click, shown, posted, opened, closed }
}

const ready = { title: 'Fix login · Ready for review', body: 'Tap to look at it.', tag: 'HERD-4', waits: true, url: './?place=sp1&task=HERD-4', actions: [{ action: 'accept', title: 'Mark as done' }], accept: { task: 'HERD-4' } }

test("Accept on a ready task's alert accepts it as the Tasks panel does, and says so", async () => {
  const w = worker(() => ({ status: 200, body: { ok: true } }))
  await w.push(ready)
  expect(w.shown[0].options.actions).toEqual([{ action: 'accept', title: 'Mark as done' }])
  await w.click('accept')
  expect(w.posted).toEqual([{ url: `${SCOPE}api/action`, headers: { 'content-type': 'application/json', 'x-shepherdr': '1' }, body: { type: 'accept', task: 'HERD-4' } }])
  expect(w.shown.at(-1)!.title).toBe('Done ✓')
  expect(w.shown.at(-1)!.options).toMatchObject({ tag: 'HERD-4', silent: true })
  // gone by itself a moment later
  expect(w.closed).toContain('Done ✓')
})

test('an old alert for something already handled does nothing more and says so', async () => {
  const w = worker(() => ({ status: 400, body: "HERD-4 isn't ready (done); only a Ready task can be accepted." }))
  await w.push(ready)
  await w.click('accept')
  expect(w.shown.at(-1)!.title).toBe('Already handled')
  const q = worker(() => ({ status: 400, body: 'That question was answered already.' }))
  await q.push({ title: 'HERD-5 · Needs you', body: 'Run: npm test', tag: 'HERD-5', actions: [{ action: '0', title: 'Yes' }, { action: '2', title: 'No' }], answer: { chat: 'HERD-5/worker', question: 'r1' } })
  await q.click('2')
  expect(q.posted[0].body).toEqual({ type: 'answer', chat: 'HERD-5/worker', question: 'r1', choice: 2, fromAlert: true })
  expect(q.shown.at(-1)!.title).toBe('Already handled')
  // the same words the shared rule knows
  expect(alreadyHandled("HERD-4 isn't ready (done)")).toBe(true)
})

test("a refusal that isn't 'done already' says why, and a tap then opens the app", async () => {
  const w = worker(() => ({ status: 400, body: 'Too long to show here in full: answer it in the terminal.' }))
  await w.push({ title: 'HERD-5 · Needs you', body: 'Run: x', tag: 'HERD-5', url: './?place=sp1', actions: [{ action: '0', title: 'Yes' }], answer: { chat: 'c', question: 'r1' } })
  await w.click('0')
  expect(w.shown.at(-1)!.title).toBe("Didn't go through")
  expect(w.shown.at(-1)!.options.body).toContain('Too long')
  expect(w.closed).not.toContain("Didn't go through")
})

test('a question answered from its button says which', async () => {
  const w = worker(() => ({ status: 200, body: { ok: true } }))
  await w.push({ title: 'HERD-5 · Needs you', body: 'Which colour?', tag: 'HERD-5', actions: [{ action: '0', title: 'Red' }, { action: 'open', title: 'Open' }], answer: { chat: 'c', question: 'q' } })
  await w.click('0')
  expect(w.shown.at(-1)).toMatchObject({ title: 'Answered ✓', options: { body: 'Red' } })
  // Open opens its card in the app, answering nothing
  await w.push({ title: 'HERD-5 · Needs you', body: 'Which colour?', tag: 'HERD-5', url: './?place=sp1&task=HERD-5', actions: [{ action: '0', title: 'Red' }, { action: 'open', title: 'Open' }], answer: { chat: 'c', question: 'q' } })
  await w.click('open')
  expect(w.posted.length).toBe(1)
  expect(w.opened).toEqual([`${SCOPE}?place=sp1&task=HERD-5`])
})

test('Reply sends what was typed into the notification once; where nothing can be typed it opens the chat', async () => {
  const reply = { title: 'tt-repo · New message', body: 'Done.', tag: 'msg:sp1', url: './?place=sp1', actions: [{ action: 'reply', title: 'Reply', type: 'text', placeholder: 'Reply…' }, { action: 'open', title: 'Open' }], reply: { chat: 'sp1' } }
  const w = worker(() => ({ status: 200, body: { ok: true } }))
  await w.push(reply)
  expect(w.shown[0].options.actions[0]).toEqual({ action: 'reply', title: 'Reply', type: 'text', placeholder: 'Reply…' })
  await w.click('reply', ' Ship it ')
  expect(w.posted[0].body).toEqual({ type: 'send', chat: 'sp1', text: 'Ship it', cid: 'push:msg:sp1:42', human: true })
  expect(w.shown.at(-1)).toMatchObject({ title: 'Sent ✓', options: { body: 'Ship it' } })
  // a browser with no typed replies: no Reply button; a tap on the alert opens the chat
  const old = worker(() => ({ status: 200, body: { ok: true } }), { reply: false })
  await old.push({ ...reply, actions: [reply.actions[0]] })
  expect(old.shown[0].options.actions).toBeUndefined()
})

test('one button at most, whatever the server sends (Chrome on Android sends every tap as the last button); an old Not now does nothing', async () => {
  const w = worker(() => ({ status: 200, body: { ok: true } }))
  await w.push({ ...ready, actions: [{ action: 'accept', title: 'Mark as done' }, { action: 'later', title: 'Not now' }] })
  expect(w.shown[0].options.actions).toEqual([{ action: 'accept', title: 'Mark as done' }])
  await w.click('later')
  expect(w.posted).toEqual([])
  expect(w.opened).toEqual([])
  const none = worker(() => ({ status: 200, body: {} }), { max: 0 })
  await none.push(ready)
  expect(none.shown[0].options.actions).toBeUndefined()
})
