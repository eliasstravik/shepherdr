// Work an agent started in the background that outlives its turn. Claude Code runs subagents, shells and monitors in
// the background and wakes the agent when one finishes or reports, so a turn that ends while one runs is a pause, not a
// question. Claude Code says so itself in its session file (~/.claude/sessions/<pid>.json): "busy" while a background
// agent runs, "shell" while only shells or monitors do, "idle" once nothing does. Its screen says so too, and is read
// when there is no session file: "✻ Waiting for 1 background agent to finish", "✻ … · done 10:04 PM · 1 shell, 1 monitor
// still running", the footer's "· 2 shells ·" and a row per subagent below it. Codex keeps background terminals but is
// never woken by them, and pi has none: their turn's end waits on you.
// A shell that ends (a test run, a review) wakes it, however long it takes; one that serves or watches (a dev server it
// left for you to look at) never does. Its hooks name each shell's command, which tells them apart (hooks.ts).
// A shell that runs a headless reviewer of another CLI (codex exec, claude -p: a task agent's own reviewer) wakes it like a
// subagent, however long it takes: it is found by its command and its SHEPHERDR_CHAT (/proc, or ps), and counts as one.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { claudeHome } from './find.ts'

/** what still runs: a subagent (maybe with shells of its own), shells and monitors (a test run, a review: they end and
 *  wake it), or only servers (a dev server, a preview, a watcher: they never end, its hooks tell them by their words) */
export type Background = 'agents' | 'shells' | 'servers'

/** a session file's status, as background work */
export function sessionBackground(status: string | undefined): Background | undefined {
  return status === 'busy' ? 'agents' : status === 'shell' ? 'shells' : undefined
}

const RULE = /^\s*─{20,}\s*$/

/** the screen of a Claude Code whose turn ended, as background work: what its input box and footer say */
export function screenBackground(screen: string): Background | undefined {
  const lines = screen.split('\n').map((l) => l.trimEnd())
  // the input box is two rules around the prompt; the footer and a row per running agent come after it
  const rules = lines.flatMap((l, i) => (RULE.test(l) ? [i] : []))
  if (rules.length < 2) return undefined
  const [top, bottom] = rules.slice(-2)
  const above = lines.slice(0, top).filter((l) => l.trim()).at(-1) ?? ''
  const [footer = '', ...rows] = lines.slice(bottom + 1).filter((l) => l.trim())
  if (/Waiting for \d+ background agents? to finish/.test(above) || rows.some((r) => /^\s*[◯○●◉]\s+(?!main\s*$)\S/.test(r))) return 'agents'
  if (/·.*\bstill running\s*$/.test(above) || /(^|·)\s*\d+ (shells?|monitors?)\b/.test(footer)) return 'shells'
  return undefined
}

interface SessionFile {
  pid: number
  sessionId?: string
  cwd?: string
  status?: string
  updatedAt?: number
  /** "interactive" for one in a terminal */
  kind?: string
}

/** the Claude Code that wrote it still runs: its pid is there and, where /proc says when it started, is the same
 *  process, not a new one that got a dead one's pid */
const alive = (pid: number, procStart?: string) => {
  try {
    process.kill(pid, 0)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EPERM') return false
  }
  if (!procStart) return true
  try {
    return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1)!.split(' ')[19] === procStart
  } catch {
    return true
  }
}

/** a session file is read at most this often */
const FRESH_MS = 1000
/** the folder is looked through again for one not found, at most this often */
const RESCAN_MS = 5000

/** Claude Code's session files: which belongs to an agent, and what it says now */
export class ClaudeSessions {
  private files = new Map<string, string>()
  private read = new Map<string, { at: number; s: SessionFile | null }>()
  private scanAt = 0

  constructor(private dir = () => join(claudeHome(), 'sessions')) {}

  private load(f: string, now: number): SessionFile | null {
    const c = this.read.get(f)
    if (c && now - c.at < FRESH_MS) return c.s
    let s: SessionFile | null = null
    try {
      const j = JSON.parse(readFileSync(f, 'utf8'))
      if (j && typeof j.pid === 'number' && alive(j.pid, typeof j.procStart === 'string' ? j.procStart : undefined)) s = j
    } catch {
      /* gone, or half written */
    }
    this.read.set(f, { at: now, s })
    return s
  }

  /** every session file, by "id:<session id>" and by "cwd:<folder>" (the newest there), looked through again at most
   *  every RESCAN_MS */
  private scan(now: number) {
    if (now - this.scanAt < RESCAN_MS) return
    this.scanAt = now
    this.files.clear()
    const newest = new Map<string, number>()
    let names: string[] = []
    try {
      names = readdirSync(this.dir()).filter((n) => /^\d+\.json$/.test(n))
    } catch {
      /* no sessions folder */
    }
    for (const n of names) {
      const f = join(this.dir(), n)
      const s = this.load(f, now)
      if (!s || (s.kind && s.kind !== 'interactive')) continue
      if (s.sessionId) this.files.set(`id:${s.sessionId}`, f)
      if (s.cwd && (s.updatedAt ?? 0) >= (newest.get(s.cwd) ?? -1)) {
        newest.set(s.cwd, s.updatedAt ?? 0)
        this.files.set(`cwd:${s.cwd}`, f)
      }
    }
  }

