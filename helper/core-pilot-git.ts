// Stateless checked repository broker, invoked only through core machine.exec. Never mounted into a runtime.
import { lstatSync, realpathSync, readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pilotConfigPath } from './core-pilot-path.ts'
import { pilotGitPaths } from './core-pilot-sandbox.ts'

const within = (path: string, root: string) => path === root || path.startsWith(root + '/')
const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`

export { pilotConfigPath } from './core-pilot-path.ts'

export function pilotGitOptions(keys: string[], gh?: string, ssh?: string) {
  const options: string[] = [], set = (key: string, value: string) => options.push('-c', `${key}=${value}`)
  for (const [key, value] of Object.entries({
    'core.hooksPath': '/dev/null', 'core.fsmonitor': 'false', 'core.editor': 'false', 'sequence.editor': 'false',
    'core.gitProxy': '', 'core.alternateRefsCommand': 'false', 'core.attributesFile': '/dev/null',
    'commit.gpgSign': 'false', 'tag.gpgSign': 'false', 'push.gpgSign': 'false', 'log.showSignature': 'false',
    'merge.verifySignatures': 'false', 'merge.autoStash': 'false', 'merge.default': 'text',
    'gc.auto': '0', 'maintenance.auto': 'false', 'fetch.writeCommitGraph': 'false',
    'submodule.recurse': 'false', 'fetch.recurseSubmodules': 'false', 'push.recurseSubmodules': 'no',
    'protocol.allow': 'never', 'protocol.http.allow': 'always', 'protocol.https.allow': 'always', 'protocol.file.allow': 'always',
    'protocol.ssh.allow': ssh ? 'always' : 'never', 'protocol.ext.allow': 'never', 'diff.external': 'false', 'uploadpack.packObjectsHook': '',
  })) set(key, value)
  set('credential.helper', '')
  if (gh) set('credential.helper', `!${quote(gh)} auth git-credential`)
  // Only the fixed private wrapper can reach SSH; workspace configuration cannot choose a host command.
  set('core.sshCommand', ssh || 'false')
  if (ssh) set('ssh.variant', 'ssh')
  const filters = new Set<string>(), merges = new Set<string>()
  for (const key of keys) {
    if (/^filter\..+\.(clean|smudge|process|required)$/i.test(key)) filters.add(key.replace(/\.[^.]+$/, ''))
    if (/^merge\..+\.driver$/i.test(key)) merges.add(key.replace(/\.driver$/i, ''))
    if (/^diff\..+\.(command|textconv)$/i.test(key)) set(key, 'false')
  }
  for (const filter of filters) for (const field of ['clean', 'smudge', 'process', 'required']) set(`${filter}.${field}`, field === 'required' ? 'false' : '')
  for (const merge of merges) { set(`${merge}.driver`, 'false'); set(`${merge}.recursive`, 'binary') }
  return options
}

function environment(): Record<string, string | undefined> {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^(GIT_|HC_|SHEPHERDR_)/.test(key) || ['GH_DEBUG', 'GH_EDITOR', 'GH_BROWSER', 'GIT_EDITOR', 'BROWSER', 'SSH_ASKPASS'].includes(key)) delete env[key]
  return { ...env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GIT_PAGER: 'cat', GIT_EDITOR: 'false', GIT_SEQUENCE_EDITOR: 'false' }
}
async function execute(argv: string[], cwd: string, env: Record<string, string | undefined>, limit: number, timeout: number, stdin?: string) {
  const child = Bun.spawn(argv, { cwd, env, stdin: stdin === undefined ? 'ignore' : Buffer.from(stdin), stdout: 'pipe', stderr: 'pipe', detached: true })
  let exceeded = false, timedOut = false
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
  const timer = setTimeout(() => { timedOut = true; kill() }, timeout)
  const collect = async (stream: ReadableStream<Uint8Array>, max: number) => {
    const reader = stream.getReader(), parts: Uint8Array[] = []; let size = 0
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > max) { exceeded = true; kill(); throw Error('Git broker output exceeded its limit') } parts.push(part.value) }
    return Buffer.concat(parts)
  }
  try {
    const [stdout, stderr, code] = await Promise.all([collect(child.stdout, limit), collect(child.stderr, 64 * 1024), child.exited])
    if (timedOut || exceeded) throw Error('Git broker command timed out or exceeded its limit')
    return { code, stdout, stderr }
  } finally { clearTimeout(timer); if (exceeded || timedOut) kill() }
}
export interface PilotGitCommand {
  repo: string; cwd: string; args: string[]; writableRoots: string[]; tool?: 'git' | 'gh'; stdin?: string; timeout?: number; literal?: boolean; host?: string
}

export async function pilotGitCommand(input: PilotGitCommand) {
  if (!input || !['git', 'gh'].includes(input.tool ?? 'git') || !Array.isArray(input.args) || input.args.length > 512 || !input.args.length || input.args.some(word => typeof word !== 'string' || word.includes('\0')) || input.args[0].startsWith('-') || !Array.isArray(input.writableRoots) || input.writableRoots.length > 8192 || input.writableRoots.some(root => typeof root !== 'string' || !isAbsolute(root) || resolve(root) === '/') || input.stdin !== undefined && (typeof input.stdin !== 'string' || Buffer.byteLength(input.stdin) > 1024 * 1024)) throw Error('Invalid checked repository command')
  if (input.literal !== undefined && typeof input.literal !== 'boolean' || input.host !== undefined && (typeof input.host !== 'string' || !/^[a-zA-Z0-9.-]{1,253}$/.test(input.host))) throw Error('Invalid repository command environment')
  if (input.timeout !== undefined && (!Number.isSafeInteger(input.timeout) || input.timeout < 1 || input.timeout > 600_000)) throw Error('Invalid checked repository timeout')
  const repo = realpathSync(input.repo), cwd = realpathSync(input.cwd)
  if (repo !== resolve(input.repo) || cwd !== resolve(input.cwd)) throw Error('Use real repository and worktree paths')
  const metadata = pilotGitPaths(repo, cwd).map(path => realpathSync(path)), writable = input.writableRoots.map(root => pilotConfigPath(root))
  const mutable = (path: string) => writable.some(root => within(path, root)) && !metadata.some(root => within(path, root))
  const validatePath = (path: string) => { if (mutable(resolve(path)) || mutable(pilotConfigPath(path))) throw Error('Git configuration may not come from a writable contained workspace or provider home') }
  const program = (name: string, required = true) => {
    const found = Bun.which(name)
    if (!found) { if (required) throw Error(`Install ${name} for checked repository commands`); return undefined }
    const path = realpathSync(found)
    if (mutable(path)) throw Error('Repository tools may not come from a writable contained workspace')
    return path
  }
  const git = program('git')!, gh = program('gh', input.tool === 'gh'), env = environment()
  env.PATH = (env.PATH || '').split(':').filter(path => isAbsolute(path) && !mutable(pilotConfigPath(path))).join(':')
  const dot = join(cwd, '.git')
  const gitDir = lstatSync(dot).isDirectory() ? realpathSync(dot) : realpathSync(resolve(cwd, readFileSync(dot, 'utf8').trim().slice('gitdir: '.length)))
  env.GIT_DIR = gitDir
  env.GIT_WORK_TREE = cwd
  if (input.literal) env.GIT_LITERAL_PATHSPECS = '1'
  if (input.host) env.GH_HOST = input.host
  const version = await execute([git, '--version'], cwd, env, 4096, 5000)
  const match = version.stdout.toString('utf8').match(/git version (\d+)\.(\d+)/)
  if (version.code !== 0 || !match || Number(match[1]) < 2 || Number(match[1]) === 2 && Number(match[2]) < 36) throw Error('Checked repository commands require Git 2.36 or newer')
  const query = async (args: string[], allowMissing = false) => {
    const result = await execute([git, '--no-pager', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'config', ...args], cwd, env, 2 * 1024 * 1024, 5000)
    if (result.code !== 0 && !(allowMissing && result.code === 1 && !result.stdout.length)) throw Error('Cannot inspect effective Git configuration safely')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout)
    if (!text) return []
    if (!text.endsWith('\0')) throw Error('Incomplete Git configuration response')
    const fields = text.slice(0, -1).split('\0')
    if (fields.length % 2) throw Error('Invalid Git configuration response')
    const rows: [string, string][] = []
    for (let n = 0; n < fields.length; n += 2) rows.push([fields[n], fields[n + 1]])
    return rows
  }
  const rows = await query(['--null', '--show-origin', '--name-only', '--list']), keys = rows.map(([, key]) => key)
  const pending: string[] = [], seen = new Set<string>()
  const inspectOrigin = (origin: string) => {
    if (!origin.startsWith('file:')) return
    const path = resolve(cwd, origin.slice(5))
    validatePath(path); pending.push(path)
  }
  for (const [origin] of rows) inspectOrigin(origin)
  // Inspect inactive conditional includes too: another branch/worktree may activate their callbacks.
  while (pending.length) {
    const path = pending.pop()!, canonical = pilotConfigPath(path)
    validatePath(path)
    if (seen.has(canonical)) continue
    seen.add(canonical)
    if (seen.size > 1024) throw Error('Too many Git configuration files')
    if (!existsSync(path)) continue
    const prefix = ['--file', path, '--no-includes']
    const declarations = await query([...prefix, '--null', '--show-origin', '--name-only', '--list'])
    if (keys.length + declarations.length > 32768) throw Error('Too many Git configuration keys')
    keys.push(...declarations.map(([, key]) => key))
    // Remote program settings are first-wins in Git. A later -c is not a security override.
    for (const key of new Set(declarations.map(([, key]) => key).filter(key => /^remote\..+\.(?:vcs|uploadpack|receivepack)$/i.test(key)))) {
      for (const [, value] of await query([...prefix, '--null', '--show-origin', '--get-all', key], true)) {
        const expected = /\.uploadpack$/i.test(key) ? 'git-upload-pack' : /\.receivepack$/i.test(key) ? 'git-receive-pack' : ''
        if (value !== expected) throw Error('Custom Git remote programs are not permitted for a contained repository; use the standard Git transport')
      }
    }
    for (const key of new Set(declarations.map(([, key]) => key).filter(key => /^include\.path$|^includeif\..+\.path$/i.test(key)))) {
      for (const [origin, target] of await query([...prefix, '--null', '--show-origin', '--get-all', key], true)) {
        if (!origin.startsWith('file:') || /%\(|^~[^/]/.test(target)) throw Error('Unsupported Git include path in the isolated permission profile')
        const included = target.startsWith('~/') ? join(process.env.HOME || '', target.slice(2)) : resolve(dirname(path), target)
        validatePath(included); pending.push(included)
      }
    }
  }
  const sshRoot = mkdtempSync(join(tmpdir(), 'shep-git-ssh-request-'))
  try {
    validatePath(sshRoot)
    const request = join(sshRoot, 'request.json'), helper = join(import.meta.dir, 'core-pilot-ssh.ts')
    validatePath(helper); validatePath(realpathSync(process.execPath))
    writeFileSync(request, JSON.stringify({ cwd, writableRoots: writable }), { mode: 0o600, flag: 'wx' })
    const ssh = `${quote(realpathSync(process.execPath))} ${quote(helper)} ${quote(request)}`
    const options = pilotGitOptions(keys, gh, ssh)
    // gh may invoke Git internally. Runtime configuration also applies to those subprocesses.
    const pairs = options.filter((_, n) => n % 2).map(value => { const split = value.indexOf('='); return [value.slice(0, split), value.slice(split + 1)] })
    const guarded = { ...env, GIT_SSH_COMMAND: ssh, GIT_CONFIG_COUNT: String(pairs.length) } as Record<string, string | undefined>
    for (let n = 0; n < pairs.length; n++) { guarded[`GIT_CONFIG_KEY_${n}`] = pairs[n][0]; guarded[`GIT_CONFIG_VALUE_${n}`] = pairs[n][1] }
    const result = await execute(input.tool === 'gh' ? [gh!, ...input.args] : [git, '--no-pager', ...options, ...input.args], cwd, guarded, 8 * 1024 * 1024, input.timeout ?? 30_000, input.stdin)
    if (result.code !== 0) throw Error(result.stderr.toString('utf8').slice(0, 4000) || `Repository command exited ${result.code}`)
    return result.stdout
  } finally { rmSync(sshRoot, { recursive: true, force: true }) }
}

if (import.meta.main) {
  try {
    const chunks: Buffer[] = []; let size = 0
    for await (const part of process.stdin) { const bytes = Buffer.from(part); size += bytes.length; if (size > 4 * 1024 * 1024) throw Error('Checked repository input is too large'); chunks.push(bytes) }
    process.stdout.write(await pilotGitCommand(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
  } catch (error) { console.error((error as Error).message); process.exitCode = 1 }
}
