// Secrets for agents (API keys, tokens, passwords): the human gives one through a masked box (a card an agent asked
// for, or Settings → Secrets), and agents use it by name, never seeing it: shepherdr secret run puts it in a command's
// environment, shepherdr secret env writes it to a file git ignores. Each is set at a level, as Settings are:
// Everywhere ('all'), a machine (m:<machine>) or a space (p:<machine>:<space>); the most specific one wins.
// The application is the sole vault writer. Agent use leaves over its authenticated encrypted core mailbox; snapshots contain names only.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SettingSection } from '../../shared/types.ts'

const FILE = 'vault.json'

/** a name an environment variable may have: GITHUB_TOKEN */
export const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/

/** a level's id: all, m:<machine> or p:<machine>:<space> */
export const LEVEL = /^(all|m:[^:]+|p:[^:]+:.+)$/

/** at most this long: a key, a token, a private key file's words */
export const SECRET_MAX = 64 * 1024

export interface Kept {
  value: string
  /** when it was saved (ms) */
  at: number
}

/** each level's secrets, by name */
type Store = Record<string, Record<string, Kept>>

export class Vault {
  /** home: the main machine's Shepherdr folder; seed: kept in memory only (tests) */
  constructor(
    private home: string,
    private seed?: Store,
  ) {}

  /** what the file holds; one that can't be read is never taken for none (a save would lose every secret in it) */
  private read(): Store {
    if (this.seed) return this.seed
    const f = join(this.home, FILE)
    if (!existsSync(f)) return {}
    try {
      return JSON.parse(readFileSync(f, 'utf8')) as Store
    } catch (e) {
      throw new Error(`Secrets can't be read from ${f} : fix or move that file; nothing was changed.`)
    }
  }

  /** the names set at each level, and when (none while the file can't be read) */
  names(): Record<string, { name: string; at: number }[]> {
    try {
      this.read()
    } catch {
      return {}
    }
    return Object.fromEntries(
      Object.entries(this.read()).map(([level, all]) => [level, Object.entries(all).map(([name, k]) => ({ name, at: k.at })).sort((a, b) => a.name.localeCompare(b.name))]),
    )
  }

  /** the value of each name, from the first level of the chain that has it (most specific first), and where from */
  pick(names: string[], chain: string[]): { found: Record<string, { value: string; level: string }>; missing: string[] } {
    const all = this.read()
    const found: Record<string, { value: string; level: string }> = {}
    const missing: string[] = []
    for (const n of names) {
      const level = chain.find((l) => all[l]?.[n] !== undefined)
      if (level) found[n] = { value: all[level][n].value, level }
      else missing.push(n)
    }
    return { found, missing }
  }

  /** every name the chain reaches, each from the level it comes from */
  visible(chain: string[]): { name: string; level: string; at: number }[] {
    const all = this.read()
    const seen = new Map<string, { name: string; level: string; at: number }>()
    for (const l of chain) for (const [name, k] of Object.entries(all[l] ?? {})) if (!seen.has(name)) seen.set(name, { name, level: l, at: k.at })
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  has(level: string, name: string) {
    return this.read()[level]?.[name] !== undefined
  }

  /** written whole, readable by you only, from the start: a new file each time, then put in place */
  private write(all: Store) {
    mkdirSync(this.home, { recursive: true, mode: 0o700 })
    const f = join(this.home, FILE)
    const tmp = `${f}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 })
    renameSync(tmp, f)
  }

  /** set (or with null, remove) one at a level */
  set(level: string, name: string, value: string | null): { ok: boolean; error?: string } {
    const problem = secretProblem(level, name, value)
    if (problem) return { ok: false, error: problem }
    let all: Store
    try {
      all = this.read()
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
    if (value === null) {
      if (!all[level]?.[name]) return { ok: false, error: `No secret ${name} there.` }
      delete all[level][name]
      if (!Object.keys(all[level]).length) delete all[level]
    } else (all[level] ??= {})[name] = { value, at: Date.now() }
    if (!this.seed) this.write(all)
    return { ok: true }
  }
}

/** each level's Secrets page, after the other pages of Settings: the names kept there, never a value */
export function secretPages(settings: SettingSection[], names: Record<string, { name: string; at: number }[]>): SettingSection[] {
  const levels = new Map<string, string | undefined>()
  for (const x of settings) if (x.level && !x.global && !levels.has(x.level)) levels.set(x.level, x.machine)
  const about = 'Keys, tokens and passwords for agents. Agents use them by name and never see them: only the names show, here and in chats.'
  return [...settings, ...[...levels].map(([level, machine]) => ({ name: 'Secrets', about, rows: [], level, ...(machine ? { machine } : {}), secrets: names[level] ?? [] }))]
}

/** what is wrong with a secret to keep, if anything */
export function secretProblem(level: string, name: string, value: string | null) {
  if (!LEVEL.test(level)) return 'Pick where it is for: Everywhere, a machine or a space.'
  if (!SECRET_NAME.test(name)) return 'A name has letters, digits and _ only, and starts with a letter or _ (like GITHUB_TOKEN).'
  if (value !== null && !value.length) return 'Type or paste the secret.'
  if (value !== null && value.length > SECRET_MAX) return 'That is too long for a secret (64 KB at most).'
  return undefined
}
