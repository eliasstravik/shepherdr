// A space's icon: a picture as a small <img> (never anything that runs), an emoji as text, else the # glyph; its own
// button, labelled, left of the Name field.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Glyph, NameWithIcon } from './space-icon.tsx'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('a picture, an emoji, or the glyph (Everything: its layers)', () => {
  const pic = renderToStaticMarkup(<Glyph icon={png} />)
  expect(pic).toStartWith('<img class="sic pic"')
  expect(pic).toContain('alt=""')
  expect(renderToStaticMarkup(<Glyph icon="🧪" c="s16" />)).toBe('<span class="sic s16" aria-hidden="true">🧪</span>')
  expect(renderToStaticMarkup(<Glyph />)).toContain('<svg class="i"')
  expect(renderToStaticMarkup(<Glyph root />)).not.toBe(renderToStaticMarkup(<Glyph />))
})

test('the Name field holds only the name; the icon is its own labelled button beside it', () => {
  const html = renderToStaticMarkup(<NameWithIcon icon={null} onIcon={() => {}}><input className="inp" aria-label="Name" placeholder="docs" /></NameWithIcon>)
  expect(html).toContain('aria-label="Space icon"')
  expect(html).toContain('type="file"')
  expect(html).not.toContain('# ')
  expect(html.indexOf('Space icon')).toBeLessThan(html.indexOf('aria-label="Name"'))
})
