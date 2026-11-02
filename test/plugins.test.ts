// The human's own plugins (~/.shepherdr/plugins): added, replacing a base one of the same name, turned off, and one that
// fails skipped without taking the rest down.
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pluginCatalog, readStaged, stageUserPlugins, writeRegistries } from '../scripts/build-plugins.ts'
import { pluginsPage, setPluginOn } from '../server/plugins.ts'
import { HOME } from '../server/store.ts'
import { guardFn, setupGuarded } from '../src/guard.tsx'

function file(path: string, text = '') {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

/** a build with base plugins a and b, and a home with the human's own: b (in b's place) and c */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'shep-plugins-'))
  const home = mkdtempSync(join(tmpdir(), 'shep-plugins-home-'))
  file(join(dir, 'plugins.json'), JSON.stringify({ plugins: ['a', 'b'] }))
  file(join(dir, 'plugins', 'a', 'client.tsx'))
  file(join(dir, 'plugins', 'b', 'client.tsx'))
  file(join(dir, 'plugins', 'b', 'server.ts'))
  file(join(home, 'plugins', 'b', 'client.tsx'))
  file(join(home, 'plugins', 'c', 'client.tsx'))
  file(join(home, 'plugins', 'c', 'server.ts'))
  for (const name of ['b', 'c']) file(join(home, 'plugins', name, 'shepherdr.json'), '{"api":2}')
  // not plugins: a folder with neither part, a name that isn't one, a loose file
  file(join(home, 'plugins', 'notes', 'README.md'))
  file(join(home, 'plugins', 'Bad Name', 'client.tsx'))
  file(join(home, 'plugins', 'loose.ts'))
  return { dir, home }
}

describe('a build with the human’s own plugins', () => {
  test('incompatible user parts are never imported; built-in replacements fall back', () => {
    const { dir, home } = fixture()
    rmSync(join(home, 'plugins', 'b', 'shepherdr.json'))
    file(join(home, 'plugins', 'c', 'shepherdr.json'), '{"api":1}')
    stageUserPlugins(dir, home)
    writeRegistries(dir)
    const client = readFileSync(join(dir, 'generated', 'client-plugins.ts'), 'utf8')
    const server = readFileSync(join(dir, 'generated', 'server-plugins.ts'), 'utf8')
    expect(client).toContain("import b from '../plugins/b/client.tsx'")
    expect(client).not.toContain('../user-plugins/')
    expect(server).not.toContain('../user-plugins/')
    expect(pluginCatalog(dir).find(plugin => plugin.name === 'c')?.broken).toContain('Migrate this 2.0 plugin')
    rmSync(dir, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true })
  })
  test('one is added after the base ones; one with a base name replaces it, in its place', () => {
    const { dir, home } = fixture()
    stageUserPlugins(dir, home)
    expect(pluginCatalog(dir)).toEqual([
      { name: 'a', from: 'base', on: true },
      { name: 'b', from: 'user', overrides: true, on: true },
      { name: 'c', from: 'user', on: true },
    ])
    writeRegistries(dir)
    const client = readFileSync(join(dir, 'generated', 'client-plugins.ts'), 'utf8')
    expect(client).toContain("import a from '../plugins/a/client.tsx'")
    expect(client).toContain(`{ name: "b", load: () => import('../user-plugins/b/client.tsx') }`)
    expect(client).not.toContain('../plugins/b/')
    expect(client).toContain('export const user = ["b","c"]')
    const server = readFileSync(join(dir, 'generated', 'server-plugins.ts'), 'utf8')
    // the base b's server part goes with it; c's loads on its own, so one that throws is only skipped
    expect(server).not.toContain('plugins/b/server.ts')
    expect(server).toContain(`["c", () => import('../user-plugins/c/server.ts')]`)
  })

  test('their list turns any plugin off, base or their own', () => {
    const { dir, home } = fixture()
    file(join(home, 'plugins.json'), JSON.stringify({ off: ['a', 'c'] }))
    stageUserPlugins(dir, home)
    expect(pluginCatalog(dir).filter((p) => p.on).map((p) => p.name)).toEqual(['b'])
    expect(writeRegistries(dir)).toEqual(['b'])
  })

  test("one that didn't build: a new one is off, one replacing a base one leaves the base one on", () => {
    const { dir, home } = fixture()
    stageUserPlugins(dir, home)
    file(join(dir, 'user-plugins.json'), JSON.stringify({ off: [], broken: { b: { error: 'b: no' }, d: { error: 'd: no' } } }))
    rmSync(join(dir, 'user-plugins', 'b'), { recursive: true })
    expect(readStaged(dir).broken.d.error).toBe('d: no')
    expect(pluginCatalog(dir)).toEqual([
      { name: 'a', from: 'base', on: true },
      { name: 'b', from: 'base', on: true, broken: 'b: no' },
      { name: 'c', from: 'user', on: true },
      { name: 'd', from: 'user', on: false, broken: 'd: no' },
    ])
  })
})

