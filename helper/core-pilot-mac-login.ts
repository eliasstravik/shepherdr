// OUTSIDE containment. Claude Code on macOS keeps its login in the Keychain, which the Mac profile denies. Claude then
// falls back to a file in its config directory and rereads it on its next request, so this keeps that file equal to
// the host's live login, whatever changes it. Only the short-lived access token crosses: no refresh token, other
// Keychain items or MCP logins, so a sandboxed Claude cannot refresh and race the host's own login.
import { closeSync, constants, existsSync, lstatSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'

const SECURITY = '/usr/bin/security', SERVICE = 'Claude Code-credentials', ITEM_NOT_FOUND = 44
// Claude refreshes once under five minutes are left. Ask just inside that, and not often.
const REFRESH_BELOW = 270_000, REFRESH_EVERY = 60_000, READ_EVERY = 30_000
const OAUTH_KEYS = ['accessToken', 'expiresAt', 'scopes', 'subscriptionType', 'rateLimitTier'] as const

/** What may enter the sandbox: the live access token and the plan facts Claude shows with it. Undefined if none. */
export function pilotLiveLogin(text: string) {
  let value: { claudeAiOauth?: Record<string, unknown> }
  try {
    const trimmed = text.trim()
    // Claude stores this item as hex; a file or an older item is plain JSON.
    value = JSON.parse(/^[0-9a-f]+$/i.test(trimmed) ? Buffer.from(trimmed, 'hex').toString('utf8') : trimmed)
  } catch { return }
  const oauth = value?.claudeAiOauth
  if (!oauth || typeof oauth !== 'object' || typeof oauth.accessToken !== 'string' || !oauth.accessToken) return
  const expiresAt = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : undefined
  const kept = Object.fromEntries(OAUTH_KEYS.filter(key => oauth[key] !== undefined).map(key => [key, oauth[key]]))
  return { file: JSON.stringify({ claudeAiOauth: { ...kept, refreshToken: null } }), expiresAt }
}
export function pilotLoginPaths(state: string) { return { file: join(state, '.claude/.credentials.json'), temporary: join(state, '.claude/.credentials.json.next') } }

export interface PilotLoginSource { changeMark(): number; read(): Promise<string | undefined>; refresh(): void }
/** The login the host's own Claude uses. Keychain first, as Claude itself reads it; a login file if no item exists. */
export function pilotHostLogin(binary: string, home = homedir(), user = userInfo().username, service = SERVICE): PilotLoginSource {
  const keychain = join(home, 'Library/Keychains/login.keychain-db'), file = join(home, '.claude/.credentials.json')
  const mark = (path: string) => { try { return statSync(path).mtimeMs } catch { return 0 } }
  return {
    changeMark: () => mark(keychain) + mark(file),
    read: async () => {
      if (!existsSync(keychain)) return existsSync(file) ? readFileSync(file, 'utf8') : undefined
      // Never synchronous: this process also carries the gateway, and a locked Keychain can take its time answering.
      const item = Bun.spawn([SECURITY, 'find-generic-password', '-s', service, '-a', user, '-w'], { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore', timeout: 15_000, killSignal: 'SIGKILL' })
      const [text, code] = await Promise.all([new Response(item.stdout).text(), item.exited])
      if (code === 0) return text
      // Locked or busy. At the start this refuses the run; later, a failed pass keeps the last login.
      if (code !== ITEM_NOT_FOUND) throw Error("Claude's login could not be read from this Mac's Keychain. Unlock it and start again; no unrestricted fallback was started")
      return existsSync(file) ? readFileSync(file, 'utf8') : undefined
    },
    // Claude's own refresh, under its own lock, into its own store. This never mints or handles a refresh token.
    refresh: () => { Bun.spawn([binary, 'auth', 'status', '--json'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', cwd: home, timeout: 60_000, killSignal: 'SIGKILL', env: { HOME: home, USER: user, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' } }) },
  }
}
/** Rewrites the sandbox's login file on each change. The profile seals both paths, so the agent cannot repoint them. */
export class PilotMacLogin {
  private timer?: ReturnType<typeof setInterval>
  private mark = -1
  private read = 0
  private refreshed = 0
  private written?: string
  private busy = false
  constructor(private state: string, private source: PilotLoginSource, private now: () => number = Date.now) {}
  /** The first read finishes before this resolves, so an available login is in place before the agent starts. */
  async start() {
    await this.check()
    // A failed pass retries on the next; the last login stays in place.
    this.timer = setInterval(() => { void this.check().catch(() => {}) }, 1000)
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined }
  async check() {
    const mark = this.source.changeMark()
    if (this.busy || mark === this.mark && this.now() - this.read < READ_EVERY) return
    this.mark = mark; this.read = this.now(); this.busy = true
    let text: string | undefined
    try { text = await this.source.read() } finally { this.busy = false }
    const login = text === undefined ? undefined : pilotLiveLogin(text)
    if (!login) return
    if (login.file !== this.written) { this.write(login.file); this.written = login.file }
    if (login.expiresAt !== undefined && login.expiresAt - this.now() < REFRESH_BELOW && this.now() - this.refreshed >= REFRESH_EVERY) {
      this.refreshed = this.now(); this.source.refresh()
    }
  }
  private write(body: string) {
    const { file, temporary } = pilotLoginPaths(this.state)
    rmSync(temporary, { force: true })
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { writeSync(fd, body) } finally { closeSync(fd) }
    if (lstatSync(temporary).nlink !== 1) throw Error('The login file changed while it was being written')
    renameSync(temporary, file) // Atomic: Claude rereads this on its next request and never sees half a file.
  }
}

const WINDOWS = ['five_hour', 'seven_day'] as const
/** Agent-written input. Only the numbers leave it, so a reading cannot carry anything else to the host command. */
export function pilotUsageReading(input: unknown) {
  const limits = (input as { rate_limits?: Record<string, { used_percentage?: unknown; resets_at?: unknown } | undefined> } | undefined)?.rate_limits
  const rate_limits: Record<string, { used_percentage: number; resets_at?: number }> = {}
  for (const name of WINDOWS) {
    const window = limits?.[name], used = window?.used_percentage, resets = window?.resets_at
    if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 100) continue
    rate_limits[name] = { used_percentage: used, ...(typeof resets === 'number' && Number.isFinite(resets) && resets > 0 ? { resets_at: resets } : {}) }
  }
  return Object.keys(rate_limits).length ? { rate_limits } : undefined
}
export function pilotUsageCommand(home = homedir()) { return join(home, '.config/shepherdr/autopilot-usage') }
/** Passes readings to the human's optional host command, as JSON on stdin: latest wins, one at a time. */
export class PilotUsageHook {
  private running = false
  private next?: string
  constructor(private command = pilotUsageCommand(), private home = homedir()) {}
  private usable() {
    try {
      const stat = lstatSync(this.command)
      // Written by the human, never by an agent: the profile denies it, and a file others can change is not run.
      return stat.isFile() && !!(stat.mode & 0o100) && !(stat.mode & 0o022) && (!process.getuid || stat.uid === process.getuid())
    } catch { return false }
  }
  /** Resolves once the reading is queued or dropped, never waiting on the host command. */
  report(input: unknown) {
    const reading = pilotUsageReading(input)
    if (!reading || !this.usable()) return false
    this.next = JSON.stringify(reading)
    void this.drain()
    return true
  }
  private async drain() {
    if (this.running) return
    this.running = true
    try {
      while (this.next !== undefined) {
        const body = this.next; this.next = undefined
        const child = Bun.spawn([this.command], { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore', cwd: this.home, env: { HOME: this.home, USER: userInfo().username, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' } })
        const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
        try { child.stdin.write(body); await child.stdin.end() } catch { /* A command may exit without reading its input. */ }
        await child.exited; clearTimeout(timer)
        await Bun.sleep(1000) // An agent writes these readings, so it must not be able to spin the host command.
      }
    } finally { this.running = false }
  }
  /** Finish the command that is running; a reading still queued is dropped. */
  async close() { this.next = undefined; while (this.running) await Bun.sleep(10) }
}
