// Night (#1505): a fourth theme, true black, picked by hand. It counts as dark (the dark artifact pictures) and has
// its own look: the page's root, the phone's status and navigation bars and the installed app's window go black.
// System still picks Light or Dark.
import { afterAll, expect, test } from 'bun:test'

// a stand-in page: the root, index.html's two bar colours and the manifest link, all prefs.ts touches
const bars = [{ content: '' }, { content: '' }]
const manifest = { href: '', setAttribute(_: string, v: string) { this.href = v } }
const root = { dataset: {} as Record<string, string>, style: { setProperty() {} } }
const g = globalThis as Record<string, unknown>
const before = { document: g.document, addEventListener: g.addEventListener }
Object.assign(globalThis, {
  document: { documentElement: root, querySelectorAll: () => bars, querySelector: () => manifest },
  addEventListener() {},
})
const { isDark, look, setPref, THEMES } = await import('./prefs.ts')
// the other test files in this run see no page, as before
afterAll(() => {
  g.addEventListener = before.addEventListener
  if (before.document === undefined) delete g.document
  else g.document = before.document
})

test('Night is offered after Dark, and System never picks it', () => {
  expect(THEMES).toEqual(['System', 'Light', 'Dark', 'Night'])
  setPref('theme', 'System')
  expect(look()).not.toBe('night')
  expect(root.dataset.theme).toBeUndefined()
})

test('each theme sets its own root, bars and manifest; Night is dark for pictures but black for the bars', () => {
  const seen = THEMES.map((t) => {
    setPref('theme', t)
    return [t, root.dataset.theme as unknown, look(), isDark(), bars.map((b) => b.content).join(), manifest.href]
  })
  expect(seen).toEqual([
    // no device preference here: light
    ['System', undefined, 'light', false, '#ffffff,#ffffff', 'manifest-light.webmanifest'],
    ['Light', 'light', 'light', false, '#ffffff,#ffffff', 'manifest-light.webmanifest'],
    ['Dark', 'dark', 'dark', true, '#121212,#121212', 'manifest.webmanifest'],
    ['Night', 'night', 'night', true, '#000000,#000000', 'manifest-night.webmanifest'],
  ])
})
