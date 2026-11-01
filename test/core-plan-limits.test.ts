import { expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeKeychainItem, claudeLoginDue, claudeMacLogin, claudeReset, claudeSealedLogin, codexLoginDue, macProfile, macSealArgs, parseClaude, parseCodex, read, sealArgs, type Host } from '../helper/core-plan-limits.ts'
import { CorePlanLimits, nextRead } from '../server/core/plan-limits.ts'
import { CoreStore } from '../server/core/store.ts'
import type { CoreSource } from '../server/core/source.ts'
import type { MachineLimits } from '../shared/types.ts'

const NOW = Date.UTC(2026, 10, 1, 7, 0)

test('reads Claude Code\'s own /usage words, whatever windows it reports', () => {
  const text = 'You are currently using your subscription to power your Claude Code usage\n\nCurrent session: 41% used · resets 11:59am (UTC)\nCurrent week (all models): 10% used · resets Nov 6, 11:59am (UTC)\nCurrent week (Fable): 0% used · resets Nov 6, 12pm (UTC)\n\nWhat\'s contributing to your limits usage?\n  69%  Start fresh when you switch tasks · run /clear'
  expect(parseClaude(text, NOW)).toEqual({ state: 'ok', windows: [
    { name: '5-hour', used: 41, resetsAt: Date.UTC(2026, 10, 1, 11, 59) },
    { name: 'Weekly (all models)', used: 10, resetsAt: Date.UTC(2026, 10, 6, 11, 59) },
    { name: 'Weekly (Fable)', used: 0, resetsAt: Date.UTC(2026, 10, 6, 12, 0) },
  ] })
})

test('a reset with no date is the next such time, and one past the new year is next year\'s', () => {
  expect(claudeReset('3am (UTC)', NOW)).toBe(Date.UTC(2026, 10, 2, 3, 0))
  expect(claudeReset('12am (UTC)', NOW)).toBe(Date.UTC(2026, 10, 2, 0, 0))
  expect(claudeReset('12pm (UTC)', NOW)).toBe(Date.UTC(2026, 10, 1, 12, 0))
  expect(claudeReset('Jan 2, 4pm (UTC)', Date.UTC(2026, 11, 30))).toBe(Date.UTC(2027, 0, 2, 16, 0))
  expect(claudeReset('7am (UTC)', NOW + 30_000)).toBe(NOW) // Read within the very minute it names.
  expect(claudeReset('soon', NOW)).toBeUndefined()
})

test('words it can\'t place stay the CLI\'s own, never a made-up moment', () => {
  expect(parseClaude('Current week (all models): 10% used · resets next Tuesdayish', NOW)).toEqual({ state: 'ok', windows: [{ name: 'Weekly (all models)', used: 10, resets: 'next Tuesdayish' }] })
})

test('no limits in the answer is signed out, no plan or unknown, never a number', () => {
  expect(parseClaude('Not logged in · Please run /login', NOW)).toEqual({ state: 'signed-out' })
  expect(parseClaude('Total cost:            $0.0000\nTotal duration (API):  0s', NOW)).toEqual({ state: 'no-plan' })
  expect(parseClaude('You are currently using your subscription to power your Claude Code usage', NOW).state).toBe('unknown')
})

test('reads Codex\'s windows by their own length, with a limit of its own named', () => {
  const limit = { limitId: 'codex', limitName: null, primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1793775820 }, secondary: { usedPercent: 68, windowDurationMins: 10080, resetsAt: 1793800000 }, planType: 'pro' }
  const other = { limitId: 'codex_x', limitName: 'GPT-X', primary: { usedPercent: 5, windowDurationMins: 10080 }, secondary: null, planType: 'pro' }
  expect(parseCodex({ rateLimits: limit, rateLimitsByLimitId: { codex_x: other, codex: limit } })).toEqual({ state: 'ok', plan: 'pro', windows: [
    { name: '5-hour', used: 12, resetsAt: 1793775820000 }, { name: 'Weekly', used: 68, resetsAt: 1793800000000 }, { name: 'GPT-X · Weekly', used: 5 },
  ] })
  expect(parseCodex({ rateLimits: { ...limit, primary: { usedPercent: 1, windowDurationMins: 1440 }, secondary: null } })).toMatchObject({ windows: [{ name: '1-day', used: 1 }] })
  expect(parseCodex({ rateLimits: { limitId: 'codex', primary: null, secondary: null } }).state).toBe('unknown')
})

