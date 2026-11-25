// Full screen Browser and Desktop: a touch lands on the right remote point at every zoom, gestures do what the view
// says (tap, drag, long press, two fingers), nothing reaches the remote before Take over, the key row's keys and chords
// reach the remote as it wants them, and the view enters and leaves the device's own full screen.
import { expect, test } from 'bun:test'
import { browserPress, chords, clamp, deskPress, enterDevice, gestures, HOLD_MS, keysymOf, leaveDevice, panBy, refit, shown, SENTINEL, spotIn, stillTap, TAP_MS, tapDone, toRemote, typed, wheelSteps, WHOLE, zoomAt, type Act, type View } from './full.ts'

// a phone held upright (390 x 700) showing a 1280 x 800 page: fitted to 390 x 243.75, centred
const box = { w: 390, h: 700 }
const pic = { w: 1280, h: 800 }
const s = 390 / 1280
const top = (700 - 800 * s) / 2

test('whole: a touch maps through the fitted picture; off the picture is nowhere', () => {
  expect(toRemote({ x: 0, y: top }, box, pic, WHOLE)).toEqual({ x: 0, y: 0 })
  expect(toRemote({ x: 195, y: 350 }, box, pic, WHOLE)).toEqual({ x: 640, y: 400 })
  expect(toRemote({ x: 390, y: top + 800 * s }, box, pic, WHOLE)).toEqual({ x: 1280, y: 800 })
  expect(toRemote({ x: 100, y: 10 }, box, pic, WHOLE)).toBeNull()
})

test('the touch point maps right at several zooms, wherever the zoom was centred', () => {
  for (const z of [1.5, 2, 3.7, 8]) {
    for (const at of [{ x: 195, y: 350 }, { x: 20, y: 300 }, { x: 370, y: 400 }]) {
      const v = zoomAt(WHOLE, z, at, box, pic)
      expect(v.z).toBeCloseTo(z)
      // a remote point drawn at screen p maps back to itself
      const r = shown(box, pic, v)
      for (const remote of [{ x: 640, y: 400 }, { x: 100, y: 50 }, { x: 1200, y: 780 }]) {
        const p = { x: r.x + (remote.x / pic.w) * r.w, y: r.y + (remote.y / pic.h) * r.h }
        if (p.x < 0 || p.x > box.w || p.y < 0 || p.y > box.h) continue
        const back = toRemote(p, box, pic, v)!
        expect(Math.abs(back.x - remote.x)).toBeLessThanOrEqual(1)
        expect(Math.abs(back.y - remote.y)).toBeLessThanOrEqual(1)
      }
    }
  }
})

test("pinching about a point keeps that point under the fingers", () => {
  const at = { x: 300, y: 360 }
  const before = toRemote(at, box, pic, WHOLE)!
  const v = zoomAt(WHOLE, 2, at, box, pic)
  const after = toRemote(at, box, pic, v)!
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1)
})

test('the zoom stays in 1..8, the picture covers what it can, and what it cannot pan is left over', () => {
  expect(clamp({ z: 0.2, x: 50, y: 50 }, box, pic)).toEqual(WHOLE)
  expect(clamp({ z: 20, x: 0, y: 0 }, box, pic).z).toBe(8)
  const v = zoomAt(WHOLE, 2, { x: 0, y: 350 }, box, pic)
  // at the left edge already: a pan right is all left over (it scrolls the remote instead)
  const { v: n, rest } = panBy(v, { x: 40, y: 0 }, box, pic)
  expect(n.x).toBeCloseTo(v.x)
  expect(rest.x).toBeCloseTo(40)
  // whole: nothing pans
  expect(panBy(WHOLE, { x: 10, y: -10 }, box, pic).rest).toEqual({ x: 10, y: -10 })
})

test('the keyboard comes up: same size on screen, the spot last touched still in view; turned: whole again', () => {
  const v = zoomAt(WHOLE, 3, { x: 195, y: 350 }, box, pic)
  const kb = { w: 390, h: 380 }
  const spot = { x: 640, y: 420 }
  const n = refit(v, box, kb, pic, spot)
  expect(shown(kb, pic, n).w).toBeCloseTo(shown(box, pic, v).w)
  const r = shown(kb, pic, n)
  const y = r.y + (spot.y / pic.h) * r.h
  expect(y).toBeGreaterThanOrEqual(0)
  expect(y).toBeLessThanOrEqual(kb.h)
  expect(refit(v, box, { w: 700, h: 390 }, pic, spot)).toEqual(WHOLE)
})

const ctx = (drive: boolean, v: View = WHOLE) => ({ box, pic, v, drive })
const remoteActs = (a: Act[]) => a.filter((x) => x.t !== 'view')

