import { expect, test } from 'bun:test'
import { findLinks, linkAt, opens, trimEnd, withMarked, type Line } from './links.ts'

const W = 40
/** rows of a 40-column screen; `~` before a row: the terminal wrapped onto it */
const screen = (...rows: string[]): Line[] => rows.map((r) => (r.startsWith('~') ? { text: r.slice(1).padEnd(W), wrapped: true } : { text: r.padEnd(W) }))

test('a plain address on one row, with its cells', () => {
  const links = findLinks(screen('see https://example.com/a?b=1 for more'), W)
  expect(links).toEqual([{ url: 'https://example.com/a?b=1', parts: [{ row: 0, from: 4, to: 29 }] }])
  expect(linkAt(links, 0, 4)?.url).toBe('https://example.com/a?b=1')
  expect(linkAt(links, 0, 28)?.url).toBe('https://example.com/a?b=1')
  expect(linkAt(links, 0, 29)).toBeNull()
  expect(linkAt(links, 1, 10)).toBeNull()
})

test('a sign-in address the program broke over three lines is one link, query string and all', () => {
  const url = 'https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a&redirect_uri=https%3A%2F%2Fx.example%2Fcb&scope=org%3Acreate&state=Zx9_-k'
  const rows = [url.slice(0, W), url.slice(W, 2 * W), url.slice(2 * W, 3 * W), url.slice(3 * W)]
  const links = findLinks(screen('Browser didn\'t open? Use the url below', ...rows, '', 'Paste code here if prompted >'), W)
  expect(links.map((l) => l.url)).toEqual([url])
  expect(links[0].parts).toEqual([
    { row: 1, from: 0, to: 40 },
    { row: 2, from: 0, to: 40 },
    { row: 3, from: 0, to: 40 },
    { row: 4, from: 0, to: url.length - 3 * W },
  ])
  // a tap on its last line finds the whole of it
  expect(linkAt(links, 4, 1)?.url).toBe(url)
})

test('broken lines indented inside a box, with a full stop after it', () => {
  const url = 'https://example.com/a/very/long/path?q=one&r=two&s=three'
  const a = url.slice(0, 36), b = url.slice(36)
  const links = findLinks(screen(`│ ${a.padEnd(36)} │`, `│ ${(b + '.').padEnd(36)} │`), W)
  expect(links.map((l) => l.url)).toEqual([url])
  expect(links[0].parts).toEqual([
    { row: 0, from: 2, to: 38 },
    { row: 1, from: 2, to: 2 + b.length },
  ])
})

test('a row the terminal itself wrapped always joins', () => {
  const url = 'https://example.com/' + 'x'.repeat(40) + '?q=1'
  const links = findLinks(screen('go ' + url.slice(0, 37), '~' + url.slice(37) + ' now'), W)
  expect(links.map((l) => l.url)).toEqual([url])
})

test('words after an address that just filled its row are not the address', () => {
  const url = 'https://example.com/' + 'a'.repeat(20)
  expect(findLinks(screen(url, 'Press Enter to continue'), W).map((l) => l.url)).toEqual([url])
  // nor is a second address on the next line
  expect(findLinks(screen(url, 'https://other.example/'), W).map((l) => l.url)).toEqual([url, 'https://other.example/'])
  // an address that ends short of the edge never takes the next line
  expect(findLinks(screen('https://example.com/a', 'b'), W).map((l) => l.url)).toEqual(['https://example.com/a'])
})

test('trailing punctuation and brackets that are not the address stay out', () => {
  const urls = (s: string) => findLinks(screen(s), W).map((l) => l.url)
  expect(urls('(see https://example.com/a).')).toEqual(['https://example.com/a'])
  expect(urls('https://en.wikipedia.org/wiki/A_(b), ok')).toEqual(['https://en.wikipedia.org/wiki/A_(b)'])
  expect(urls('"https://example.com/q?x=1";')).toEqual(['https://example.com/q?x=1'])
  expect(urls('<https://example.com/>')).toEqual(['https://example.com/'])
  expect(urls('at https://example.com:8080/x!')).toEqual(['https://example.com:8080/x'])
  expect(urls('no https:// here')).toEqual([])
  expect(trimEnd('https://x.example/a]')).toBe('https://x.example/a')
  expect(trimEnd('https://x.example/[a]')).toBe('https://x.example/[a]')
})

test('a wide character before an address: its cells come from the columns', () => {
  const links = findLinks([{ text: '界 https://e.example/x', at: [0, ...Array.from({ length: 20 }, (_, i) => i + 2)] }], W)
  expect(links[0].parts).toEqual([{ row: 0, from: 3, to: 22 }])
})

test('other kinds are found but only http and https open', () => {
  expect(findLinks(screen('file:///etc/passwd and ftp://x.example/a'), W).map((l) => l.url)).toEqual(['file:///etc/passwd', 'ftp://x.example/a'])
  expect(opens('https://example.com/')).toBe(true)
  expect(opens('HTTP://example.com/')).toBe(true)
  for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x.example/a', 'vscode://open', 'data:text/html,x', 'not a url']) expect(opens(u)).toBe(false)
})

test('a link the program marked wins over the address found in the same cells', () => {
  const found = findLinks(screen('open https://example.com/ now'), W)
  const marked = [{ url: 'https://example.com/real', parts: [{ row: 0, from: 5, to: 25 }] }]
  expect(withMarked(found, marked)).toEqual(marked)
  const elsewhere = [{ url: 'https://docs.example/', parts: [{ row: 3, from: 0, to: 4 }] }]
  expect(withMarked(found, elsewhere).map((l) => l.url)).toEqual(['https://docs.example/', 'https://example.com/'])
})
