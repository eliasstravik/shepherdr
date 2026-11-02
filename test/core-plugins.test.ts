import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CorePlugins } from '../server/core/plugins.ts'
import { CoreStore } from '../server/core/store.ts'
import { Emitter } from '../server/source.ts'
import type { Snapshot } from '../shared/types.ts'
import type { PluginContext, ServerPlugin } from '../server/plugin-api.ts'

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'core-plugin-'))
  const store = new CoreStore(home), events = new Emitter<{ snapshot: [] }>()
  const plugins = new CorePlugins({ store, snapshot: () => ({ name: 'original', tasks: [] }) as unknown as Snapshot, on: (_, fn) => events.on('snapshot', fn) })
  return { store, plugins, events, close() { plugins.stop(); store.close(); rmSync(home, { recursive: true, force: true }) } }
}
const catalog = (names: string[]) => names.map(name => ({ name, on: true, from: 'user' as const }))
const action = (cid: string, plugin = 'hello', input?: unknown) => ({ type: 'plugin' as const, plugin, method: 'greet', cid, input })

describe('core plugin contract', () => {
  test('keeps state namespaced, returns detached snapshots, and disposes listeners', async () => {
    const f = fixture(); let changes = 0, disposed = 0
    try {
      const plugin = (name: string): ServerPlugin => ({ name, api: 2, about: '', setup(context) {
        context.state.set('count', 0)
        const snap = context.snapshot(); snap.name = 'mutated'
        expect(context.snapshot().name).toBe('original')
        context.onChange(() => { changes++ })
        context.handle('greet', () => { const count = context.state.get<number>('count')! + 1; context.state.set('count', count); return count })
        return () => { disposed++ }
      } })
      await f.plugins.start(catalog(['hello', 'other']), ['hello', 'other'].map(name => [name, async () => plugin(name)]))
      expect(await f.plugins.act(action('plugin-0001'))).toBe(1)
      expect(await f.plugins.act(action('plugin-0001'))).toBe(1)
      expect(await f.plugins.act(action('plugin-0002', 'other'))).toBe(1)
      f.events.emit('snapshot'); expect(changes).toBe(2)
      f.plugins.stop(); f.events.emit('snapshot')
      expect(changes).toBe(2); expect(disposed).toBe(2)
      await expect(f.plugins.act(action('plugin-0003'))).rejects.toThrow('stopping')
    } finally { f.close() }
  })
  test('does not load disabled plugins and isolates incompatible or failed setup', async () => {
    const f = fixture(); let disabled = 0, leaked = 0
    try {
      await f.plugins.start([...catalog(['old', 'broken', 'hello']), { name: 'off', from: 'user', on: false }], [
        ['off', async () => { disabled++; throw Error('off') }],
        ['old', async () => ({ name: 'old', about: '' })],
        ['broken', async () => ({ name: 'broken', api: 2, about: '', setup(c) { c.onChange(() => { leaked++ }); c.handle('greet', () => 1); throw Error('setup broke') } })],
        ['hello', async () => ({ name: 'hello', api: 2, about: '', setup(c) { c.handle('greet', () => 'ok') } })],
      ])
      f.events.emit('snapshot'); expect(disabled).toBe(0); expect(leaked).toBe(0)
      expect(f.plugins.section().rows.find(row => row.label === 'old')?.warn).toContain('api: 2')
      await expect(f.plugins.act(action('plugin-1001', 'broken'))).rejects.toThrow('setup broke')
      expect(await f.plugins.act(action('plugin-1002'))).toBe('ok')
    } finally { f.close() }
  })
  test('quarantines rejected async listeners and cleans late setup after stop', async () => {
    const f = fixture(); let release!: () => void, cleaned = 0, context!: PluginContext
    try {
      await f.plugins.start(catalog(['hello']), [['hello', async () => ({ name: 'hello', api: 2, about: '', setup(c) { c.onChange(async () => { throw Error('listener broke') }) } })]])
      f.events.emit('snapshot'); await Promise.resolve(); await Promise.resolve()
      expect(f.plugins.section().rows[0].warn).toContain('listener broke')
      const starting = f.plugins.start(catalog(['late']), [['late', async () => ({ name: 'late', api: 2, about: '', async setup(c) { context = c; await new Promise<void>(resolve => { release = resolve }); return () => { cleaned++ } } })]])
      await Promise.resolve(); await Promise.resolve()
      f.plugins.stop(); release(); await starting
      expect(cleaned).toBe(1); expect(() => context.state.set('x', 1)).toThrow('stopped')
    } finally { f.close() }
  })
  test('rejects command collisions, bounds JSON, and never repeats failed side effects', async () => {
    const f = fixture(); let effects = 0
    try {
      await f.plugins.start(catalog(['hello']), [['hello', async () => ({ name: 'hello', api: 2, about: '', setup(c) {
        c.handle('greet', input => { effects++; if (input === 'fail') throw Error('after effect'); return input })
      } })]])
      expect(await f.plugins.act(action('plugin-2001', 'hello', 1))).toBe(1)
      await expect(f.plugins.act(action('plugin-2001', 'hello', 2))).rejects.toThrow('different action')
      await expect(f.plugins.act(action('plugin-2002', 'hello', 'fail'))).rejects.toThrow('after effect')
      await expect(f.plugins.act(action('plugin-2002', 'hello', 'fail'))).rejects.toThrow('check its outcome')
      await expect(f.plugins.act(action('plugin-2003', 'hello', 'x'.repeat(65_537)))).rejects.toThrow('64 KiB')
      expect(effects).toBe(2)
    } finally { f.close() }
  })
})

test('prepared setup writes are invisible until activation and reject concurrent state changes', async () => {
  const f = fixture(), paused = new CorePlugins({ store: f.store, snapshot: () => ({ name: 'test' }) as Snapshot, on: (_, fn) => f.events.on('snapshot', fn) }, true)
  let changes = 0
  try {
    f.store.set('plugin:hello', 'n', 4)
    await paused.start(catalog(['hello']), [['hello', async () => ({ api: 2, name: 'hello', about: '', setup(c) {
      expect(c.state.get('n')).toBe(4); c.state.set('n', 5); expect(c.state.get('n')).toBe(5)
      c.onChange(() => { changes++ })
    } })]])
    expect(f.store.get('plugin:hello', 'n')).toBe(4)
    f.events.emit('snapshot'); expect(changes).toBe(0)
    f.store.set('plugin:hello', 'n', 6)
    expect(() => paused.activate()).toThrow('state changed during startup')
    expect(f.store.get('plugin:hello', 'n')).toBe(6)
  } finally { paused.stop(); f.close() }
})
