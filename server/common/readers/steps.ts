// A tool call in plain words: what kind of step it is, what it did ("Checked the task list", "Edited app.ts") and as it
// runs ("Checking the task list"), from its tool and input: the agent's own short description where it gave one, else
// what the command is. The raw command, path or pattern stays one tap deeper (detail); the output stays in the log.
import { say, testResult, words } from '../../../shared/activity.ts'
import type { StepKind, StepWords } from '../../../shared/types.ts'

type Json = any

/** a step as a reader logs it: its kind and its words */
export type Said = StepWords & { step: StepKind }

/** the last part of a path: "src/a.ts" -> "a.ts" */
export const baseName = (p: string) => p.replace(/\/+$/, '').split('/').at(-1) || p

/** one line, at most n characters */
export function short(s: unknown, n = 80): string {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** a command as it reads: its first line, without a leading cd into the worktree */
export function commandWords(cmd: unknown): string {
  const first = String(cmd ?? '').split('\n').find((l) => l.trim()) ?? ''
  return short(first.replace(/^\s*cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, ''))
}

/** a command's whole text for its detail: at most 2000 characters */
const fullCommand = (cmd: unknown) => {
  const t = String(cmd ?? '').trim()
  return t.length > 2000 ? `${t.slice(0, 1999)}…` : t
}

const host = (url: unknown) => {
  try {
    const u = new URL(String(url))
    return short(u.host + (u.pathname === '/' ? '' : u.pathname), 60)
  } catch {
    return short(url, 60)
  }
}

const quote = (s: unknown) => `“${short(s, 40)}”`

/** a command's words split as a shell would, roughly: quotes kept together, quotes gone */
function argv(seg: string): string[] {
  return [...seg.matchAll(/"((?:\\.|[^"])*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3])
}

/** the part of a command that does the work: past a cd, env settings, timeout, nice and the like; the first piece of a
 *  pipe or a chain that isn't one of those */
function mainPart(cmd: string): string[] {
  const parts = cmd
    .split('\n')
    .flatMap((l) => l.split(/&&|\|\||;|\|/))
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('#'))
  for (const p of parts) {
    let a = argv(p)
    while (a.length && (/^\w+=/.test(a[0]) || ['sudo', 'env', 'time', 'nice', 'nohup', 'exec', 'command', 'timeout', 'ionice'].includes(a[0]))) {
      const w = a.shift()!
      if (w === 'timeout' && a[0] && /^\d/.test(a[0])) a.shift()
      while ((w === 'nice' || w === 'ionice') && a[0]?.startsWith('-')) a.shift()
    }
    if (!a.length || ['cd', 'pushd', 'popd', 'set', 'export', 'source', '.', 'true', 'mkdir', 'sleep', 'echo'].includes(a[0])) continue
    return a
  }
  return argv(parts[0] ?? '')
}

const TEST = /\b(?:(?:bun|npm|pnpm|yarn|deno)\s+(?:run\s+)?test|pytest|go\s+test|cargo\s+test|vitest|jest|playwright\s+test|mix\s+test|rspec|phpunit)\b/

/** what a command does, in words, from what it runs: "Ran tests", "Checked git status", "Searched for “mute”". Never
 *  the command line itself: an unknown program reads "Ran <its name>". */
