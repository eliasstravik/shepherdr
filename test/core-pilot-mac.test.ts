import { expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pilotMacEnvironment, pilotMacProfile, pilotMacReadProfile, pilotMacRelay, pilotMacText, type PilotMacProfile } from '../helper/core-pilot-mac.ts'
import { connect } from 'node:net'
import { pilotLiveLogin, pilotLoginPaths, PilotMacLogin, pilotUsageReading, PilotUsageHook, type PilotLoginSource } from '../helper/core-pilot-mac-login.ts'
import { PilotProxy } from '../helper/core-pilot-proxy.ts'
import { preparePilotLaunch } from '../helper/core-pilot-launch.ts'
import { CorePilotPolicy } from '../server/core/pilot-policy.ts'
import '../server/core/settings.ts' // Loads first: pilot-settings.ts and settings.ts import each other.
import { PILOT_SETTINGS } from '../server/core/pilot-settings.ts'

const profile = (over: Partial<PilotMacProfile> = {}) => pilotMacProfile({ cwd: '/work/task', repo: '/work/repo', git: ['/work/task/.git', '/work/repo/.git'], state: '/run/home', control: '/run/control', bun: '/opt/bun', binary: '/opt/claude', companions: [], gateway: '/sock/gateway.sock', proxyPort: 4242, writable: true, masks: [], marker: { allowed: '/run/.marker-allowed', denied: '/run/.marker-denied' }, sealed: ['/run/home', '/run/home/.claude', '/run/home/.claude/.credentials.json'], ...over })

