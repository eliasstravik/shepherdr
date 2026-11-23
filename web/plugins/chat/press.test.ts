import { expect, test } from 'bun:test'
import { EDGE_PX, Finger, HOLD_MS, MAX_SLIDE, quickFit, REPLY_AT, slid, wayOf } from './press.ts'

// SHEP-332: a quick tap shows the quick bar, a held press the whole menu, a slide to the right replies.

test('a tap: down and up without moving', () => {
  const f = new Finger(100, 300, 0)
  f.move(102, 301)
  expect(f.up()).toBe('tap')
})

test('a long press: held still past the hold time opens the whole menu, sooner does not', () => {
  const f = new Finger(100, 300, 0)
  expect(f.hold(HOLD_MS - 1)).toBe(false)
  expect(f.hold(HOLD_MS)).toBe(true)
  // moving after the menu opened does not slide it
  expect(f.move(200, 300).slide).toBe(0)
  expect(f.up()).toBe('hold')
})

test('a press that moved is no hold', () => {
  const f = new Finger(100, 300, 0)
  f.move(100, 340)
  expect(f.hold(HOLD_MS + 100)).toBe(false)
  expect(f.up()).toBe('none')
})

test('slid past the mark and let go: a reply, with one haptic tick as it crosses', () => {
  const f = new Finger(100, 300, 0)
  const ticks = [20, 40, 60, REPLY_AT, 80, 90].map((dx) => f.move(100 + dx, 302).crossed)
  expect(ticks.filter(Boolean)).toHaveLength(1)
  expect(f.up()).toBe('reply')
})

test('slid short of the mark: it springs back, no reply', () => {
  const f = new Finger(100, 300, 0)
  f.move(130, 300)
  f.move(150, 301)
  expect(f.armed).toBe(false)
  expect(f.up()).toBe('back')
})

test('back under the mark before letting go: no reply, and it ticks again on the next cross', () => {
  const f = new Finger(100, 300, 0)
  expect(f.move(100 + REPLY_AT + 4, 300).crossed).toBe(true)
  f.move(130, 300)
  expect(f.up()).toBe('back')
})

test('up and down is the page scrolling, never a slide', () => {
  expect(wayOf(3, 3)).toBe('undecided')
  expect(wayOf(10, 40)).toBe('scroll')
  expect(wayOf(20, 18)).toBe('scroll')
  expect(wayOf(30, 6)).toBe('slide')
  // to the left belongs to the page (the drawer, the system's back)
  expect(wayOf(-30, 0)).toBe('scroll')
  const f = new Finger(100, 300, 0)
  f.move(110, 260)
  expect(f.move(200, 260).slide).toBe(0)
  expect(f.up()).toBe('none')
})

test("a finger from the screen's left edge is the system's or the sidebar's", () => {
  const f = new Finger(EDGE_PX - 4, 300, 0)
  expect(f.move(EDGE_PX + 120, 300).slide).toBe(0)
  expect(f.up()).toBe('none')
})

test('the slide follows the finger to the mark, then stretches like a rubber band, never past the max', () => {
  expect(slid(-20)).toBe(0)
  expect(slid(30)).toBe(30)
  expect(slid(REPLY_AT)).toBe(REPLY_AT)
  expect(slid(REPLY_AT + 20)).toBeLessThan(REPLY_AT + 20)
  expect(slid(1000)).toBe(MAX_SLIDE)
})

test('the quick bar: every action on a wide screen with room, only the reaction on a phone or a tight spot', () => {
  expect(quickFit(300, true)).toEqual({ actions: 'all', over: false, time: true })
  expect(quickFit(140, true).actions).toBe('all')
  expect(quickFit(140, false).actions).toBe('react')
  expect(quickFit(70, true).actions).toBe('react')
  expect(quickFit(70, false)).toEqual({ actions: 'react', over: false, time: false })
  // no room beside it: it sits over the bubble's edge
  expect(quickFit(10, false).over).toBe(true)
})
