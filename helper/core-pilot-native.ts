// OUTSIDE containment. Project approval derives from the app's selected, validated OS profile, never host trust.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PilotHome } from './core-pilot-home.ts'

/** Called only after sandbox mount validation, before core submits the native process. */
export function pilotNativeWorkspace(home: PilotHome, cwd: string, kind: 'claude' | 'codex') {
  if (kind === 'claude') {
    const path = join(home.state, '.claude/.claude.json')
    const prefs = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
    prefs.projects = { [cwd]: { hasTrustDialogAccepted: true } }
    mkdirSync(join(home.state, '.claude'), { recursive: true, mode: 0o700 })
    writeFileSync(path, JSON.stringify(prefs), { mode: 0o600 })
    const settingsPath = join(home.control, 'settings.json'), settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    // Claude 2.1.314's native consent setting. It applies only inside our proven external boundary.
    settings.skipDangerousModePermissionPrompt = true
    writeFileSync(settingsPath, JSON.stringify(settings), { mode: 0o600 })
  } else {
    const path = join(home.state, '.codex/config.toml'), config = existsSync(path) ? readFileSync(path, 'utf8') : ''
    mkdirSync(join(home.state, '.codex'), { recursive: true, mode: 0o700 })
    writeFileSync(path, `${config}\n[projects.${JSON.stringify(cwd)}]\ntrust_level = "trusted"\n`, { mode: 0o600 })
  }
}
