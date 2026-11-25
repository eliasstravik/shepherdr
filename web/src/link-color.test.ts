// Links read as links (SHEP-439): one link blue, --link, in both themes, on every background a link sits on, apart
// from the other blues and the status colours; the chat's words, a task's lines and artifact pages all use it.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const ds = read('./ds.css')
const styles = read('./styles.css')
const artifact = readFileSync(new URL('../../mods/artifacts/bin/herdr-artifact', import.meta.url), 'utf8')
const guide = readFileSync(new URL('../../mods/artifacts/ARTIFACTS.md', import.meta.url), 'utf8')

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [lo, hi] = [lum(a), lum(b)].sort((x, y) => x - y)
  return (hi! + 0.05) / (lo! + 0.05)
}
const hex = (n: number) => n.toString(16).padStart(2, '0')
/** a see-through white or black over a colour, as the browser paints it */
const over = (bg: string, white: boolean, a: number) => '#' + rgb(bg).map((c) => hex(Math.round(c + ((white ? 255 : 0) - c) * a))).join('')
const hue = (h: string) => {
  const [r, g, b] = rgb(h).map((c) => c / 255)
  const mx = Math.max(r!, g!, b!), d = mx - Math.min(r!, g!, b!)
  const x = mx === r ? ((g! - b!) / d) % 6 : mx === g ? (b! - r!) / d + 2 : (r! - g!) / d + 4
  return (x * 60 + 360) % 360
}

// the four theme blocks: light, dark by the device, dark by the app's own switch, night (true black, #1505)
const themes = ds.split('\n').filter((l) => /^(:root\{|@media\(prefers-color-scheme:dark\)|:root\[data-theme="(dark|night)"\])/.test(l))
const tok = (block: string, name: string) => {
  const h = block.match(new RegExp(`--${name}:(#(?:[0-9a-f]{6}|[0-9a-f]{3}))[;}]`))?.[1]
  return h?.length === 4 ? '#' + [...h.slice(1)].map((c) => c + c).join('') : h
}

test('every theme names a link blue, and the dark ones and night agree', () => {
  expect(themes).toHaveLength(4)
  for (const t of themes) expect(tok(t, 'link')).toMatch(/^#[0-9a-f]{6}$/)
  expect(tok(themes[1]!, 'link')).toBe(tok(themes[2]!, 'link')!)
  expect(tok(themes[3]!, 'link')).toBe(tok(themes[2]!, 'link')!)
})

test('the link blue reads on every bubble and surface it sits on, in every theme (AA and then some: 4.5:1 or more)', () => {
  const [light, dark, night] = [themes[0]!, themes[2]!, themes[3]!]
  const surfaces = (t: string, isDark: boolean) => {
    const canvas = tok(t, 'canvas')!
    // the person's own bubble is see-through white over the canvas in dark, a grey in light
    const mine = isDark ? over(canvas, true, Number(t.match(/--mine:rgb\(255 255 255\/(\.\d+)\)/)![1])) : tok(t, 'mine')!
    return [canvas, tok(t, 'well')!, tok(t, 'raised')!, tok(t, 'overlay')!, tok(t, 'rx')!, mine]
  }
  for (const [t, isDark] of [[light, false], [dark, true], [night, true]] as const)
    for (const bg of surfaces(t, isDark)) expect(contrast(tok(t, 'link')!, bg)).toBeGreaterThanOrEqual(4.5)
})

test("the link blue is its own colour: not the app's other blue, nor a status's amber or red", () => {
  for (const t of [themes[0]!, themes[2]!, themes[3]!]) {
    const link = tok(t, 'link')!
    expect(link).not.toBe(tok(t, 'blue')!)
    expect(Math.abs(hue(link) - hue(tok(t, 'blue')!))).toBeGreaterThan(15)
    for (const s of ['amber', 'red', 'green']) expect(Math.abs(hue(link) - hue(tok(t, s)!))).toBeGreaterThan(60)
  }
})

test('chat words, task and space links and status lines draw links in it, underlined, with no visited colour', () => {
  const rule = ds.match(/(?:^|\n)\.lk,\.md a\{([^}]*)\}/)?.[1] ?? ''
  expect(rule).toContain('color:var(--link)')
  expect(rule).toContain('text-decoration:underline')
  expect(ds).toMatch(/\.lk:active,\.md a:active\{opacity:/)
  expect(ds).toMatch(/\.lk:focus-visible,\.md a:focus-visible\{outline-color:var\(--link\)\}/)
  expect(ds).toContain('.status .lk{color:var(--link)}')
  // nothing turns a link back to the words' colour or the grey
  for (const css of [ds, styles]) {
    expect(css).not.toMatch(/:visited/)
    expect(css).not.toMatch(/\.md a(:not\([^)]*\))?\{[^}]*color:inherit/)
    expect(css).not.toMatch(/\.lk\{[^}]*color:var\(--muted\)/)
  }
  expect(ds).not.toMatch(/\.asked\{[^}]*color:/)
  // inline code or a file path inside a link keeps the link's colour
  expect(styles).toMatch(/\.md a code\{color:inherit/)
})

test('artifact pages and the guide give links the same blue', () => {
  const [l, d] = [tok(themes[0]!, 'link')!, tok(themes[2]!, 'link')!]
  for (const page of [artifact, guide]) {
    expect(page).toContain(`--link: ${l};`)
    expect(page).toContain(`--link: ${d};`)
    expect(page).toContain('a { color: var(--link);')
    expect(page).not.toContain('a { color: inherit; }')
  }
  expect(contrast(l, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  expect(contrast(d, '#111111')).toBeGreaterThanOrEqual(4.5)
})

// Night (#1505): true black for OLED, and still layered: each surface steps up from the page so cards, bubbles and
// menus read apart without shadows, and the words read on every one of them
test('night: a black page, its layers told apart, and the words read on each', () => {
  const night = themes[3]!
  expect(night).toContain('color-scheme:dark')
  expect(tok(night, 'canvas')).toBe('#000000')
  const alpha = (n: string) => Number(night.match(new RegExp(`--${n}:rgb\\(255 255 255\\/(\\.\\d+)\\)`))![1])
  const mine = over('#000000', true, alpha('mine'))
  const layers = ['#000000', tok(night, 'well')!, tok(night, 'overlay')!, tok(night, 'raised')!, tok(night, 'rx')!, mine]
  // each a little lighter than the one under it, never the same
  for (let i = 1; i < layers.length; i++) expect(lum(layers[i]!)).toBeGreaterThan(lum(layers[i - 1]!))
  // the cards and bubbles lift off the page by more than a hair (1.1:1 or more)
  for (const l of [tok(night, 'raised')!, tok(night, 'rx')!, mine]) expect(contrast(l, '#000000')).toBeGreaterThan(1.1)
  // hairlines a little stronger than Dark's, as nothing casts a shadow on black
  expect(alpha('line')).toBeGreaterThan(Number(themes[2]!.match(/--line:rgb\(255 255 255\/(\.\d+)\)/)![1]))
  expect(alpha('line2')).toBeGreaterThan(Number(themes[2]!.match(/--line2:rgb\(255 255 255\/(\.\d+)\)/)![1]))
  // words: the body and the second lines AA on every layer, the grey AA on all but the person's own bubble
  for (const l of layers) {
    expect(contrast(tok(night, 'fg')!, l)).toBeGreaterThanOrEqual(7)
    expect(contrast(tok(night, 'sub')!, l)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tok(night, 'muted')!, l)).toBeGreaterThanOrEqual(4.5)
  }
})
