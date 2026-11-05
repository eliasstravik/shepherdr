import { describe, expect, test } from 'bun:test'
import type { Automation, Place, Task } from '@shared/types.ts'
import { autoInSpace, needInSpace, scopeSpace, taskInSpace } from './groups.ts'

// The web Tasks list's This space (the ⋯ menu's Show), by the window's rule (core/tasks.js inSpace)
const place = (id: string, folder: string, more: Partial<Place> = {}): Place => ({ id, name: id, folder, machine: 'mac', level: 2, status: 'idle', mode: 'regular', chat: `p:${id}`, ...more })
const task = (id: string, taskFolder: string, more: Partial<Task> = {}): Task => ({ id, name: id, taskFolder, status: 'todo', place: '', age: '', state: 'todo', on: 'mac', created: '', ...more })

const lane = place('lane', '/w/lanes/lane', { tabs: [{ name: 'Tests', term: 't:a1' }] })
// a machine's home (built so no real home folder is written here)
const home = place('home', ['', 'Users', 'me'].join('/'), { home: true, level: 1 })

describe('a task is the space picked’s', () => {
  test('its list is the space’s folder or a repo directly in it', () => {
    expect(taskInSpace(lane, task('A-1', '/w/lanes/lane'))).toBe(true)
    expect(taskInSpace(lane, task('A-2', '/w/lanes/lane/repo'))).toBe(true)
    expect(taskInSpace(lane, task('A-3', '/w/lanes/lane/repo/sub'))).toBe(false)
    expect(taskInSpace(lane, task('A-4', '/w/other'))).toBe(false)
  })
  test('started for it, wherever its list is', () => {
    expect(taskInSpace(lane, task('B-1', '/w/other', { place: 'lane' }))).toBe(true)
    expect(taskInSpace(lane, task('B-2', '/w/other', { place: 'shop' }))).toBe(false)
  })
  test('only on the space’s machine', () => {
    expect(taskInSpace(lane, task('C-1', '/w/lanes/lane', { on: 'vm' }))).toBe(false)
  })
})

test('an automation by its list’s folder, one with no machine on this computer', () => {
  const auto = (folder: string, machine: string | null = null): Automation => ({ name: 'nightly', when: '', what: '', on: true, next: [], folder, machine })
  expect(autoInSpace(lane, auto('/w/lanes/lane/repo'), 'mac')).toBe(true)
  expect(autoInSpace(lane, auto('/w/lanes/lane/repo', 'vm'), 'mac')).toBe(false)
  expect(autoInSpace(lane, auto('/w/other'), 'mac')).toBe(false)
})

test('an agent asking: the space’s Assistant or a terminal in one of its tabs', () => {
  expect(needInSpace(lane, { place: 'lane', chat: 'p:lane' })).toBe(true)
  expect(needInSpace(lane, { place: '', chat: 't:a1' })).toBe(true)
  expect(needInSpace(lane, { place: 'shop', chat: 'p:shop' })).toBe(false)
})

test('This space keeps to the place picked; a home (no space picked) or All spaces lists every space’s', () => {
  expect(scopeSpace('space', lane)).toBe(lane)
  expect(scopeSpace('space', home)).toBeUndefined()
  expect(scopeSpace('space', undefined)).toBeUndefined()
  expect(scopeSpace('all', lane)).toBeUndefined()
})
