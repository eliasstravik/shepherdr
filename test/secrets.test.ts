// Agents' secrets: kept at a level (Everywhere, a machine, a space) in a file only you can read, picked most specific
// first, asked for with a masked card, and never in a snapshot, a chat or the command's printed answer.
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, statSync, symlinkSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

process.env.SHEPHERDR_HOME = mkdtempSync(join(tmpdir(), 'shep-secrets-'))
process.env.HERDR_SOCKET_PATH = join(process.env.SHEPHERDR_HOME, 'no-herdr.sock')
delete process.env.SHEPHERDR_MAIN
const { Vault, secretPages } = await import('../server/common/secrets.ts')

describe('the vault', () => {
  test('the most specific level wins, and its file is readable by you only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shep-vault-'))
    const v = new Vault(dir)
    expect(v.set('all', 'TOKEN', 'everywhere').ok).toBe(true)
    expect(v.set('p:box:api', 'TOKEN', 'for api').ok).toBe(true)
    expect(v.set('m:box', 'OTHER', 'box').ok).toBe(true)
    const chain = ['p:box:api', 'm:box', 'all']
    expect(v.pick(['TOKEN', 'OTHER', 'NONE'], chain)).toEqual({ found: { TOKEN: { value: 'for api', level: 'p:box:api' }, OTHER: { value: 'box', level: 'm:box' } }, missing: ['NONE'] })
    expect(v.pick(['TOKEN'], ['p:box:web', 'm:box', 'all']).found.TOKEN.value).toBe('everywhere')
    expect(v.visible(chain).map((x) => [x.name, x.level])).toEqual([
      ['OTHER', 'm:box'],
      ['TOKEN', 'p:box:api'],
    ])
    expect(statSync(join(dir, 'vault.json')).mode & 0o777).toBe(0o600)
    // removed: the level above counts again
    expect(v.set('p:box:api', 'TOKEN', null).ok).toBe(true)
    expect(v.pick(['TOKEN'], chain).found.TOKEN.value).toBe('everywhere')
    expect(v.set('p:box:api', 'TOKEN', null).ok).toBe(false)
  })

  test('a name is one an environment variable may have, and a value is not empty', () => {
    const v = new Vault('', {})
    expect(v.set('all', 'BAD NAME', 'x').ok).toBe(false)
    expect(v.set('all', '1TOKEN', 'x').ok).toBe(false)
    expect(v.set('all', 'TOKEN', '').ok).toBe(false)
    expect(v.set('nowhere', 'TOKEN', 'x').ok).toBe(false)
    expect(v.set('all', 'github_token', 'x').ok).toBe(true)
  })

  test("Settings gets a Secrets page for each level, with names and never a value", () => {
    const v = new Vault('', { all: { A: { value: 'shh-1', at: 1 } }, 'p:box:api': { B: { value: 'shh-2', at: 2 } } })
    const pages = secretPages([{ name: 'Tasks', rows: [], level: 'all' }, { name: 'Tasks', rows: [], level: 'p:box:api', machine: 'box' }, { name: 'Alerts', rows: [], global: true }], v.names())
    const secrets = pages.filter((p) => p.secrets)
    expect(secrets.map((p) => [p.level, p.machine, p.secrets!.map((s) => s.name)])).toEqual([
      ['all', undefined, ['A']],
      ['p:box:api', 'box', ['B']],
    ])
    expect(JSON.stringify(pages)).not.toContain('shh-')
  })
})
