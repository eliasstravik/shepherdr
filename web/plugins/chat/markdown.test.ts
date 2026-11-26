import { expect, test } from 'bun:test'
import { Marked } from 'marked'
// its own copy of the rule: other tests replace markdown.tsx's module, but keep its real exports
const { rawHtmlAsText } = (await import('./markdown.tsx' + '?own')) as typeof import('./markdown.tsx')
const marked = new Marked({ gfm: true, breaks: false }).use(rawHtmlAsText)

// #1549: raw HTML in an agent's reply shows as typed and never styles the rest of the message
test('a placeholder in angle brackets stays text', () => {
  const html = marked.parse('Answer "yes <code>" when asked.\n\nThen a **second** paragraph.', { async: false }) as string
  expect(html).toContain('yes &lt;code&gt;')
  expect(html).not.toContain('<code>')
  expect(html).toContain('<strong>second</strong>')
})

test('a block of raw HTML stays text, a line break still breaks', () => {
  expect(marked.parse('<div onclick="x">hi</div>', { async: false })).toContain('&lt;div')
  expect(marked.parse('| a |\n|---|\n| one<br>two |', { async: false })).toContain('one<br>two')
})

test('markdown code is still code', () => {
  expect(marked.parse('run `<id>` now', { async: false })).toContain('<code>&lt;id&gt;</code>')
})
