// OUTSIDE containment. The macOS backend: a generated Seatbelt profile that denies by default, plus what Linux gets
// from namespaces and a private loopback. Importing this file never reads app/live state or starts a process.
import { randomBytes } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, connect, type Server, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PilotHome } from './core-pilot-home.ts'
import type { PilotSandbox } from './core-pilot-sandbox.ts'
import { pilotGitPaths, pilotProjectFiles } from './core-pilot-sandbox.ts'
import { pilotHostLogin, pilotLoginPaths, PilotMacLogin, PilotUsageHook } from './core-pilot-mac-login.ts'
import { pilotMacSweep, type PilotMacMarker, pilotMacVisible } from './core-pilot-mac-stop.ts'

export type PilotAccess = 'isolated' | 'mac' | 'mac-ports'
/** The JDK and Android SDK a build uses, and the folders of them the home folder may hold. All read-only. */
export interface PilotMacBuild { read: string[]; java?: string; android?: string }
/** Saved in the launch record. The proxy port is chosen only when the runtime starts. A build means the local-ports profile. */
export interface PilotMacPrepared { marker: PilotMacMarker; developer?: string; build?: PilotMacBuild }

export interface PilotMacProfile {
  cwd: string; repo: string; git: string[]; state: string; control: string; bun: string; binary: string; companions: string[]
  gateway: string; proxyPort: number; writable: boolean; masks: string[]; developer?: string
  /** This run's own terminal, if it has one. Every other terminal on the Mac stays out of reach. */
  tty?: string
  marker: PilotMacMarker
  /** The live login file and the directories leading to it: the host writes it, so the agent must not repoint them. */
  sealed: string[]
  build?: PilotMacBuild
  /** Local ports this run may connect to, on the local-ports profile only. */
  ports?: number[]
}
const word = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const quote = (path: string) => {
  if (!path.startsWith('/') || /[\x00-\x1f\x7f]/.test(path)) throw Error('Sandbox paths must be absolute plain paths')
  return word(path)
}
const paths = (filter: 'literal' | 'subpath', list: string[]) => list.map(path => `(${filter} ${quote(path)})`).join(' ')

// Readable system locations. /System/Volumes/Data is left out on purpose: it is another path to every user file.
const SYSTEM_READ = ['/usr', '/bin', '/sbin', '/System/Library', '/System/Cryptexes', '/System/Volumes/Preboot', '/System/iOSSupport', '/System/DriverKit', '/Library/Application Support/ClaudeCode', '/Library/Developer', '/Library/Java', '/Library/Frameworks', '/Library/Apple', '/Applications/Xcode.app', '/opt/homebrew', '/opt/local', '/private/etc', '/private/var/db/dyld', '/private/var/db/timezone', '/private/var/select']
const SYSTEM_READ_DENIED = ['/opt/homebrew/var', '/usr/local/var', '/opt/local/var', '/opt/homebrew/etc', '/usr/local/etc', '/opt/local/etc', '/private/etc/ssh', '/private/etc/sudoers', '/private/etc/sudoers.d', '/private/etc/master.passwd']
// The lookups a command-line program needs. Keychain, LaunchServices, AppleEvents, pasteboard, Spotlight and
// preferences are absent, so `security`, `open`, `osascript`, `pbpaste`, `mdfind` and `defaults` fail here. trustd is
// absent too: it runs outside the sandbox and fetches URLs named in a certificate, past the gateway.
const MACH = ['com.apple.system.logger', 'com.apple.logd', 'com.apple.system.notification_center', 'com.apple.system.opendirectoryd.libinfo', 'com.apple.system.opendirectoryd.membership', 'com.apple.bsd.dirhelper', 'com.apple.SystemConfiguration.configd']

