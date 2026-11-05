import { describe, expect, test } from 'bun:test'
import { EDGE, placeFloat } from './float.ts'

const box = (left: number, top: number, w = 24, h = 24) => ({ left, top, right: left + w, bottom: top + h })
const inSight = (s: { x: number; y: number; maxH: number }, w: number, h: number, vw: number, vh: number) => {
  expect(s.x).toBeGreaterThanOrEqual(EDGE)
  expect(s.x + w).toBeLessThanOrEqual(vw - EDGE)
  expect(s.y).toBeGreaterThanOrEqual(EDGE)
  expect(s.y + Math.min(h, s.maxH)).toBeLessThanOrEqual(vh - EDGE)
}

describe('placeFloat', () => {
  test("a narrow sidebar's machine popover never runs off the screen's left (SHEP-57)", () => {
    // the bars at the right of a 200px sidebar, a 320px popover
    const s = placeFloat(box(164, 340), 320, 420, 'below-end', 1280, 800, 4)
    expect(s.x).toBe(EDGE)
    expect(s.y).toBe(368)
    inSight(s, 320, 420, 1280, 800)
  })
  test('wide enough: its right edge level with its button', () => {
    const s = placeFloat(box(364, 340), 320, 420, 'below-end', 1280, 800, 4)
    expect(s.x + 320).toBe(388)
  })
  test('no room under it: it opens over its button', () => {
    const s = placeFloat(box(290, 550), 320, 480, 'below-end', 390, 844, 4)
    expect(s.up).toBe(true)
    expect(s.y + 480).toBe(550 - 4)
    inSight(s, 320, 480, 390, 844)
  })
  test('room on neither side: it scrolls within the screen', () => {
    const s = placeFloat(box(100, 250), 300, 900, 'below-end', 800, 560, 4)
    expect(s.maxH).toBeLessThan(900)
    inSight(s, 300, 900, 800, 560)
  })
  test("beside its row, or on its left when the right has no room", () => {
    expect(placeFloat(box(0, 100, 200, 28), 224, 100, 'beside', 1280, 800).x).toBe(206)
    const s = placeFloat(box(1000, 100, 200, 28), 224, 100, 'beside', 1280, 800)
    expect(s.left).toBe(true)
    expect(s.x + 224).toBe(994)
  })
  test('a tall menu beside a low row moves up onto the screen', () => {
    const s = placeFloat(box(0, 700, 200, 28), 224, 300, 'beside', 1280, 800)
    inSight(s, 224, 300, 1280, 800)
  })
  test("at the pointer, flipped left and up near the screen's edges", () => {
    const s = placeFloat(box(1200, 700, 0, 0), 260, 250, 'point', 1280, 800)
    expect(s).toMatchObject({ x: 940, y: 450, up: true, left: true })
  })
  test('wider than a phone: as wide as the screen allows, its edges kept', () => {
    const s = placeFloat(box(10, 100), 500, 100, 'below-end', 390, 844)
    expect(s.x).toBe(EDGE)
  })
})