test('the profile denies by default and opens only this run', () => {
  const text = profile()
  expect(text).toContain('(deny default)')
  expect(text).toContain('(remote ip "localhost:4242")')
  expect(text).toContain('(remote unix-socket (literal "/sock/gateway.sock"))')
  expect(text).toContain('(allow file-read-data (literal "/run/.marker-allowed"))')
  expect(text).not.toContain('.marker-denied')
  expect(text).not.toContain('(allow network*')
  expect(text).not.toContain('localhost:*')
  for (const service of ['com.apple.SecurityServer', 'securityd', 'launchservicesd', 'appleevents', 'pasteboard', 'cfprefsd', 'com.apple.metadata', 'trustd']) expect(text).not.toContain(service)
  expect(text).not.toContain('"/System"') // /System/Volumes/Data is a second path to every user file.
  expect(text).not.toContain('/Users')
})
test('later rules keep Git metadata and the live login read-only inside writable folders', () => {
  const text = profile(), write = text.indexOf('(allow file-write* '), seal = text.indexOf('(deny file-write* ')
  expect(write).toBeGreaterThan(-1); expect(seal).toBeGreaterThan(write)
  const rule = text.slice(seal, text.indexOf('\n', seal))
  for (const path of ['/work/task/.git', '/work/repo/.git', '/run/home/.claude/.credentials.json']) expect(rule).toContain(`"${path}"`)
})
test('a coordinator gets no writable project', () => {
  const allow = (text: string) => { const at = text.indexOf('(allow file-write* '); return text.slice(at, text.indexOf('\n', at)) }
  expect(allow(profile())).toContain('/work/task')
  expect(allow(profile({ writable: false }))).not.toContain('/work/task')
})
test('only this run’s terminal opens, never a pattern that reaches other terminals', () => {
  expect(profile()).not.toContain('ttys'); expect(profile()).not.toContain('ptmx'); expect(profile()).not.toContain('(subpath "/dev")')
  expect(profile({ tty: '/dev/ttys012' })).toContain('(literal "/dev/ttys012")')
  expect(() => profile({ tty: '/dev/ttys012"))' })).toThrow('terminal')
  expect(pilotMacReadProfile(['/work/task'], '/opt/bun')).not.toContain('allow file-write*'); expect(pilotMacReadProfile(['/work/task'], '/opt/bun')).not.toContain('network')
})
test('paths cannot break out of a profile rule', () => {
  expect(profile({ state: '/run/ho"me' })).toContain('"/run/ho\\"me"')
  expect(() => profile({ cwd: 'relative' })).toThrow('absolute')
  expect(() => profile({ cwd: '/work/ta\nsk' })).toThrow('plain')
  expect(() => profile({ proxyPort: 0 })).toThrow('port')
})
test('fixed launch paths become their real locations', () => {
  const map = { control: '/real/control', gateway: '/real/gateway.sock', bun: '/real/bun', binary: '/real/claude', kind: 'claude' }
  expect(pilotMacText('/run/shepherdr/bin/shepherdr /run/shepherdr/settings.json /run/shepherdr/gateway.sock /run/shepherdr/bun /run/shepherdr/claude', map))
    .toBe('/real/control/bin/shepherdr /real/control/settings.json /real/gateway.sock /real/bun /real/claude')
  const env = pilotMacEnvironment({ state: '/real/home', control: '/real/control', gateway: '/real/gateway.sock', proxyPort: 4242, developer: '/dev/tools' })
  expect(env.HOME).toBe('/real/home'); expect(env.CLAUDE_CONFIG_DIR).toBe('/real/home/.claude'); expect(env.SHEPHERDR_PILOT_PROXY).toBe('http://127.0.0.1:4242')
  expect(env.PATH.split(':').slice(0, 3)).toEqual(['/real/control/bin', '/dev/tools/Toolchains/XcodeDefault.xctoolchain/usr/bin', '/dev/tools/usr/bin'])
  expect(JSON.stringify(env)).not.toContain('CREDENTIAL')
})
test('only the live access token crosses into the sandbox', () => {
  const host = { claudeAiOauth: { accessToken: 'access', refreshToken: 'refresh', expiresAt: 5, scopes: ['user:inference'], subscriptionType: 'max', rateLimitTier: 'tier', other: 'x' }, mcpOAuth: { server: { accessToken: 'mcp', refreshToken: 'mcp-refresh' } } }
  const login = pilotLiveLogin(JSON.stringify(host))!
  expect(JSON.parse(login.file)).toEqual({ claudeAiOauth: { accessToken: 'access', refreshToken: null, expiresAt: 5, scopes: ['user:inference'], subscriptionType: 'max', rateLimitTier: 'tier' } })
  expect(login.file).not.toContain('refresh"'); expect(login.file).not.toContain('mcp')
  expect(pilotLiveLogin(Buffer.from(JSON.stringify(host)).toString('hex'))?.file).toBe(login.file) // As the Keychain stores it.
  for (const bad of ['', 'not json', '{}', '{"claudeAiOauth":{}}', '{"claudeAiOauth":{"accessToken":""}}']) expect(pilotLiveLogin(bad)).toBeUndefined()
})
test('the login file follows every host change and asks the host to refresh near expiry', async () => {
  const state = mkdtempSync(join(tmpdir(), 'shep-mac-login-'))
  try {
    mkdirSync(join(state, '.claude'))
    let text: string | undefined, mark = 1, now = 1_000_000, refreshes = 0, reads = 0
    const source: PilotLoginSource = { changeMark: () => mark, read: async () => { reads++; return text }, refresh: () => { refreshes++ } }
    const login = new PilotMacLogin(state, source, () => now), { file } = pilotLoginPaths(state), token = () => JSON.parse(readFileSync(file, 'utf8')).claudeAiOauth.accessToken
    const set = (accessToken: string, left: number) => { text = JSON.stringify({ claudeAiOauth: { accessToken, refreshToken: 'host', expiresAt: now + left } }); mark++ }
    set('A', 3_600_000); await login.check(); expect(token()).toBe('A'); expect(refreshes).toBe(0)
    await login.check(); expect(reads).toBe(1) // Nothing changed: the secret is not read again.
    set('B', 3_600_000); await login.check(); expect(token()).toBe('B')
    set('C', 120_000); await login.check(); expect(token()).toBe('C'); expect(refreshes).toBe(1)
    mark++; await login.check(); expect(refreshes).toBe(1) // At most once a minute.
    now += 61_000; mark++; await login.check(); expect(refreshes).toBe(2)
    text = undefined; mark++; await login.check(); expect(token()).toBe('C') // An unreadable store keeps the last login, never another.
  } finally { rmSync(state, { recursive: true, force: true }) }
})
test('a usage reading carries only checked numbers', () => {
  expect(pilotUsageReading({ session_id: 'x', cwd: '/secret', rate_limits: { five_hour: { used_percentage: 42, resets_at: 100, extra: 'x' }, seven_day: { used_percentage: 17 }, other: { used_percentage: 1 } } }))
    .toEqual({ rate_limits: { five_hour: { used_percentage: 42, resets_at: 100 }, seven_day: { used_percentage: 17 } } })
  for (const bad of [undefined, {}, { rate_limits: {} }, { rate_limits: { five_hour: { used_percentage: 'x' } } }, { rate_limits: { five_hour: { used_percentage: 101 } } }, { rate_limits: { five_hour: { used_percentage: -1 } } }]) expect(pilotUsageReading(bad)).toBeUndefined()
})
test('the host command gets readings on stdin, and an unsafe command is never run', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'shep-mac-usage-'))), command = join(home, 'usage'), out = join(home, 'out')
  try {
    const reading = { rate_limits: { five_hour: { used_percentage: 42 } } }
    expect(new PilotUsageHook(command, home).report(reading)).toBe(false) // None configured.
    writeFileSync(command, `#!/bin/sh\ncat >> ${out}\n`); chmodSync(command, 0o775)
    const open = new PilotUsageHook(command, home); expect(open.report(reading)).toBe(false) // Group-writable.
    chmodSync(command, 0o700)
    const hook = new PilotUsageHook(command, home)
    expect(hook.report({ rate_limits: { five_hour: { used_percentage: 200 } } })).toBe(false)
    expect(hook.report(reading)).toBe(true)
    for (let n = 0; n < 100 && !Bun.file(out).size; n++) await Bun.sleep(20)
    await hook.close()
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(reading)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
test('usage readings reach only a backend that offers them', async () => {
  const socket = join(realpathSync(mkdtempSync(join(tmpdir(), 'shep-gw-'))), 'g.sock')
  const seen: unknown[] = [], base = { cli: async () => ({}), secret: async () => ({}), hook: async () => ({}), lease: async () => {}, reserve: async () => {} }
  const records = { write: () => ({}) } as never
  const call = async (backend: ConstructorParameters<typeof PilotProxy>[2]) => {
    const proxy = new PilotProxy([], records, backend); await proxy.listen(socket)
    try {
      const response = await fetch('http://x/mail', { unix: socket, method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), action: 'usage', args: { rate_limits: {} } }) } as RequestInit)
      return response.status
    } finally { await proxy.close() }
  }
  expect(await call(base)).toBe(400)
  expect(await call({ ...base, usage: reading => { seen.push(reading); return true } })).toBe(200)
  expect(seen).toEqual([{ rate_limits: {} }])
})
test('a Keychain that cannot be read refuses the start, and later only keeps the last login', async () => {
  const state = realpathSync(mkdtempSync(join(tmpdir(), 'shep-login-locked-')))
  try {
    mkdirSync(join(state, '.claude'))
    let locked = true, mark = 1
    const source: PilotLoginSource = { changeMark: () => mark++, read: async () => { if (locked) throw Error('locked'); return JSON.stringify({ claudeAiOauth: { accessToken: 'A', refreshToken: 'host', expiresAt: Date.now() + 3_600_000 } }) }, refresh: () => {} }
    const login = new PilotMacLogin(state, source)
    await expect(login.start()).rejects.toThrow('locked')
    locked = false; await login.start(); login.stop()
    const token = () => JSON.parse(readFileSync(pilotLoginPaths(state).file, 'utf8')).claudeAiOauth.accessToken
    expect(token()).toBe('A')
    locked = true; await expect(login.check()).rejects.toThrow('locked'); expect(token()).toBe('A')
  } finally { rmSync(state, { recursive: true, force: true }) }
})

