// Terminal and Screen live in the space's name menu and the task's ⋯ menu (no header buttons): each row is checked
// while its view is open, and the same row takes you back to the chat.
import { beforeEach, expect, test } from 'bun:test'
import { getState, setUI } from '@client/kernel.ts'
import { spaceTermRow, taskTermRow } from './menu.ts'
import { screenKey, screenRow } from '../screens/menu.ts'

beforeEach(() => setUI({ phone: false, term: false, tterm: false, pane: null, termTask: false, scr: null, task: null }))

test("a space's Terminal row: unchecked, opens the drawer, checked, then closes it", () => {
  const row = spaceTermRow(getState().ui)
  expect(row.label).toBe('Terminal')
  expect(row.icon).toBe('term')
  expect(row.on).toBe(false)
  row.run!()
  expect(getState().ui.term).toBe(true)
  const back = spaceTermRow(getState().ui)
  expect(back.on).toBe(true)
  back.run!()
  expect(getState().ui.term).toBe(false)
})

test("a phone's Terminal row opens the whole-screen terminal and closes it back to the chat", () => {
  setUI({ phone: true })
  spaceTermRow(getState().ui).run!()
  expect(getState().ui.pane).toBe('terminal')
  expect(spaceTermRow(getState().ui).on).toBe(true)
  spaceTermRow(getState().ui).run!()
  expect(getState().ui.pane).toBe(null)
})

test("a task's Terminal row: its own drawer on a desktop, the task's terminal on a phone, back to the task", () => {
  const row = taskTermRow(getState().ui, 't1')
  expect(row.on).toBe(false)
  row.run!()
  expect(getState().ui.tterm).toBe(true)
  expect(taskTermRow(getState().ui, 't1').on).toBe(true)
  setUI({ phone: true, tterm: false })
  taskTermRow(getState().ui, 't1').run!()
  expect(getState().ui).toMatchObject({ pane: 'terminal', termTask: true, task: 't1' })
  // a space's terminal row does not count the task's as its own
  expect(spaceTermRow(getState().ui).on).toBe(false)
  taskTermRow(getState().ui, 't1').run!()
  expect(getState().ui.pane).toBe('tasks')
})

test('the Screen row opens that screen, is checked only for it, and closes back to the chat or the task', () => {
  const opened: string[] = []
  const open = (k: string) => {
    opened.push(k)
    setUI({ pane: 'screen', scr: { key: k, src: 'b', drive: false } })
  }
  const k = screenKey('p1')
  expect(k).toBe('chat:p1')
  expect(screenKey('p1', 't1')).toBe('task:t1')
  const row = screenRow(getState().ui, k, open)
  expect(row).toMatchObject({ label: 'Screen', icon: 'screen', on: false })
  row.run!()
  expect(opened).toEqual(['chat:p1'])
  expect(screenRow(getState().ui, k, open).on).toBe(true)
  expect(screenRow(getState().ui, 'task:t1', open).on).toBe(false)
  screenRow(getState().ui, k, open).run!()
  expect(getState().ui.pane).toBe(null)
  open('task:t1')
  screenRow(getState().ui, 'task:t1', open).run!()
  expect(getState().ui.pane).toBe('tasks')
})