test('the seal leaves nothing real writable: state goes to a throwaway folder, with the real login and config read-only in it', () => {
  expect(sealArgs(['claude', '-p', '/usage'])).toEqual(['bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp', '--share-net', '--die-with-parent', '--chdir', '/tmp', '--', 'claude', '-p', '/usage'])
  const args = sealArgs(['codex'], { folder: '/tmp/x', over: '/h/.codex', kept: ['/h/.codex/auth.json', '/h/.codex/config.toml'] })
  const at = (flag: string, from: string, to: string) => args.findIndex((word, i) => word === flag && args[i + 1] === from && args[i + 2] === to)
  expect(at('--bind', '/tmp/x', '/h/.codex')).toBeGreaterThan(0)
  expect(at('--ro-bind', '/h/.codex/config.toml', '/h/.codex/config.toml')).toBeGreaterThan(at('--bind', '/tmp/x', '/h/.codex')) // Later mounts win.
  expect(args.filter(word => word === '--bind')).toHaveLength(1)
})

test('a login near its end isn\'t read, since a seal can\'t save its renewal', () => {
  const claude = (expiresAt: unknown) => JSON.stringify({ claudeAiOauth: { expiresAt } })
  expect(claudeLoginDue(claude(NOW + 7 * 3_600_000), NOW)).toBe(false)
  expect(claudeLoginDue(claude(NOW + 60_000), NOW)).toBe(true)
  expect(claudeLoginDue(claude('soon'), NOW)).toBe(true)
  expect(claudeLoginDue('{}', NOW)).toBe(false) // Not an OAuth login: nothing to renew.
  expect(claudeLoginDue('{broken', NOW)).toBe(true)
  const token = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.x`
  const codex = (exp: number, days: number) => JSON.stringify({ tokens: { access_token: token(exp / 1000) }, last_refresh: new Date(NOW - days * 86_400_000).toISOString() })
  expect(codexLoginDue(codex(NOW + 3 * 86_400_000, 6), NOW)).toBe(false)
  expect(codexLoginDue(codex(NOW + 3 * 86_400_000, 7.5), NOW)).toBe(true)
  expect(codexLoginDue(codex(NOW + 60_000, 1), NOW)).toBe(true)
  expect(codexLoginDue('{"tokens":null}', NOW)).toBe(false) // An API key.
  expect(codexLoginDue('{"tokens":{}}', NOW)).toBe(true)
})

test('the Mac seal leaves only its throwaway folder writable and keeps the Keychain out of reach', () => {
  const rules = macProfile().split('\n')
  expect(rules.slice(0, 5)).toEqual(['(version 1)', '(allow default)', '(deny file-write*)', '(deny user-preference-write)', '(deny process-exec (literal "/usr/bin/security"))']) // The last rule that matches wins.
  expect(rules.filter(rule => rule.startsWith('(allow file-write*'))).toEqual(['(allow file-write* (subpath (param "OPEN")))'])
  expect(rules.filter(rule => rule.startsWith('(allow')).join(' ').match(/"\/[^"]+"/g)).toEqual(['"/dev/null"', '"/dev/zero"', '"/dev/tty"']) // No real path but these devices.
  expect(macProfile()).toContain('(deny mach-lookup (global-name "com.apple.SecurityServer") (global-name "com.apple.securityd.xpc"))')
  expect(macProfile(true)).not.toContain('mach-lookup')
  expect(macProfile(true)).toContain('(deny process-exec (literal "/usr/bin/security"))')
  expect(macSealArgs(['claude', '-p'], '/o')).toEqual(['/usr/bin/sandbox-exec', '-p', macProfile(), '-DOPEN=/o', '--', 'claude', '-p'])
  expect(macSealArgs(['codex'], '/o', true)[2]).toBe(macProfile(true))
})

test('a Mac\'s Keychain login decides; the file counts only when the Keychain has none', () => {
  const login = '{"claudeAiOauth":{"expiresAt":1}}'
  expect(claudeMacLogin(login, '{"claudeAiOauth":{"expiresAt":2}}')).toBe(login)
  expect(claudeMacLogin(null, login)).toBe(login)
  expect(claudeMacLogin('{"mcpOAuth":{}}', login)).toBe(login) // Not Claude Code's login.
  expect(claudeMacLogin('{broken', login)).toBe('{broken') // Unreadable counts as due, next.
  expect(claudeMacLogin(null, null)).toBeNull()
})

test('the login a sealed CLI gets has no way to renew', () => {
  expect(JSON.parse(claudeSealedLogin(JSON.stringify({ claudeAiOauth: { accessToken: 'a', refreshToken: 'r', expiresAt: 5, scopes: ['x'], subscriptionType: 'max' }, mcpOAuth: { other: 1 } })))).toEqual({ claudeAiOauth: { accessToken: 'a', expiresAt: 5, scopes: ['x'], subscriptionType: 'max' } })
})

test('the Keychain item is named as Claude Code names it', () => {
  expect(claudeKeychainItem({ USER: 'elias' })).toEqual({ service: 'Claude Code-credentials', account: 'elias' })
  expect(claudeKeychainItem({ USER: 'el ias' }).account).toBe('claude-code-user')
  expect(claudeKeychainItem({ USER: 'elias', CLAUDE_CONFIG_DIR: '/h/.other' }).service).toMatch(/^Claude Code-credentials-[0-9a-f]{8}$/)
})

const RENEWAL = { state: 'unknown' as const, why: 'Its sign-in is due for renewal: the next agent here will do it' }
const FRESH = JSON.stringify({ claudeAiOauth: { accessToken: 'secret-access', refreshToken: 'secret-refresh', expiresAt: NOW + 7 * 3_600_000 } })
const DUE = JSON.stringify({ claudeAiOauth: { accessToken: 'secret-access', refreshToken: 'secret-refresh', expiresAt: NOW + 60_000 } })
const CODEX_LOGIN = JSON.stringify({ tokens: { access_token: `x.${Buffer.from(JSON.stringify({ exp: (NOW + 3 * 86_400_000) / 1000 })).toString('base64url')}.x` }, last_refresh: new Date(NOW - 86_400_000).toISOString() })
const REPLIES: Record<string, string> = {
  claude: JSON.stringify({ result: 'Current week (all models): 10% used' }),
  codex: `${JSON.stringify({ id: 2, result: { account: { type: 'chatgpt', planType: 'pro' } } })}\n${JSON.stringify({ id: 3, result: { rateLimits: { limitId: 'codex', primary: { usedPercent: 12, windowDurationMins: 300 } } } })}\n`,
}

interface Started { argv: string[]; env?: Record<string, string | undefined>; cwd?: string; state?: Record<string, string>; config?: Record<string, string> }

/** A machine of any platform, with real login files in a folder and nothing real run: the seal's own proof is acted out as `seal` says. */
async function machine(run: (context: { host: Host; started: Started[]; clis: () => string[]; dir: string; files: { claude: string; codex: string } }) => Promise<void>, options: { platform?: string; has?: string[]; sandbox?: boolean; seal?: 'holds' | 'leaks' | 'dead' | 'throws'; keychain?: [string, number]; claude?: string | null; codex?: string | null } = {}) {
  const { platform = 'darwin', has = ['claude', 'codex'], sandbox = true, seal = 'holds', keychain = ['', 44], claude = FRESH, codex = CODEX_LOGIN } = options
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'shep-mac-'))), config = join(dir, 'claude'), home = join(dir, 'codex'), started: Started[] = []
  mkdirSync(config)
  mkdirSync(home)
  writeFileSync(join(home, 'config.toml'), 'model = "x"')
  if (claude !== null) writeFileSync(join(config, '.credentials.json'), claude)
  if (codex !== null) writeFileSync(join(home, 'auth.json'), codex)
  const finished = (stdout: string, code: number) => ({ stdin: { write() {}, flush() {} }, stdout: new Response(stdout).body!, exited: Promise.resolve(code), signalCode: null, kill() {} })
  const host: Host = {
    platform, env: { USER: 'me', CLAUDE_CONFIG_DIR: config, CODEX_HOME: home }, exists: path => path === '/usr/bin/sandbox-exec' ? sandbox : existsSync(path),
    which: name => has.includes(name) ? `/bin/${name}` : null,
    spawn(argv, spawned) {
      const words = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1) : argv
      if (words[0] === '/usr/bin/security') { started.push({ argv }); return finished(keychain[0], keychain[1]) }
      const entry: Started = { argv, env: spawned.env, cwd: spawned.cwd }
      started.push(entry)
      if (words[0] === '/bin/sh') {
        const [open, shut] = words.slice(4)
        if (seal === 'dead') return finished('', 71)
        if (seal === 'throws') throw new Error('no such file')
        writeFileSync(join(open, 'proof'), '')
        if (seal === 'leaks') writeFileSync(join(shut, 'proof'), '')
        return finished('', 0)
      }
      const state = spawned.env?.CODEX_HOME
      const held = spawned.env?.CLAUDE_CONFIG_DIR
      if (held && words[0] === '/bin/claude') entry.config = Object.fromEntries(readdirSync(held).map(name => [name, readFileSync(join(held, name), 'utf8')]))
      if (state) entry.state = Object.fromEntries(readdirSync(state).filter(name => lstatSync(join(state, name)).isSymbolicLink()).map(name => [name, readlinkSync(join(state, name))]))
      return finished(REPLIES[words[0].split('/').pop()!] ?? '', 0)
    },
  }
  try { await run({ host, started, dir, files: { claude: join(config, '.credentials.json'), codex: join(home, 'auth.json') }, clis: () => started.map(entry => entry.argv.join(' ')).filter(words => /\/bin\/(claude|codex)/.test(words)) }) }
  finally { rmSync(dir, { recursive: true, force: true }) }
}

test('a Mac runs both CLIs in sandbox-exec and never bwrap; the proof comes first', () => machine(async ({ host, started, dir }) => {
  expect(await read(() => NOW, host)).toEqual({ claude: { state: 'ok', windows: [{ name: 'Weekly (all models)', used: 10 }] }, codex: { state: 'ok', plan: 'pro', windows: [{ name: '5-hour', used: 12 }] } })
  const sealed = started.filter(entry => entry.argv[0] !== '/usr/bin/security')
  expect(sealed.every(entry => entry.argv[0] === '/usr/bin/sandbox-exec')).toBe(true)
  for (const cli of ['claude', 'codex']) {
    const at = (test: (words: string) => boolean) => sealed.findIndex(entry => test(entry.argv.join(' ')))
    const run = sealed[at(words => words.includes(`-- /bin/${cli}`))]
    const open = run.argv.find(word => word.startsWith('-DOPEN='))!.slice(7)
    expect(at(words => words.includes(`-DOPEN=${open}`) && words.includes('/bin/sh'))).toBeLessThan(sealed.indexOf(run))
    expect(run.cwd).toBe(open)
    expect(run.env?.TMPDIR).toBe(open)
    expect(existsSync(open)).toBe(false) // Gone once read.
  }
  expect(readdirSync(dir).sort()).toEqual(['claude', 'codex'])
}))

test('Linux keeps bwrap, as it was: no sandbox-exec, no Keychain, no proof', () => machine(async ({ host, started, dir }) => {
  await read(() => NOW, host)
  const claude = started.find(entry => entry.argv.includes('/bin/claude'))!
  expect(claude.argv).toEqual(sealArgs(['/bin/claude', '-p', '/usage', '--output-format', 'json', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config']))
  expect(claude.env).toMatchObject({ TMPDIR: '/tmp', TZ: 'UTC' })
  const codex = started.find(entry => entry.argv.includes('/bin/codex'))!
  expect(codex.argv.slice(0, 1)).toEqual(['bwrap'])
  expect(codex.argv.slice(codex.argv.indexOf('--') + 1)).toEqual(['/bin/codex', 'app-server', '--disable', 'plugins'])
  expect(codex.argv).toContain(join(dir, 'codex', 'auth.json'))
  expect(codex.env).toBeUndefined()
  expect(started).toHaveLength(2)
}, { platform: 'linux', has: ['claude', 'codex', 'bwrap'] }))

test('Linux with no bwrap still says so and runs nothing', () => machine(async ({ host, started }) => {
  expect(await read(() => NOW, host)).toEqual({ claude: { state: 'unknown', why: "Can't read it safely here: bwrap is missing" }, codex: { state: 'unknown', why: "Can't read it safely here: bwrap is missing" } })
  expect(started).toEqual([])
}, { platform: 'linux' }))

test('a Mac with no sandbox-exec runs nothing, not even the Keychain read', () => machine(async ({ host, started }) => {
  expect(await read(() => NOW, host)).toEqual({ claude: { state: 'unknown', why: "Can't read it safely here: sandbox-exec is missing" }, codex: { state: 'unknown', why: "Can't read it safely here: sandbox-exec is missing" } })
  expect(started).toEqual([])
}, { sandbox: false }))

for (const seal of ['dead', 'leaks'] as const) test(`a seal that ${seal === 'dead' ? 'won\'t start' : 'lets a write through'} refuses: no CLI runs, and the folder goes`, () => machine(async ({ host, clis, started }) => {
  const result = await read(() => NOW, host)
  expect(result.claude).toEqual({ state: 'unknown', why: "Can't read it safely here: the Mac seal wouldn't hold" })
  expect(result.codex).toEqual({ state: 'unknown', why: "Can't read it safely here: the Mac seal wouldn't hold" })
  expect(clis()).toEqual([])
  for (const entry of started.filter(entry => entry.argv[0] === '/usr/bin/sandbox-exec')) expect(existsSync(entry.argv.find(word => word.startsWith('-DOPEN='))!.slice(7))).toBe(false)
}, { seal }))

test('a seal that can\'t even be started leaves no folder behind, and no CLI runs', () => machine(async ({ host, clis, started }) => {
  expect((await read(() => NOW, host)).claude).toEqual({ state: 'unknown', why: "Couldn't run it" })
  expect(clis()).toEqual([])
  for (const entry of started.filter(entry => entry.argv[0] === '/usr/bin/sandbox-exec')) expect(existsSync(entry.argv.find(word => word.startsWith('-DOPEN='))!.slice(7))).toBe(false)
}, { seal: 'throws' }))

test('a login due in the Keychain stops the CLI, whatever the file says', () => machine(async ({ host, clis, started }) => {
  expect((await read(() => NOW, host)).claude).toEqual(RENEWAL)
  expect(clis().filter(words => words.includes('claude'))).toEqual([])
  expect(started.filter(entry => entry.argv.join(' ').includes('Claude Code-credentials'))).toHaveLength(1)
}, { keychain: [DUE, 0], claude: FRESH }))

test('a login due in the file stops the CLI when the Keychain has none', () => machine(async ({ host, clis }) => {
  expect((await read(() => NOW, host)).claude).toEqual(RENEWAL)
  expect(clis().filter(words => words.includes('claude'))).toEqual([])
}, { claude: DUE }))

test('a Keychain it can\'t read refuses, since the login might be there and due', () => machine(async ({ host, clis }) => {
  expect((await read(() => NOW, host)).claude).toEqual({ state: 'unknown', why: "Couldn't check its sign-in in the Keychain, so it wasn't run" })
  expect(clis().filter(words => words.includes('claude'))).toEqual([])
}, { keychain: ['', 36] }))

test('with a login in both places the CLI gets only the Keychain\'s, unrenewable, in a throwaway config; no token is in its words or environment', () => machine(async ({ host, started, dir }) => {
  expect((await read(() => NOW, host)).claude).toMatchObject({ state: 'ok' })
  const run = started.find(entry => entry.argv.includes('/bin/claude'))!
  const state = run.env!.CLAUDE_CONFIG_DIR!
  expect(state).toStartWith(run.cwd!)
  expect(state).not.toStartWith(dir)
  expect(Object.keys(run.config!)).toEqual(['.credentials.json']) // No real config, no link to one.
  const { claudeAiOauth } = JSON.parse(FRESH)
  expect(JSON.parse(run.config!['.credentials.json'])).toEqual({ claudeAiOauth: { accessToken: claudeAiOauth.accessToken, expiresAt: claudeAiOauth.expiresAt } })
  expect(run.argv[2]).toBe(macProfile())
  expect(run.env!.PATH).toStartWith(join(run.cwd!, 'bin') + ':')
  expect(JSON.stringify(started.map(({ argv, env, cwd }) => ({ argv, env, cwd })))).not.toContain('secret-')
  expect(existsSync(state)).toBe(false)
}, { keychain: [FRESH, 0], claude: DUE }))

test('a login only in the file goes the same way; a custom secure store can\'t lead the CLI back to a real one', () => machine(async ({ host, started }) => {
  host.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = '/elsewhere'
  await read(() => NOW, host)
  const run = started.find(entry => entry.argv.includes('/bin/claude'))!
  expect(JSON.parse(run.config!['.credentials.json']).claudeAiOauth.refreshToken).toBeUndefined()
  expect(run.env?.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBeUndefined()
}))

test('no login anywhere: the CLI runs with none, to say so itself', () => machine(async ({ host, started }) => {
  await read(() => NOW, host)
  expect(started.find(entry => entry.argv.includes('/bin/claude'))!.config).toEqual({})
}, { claude: null }))

test('Codex on a Mac gets a throwaway home with links to its login and config, and stays off the Keychain', () => machine(async ({ host, started, files }) => {
  await read(() => NOW, host)
  const run = started.find(entry => entry.argv.includes('/bin/codex'))!
  expect(run.env?.CODEX_HOME).not.toBe(join(files.codex, '..'))
  expect(run.env?.CODEX_HOME).toStartWith(run.cwd!)
  expect(run.env?.CODEX_SQLITE_HOME).toBe(run.env?.CODEX_HOME)
  expect(run.state).toEqual({ 'auth.json': files.codex, 'config.toml': join(files.codex, '../config.toml') })
  expect(run.argv.slice(-2)).toEqual(['-c', 'cli_auth_credentials_store="file"'])
  expect(run.argv[2]).toBe(macProfile(true))
  expect(readFileSync(files.codex, 'utf8')).toBe(CODEX_LOGIN)
}))

test('Codex on a Mac with a login due, or with no login file to check, isn\'t run', async () => {
  const due = JSON.stringify({ tokens: { access_token: 'x.e30.x' } })
  await machine(async ({ host, clis }) => {
    expect((await read(() => NOW, host)).codex).toEqual(RENEWAL)
    expect(clis().filter(words => words.includes('codex'))).toEqual([])
  }, { codex: due })
  await machine(async ({ host, clis }) => {
    expect((await read(() => NOW, host)).codex).toEqual({ state: 'unknown', why: "No Codex sign-in file here to check, so it wasn't run" })
    expect(clis().filter(words => words.includes('codex'))).toEqual([])
  }, { codex: null })
})

test('a failed read keeps the last good numbers at their age; anything else replaces them', () => {
  const good = { state: 'ok' as const, at: 1, windows: [{ name: 'Weekly', used: 10 }] }
  expect(nextRead(good, { state: 'unknown', why: 'Timed out' }, 9)).toEqual({ ...good, failed: 'Timed out' })
  expect(nextRead(good, { state: 'signed-out' }, 9)).toEqual({ state: 'signed-out', at: 9 })
  expect(nextRead(undefined, { state: 'unknown', why: 'Timed out' }, 9)).toEqual({ state: 'unknown', why: 'Timed out', at: 9 })
})

async function fixture(run: (context: { limits: CorePlanLimits; answer: { value: unknown }; calls: string[][]; store: CoreStore; emits: string[]; online: { value: boolean } }) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-limits-')), store = new CoreStore(home), calls: string[][] = [], emits: string[] = []
  const answer: { value: unknown } = { value: {} }, online = { value: true }
  const source = { store, quiescing: false, machineIds: () => ['box'], machineConnected: () => online.value, emit(name: string) { emits.push(name) }, agents: { bun: async () => process.execPath },
    files: { exec: async (_machine: string, argv: string[]) => { calls.push(argv); if (answer.value instanceof Error) throw answer.value; return Buffer.from(JSON.stringify(answer.value)) } } } as unknown as CoreSource
  const limits = new CorePlanLimits(source)
  try { await run({ limits, answer, calls, store, emits, online }) }
  finally { limits.stop(); await limits.drain(); store.close(); rmSync(home, { recursive: true, force: true }) }
}

test('core reads through exec, never through an agent, and leaves a CLI the machine lacks out', () => fixture(async ({ limits, answer, calls, emits }) => {
  answer.value = { claude: { state: 'ok', windows: [{ name: 'Weekly', used: 10, resetsAt: NOW }] } }
  await limits.refresh()
  expect(calls[0][1]).toBe('-e')
  expect(calls[0][2]).toContain('account/rateLimits/read')
  expect(limits.view('box')).toMatchObject({ claude: { state: 'ok', windows: [{ name: 'Weekly', used: 10 }] } })
  expect(limits.view('box')!.codex).toBeUndefined()
  expect(emits).toEqual(['snapshot'])
}))

test('a machine read a moment ago is left alone when asked, and a machine out of reach isn\'t tried', () => fixture(async ({ limits, answer, calls, online }) => {
  answer.value = { codex: { state: 'signed-out' } }
  await limits.refresh()
  await limits.refresh(60_000)
  expect(calls).toHaveLength(1)
  online.value = false
  await limits.refresh()
  expect(calls).toHaveLength(1)
}))

test('a broken answer is unknown, and losing the machine keeps what was read, at its age', () => fixture(async ({ limits, answer, store }) => {
  answer.value = { claude: { state: 'ok', windows: [{ name: 'Weekly', used: 'many' }] } }
  await limits.refresh()
  expect(limits.view('box')!.claude).toMatchObject({ state: 'unknown' })
  store.set('plan-limits', 'box', { claude: { state: 'ok', at: 5, windows: [{ name: 'Weekly', used: 10 }] } } satisfies MachineLimits)
  answer.value = new Error('Command timed out with a token-looking word')
  await limits.refresh()
  expect(limits.view('box')).toEqual({ claude: { state: 'ok', at: 5, windows: [{ name: 'Weekly', used: 10 }], failed: "Couldn't reach this machine's CLIs" } })
}))

test('with its plugin off nothing runs and nothing shows', () => fixture(async ({ limits, answer, calls }) => {
  answer.value = {}
  Object.assign((limits as unknown as { source: object }).source, { plugins: { has: () => false } })
  await limits.refresh()
  expect(calls).toHaveLength(0)
  expect(limits.view('box')).toBeUndefined()
}))