test('the relay drops a local client that holds a slot and says nothing', async () => {
  const relay = await pilotMacRelay('/nonexistent/gateway.sock', 50)
  try {
    const client = connect(relay.port, '127.0.0.1')
    await new Promise<void>(done => client.on('close', () => done()))
  } finally { relay.close() }
})

test('each platform refuses the other platform’s profile and starts nothing', () => {
  const input = { parent: '/nowhere', cwd: '/nowhere', repo: '/nowhere', kind: 'claude' as const, writable: false, instructions: '', privateRoots: [], settings: '{}' }
  if (process.platform === 'darwin') expect(() => preparePilotLaunch({ ...input, access: 'isolated' })).toThrow('choose the Mac sandbox')
  else expect(() => preparePilotLaunch({ ...input, access: 'mac' })).toThrow('needs macOS')
})
test('the permission profile is a labeled setting and policy accepts only offered values', () => {
  const row = PILOT_SETTINGS.rows.find(item => item.key === 'autopilot.access')!
  expect(row.value).toBe('Isolated workspace')
  expect(row.options).toEqual(['Isolated workspace', 'Mac sandbox'])
  const store = { get: () => undefined, set: () => {}, all: () => [], delete: () => {} } as never
  const config = { harness: { kind: 'claude' as const }, reviewer: { kind: 'claude' as const }, hosts: [], secrets: [], approvals: [], parallel: 1 }
  const policy = new CorePilotPolicy(store)
  expect(policy.begin('p', 'm', { ...config, access: 'mac' }).config.access).toBe('mac')
  expect(() => new CorePilotPolicy(store).begin('p', 'm', { ...config, access: 'open' as never })).toThrow('permission profile')
})
