import { coordinatorRequestIds } from '../shared/attention.ts'
import type { Message, Need } from '../shared/types.ts'
import { expect, test } from 'bun:test'
import { attentionCounts } from '../src/attention.ts'
import { DemoWorld } from '../server/demo/world.ts'

const need = (id: string, chat: string, place: string, task?: string): Need => ({ id, chat, place, task, at: 1 })

test('every count is its own list: needs one per card, within its scope; Ready the Ready tasks', () => {
  const snap = new DemoWorld().snapshot()
  const all = snap.places.map((p) => p.id)
  const ready = snap.tasks.filter((t) => t.status === 'ready' && !t.archived)
  expect(attentionCounts(snap, all)).toEqual({ need: snap.needs.length, ready: ready.length })
  // the same scope named twice counts once
  expect(attentionCounts(snap, [...all, ...all]).need).toBe(snap.needs.length)
  // the spaces' own counts add up to Needs you's
  expect(all.reduce((n, p) => n + attentionCounts(snap, [p]).need, 0)).toBe(snap.needs.length)
  expect(attentionCounts(snap, [])).toEqual({ need: 0, ready: 0 })
})

test('two cards of one task count as two, a Ready task with a merge to answer is on both lists, and answered cards go', () => {
  const snap = new DemoWorld().snapshot()
  const task = snap.tasks.find((t) => t.status === 'need')!
  const p = task.place
  snap.tasks = [task, { ...task, id: 'READY', status: 'ready' }, { ...task, id: 'ASKED', status: 'ready' }]
  snap.needs = [need('q1', 'T/Agent', p, task.id), need('q2', 'T/Agent', p, task.id), need('merge', 'ASKED/Agent', p, 'ASKED'), need('c1', p, p)]
  expect(attentionCounts(snap, [p])).toEqual({ need: 4, ready: 2 })
  snap.needs = snap.needs.slice(1)
  expect(attentionCounts(snap, [p])).toEqual({ need: 3, ready: 2 })
})

test('coordinator questions survive later news, count separately and stop counting when answered', () => {
  const q = (id: string): Message => ({ id, who: 'agent', question: { id, kind: 'Question', title: id, choices: [], to: 'you' } })
  const posted: Message[] = [q('ask:1'), { id: 'news', who: 'agent', card: { id: 'news', task: 'T-1', status: 'ready', text: 'Ready' } }, q('ask:2'), { id: 'health', who: 'agent', text: 'Disk recovered.' }]
  expect(coordinatorRequestIds(posted, {}, [], false)).toEqual(['ask:1', 'ask:2'])
  expect(coordinatorRequestIds(posted, { 'ask:1': 0 }, [], false)).toEqual(['ask:2'])
  expect(coordinatorRequestIds(posted, { 'ask:1': 0, 'ask:2': 0 }, [], false)).toEqual([])
  expect(coordinatorRequestIds([], {}, [], true)).toEqual(['blocked'])
  expect(coordinatorRequestIds(posted, {}, ['ask:1', 'menu'], true)).toEqual(['ask:1', 'ask:2', 'menu'])
})
