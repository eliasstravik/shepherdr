// A stateless read of each CLI's plan limits, invoked through machine.exec: never through a running agent. Claude Code's
// own /usage and Codex's own account/rateLimits/read, each in its own short process, so nothing goes in a live chat.
// Only percentages, reset times and the plan's name come back: no account, no raw output, no token.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CliLimits, LimitWindow } from '../shared/types.ts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Nov 6, 11:59am (UTC)" or "3pm (UTC)": the next such moment, since Claude Code leaves out what is obvious to a reader */
export function claudeReset(words: string, now: number): number | undefined {
  const m = words.match(/^(?:([A-Z][a-z]{2}) (\d{1,2})(?:, (\d{4}))?(?:,| at)? )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?: \(UTC\))?$/i)
  if (!m) return undefined
  const month = m[1] ? MONTHS.indexOf(m[1]) : -1
  if (m[1] && month < 0) return undefined
  const hour = Number(m[4]) % (m[6] ? 12 : 24) + (m[6]?.toLowerCase() === 'pm' ? 12 : 0), minute = Number(m[5] ?? 0)
  const today = new Date(now)
  if (!m[1]) {
    const at = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hour, minute)
    return at + 60_000 <= now ? at + 86_400_000 : at // Its words stop at the minute: this minute is still today.
  }
  const at = (year: number) => Date.UTC(year, month, Number(m[2]), hour, minute)
  if (m[3]) return at(Number(m[3]))
  return at(today.getUTCFullYear()) < now - 86_400_000 ? at(today.getUTCFullYear() + 1) : at(today.getUTCFullYear())
}

/** What /usage printed, as it is worded in Claude Code 2.1: `Current week (all models): 10% used · resets Nov 6, 11:59am (UTC)` */
export function parseClaude(text: string, now: number): CliLimits {
  const windows: LimitWindow[] = []
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(.+?): (\d+(?:\.\d+)?)% used(?: · resets (.+))?$/)
    if (!m) continue
    const name = m[1].replace(/^Current session\b/, '5-hour').replace(/^Current week\b/, 'Weekly').slice(0, 60)
    const resetsAt = m[3] ? claudeReset(m[3], now) : undefined
    windows.push({ name, used: Number(m[2]), ...(resetsAt ? { resetsAt } : m[3] ? { resets: m[3].slice(0, 60) } : {}) })
  }
  if (windows.length) return { state: 'ok', windows }
  if (/not logged in|\/login/i.test(text)) return { state: 'signed-out' }
  // With no subscription, signed out or on an API key, /usage is only the session's cost.
  if (/^Total cost:/m.test(text)) return { state: 'no-plan' }
  return { state: 'unknown', why: "Claude Code's answer had no limits in it" }
}

const windowName = (minutes: unknown) => minutes === 300 ? '5-hour' : minutes === 10080 ? 'Weekly' : typeof minutes !== 'number' || minutes <= 0 ? 'Limit' : minutes % 1440 === 0 ? `${minutes / 1440}-day` : minutes % 60 === 0 ? `${minutes / 60}-hour` : `${minutes}-minute`

interface CodexWindow { usedPercent?: unknown; windowDurationMins?: unknown; resetsAt?: unknown }
interface CodexSnapshot { limitId?: unknown; limitName?: unknown; primary?: CodexWindow | null; secondary?: CodexWindow | null; planType?: unknown }

/** account/rateLimits/read's answer. A limit of its own (one model's) says so before its window's name. */
export function parseCodex(result: { rateLimits?: CodexSnapshot | null; rateLimitsByLimitId?: Record<string, CodexSnapshot> | null } | null | undefined): CliLimits {
  const snapshots = Object.values(result?.rateLimitsByLimitId ?? {})
  if (!snapshots.length && result?.rateLimits) snapshots.push(result.rateLimits)
  const windows = snapshots.sort((a, b) => Number(b.limitId === 'codex') - Number(a.limitId === 'codex')).flatMap(snapshot => [snapshot.primary, snapshot.secondary].flatMap(window => {
    if (typeof window?.usedPercent !== 'number') return []
    const named = snapshot.limitId !== 'codex' && typeof snapshot.limitName === 'string' && snapshot.limitName ? `${snapshot.limitName.slice(0, 40)} · ` : ''
    return [{ name: named + windowName(window.windowDurationMins), used: window.usedPercent, ...(typeof window.resetsAt === 'number' ? { resetsAt: window.resetsAt * 1000 } : {}) }]
  }))
  const plan = snapshots.map(snapshot => snapshot.planType).find(type => typeof type === 'string' && type !== 'unknown') as string | undefined
  return windows.length ? { state: 'ok', windows, ...(plan ? { plan: plan.slice(0, 30) } : {}) } : { state: 'unknown', why: 'Codex reported no limits' }
}

/**
 * The whole machine read-only: a CLI that saves its state on every start saves nothing real. `state` is a throwaway folder
 * shown in place of a CLI's own, for a CLI that won't start without one, with only `kept` of what is really there.
 */
export function sealArgs(command: string[], state?: { folder: string; over: string; kept: string[] }): string[] {
  return ['bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp', '--share-net', '--die-with-parent',
    ...(state ? ['--bind', state.folder, state.over, ...state.kept.flatMap(path => ['--ro-bind', path, path])] : []), '--chdir', '/tmp', '--', ...command]
}

const SOON = 60 * 60_000
const WEEK = 7 * 86_400_000

