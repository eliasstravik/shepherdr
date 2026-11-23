// SHEP-345: a picture on the clipboard and the photo button. "Paste image" reads the clipboard only when tapped; the
// photo button opens the phone's photo picker (an image-only file input, several at once).
import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { imagesOf, markOf, pasteImages } from './clip.ts'
import { pasted } from './paste.ts'

// the formatted words need a browser (DOMPurify): drawn as they are here; every other export stays the real one
const realMarkdown = await import('./markdown.tsx')
mock.module('./markdown.tsx', () => ({ ...realMarkdown, Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t }))
const { AddButtons } = await import('./client.tsx')

const item = (types: Record<string, Blob>) => ({ types: Object.keys(types), getType: async (t: string) => types[t] })
const pic = (n: number, type = 'image/png') => new Blob([new Uint8Array(n)], { type })

test('Paste image: the pictures on the clipboard, named like a screenshot; text alone is no picture', async () => {
  const now = new Date(2026, 10, 23, 10, 15, 0)
  const files = await imagesOf([item({ 'text/plain': new Blob(['hi']) }), item({ 'image/png': pic(5), 'text/html': new Blob(['<img>']) })], now)
  expect(files.map((f) => [f.name, f.type, f.size])).toEqual([['screenshot-2026-11-23-101500.png', 'image/png', 5]])
  const r = await pasteImages({ read: async () => [item({ 'image/png': pic(5) })] })
  expect('files' in r && r.files.length).toBe(1)
  expect(await pasteImages({ read: async () => [item({ 'text/plain': new Blob(['hi']) })] })).toEqual({ why: 'No picture copied.' })
})

test("Paste image says why when it can't: no clipboard reading here, or the person said no", async () => {
  expect(await pasteImages({})).toEqual({ why: "This browser can't read pictures from the clipboard. Long-press the box and Paste." })
  const no = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
  expect(await pasteImages({ read: async () => Promise.reject(no) })).toEqual({ why: "Shepherdr isn't allowed to read the clipboard." })
})

test('a pasted screenshot (long-press, Paste) attaches as a picture', () => {
  const f = new File([new Uint8Array(4)], 'image.png', { type: 'image/png' })
  const dt = { files: [f] as unknown as FileList, types: ['Files'], getData: () => '' }
  const got = pasted(dt, new Date(2026, 10, 23, 10, 15, 0))
  expect(got.map((x) => x.name)).toEqual(['screenshot-2026-11-23-101500.png'])
})

test('a copied picture is known again by its mark, so one pasted or put away is not offered twice', async () => {
  expect(await markOf(pic(5))).toBe(await markOf(pic(5)))
  expect(await markOf(pic(5))).not.toBe(await markOf(pic(6)))
})

test('the photo button: on a phone an image-only picker where one tap attaches; + has Photos for several', () => {
  const phone = renderToStaticMarkup(<AddButtons finger onFiles={() => undefined} paste={() => undefined} />)
  expect(phone).toContain('aria-label="Add photos"')
  // the button's: one picture, so a tap on it in Android's picker attaches it (no Add tap)
  expect(phone).toMatch(/<input type="file" accept="image\/\*" hidden="" data-photo=""/)
  // + › Photos: several at once
  expect(phone).toMatch(/<input type="file" accept="image\/\*" multiple="" hidden="" data-photos=""/)
  expect(phone).toContain('aria-label="Add"')
  // a desktop: + opens files straight away, no photo button
  const desk = renderToStaticMarkup(<AddButtons finger={false} onFiles={() => undefined} paste={() => undefined} />)
  expect(desk).not.toContain('Add photos')
  expect(desk).toContain('aria-label="Add files"')
  expect(desk).not.toContain('accept=')
})
