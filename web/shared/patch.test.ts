// #1468: after the first snapshot and chat, a page gets only what changed; applied, it is the same as sending it whole.
import { expect, test } from 'bun:test'
import { apply, chatApply, chatDiff, cut, diff } from './patch.ts'

const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Task ${id}`, prompt: 'x'.repeat(2000), ...extra })
const snap = (tasks: Record<string, unknown>[], more: Record<string, unknown> = {}) => ({ name: 'demo', tasks, places: [{ id: 'p1', name: 'one' }], last: { a: 1, b: 2 }, ...more })

test('one task changed: only it goes, and applying it gives the new snapshot', () => {
  const a = snap(Array.from({ length: 300 }, (_, i) => task(`t${i}`)))
  const b = snap(a.tasks.map((t, i) => (i === 7 ? { ...t, title: 'Renamed' } : t)))
  const p = diff(cut(a), cut(b))!
  expect(p.items!.tasks!.up!.map((t) => t.id)).toEqual(['t7'])
  expect(p.items!.tasks!.ids).toBeUndefined()
  expect(JSON.stringify(p).length).toBeLessThan(JSON.stringify(b).length / 100)
  const got = apply(a, p)
  expect(got).toEqual(b)
  // what didn't change stays the same object on the page (nothing redraws for it)
  expect(got.tasks[8]).toBe(a.tasks[8])
})

test('added, removed, moved, keys changed, a key gone and a value set whole', () => {
  const a = snap([task('a'), task('b'), task('c')], { gone: 1, user: 'x', screens: { s1: 1, s2: 2 } })
  const b = snap([task('c'), task('d'), task('a', { title: 'A' })], { user: 'y', screens: { s2: 3, s3: 4 } })
  const p = diff(cut(a), cut(b))!
  expect(p.del).toEqual(['gone'])
  expect(p.items!.tasks!.rm).toEqual(['b'])
  expect(p.keys!.screens).toEqual({ set: { s2: 3, s3: 4 }, del: ['s1'] })
  expect(apply(a, p)).toEqual(b as never)
})

test('the same id twice (an artifact on two machines) still goes as changes', () => {
  const a = { artifacts: [{ id: 'x', machine: null, v: 1 }, { id: 'x', machine: 'm', v: 1 }, { id: 'y', v: 1 }] }
  const b = { artifacts: [{ id: 'x', machine: null, v: 1 }, { id: 'x', machine: 'm', v: 2 }, { id: 'y', v: 1 }] }
  const p = diff(cut(a), cut(b))!
  expect(p.items!.artifacts!.up).toEqual([{ id: 'x', machine: 'm', v: 2 }])
  expect(apply(a, p)).toEqual(b)
})

test('the same snapshot: no patch', () => {
  const a = snap([task('a')])
  expect(diff(cut(a), cut(JSON.parse(JSON.stringify(a))))).toBeNull()
})

test('random changes always apply to the snapshot sent', () => {
  let seed = 7
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n)
  let a: Record<string, unknown> = snap(Array.from({ length: 20 }, (_, i) => task(`t${i}`)))
  for (let round = 0; round < 200; round++) {
    const tasks = [...(a.tasks as Record<string, unknown>[])]
    const op = rnd(5)
    if (op === 0 && tasks.length) tasks.splice(rnd(tasks.length), 1)
    else if (op === 1) tasks.splice(rnd(tasks.length + 1), 0, task(`n${round}`))
    else if (op === 2 && tasks.length) tasks[rnd(tasks.length)] = { ...tasks[rnd(tasks.length)]!, id: tasks[rnd(tasks.length)]!.id, title: `r${round}` }
    else if (op === 3) tasks.reverse()
    const b = { ...a, tasks, last: { ...(a.last as object), [`k${rnd(4)}`]: round }, ...(op === 4 ? { name: `n${round}` } : {}) }
    const p = diff(cut(a), cut(b))
    expect(p ? apply(a, p) : a).toEqual(b)
    a = b
  }
})

test('a chat sends only the messages after the ones the page has', () => {
  const m = (id: string, text: string) => ({ id, who: 'agent', text })
  const a = { key: 'c', working: true, messages: [m('1', 'hi'), m('2', 'one moment')] }
  const b = { key: 'c', working: false, messages: [m('1', 'hi'), m('2', 'one moment, done'), m('3', 'here')] }
  const d = chatDiff({ msgs: a.messages.map((x) => JSON.stringify(x)) }, b, b.messages.map((x) => JSON.stringify(x)))!
  expect(d.keep).toBe(1)
  expect(d.add).toEqual(b.messages.slice(1))
  const { messages: _, ...rest } = b
  expect(chatApply(a, { ...d, chat: rest })).toEqual(b)
  // a page without those messages can't build on it: it asks for the chat whole
  expect(chatApply(undefined, { ...d, chat: rest })).toBeNull()
  expect(chatApply({ ...a, messages: [] }, { ...d, chat: rest })).toBeNull()
  // nothing in common: whole
  expect(chatDiff({ msgs: ['"x"'] }, b, b.messages.map((x) => JSON.stringify(x)))).toBeNull()
})