  /** the session file of the Claude Code with this session id, else the newest one running in this folder */
  private find(sessionId: string | undefined, cwd: string, now: number): SessionFile | null {
    const look = () => {
      for (const k of [sessionId && `id:${sessionId}`, `cwd:${cwd}`]) {
        const f = k && this.files.get(k)
        const s = f && this.load(f, now)
        if (s && (s.sessionId === sessionId || s.cwd === cwd)) return s
      }
      return null
    }
    const s = look()
    if (s) return s
    this.scan(now)
    return look()
  }

  /** what its session file says now ("busy", "shell", "idle", …), or nothing when there is none */
  status(sessionId: string | undefined, cwd: string, now = Date.now()): string | undefined {
    const s = this.find(sessionId, cwd, now)
    return s ? (s.status ?? 'idle') : undefined
  }
}

/** a headless one-shot of a CLI, as a task agent may run a reviewer: codex exec, claude -p, pi -p */
export function headless(argv: string[]): boolean {
  const bin = (i: number) => argv[i]?.split('/').at(-1) ?? ''
  // node, bun and the like run the CLI's script: look past them
  const at = /^(node|bun|deno)$/.test(bin(0)) ? 1 : 0
  const cli = bin(at).replace(/\.(js|mjs|cjs)$/, '')
  const rest = argv.slice(at + 1)
  if (cli === 'codex') return rest[0] === 'exec' || rest[0] === 'e'
  if (cli === 'claude' || cli === 'pi') return rest.includes('-p') || rest.includes('--print')
  return false
}

/** /proc is read again at most this often */
const PROC_MS = 2000

/**
 * The headless reviewers that run for each chat: a reviewer of another CLI is a shell to Claude Code, but it will wake
 * the agent once it ends, like a subagent, however long it takes. Its environment says whose it is (SHEPHERDR_CHAT,
 * which every agent Shepherdr starts has, and its shells after it): read from /proc, or where there is none (macOS)
 * from `ps -E`, which prints each command with its environment after it.
 */
/** a headless CLI that runs: its words, since when, and its process (where /proc tells) */
export interface Headless {
  argv: string[]
  at: number
  pid?: number
}

export class Reviewers {
  private at = 0
  private chats = new Map<string, Headless[]>()
  /** when each was first seen, where nothing says when it started (ps) */
  private first = new Map<string, number>()

  constructor(
    private proc = '/proc',
    private ps = () => Bun.spawnSync(['ps', '-axwwE', '-o', 'command='], { stdout: 'pipe', stderr: 'ignore', timeout: 3000 }).stdout.toString(),
  ) {}

  runs(chat: string, now = Date.now()): boolean {
    return this.list(chat, now).length > 0
  }

  /** the headless CLIs this chat's agent runs now */
  list(chat: string, now = Date.now()): Headless[] {
    if (now - this.at >= PROC_MS) {
      this.at = now
      this.chats = this.scan()
    }
    return this.chats.get(chat) ?? []
  }

  private add(chats: Map<string, Headless[]>, chat: string, h: Headless) {
    const list = chats.get(chat) ?? []
    list.push(h)
    chats.set(chat, list)
  }

  private scan() {
    let pids: string[]
    try {
      pids = readdirSync(this.proc).filter((n) => /^\d+$/.test(n))
    } catch {
      return this.fromPs()
    }
    const chats = new Map<string, Headless[]>()
    for (const pid of pids) {
      try {
        const argv = readFileSync(join(this.proc, pid, 'cmdline'), 'utf8').split('\0').filter(Boolean)
        if (!headless(argv)) continue
        const chat = readFileSync(join(this.proc, pid, 'environ'), 'utf8').split('\0').find((v) => v.startsWith(CHAT))
        // its folder in /proc is as old as it is
        if (chat) this.add(chats, chat.slice(CHAT.length), { argv, pid: Number(pid), at: statSync(join(this.proc, pid)).ctimeMs })
      } catch {
        /* gone, or not ours */
      }
    }
    return chats
  }

  /** each line is a command and its words, then its environment: split on spaces, which is enough to tell a
   *  headless CLI by its first words and a chat key (which has none) by its variable */
  private fromPs() {
    const chats = new Map<string, Headless[]>()
    let out = ''
    try {
      out = this.ps()
    } catch {
      return chats
    }
    const seen = new Map<string, number>()
    for (const line of out.split('\n')) {
      const words = line.trim().split(/\s+/)
      const chat = words.find((w) => w.startsWith(CHAT))
      if (!chat || !headless(words)) continue
      // its words end where its environment starts
      const env = words.findIndex((w) => /^[A-Z_][A-Z0-9_]*=/.test(w))
      const argv = env > 0 ? words.slice(0, env) : words
      const k = line.trim()
      seen.set(k, this.first.get(k) ?? Date.now())
      this.add(chats, chat.slice(CHAT.length), { argv, at: seen.get(k)! })
    }
    this.first = seen
    return chats
  }
}

const CHAT = 'SHEPHERDR_CHAT='