export function commandSay(cmd: string): Said {
  const detail = fullCommand(cmd)
  const said = (step: StepKind, action: string, target = '', x: Partial<StepWords> = {}): Said => ({ step, ...words(action, target, { detail, ...x }) })
  const a = mainPart(cmd)
  const prog = baseName(a[0] ?? '')
  // a shell that runs a command of its own: that command's words, with this whole one as the detail
  if (['bash', 'sh', 'zsh', 'dash'].includes(prog) && a.some((x) => /^-\w*c$/.test(x))) {
    const inner = a[a.findIndex((x) => /^-\w*c$/.test(x)) + 1]
    if (inner) return { ...commandSay(inner), detail }
  }
  // quoted words are no command: "rg 'bun test'" searches
  if (TEST.test(cmd.replace(/"(?:\\.|[^"])*"|'[^']*'/g, ''))) return said('run', 'Run tests', '', { test: true })
  // its words that are no flag, up to a redirect
  const to = a.findIndex((x, i) => i > 0 && /^\d*[<>]/.test(x))
  const args = a.slice(1, to < 0 ? undefined : to).filter((x) => !x.startsWith('-'))
  const sub = args[0] ?? ''
  if (!prog) return said('run', 'Run a command')
  if (/\b(?:tsc|typecheck|type-check)\b/.test(cmd)) return said('run', 'Check the types')
  if (/\b(?:eslint|oxlint|biome|lint)\b/.test(cmd)) return said('run', 'Run the linter')
  switch (prog) {
    case 'git': {
      const G: Record<string, string> = {
        status: 'Check git status', diff: 'Look at the changes', log: 'Look at the history', show: 'Look at a commit', commit: 'Commit the changes',
        push: 'Push the branch', pull: 'Pull the latest', fetch: 'Fetch from the remote', rebase: 'Rebase the branch', merge: 'Merge a branch',
        checkout: 'Switch branches', switch: 'Switch branches', add: 'Stage the changes', stash: 'Stash the changes', clone: 'Clone a repo',
        branch: 'Look at the branches', reset: 'Reset the branch', restore: 'Restore files', worktree: 'Look at the worktrees', blame: 'Look at who changed what',
        'rev-parse': 'Look up a commit', 'cherry-pick': 'Pick a commit', remote: 'Look at the remotes', tag: 'Look at the tags',
      }
      // what a chain of git commands comes to: "git add -A && git commit" commits
      const last = ['push', 'commit', 'rebase', 'merge', 'pull', 'clone'].find((x) => new RegExp(`\\bgit\\s+(?:-C\\s+\\S+\\s+|-\\S+\\s+)*${x}\\b`).test(cmd))
      // past "-C <folder>"
      const verb = a.slice(1).find((x, i, xs) => !x.startsWith('-') && xs[i - 1] !== '-C') ?? ''
      return said('run', G[last ?? verb] ?? `Run git ${verb}`.trim())
    }
    case 'gh': {
      const what = `${sub} ${args[1] ?? ''}`.trim()
      const G: Record<string, string> = {
        'pr view': 'Look at the pull request', 'pr checks': 'Check the pull request’s checks', 'pr create': 'Open a pull request', 'pr merge': 'Merge the pull request',
        'pr list': 'List the pull requests', 'pr diff': 'Look at the pull request’s changes', 'run list': 'List GitHub’s runs', 'run view': 'Look at a GitHub run',
        'run watch': 'Watch a GitHub run', 'workflow run': 'Start a GitHub workflow', 'issue view': 'Look at an issue', 'issue list': 'List the issues', 'repo view': 'Look at the repo',
      }
      return said('web', G[what] ?? (sub === 'api' ? 'Ask GitHub' : `Use GitHub ${sub}`.trim()))
    }
    case 'shepherdr': {
      const what = `${sub} ${args[1] ?? ''}`.trim()
      const S: Record<string, string> = {
        'task list': 'Check the task list', 'task show': 'Look at a task', 'task new': 'Make a task', 'task tell': 'Tell a task', 'task queue': 'Queue a task',
        'artifact new': 'Share an artifact', 'artifact update': 'Update an artifact', 'artifact check': 'Check an artifact', 'artifact list': 'List the artifacts',
      }
      const S1: Record<string, string> = { status: 'Report how far it got', ready: 'Mark it ready', merge: 'Merge it', ask: 'Ask you', plan: 'Show you a plan', pr: 'Open the pull request',
        alert: 'Alert you', show: 'Check the settings', todo: 'Wait for a go', checks: 'Check GitHub’s checks', help: 'Look at shepherdr’s help' }
      return said('run', S[what] ?? S1[sub] ?? `Use shepherdr ${sub}`.trim())
    }
    case 'agent-browser':
      return said('web', sub === 'open' || sub === 'goto' ? `Open ${host(args[1])} in the browser` : sub === 'screenshot' ? 'Take a screenshot' : 'Use the browser')
    case 'cat': case 'head': case 'tail': case 'less': case 'bat': case 'nl': {
      const f = args.at(-1)
      return f ? said('read', `Read ${baseName(f)}`, baseName(f)) : said('read', 'Read a file')
    }
    case 'sed':
      if (a.includes('-n')) {
        const f = args.at(-1)
        return f && args.length > 1 ? said('read', `Read ${baseName(f)}`, baseName(f)) : said('read', 'Read a file')
      }
      if (a.some((x) => x.startsWith('-i'))) {
        const f = args.at(-1)
        return f && args.length > 1 ? said('edit', `Edit ${baseName(f)}`, baseName(f)) : said('edit', 'Edit a file')
      }
      return said('run', 'Run sed')
    case 'grep': case 'rg': case 'ag': case 'ack': {
      const pat = args[0]
      return pat ? said('search', `Search for ${quote(pat)}`, quote(pat)) : said('search', 'Search the code')
    }
    case 'find': case 'fd': case 'ls': case 'tree':
      return said('search', prog === 'find' || prog === 'fd' ? 'Look for files' : 'List files')
    case 'wc': return said('read', 'Count lines')
    case 'curl': case 'wget': case 'http': {
      const url = a.find((x) => /^https?:\/\//.test(x))
      return url ? said('web', `Fetch ${host(url)}`) : said('web', 'Fetch a page')
    }
    case 'tailscale': return said('run', 'Use Tailscale')
    case 'docker': return said('run', `Use Docker${sub ? ` ${sub}` : ''}`)
    case 'rm': return said('edit', 'Remove files')
    case 'mv': return said('edit', 'Move files')
    case 'cp': return said('edit', 'Copy files')
    case 'kill': case 'pkill': case 'killall': return said('run', 'Stop a process')
    case 'ps': case 'pgrep': return said('run', 'Look at what runs')
    case 'jq': return said('run', 'Read some JSON')
    case 'make': return said('run', `Run make${sub ? ` ${sub}` : ''}`)
    case 'codex': case 'claude': case 'pi': return said('agent', 'Ask another agent')
    case 'bun': case 'npm': case 'pnpm': case 'yarn': case 'npx': case 'bunx': {
      if (['install', 'i', 'add', 'ci'].includes(sub)) return said('run', 'Install packages')
      if (sub === 'run') return said('run', /build/.test(args[1] ?? '') ? 'Build it' : `Run ${args[1] ?? 'a script'}`)
      if (/\.(ts|js|mjs|tsx)$/.test(sub)) return said('run', `Run ${baseName(sub)}`)
      if (sub === 'x' || sub === 'exec' || ['-e', '--eval', '-p', '--print'].some((f) => a.includes(f))) return said('run', 'Run a script')
      return said('run', /build/.test(sub) ? 'Build it' : `Run ${/^[\w.@/-]+$/.test(sub) ? sub : prog}`)
    }
    case 'node': case 'python': case 'python3': case 'deno': case 'tsx': case 'ruby': case 'perl': case 'bash': case 'sh': case 'zsh':
      // code given inline (-c, -e) is no name
      return said('run', sub && !a.some((x) => /^-(c|e|p|-eval|-print)$/.test(x)) && /^[\w./~-]+$/.test(sub) ? `Run ${baseName(sub)}` : 'Run a script')
  }
  return said('run', /^[\w.@+-]+$/.test(prog) ? `Run ${prog}` : 'Run a command')
}

/** a command step: the agent's own description where it gave one ("List the open tasks"), else commandSay. A test run
 *  stays one either way, so its outcome shows. */
function runStep(cmd: unknown, description?: unknown): Said {
  const c = commandSay(String(cmd ?? ''))
  const d = short(description, 120)
  if (!d) return c
  return { ...c, ...say(d), target: c.step === 'read' || c.step === 'edit' ? c.target : '', step: c.step === 'read' || c.step === 'search' || c.step === 'web' || c.step === 'agent' ? c.step : 'run' }
}

/** lines added and removed between two texts: the lines one has that the other hasn't */
export function lineCounts(before: string, after: string): { added: number; removed: number } {
  const count = (xs: string[]) => xs.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>())
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  const ca = count(a)
  const cb = count(b)
  let added = 0
  let removed = 0
  for (const [l, n] of cb) added += Math.max(0, n - (ca.get(l) ?? 0))
  for (const [l, n] of ca) removed += Math.max(0, n - (cb.get(l) ?? 0))
  return { added, removed }
}

/** a unified diff's lines added and removed */
export function diffCounts(diff: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++') || l.startsWith('---')) continue
    if (l.startsWith('+')) added++
    else if (l.startsWith('-')) removed++
  }
  return { added, removed }
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i

/** an MCP tool's name as words: "mcp__github__get_pr" -> "get pr" */
export const toolWords = (name: string) => (/^mcp__.+?__(.+)$/.exec(name)?.[1] ?? name).replace(/[_-]+/g, ' ').trim()

/** tools that are no step: the question tool and the plan show as cards, the tool search is the CLI's own business */
const SKIP = new Set(['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode', 'ToolSearch'])

/** a Claude Code tool call as a step, or none for a tool the chat shows otherwise */
export function claudeStep(name: string, input: Json): Said | undefined {
  const i = input && typeof input === 'object' ? input : {}
  if (SKIP.has(name)) return undefined
  const path = String(i.file_path ?? i.notebook_path ?? '')
  switch (name) {
    case 'Bash':
      return runStep(i.command, i.description)
    case 'Monitor':
      return { ...runStep(i.command, i.description), step: 'run' }
    case 'Read':
    case 'NotebookRead':
      return { step: 'read', ...words(`${IMAGE.test(path) ? 'Look at' : 'Read'} ${baseName(path)}`, baseName(path), { detail: path }) }
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit': {
      const edits: Json[] = Array.isArray(i.edits) ? i.edits : name === 'Edit' ? [i] : []
      const n = name === 'Write' ? lineCounts('', String(i.content ?? '')) : name === 'NotebookEdit' ? lineCounts('', String(i.new_source ?? '')) : edits.reduce((m, e) => {
        const c = lineCounts(String(e?.old_string ?? ''), String(e?.new_string ?? ''))
        return { added: m.added + c.added, removed: m.removed + c.removed }
      }, { added: 0, removed: 0 })
      const f = baseName(path)
      return { step: 'edit', ...words(`${name === 'Write' ? 'Write' : 'Edit'} ${f}`, f, { detail: path, ...n }) }
    }
    case 'Grep':
      return { step: 'search', ...words(`Search the code for ${quote(i.pattern)}`, quote(i.pattern), { detail: [i.pattern, i.path, i.glob].filter(Boolean).join('  ') }) }
    case 'Glob':
      return { step: 'search', ...words(`Look for files named ${short(i.pattern, 40)}`, short(i.pattern, 40), { detail: [i.pattern, i.path].filter(Boolean).join('  ') }) }
    case 'WebSearch':
      return { step: 'web', ...words(`Search the web for ${quote(i.query)}`, '', { detail: String(i.query ?? '') }) }
    case 'WebFetch':
      return { step: 'web', ...words(`Read ${host(i.url)}`, '', { detail: String(i.url ?? '') }) }
    case 'Agent':
    case 'Task':
      return { step: 'agent', ...subagent(i.description ?? i.prompt), detail: short(i.prompt, 2000) }
    case 'Skill':
      return { step: 'other', ...words(`Use the ${short(i.skill ?? i.command, 40)} skill`) }
    case 'TodoWrite':
      return { step: 'other', ...words('Update the to-do list') }
    case 'Artifact':
      return { step: 'other', ...words(i.action === 'read' ? 'Read an artifact' : 'Publish an artifact') }
  }
  // an MCP server's tool, or one it doesn't know: its own name in words
  return { step: 'other', ...words(`Use ${toolWords(name)}`) }
}