// Named devices only: a blanket /dev would hand over every other terminal's keystrokes and screen on this Mac.
const DEVICES = ['(allow file-read* file-write-data file-ioctl (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper") (regex #"^/dev/(fd/[0-9]+|stdin|stdout|stderr)$"))', '(allow file-read* file-ioctl (literal "/dev/random") (literal "/dev/urandom") (literal "/dev/autofs_nowait"))']
/** What any Bun or native program needs to start at all. Nothing here reaches a user file, the network or a service. */
const BASE = ['(version 1)', '(deny default)', '(allow process-fork)', '(allow process-exec)', '(allow process-info* (target same-sandbox))', '(allow signal (target same-sandbox))', '(allow process-codesigning-status*)', '(allow file-map-executable)', '(allow file-test-existence)', '(allow sysctl-read)', '(deny sysctl-read (sysctl-name-prefix "kern.procargs"))', '(allow system-fsctl)', ...DEVICES]
/** A fresh read-only view for one artifact read, the way Linux gets a new namespace. No network and no writes at all. */
export function pilotMacReadProfile(roots: string[], bun: string) {
  return [...BASE, `(allow file-read-metadata)`, `(allow file-read* ${paths('subpath', [...SYSTEM_READ, ...roots])} ${paths('literal', ['/', '/etc', '/var', '/tmp', '/private', bun])})`, `(deny file-read* ${paths('subpath', SYSTEM_READ_DENIED)})`, ''].join('\n')
}
const validPort = (port: number) => Number.isSafeInteger(port) && port >= 1 && port <= 65535
/** Later rules win. Everything not named here is denied, including every other home file and control socket. */
export function pilotMacProfile(input: PilotMacProfile) {
  if (!validPort(input.proxyPort) || input.ports?.some(port => !validPort(port))) throw Error('Invalid sandbox proxy port')
  const read = [input.repo, input.cwd, ...input.git, input.state, input.control, ...(input.developer ? [input.developer] : []), ...(input.build?.read ?? [])], binaries = [input.bun, input.binary, ...input.companions]
  // Git metadata stays read-only even inside a writable worktree.
  const writable = [input.state, ...(input.writable ? [input.cwd] : [])]
  if (input.tty !== undefined && !/^\/dev\/ttys[0-9]+$/.test(input.tty)) throw Error('Invalid sandbox terminal')
  return [
    ...BASE,
    // Identity of this exact profile, read by the host's stop sweep.
    `(allow file-read-data (literal ${quote(input.marker.allowed)}))`,
    '(allow mach-priv-task-port (target same-sandbox))',
    // Whether another path exists, and its size and dates, stay visible; its contents and listing do not.
    '(allow file-read-metadata)',
    `(allow file-read* ${paths('subpath', [...SYSTEM_READ, ...read])} ${paths('literal', ['/', '/etc', '/var', '/tmp', '/private', ...binaries])})`,
    `(deny file-read* ${paths('subpath', SYSTEM_READ_DENIED)})`,
    `(allow file-write* ${paths('subpath', writable)})`,
    ...(input.tty ? [`(allow file-read* file-write-data file-ioctl (literal ${quote(input.tty)}))`] : []),
    `(deny file-write* ${paths('subpath', input.git)} ${paths('literal', input.sealed)})`,
    // Gradle won't build a project whose root reports read-only. It still can't be moved or removed.
    ...(input.build && input.writable ? [`(allow file-write-data (literal ${quote(input.cwd)}))`] : []),
    ...(input.masks.length ? [`(deny file-read* file-write* ${paths('literal', input.masks)})`] : []),
    `(allow mach-lookup ${MACH.map(name => `(global-name ${word(name)})`).join(' ')})`,
    '(allow ipc-posix-shm)',
    '(allow ipc-posix-sem)',
    '(allow system-socket (socket-domain AF_INET) (socket-domain AF_INET6) (socket-domain AF_UNIX))',
    // The only ways out: this run's gateway socket and its CONNECT port. Sockets the agent makes in its home work too.
    `(allow network-outbound (remote unix-socket (literal ${quote(input.gateway)})) (remote ip ${word(`localhost:${input.proxyPort}`)}))`,
    `(allow network-bind network-inbound (local unix-socket (subpath ${quote(input.state)})))`,
    `(allow network-outbound (remote unix-socket (subpath ${quote(input.state)})))`,
    // Listening is all or nothing: "localhost" here still takes a bind on every address and a peer from another machine.
    // One rule per port: Seatbelt has no ranges, and it won't compile one rule holding thousands.
    ...(input.ports ? ['(allow network-bind network-inbound (local ip "localhost:*"))', ...input.ports.map(port => `(allow network-outbound (remote ip "localhost:${port}"))`)] : []),
    '',
  ].join('\n')
}

