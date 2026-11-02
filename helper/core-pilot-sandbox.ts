// Pure containment preparation helpers. Importing this file never reads app/live state or starts a process.
import { existsSync, lstatSync, readdirSync, realpathSync, readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { basename, dirname, join, relative, resolve } from 'node:path'

/** Conservative public unicast destinations only. The gateway must check every DNS answer and connect by that IP. */
export function pilotPublicAddress(ip: string) {
  if (ip.includes('%')) return false
  if (isIP(ip) === 6) {
    const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1).toLowerCase()
    const [first, second = '0'] = canonical.split(':').map(value => value || '0')
    return /^[23]/.test(first) && first !== '2002' && first !== '3fff' && !(first === '2001' && (parseInt(second, 16) <= 0x1ff || second === 'db8'))
  }
  if (isIP(ip) !== 4) return false
  const [a, b, c] = ip.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
    a === 100 && b >= 64 && b <= 127 || a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) ||
    a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113 || a >= 224)
}

/** Keep provider configuration, never hooks, MCP, plugins, shell helpers or arbitrary host paths. */
export function pilotProviderConfig(kind: 'claude' | 'codex', text: string) {
  if (kind === 'claude') {
    const input = JSON.parse(text) as { env?: Record<string, unknown> }
    const allowed = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL']
    return JSON.stringify({ env: Object.fromEntries(Object.entries(input.env ?? {}).filter(([key, value]) => allowed.includes(key) && typeof value === 'string')) })
  }
  const input = Bun.TOML.parse(text) as Record<string, unknown>, out: Record<string, unknown> = {}
  for (const key of ['model_provider', 'model', 'model_reasoning_effort', 'forced_login_method', 'openai_base_url']) if (typeof input[key] === 'string') out[key] = input[key]
  const providers = input.model_providers as Record<string, Record<string, unknown>> | undefined
  const selected = typeof input.model_provider === 'string' ? input.model_provider : 'openai'
  if (providers?.[selected] && typeof providers[selected] === 'object') {
    const allowed = ['name', 'base_url', 'env_key', 'env_key_instructions', 'wire_api', 'requires_openai_auth', 'http_headers', 'env_http_headers', 'query_params', 'request_max_retries', 'stream_max_retries', 'stream_idle_timeout_ms', 'experimental_bearer_token']
    out.model_providers = { [selected]: Object.fromEntries(Object.entries(providers[selected]).filter(([key]) => allowed.includes(key))) }
  }
  const toml = (value: unknown): string => Array.isArray(value) ? `[${value.map(toml).join(', ')}]` : value && typeof value === 'object' ? `{ ${Object.entries(value).filter(([, item]) => item !== undefined && item !== null).map(([key, item]) => `${JSON.stringify(key)} = ${toml(item)}`).join(', ')} }` : JSON.stringify(value)
  return Object.entries(out).map(([key, value]) => `${key} = ${toml(value)}`).join('\n') + '\n[features]\napps = false\nplugins = false\n'
}

