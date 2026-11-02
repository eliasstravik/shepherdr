import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preparePilotHome } from '../helper/core-pilot-home.ts'
import { pilotNativeWorkspace } from '../helper/core-pilot-native.ts'

test('native bootstrap grants only the validated contained cwd and never imports host workspace trust', () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-native-')), parent = join(root, 'sessions'), host = join(root, 'host')
  mkdirSync(parent, { mode: 0o700 }); mkdirSync(host)
  writeFileSync(join(host, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: { '/outside': { hasTrustDialogAccepted: true } }, mcpServers: { private: 'not-copied' } }))
  let claude: ReturnType<typeof preparePilotHome> | undefined, codex: ReturnType<typeof preparePilotHome> | undefined
  try {
    claude = preparePilotHome(parent, host, join(import.meta.dir, '..'), 'claude', '')
    writeFileSync(join(claude.control, 'settings.json'), JSON.stringify({ hooks: { SessionStart: [] } }), { mode: 0o600 })
    pilotNativeWorkspace(claude, '/approved/worktree', 'claude')
    expect(JSON.parse(readFileSync(join(claude.state, '.claude/.claude.json'), 'utf8'))).toEqual({ hasCompletedOnboarding: true, projects: { '/approved/worktree': { hasTrustDialogAccepted: true } } })
    expect(JSON.parse(readFileSync(join(claude.control, 'settings.json'), 'utf8'))).toEqual({ hooks: { SessionStart: [] }, skipDangerousModePermissionPrompt: true })
    expect(JSON.parse(readFileSync(join(host, '.claude.json'), 'utf8')).projects).toEqual({ '/outside': { hasTrustDialogAccepted: true } })
    codex = preparePilotHome(parent, host, join(import.meta.dir, '..'), 'codex', '')
    pilotNativeWorkspace(codex, '/approved/space "quote"', 'codex')
    expect(Bun.TOML.parse(readFileSync(join(codex.state, '.codex/config.toml'), 'utf8'))).toEqual({ projects: { '/approved/space "quote"': { trust_level: 'trusted' } } })
  } finally { claude?.discard(); codex?.discard(); rmSync(root, { recursive: true, force: true }) }
})