test('a tap is a click at that point; two quick taps a double click', () => {
  const g = gestures()
  g.down(1, { x: 195, y: 350 }, ctx(true))
  expect(g.up(1, 1000, ctx(true))).toEqual([{ t: 'click', at: { x: 640, y: 400 }, button: 'left', count: 1 }])
  g.down(1, { x: 196, y: 351 }, ctx(true))
  expect(g.up(1, 1200, ctx(true))[0]).toMatchObject({ t: 'click', count: 2 })
})

test('a drag presses, moves and lets go', () => {
  const g = gestures()
  g.down(1, { x: 100, y: 350 }, ctx(true))
  const m = g.move(1, { x: 150, y: 350 }, ctx(true))
  expect(m.map((a) => a.t)).toEqual(['down', 'move'])
  expect(g.move(1, { x: 200, y: 350 }, ctx(true))[0]).toMatchObject({ t: 'move', at: { x: 656, y: 400 } })
  expect(g.up(1, 0, ctx(true))).toEqual([{ t: 'up', at: { x: 656, y: 400 }, button: 'left' }])
})

test(`a long press (${HOLD_MS} ms) is a right click, and no left click follows`, () => {
  const g = gestures()
  g.down(1, { x: 195, y: 350 }, ctx(true))
  expect(g.hold(ctx(true))).toEqual([{ t: 'click', at: { x: 640, y: 400 }, button: 'right', count: 1 }])
  expect(g.up(1, 0, ctx(true))).toEqual([])
})

test('two fingers: pinch zooms; moving them scrolls the remote once the picture cannot pan', () => {
  const g = gestures()
  g.down(1, { x: 150, y: 350 }, ctx(true))
  g.down(2, { x: 250, y: 350 }, ctx(true))
  const z = g.move(2, { x: 350, y: 350 }, ctx(true))
  const v = (z.find((a) => a.t === 'view') as { v: View }).v
  expect(v.z).toBeGreaterThan(1.5)
  expect(remoteActs(z)).toEqual([])
  g.up(1, 0, ctx(true))
  g.up(2, 0, ctx(true))
  // whole, two fingers up: the page scrolls down
  const h = gestures()
  h.down(1, { x: 150, y: 400 }, ctx(true))
  h.down(2, { x: 250, y: 400 }, ctx(true))
  h.move(1, { x: 150, y: 360 }, ctx(true))
  const sc = remoteActs(h.move(2, { x: 250, y: 360 }, ctx(true)))
  expect(sc[0]).toMatchObject({ t: 'scroll' })
  expect((sc[0] as { dy: number }).dy).toBeGreaterThan(0)
})

test('view only until Take over: taps, drags, holds and two fingers reach nothing remote', () => {
  const g = gestures()
  const v = zoomAt(WHOLE, 2, { x: 195, y: 350 }, box, pic)
  g.down(1, { x: 195, y: 350 }, ctx(false, v))
  expect(g.up(1, 0, ctx(false, v))).toEqual([{ t: 'blocked' }])
  g.down(1, { x: 195, y: 350 }, ctx(false, v))
  const pan = g.move(1, { x: 160, y: 350 }, ctx(false, v))
  expect(pan.map((a) => a.t)).toEqual(['view'])
  expect(g.up(1, 0, ctx(false, v))).toEqual([])
  g.down(1, { x: 195, y: 350 }, ctx(false))
  expect(g.hold(ctx(false))).toEqual([{ t: 'blocked' }])
  g.up(1, 0, ctx(false))
  g.down(1, { x: 150, y: 400 }, ctx(false))
  g.down(2, { x: 250, y: 400 }, ctx(false))
  g.move(1, { x: 150, y: 300 }, ctx(false))
  expect(remoteActs(g.move(2, { x: 250, y: 300 }, ctx(false)))).toEqual([])
})

test('a browser gets the key row keys and shortcuts as Chrome wants them', () => {
  expect(browserPress('Escape')).toEqual([
    { type: 'input_keyboard', eventType: 'keyDown', key: 'Escape', code: 'Escape', modifiers: 0, windowsVirtualKeyCode: 27 },
    { type: 'input_keyboard', eventType: 'keyUp', key: 'Escape', code: 'Escape', modifiers: 0, windowsVirtualKeyCode: 27 },
  ])
  expect(browserPress('Enter')[0]).toMatchObject({ text: '\r', windowsVirtualKeyCode: 13 })
  expect(browserPress('ArrowLeft')[0]).toMatchObject({ windowsVirtualKeyCode: 37 })
  // Ctrl+C: the letter's code, the Ctrl bit, no text typed
  const c = browserPress('c', { ctrl: true })[0]
  expect(c).toMatchObject({ key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 2 })
  expect('text' in c).toBe(false)
  expect(browserPress('Tab', { shift: true })[0]).toMatchObject({ modifiers: 8 })
  expect(browserPress('l', { cmd: true })[0]).toMatchObject({ modifiers: 4 })
})

