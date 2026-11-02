// Stateless native worktree reader. Executed through documented core machine.exec; no listener or worker.
import { AsyncLocalStorage } from 'node:async_hooks'
import { isAbsolute, join, relative, sep } from 'node:path'
import { lstatSync, realpathSync, statSync, openSync, closeSync, readSync, fstatSync, constants } from 'node:fs'
import type { Diff, DiffFile, FileText, Patch, PullRequest, PrCheck, TreeFiles, WorktreeAsk } from '../shared/types.ts'

interface CheckedRepository { repo: string; writableRoots: string[]; bun: string; helper: string }
const checkedRepository = new AsyncLocalStorage<CheckedRepository>()

interface Result { ok: boolean; out: string; err: string; code: number; truncated: boolean }
async function sh(argv: string[], cwd: string, options: { env?: Record<string, string>; timeoutMs?: number } = {}): Promise<Result> {
  const guard = checkedRepository.getStore()
  let stdin: 'ignore' | Buffer = 'ignore'
  if (guard && ['git', 'gh'].includes(argv[0])) {
    stdin = Buffer.from(JSON.stringify({ repo: guard.repo, writableRoots: guard.writableRoots, cwd, tool: argv[0], args: argv.slice(1),
      literal: options.env?.GIT_LITERAL_PATHSPECS === '1', host: options.env?.GH_HOST, timeout: options.timeoutMs ?? 20000 }))
    argv = [guard.bun, guard.helper]
  }
  const child = Bun.spawn(argv, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', ...options.env }, stdin, stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 20000)
  let truncated = false
  const collect = async (stream: ReadableStream<Uint8Array>, max: number) => {
    const reader = stream.getReader(), parts: Uint8Array[] = []; let size = 0
    while (true) {
      const { value, done } = await reader.read(); if (done) break
      const left = max - size
      if (value.length > left) { parts.push(value.subarray(0, Math.max(0, left))); truncated = true; child.kill(); break }
      parts.push(value); size += value.length
    }
    return Buffer.concat(parts).toString('utf8')
  }
  try {
    const [out, err, code] = await Promise.all([collect(child.stdout, 4 * 1024 * 1024), collect(child.stderr, 65536), child.exited])
    return { out, err, code, ok: code === 0 && !truncated, truncated }
  } finally { clearTimeout(timer) }
}
const git = (cwd: string, ...args: string[]) => sh(['git', ...args], cwd)
async function mergeBase(wt: string, base: string) {
  const ref = await git(wt, 'rev-parse', '--verify', '--end-of-options', `${base}^{commit}`)
  if (!ref.ok) throw Error('The task base is unavailable')
  const result = await git(wt, 'merge-base', 'HEAD', ref.out.trim())
  if (!result.ok) throw Error('The task has no common base')
  return result.out.trim()
}
function readHead(path: string, max: number) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try { const stat = fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1) throw Error('No such file.'); const bytes = Buffer.alloc(max); const n = readSync(fd, bytes, 0, max, 0); return bytes.subarray(0, n) } finally { closeSync(fd) }
}
const noChecksAccess = (said: string) => /not accessible by personal access token/i.test(said)
async function actionJobs(g: { host: string; repo: string }, cwd: string, sha: string) {
  const gh = (...args: string[]) => sh(['gh', ...args], cwd, { env: { GH_HOST: g.host }, timeoutMs: 15000 })
  const runs = await gh('api', '--paginate', '--jq', '.workflow_runs[].id', `repos/${g.repo}/actions/runs?head_sha=${sha}&per_page=100`)
  if (!runs.ok) return null
  const ids = runs.out.split('\n').filter(Boolean)
  if (ids.length > 20 || ids.some(id => !/^\d+$/.test(id))) return null
  const checks: { name: string; bucket: string; link: string }[] = []
  for (const id of ids) {
    const jobs = await gh('api', '--paginate', '--jq', '.jobs[] | {name, status, conclusion, html_url}', `repos/${g.repo}/actions/runs/${id}/jobs?per_page=100`)
    if (!jobs.ok) return null
    try { for (const text of jobs.out.split('\n').filter(Boolean)) { const job = JSON.parse(text); checks.push({ name: job.name, link: job.html_url, bucket: job.status !== 'completed' ? 'pending' : ({ success: 'pass', neutral: 'pass', skipped: 'skipping', cancelled: 'cancel' }[String(job.conclusion)] ?? 'fail') }) } } catch { return null }
  }
  return checks
}