/** a subagent's step: "Asked a subagent to review the fix", or "Asked a subagent: Review the fix" */
function subagent(description: unknown): StepWords {
  const d = short(description, 80)
  if (!d) return words('Ask a subagent')
  const lower = d.charAt(0).toLowerCase() + d.slice(1)
  const first = /^[A-Za-z]+/.exec(d)?.[0]
  return first && say(first).title !== say(first).doing ? words(`Ask a subagent to ${lower}`) : words(`Ask a subagent: ${d}`)
}

/** the tool's name as a step keeps it: an MCP server's tool by its own name */
export const toolName = (name: string) => /^mcp__.+?__(.+)$/.exec(name)?.[1] ?? name

/** a Codex item that is over (event_msg item_completed) as a step, or none for one that is no step */
export function codexItem(it: Json): (Said & { failed?: boolean; tool: string; result?: string }) | undefined {
  switch (it?.type) {
    case 'CommandExecution': {
      const p = Array.isArray(it.parsed_cmd) && it.parsed_cmd.length === 1 ? it.parsed_cmd[0] : undefined
      const cmd = String(Array.isArray(it.command) ? (it.command.at(-1) ?? '') : (it.command ?? ''))
      const failed = it.status === 'failed' || (typeof it.exit_code === 'number' && it.exit_code !== 0) || undefined
      const c = commandSay(cmd)
      if (p?.type === 'read') {
        const f = baseName(String(p.path ?? p.name ?? ''))
        return { ...c, step: 'read', ...words(`Read ${f}`, f), failed, tool: 'exec_command' }
      }
      if ((p?.type === 'search' || p?.type === 'list_files') && c.step !== 'search') return { ...c, step: 'search', ...words(p.query ? `Search for ${quote(p.query)}` : 'Look for files', p.query ? quote(p.query) : ''), failed, tool: 'exec_command' }
      return { ...c, failed, tool: 'exec_command', result: c.test ? testResult(String(it.aggregated_output ?? '')) : undefined }
    }
    case 'FileChange': {
      const files = Object.keys(it.changes ?? {})
      if (!files.length) return undefined
      const n = Object.values(it.changes ?? {}).reduce(
        (m: { added: number; removed: number }, c: Json) => {
          const d = typeof c?.unified_diff === 'string' ? diffCounts(c.unified_diff) : lineCounts('', String(c?.content ?? ''))
          return { added: m.added + d.added, removed: m.removed + d.removed }
        },
        { added: 0, removed: 0 },
      )
      const f = baseName(files[0])
      const what = files.length > 1 ? `Edit ${files.length} files: ${files.slice(0, 3).map(baseName).join(', ')}` : `Edit ${f}`
      return { step: 'edit', ...words(what, files.length > 1 ? '' : f, { detail: files.join('\n'), ...n }), tool: 'apply_patch' }
    }
    case 'McpToolCall':
      return { step: 'other', ...words(`Use ${toolWords(String(it.actionName ?? it.tool ?? it.server ?? 'a tool'))}`), tool: short(it.actionName ?? it.tool ?? it.server, 40), failed: it.status === 'failed' || undefined }
    case 'Extension':
      return it.kind === 'web.search' ? { step: 'web', ...words(it.query ? `Search the web for ${quote(it.query)}` : `Read ${host(it.action?.url)}`, '', { detail: String(it.query ?? it.action?.url ?? '') }), tool: 'web_search' } : undefined
    case 'ImageView': {
      const f = baseName(String(it.path ?? ''))
      return { step: 'read', ...words(`Look at ${f}`, f, { detail: String(it.path ?? '') }), tool: 'view_image' }
    }
  }
  return undefined
}

