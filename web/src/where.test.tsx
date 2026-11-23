// SHEP-360: the chat header's folder is quiet text beside the name, on every chat, ~ and / as they are, and gives way from its start
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '@shared/types.ts'
import type { Space } from '@shared/view.ts'
import { HeaderPath } from './where.tsx'

const snap = { host: 'mini', everything: 'ev', places: [{ id: 'ev', machine: 'mini', home: true }], machines: [{ id: 'm:mini', machine: 'mini', name: 'Mac mini', status: 'idle' }, { id: 'm:vm', machine: 'vm', name: 'vm', status: 'idle' }] } as unknown as Snapshot
const html = (p: Partial<Space>) => renderToStaticMarkup(<HeaderPath snap={snap} place={{ name: 'x', chat: 'c', ...p } as Space} />)
const css = readFileSync(new URL('./ds.css', import.meta.url), 'utf8')

test('a named space: its path, cut from its start, no machine here', () => {
  const h = html({ id: 'docs', machine: 'mini', where: '~/dev/clients/northwind/docs', folder: '/Users/sam/dev/clients/northwind/docs' })
  expect(h).toContain('class="hpath"')
  expect(h).toContain('<span class="hp cut"><bdi>~/dev/clients/northwind/docs</bdi></span>')
  expect(h).not.toContain('class="hm"')
  expect(h).toContain('aria-label="Folder: /Users/sam/dev/clients/northwind/docs"')
})

test('the root: / as it is, and its machine', () => {
  const h = html({ id: 'r', machine: 'vm', where: '/', folder: '/' })
  expect(h).toContain('<span class="hp"><bdi>/</bdi></span><span class="hm">vm</span>')
  expect(h).not.toContain('Root folder')
})

test('Everything shows it too: ~ on its machine', () => {
  const h = html({ id: 'ev', machine: 'mini', where: '~', folder: '/Users/sam', home: true })
  expect(h).toContain('<bdi>~</bdi></span><span class="hm">Mac mini</span>')
  expect(h).not.toContain('Home folder')
})

test('quiet: no pill, border, fill or icon; it gives way before the name, from its start', () => {
  const rule = (sel: string) => css.match(new RegExp(`(?:^|\\})${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`, 'm'))?.[1] ?? ''
  const hp = rule('.hpath')
  expect(hp).toContain('color:var(--muted)')
  expect(hp).toContain('font-size:var(--sec)')
  expect(hp).not.toMatch(/background|box-shadow|border/)
  expect(html({ id: 'ev', machine: 'mini', where: '~' })).not.toContain('<svg')
  // the name never shrinks for it (only to the header's width); the path gives way before its machine, and a cut path
  // keeps its end
  expect(css).toContain('.ttl>.tbtn{flex:none;max-width:100%}')
  expect(hp).toContain('min-width:44px')
  expect(css).toContain('.hm{flex:none;max-width:60%}')
  expect(css).toContain('.hp.cut{direction:rtl}')
  // a tap target never under 44 px; too narrow a header drops the path, never the name
  expect(css).toContain('@container (max-width:160px){.ttl>.hpath{display:none}')
})