/**
 * A seal can't save a refreshed login, and a login refreshed but not saved signs the CLI out. So a login near its end
 * isn't read at all: the next real run of the CLI renews it, and until then the last numbers stand, with their age.
 */
export function claudeLoginDue(text: string, now: number) {
  try {
    const end = JSON.parse(text)?.claudeAiOauth?.expiresAt
    return end !== undefined && !(end - SOON > now)
  } catch { return true }
}

/** Codex renews by its token's expiry or, as a rule, every eight days. */
export function codexLoginDue(text: string, now: number) {
  try {
    const auth = JSON.parse(text)
    if (!auth?.tokens) return false
    const end = JSON.parse(Buffer.from(auth.tokens.access_token.split('.')[1], 'base64url').toString('utf8')).exp * 1000
    return !(end - SOON > now && now - Date.parse(auth.last_refresh) < WEEK)
  } catch { return true }
}

const DUE: CliLimits = { state: 'unknown', why: 'Its sign-in is due for renewal: the next agent here will do it' }
const quiet = (command: string[]) => Bun.which('nice') ? ['nice', '-n', '19', ...command] : command
const NO_SEAL = "Can't read it safely here: bwrap is missing"

async function claude(now: () => number): Promise<CliLimits | undefined> {
  const binary = Bun.which('claude')
  if (!binary) return undefined
  if (!Bun.which('bwrap')) return { state: 'unknown', why: NO_SEAL }
  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  if (!existsSync(config)) return { state: 'signed-out' }
  const login = join(config, '.credentials.json')
  if (existsSync(login) && claudeLoginDue(readFileSync(login, 'utf8'), now())) return DUE
  const run = Bun.spawn(sealArgs(quiet([binary, '-p', '/usage', '--output-format', 'json', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config'])), { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore', env: { ...process.env, TZ: 'UTC', TMPDIR: '/tmp' } })
  const limit = setTimeout(() => run.kill('SIGKILL'), 60_000)
  try {
    const text = await new Response(run.stdout).text()
    await run.exited
    if (run.signalCode) return { state: 'unknown', why: 'Claude Code took too long to answer' }
    let result: unknown
    try { result = JSON.parse(text)?.result } catch { return { state: 'unknown', why: "Couldn't read Claude Code's answer" } }
    return typeof result === 'string' ? parseClaude(result, now()) : { state: 'unknown', why: "Couldn't read Claude Code's answer" }
  } finally { clearTimeout(limit) }
}

async function codex(now: () => number): Promise<CliLimits | undefined> {
  const binary = Bun.which('codex')
  if (!binary) return undefined
  if (!Bun.which('bwrap')) return { state: 'unknown', why: NO_SEAL }
  const home = process.env.CODEX_HOME || join(homedir(), '.codex')
  if (!existsSync(home)) return { state: 'signed-out' }
  const login = join(home, 'auth.json')
  if (existsSync(login) && codexLoginDue(readFileSync(login, 'utf8'), now())) return DUE
  // Codex won't start without its own databases, so it gets empty ones. Plugin sync stays off: nothing here needs it.
  const folder = mkdtempSync(join(tmpdir(), 'shepherdr-limits-'))
  const kept = [login, join(home, 'config.toml')].filter(existsSync)
  const run = Bun.spawn(sealArgs(quiet([binary, 'app-server', '--disable', 'plugins']), { folder, over: home, kept }), { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
  const limit = setTimeout(() => run.kill('SIGKILL'), 30_000)
  const send = (value: object) => { run.stdin.write(JSON.stringify(value) + '\n'); run.stdin.flush() }
  try {
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'shepherdr', title: 'Shepherdr', version: '1' } } })
    send({ method: 'initialized' })
    send({ id: 2, method: 'account/read', params: { refreshToken: false } })
    send({ id: 3, method: 'account/rateLimits/read' })
    let held = ''
    let plan: string | undefined
    const reader = run.stdout.getReader(), words = new TextDecoder()
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      held += words.decode(chunk.value, { stream: true })
      for (let end = held.indexOf('\n'); end >= 0; end = held.indexOf('\n')) {
        const line = held.slice(0, end)
        held = held.slice(end + 1)
        let message: { id?: number; result?: never; error?: { message?: string } }
        try { message = JSON.parse(line) } catch { continue }
        if (message.id === 2) {
          const account = (message.result as { account?: { type?: string; planType?: string } | null } | undefined)?.account
          if (message.error || !account) return { state: 'signed-out' }
          if (account.type === 'apiKey') return { state: 'no-plan' }
          plan = account.planType
        }
        if (message.id === 3) {
          if (message.error) return /auth|log ?in|sign/i.test(message.error.message ?? '') ? { state: 'signed-out' } : { state: 'unknown', why: "This Codex can't report its limits" }
          const limits = parseCodex(message.result)
          return limits.state === 'ok' && !limits.plan && plan && plan !== 'unknown' ? { ...limits, plan } : limits
        }
      }
    }
    return { state: 'unknown', why: run.signalCode ? 'Codex took too long to answer' : 'Codex stopped before answering' }
  } finally {
    clearTimeout(limit)
    run.kill('SIGKILL')
    rmSync(folder, { recursive: true, force: true })
  }
}

/** A CLI this machine doesn't have is left out. */
export async function read(now = () => Date.now()) {
  const safely = (work: Promise<CliLimits | undefined>) => work.catch((): CliLimits => ({ state: 'unknown', why: "Couldn't run it" }))
  const [claudeCode, codexCli] = await Promise.all([safely(claude(now)), safely(codex(now))])
  return { claude: claudeCode, codex: codexCli }
}
