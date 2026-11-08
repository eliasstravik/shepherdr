import { beforeEach, expect, test } from 'bun:test'
import { flush, followOff, note, noteAct, noteView, pending, resetUsage, viewOf, type Shown } from './usage.ts'

// fake ids only
const ui = (o: Partial<Shown> = {}): Shown => ({ device: 'desktop', place: 'p:vm:shop', task: null, tab: 'chat', side: 'tasks', sheet: null, viewer: null, settings: null, search: false, adding: false, ...o })

beforeEach(() => resetUsage())

test('a screen is its view and ids, never more', () => {
  expect(viewOf(ui())).toEqual({ view: 'place', space: 'p:vm:shop', tab: 'tasks' })
  expect(viewOf(ui({ task: 'SHOP-2', side: 'files' }))).toEqual({ view: 'task', space: 'p:vm:shop', task: 'SHOP-2', tab: 'files' })
  expect(viewOf(ui({ settings: { section: 3 } })).view).toBe('settings')
  expect(viewOf(ui({ viewer: { artifact: 'art-9' } }))).toMatchObject({ view: 'artifact', artifact: 'art-9' })
  expect(viewOf(ui({ device: 'phone', tab: 'needs' })).tab).toBe('needs')
})

test('leaving a screen notes it with the time on it; the same screen again notes nothing', () => {
  noteView(ui())
  noteView(ui())
  expect(pending()).toEqual([])
  noteView(ui({ task: 'SHOP-2' }))
  expect(pending()).toHaveLength(1)
  expect(pending()[0]).toMatchObject({ kind: 'view', from: 'web', view: 'place', space: 'p:vm:shop' })
  expect(typeof pending()[0].ms).toBe('number')
})

test("an action is its type; a send counts once however often it's retried; no words", () => {
  noteView(ui({ device: 'phone' }))
  noteAct({ type: 'send', cid: 'c1', text: 'hello' } as never)
  noteAct({ type: 'send', cid: 'c1', text: 'hello' } as never)
  noteAct({ type: 'setting', key: 'tasks.review', value: 'on' } as never)
  noteAct({ type: 'usage' })
  expect(pending().map(({ at: _at, ...e }) => e)).toEqual([{ kind: 'send', from: 'phone' }, { kind: 'act', from: 'phone', type: 'setting', key: 'tasks.review' }])
  expect(JSON.stringify(pending())).not.toContain('hello')
})

test('sent only to its own service; off there, nothing more is kept', async () => {
  const urls: string[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (u: string) => { urls.push(String(u)); return new Response(JSON.stringify({ ok: true, on: false })) }) as never
  try {
    note('feature', { type: 'dictation' })
    await flush()
    note('feature', { type: 'dictation' })
    expect(pending()).toEqual([])
    await flush()
    expect(urls).toEqual(['api/action'])
  } finally {
    globalThis.fetch = real
  }
})

test('the switch is followed live: off keeps nothing, on again starts afresh', () => {
  followOff(['insights'])
  note('feature', { type: 'jump' })
  expect(pending()).toEqual([])
  followOff(['voice'])
  note('feature', { type: 'jump' })
  expect(pending()).toHaveLength(1)
})

test('Delete drops what the page still holds', () => {
  note('feature', { type: 'jump' })
  noteAct({ type: 'setting', key: 'insights.delete' })
  expect(pending()).toEqual([])
})

test('time while off is never counted', () => {
  noteView(ui())
  followOff(['insights'])
  noteView(ui({ task: 'SHOP-2' }))
  followOff([])
  noteView(ui({ task: 'SHOP-2' }))
  noteView(ui())
  expect(pending()).toHaveLength(1)
  expect(pending()[0]).toMatchObject({ view: 'task', task: 'SHOP-2' })
  expect(pending()[0].ms as number).toBeLessThan(1000)
})
