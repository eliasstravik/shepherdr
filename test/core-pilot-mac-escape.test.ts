// Real escape attempts from inside the real Mac profile. macOS only, so GitHub's Linux runners skip it; on a Mac:
//   bun test test/core-pilot-mac-escape.test.ts
// Everything uses a scratch home and repository. It never reads the real login, and it reaches two public hosts.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { copyFileSync, chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { join } from 'node:path'
import { pilotMacQuarantined } from '../helper/core-pilot-mac.ts'
import { pilotMacProcesses, pilotMacSweep, pilotMacVisible } from '../helper/core-pilot-mac-stop.ts'
import { CoreRemotes } from '../server/core/remote.ts'
import type { CoreFiles } from '../server/core/files.ts'
import { pilotArtifact } from '../helper/core-pilot-artifact.ts'

const fixture = join(import.meta.dir, 'core-pilot-mac-escape.fixture.ts'), runner = process.execPath
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
interface Attempt { name: string; code: number; out: string }

describe.skipIf(process.platform !== 'darwin')('Mac sandbox escape attempts', () => {
  let root: string, home: string, repo: string, task: string, parent: string, listener: Server, unix: Server, listenerPort = 0
  const git = (...args: string[]) => { const out = Bun.spawnSync(['/usr/bin/git', ...args], { cwd: repo, env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.invalid' } }); if (out.exitCode) throw Error(out.stderr.toString()) }
  const launch = (config: { writable?: boolean; cwd?: string; args: string[]; deadline?: number; kind?: 'claude' | 'codex'; fixture?: string; parent?: string }) => Bun.spawn([runner, config.fixture ?? fixture, JSON.stringify({ parent: config.parent ?? parent, cwd: config.cwd ?? task, repo, writable: config.writable ?? true, access: 'mac', kind: config.kind ?? 'claude', args: config.args, hosts: ['example.com', '100.100.100.100'], deadline: config.deadline })],
    { cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: { HOME: home, PATH: `${join(root, 'bin')}:/usr/bin:/bin`, USER: 'tester' } })
  /** Runs `script` as the agent and returns one row per `try` line it wrote. */
  async function attempts(script: string, config: { writable?: boolean; cwd?: string; fixture?: string; parent?: string } = {}) {
    const words = `
attempt() { name=$1; shift; result=$("$@" 2>&1); printf '%s\\t%s\\t%s\\n' "$name" "$?" "$(printf '%s' "$result" | tr '\\n\\t' '  ' | cut -c1-200)" >> "$HOME/attempts.tsv"; }
export HOST_HOME=${JSON.stringify(home)} REPO=${JSON.stringify(repo)} TASK=${JSON.stringify(task)} LISTENER=${listenerPort}
${script}
`
    const child = launch({ ...config, args: ['-c', words] })
    const text = await new Response(child.stdout).text(); await child.exited
    const prepared = JSON.parse(text.split('\n')[0]!).prepared as { paths: { state: string } }
    return readFileSync(join(prepared.paths.state, 'attempts.tsv'), 'utf8').trim().split('\n').map(line => { const [name, code, ...rest] = line.split('\t'); return { name: name!, code: Number(code), out: rest.join(' ') } as Attempt })
  }
  const row = (rows: Attempt[], name: string) => { const found = rows.find(item => item.name === name); if (!found) throw Error(`No attempt named ${name}`); return found }

  beforeAll(async () => {
    // Not the usual TMPDIR: the profile doesn't allow /var/folders, so a worktree there couldn't be read.
    root = realpathSync(mkdtempSync('/private/tmp/shep-mac-escape-'))
    home = join(root, 'home'); repo = join(root, 'repo'); task = join(root, 'task'); parent = join(root, 'sessions')
    for (const path of [join(home, '.ssh'), join(home, '.aws'), join(home, '.claude'), join(root, 'bin'), repo]) mkdirSync(path, { recursive: true })
    mkdirSync(parent, { mode: 0o700 })
    writeFileSync(join(home, '.ssh/id_scratch'), 'scratch ssh key'); writeFileSync(join(home, '.aws/credentials'), 'scratch credentials')
    writeFileSync(join(home, '.claude/.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'scratch-token', refreshToken: 'scratch-refresh', expiresAt: Date.now() + 8 * 3600_000 }, mcpOAuth: { other: { accessToken: 'scratch-mcp' } } }), { mode: 0o600 })
    // The agent stub: a shell, so these attempts are what a compromised agent could run. It takes the place of each CLI.
    for (const name of ['claude', 'codex']) writeFileSync(join(root, 'bin', name), '#!/bin/sh\nexec /bin/sh "$@"\n', { mode: 0o755 })
    git('init', '-q', '-b', 'main'); writeFileSync(join(repo, 'README'), 'repo'); git('add', '.'); git('commit', '-q', '-m', 'first'); git('worktree', 'add', '-q', '-b', 'work', task)
    listener = createServer(socket => socket.end('host service\n')); await new Promise<void>(done => listener.listen(0, '127.0.0.1', done)); listenerPort = (listener.address() as { port: number }).port
    unix = createServer(socket => socket.end('control\n')); await new Promise<void>(done => unix.listen(join(home, 'control.sock'), done))
  })
  afterAll(() => { listener?.close(); unix?.close(); rmSync(root, { recursive: true, force: true }) })

  test('home files, Git metadata and other paths are blocked; the worktree and private home work', async () => {
    const rows = await attempts(`
attempt read-ssh cat "$HOST_HOME/.ssh/id_scratch"
attempt read-other-home-file cat "$HOST_HOME/.aws/credentials"
attempt list-home ls "$HOST_HOME"
attempt read-host-login cat "$HOST_HOME/.claude/.credentials.json"
attempt read-through-data-volume cat "/System/Volumes/Data$HOST_HOME/.ssh/id_scratch"
attempt read-by-inode cat "/.vol/$(stat -f %d "$HOST_HOME/.ssh/id_scratch")/$(stat -f %i "$HOST_HOME/.ssh/id_scratch")"
attempt hardlink-into-worktree ln "$HOST_HOME/.ssh/id_scratch" "$TASK/stolen"
attempt hardlink-readable-into-worktree ln "$REPO/README" "$TASK/linked"
ln -s "$HOST_HOME/.ssh/id_scratch" "$TASK/link" 2>/dev/null
attempt read-through-symlink cat "$TASK/link"
attempt write-home touch "$HOST_HOME/written"
attempt write-shared-tmp touch /private/tmp/shep-mac-escape-written
attempt write-repo touch "$REPO/written"
attempt write-git-pointer sh -c 'echo x >> "$TASK/.git"'
attempt replace-git-pointer mv "$TASK/.git" "$TASK/.git-moved"
attempt move-worktree mv "$TASK" "$HOME/moved-worktree"
attempt write-git-config sh -c 'echo x >> "$REPO/.git/config"'
attempt write-git-hook sh -c 'echo x > "$REPO/.git/hooks/pre-push"'
attempt write-worktree-git-metadata touch "$REPO/.git/worktrees/task/written"
attempt read-worktree cat "$TASK/README"
attempt read-repo cat "$REPO/README"
attempt read-git-metadata cat "$REPO/.git/HEAD"
attempt write-worktree touch "$TASK/written"
attempt write-private-home touch "$HOME/written"
attempt write-private-tmp touch "$TMPDIR/written"
attempt compile-c sh -c 'printf "#include <stdio.h>\nint main(void){return 0;}\n" > "$TMPDIR/c.c" && clang -o "$TMPDIR/c" "$TMPDIR/c.c" && "$TMPDIR/c"'
attempt run-system-tool /usr/bin/uname -s
attempt git-status git -C "$TASK" status --short
`)
    for (const name of ['read-ssh', 'read-other-home-file', 'list-home', 'read-host-login', 'read-through-data-volume', 'read-by-inode', 'hardlink-into-worktree', 'hardlink-readable-into-worktree', 'read-through-symlink', 'write-home', 'write-shared-tmp', 'write-repo', 'write-git-pointer', 'replace-git-pointer', 'move-worktree', 'write-git-config', 'write-git-hook', 'write-worktree-git-metadata']) expect([name, row(rows, name).code === 0]).toEqual([name, false])
    for (const name of ['read-worktree', 'read-repo', 'read-git-metadata', 'write-worktree', 'write-private-home', 'write-private-tmp', 'run-system-tool', 'git-status']) expect([name, row(rows, name).code]).toEqual([name, 0])
    const developer = Bun.spawnSync(['/usr/bin/xcode-select', '-p']).stdout.toString().trim()
    if (['usr/bin/clang', 'Toolchains/XcodeDefault.xctoolchain/usr/bin/clang'].some(path => existsSync(join(developer, path)))) expect([row(rows, 'compile-c').code, row(rows, 'compile-c').out]).toEqual([0, ''])
    expect(existsSync(join(home, 'written'))).toBe(false); expect(existsSync('/private/tmp/shep-mac-escape-written')).toBe(false); expect(existsSync(join(repo, 'written'))).toBe(false)
    expect(existsSync(join(task, 'stolen'))).toBe(false); expect(existsSync(join(task, 'written'))).toBe(true)
    rmSync(join(task, 'written')); rmSync(join(task, 'link'), { force: true })
  }, 60_000)

  test('a read-only coordinator cannot write its project', async () => {
    const rows = await attempts(`
attempt write-project touch "$REPO/written"
attempt read-project cat "$REPO/README"
attempt write-private-home touch "$HOME/written"
`, { cwd: repo, writable: false })
    expect(row(rows, 'write-project').code).not.toBe(0); expect(row(rows, 'read-project').code).toBe(0); expect(row(rows, 'write-private-home').code).toBe(0)
    expect(existsSync(join(repo, 'written'))).toBe(false)
  }, 60_000)

  test('the network leaves only through the gateway, to allowed hosts', async () => {
    const rows = await attempts(`
curl() { /usr/bin/curl -sS -m 8 -o /dev/null "$@"; }
plain() { env -u HTTPS_PROXY -u HTTP_PROXY -u ALL_PROXY -u https_proxy -u http_proxy /usr/bin/curl -sS -m 5 -o /dev/null "$@"; }
attempt direct-internet plain https://example.com/
direct() { "$(command -v python3)" -I -c "
import socket,sys
try: socket.create_connection((sys.argv[1],int(sys.argv[2])),3)
except OSError as e: sys.exit(str(e))" "$@"; }
attempt direct-address direct 1.1.1.1 443
attempt direct-tailscale direct 100.100.100.100 80
attempt direct-private direct 192.168.1.1 80
attempt direct-host-service direct 127.0.0.1 "$LISTENER"
attempt host-not-allowed curl https://example.org/
attempt gateway-private-address curl https://100.100.100.100/
attempt gateway-other-port curl https://example.com:8443/
attempt proxy-port-mail /bin/sh -c 'printf "POST /mail HTTP/1.1\\r\\nHost: x\\r\\nContent-Length: 2\\r\\n\\r\\n{}" | /usr/bin/nc -w 3 127.0.0.1 "\${HTTPS_PROXY##*:}" | grep -q "403 Forbidden" && exit 1; exit 0'
attempt control-socket /usr/bin/nc -w 2 -U "$HOST_HOME/control.sock"
attempt mapped-address-other-port "$(command -v python3)" -I -c "
import os,socket,sys
s=socket.socket(socket.AF_INET6);s.settimeout(3)
try: s.connect(('::ffff:127.0.0.1',int(os.environ['LISTENER'])))
except OSError as e: sys.exit(str(e))"
attempt host-allowed curl https://example.com/
attempt product-command "$SHEPHERDR_COMMAND" status
`)
    for (const name of ['direct-internet', 'direct-address', 'direct-tailscale', 'direct-private', 'direct-host-service', 'host-not-allowed', 'gateway-private-address', 'gateway-other-port', 'proxy-port-mail', 'control-socket', 'mapped-address-other-port']) expect([name, row(rows, name).code === 0]).toEqual([name, false])
    // Blocked for the right reason, not by a timeout or a missing route.
    for (const name of ['direct-address', 'direct-tailscale', 'direct-private', 'direct-host-service', 'mapped-address-other-port']) expect([name, row(rows, name).out]).toEqual([name, expect.stringMatching(/not permitted/i)])
    expect(row(rows, 'direct-internet').out).toMatch(/resolve host|not permitted/i)
    for (const name of ['host-not-allowed', 'gateway-private-address', 'gateway-other-port']) expect([name, row(rows, name).out]).toEqual([name, expect.stringMatching(/\b403\b/)])
    for (const name of ['host-allowed', 'product-command']) expect([name, row(rows, name).code, row(rows, name).out]).toEqual([name, 0, name === 'product-command' ? 'product command reached the gateway' : ''])
  }, 90_000)

  // Skipped without this JDK, the one common install the profile can read.
  const java = '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home/bin/java'
  test.skipIf(!existsSync(java))('a JVM reaches only its own CONNECT port, in IPv4 mode, and never another loopback port', async () => {
    writeFileSync(join(task, 'Reach.java'), 'public class Reach { public static void main(String[] a) throws Exception { new java.net.Socket().connect(new java.net.InetSocketAddress(java.net.InetAddress.getByName(a[0]), Integer.parseInt(a[1])), 4000); } }\n')
    try {
      const rows = await attempts(`
own=\${HTTPS_PROXY##*:}
jvm() { ${java} -XX:-UsePerfData "$@"; }
ipv4=-Djava.net.preferIPv4Stack=true
attempt own-port-default-sockets jvm Reach.java 127.0.0.1 "$own"
attempt own-port-ipv4 jvm $ipv4 Reach.java 127.0.0.1 "$own"
attempt other-port-default-sockets jvm Reach.java 127.0.0.1 "$LISTENER"
attempt other-port-mapped-default-sockets jvm Reach.java ::ffff:127.0.0.1 "$LISTENER"
attempt other-port-ipv4 jvm $ipv4 Reach.java 127.0.0.1 "$LISTENER"
attempt other-port-mapped-ipv4 jvm $ipv4 Reach.java ::ffff:127.0.0.1 "$LISTENER"
`)
      expect(row(rows, 'own-port-ipv4').code).toBe(0) // The JVM itself works here, so the refusals below mean something.
      for (const name of ['own-port-default-sockets', 'other-port-default-sockets', 'other-port-mapped-default-sockets', 'other-port-ipv4', 'other-port-mapped-ipv4']) expect([name, row(rows, name).code === 0]).toEqual([name, false])
      expect(row(rows, 'other-port-mapped-default-sockets').out).toContain('Operation not permitted')
    } finally { rmSync(join(task, 'Reach.java'), { force: true }) }
  }, 90_000)

  test('apps, AppleEvents, launchd, the Keychain and nested sandboxes are out of reach', async () => {
    const before = Bun.spawnSync(['/usr/bin/pgrep', '-x', 'Calculator']).stdout.toString()
    const rows = await attempts(`
attempt open-app /usr/bin/open -a Calculator
attempt open-app-path /usr/bin/open /System/Applications/Calculator.app
attempt apple-events /usr/bin/osascript -e 'tell application "System Events" to get name of first process'
attempt launchd-submit /bin/launchctl submit -l shep.mac.escape.test -- /usr/bin/touch "$HOST_HOME/launchd-written"
attempt launchd-session /bin/launchctl asuser "$(id -u)" /usr/bin/touch "$HOST_HOME/launchd-written"
attempt keychain-search /usr/bin/security find-generic-password -s "Claude Code-credentials"
attempt keychain-list /usr/bin/security list-keychains
attempt pasteboard /usr/bin/pbpaste
attempt nested-sandbox /usr/bin/sandbox-exec -p '(version 1)(allow default)' /usr/bin/true
attempt setuid-tool /usr/bin/sudo -n true
attempt setuid-ps /bin/ps -E -p 1
attempt known-open-process-environment "$(command -v python3)" -I -c 'import ctypes,sys;l=ctypes.CDLL(None);m=(ctypes.c_int*3)(1,49,${process.pid});n=ctypes.c_size_t(1048576);b=ctypes.create_string_buffer(1048576);sys.exit(1 if l.sysctl(m,3,b,ctypes.byref(n),None,0) else 0)'
attempt signal-host kill -0 ${process.pid}
`)
    for (const name of ['open-app', 'open-app-path', 'apple-events', 'launchd-submit', 'launchd-session', 'keychain-search', 'keychain-list', 'pasteboard', 'nested-sandbox', 'setuid-tool', 'setuid-ps', 'signal-host']) expect([name, row(rows, name).code === 0]).toEqual([name, false])
    expect(row(rows, 'setuid-tool').out).not.toContain('password') // sudo itself never got to run.
    // Known open and documented: Seatbelt doesn't stop this read. If it ever fails here, the docs can say so.
    expect(row(rows, 'known-open-process-environment').code).toBe(0)
    expect(Bun.spawnSync(['/usr/bin/pgrep', '-x', 'Calculator']).stdout.toString()).toBe(before)
    expect(existsSync(join(home, 'launchd-written'))).toBe(false)
    expect(Bun.spawnSync(['/bin/launchctl', 'list', 'shep.mac.escape.test'], { stdout: 'ignore', stderr: 'ignore' }).exitCode).not.toBe(0)
  }, 60_000)

  test('another terminal on this Mac is out of reach, and a run’s own stays usable', async () => {
    const seen = join(root, 'victim-tty')
    const victim = Bun.spawn(['/usr/bin/script', '-q', '/dev/null', '/bin/sh', '-c', `tty > ${seen}; exec /bin/sleep 60`], { stdin: Bun.file('/dev/null'), stdout: 'ignore', stderr: 'ignore' })
    try {
      for (let n = 0; n < 100 && !(existsSync(seen) && statSync(seen).size); n++) await Bun.sleep(50)
      const other = readFileSync(seen, 'utf8').trim()
      expect(other).toMatch(/^\/dev\/ttys\d+$/)
      const words = `
attempt() { name=$1; shift; result=$("$@" 2>&1); printf '%s\\t%s\\t%s\\n' "$name" "$?" "$(printf '%s' "$result" | tr '\\n\\t' '  ' | cut -c1-200)" >> "$HOME/attempts.tsv"; }
attempt read-other-terminal sh -c ': < ${other}'
attempt write-other-terminal sh -c 'printf x > ${other}'
attempt new-pseudo-terminal sh -c ': < /dev/ptmx'
attempt list-devices ls /dev
attempt own-terminal sh -c 'test -t 0 && stty size'
attempt write-null sh -c 'printf x > /dev/null'
`
      // script gives this launch a terminal of its own, as a real agent's pane does.
      const child = Bun.spawn(['/usr/bin/script', '-q', '/dev/null', runner, fixture, JSON.stringify({ parent, cwd: task, repo, writable: true, access: 'mac', kind: 'claude', args: ['-c', words], hosts: [] })], { cwd: root, stdin: Bun.file('/dev/null'), stdout: 'pipe', stderr: 'pipe', env: { HOME: home, PATH: `${join(root, 'bin')}:/usr/bin:/bin`, USER: 'tester', TERM: 'xterm-256color' } })
      const text = await new Response(child.stdout).text(); await child.exited
      // script echoes the end of its empty stdin before the launcher's first line.
      const state = (JSON.parse(text.slice(text.indexOf('{"prepared"')).split('\n')[0]!.trim()) as { prepared: { paths: { state: string } } }).prepared.paths.state
      const rows = readFileSync(join(state, 'attempts.tsv'), 'utf8').trim().split('\n').map(line => { const [name, code, ...rest] = line.split('\t'); return { name: name!, code: Number(code), out: rest.join(' ') } })
      for (const name of ['read-other-terminal', 'write-other-terminal', 'new-pseudo-terminal']) expect([name, row(rows, name).code === 0]).toEqual([name, false])
      for (const name of ['own-terminal', 'write-null']) expect([name, row(rows, name).code]).toEqual([name, 0])
    } finally { victim.kill('SIGKILL'); await victim.exited }
  }, 60_000)

  test('artifact reads see only the project and its exports, in a fresh read-only view', async () => {
    const runtime = realpathSync(mkdtempSync(join(parent, 'pilot-')))
    chmodSync(runtime, 0o700); mkdirSync(join(runtime, 'control'), { mode: 0o700 }); mkdirSync(join(runtime, 'captures'), { mode: 0o700 })
    const base = { captures: join(runtime, 'captures'), repo, cwd: task }, read = (path: string) => pilotArtifact({ ...base, op: 'read', path, max: 1024 })
    writeFileSync(join(task, 'page.html'), '<p>page</p>')
    expect(Buffer.from(await read('page.html'), 'base64').toString()).toBe('<p>page</p>')
    const exported = await pilotArtifact({ ...base, op: 'export', name: 'out.html', data: Buffer.from('<p>out</p>').toString('base64') })
    expect(exported.startsWith(join(runtime, 'control/artifacts/'))).toBe(true)
    expect(Buffer.from(await read(exported), 'base64').toString()).toBe('<p>out</p>')
    symlinkSync(join(home, '.ssh/id_scratch'), join(task, 'page-link'))
    expect(read('page-link')).rejects.toThrow(); expect(read(join(home, '.ssh/id_scratch'))).rejects.toThrow()
    linkSync(join(task, 'page.html'), join(task, 'page-hard'))
    expect(read('page.html')).rejects.toThrow('unshared')
    for (const name of ['page.html', 'page-link', 'page-hard']) rmSync(join(task, name))
  }, 60_000)

  // A classic double fork: new session, parent gone, every descriptor closed.
  const DOUBLE_FORK = `python=$(command -v python3); "$python" -I -c '
import os
if os.fork() == 0:
    os.setsid()
    if os.fork() == 0:
        pid = os.getpid()
        fd = os.open(os.environ["HOME"] + "/daemon.pid", os.O_WRONLY | os.O_CREAT)
        os.write(fd, str(pid).encode()); os.close(fd)
        for n in range(256):
            try: os.close(n)
            except OSError: pass
        os.execv("/bin/sleep", ["sleep", "600"])
    os._exit(0)
'`
  async function untilFile(path: string) { for (let n = 0; n < 200; n++) { if (existsSync(path) && statSync(path).size) return Number(readFileSync(path, 'utf8')); await Bun.sleep(50) } throw Error('The daemon never started') }
  const startDaemon = async (extra: { deadline?: number } = {}) => {
    const child = launch({ args: ['-c', `${DOUBLE_FORK}\nexec /bin/sleep 600`], ...extra }), reader = child.stdout.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    const prepared = JSON.parse(first.split('\n')[0]!).prepared as { paths: { state: string }; mac: { marker: { allowed: string; denied: string } } }
    const pid = await untilFile(join(prepared.paths.state, 'daemon.pid'))
    return { child, pid, marker: prepared.mac.marker, state: prepared.paths.state }
  }
  async function gone(pid: number, marker: { allowed: string; denied: string }) { for (let n = 0; n < 200 && (alive(pid) || pilotMacProcesses(marker).length); n++) await Bun.sleep(50); return !alive(pid) && !pilotMacProcesses(marker).length }

  test('turning off ends a detached daemon', async () => {
    const { child, pid, marker } = await startDaemon()
    expect(alive(pid)).toBe(true); expect(pilotMacProcesses(marker)).toContain(pid)
    child.kill('SIGTERM'); await child.exited
    expect(await gone(pid, marker)).toBe(true)
  }, 60_000)

  test('a crash of the wrapper ends a detached daemon', async () => {
    const { child, pid, marker, state } = await startDaemon(), login = join(state, '.claude/.credentials.json')
    expect(alive(pid)).toBe(true); expect(existsSync(login)).toBe(true)
    child.kill('SIGKILL'); await child.exited
    expect(await gone(pid, marker)).toBe(true)
    // The wrapper that would remove its access token is gone, so the watcher does.
    for (let n = 0; n < 100 && existsSync(login); n++) await Bun.sleep(50)
    expect(existsSync(login)).toBe(false)
  }, 60_000)

  test('losing the watcher stops the run, as nothing would enforce its deadline or a crash', async () => {
    const { child, pid, marker } = await startDaemon()
    const watcher = Number(Bun.spawnSync(['/usr/bin/pgrep', '-f', marker.allowed]).stdout.toString().trim().split('\n')[0])
    expect(watcher).toBeGreaterThan(1)
    process.kill(watcher, 'SIGKILL'); await child.exited
    expect(await gone(pid, marker)).toBe(true)
  }, 60_000)

  test('a process the sweep cannot see counts as not stoppable, so the run is refused', async () => {
    const allowed = join(root, 'visible-allowed'), denied = join(root, 'visible-denied'); writeFileSync(allowed, ''); writeFileSync(denied, '')
    const outside = Bun.spawn(['/bin/sleep', '30'])
    expect(await pilotMacVisible({ allowed, denied }, outside, 200)).toBe(false)
    outside.kill('SIGKILL'); await outside.exited
    expect(await pilotMacVisible({ allowed, denied }, outside)).toBe(true) // Already gone: nothing to stop.
  }, 30_000)

  test('a quarantined Codex helper is refused by name, with what clears it; an approved one is not', async () => {
    const helper = join(root, 'bin/codex-code-mode-host'); writeFileSync(helper, '', { mode: 0o755 })
    const flag = (word: string) => expect(Bun.spawnSync(['/usr/bin/xattr', '-w', 'com.apple.quarantine', `${word};6abe515b;;`, helper]).exitCode).toBe(0)
    try {
      expect(pilotMacQuarantined(helper)).toBe(false) // Not quarantined at all.
      flag('03c1'); expect(pilotMacQuarantined(helper)).toBe(false)
      flag('0381'); expect(pilotMacQuarantined(helper)).toBe(true)
      const child = launch({ args: ['-c', 'exit 0'], kind: 'codex' })
      const [out, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
      expect(code).not.toBe(0)
      expect(out).toContain(`xattr -d com.apple.quarantine ${helper}`)
    } finally { rmSync(helper, { force: true }) }
  }, 30_000)

  test('a connected Mac: the helper folder Shepherdr provisions there runs a contained launch', async () => {
    // Everything but the transport: the real provisioning writes the real folder, and the fixture beside it imports only from it.
    const machine = join(root, 'connected'); mkdirSync(machine)
    const files = { exec: async (_machine: string, argv: string[], _cwd?: string, input?: Uint8Array) => {
      if (argv[0] === 'sh') return Buffer.from(runner)
      if (argv[2]?.startsWith('const o=require')) return Buffer.from(JSON.stringify({ home: machine, bun: runner, hc: '/core/hc', path: '/core', version: 'hc 0.1.14', session: 'isolated', environment: {}, platform: process.platform, arch: process.arch, musl: false }))
      if (argv[2]?.startsWith('const {CoreClient}')) return Buffer.from('identity verified')
      const result = Bun.spawnSync(argv, { stdin: input ?? 'ignore' })
      if (result.exitCode) throw Error(result.stderr.toString())
      return result.stdout
    } } as unknown as CoreFiles
    const provisioned = await new CoreRemotes(files, 'installation', () => ({ version: '0.1.14' })).prepare('machine')
    expect(provisioned.root.startsWith(join(machine, '.local/share/shepherdr-agents/installation/'))).toBe(true)
    const sessions = join(provisioned.root, 'sessions'), beside = join(provisioned.root, 'test/core-pilot-mac-escape.fixture.ts')
    mkdirSync(sessions, { recursive: true, mode: 0o700 }); mkdirSync(join(provisioned.root, 'test')); copyFileSync(fixture, beside)
    const rows = await attempts(`
attempt read-worktree cat "$TASK/README"
attempt write-worktree touch "$TASK/from-connected"
attempt product-command "$SHEPHERDR_COMMAND" status
attempt write-helpers touch ${JSON.stringify(join(provisioned.root, 'helper/planted.ts'))}
attempt read-other-sessions ls ${JSON.stringify(parent)}
`, { fixture: beside, parent: sessions })
    for (const name of ['read-worktree', 'write-worktree', 'product-command']) expect([name, row(rows, name).code, row(rows, name).out]).toEqual([name, 0, name === 'read-worktree' ? 'repo' : name === 'product-command' ? 'product command reached the gateway' : ''])
    for (const name of ['write-helpers', 'read-other-sessions']) expect([name, row(rows, name).code === 0]).toEqual([name, false])
  }, 90_000)

  test('the shared deadline ends a detached daemon', async () => {
    const { child, pid, marker } = await startDaemon({ deadline: Date.now() + 4000 })
    expect(alive(pid)).toBe(true)
    await child.exited
    expect(await gone(pid, marker)).toBe(true)
  }, 60_000)

  test('a lost marker refuses the sweep rather than matching every process', async () => {
    const marker = join(root, 'marker-present'); writeFileSync(marker, '')
    for (const lost of [{ allowed: marker, denied: join(root, 'marker-missing') }, { allowed: join(root, 'marker-missing'), denied: marker }]) {
      expect(() => pilotMacProcesses(lost)).toThrow(); expect(pilotMacSweep(lost)).rejects.toThrow()
    }
    // Both markers exist and nothing is in the profile that denies them, so an unsandboxed process never matches.
    const other = join(root, 'marker-other'); writeFileSync(other, '')
    expect(pilotMacProcesses({ allowed: marker, denied: other })).toEqual([])
    expect(alive(process.pid)).toBe(true)
  }, 60_000)

  test('a bunfig.toml the agent plants in its worktree runs nothing outside the sandbox', async () => {
    const marker = join(root, 'preload-ran-outside')
    writeFileSync(join(task, 'bunfig.toml'), 'preload = ["./planted.ts"]\n')
    writeFileSync(join(task, 'planted.ts'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')\n`)
    try {
      // The plant works: a host Bun started in the worktree runs it. That start is what agents.ts must never make.
      const control = Bun.spawn([runner, '-e', '0'], { cwd: task, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', env: { HOME: home, PATH: '/usr/bin:/bin' } })
      await control.exited
      expect(existsSync(marker)).toBe(true); rmSync(marker)
      // The real start: the terminal in the worktree, host Bun moved out first, as agents.ts does it.
      const config = JSON.stringify({ parent, cwd: task, repo, writable: true, access: 'mac', kind: 'claude', args: ['-c', 'exit 0'], hosts: [] })
      const child = Bun.spawn(['/bin/sh', '-c', 'cd "$0" && exec "$@"', parent, runner, fixture, config], { cwd: task, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', env: { HOME: home, PATH: `${join(root, 'bin')}:/usr/bin:/bin`, USER: 'tester' } })
      await child.exited
      expect(existsSync(marker)).toBe(false)
    } finally { for (const name of ['bunfig.toml', 'planted.ts']) rmSync(join(task, name), { force: true }); rmSync(marker, { force: true }) }
  }, 60_000)

  test('the watcher alone enforces the shared deadline, with its owner still alive', async () => {
    const allowed = join(root, 'deadline-allowed'), denied = join(root, 'deadline-denied')
    for (const path of [allowed, denied]) writeFileSync(path, '')
    const profile = `(version 1)(deny default)(allow process-fork)(allow process-exec)(allow file-map-executable)(allow file-read-metadata)(allow file-read* (subpath "/usr") (subpath "/bin") (subpath "/System/Library") (subpath "/System/Cryptexes") (subpath "/System/Volumes/Preboot") (literal "/") (literal ${JSON.stringify(allowed)}))(allow sysctl-read)`
    const held = Bun.spawn(['/usr/bin/sandbox-exec', '-p', profile, '/bin/sleep', '60'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
    for (let n = 0; n < 100 && !pilotMacProcesses({ allowed, denied }).length; n++) await Bun.sleep(20)
    expect(pilotMacProcesses({ allowed, denied })).toContain(held.pid)
    const watcher = Bun.spawn([runner, join(import.meta.dir, '../helper/core-pilot-mac-stop.ts'), allowed, denied, String(Date.now() + 1000)], { cwd: root, stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' })
    try {
      expect(alive(held.pid)).toBe(true)
      await held.exited // Only the watcher's deadline can end this. Its stdin stays open, so its owner looks alive.
      expect(watcher.exitCode).toBeNull()
    } finally { await watcher.stdin.end(); await watcher.exited }
  }, 30_000)

  test('a process that keeps forking to dodge the sweep is still caught', async () => {
    const hop = `"$(command -v python3)" -I -c '
import os,time
if os.fork() == 0:
    os.setsid()
    fd = os.open(os.environ["HOME"] + "/daemon.pid", os.O_WRONLY | os.O_CREAT); os.write(fd, b"1"); os.close(fd)
    for n in range(256):
        try: os.close(n)
        except OSError: pass
    while True:
        if os.fork(): os._exit(0)
        os.setsid()
        time.sleep(0.001)
' 2>/dev/null &
exec /bin/sleep 600`
    const child = launch({ args: ['-c', hop] }), reader = child.stdout.getReader()
    const prepared = JSON.parse(new TextDecoder().decode((await reader.read()).value).split('\n')[0]!).prepared as { paths: { state: string }; mac: { marker: { allowed: string; denied: string } } }
    await untilFile(join(prepared.paths.state, 'daemon.pid'))
    expect(pilotMacProcesses(prepared.mac.marker).length).toBeGreaterThan(0)
    child.kill('SIGTERM'); await child.exited
    let clear = false
    for (let n = 0; n < 400 && !clear; n++) { clear = !pilotMacProcesses(prepared.mac.marker).length && (await Bun.sleep(50), !pilotMacProcesses(prepared.mac.marker).length); await Bun.sleep(25) }
    expect(clear).toBe(true)
  }, 60_000)

  test('another run on this Mac is left alone', async () => {
    const one = await startDaemon(), two = await startDaemon()
    expect(pilotMacProcesses(two.marker)).not.toContain(one.pid)
    two.child.kill('SIGTERM'); await two.child.exited
    expect(await gone(two.pid, two.marker)).toBe(true)
    expect(alive(one.pid)).toBe(true)
    one.child.kill('SIGTERM'); await one.child.exited
    expect(await gone(one.pid, one.marker)).toBe(true)
  }, 60_000)

  test('the sandbox holds only the live access token, sealed from the agent', async () => {
    const rows = await attempts(`
attempt read-login cat "$CLAUDE_CONFIG_DIR/.credentials.json"
attempt replace-login sh -c 'echo x > "$CLAUDE_CONFIG_DIR/.credentials.json"'
attempt remove-login rm -f "$CLAUDE_CONFIG_DIR/.credentials.json"
attempt repoint-login-folder mv "$CLAUDE_CONFIG_DIR" "$HOME/moved"
attempt plant-next-file sh -c 'ln -s "$HOST_HOME/written" "$CLAUDE_CONFIG_DIR/.credentials.json.next"'
attempt write-login-folder touch "$CLAUDE_CONFIG_DIR/ordinary-file"
`)
    const login = JSON.parse(row(rows, 'read-login').out) as { claudeAiOauth: Record<string, unknown>; mcpOAuth?: unknown }
    expect(login.claudeAiOauth.accessToken).toBe('scratch-token'); expect(login.claudeAiOauth.refreshToken).toBeNull(); expect(login.mcpOAuth).toBeUndefined()
    for (const name of ['replace-login', 'remove-login', 'repoint-login-folder', 'plant-next-file']) expect([name, row(rows, name).code === 0]).toEqual([name, false])
    expect(row(rows, 'write-login-folder').code).toBe(0)
  }, 60_000)
})
