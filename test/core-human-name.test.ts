import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { humanName } from '../server/core/human-name.ts'

test('a private installation profile wins; otherwise use the first Git name or account', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-human-'))
  try {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ user: 'Avery Lee' }))
    expect(await humanName(home, async () => { throw Error('Must not probe Git for a configured profile') })).toBe('Avery Lee')
    rmSync(join(home, 'config.json'))
    expect(await humanName(home, async () => 'Morgan Smith\n')).toBe('Morgan')
    expect(await humanName(home, async () => { throw Error('Git absent') }, 'avery')).toBe('Avery')
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('invalid or linked profiles cannot import another home or controls into a sender name', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-human-')), other = mkdtempSync(join(tmpdir(), 'shep-human-other-'))
  try {
    writeFileSync(join(other, 'config.json'), '{"user":"Must not import"}')
    symlinkSync(join(other, 'config.json'), join(home, 'config.json'))
    expect(await humanName(home, async () => 'Morgan')).toBe('Morgan')
    rmSync(join(home, 'config.json'))
    for (const user of ['', 'Avery\ncommand', {}, 'x'.repeat(161)]) {
      writeFileSync(join(home, 'config.json'), JSON.stringify({ user }))
      expect(await humanName(home, async () => 'Morgan')).toBe('Morgan')
    }
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }) }
})
