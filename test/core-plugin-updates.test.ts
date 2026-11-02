import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PluginBuilds, CorePluginUpdates, pluginFingerprint, type PluginCompiler } from '../server/core/plugin-updates.ts'
import { CoreSource } from '../server/core/source.ts'
import { readStaged } from '../scripts/build-plugins.ts'
import { prepareHome } from '../server/core/home.ts'

function file(path: string, value: string) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, value) }
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'core-plugin-updates-')), home = join(dir, 'home'), app = join(dir, 'app')
  file(join(app, 'plugins.json'), '{"plugins":[]}'); mkdirSync(join(app, 'node_modules'))
  file(join(app, 'public/pin.txt'), 'started code')
  mkdirSync(home, { mode: 0o700 })
  prepareHome(home)
  file(join(home, 'plugins/hello/shepherdr.json'), '{"api":2}')
  file(join(home, 'plugins/hello/server.ts'), `export default { api: 2, name: 'hello', about: '', setup(c) { c.handle('count', () => { const n = (c.state.get('n') || 0) + 1; c.state.set('n', n); return n }) } }`)
  return { dir, home, app }
}
const compile: PluginCompiler = async dir => {
  const user = join(dir, 'user-plugins/hello/server.ts')
  if (existsSync(user) && readFileSync(user, 'utf8').includes('BROKEN')) return { ok: false, out: 'user-plugins/hello/server.ts: syntax BROKEN' }
  file(join(dir, 'dist/index.html'), '<script src="assets/good-123.js"></script>')
  return { ok: true, out: '' }
}

