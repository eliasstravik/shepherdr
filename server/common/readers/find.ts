// Where each CLI keeps an agent's log file. Homes follow the CLIs' own settings: CLAUDE_CONFIG_DIR, CODEX_HOME,
// PI_CODING_AGENT_DIR (tests point these at fixtures).
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const env = (k: string) => process.env[k] || undefined

export const claudeHome = () => env('CLAUDE_CONFIG_DIR') ?? join(homedir(), '.claude')
export const codexHome = () => env('CODEX_HOME') ?? join(homedir(), '.codex')
export const piHome = () => env('PI_CODING_AGENT_DIR') ?? join(homedir(), '.pi', 'agent')

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/[/\\]+$/, '') : p)

/** newest .jsonl in a folder changed at or after sinceMs */
function newestLog(dir: string, sinceMs = 0): string | undefined {
  let best: { f: string; m: number } | undefined
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return undefined
  }
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue
    const f = join(dir, n)
    try {
      const m = statSync(f).mtimeMs
      if (m >= sinceMs && (!best || m > best.m)) best = { f, m }
    } catch {}
  }
  return best?.f
}

/* ---------- Claude Code ---------- */

// Claude Code names a project folder after its cwd with every character but letters and digits turned into '-';
// long names are cut at 200 characters and get a hash on the end
const MAX_NAME = 200

/** the project folder for a cwd */
export function claudeProjectDir(cwd: string): string {
  const root = join(claudeHome(), 'projects')
  const name = trimSlash(cwd).replace(/[^a-zA-Z0-9]/g, '-')
  const dir = join(root, name)
  if (name.length <= MAX_NAME || existsSync(dir)) return dir
  try {
    const hit = readdirSync(root).find((n) => n.startsWith(name.slice(0, MAX_NAME)))
    if (hit) return join(root, hit)
  } catch {}
  return dir
}

export const claudeLogPath = (cwd: string, sessionId: string) => join(claudeProjectDir(cwd), `${sessionId}.jsonl`)

/** the newest Claude Code session log for this cwd, changed at or after sinceMs */
export const findClaudeLog = (cwd: string, sinceMs?: number) => newestLog(claudeProjectDir(cwd), sinceMs)

/* ---------- Codex ---------- */

/** the first line of a file (Codex's session_meta is ~20KB: it carries the system prompt) */
function firstLine(f: string, max = 1 << 20): string | undefined {
  let fd: number
  try {
    fd = openSync(f, 'r')
  } catch {
    return undefined
  }
  try {
    let text = ''
    const buf = Buffer.alloc(64 << 10)
    for (let pos = 0; pos < max; ) {
      const got = readSync(fd, buf, 0, buf.length, pos)
      if (got <= 0) break
      const nl = buf.subarray(0, got).indexOf(10)
      if (nl !== -1) return text + buf.toString('utf8', 0, nl)
      text += buf.toString('utf8', 0, got)
      pos += got
    }
    return undefined
  } finally {
    closeSync(fd)
  }
}

const ymd = (d: Date, utc: boolean) =>
  utc
    ? [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]
    : [d.getFullYear(), d.getMonth() + 1, d.getDate()]

/** Reuse the native rollout identity checks for host-owned isolated captures. */
export function mainCodexLog(file: string, cwd: string, interactiveOnly = false) {
  try {
    const meta = JSON.parse(firstLine(file) ?? '')
    const p = meta?.type === 'session_meta' ? meta.payload : undefined
    return !!p && typeof p.cwd === 'string' && trimSlash(p.cwd) === trimSlash(cwd)
      && p.thread_source !== 'subagent' && !(p.source && typeof p.source === 'object' && 'subagent' in p.source)
      && (!interactiveOnly || p.source === 'cli')
  } catch { return false }
}

/** the day folders a session started since sinceMs can be in: today, yesterday and sinceMs's day, local and UTC */
function codexDayDirs(sinceMs?: number): string[] {
  const now = Date.now()
  const times = [now, now - 86_400_000]
  if (sinceMs) times.push(sinceMs)
  const dirs = new Set<string>()
  for (const t of times) {
    for (const utc of [false, true]) {
      const [y, m, d] = ymd(new Date(t), utc)
      dirs.add(join(codexHome(), 'sessions', String(y), String(m).padStart(2, '0'), String(d).padStart(2, '0')))
    }
  }
  return [...dirs]
}

/** the newest Codex rollout started in this cwd and changed at or after sinceMs (subagents' rollouts are left out) */
export function findCodexLog(cwd: string, sinceMs = 0): string | undefined {
  const want = trimSlash(cwd)
  const files: { f: string; m: number }[] = []
  for (const dir of codexDayDirs(sinceMs)) {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const n of names) {
      if (!n.startsWith('rollout-') || !n.endsWith('.jsonl')) continue
      const f = join(dir, n)
      try {
        const m = statSync(f).mtimeMs
        if (m >= sinceMs) files.push({ f, m })
      } catch {}
    }
  }
  files.sort((a, b) => b.m - a.m)
  for (const { f } of files) {
    if (mainCodexLog(f, want)) return f
  }
  return undefined
}

/* ---------- pi ---------- */

/** pi names a session folder "--<cwd without its leading slash, / \ and : turned into ->--" */
export function piSessionDir(cwd: string): string {
  const name = `--${trimSlash(cwd).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  return join(piHome(), 'sessions', name)
}

/** the newest pi session log for this cwd, changed at or after sinceMs */
export const findPiLog = (cwd: string, sinceMs?: number) => newestLog(piSessionDir(cwd), sinceMs)

/** Runtime log discovery, also used to decide which kinds can supply chat. */
export const LOG_FINDERS: Record<string, (cwd: string, sinceMs?: number) => string | undefined> = {
  claude: findClaudeLog,
  codex: findCodexLog,
  pi: findPiLog,
}

/** the newest log of this CLI for this cwd */
export function findLog(cli: string, cwd: string, sinceMs?: number): string | undefined {
  return Object.hasOwn(LOG_FINDERS, cli) ? LOG_FINDERS[cli](cwd, sinceMs) : undefined
}

/** which CLI wrote this log, by where it lies: an agent a backup took over from has logs of two CLIs */
export function logKind(file: string): string | undefined {
  if (file.includes('/autopilot-runtime/')) {
    if (file.includes('/.claude/')) return 'claude'
    if (file.includes('/.codex/')) return 'codex'
    if (file.includes('/.pi/')) return 'pi'
  }
  const under = (dir: string) => file.startsWith(`${trimSlash(dir)}/`)
  if (under(join(claudeHome(), 'projects'))) return 'claude'
  if (under(join(codexHome(), 'sessions'))) return 'codex'
  if (under(join(piHome(), 'sessions'))) return 'pi'
  return undefined
}