/** A project may hold a host Unix socket or FIFO even when mounted read-only. Mask these; reject shared writable files. */
export function pilotProjectFiles(roots: { path: string; writable: boolean }[]) {
  const masks = new Set<string>(), seen = new Map<string, boolean>()
  let entries = 0
  const scan = (path: string, writable: boolean) => {
    if (++entries > 200_000) throw Error('The isolated workspace is too large to inspect safely')
    if (seen.get(path) === true || seen.has(path) && !writable) return
    seen.set(path, writable)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return // Never follow an agent-controlled link into host files.
    if (stat.isDirectory()) { for (const entry of readdirSync(path)) scan(join(path, entry), writable && entry !== '.git'); return }
    if (!stat.isFile()) { masks.add(path); if (masks.size > 1000) throw Error('The project contains too many special files to isolate'); return }
    if (writable && stat.nlink > 1) throw Error('The workspace contains shared hardlinks; copy those files before isolated Autopilot')
  }
  for (const root of roots) scan(root.path, root.writable)
  return [...masks]
}
export interface PilotSandbox {
  cwd: string; repo: string; home: string; state: string; control: string; binary: string; bun: string
  kind: 'claude' | 'codex'; writable: boolean; privateRoots: string[]
}
export function pilotSandboxArgs(input: PilotSandbox) {
  const real = (path: string) => { const actual = realpathSync(path); if (actual !== resolve(path) || actual === '/') throw Error('Use a real private sandbox path'); return actual }
  const cwd = real(input.cwd), repo = real(input.repo), state = real(input.state), control = real(input.control)
  for (const path of [state, control]) { const stat = lstatSync(path); if (!stat.isDirectory() || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid()) throw Error('Sandbox state and control must be private owned directories') }
  const git = pilotGitPaths(repo, cwd)
  const overlaps = (a: string, b: string) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/')
  for (const project of [repo, cwd, ...git]) {
    if (project === resolve(input.home) || resolve(input.home).startsWith(project + '/') || [state, control, ...input.privateRoots].some(path => overlaps(project, resolve(path)))) throw Error('The project or Git mount overlaps protected host state')
  }
  if (input.writable && cwd === repo) throw Error('An isolated worker needs its own worktree')
  if (state === control || state.startsWith(control + '/') || control.startsWith(state + '/')) throw Error('Keep sandbox control outside its writable home')
  const home = resolve(input.home)
  if (home === '/' || !['claude', 'codex'].includes(input.kind)) throw Error('Invalid sandbox home or adapter')
  const args = ['--die-with-parent', '--new-session', '--unshare-all', '--cap-drop', 'ALL', '--clearenv']
  for (const path of ['/usr', '/bin', '/lib', '/lib64']) if (existsSync(path)) args.push('--ro-bind', path, path)
  args.push('--dir', '/etc')
  for (const path of ['/etc/ssl', '/etc/pki', '/etc/ca-certificates', '/etc/nsswitch.conf', '/etc/passwd', '/etc/group', '/etc/hosts', '/etc/resolv.conf']) if (existsSync(path)) args.push('--ro-bind', path, path)
  args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/run', '--dir', '/run/shepherdr')
  // No host home, core socket, agent credential or app state is ever mounted.
  args.push('--bind', state, home, '--ro-bind', control, '/run/shepherdr')
  if (repo !== cwd) args.push('--ro-bind', repo, repo)
  args.push(input.writable ? '--bind' : '--ro-bind', cwd, cwd)
  for (const path of [...new Set(git)].sort((a, b) => a.length - b.length)) args.push('--ro-bind', real(path), path)
  const masks = pilotProjectFiles([{ path: repo, writable: false }, { path: cwd, writable: input.writable }, ...git.map(path => ({ path, writable: false }))])
  for (const path of masks) {
    if (![repo, cwd, ...git].some(root => path.startsWith(root + '/'))) throw Error('Special-file mask is outside the project')
    args.push('--ro-bind', '/dev/null', path)
  }
  args.push('--ro-bind', realpathSync(input.bun), '/run/shepherdr/bun', '--ro-bind', realpathSync(input.binary), `/run/shepherdr/${input.kind}`)
  // Codex 0.163 ships its code-mode host beside the native CLI and resolves it beside its own executable.
  const companion = join(dirname(realpathSync(input.binary)), 'codex-code-mode-host')
  if (input.kind === 'codex' && existsSync(companion)) {
    if (!lstatSync(realpathSync(companion)).isFile()) throw Error('Codex code-mode companion is not a regular executable')
    args.push('--ro-bind', realpathSync(companion), '/run/shepherdr/codex-code-mode-host')
  }
  for (const [key, value] of Object.entries({ HOME: home, USER: 'agent', TERM: 'xterm-256color', PATH: '/run/shepherdr/bin:/usr/bin:/bin', NODE_USE_ENV_PROXY: '1',
    SHEPHERDR_COMMAND: '/run/shepherdr/bin/shepherdr', CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude') })) args.push('--setenv', key, value)
  args.push('--chdir', cwd, '/run/shepherdr/bun', '/run/shepherdr/bootstrap.ts', `/run/shepherdr/${input.kind}`)
  return args
}

/** Enumerate only Git-owned metadata paths, to override a writable worktree mount with read-only Git mounts. */
export function pilotGitPaths(repo: string, cwd: string) {
  const paths = new Set<string>()
  const plain = (path: string) => {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('Invalid worktree Git metadata')
    return readFileSync(path, 'utf8').trim()
  }
  const metadata = (root: string) => {
    const dot = join(root, '.git')
    if (!existsSync(dot) || lstatSync(dot).isSymbolicLink()) throw Error('Git metadata must be a real file or directory')
    paths.add(dot)
    if (lstatSync(dot).isDirectory()) return realpathSync(dot)
    const text = plain(dot)
    if (!text.startsWith('gitdir: ')) throw Error('Invalid worktree Git metadata')
    const dir = realpathSync(resolve(root, text.slice(8).trim()))
    const common = realpathSync(resolve(dir, plain(join(dir, 'commondir'))))
    // A project pointer is not authority to mount an arbitrary host directory. Standard
    // linked worktrees live directly in their repo's .git/worktrees and point back here.
    if (basename(common) !== '.git' || !/^worktrees\/[^/]+$/.test(relative(common, dir)) ||
      resolve(dir, plain(join(dir, 'gitdir'))) !== dot) throw Error('Git pointers do not belong to this repository worktree')
    paths.add(dir); paths.add(common)
    return common
  }
  const common = metadata(repo)
  if (metadata(cwd) !== common) throw Error('The worker Git metadata belongs to another repository')
  for (const name of ['objects', 'refs']) {
    const stat = lstatSync(join(common, name))
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Invalid repository Git metadata root')
  }
  return [...paths]
}