test('a desktop gets keys and chords as X keysyms, modifiers around the key', () => {
  expect(deskPress('Escape')).toEqual([[0xff1b, 'Escape', true], [0xff1b, 'Escape', false]])
  expect(deskPress('Tab', { cmd: true })).toEqual([[0xffeb, 'MetaLeft', true], [0xff09, 'Tab', true], [0xff09, 'Tab', false], [0xffeb, 'MetaLeft', false]])
  expect(deskPress('Delete', { ctrl: true, alt: true }).map(([k, , d]) => [k.toString(16), d])).toEqual([['ffe3', true], ['ffe9', true], ['ffff', true], ['ffff', false], ['ffe9', false], ['ffe3', false]])
  expect(keysymOf('a')).toBe(0x61)
  expect(keysymOf('é')).toBe(0xe9)
  expect(keysymOf('€')).toBe(0x1000000 + 0x20ac)
  expect(chords(true).map((c) => c.label)).toEqual(['⌘ Space', '⌘ Tab', '⌘ Q'])
  expect(chords(false).map((c) => c.label)).toContain('Ctrl Alt Del')
})

test('what the typing box says was typed: text, Backspace on an empty box, a swapped word', () => {
  expect(typed(`${SENTINEL}hi`)).toEqual({ back: 0, text: 'hi' })
  expect(typed(SENTINEL.slice(1))).toEqual({ back: 1, text: '' })
  expect(typed('')).toEqual({ back: 2, text: '' })
  expect(typed(' hello')).toEqual({ back: 1, text: 'hello' })
})

test('a scroll on a desktop goes as whole wheel steps, the rest kept', () => {
  const a = wheelSteps({ x: 0, y: 0 }, 0, 100)
  expect(a.y).toBe(2)
  const b = wheelSteps(a.carry, 0, 30)
  expect(b.y).toBe(1)
  expect(wheelSteps({ x: 0, y: 0 }, -90, 0).x).toBe(-2)
})

test("entering and leaving the device's own full screen, and the app's alone where there is none", async () => {
  let el: object | null = null
  const calls: string[] = []
  const doc = {
    get fullscreenElement() { return el as Element | null },
    documentElement: { requestFullscreen: async (o?: FullscreenOptions) => { calls.push(`enter:${o?.navigationUI}`); el = {} } },
    exitFullscreen: async () => { calls.push('exit'); el = null },
  }
  expect(await enterDevice(doc)).toBe(true)
  expect(await enterDevice(doc)).toBe(true)
  await leaveDevice(doc)
  await leaveDevice(doc)
  expect(calls).toEqual(['enter:hide', 'exit'])
  // an iPhone: no Fullscreen API, the app's full-window view alone
  expect(await enterDevice({ fullscreenElement: null, documentElement: {} })).toBe(false)
  // refused (no tap behind it): the same
  expect(await enterDevice({ fullscreenElement: null, documentElement: { requestFullscreen: () => Promise.reject(new Error('no')) } })).toBe(false)
})

// The Screen pane: a tap on the picture brings up a touch screen's keyboard (SHEP-498); a drag, a pinch or a long
// hold does not, and the typing box goes under the finger so the spot stays in view above the keyboard.
test('pane: a tap raises the keyboard, a drag, a second finger or a long hold does not', () => {
  const s0 = { x: 100, y: 200, t: 1000 }
  expect(stillTap(s0, { x: 104, y: 206 }, 1)).toBe(s0)
  expect(stillTap(s0, { x: 100, y: 230 }, 1)).toBeNull()
  expect(stillTap(s0, { x: 100, y: 200 }, 2)).toBeNull()
  expect(stillTap(null, { x: 100, y: 200 }, 1)).toBeNull()
  expect(tapDone(s0, 1000 + TAP_MS)).toBe(true)
  expect(tapDone(s0, 1001 + TAP_MS)).toBe(false)
  expect(tapDone(null, 1000)).toBe(false)
})

test('pane: the typing box sits under the finger, never outside the picture', () => {
  const r = { left: 580, top: 220, width: 370, height: 231 }
  expect(spotIn(r, { x: 600, y: 300 })).toEqual({ x: 20, y: 80 })
  expect(spotIn(r, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
  expect(spotIn(r, { x: 2000, y: 2000 })).toEqual({ x: 369, y: 230 })
})

test('pane: what is typed (a password) is never logged, and the keyboard is not phone-only', async () => {
  const dir = new URL('.', import.meta.url).pathname
  for (const f of ['client.tsx', 'fullview.tsx', 'full.ts']) expect(await Bun.file(dir + f).text()).not.toMatch(/console\.(log|info|debug|warn)/)
  const client = await Bun.file(dir + 'client.tsx').text()
  // one typing box for the pane and full screen alike, there whenever you drive, on any screen size
  expect(client).toContain('{drive ? <TypeBox')
  expect(client).not.toMatch(/drive && phone && !full/)
})