test('plugin builds freeze started code, keep last good extensions, and bound retained builds', async () => {
  const f = fixture()
  try {
    const builder = new PluginBuilds(f.home, f.app, compile)
    file(join(f.app, 'public/pin.txt'), 'later checkout')
    const first = await builder.build(); builder.activate(first)
    expect(readFileSync(join(first, 'public/pin.txt'), 'utf8')).toBe('started code')
    file(join(f.home, 'plugins/hello/server.ts'), 'BROKEN')
    const second = await builder.build(first); builder.activate(second, first)
    expect(readStaged(second).broken.hello.kept).toBe(true)
    expect(readFileSync(join(second, 'user-plugins/hello/server.ts'), 'utf8')).not.toContain('BROKEN')
    const third = await builder.build(second); builder.activate(third, second)
    expect(existsSync(first)).toBe(false); expect(existsSync(second)).toBe(true)
    // A new app version must never reuse an old server extension build.
    const changed = new PluginBuilds(f.home, f.app, compile)
    expect(changed.previous()).toBeUndefined()
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('plugin switches swap server behavior and presentation without restarting core agents', async () => {
  const f = fixture(), source = new CoreSource({ home: f.home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  const updates = new CorePluginUpdates(source, f.app, compile); source.pluginUpdates = updates
  try {
    updates.start(); await updates.drain()
    const first = updates.assets.dist
    expect(await source.act({ type: 'plugin', plugin: 'hello', method: 'count', cid: 'update-plugin-01' })).toBe(1)
    await source.act({ type: 'setting', key: 'plugin.hello', value: 'off' }); await updates.drain()
    expect(updates.assets.dist).not.toBe(first)
    await expect(source.act({ type: 'plugin', plugin: 'hello', method: 'count', cid: 'update-plugin-02' })).rejects.toThrow('No such enabled')
    await source.act({ type: 'setting', key: 'plugin.hello', value: 'on' }); await updates.drain()
    expect(await source.act({ type: 'plugin', plugin: 'hello', method: 'count', cid: 'update-plugin-03' })).toBe(2)
    await expect(source.act({ type: 'setting', key: 'plugin.hello', value: 'off', place: 'm:remote' })).rejects.toThrow('Everywhere')
    expect(source.core.current.connected).toBe(false)
  } finally { updates.stop(); await updates.drain(); source.stop(); source.mailbox.close(); source.store.close(); rmSync(f.dir, { recursive: true, force: true }) }
})

test('last good build survives server restart for the same application', async () => {
  const f = fixture()
  try {
    const builder = new PluginBuilds(f.home, f.app, compile), first = await builder.build(); builder.activate(first)
    const restarted = new PluginBuilds(f.home, f.app, compile)
    expect(restarted.previous()).toBe(first)
    file(join(f.home, 'plugins/hello/server.ts'), 'BROKEN')
    const next = await restarted.build(restarted.previous())
    expect(readStaged(next).broken.hello.kept).toBe(true)
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('plugin source identity changes for switches and edits; recursive symlinks fail boundedly', () => {
  const f = fixture()
  try {
    const before = pluginFingerprint(f.home)
    file(join(f.home, 'plugins.json'), '{"off":["hello"]}')
    expect(pluginFingerprint(f.home)).not.toBe(before)
    symlinkSync(join(f.home, 'plugins'), join(f.home, 'plugins/hello/loop'), 'dir')
    expect(() => pluginFingerprint(f.home)).toThrow('20 levels')
  } finally { rmSync(f.dir, { recursive: true, force: true }) }
})

test('disabled built-ins reject server calls and suppress alerts while core remains independent', async () => {
  const f = fixture(), source = new CoreSource({ home: f.home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  let alerts = 0, closed = 0; const voice: string[] = []
  try {
    await source.plugins.start(['voice', 'terminal', 'browser', 'artifacts', 'worktree', 'health', 'alerts'].map(name => ({ name, from: 'base', on: false })), [])
    source.on('alert', () => { alerts++ })
    source.emit('alert', { id: 'off', from: 'test', title: 'off', body: 'off', go: { place: 'unused' } })
    source.voice('unused', { send: raw => voice.push(String(raw)), close: () => { closed++ } })
    expect(voice.join('')).toContain('voice plugin is off'); expect(closed).toBe(1); expect(alerts).toBe(0)
    await expect(source.act({ type: 'keys', chat: 'unused', keys: ['Enter'] })).rejects.toThrow('terminal plugin is off')
    await expect(source.act({ type: 'artifact-delete', place: 'unused', artifact: 'unused' })).rejects.toThrow('artifacts plugin is off')
    await expect(source.worktree({ task: 'unused', what: 'files' })).rejects.toThrow('worktree plugin is off')
    expect(await source.artifact('unused')).toBeUndefined()
    expect(source.health.view('unused')).toBeUndefined()
  } finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(f.dir, { recursive: true, force: true }) }
})

test('runtime import and setup failures preserve the working extension and its state', async () => {
  const f = fixture(), source = new CoreSource({ home: f.home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  const updates = new CorePluginUpdates(source, f.app, compile); source.pluginUpdates = updates
  try {
    updates.start(); await updates.drain()
    expect(await source.act({ type: 'plugin', plugin: 'hello', method: 'count', cid: 'runtime-good-01' })).toBe(1)
    for (const [index, bad] of [
      `throw Error('IMPORT_STARTUP_FAILED'); export default { api: 2, name: 'hello', about: '' }`,
      `export default { api: 2, name: 'hello', about: '', setup(c) { c.state.delete('n'); c.state.set('other', 'must not persist'); return Promise.reject(Error('SETUP_STARTUP_FAILED')) } }`,
    ].entries()) {
      file(join(f.home, 'plugins/hello/server.ts'), bad)
      updates.scan(); await updates.drain()
      expect(source.plugins.entries().find(item => item.name === 'hello')?.kept).toBe(true)
      expect(await source.act({ type: 'plugin', plugin: 'hello', method: 'count', cid: `runtime-good-0${index + 2}` })).toBe(index + 2)
    }
    expect(updates.status().updating).toBe(false)
    expect(source.store.get('plugin:hello', 'other')).toBeUndefined()
  } finally { updates.stop(); await updates.drain(); source.stop(); source.mailbox.close(); source.store.close(); rmSync(f.dir, { recursive: true, force: true }) }
})

test('publishing voice off ends existing calls, and shutdown aborts an owned build', async () => {
  const f = fixture(), source = new CoreSource({ home: f.home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  file(join(f.app, 'plugins.json'), '{"plugins":["voice"]}')
  file(join(f.app, 'plugins/voice/server.ts'), `export default { name: 'voice', about: '' }`)
  let ended = 0, aborted = false
  source.voices.stop = () => { ended++ }
  let hold = false
  const compiler: PluginCompiler = (dir, signal) => !hold ? compile(dir) : new Promise(resolve => {
    signal!.addEventListener('abort', () => { aborted = true; resolve({ ok: false, out: 'aborted' }) }, { once: true })
  })
  const updates = new CorePluginUpdates(source, f.app, compiler); source.pluginUpdates = updates
  try {
    updates.start(); await updates.drain(); expect(ended).toBe(0)
    updates.set('voice', false); await updates.drain(); expect(ended).toBe(1)
    hold = true; updates.set('voice', true); updates.stop(); await updates.drain()
    expect(aborted).toBe(true); expect(source.plugins.has('voice')).toBe(false)
  } finally { updates.stop(); await updates.drain(); source.stop(); source.mailbox.close(); source.store.close(); rmSync(f.dir, { recursive: true, force: true }) }
})
