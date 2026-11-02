import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreSource } from '../server/core/source.ts'

async function withPlaces(run: (source: CoreSource, ids: string[], machine: string) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-core-places-'))
  const source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  const machine = source.snapshot().machines![0]!.machine
  const ids = ['Zulu', 'Alpha'].map(name => `p:${machine}:${name.toLowerCase()}`)
  for (const [i, id] of ids.entries()) source.store.set('space', id, { id, name: ['Zulu', 'Alpha'][i], machine, folder: `/repo/${i}`, base: 'main', prefix: 'DEMO', mode: 'regular', added: 1 })
  try { await run(source, ids, machine) }
  finally { source.stop(); await Bun.sleep(0); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
}

test('sidebar sections, moves, orders and delete restore the original machine organization', async () => {
  await withPlaces(async (source, [zulu, alpha], machine) => {
    const section = await source.act({ type: 'section', op: 'new', name: ' Focus ', emoji: '📁', machine }) as { id: string }
    expect(await source.act({ type: 'move', id: zulu!, to: section.id })).toMatchObject({ ok: true })
    let snap = source.snapshot()
    expect(snap.sections!.find(item => item.id === section.id)).toMatchObject({ name: 'Focus', emoji: '📁', spaces: [zulu] })
    expect(snap.places.map(item => item.id)).toEqual([alpha!, zulu!])
    await source.act({ type: 'order', under: `m:${machine}`, ids: [zulu!, alpha!] })
    expect(await source.act({ type: 'section', op: 'delete', id: section.id })).toMatchObject({ ok: true })
    expect(source.snapshot().places.map(item => item.id)).toEqual([zulu!, alpha!])
    await source.act({ type: 'move', id: alpha!, to: 'pinned' })
    expect(source.snapshot().sections!.find(item => item.id === 'pinned')?.spaces).toEqual([alpha!])
    expect(await source.act({ type: 'section', op: 'delete', id: 'pinned' })).toMatchObject({ ok: false })
    // Metadata is persisted, independent of core process state and snapshot object identity.
    expect(source.store.get('meta', 'place-order')).toMatchObject({ pinned: [alpha] })
  })
})

test('sidebar renames and emoji stay product-only and enforce familiar duplicate rules', async () => {
  await withPlaces(async (source, [zulu, alpha], machine) => {
    expect(await source.act({ type: 'rename', id: zulu!, name: '  new-name  ' })).toMatchObject({ ok: true })
    expect(source.snapshot().places.find(place => place.id === zulu)?.name).toBe('new-name')
    expect(source.space(zulu!)?.name).toBe('Zulu')
    expect(await source.act({ type: 'rename', id: alpha!, name: 'new-name' })).toMatchObject({ ok: false })
    expect(await source.act({ type: 'rename', id: alpha!, name: 'Alpha', emoji: '🙂' })).toMatchObject({ ok: false })
    const native = source.snapshot().machines![0]!.name
    await source.act({ type: 'rename', id: `m:${machine}`, name: 'My machine', emoji: '💻' })
    expect(source.snapshot().machines![0]).toMatchObject({ name: 'My machine', ownName: native, emoji: '💻' })
    await source.act({ type: 'rename', id: `m:${machine}`, name: '', emoji: '' })
    expect(source.snapshot().machines![0]).toMatchObject({ name: native })
    expect(source.snapshot().machines![0]!.emoji).toBeUndefined()
    expect(await source.act({ type: 'rename', id: '__proto__', name: 'bad' })).toMatchObject({ ok: false })
    expect(await source.act({ type: 'rename', id: 'constructor', name: 'bad' })).toMatchObject({ ok: false })
  })
})

test('a machine-local section rejects another machine’s space and duplicate names are scoped', async () => {
  await withPlaces(async (source, [zulu], machine) => {
    const section = await source.act({ type: 'section', op: 'new', name: 'Focus', machine }) as { id: string }
    expect(await source.act({ type: 'section', op: 'new', name: 'focus', machine })).toMatchObject({ ok: false })
    expect(await source.act({ type: 'section', op: 'new', name: 'Focus' })).toMatchObject({ ok: true })
    const remote = 'p:remote:repo'
    source.store.set('space', remote, { id: remote, name: 'Remote', machine: 'remote', folder: '/remote', base: 'main', prefix: 'REMOTE', mode: 'regular', added: 1 })
    expect(await source.act({ type: 'move', id: remote, to: section.id })).toMatchObject({ ok: false })
    expect(await source.act({ type: 'move', id: zulu!, to: 'm:remote' })).toMatchObject({ ok: false })
    expect(source.snapshot().sections!.find(item => item.id === section.id)?.spaces).toEqual([])
  })
})
