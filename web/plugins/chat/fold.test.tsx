import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { addPaste, getPastes, isLongMessage, isLongPaste, joined, peekOf, setPastes, sizeOf } from './fold.ts'

const realMarkdown = await import('./markdown.tsx')
mock.module('./markdown.tsx', () => ({ ...realMarkdown, Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t }))
const { Folded } = await import('./client.tsx')

// A long paste (a JSON, a log) folds into a chip in the box; a long message folds in the chat. What is sent never changes.

const json = JSON.stringify({ items: Array.from({ length: 40 }, (_, i) => ({ id: i, name: `item ${i}` })) }, null, 2)

test('a long paste becomes a chip; a sentence or a short snippet stays in the box', () => {
  expect(isLongPaste(json)).toBe(true)
  expect(isLongPaste('x'.repeat(3000))).toBe(true)
  expect(isLongPaste('Fix the login page please.')).toBe(false)
  expect(isLongPaste('a\nb\nc\nd')).toBe(false)
  expect(isLongPaste('\n'.repeat(40))).toBe(false)
})

test('the chip says its size and its first words', () => {
  expect(sizeOf(json)).toBe(`${json.split('\n').length} lines`)
  expect(sizeOf('x'.repeat(3200))).toBe('3.2k characters')
  expect(peekOf('{\n  "items": [\n    {', 80)).toBe('{ "items": [ {')
  expect(peekOf('y'.repeat(100), 10)).toBe(`${'y'.repeat(9)}…`)
})

test('it is sent after what was typed, exactly as pasted', () => {
  const pasted = '  {\n\t"a": 1\n}  \n'
  expect(joined('What is wrong here?  ', [pasted])).toBe(`What is wrong here?\n\n${pasted}`)
  expect(joined('', [json])).toBe(json)
  expect(joined('look', [json, 'x'.repeat(3000)])).toBe(`look\n\n${json}\n\n${'x'.repeat(3000)}`)
  expect(joined('  ', [])).toBe('')
})

test("a box's pastes are kept per chat, and go when emptied", () => {
  addPaste('c1', json)
  addPaste('c1', 'second')
  expect(getPastes('c1').map((p) => p.text)).toEqual([json, 'second'])
  expect(getPastes('c2')).toEqual([])
  setPastes('c1', () => [])
  expect(getPastes('c1')).toEqual([])
})

test('a very long message shows folded with Show more; all its words are on the page', () => {
  expect(isLongMessage(json)).toBe(true)
  expect(isLongMessage('Done: it works.')).toBe(false)
  const html = renderToStaticMarkup(<Folded text={json}><div className="md">{json}</div></Folded>)
  expect(html).toContain('mfold clip')
  expect(html).toContain(`Show more · ${sizeOf(json)}`)
  expect(html).toContain('item 39')
  const short = renderToStaticMarkup(<Folded text="Done."><div className="md">Done.</div></Folded>)
  expect(short).toBe('<div class="md">Done.</div>')
})
