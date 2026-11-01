// A stateless read of each CLI's plan limits, invoked through machine.exec: never through a running agent. Claude Code's
// own /usage and Codex's own account/rateLimits/read, each in its own short process, so nothing goes in a live chat.
// Only percentages, reset times and the plan's name come back: no account, no raw output, no token.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { basename, join } from 'node:path'
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

/**
 * bwrap's promise on a Mac: nothing real is writable but `OPEN`, a throwaway folder (a real path: rules match after links
 * like /tmp are followed). A write through a daemon is no file write here, so preferences are shut too. The Keychain can't
 * be: the CLI reads it with the same command that would write it, so there only "login due" stands in the way.
 * `HIDE` is a login the CLI must not fall back on.
 */
export function macProfile(hide = false) {
  return `(version 1)
(allow default)
(deny file-write*)
(deny user-preference-write)
${hide ? '(deny file-read* (literal (param "HIDE")))\n' : ''}(allow file-write* (subpath (param "OPEN")))
(allow file-write-data (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty"))`
}

const SANDBOX = '/usr/bin/sandbox-exec'

export function macSealArgs(command: string[], open: string, hide?: string) {
  return [SANDBOX, '-p', macProfile(Boolean(hide)), `-DOPEN=${open}`, ...(hide ? [`-DHIDE=${hide}`] : []), '--', ...command]
}

/** Sealed, it can write where it's open, can't where it's shut, and can't read what's hidden: nothing real is touched to learn that. */
const PROOF = '/usr/bin/touch "$1/proof" && ! /usr/bin/touch "$2/proof" && { [ -z "$3" ] || ! /bin/cat "$3"; }'

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

/** A Mac's Keychain item may hold only other sign-ins (MCP servers): that isn't Claude Code's login. Unreadable counts as one. */
function claudeLoginIn(text: string) {
  try { return JSON.parse(text)?.claudeAiOauth !== undefined } catch { return true }
}

/**
 * A Mac can hold a login in the Keychain and in .credentials.json. A renewed login leaves the file behind, so the Keychain's
 * decides, and the CLI is then shown only that one: whichever it would prefer, it runs on the login that was checked.
 */
export function claudeMacLogin(keychain: string | null, file: string | null, now: number) {
  const held = keychain !== null && claudeLoginIn(keychain), text = held ? keychain : file
  return { due: text !== null && claudeLoginDue(text, now), hideFile: held && file !== null }
}