describe('Settings → Plugins', () => {
  test('base ones, then yours, each with a switch; what replaces or failed says so', () => {
    const page = pluginsPage(
      [
        { name: 'chat', from: 'base', on: true },
        { name: 'voice', from: 'user', overrides: true, on: true },
        { name: 'hello', from: 'user', on: true, broken: 'hello: no', kept: true },
        { name: 'bad', from: 'user', on: false, broken: 'bad: no' },
        { name: 'boom', from: 'user', on: true },
      ],
      ['chat'],
      { boom: 'boom!' },
    )
    expect(page.rows.map((r) => [r.label, r.group, r.value])).toEqual([
      ['chat', 'Built in', 'off'],
      ['voice', 'Yours', 'on'],
      ['hello', 'Yours', 'on'],
      ['bad', 'Yours', 'on'],
      ['boom', 'Yours', 'on'],
    ])
    expect(page.rows.every((r) => r.key === `plugin.${r.label}` && r.options?.join() === 'on,off')).toBe(true)
    const row = (n: string) => page.rows.find((r) => r.label === n)!
    expect(row('chat').hint).toBe('Turning off: restarting')
    expect(row('voice').hint).toBe('Replaces the built-in one')
    expect(row('hello').warn).toBe("Your latest change doesn't build, so its last good version runs:\nhello: no")
    expect(row('bad').warn).toBe("Skipped: it doesn't build:\nbad: no")
    expect(row('boom').warn).toContain('boom!')
  })

  test('a switch writes the human’s own list, never the repo’s', () => {
    expect(setPluginOn('voice', false)).toEqual({ ok: true })
    expect(setPluginOn('chat', false)).toEqual({ ok: true })
    expect(setPluginOn('voice', true)).toEqual({ ok: true })
    expect(JSON.parse(readFileSync(join(HOME, 'plugins.json'), 'utf8'))).toEqual({ off: ['chat'] })
    expect(setPluginOn('nothing-here', false).ok).toBe(false)
  })
})

describe('on the screen', () => {
  test('a setup that throws leaves the slots as they were', () => {
    const View = () => null
    const reg = { overlays: [View], views: { chat: View } as Record<string, unknown>, composerIdle: null as unknown }
    setupGuarded('boom', reg, (r) => {
      r.overlays.push(() => null)
      r.views.tasks = () => null
      r.composerIdle = () => null
      throw new Error('nope')
    })
    expect(reg.overlays).toEqual([View])
    expect(reg.views).toEqual({ chat: View })
    expect(reg.composerIdle).toBeNull()
  })

  test('what it adds is wrapped: its functions give a safe answer once they throw', async () => {
    const reg = { keys: [] as { order: number; handle: () => boolean }[], settingActions: {} as Record<string, () => Promise<string>> }
    setupGuarded('keys', reg, (r) => {
      r.keys.push({ order: 1, handle: () => { throw new Error('nope') } })
      r.settingActions.go = async () => { throw new Error('nope') }
    })
    expect(reg.keys[0].order).toBe(1)
    expect(reg.keys[0].handle()).toBe(false)
    expect(await reg.settingActions.go()).toBe('That failed.')
    expect(guardFn('x', () => 2, 0)()).toBe(2)
  })
})
