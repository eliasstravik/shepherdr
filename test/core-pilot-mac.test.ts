import { expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pilotMacBuildBackend, pilotMacEnvironment, pilotMacHeldPort, pilotMacProfile, pilotMacReadProfile, pilotMacRelay, pilotMacText, type PilotMacProfile } from '../helper/core-pilot-mac.ts'
import { connect, createServer } from 'node:net'
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
test('the local-ports profile opens only the ports it names, and the other profile none', () => {
  const build = { read: ['/tools/jdk', '/tools/sdk'], java: '/tools/jdk', android: '/tools/sdk' }, text = profile({ build, ports: [50000, 17005] }), strict = profile()
  expect(text).toContain('(allow network-outbound (remote ip "localhost:50000"))'); expect(text).toContain('(allow network-outbound (remote ip "localhost:17005"))')
  expect(text).toContain('(allow network-bind network-inbound (local ip "localhost:*"))')
  expect(text).not.toContain('(remote ip "localhost:*")'); expect(text).not.toContain('(remote ip "localhost:50001")')
  expect(text).toContain('(subpath "/tools/jdk")'); expect(text).not.toContain('(allow file-write* (subpath "/tools/jdk")')
  expect(text).toContain('(allow file-write-data (literal "/work/task"))') // Gradle asks whether its project root is writable.
  expect(profile({ build, ports: [], writable: false })).not.toContain('(allow file-write-data (literal "/work/task"))')
  for (const line of ['(local ip', '/tools/jdk', 'file-write-data (literal "/work/task")']) expect(strict).not.toContain(line)
  expect(() => profile({ build, ports: [70000] })).toThrow('port')
})
test('a port something else holds is read from netstat, whoever owns it', () => {
  expect(pilotMacHeldPort('tcp4       0      0  127.0.0.1.49435        *.*                    LISTEN')).toBe(49435)
  expect(pilotMacHeldPort('tcp46      0      0  *.5000                 *.*                    LISTEN')).toBe(5000)
  expect(pilotMacHeldPort('tcp6       0      0  ::1.46569              *.*                    LISTEN')).toBe(46569)
  expect(pilotMacHeldPort('udp4       0      0  *.53                   *.*')).toBeUndefined()
  expect(pilotMacHeldPort('tcp4       0      0  127.0.0.1.50000        127.0.0.1.50001        ESTABLISHED')).toBeUndefined()
  for (const line of ['Active Internet connections (including servers)', 'Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)', '']) expect(pilotMacHeldPort(line)).toBeUndefined()
})
test.skipIf(process.platform !== 'darwin')('a build run\'s relay answers on both loopback addresses, on one port', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-mac-relay-')), socket = join(root, 'gateway.sock'), upstream = createServer(peer => peer.end('tunnel'))
  await new Promise<void>(done => upstream.listen(socket, done))
  const reach = (port: number, host: string) => new Promise<string>(done => { const client = connect(port, host); let said = ''; client.on('connect', () => client.write('CONNECT example.com:443 HTTP/1.1\r\n\r\n')); client.on('data', part => { said += part.toString() }); client.on('close', () => done(said)); client.on('error', error => done((error as NodeJS.ErrnoException).code ?? 'error')) })
  const plain = await pilotMacRelay(socket), build = await pilotMacRelay(socket, undefined, true)
  try {
    expect(await reach(build.port, '127.0.0.1')).toBe('tunnel'); expect(await reach(build.port, '::1')).toBe('tunnel')
    expect(await reach(plain.port, '127.0.0.1')).toBe('tunnel'); expect(await reach(plain.port, '::1')).toBe('ECONNREFUSED')
  } finally { plain.close(); build.close(); upstream.close(); rmSync(root, { recursive: true, force: true }) }
})
test('a build charges traffic ahead in shared blocks, never past what the allowance has left', async () => {
  const signal = new AbortController().signal, block = 8 * 1048576
  const backendFor = (limit: number | undefined) => {
    const asked: number[] = []; let used = 0
    const backend = { cli: async () => ({ out: '', code: 0 }), secret: async () => ({ secrets: {} }), hook: async () => ({}), lease: async () => {},
      reserve: async (bytes: number) => { asked.push(bytes); await Bun.sleep(1); used += bytes; if (limit && used > limit) throw Error('allowance reached'); return limit ? { left: limit - used } : {} } }
    return { asked, build: pilotMacBuildBackend(backend) }
  }
  const open = backendFor(undefined)
  await open.build.reserve(65536, signal); expect(open.asked).toEqual([65536]) // The first is exact: nothing is known about the allowance yet.
  await Promise.all(Array.from({ length: 64 }, () => open.build.reserve(65536, signal)))
  expect(open.asked).toEqual([65536, block]) // 64 reads, one round trip.
  const small = backendFor(200_000)
  await small.build.reserve(65536, signal); await small.build.reserve(65536, signal); await small.build.reserve(65536, signal)
  expect(small.asked).toEqual([65536, 134464]) // Exactly what was left.
  await small.build.reserve(3000, signal)
  await expect(small.build.reserve(65536, signal)).rejects.toThrow('allowance reached')
  let leases = 0, clock = 0
  const backend = { ...backendFor(undefined).build, lease: async () => { leases++; await Bun.sleep(1) } }
  const leasing = pilotMacBuildBackend(backend, () => clock)
  await Promise.all(Array.from({ length: 40 }, () => leasing.lease(signal))); expect(leases).toBe(1)
  clock = 4999; await leasing.lease(signal); expect(leases).toBe(1)
  clock = 5000; await leasing.lease(signal); expect(leases).toBe(2)
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
  expect(env).not.toHaveProperty('JAVA_TOOL_OPTIONS')
  const build = pilotMacEnvironment({ state: '/real/home', control: '/real/control', gateway: '/real/gateway.sock', proxyPort: 4242, build: { read: ['/tools/jdk'], java: '/tools/jdk', android: '/tools/sdk' } }) as Record<string, string>
  for (const option of ['-Djava.net.preferIPv6Addresses=true', '-Dhttps.proxyHost=localhost', '-Dhttps.proxyPort=4242', '-Dhttp.proxyPort=4242', '-Duser.home="/real/home"', '-Djava.io.tmpdir="/real/home/tmp"']) expect(build.JAVA_TOOL_OPTIONS).toContain(option)
  expect(build).toMatchObject({ JAVA_HOME: '/tools/jdk', ANDROID_HOME: '/tools/sdk', GRADLE_USER_HOME: '/real/home/.gradle' })
  expect(build.PATH!.split(':').slice(0, 2)).toEqual(['/real/control/bin', '/tools/jdk/bin'])
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
  expect(row.options).toEqual(['Isolated workspace', 'Mac sandbox', 'Mac sandbox with local ports'])
  const store = { get: () => undefined, set: () => {}, all: () => [], delete: () => {} } as never
  const config = { harness: { kind: 'claude' as const }, reviewer: { kind: 'claude' as const }, hosts: [], secrets: [], approvals: [], parallel: 1 }
  const policy = new CorePilotPolicy(store)
  expect(policy.begin('p', 'm', { ...config, access: 'mac' }).config.access).toBe('mac')
  expect(new CorePilotPolicy(store).begin('p', 'm', { ...config, access: 'mac-ports' }).config.access).toBe('mac-ports')
  expect(() => new CorePilotPolicy(store).begin('p', 'm', { ...config, access: 'open' as never })).toThrow('permission profile')
})