/** Codex's own calls before code mode logged its items: a shell command, a patch */
export function codexCall(name: string, args: Json): Said {
  const a = args && typeof args === 'object' ? args : {}
  if (name === 'apply_patch') {
    const patch = String(a.input ?? args ?? '')
    const files = [...patch.matchAll(/\*\*\* (?:Update|Add|Delete) File: (.+)/g)].map((m) => m[1].trim())
    const n = diffCounts(patch.replace(/^\*\*\*.*$/gm, ''))
    if (!files.length) return { step: 'edit', ...words('Edit files', '', n) }
    const f = baseName(files[0])
    return { step: 'edit', ...words(files.length > 1 ? `Edit ${files.length} files: ${files.slice(0, 3).map(baseName).join(', ')}` : `Edit ${f}`, files.length > 1 ? '' : f, { detail: files.join('\n'), ...n }) }
  }
  if (name === 'shell' || name === 'exec_command' || name === 'local_shell' || name === 'exec') {
    const cmd = Array.isArray(a.command) ? a.command.at(-1) : (a.cmd ?? a.command ?? /\bcmd\s*:\s*(["'`])((?:\\.|(?!\1).)*)\1/.exec(String(args ?? ''))?.[2])
    return commandSay(String(cmd ?? ''))
  }
  return { step: 'other', ...words(`Use ${toolWords(name)}`) }
}
