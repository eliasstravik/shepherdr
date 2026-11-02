// Real compilation runs in GitHub only; repository rules prohibit invoking suites/build checks on the dev VM.
import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginBuilds } from '../server/core/plugin-updates.ts'
import { readStaged } from '../scripts/build-plugins.ts'

test('API-2 user client and server compile from an isolated immutable application snapshot', async () => {
  const home = mkdtempSync(join(tmpdir(), 'core-plugin-compile-'))
  try {
    const plugin = join(home, 'plugins/hello'); mkdirSync(plugin, { recursive: true })
    writeFileSync(join(plugin, 'shepherdr.json'), '{"api":2}')
    writeFileSync(join(plugin, 'client.tsx'), `import { definePlugin } from '@client/kernel.ts'; export default definePlugin({ name: 'hello', setup(reg) { reg.topBars.push(() => <div>CORE_PLUGIN_COMPILE_PROOF</div>) } })`)
    writeFileSync(join(plugin, 'server.ts'), `export default { api: 2, name: 'hello', about: 'compiled proof', setup(c) { c.handle('hello', () => 'ok') } }`)
    const builder = new PluginBuilds(home, join(import.meta.dir, '..'))
    const dir = await builder.build()
    const registry = await import(pathToFileURL(join(dir, 'generated/server-plugins.ts')).href)
    expect(registry.enabled).toContain('hello')
    expect((await registry.user.find(([name]: [string]) => name === 'hello')[1]()).default.api).toBe(2)
    const assets = join(dir, 'dist/assets')
    expect(readdirSync(assets).filter(name => name.endsWith('.js')).some(name => readFileSync(join(assets, name), 'utf8').includes('CORE_PLUGIN_COMPILE_PROOF'))).toBe(true)
    builder.activate(dir)
    writeFileSync(join(plugin, 'server.ts'), 'export default { BROKEN SYNTAX')
    const retained = await builder.build(dir)
    expect(readStaged(retained).broken.hello.kept).toBe(true)
    expect(readFileSync(join(retained, 'user-plugins/hello/server.ts'), 'utf8')).toContain('compiled proof')
  } finally { rmSync(home, { recursive: true, force: true }) }
}, 120_000)
