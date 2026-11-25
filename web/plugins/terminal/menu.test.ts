// Terminal and Screen live in the space's name menu and the task's ⋯ menu (no header buttons): each row is checked
// while its view is open, and the same row takes you back to the chat.
import { beforeEach, expect, test } from 'bun:test'
import { getState, setUI } from '@client/kernel.ts'
import { followFold, spaceTermRow, taskTermRow, viewRow } from './menu.ts'
import { screenKey, screenRow } from '../screens/menu.ts'

beforeEach(() => setUI({ phone: false, term: false, tterm: false, pane: null, termTask: false, scr: null, task: null }))

test("a space's Terminal row: unchecked, opens the drawer, checked, then closes it", () => {
  const row = spaceTermRow(getState().ui)
  expect(row.label).toBe('Terminal')
  expect(row.icon).toBe('prompt')
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

test('View as terminal / View as chat: its own swap icon apart from Terminal, below a line, marked while on', () => {
  setUI({ aterm: {} })
  const row = viewRow(getState().ui, 'c1', true)
  expect(row).toMatchObject({ label: 'View as terminal', icon: 'viewswap', line: true })
  expect(row.icon).not.toBe(spaceTermRow(getState().ui).icon)
  expect(row.value).toBeUndefined()
  // not a check row: it changes this chat's view, it opens nothing beside it
  expect(row.on).toBeUndefined()
  row.run!()
  expect(getState().ui.aterm.c1).toBe(true)
  const back = viewRow(getState().ui, 'c1')
  expect(back).toMatchObject({ label: 'View as chat', value: 'Terminal now', line: false })
  back.run!()
  expect(getState().ui.aterm.c1).toBe(false)
  expect(viewRow(getState().ui, 'c1').label).toBe('View as terminal')
})

// #1502: folding or unfolding keeps your one open terminal, never lost and never two
test("folding moves the open drawer to the phone's Terminal screen, and unfolding moves it back", () => {
  const stop = followFold()
  try {
    setUI({ term: true })
    setUI({ phone: true })
    expect(getState().ui).toMatchObject({ pane: 'terminal', termTask: false, term: false })
    setUI({ phone: false })
    expect(getState().ui).toMatchObject({ pane: null, term: true })
    // the issue's steps: open wide, narrow (one shows), reopen is a toggle off, widen: none twice
    setUI({ phone: true })
    expect(spaceTermRow(getState().ui).on).toBe(true)
  } finally { stop() }
})

test("a task's terminal goes with its task, and the pane the terminal covered comes back", () => {
  const stop = followFold()
  try {
    setUI({ pane: 'tasks', task: 't1', tterm: true })
    setUI({ phone: true })
    expect(getState().ui).toMatchObject({ pane: 'terminal', termTask: true, tterm: false, task: 't1' })
    setUI({ phone: false })
    expect(getState().ui).toMatchObject({ pane: 'tasks', tterm: true, termTask: false })
    // the space's drawer over the Artifacts pane: folded the terminal takes the screen, unfolded Artifacts is back
    setUI({ pane: 'artifacts', tterm: false, term: true })
    setUI({ phone: true })
    expect(getState().ui.pane).toBe('terminal')
    setUI({ phone: false })
    expect(getState().ui).toMatchObject({ pane: 'artifacts', term: true })
  } finally { stop() }
})

test('a terminal closed on the folded screen stays closed when you unfold', () => {
  const stop = followFold()
  try {
    setUI({ term: true })
    setUI({ phone: true })
    spaceTermRow(getState().ui).run!()
    expect(getState().ui.pane).toBe(null)
    setUI({ phone: false })
    expect(getState().ui).toMatchObject({ pane: null, term: false })
  } finally { stop() }
})
