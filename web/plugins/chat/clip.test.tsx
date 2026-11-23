// SHEP-345: + › Photos opens the phone's photo picker (an image-only file input, one tap attaches); a picture on the
// clipboard goes in as any paste does. The menu has no Paste image item.
import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { pasted } from './paste.ts'

// the formatted words need a browser (DOMPurify): drawn as they are here; every other export stays the real one
const realMarkdown = await import('./markdown.tsx')
mock.module('./markdown.tsx', () => ({ ...realMarkdown, Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t }))
const { AddButtons } = await import('./client.tsx')

test('a pasted screenshot (long-press, Paste) attaches as a picture', () => {
  const f = new File([new Uint8Array(4)], 'image.png', { type: 'image/png' })
  const dt = { files: [f] as unknown as FileList, types: ['Files'], getData: () => '' }
  const got = pasted(dt, new Date(2026, 10, 23, 10, 15, 0))
  expect(got.map((x) => x.name)).toEqual(['screenshot-2026-11-23-101500.png'])
})

test('no photo button: on a phone + is the only button, and its Photos opens an image-only picker where one tap attaches', () => {
  const phone = renderToStaticMarkup(<AddButtons finger onFiles={() => undefined} />)
  expect(phone).not.toContain('Add photos')
  expect(phone.match(/<button/g)?.length).toBe(1)
  expect(phone).toContain('aria-label="Add"')
  // + › Photos: one picture, so a tap on it in Android's picker attaches it (no Add tap)
  expect(phone).toMatch(/<input type="file" accept="image\/\*" hidden="" data-photo=""/)
  expect(phone).not.toContain('data-photos')
  // a desktop: + opens files straight away
  const desk = renderToStaticMarkup(<AddButtons finger={false} onFiles={() => undefined} />)
  expect(desk).toContain('aria-label="Add files"')
  expect(desk).not.toContain('accept=')
})

test('the plus menu is Photos then Files: no Paste image item, and no chip that reads the clipboard by itself', async () => {
  const src = await Bun.file(new URL('./client.tsx', import.meta.url)).text()
  expect(src).not.toContain('Paste image')
  expect(src).not.toContain('Paste copied picture')
  expect(src).not.toContain('clipboard.read')
  const menu = src.slice(src.indexOf('export function AddButtons'), src.indexOf("{ label: 'Add' }"))
  expect([...menu.matchAll(/label: '([^']+)'/g)].map((m) => m[1])).toEqual(['Photos', 'Files'])
})
