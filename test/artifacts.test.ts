import { describe, expect, test } from 'bun:test'
import { wrapPage } from '../server/frame.ts'
describe('the frame', () => {
  test("it opens in the app's own light or dark, and the device's mode when the app sends none (the check)", () => {
    const dark = wrapPage('<p>x</p>', { phone: true, theme: 'dark' })
    expect(dark).toStartWith('<!doctype html><html class="phone shepherdr-dark"><head>')
    expect(dark).toContain(':root.shepherdr-dark{color-scheme:dark;--bg:#0b0b0d')
    // the device's dark, unless the app said light; and the app's word again when it changes
    expect(dark).toContain('@media(prefers-color-scheme:dark){:root:not(.shepherdr-light){--bg:#0b0b0d')
    expect(dark).toContain("d.shepherdr === 'theme'")
    expect(wrapPage('<p>x</p>', { theme: 'light' })).toStartWith('<!doctype html><html class="shepherdr-light">')
    expect(wrapPage('<p>x</p>')).toStartWith('<!doctype html><html><head>')
  })
  test("a page's own <html> keeps its classes; one without a head gets one", () => {
    expect(wrapPage('<html class="deck"><body>x</body></html>', { big: true })).toContain('<html class="full deck">')
    const bare = wrapPage('<html><body>x</body></html>')
    expect(bare).toMatch(/^<!doctype html><html><head><meta charset="utf-8">/)
    expect(wrapPage('<p>x</p>', { phone: true })).toStartWith('<!doctype html><html class="phone"><head>')
  })
  test('<header> is not <head>: a page that starts with one still gets a doctype, its classes and the policy in its head', () => {
    const w = wrapPage('<header><h1>Brief</h1></header><p>x</p>', { big: true, phone: true, check: true })
    expect(w).toStartWith('<!doctype html><html class="full phone"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"')
    expect(w).toContain('<body><header><h1>Brief</h1></header>')
    // a head without an <html>, and an <html> without a doctype
    expect(wrapPage('<head><title>t</title></head><body>x</body>', { big: true })).toMatch(/^<!doctype html><html class="full"><head><meta charset="utf-8">/)
    expect(wrapPage('<html lang="en"><head></head><body>x</body></html>', { big: true })).toMatch(/^<!doctype html><html lang="en" class="full"><head><meta charset/)
  })
  test('data with $ patterns goes in as it is', () => {
    expect(wrapPage('<p>x</p>', { data: { s: "$' $& $1" } })).toContain(`data = {"s":"$' $& $1"}`)
  })
})

