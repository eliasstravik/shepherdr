import { expect, test } from 'bun:test'
import { getState } from './kernel.ts'
import { seenChats, spaceUnread, toMark } from './read-marks.ts'

// Unread is back (#1560): a chat on screen is marked read, so the phone's badge and the glance count go down; a phone
// marks nothing while the list, a pane or Settings covers the chat; a muted space is never bold.
const place = (id: string) => ({ id, name: id, machine: 'vm', level: 0, status: 'idle', mode: 'regular', chat: `p:${id}` })
const snap = {
  name: '', host: 'vm', user: '', everything: 'home', places: [place('home'), place('shop'), place('garden')], machines: [], tasks: [],
  settings: [], last: { 'p:shop': 4, 'p:garden': 2 }, read: { 'p:shop': 3, 'p:garden': 2 },
} as never
const ui = (o: object) => ({ ...getState().ui, at: 'shop', task: null, pane: null, drawer: false, settings: null, phone: false, ...o })

test('the space on screen with a new reply is read', () => {
  expect(seenChats(ui({}), snap, true)).toEqual(['p:shop'])
  expect(seenChats(ui({ at: 'garden' }), snap, true)).toEqual([])
})

test('nothing is read while the page is hidden, or on a phone while something covers the chat', () => {
  expect(seenChats(ui({}), snap, false)).toEqual([])
  for (const o of [{ drawer: true }, { pane: 'tasks' }, { settings: { scope: 'all', sec: null } }]) expect(seenChats(ui({ phone: true, ...o }), snap, true)).toEqual([])
  expect(seenChats(ui({ pane: 'tasks' }), snap, true)).toEqual(['p:shop'])
})

test('a mark covers its turn once; a newer reply is marked again', () => {
  const asked = new Map<string, number>()
  expect(toMark(snap, ['p:shop', 'p:garden'], asked)).toEqual({ 'p:shop': 4 })
  expect(toMark(snap, ['p:shop'], asked)).toEqual({})
  const newer = { ...(snap as object), last: { 'p:shop': 5 } } as never
  expect(toMark(newer, ['p:shop'], asked)).toEqual({ 'p:shop': 5 })
})

test('a muted space is never unread', () => {
  expect(spaceUnread(snap, place('shop'))).toBe(true)
  const muted = { ...(snap as object), settings: [{ level: 'shop', rows: [{ key: 'notify', value: 'Off' }] }] } as never
  expect(spaceUnread(muted, place('shop'))).toBe(false)
})
