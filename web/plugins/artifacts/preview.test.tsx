import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Artifact } from '@shared/types.ts'
import { failed, firstLines, loaded, RETRIES, startShot } from './preview.ts'
import { Preview } from './client.tsx'

// SHEP-344: a tile never shows a broken image. A calm empty frame until its picture has loaded, a few tries again,
// else the page's first lines.

const art = (x: Partial<Artifact> = {}): Artifact => ({ id: 'research-1a2b', title: 'Research', place: '', v: 2, at: 0, when: '', by: '', keeper: '', versions: [], ...x }) as Artifact

test('a version with a picture asks for it, hidden in a calm frame until it has loaded', () => {
  const html = renderToStaticMarkup(<Preview a={art({ thumb: true, machine: 'vm-2' })} dark={false} />)
  expect(html).toContain('class="prev wait"')
  expect(html).toContain('src="api/artifacts/research-1a2b/thumb?v=2&amp;on=vm-2"')
  expect(html).not.toContain('class="in"')
})

test('a version with no picture asks for none: never a broken image', () => {
  const html = renderToStaticMarkup(<Preview a={art({ thumb: false })} dark />)
  expect(html).not.toContain('<img')
  expect(html).toContain('class="prev"')
  expect(startShot(false).shown).toBe('lines')
})

test('a picture that fails is tried again, then the first lines show', () => {
  let s = startShot(true)
  expect(s).toEqual({ tries: 0, shown: 'wait' })
  const waits: number[] = []
  for (;;) {
    const { shot, retryIn } = failed(s)
    s = shot
    if (retryIn === null) break
    waits.push(retryIn)
    expect(s.shown).toBe('wait')
  }
  expect(waits).toEqual(RETRIES)
  expect(s.shown).toBe('lines')
  // one that comes on a try again is the picture
  expect(loaded(failed(startShot(true)).shot)).toEqual({ tries: 1, shown: 'pic' })
})

test("a page's first lines: its headings and paragraphs as text, never its head, scripts or styles", () => {
  const html = `<!doctype html><html><head><title>T</title><style>h1{color:red}</style></head><body>
    <script>alert("x")</script><nav><a>Home</a></nav>
    <h1>Prompt trees &amp; tools</h1><p>Who <b>TJ</b> is,<br>and similar tools.</p><svg><text>no</text></svg>
    <ul><li>One</li><li>  </li><li>Two &#8212; &#x2713;</li></ul><img src="a.png"></body></html>`
  expect(firstLines(html)).toEqual([
    { text: 'Prompt trees & tools', head: true },
    { text: 'Who TJ is, and similar tools.', head: false },
    { text: 'One', head: false },
    { text: 'Two — ✓', head: false },
  ])
  expect(firstLines('<body><div>Just <span>words</span></div></body>')).toEqual([{ text: 'Just words', head: false }])
  expect(firstLines('<body><img src=a.png></body>')).toEqual([])
  expect(firstLines(`<p>${'a'.repeat(400)}</p>`)[0]!.text.length).toBe(160)
  expect(firstLines(Array.from({ length: 20 }, (_, i) => `<p>${i}</p>`).join('')).length).toBe(6)
})
