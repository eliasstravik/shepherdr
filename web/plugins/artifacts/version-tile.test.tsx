import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Artifact, Snapshot } from '@shared/types.ts'
import { snapshot } from '../../demo/data.ts'

// #1560 (32): a chat's card for an older version shows and opens that version, not the newest.

const art: Artifact = { id: 'board-1a2b', title: 'Board', place: snapshot().places[0]!.id, v: 3, at: 3000, when: '', by: '', keeper: '', thumb: true,
  versions: [3, 2, 1].map((n) => ({ n, at: n * 1000, when: '', by: '', html: n })) }
const snap: Snapshot = { ...snapshot(), artifacts: [art] }
const kernel = await import('@client/kernel.ts')
const prefs = await import('@client/prefs.ts')
mock.module('@client/kernel.ts', () => ({ ...kernel, useSnap: () => snap }))
mock.module('@client/prefs.ts', () => ({ ...prefs, useDark: () => false }))
const { postedVersion, Tile } = await import('./client.tsx')

test('a card posted with an older version, still kept, is that version', () => {
  expect(postedVersion(art, 2)?.n).toBe(2)
  expect(postedVersion(art, 3)).toBeNull()
  expect(postedVersion(art, undefined)).toBeNull()
  // one no longer kept opens the newest
  expect(postedVersion({ ...art, versions: art.versions.filter((x) => x.n !== 1) }, 1)).toBeNull()
})

test("an older version's tile says so and shows that version's picture", () => {
  const html = renderToStaticMarkup(<Tile id={art.id} v={2} />)
  expect(html).toContain('Version 2 · ')
  expect(html).toContain('thumb?v=2')
})

test("the newest version's tile is as before", () => {
  const html = renderToStaticMarkup(<Tile id={art.id} v={3} />)
  expect(html).not.toContain('Version')
  expect(html).toContain('thumb?v=3')
})