/** Replace the fixed in-namespace paths in words and arguments with their real locations on this machine. */
export function pilotMacText(text: string, map: { control: string; gateway: string; bun: string; binary: string; kind: string }) {
  return text
    .replaceAll('/run/shepherdr/gateway.sock', map.gateway)
    .replaceAll('/run/shepherdr/bun', map.bun)
    .replace(new RegExp(`/run/shepherdr/${map.kind}\\b(?!\\.)`, 'g'), map.binary)
    .replaceAll('/run/shepherdr', map.control)
}
// The /usr/bin developer tools are shims that insist on a cache in the shared temporary folder. Writing that cache
// would steer the host's own tools, so the profile denies it and the real tools go first on PATH. Xcode keeps its
// compilers in its toolchain, not its usr/bin.
const pilotMacPath = (control: string, developer?: string, java?: string) => `${join(control, 'bin')}:${java ? `${join(java, 'bin')}:` : ''}${developer ? `${join(developer, 'Toolchains/XcodeDefault.xctoolchain/usr/bin')}:${join(developer, 'usr/bin')}:` : ''}/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`
// A JVM ignores HTTPS_PROXY and takes its home and temporary folders from the system, not the environment. Its default
// sockets reach 127.0.0.1 through an IPv4-mapped address, which no rule here can match without also opening the internet,
// so it goes by ::1. Not by preferIPv4Stack: Gradle's process-isolated workers start without these options, and those
// reach their parent only if it listens where a plain JVM can connect.
const pilotMacJavaOptions = (state: string, proxyPort: number) => ['-Djava.net.preferIPv6Addresses=true', ...['https', 'http'].flatMap(scheme => [`-D${scheme}.proxyHost=localhost`, `-D${scheme}.proxyPort=${proxyPort}`]), `-Duser.home="${state}"`, `-Djava.io.tmpdir="${join(state, 'tmp')}"`, '-XX:-UsePerfData'].join(' ')
export function pilotMacEnvironment(input: { state: string; control: string; gateway: string; proxyPort: number; developer?: string; build?: PilotMacBuild }) {
  // xcrun would tell a compiler where the SDK is.
  const sdk = input.developer && ['Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk', 'SDKs/MacOSX.sdk'].map(path => join(input.developer!, path)).find(path => existsSync(path))
  return { ...(sdk ? { SDKROOT: sdk } : {}), HOME: input.state, USER: 'agent', TERM: 'xterm-256color', LANG: 'en_US.UTF-8', SHELL: '/bin/zsh', TMPDIR: join(input.state, 'tmp') + '/', CLAUDE_CODE_TMPDIR: join(input.state, 'tmp'),
    PATH: pilotMacPath(input.control, input.developer, input.build?.java), NODE_USE_ENV_PROXY: '1', SHEPHERDR_COMMAND: join(input.control, 'bin/shepherdr'),
    SHEPHERDR_PILOT_GATEWAY: input.gateway, SHEPHERDR_PILOT_PROXY: `http://127.0.0.1:${input.proxyPort}`, CODEX_HOME: join(input.state, '.codex'), CLAUDE_CONFIG_DIR: join(input.state, '.claude'), DISABLE_AUTOUPDATER: '1',
    // Rust and OpenSSL clients otherwise ask the denied Keychain for trust roots.
    SSL_CERT_FILE: '/etc/ssl/cert.pem',
    ...(input.developer ? { DEVELOPER_DIR: input.developer } : {}),
    ...(input.build ? { JAVA_TOOL_OPTIONS: pilotMacJavaOptions(input.state, input.proxyPort), GRADLE_USER_HOME: join(input.state, '.gradle'), ...(input.build.java ? { JAVA_HOME: input.build.java } : {}), ...(input.build.android ? { ANDROID_HOME: input.build.android } : {}) } : {}) }
}
const shell = (word: string) => `'${word.replace(/'/g, `'\\''`)}'`
function developerTools() {
  const found = Bun.spawnSync(['/usr/bin/xcode-select', '-p'], { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore', timeout: 5000 })
  const path = found.exitCode === 0 ? found.stdout.toString().trim() : ''
  if (!path.startsWith('/') || !existsSync(path)) return
  const real = realpathSync(path)
  return /^\/(?:Applications\/[^/]+\.app\/Contents\/Developer|Library\/Developer\/CommandLineTools)$/.test(real) ? real : undefined
}
function pilotMacBuild(): PilotMacBuild {
  const real = (path: string) => existsSync(path) ? realpathSync(path) : undefined, under = (path: string) => real(join(homedir(), path))
  const found = Bun.spawnSync(['/usr/libexec/java_home'], { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore', timeout: 5000 })
  const java = found.exitCode === 0 ? real(found.stdout.toString().trim()) : undefined, android = under('Library/Android/sdk')
  const read = [java, android, ...['Library/Java/JavaVirtualMachines', '.local/share/mise/installs/java', '.sdkman/candidates/java'].map(under)].filter(path => path !== undefined)
  return { read: [...new Set(read)], ...(java ? { java } : {}), ...(android ? { android } : {}) }
}
// A listener's port comes from the first range, and Kotlin's compile daemon picks from the second. Seatbelt can't tell
// which listeners are this run's own, so a port something else listens on now stays closed; one taken later is reachable.
const BUILD_PORTS = [[49152, 65535], [17001, 18000]] as const
/** The port in one line of `netstat -an -p tcp`, if something listens on it. UDP numbers are a separate space, which a new TCP listener may take. */
export function pilotMacHeldPort(line: string) {
  const [protocol, , , local, , state] = line.trim().split(/\s+/)
  if (!/^tcp[46]*$/.test(protocol ?? '') || state !== 'LISTEN') return
  const port = Number(local?.split('.').at(-1))
  return validPort(port) ? port : undefined
}
/** Whoever owns them, which is why this asks netstat and not lsof. A failed read refuses the run. */
export function pilotMacOpenPorts() {
  const found = Bun.spawnSync(['/usr/sbin/netstat', '-an', '-p', 'tcp'], { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore', timeout: 10_000 })
  if (found.exitCode !== 0) throw Error('The Mac sandbox could not read which local ports are in use, so it was refused; no unrestricted fallback was started')
  const held = new Set(found.stdout.toString().split('\n').map(pilotMacHeldPort))
  return BUILD_PORTS.flatMap(([first, last]) => Array.from({ length: last - first + 1 }, (_, index) => first + index)).filter(port => !held.has(port))
}
/** After the shared checks: point the launch files at real paths, then prove the profile can be generated. */
export function pilotMacPrepare(home: PilotHome, sandbox: PilotSandbox, access?: PilotAccess): PilotMacPrepared {
  const id = randomBytes(12).toString('hex')
  const marker = { allowed: join(home.root, `.marker-${id}-allowed`), denied: join(home.root, `.marker-${id}-denied`) }
  // sandbox_check calls a missing path denied for everyone, so both must exist. They stay empty and out of the agent's reach.
  for (const path of [marker.allowed, marker.denied]) writeFileSync(path, '', { mode: 0o600, flag: 'wx' })
  for (const path of [join(home.state, 'tmp'), join(home.state, '.claude')]) mkdirSync(path, { recursive: true, mode: 0o700 })
  const { control, state, kind, bun, binary } = sandbox, map = { control, gateway: home.gateway, bun, binary, kind }
  writeFileSync(join(control, 'instructions.md'), pilotMacText(readFileSync(join(control, 'instructions.md'), 'utf8'), map), { mode: 0o600 })
  writeFileSync(join(control, 'bin/shepherdr'), `#!/bin/sh\nexec ${shell(bun)} ${shell(join(control, 'core-pilot-cli.ts'))} "$@"\n`, { mode: 0o700 })
  writeFileSync(join(control, 'bin', kind), `#!/bin/sh\nexec ${shell(binary)} "$@"\n`, { mode: 0o700 })
  // Bind-mount targets have no meaning without a mount.
  for (const name of ['bun', kind, 'gateway.sock', 'codex-code-mode-host']) rmSync(join(control, name), { force: true })
  const settings = JSON.parse(readFileSync(join(control, 'settings.json'), 'utf8')) as { hooks?: Record<string, { hooks: { command: string }[] }[]>; statusLine?: unknown; sandbox?: unknown }
  for (const groups of Object.values(settings.hooks ?? {})) for (const group of groups) for (const hook of group.hooks) hook.command = `${shell(bun)} ${shell(join(control, 'core-pilot-hook.ts'))}`
  if (kind === 'claude') {
    settings.statusLine = { type: 'command', command: `${shell(bun)} ${shell(join(control, 'core-pilot-statusline.ts'))}`, padding: 0 }
    // macOS refuses to nest sandboxes, so Claude's own could only fail here. The outer profile is the boundary.
    settings.sandbox = { enabled: false }
  } else writeFileSync(join(state, '.codex/config.toml'), `cli_auth_credentials_store = "file"\n${existsSync(join(state, '.codex/config.toml')) ? readFileSync(join(state, '.codex/config.toml'), 'utf8') : ''}`, { mode: 0o600 })
  writeFileSync(join(control, 'settings.json'), JSON.stringify(settings), { mode: 0o600 })
  const prepared = { marker, developer: developerTools(), ...(access === 'mac-ports' ? { build: pilotMacBuild() } : {}) }
  // A login shell's path_helper moves /usr/bin to the front. These run after it, and Codex runs its commands in one.
  for (const name of ['.zprofile', '.bash_profile']) writeFileSync(join(state, name), `export PATH=${shell(pilotMacPath(control, prepared.developer, prepared.build?.java))}\n`, { mode: 0o600, flag: 'wx' })
  pilotMacProfile(pilotMacProfileInput(home, sandbox, prepared, 1))
  return prepared
}
export function pilotMacProfileInput(home: Pick<PilotHome, 'gateway'>, sandbox: PilotSandbox, mac: PilotMacPrepared, proxyPort: number, tty?: string, ports?: number[]): PilotMacProfile {
  const git = pilotGitPaths(sandbox.repo, sandbox.cwd)
  const masks = pilotProjectFiles([{ path: sandbox.repo, writable: false }, { path: sandbox.cwd, writable: sandbox.writable }, ...git.map(path => ({ path, writable: false }))])
  const { file, temporary } = pilotLoginPaths(sandbox.state), companion = join(sandbox.binary, '../codex-code-mode-host')
  return { cwd: sandbox.cwd, repo: sandbox.repo, git, state: sandbox.state, control: sandbox.control, bun: sandbox.bun, binary: sandbox.binary, companions: sandbox.kind === 'codex' && existsSync(companion) ? [realpathSync(companion)] : [],
    gateway: home.gateway, proxyPort, writable: sandbox.writable, masks, tty, developer: mac.developer, marker: mac.marker, sealed: [sandbox.cwd, sandbox.state, join(sandbox.state, '.claude'), file, temporary], ...(mac.build ? { build: mac.build, ports } : {}) }
}
/** Quarantined and never approved, which macOS then hangs at start, in or out of any sandbox. 0x40 marks an approved one. */
export function pilotMacQuarantined(path: string) {
  const found = Bun.spawnSync(['/usr/bin/xattr', '-p', 'com.apple.quarantine', path], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' })
  const flags = found.exitCode === 0 ? parseInt(found.stdout.toString().split(';')[0]!, 16) : NaN
  return !Number.isNaN(flags) && !(flags & 0x40)
}
/** Gradle resolves dependencies in parallel over many hosts, past what a native agent's gateway ever needs. A tunnel takes two sockets. */
export const PILOT_MAC_BUILD_LIMITS = { sockets: 256, handshakes: 64 }
/** Loopback is shared with the whole Mac, so unlike Linux's private relay this one passes CONNECT only: never /mail. */
export async function pilotMacRelay(gateway: string, idle = 10_000, build = false) {
  const peers = new Set<Socket>(), slots = build ? PILOT_MAC_BUILD_LIMITS.sockets : 32
  const handle = (client: Socket) => {
    if (peers.size >= slots) { client.destroy(); return }
    peers.add(client); client.on('close', () => peers.delete(client)); client.on('error', () => {})
    client.setTimeout(idle, () => client.destroy()) // Any local process can connect: it mustn't hold a slot by saying nothing.
    client.once('data', (first: Buffer) => {
      client.setTimeout(0)
      if (first.subarray(0, 8).toString('latin1') !== 'CONNECT ') { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
      const upstream = connect(gateway)
      peers.add(upstream); upstream.on('close', () => { peers.delete(upstream); client.destroy() }); upstream.on('error', () => client.destroy())
      client.on('close', () => upstream.destroy())
      upstream.write(first); client.pipe(upstream); upstream.pipe(client)
    })
  }
  const listen = (port: number, host: string) => new Promise<Server>((resolve, reject) => { const server = createServer(handle); server.once('error', reject); server.listen(port, host, () => resolve(server)) })
  const close = (servers: Server[]) => () => { for (const socket of peers) socket.destroy(); for (const server of servers) server.close() }
  for (let tries = 8; ; tries--) {
    const server = await listen(0, '127.0.0.1'), port = (server.address() as { port: number }).port
    if (!build) return { port, close: close([server]) }
    // A JVM here finds this by ::1, on the same port. Something else may hold that port there.
    const other = await listen(port, '::1').catch((error: unknown) => { server.close(); if (tries <= 1) throw error })
    if (other) return { port, close: close([server, other]) }
  }
}
export interface PilotMacRun { visible(child: { pid: number; exitCode: number | null; signalCode: string | number | null }): Promise<boolean>; watcher: Promise<number>; command: string[]; env: Record<string, string>; usage(reading: unknown): boolean; close(): Promise<void> }
/** Holds what must outlive a crash of this wrapper (the stop watcher) and what only exists while it runs. */
export async function startPilotMac(home: PilotHome, sandbox: PilotSandbox, mac: PilotMacPrepared, args: string[], deadline?: number): Promise<PilotMacRun> {
  // In its own session: stopping this terminal must not stop the process that cleans up after it.
  const watcher = Bun.spawn([sandbox.bun, join(import.meta.dir, 'core-pilot-mac-stop.ts'), mac.marker.allowed, mac.marker.denied, String(deadline ?? 0), pilotLoginPaths(sandbox.state).file], { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore', detached: true, cwd: home.root, env: { PATH: '/usr/bin:/bin' } })
  const relay = await pilotMacRelay(home.gateway, undefined, !!mac.build).catch(error => { void watcher.stdin.end(); throw error })
  const login = sandbox.kind === 'claude' ? new PilotMacLogin(sandbox.state, pilotHostLogin(sandbox.binary)) : undefined
  const hook = new PilotUsageHook()
  const close = async () => {
    login?.stop(); relay.close()
    await watcher.stdin.end()
    // Normally seconds. A process still dodging keeps the watcher going on its own, past this wrapper's exit.
    let timer: ReturnType<typeof setTimeout> | undefined
    const finished = await Promise.race([watcher.exited.then(() => true), new Promise<boolean>(done => { timer = setTimeout(() => done(false), 70_000) })])
    clearTimeout(timer) // A pending timer would hold this wrapper's exit open for the whole wait.
    watcher.unref()
    // A second sweep here covers a watcher something else killed.
    const swept = finished && await pilotMacSweep(mac.marker).catch(() => false)
    await hook.close()
    rmSync(pilotLoginPaths(sandbox.state).file, { force: true }) // The run is over, so this token has no reader.
    if (!swept) throw Error('Some contained processes could not be stopped')
  }
  try {
    await login?.start()
    const named = Bun.spawnSync(['/usr/bin/tty'], { stdin: 'inherit', stdout: 'pipe', stderr: 'ignore' }), tty = named.exitCode === 0 ? named.stdout.toString().trim() : undefined
    const profile = join(home.root, 'profile.sb'), map = { control: sandbox.control, gateway: home.gateway, bun: sandbox.bun, binary: sandbox.binary, kind: sandbox.kind }
    writeFileSync(profile, pilotMacProfile(pilotMacProfileInput(home, sandbox, mac, relay.port, tty, mac.build ? pilotMacOpenPorts() : undefined)), { mode: 0o600 })
    if (lstatSync(profile).nlink !== 1) throw Error('The sandbox profile changed while it was being written')
    // Thousands of port rules take seconds to compile before the sandbox exists.
    return { close, visible: child => pilotMacVisible(mac.marker, child, mac.build ? 60_000 : 5000), watcher: watcher.exited, usage: reading => hook.report(reading), env: pilotMacEnvironment({ state: sandbox.state, control: sandbox.control, gateway: home.gateway, proxyPort: relay.port, developer: mac.developer, build: mac.build }),
      command: ['/usr/bin/sandbox-exec', '-f', profile, sandbox.bun, join(sandbox.control, 'bootstrap.ts'), join(sandbox.control, 'bin', sandbox.kind), ...args.map(word => pilotMacText(word, map))] }
  } catch (error) { await close().catch(() => {}); throw error }
}
