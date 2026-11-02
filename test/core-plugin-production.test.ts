import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreSource } from '../server/core/source.ts'
import { CorePluginUpdates } from '../server/core/plugin-updates.ts'
import { prepareHome } from '../server/core/home.ts'

// Explicit CI job only: this exercises the real production compiler, prohibited on the shared VM.
test.skipIf(process.env.SHEPHERDR_REAL_PLUGIN_BUILD !== '1')('production plugin builds publish real assets and runtime together, retaining last good code', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-production-plugin-'))
  prepareHome(home)
  const folder = join(home, 'plugins/production-proof'); mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'shepherdr.json'), '{"api":2}')
  const edit = (version: string) => {
    writeFileSync(join(folder, 'client.tsx'), `import { definePlugin } from '@client/kernel.ts'; export default definePlugin({ name: 'production-proof', setup(reg) { reg.settingActions.productionProof = async () => '${version}' } })`)
    writeFileSync(join(folder, 'server.ts'), `export default { api: 2, name: 'production-proof', about: '', setup(c) { c.handle('next', () => { const n = (c.state.get('n') || 0) + 1; c.state.set('n', n); return { n, version: '${version}' } }) } }`)
  }
  edit('PRODUCTION_PLUGIN_FIRST')
  const source = new CoreSource({ home, port: 0, socket: '/unused', session: 'production-plugin-ci', binary: 'hc' })
  const updates = new CorePluginUpdates(source, join(import.meta.dir, '..')); source.pluginUpdates = updates
  const call = (cid: string) => source.act({ type: 'plugin', plugin: 'production-proof', method: 'next', cid })
  const assetsContain = (marker: string) => readdirSync(join(updates.assets.dist, 'assets')).filter(name => name.endsWith('.js')).some(name => readFileSync(join(updates.assets.dist, 'assets', name), 'utf8').includes(marker))
  try {
    updates.start(); await updates.drain()
    expect(updates.status().error).toBeUndefined()
    expect(assetsContain('PRODUCTION_PLUGIN_FIRST')).toBe(true)
    expect(await call('production-build-first')).toEqual({ n: 1, version: 'PRODUCTION_PLUGIN_FIRST' })
    const first = updates.assets.dist
    edit('PRODUCTION_PLUGIN_SECOND'); updates.scan(); await updates.drain()
    expect(updates.status().error).toBeUndefined()
    expect(updates.assets.dist).not.toBe(first)
    expect(assetsContain('PRODUCTION_PLUGIN_SECOND')).toBe(true)
    expect(assetsContain('PRODUCTION_PLUGIN_FIRST')).toBe(false)
    expect(await call('production-build-second')).toEqual({ n: 2, version: 'PRODUCTION_PLUGIN_SECOND' })
    writeFileSync(join(folder, 'client.tsx'), 'export default THIS IS INVALID TYPESCRIPT')
    updates.scan(); await updates.drain()
    expect(source.plugins.entries().find(item => item.name === 'production-proof')?.kept).toBe(true)
    expect(assetsContain('PRODUCTION_PLUGIN_SECOND')).toBe(true)
    expect(await call('production-build-retained')).toEqual({ n: 3, version: 'PRODUCTION_PLUGIN_SECOND' })
  } finally {
    updates.stop(); await updates.drain(); source.stop(); source.mailbox.close(); source.store.close()
    rmSync(home, { recursive: true, force: true })
  }
}, 300_000)
