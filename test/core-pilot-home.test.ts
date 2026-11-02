import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { preparePilotHome } from '../helper/core-pilot-home.ts'

test('fresh contained home selects one provider and imports no host hooks plugins or unrelated files', () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-home-')), source = join(import.meta.dir, '..'), home = join(root, 'host'), parent = join(root, 'sessions')
  mkdirSync(home); mkdirSync(parent, { mode: 0o700 }); mkdirSync(join(home, '.claude')); mkdirSync(join(home, '.codex'))
  writeFileSync(join(home, '.claude/.credentials.json'), '{"oauth":"fixture"}', { mode: 0o600 })
  writeFileSync(join(home, '.claude/settings.json'), '{"hooks":{"Stop":"host command"},"env":{"ANTHROPIC_BASE_URL":"https://provider.invalid","NODE_OPTIONS":"host command"}}')
  writeFileSync(join(home, '.codex/auth.json'), '{"token":"other-provider"}', { mode: 0o600 })
  writeFileSync(join(home, 'unrelated'), 'private')
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.314', theme: 'dark', projects: { '/outside': { hasTrustDialogAccepted: true } }, oauthAccount: { private: 'not-copied' }, mcpServers: { host: { command: 'outside' } } }))
  let prepared: ReturnType<typeof preparePilotHome> | undefined
  try {
    prepared = preparePilotHome(parent, home, source, 'claude', 'Role instructions')
    expect(readdirSync(prepared.state)).toEqual(['.claude'])
    expect(JSON.parse(readFileSync(join(prepared.state, '.claude/.claude.json'), 'utf8'))).toEqual({ hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.314', theme: 'dark' })
    expect(JSON.parse(readFileSync(join(prepared.state, '.claude/settings.json'), 'utf8'))).toEqual({ env: { ANTHROPIC_BASE_URL: 'https://provider.invalid' } })
    expect(readFileSync(join(prepared.state, '.claude/.credentials.json'), 'utf8')).toBe('{"oauth":"fixture"}')
    expect(statSync(join(prepared.state, '.claude/.credentials.json')).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(prepared.control, 'instructions.md'), 'utf8')).toBe('Role instructions')
    expect(readFileSync(join(prepared.control, 'bin/shepherdr'), 'utf8')).toContain('/run/shepherdr/core-pilot-cli.ts')
    expect(readdirSync(prepared.control)).not.toContain('core-pilot-backend.ts')
    writeFileSync(join(prepared.state, '.claude/.credentials.json'), '{"changed":true}')
    expect(readFileSync(join(home, '.claude/.credentials.json'), 'utf8')).toBe('{"oauth":"fixture"}')
  } finally { prepared?.discard(); rmSync(root, { recursive: true, force: true }) }
})

test('contained home refuses linked or exposed provider credentials and removes failed preparation', () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-home-')), parent = join(root, 'sessions'), home = join(root, 'host'), source = join(import.meta.dir, '..')
  mkdirSync(parent, { mode: 0o700 }); mkdirSync(home); mkdirSync(join(home, '.codex'))
  try {
    writeFileSync(join(home, '.codex/auth.json'), '{}', { mode: 0o644 })
    expect(() => preparePilotHome(parent, home, source, 'codex', '')).toThrow('login files must be private')
    expect(readdirSync(parent)).toEqual([])
    rmSync(join(home, '.codex/auth.json')); writeFileSync(join(home, 'elsewhere'), '{}', { mode: 0o600 }); symlinkSync(join(home, 'elsewhere'), join(home, '.codex/auth.json'))
    expect(() => preparePilotHome(parent, home, source, 'codex', '')).toThrow()
    expect(readdirSync(parent)).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
