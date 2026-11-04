// What the browser may run. The Herdr window already runs every mod's background work (news,
// queues, cleanups, schedulers); the browser must never run it a second time. So a call that
// changes anything is refused unless it is one of the person's own actions, made right after a
// tap or key in the page (`gesture`), from this short list. Everything that only reads runs.

const READ_CMDS = new Set(['cat', 'ls', 'head', 'tail', 'wc', 'test', '[', 'stat', 'pgrep', 'ps', 'uname', 'hostname', 'which',
  'date', 'readlink', 'realpath', 'du', 'df', 'id', 'whoami', 'true', 'echo', 'printf', 'basename', 'dirname', 'grep', 'jq', 'command'])
const GIT_READ = new Set(['status', 'log', 'rev-parse', 'branch', 'diff', 'show', 'rev-list', 'ls-files', 'merge-base', 'remote',
  'symbolic-ref', 'for-each-ref', 'worktree', 'cat-file', 'describe', 'shortlog', 'name-rev', 'ls-tree', 'config'])
const HC_READ = new Set(['ls', 'get', 'read', 'templates', 'schema', 'wait'])
const TOOL_READ: Record<string, Set<string>> = {
  'herdr-task': new Set(['list', 'show', 'where', 'reasons', 'help', '--help']),
  'herdr-artifact': new Set(['list', 'show', 'get', 'guide', 'where']),
  'herdr-secret': new Set(['list']),
  'herdr-app': new Set(['ls', 'status', 'commands']),
}

// A shell line that writes, starts, ends or sends something.
const WRITES = new RegExp([
  String.raw`(^|[\s;&|(\x60$])(rm|mv|cp|mkdir|touch|tee|kill|pkill|killall|ln|chmod|chown|truncate|dd|curl|wget|bun|node|python3?|nohup|setsid|wl-copy|notify-send|systemctl|ssh|scp|rsync|herdr-task|herdr-app|herdr-secret|herdr-artifact|hc)\b(?!\s+(ls|get|read|list|show|status)\b)`,
  String.raw`\bsed\s+-i`,
  String.raw`\bfind\b[^;|&]*-(delete|exec)`,
  String.raw`[^2&]>{1,2}\s*(?!/dev/null|&)`,
  String.raw`\bgit\s+(?!(status|log|rev-parse|branch|diff|show|rev-list|ls-files|merge-base|remote|symbolic-ref|for-each-ref|cat-file|describe|config\s+--get|-C\s))`,
].join('|'))

const base = (cmd: string) => cmd.split('/').pop() ?? cmd

export function classify(argv: string[], _app: string): 'read' | 'write' {
  const [cmd, ...args] = argv
  const name = base(cmd)
  if (name === 'sh' || name === 'bash') {
    const i = args.indexOf('-c')
    if (i < 0) return 'write'
    // Single-quoted text is data to the shell (an awk program, a pattern): its `>` writes nothing.
    const line = String(args[i + 1] ?? '').replace(/'[^']*'/g, "''")
    return WRITES.test(` ${line}`) ? 'write' : 'read'
  }
  if (name === 'hc') {
    if (args[0] === 'machine' && args[1] === 'ls') return 'read'
    if (args[0] === 'exec') {
      const rest = args.slice(1)
      while (rest[0]?.startsWith('-')) { if (rest[0] === '--on') rest.shift(); rest.shift() }
      if (rest[0] === '--') rest.shift()
      return rest.length ? classify(rest, _app) : 'write'
    }
    return HC_READ.has(args[0]) ? 'read' : 'write'
  }
  if (name === 'git') {
    const rest = [...args]
    while (rest[0]?.startsWith('-')) rest.splice(0, ['-C', '-c', '--git-dir', '--work-tree'].includes(rest[0]) ? 2 : 1)
    if (rest[0] === 'branch' && rest.some((a) => /^-[dDmM]|--delete|--move/.test(a))) return 'write'
    if (rest[0] === 'worktree' && rest[1] !== 'list') return 'write'
    if (rest[0] === 'config' && !rest.includes('--get') && !rest.includes('--list')) return 'write'
    return GIT_READ.has(rest[0]) ? 'read' : 'write'
  }
  if (TOOL_READ[name]) {
    const rest = [...args]
    while (rest[0] === '--on' || rest[0] === '--folder') rest.splice(0, 2)
    if (rest[0] === 'auto' && rest[1] === 'list') return 'read'
    return TOOL_READ[name].has(rest[0]) ? 'read' : 'write'
  }
  if (name === 'find') return args.some((a) => a === '-delete' || a.startsWith('-exec')) ? 'write' : 'read'
  return READ_CMDS.has(name) ? 'read' : 'write'
}

// The person's actions the PoC lets through (after a tap): send a message, press keys on a
// question, mark a chat read, accept a Ready task.
export function allowedWrite(argv: string[], _app: string): boolean {
  const [cmd, ...args] = argv
  const name = base(cmd)
  if (name === 'hc') {
    if (args[0] === 'send' || args[0] === 'keys') return true
    if (args[0] === 'label') return args.slice(2).every((a) => /^herdr\.(chat\.read|seen)=/.test(a))
  }
  if (name === 'herdr-task') { const rest = [...args]; while (rest[0] === '--on') rest.splice(0, 2); return rest[0] === 'accept' }
  return false
}
