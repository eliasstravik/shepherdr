import { afterEach, expect, test } from 'bun:test'
import { getState, go, maximize, minimize, openTask, setUI, togglePane } from './kernel.ts'
import { middleThread } from './App.tsx'

// A task's chat maximized into the middle stays there (SHEP-435): the pane is free for anything else, and only its own
// Minimize or another space takes it out.
const place = (id: string) => ({ id, name: id, machine: 'vm', level: 0, status: 'idle', mode: 'regular', chat: `p:${id}` })
const task = (id: string, name: string) => ({ id, name, place: 'shop', on: 'vm', status: 'working', agent: { chat: `${id}/worker` } })
const snap = { name: '', host: 'vm', user: '', everything: 'home', places: [place('home'), place('shop'), place('garden')], machines: [], tasks: [task('vm:SHOP-2', 'Fix login'), task('vm:SHOP-3', 'Add search')], settings: {} }
Object.assign(getState(), { snap })

afterEach(() => setUI({ at: 'shop', pane: null, task: null, art: null, max: null, phone: false }))

test('maximize takes the middle and frees the pane; closing or switching panes keeps it', () => {
  setUI({ at: 'shop' })
  openTask('vm:SHOP-2')
  maximize('vm:SHOP-2')
  expect(getState().ui).toMatchObject({ max: 'vm:SHOP-2', task: null, pane: null })
  expect(middleThread(snap as never, getState().ui)?.task?.id).toBe('vm:SHOP-2')
  togglePane('tasks')
  togglePane('artifacts')
  togglePane(null)
  expect(getState().ui.max).toBe('vm:SHOP-2')
  // another task opens beside it, in the pane; the one in the middle isn't shown twice
  openTask('vm:SHOP-3')
  expect(getState().ui).toMatchObject({ max: 'vm:SHOP-2', task: 'vm:SHOP-3', pane: 'tasks' })
  togglePane(null)
  openTask('vm:SHOP-2')
  expect(getState().ui).toMatchObject({ max: 'vm:SHOP-2', task: null, pane: null })
})

test('Minimize puts it back in the pane and the space chat in the middle; another space un-maximizes', () => {
  setUI({ at: 'shop', max: 'vm:SHOP-2' })
  minimize()
  expect(getState().ui).toMatchObject({ max: null, task: 'vm:SHOP-2', pane: 'tasks' })
  expect(middleThread(snap as never, getState().ui)?.chat).toBe('p:shop')
  setUI({ max: 'vm:SHOP-2', task: null, pane: null })
  go('garden')
  expect(getState().ui).toMatchObject({ at: 'garden', max: null })
})
