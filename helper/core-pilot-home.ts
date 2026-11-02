// OUTSIDE containment. Prepare one fresh provider home and immutable helper tree, never the host home itself.
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pilotProviderConfig } from './core-pilot-sandbox.ts'

const HELPERS = ['core-pilot-bootstrap.ts', 'core-pilot-capture.ts', 'core-pilot-gateway.ts', 'core-pilot-cli.ts', 'core-pilot-hook.ts', 'core-secret.ts']
export interface PilotHome { root: string; state: string; control: string; captures: string; gateway: string; discard(): void; closeGateway(): void }
function directory(path: string) {
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid() || realpathSync(path) !== path) throw Error('Use a private owned real runtime directory')
}
function providerFile(path: string, login: boolean) {
  let fd: number
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1_048_576 || stat.mode & (login ? 0o077 : 0o022) || process.getuid && stat.uid !== process.getuid() || realpathSync(path) !== resolve(path)) throw Error('Provider configuration must be an owned regular file; login files must be private')
    const bytes = Buffer.alloc(1_048_577)
    // readFileSync could grow without bound after fstat; the descriptor read below has a fixed ceiling.
    let size = 0
    while (size < bytes.length) { const count = readSync(fd, bytes, size, bytes.length - size, null); if (!count) break; size += count }
    if (size > 1_048_576) throw Error('Provider configuration is too large')
    return bytes.subarray(0, size).toString('utf8')
  } finally { closeSync(fd) }
}
export function preparePilotHome(parent: string, providerHome: string, source: string, kind: 'claude' | 'codex', instructions: string): PilotHome {
  directory(parent)
  if (!['claude', 'codex'].includes(kind) || Buffer.byteLength(instructions) > 2 * 1024 * 1024) throw Error('Invalid contained provider or instructions')
  const root = mkdtempSync(join(parent, 'pilot-')), gatewayRoot = mkdtempSync(join(tmpdir(), 'shep-pilot-gw-'))
  const state = join(root, 'home'), control = join(root, 'control'), captures = join(root, 'captures')
  const closeGateway = () => rmSync(gatewayRoot, { recursive: true, force: true })
  const discard = () => { closeGateway(); rmSync(root, { recursive: true, force: true }) }
  try {
    for (const path of [state, control, captures, join(control, 'bin')]) mkdirSync(path, { mode: 0o700 })
    const names = kind === 'claude' ? ['.claude/.credentials.json', '.claude/settings.json'] : ['.codex/auth.json', '.codex/config.toml']
    for (const name of names) {
      const config = name.endsWith('settings.json') || name.endsWith('config.toml')
      const text = providerFile(join(providerHome, name), !config)
      if (text === undefined) continue
      let body = text
      if (config) body = pilotProviderConfig(kind, text)
      else { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid provider login file') }
      const target = join(state, name)
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 }); writeFileSync(target, body, { mode: 0o600, flag: 'wx' })
    }
    if (kind === 'claude') {
      // Preserve only native display/onboarding preferences, never account details, MCP or project trust.
      const text = providerFile(join(providerHome, '.claude.json'), false)
      if (text !== undefined) {
        const input = JSON.parse(text), prefs: Record<string, unknown> = {}
        if (typeof input.hasCompletedOnboarding === 'boolean') prefs.hasCompletedOnboarding = input.hasCompletedOnboarding
        for (const key of ['lastOnboardingVersion', 'theme']) if (typeof input[key] === 'string' && input[key].length <= 128) prefs[key] = input[key]
        mkdirSync(join(state, '.claude'), { recursive: true, mode: 0o700 })
        writeFileSync(join(state, '.claude/.claude.json'), JSON.stringify(prefs), { mode: 0o600, flag: 'wx' })
      }
    }
    for (const name of HELPERS) writeFileSync(join(control, name === 'core-pilot-bootstrap.ts' ? 'bootstrap.ts' : name), readFileSync(join(source, 'helper', name)), { mode: 0o600, flag: 'wx' })
    for (const name of ['bun', kind, 'gateway.sock']) writeFileSync(join(control, name), '', { mode: 0o600, flag: 'wx' })
    if (kind === 'codex') writeFileSync(join(control, 'codex-code-mode-host'), '', { mode: 0o600, flag: 'wx' })
    writeFileSync(join(control, 'instructions.md'), instructions, { mode: 0o600, flag: 'wx' })
    writeFileSync(join(control, 'bin/shepherdr'), '#!/bin/sh\nexec /run/shepherdr/bun /run/shepherdr/core-pilot-cli.ts "$@"\n', { mode: 0o700, flag: 'wx' })
    writeFileSync(join(control, 'bin', kind), `#!/bin/sh\nexec /run/shepherdr/${kind} "$@"\n`, { mode: 0o700, flag: 'wx' })
    return { root, state, control, captures, gateway: join(gatewayRoot, 'gateway.sock'), discard, closeGateway }
  } catch (error) { discard(); throw error }
}
