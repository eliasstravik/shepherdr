import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '@shared/types.ts'
import { snapshot } from '../demo/data.ts'
import { Secrets } from './settings.tsx'

// #1560 (25, 26): every kept secret is listed by name, a machine's own too, each with Replace and Remove; never a value.

const base = snapshot()
const space = base.places.find((p) => p.id !== base.everything)!
const vault = [
  { name: 'GITHUB_TOKEN', at: 1, scope: 'everywhere' as const, machine: null, space: null, where: 'Everywhere' },
  { name: 'DEPLOY_KEY', at: 1, scope: 'machine' as const, machine: null, space: null, where: 'This computer' },
  { name: 'SHOP_KEY', at: 1, scope: 'space' as const, machine: null, space: space.id, where: `Space ${space.name}` },
]
const snap: Snapshot = { ...base, settings: [...(base.settings ?? []).filter((x) => x.name !== 'Secrets'), { name: 'Secrets', level: 'all', rows: [], vault } as any] }
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

test("Everywhere's page lists every secret, a machine's own too, each with Replace and Remove", () => {
  const t = text(renderToStaticMarkup(<Secrets snap={snap} place="all" />))
  for (const n of ['GITHUB_TOKEN', 'DEPLOY_KEY', 'SHOP_KEY']) expect(t).toContain(n)
  expect(t).toContain(`Only agents on ${snap.host}`)
  expect(t.match(/Remove/g)?.length).toBe(3)
  expect(t.match(/Replace/g)?.length).toBe(3)
})

test("a space's own page lists only its own", () => {
  const t = text(renderToStaticMarkup(<Secrets snap={snap} place={space.id} />))
  expect(t).toContain('SHOP_KEY')
  expect(t).not.toContain('GITHUB_TOKEN')
  expect(t).not.toContain('DEPLOY_KEY')
})