/** Where Claude Code keeps its login in the Keychain: its own name for a config folder that isn't the default. */
export function claudeKeychainItem(env: Record<string, string | undefined>) {
  const custom = env.CLAUDE_CONFIG_DIR?.normalize('NFC')
  let account = env.USER
  try { account ||= userInfo().username } catch {}
  return { service: `Claude Code-credentials${custom ? `-${createHash('sha256').update(custom).digest('hex').slice(0, 8)}` : ''}`, account: account && /^[a-zA-Z0-9._-]+$/.test(account) ? account : 'claude-code-user' }
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
const NO_SEAL = "Can't read it safely here: bwrap is missing"
const NO_MAC_SEAL = "Can't read it safely here: sandbox-exec is missing"
const SEAL_REFUSED: CliLimits = { state: 'unknown', why: "Can't read it safely here: the Mac seal wouldn't hold" }
const NO_KEYCHAIN: CliLimits = { state: 'unknown', why: "Couldn't check its sign-in in the Keychain, so it wasn't run" }
const NO_CODEX_FILE: CliLimits = { state: 'unknown', why: 'No Codex sign-in file here to check, so it wasn\'t run' }

interface Run {
  stdin: { write(text: string): unknown; flush(): unknown }
  stdout: ReadableStream<Uint8Array>
  exited: Promise<number>
  signalCode: string | null
  kill(signal?: string): void
}
interface RunOptions { stdin: 'ignore' | 'pipe'; stdout: 'ignore' | 'pipe'; stderr: 'ignore'; env?: Record<string, string | undefined>; cwd?: string }
/** What a read needs from its machine, so each platform's path can be tried on any. */
export interface Host {
  platform: string
  env: Record<string, string | undefined>
  which(name: string): string | null
  exists(path: string): boolean
  spawn(argv: string[], options: RunOptions): Run
}
const HOST: Host = { platform: process.platform, env: process.env, which: name => Bun.which(name), exists: existsSync, spawn: (argv, options) => Bun.spawn(argv, options) as unknown as Run }

const quiet = (host: Host, command: string[]) => host.which('nice') ? ['nice', '-n', '19', ...command] : command
const mac = (host: Host) => host.platform === 'darwin'
const noSeal = (host: Host) => mac(host) ? (host.exists(SANDBOX) ? undefined : NO_MAC_SEAL) : (host.which('bwrap') ? undefined : NO_SEAL)

/** A throwaway folder, shown to be sealed by a real run before any CLI goes in. Undefined: no CLI runs. */
async function openMacSeal(host: Host, hide?: string) {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'shepherdr-limits-'))), open = join(folder, 'open'), shut = join(folder, 'shut')
  const close = () => rmSync(folder, { recursive: true, force: true })
  mkdirSync(open)
  mkdirSync(shut)
  const proof = host.spawn(macSealArgs(['/bin/sh', '-c', PROOF, 'proof', open, shut, hide ?? ''], open, hide), { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  const limit = setTimeout(() => proof.kill('SIGKILL'), 10_000)
  const code = await proof.exited.finally(() => clearTimeout(limit))
  if (code === 0 && !proof.signalCode && existsSync(join(open, 'proof')) && !existsSync(join(shut, 'proof'))) return { open, close, wrap: (command: string[]) => macSealArgs(command, open, hide) }
  close()
}

/** The login as the CLI's own read sees it, kept in memory only. null: no such item. Anything else that isn't it refuses. */
async function claudeKeychain(host: Host) {
  const { service, account } = claudeKeychainItem(host.env)
  const run = host.spawn(['/usr/bin/security', 'find-generic-password', '-a', account, '-w', '-s', service], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' })
  const limit = setTimeout(() => run.kill('SIGKILL'), 5_000)
  try {
    const [text, code] = await Promise.all([new Response(run.stdout).text(), run.exited])
    if (code === 44) return null
    if (code !== 0 || run.signalCode) throw new Error('Keychain')
    return text.trim()
  } finally { clearTimeout(limit) }
}

async function askClaude(host: Host, now: () => number, argv: string[], options: Pick<RunOptions, 'env' | 'cwd'>): Promise<CliLimits> {
  const run = host.spawn(argv, { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore', ...options })
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

async function claude(now: () => number, host: Host): Promise<CliLimits | undefined> {
  const binary = host.which('claude')
  if (!binary) return undefined
  const missing = noSeal(host)
  if (missing) return { state: 'unknown', why: missing }
  const config = host.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  if (!host.exists(config)) return { state: 'signed-out' }
  const login = join(config, '.credentials.json')
  const file = host.exists(login) ? readFileSync(login, 'utf8') : null
  const command = quiet(host, [binary, '-p', '/usage', '--output-format', 'json', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config'])
  if (!mac(host)) {
    if (file !== null && claudeLoginDue(file, now())) return DUE
    return askClaude(host, now, sealArgs(command), { env: { ...host.env, TZ: 'UTC', TMPDIR: '/tmp' } })
  }
  let keychain: string | null
  try { keychain = await claudeKeychain(host) } catch { return NO_KEYCHAIN }
  const { due, hideFile } = claudeMacLogin(keychain, file, now())
  if (due) return DUE
  const seal = await openMacSeal(host, hideFile ? realpathSync(login) : undefined)
  if (!seal) return SEAL_REFUSED
  // Its secure store goes back to the one just checked. A Mac has no fresh /tmp to chdir to, so it runs in the open folder.
  try { return await askClaude(host, now, seal.wrap(command), { env: { ...host.env, CLAUDE_SECURESTORAGE_CONFIG_DIR: undefined, TZ: 'UTC', TMPDIR: seal.open }, cwd: seal.open }) }
  finally { seal.close() }
}

async function askCodex(host: Host, argv: string[], options: Pick<RunOptions, 'env' | 'cwd'>): Promise<CliLimits> {
  const run = host.spawn(argv, { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', ...options })
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
  }
}

async function codex(now: () => number, host: Host): Promise<CliLimits | undefined> {
  const binary = host.which('codex')
  if (!binary) return undefined
  const missing = noSeal(host)
  if (missing) return { state: 'unknown', why: missing }
  const home = host.env.CODEX_HOME || join(homedir(), '.codex')
  if (!host.exists(home)) return { state: 'signed-out' }
  const login = join(home, 'auth.json')
  if (host.exists(login) && codexLoginDue(readFileSync(login, 'utf8'), now())) return DUE
  const kept = [login, join(home, 'config.toml')].filter(path => host.exists(path))
  if (!mac(host)) {
    // Codex won't start without its own databases, so it gets empty ones. Plugin sync stays off: nothing here needs it.
    const folder = mkdtempSync(join(tmpdir(), 'shepherdr-limits-'))
    try { return await askCodex(host, sealArgs(quiet(host, [binary, 'app-server', '--disable', 'plugins']), { folder, over: home, kept }), {}) }
    finally { rmSync(folder, { recursive: true, force: true }) }
  }
  // A login kept in the Keychain has no file to check, and is filed under the home's path, so it wouldn't be found below.
  if (!host.exists(login)) return NO_CODEX_FILE
  const seal = await openMacSeal(host)
  if (!seal) return SEAL_REFUSED
  // Nothing can show a throwaway folder over ~/.codex here, so CODEX_HOME names one instead, with links to the real login
  // and config: no copy of a login on disk, and a link can't be written through. The Keychain stays out of it.
  try {
    const state = join(seal.open, 'codex')
    mkdirSync(state)
    for (const path of kept) symlinkSync(realpathSync(path), join(state, basename(path)))
    const command = quiet(host, [binary, 'app-server', '--disable', 'plugins', '-c', 'cli_auth_credentials_store="file"'])
    return await askCodex(host, seal.wrap(command), { env: { ...host.env, CODEX_HOME: state, CODEX_SQLITE_HOME: state, TMPDIR: seal.open }, cwd: seal.open })
  } finally { seal.close() }
}

/** A CLI this machine doesn't have is left out. */
export async function read(now = () => Date.now(), host = HOST) {
  const safely = (work: Promise<CliLimits | undefined>) => work.catch((): CliLimits => ({ state: 'unknown', why: "Couldn't run it" }))
  const [claudeCode, codexCli] = await Promise.all([safely(claude(now, host)), safely(codex(now, host))])
  return { claude: claudeCode, codex: codexCli }
}