/** the most files a tree lists */
export const MAX_FILES = 20_000
/** the most bytes a file or a diff shows */
export const MAX_BYTES = 1_000_000

/** a path as the panel asks for it: relative, plain, inside the tree; anything else is refused */
export function safeRel(path: unknown): string {
  if (typeof path !== 'string' || !path || path.length > 4096 || path.includes('\0') || isAbsolute(path) || path.includes('\\')) throw new Error('No such file.')
  const parts = path.split('/')
  if (parts.some((p) => !p || p === '.' || p === '..') || parts[0] === '.git') throw new Error('No such file.')
  return path
}

/** git with its pathspecs taken literally: a path with * or : in it is only that path */
const lit = (cwd: string, ...args: string[]) => sh(['git', ...(args[0] === 'diff' ? ['diff', '--no-ext-diff', '--no-textconv', ...args.slice(1)] : args)], cwd, { env: { GIT_LITERAL_PATHSPECS: '1' }, timeoutMs: 20_000 })

const nulSplit = (s: string) => s.split('\0').filter(Boolean)

/** the worktree's files: tracked ones and new ones git doesn't ignore, sorted */
export async function listFiles(wt: string): Promise<TreeFiles> {
  const [r, gone] = await Promise.all([lit(wt, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'), lit(wt, 'ls-files', '-z', '--deleted')])
  if (!r.ok) throw new Error('Could not list its files.')
  // a tracked file deleted in the worktree is listed by --cached but isn't there to read
  const deleted = new Set(nulSplit(gone.out))
  const all = [...new Set(nulSplit(r.out))].filter((f) => !deleted.has(f)).sort()
  return { files: all.slice(0, MAX_FILES), more: all.length > MAX_FILES || undefined }
}

/** one file's text, when git lists it in the worktree and it really lies inside it */
export async function readFile(wt: string, path: unknown): Promise<FileText> {
  const rel = safeRel(path)
  if (!(await listed(wt, rel))) throw new Error('No such file.')
  const real = inside(wt, rel)
  // a link is read only when what it leads to is listed too: never an ignored file (.env) through a link to it
  const to = relative(realpathSync(wt), real).split(sep).join('/')
  if (to !== rel && !(await listed(wt, to))) throw new Error('No such file.')
  const size = statSync(real).size
  const head = readHead(real, Math.min(size, MAX_BYTES))
  if (isBinary(head)) return { path: rel, size, binary: true }
  return { path: rel, size, text: new TextDecoder().decode(head), tooBig: size > MAX_BYTES || undefined }
}

/** git lists the path in the worktree: tracked, or new and not ignored */
async function listed(wt: string, rel: string) {
  const r = await lit(wt, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', rel)
  return r.ok && nulSplit(r.out).includes(rel)
}

/** the real file for a path in the worktree; a link that leads outside it is refused */
function inside(wt: string, rel: string) {
  const root = realpathSync(wt)
  let real: string
  try {
    real = realpathSync(join(root, rel))
  } catch {
    throw new Error('No such file.')
  }
  if (!real.startsWith(root + sep) || real.startsWith(join(root, '.git') + sep) || !statSync(real).isFile() || statSync(real).nlink !== 1) throw new Error('No such file.')
  return real
}

const isBinary = (b: Uint8Array) => b.subarray(0, 8000).includes(0)

const STATUS: Record<string, DiffFile['status']> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', T: 'modified' }

/** Check content paths before Git reads the working tree, including tracked hardlinks and redirected directories. */
async function safeContents(wt: string) {
  const listed = await lit(wt, 'ls-files', '-z', '--cached', '--others', '--exclude-standard')
  if (!listed.ok) throw Error('Could not validate the worktree files')
  for (const path of nulSplit(listed.out)) {
    try { if (lstatSync(join(wt, path)).isFile()) inside(wt, path) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('The worktree contains a file outside its readable boundary') }
  }
}

/** what the task changed against its base: committed or not, new files too, each with its lines added and taken out */
export async function diffFiles(wt: string, base: string): Promise<Diff> {
  await safeContents(wt)
  const mb = await mergeBase(wt, base)
  const [names, nums, fresh] = await Promise.all([
    lit(wt, 'diff', '-M', '-z', '--name-status', mb),
    lit(wt, 'diff', '-M', '-z', '--numstat', mb),
    lit(wt, 'ls-files', '-z', '--others', '--exclude-standard'),
  ])
  if (!names.ok || !nums.ok) throw new Error(`Could not compare it with ${base}.`)
  const files = new Map<string, DiffFile>()
  // name-status: "M\0path\0", "R100\0old\0new\0"
  const n = names.out.split('\0')
  for (let i = 0; i < n.length && n[i]; ) {
    const code = n[i][0]
    if (code === 'R' || code === 'C') {
      files.set(n[i + 2], { path: n[i + 2], from: code === 'R' ? n[i + 1] : undefined, status: STATUS[code], add: 0, del: 0 })
      i += 3
    } else {
      files.set(n[i + 1], { path: n[i + 1], status: STATUS[code] ?? 'modified', add: 0, del: 0 })
      i += 2
    }
  }
  // numstat: "3\t1\tpath\0", a rename "3\t1\t\0old\0new\0", a binary file "-\t-\t…"
  const s = nums.out.split('\0')
  for (let i = 0; i < s.length && s[i]; ) {
    const first = s[i].indexOf('\t'), second = s[i].indexOf('\t', first + 1)
    const a = s[i].slice(0, first), d = s[i].slice(first + 1, second), p = s[i].slice(second + 1)
    const path = p ? p : s[i + 2]
    i += p ? 1 : 3
    const f = files.get(path)
    if (!f) continue
    if (a === '-') f.binary = true
    else {
      f.add = Number(a)
      f.del = Number(d)
    }
  }
  for (const path of nulSplit(fresh.out)) {
    if (files.has(path)) continue
    const f: DiffFile = { path, status: 'added', add: 0, del: 0 }
    try {
      // a link is its target's name, never followed: one line, as git counts it
      if (lstatSync(join(wt, path)).isSymbolicLink()) {
        files.set(path, { ...f, add: 1 })
        continue
      }
      const head = readHead(inside(wt, path), MAX_BYTES)
      if (isBinary(head)) f.binary = true
      else f.add = lineCount(new TextDecoder().decode(head))
    } catch {
      continue
    }
    files.set(path, f)
  }
  const list = [...files.values()].sort((a, b) => a.path.localeCompare(b.path))
  return { base, files: list, add: list.reduce((x, f) => x + f.add, 0), del: list.reduce((x, f) => x + f.del, 0) }
}

const lineCount = (t: string) => (t ? t.split('\n').length - (t.endsWith('\n') ? 1 : 0) : 0)

/** one changed file's unified diff; only for a file the diff lists */
export async function diffPatch(wt: string, base: string, path: unknown): Promise<Patch> {
  const rel = safeRel(path)
  const d = await diffFiles(wt, base)
  const f = d.files.find((x) => x.path === rel)
  if (!f) throw new Error('That file has no changes.')
  if (f.binary) return { path: rel, text: '', binary: true }
  const mb = await mergeBase(wt, base)
  // a new file git doesn't track yet is compared with nothing; the rest with the base, a rename from its old name
  const fresh = !(await lit(wt, 'ls-files', '-z', '--cached', '--', rel)).out && f.status === 'added'
  const r = fresh
    ? await lit(wt, 'diff', '--no-index', '--no-color', '--', '/dev/null', rel)
    : await lit(wt, 'diff', '-M', '--no-color', '--no-ext-diff', mb, '--', ...(f.from ? [f.from, rel] : [rel]))
  // diff --no-index says 1 when the two differ
  if (!r.ok && !r.truncated && !(fresh && r.code === 1)) throw new Error('Could not show its changes.')
  const tooBig = r.truncated || r.out.length > MAX_BYTES
  return { path: rel, text: tooBig ? r.out.slice(0, MAX_BYTES) : r.out, tooBig: tooBig || undefined }
}

/* ---------- its pull request ---------- */

/** the GitHub host and repo of a remote URL: github.com, or a GitHub Enterprise host */
export function ghRepo(url: string): { host: string; repo: string } | null {
  const m = url.trim().match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/i)
  return m ? { host: m[1], repo: m[2] } : null
}

const CHECK: Record<string, PrCheck['state']> = {
  SUCCESS: 'pass',
  NEUTRAL: 'pass',
  FAILURE: 'fail',
  ERROR: 'fail',
  TIMED_OUT: 'fail',
  CANCELLED: 'fail',
  ACTION_REQUIRED: 'fail',
  STARTUP_FAILURE: 'fail',
  SKIPPED: 'skip',
  STALE: 'skip',
}

type Rollup = { __typename?: string; name?: string; context?: string; status?: string; conclusion?: string; state?: string; detailsUrl?: string; targetUrl?: string }

const BUCKET: Record<string, PrCheck['state']> = { pass: 'pass', fail: 'fail', cancel: 'fail', pending: 'pending', skipping: 'skip' }

/** gh's checks, in plain states: a check run (status, conclusion) or a commit status (state) */
export function checksOf(rollup: Rollup[] = []): PrCheck[] {
  return rollup.map((c) => {
    const raw = c.conclusion || c.state || ''
    const done = c.status ? c.status === 'COMPLETED' : raw !== 'PENDING' && raw !== 'EXPECTED' && raw !== ''
    return { name: c.name || c.context || 'Check', state: done ? (CHECK[raw] ?? 'pending') : 'pending', url: c.detailsUrl || c.targetUrl || undefined }
  })
}

/** the open (or last) pull request of a branch, by gh; none when there is none, or gh can't tell */
export async function pullRequest(wt: string, branch: string): Promise<{ pr: PullRequest | null; why?: string }> {
  if (!branch) return { pr: null, why: 'No branch yet.' }
  const remote = await git(wt, 'remote', 'get-url', 'origin')
  const gh = remote.ok ? ghRepo(remote.out) : null
  if (!gh) return { pr: null, why: 'This space has no GitHub remote.' }
  const view = (fields: string) => sh(['gh', 'pr', 'view', branch, '-R', gh.repo, '--json', `number,title,state,isDraft,url,${fields}`], wt, { env: { GH_HOST: gh.host }, timeoutMs: 15_000 }).catch(() => null)
  let r = await view('statusCheckRollup')
  // a token that can't read checks: the pull request without them, and its Actions jobs instead
  const actions = !!r && !r.ok && noChecksAccess(r.err)
  if (actions) r = await view('headRefOid')
  if (!r) return { pr: null, why: 'gh is not installed here.' }
  if (!r.ok) return { pr: null, why: /no pull requests found/i.test(r.err) ? 'No pull request yet.' : "Couldn't ask GitHub about it." }
  const j = JSON.parse(r.out) as { number: number; title: string; state: string; isDraft: boolean; url: string; statusCheckRollup?: Rollup[]; headRefOid?: string }
  const state = j.state === 'MERGED' ? 'merged' : j.state === 'CLOSED' ? 'closed' : j.isDraft ? 'draft' : 'open'
  const jobs = actions && j.headRefOid ? await actionJobs(gh, wt, j.headRefOid) : null
  return { pr: { number: j.number, title: j.title, state, url: j.url, ...(actions && jobs === null ? { checksError: 'Could not read GitHub checks.' } : {}), checks: jobs ? jobs.map((c) => ({ name: c.name, state: BUCKET[c.bucket] ?? 'fail', url: c.link })) : checksOf(j.statusCheckRollup) } }
}

async function readWorktreeAt(ask: { folder: string; base: string; branch: string } & Omit<WorktreeAsk, 'task'> & { path?: string }) {
  let root: string
  try { root = realpathSync(ask.folder) } catch { throw Error('This task worktree is no longer available') }
  const top = await git(root, 'rev-parse', '--show-toplevel')
  if (!top.ok || realpathSync(top.out.trim()) !== root) throw Error('The task worktree is no longer available')
  if (ask.what === 'files') return listFiles(root)
  if (ask.what === 'file') return readFile(root, ask.path)
  if (ask.what === 'diff') return diffFiles(root, ask.base)
  if (ask.what === 'patch') return diffPatch(root, ask.base, ask.path)
  if (ask.what === 'pr') return pullRequest(root, ask.branch)
  throw Error('Unknown worktree view')
}

export async function readWorktree(ask: Parameters<typeof readWorktreeAt>[0] & { checked?: CheckedRepository }) {
  return checkedRepository.run(ask.checked!, () => readWorktreeAt(ask))
}
