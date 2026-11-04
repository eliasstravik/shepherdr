// An agent's activity in plain words: each step as what it did ("Checked the task list", "Read app.ts"), a turn's steps
// grouped into rows that read at a glance ("Edited 2 files: app.ts, panel.tsx"), background work counted ("2 subagents
// working"), and how long.
import type { Job, Step, StepKind, StepRow, StepWords } from './types.ts'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/* ---------- a verb as done and as doing ---------- */

const PAST: Record<string, string> = {
  build: 'built', buy: 'bought', catch: 'caught', choose: 'chose', do: 'did', draw: 'drew', find: 'found', get: 'got', give: 'gave',
  go: 'went', hold: 'held', keep: 'kept', let: 'let', make: 'made', put: 'put', read: 'read', rebuild: 'rebuilt', rerun: 'reran',
  run: 'ran', see: 'saw', seek: 'sought', send: 'sent', set: 'set', show: 'showed', sit: 'sat', split: 'split', spin: 'spun',
  take: 'took', tell: 'told', think: 'thought', undo: 'undid', write: 'wrote', rewrite: 'rewrote', feed: 'fed', leave: 'left',
  upset: 'upset', cut: 'cut', shut: 'shut', begin: 'began', bring: 'brought', fetch: 'fetched', redo: 'redid',
}
/** short verbs that double their last letter: stop, stopped, stopping */
const DOUBLE = new Set(['stop', 'plan', 'drop', 'swap', 'ship', 'grab', 'skip', 'step', 'tag', 'zip', 'map', 'wrap', 'commit', 'trim', 'chop', 'scan', 'pin', 'unpin', 'log', 'prep', 'rerun', 'run', 'get', 'set', 'put', 'cut', 'shut', 'begin', 'spin', 'sit', 'upset', 'nag', 'jog', 'snap', 'strip', 'submit', 'grep'])
/** words an agent starts its short description with: a verb, so it reads done and doing; any other word is left as it is */
const VERBS = new Set([
  ...Object.keys(PAST), ...DOUBLE, 'add', 'apply', 'ask', 'bump', 'call', 'change', 'check', 'clean', 'clear', 'clone', 'close', 'compare',
  'compile', 'confirm', 'copy', 'count', 'create', 'debug', 'delete', 'deploy', 'download', 'dump', 'edit', 'ensure', 'export', 'extract',
  'fix', 'follow', 'format', 'generate', 'grep', 'import', 'inspect', 'install', 'kill', 'launch', 'lint', 'list', 'load', 'locate', 'look',
  'measure', 'merge', 'move', 'note', 'open', 'parse', 'patch', 'pause', 'pick', 'post', 'preview', 'print', 'probe', 'publish', 'pull',
  'push', 'query', 'rebase', 'record', 'reload', 'remove', 'rename', 'render', 'replace', 'reply', 'report', 'request', 'reset', 'resize',
  'restart', 'restore', 'resume', 'retry', 'return', 'review', 'revert', 'save', 'search', 'serve', 'share', 'sort', 'stage', 'start',
  'stash', 'switch', 'sync', 'test', 'time', 'touch', 'trace', 'try', 'type', 'unzip', 'update', 'upload', 'use', 'validate', 'verify',
  'view', 'wait', 'watch', 'remember', 'mark', 'fill', 'type', 'click', 'scroll', 'navigate', 'capture', 'screenshot', 'snapshot',
  'collect', 'gather', 'summarize', 'research', 'study', 'explore', 'investigate', 'analyze', 'audit', 'benchmark', 'convert', 'decode',
  'encode', 'archive', 'unpack', 'tidy', 'bundle', 'compress', 'tail', 'kick', 'refresh', 'enable', 'disable', 'toggle', 'tweak', 'append',
  'prepend', 'insert', 'show', 'turn', 'hand', 'draft', 'answer', 'tell', 'warn', 'notify', 'alert', 'schedule', 'queue', 'cancel', 'boot',
])

const vowel = (c: string) => 'aeiou'.includes(c)

function past(v: string) {
  if (PAST[v]) return PAST[v]
  if (DOUBLE.has(v)) return `${v}${v.at(-1)}ed`
  if (v.endsWith('e')) return `${v}d`
  if (v.endsWith('y') && !vowel(v.at(-2) ?? '')) return `${v.slice(0, -1)}ied`
  return `${v}ed`
}

function ing(v: string) {
  if (v.endsWith('ie')) return `${v.slice(0, -2)}ying`
  if (DOUBLE.has(v)) return `${v}${v.at(-1)}ing`
  if (v.endsWith('e') && !/(ee|ye|oe)$/.test(v) && v !== 'be') return `${v.slice(0, -1)}ing`
  return `${v}ing`
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** an action said as a command ("Check the task list") as done, as doing and as not begun: "Checked the task list",
 *  "Checking the task list", "Wants to check the task list". Words that don't start with a verb it knows stay as they
 *  are. */
export function say(words: string): { title: string; doing: string; wants: string } {
  const t = words.replace(/\s+/g, ' ').trim().replace(/[.…]+$/, '')
  const m = /^([A-Za-z]+)\b(.*)$/.exec(t)
  const v = m?.[1].toLowerCase()
  if (!m || !v || !VERBS.has(v)) return { title: cap(t), doing: cap(t), wants: `Wants to: ${t}` }
  // a second action after "and" goes the same way: "Clone the repo and find the code"
  const rest = (f: (v: string) => string) => m[2].replace(/\b(and(?: then)?) ([a-z]+)\b/g, (x, and: string, w: string) => (VERBS.has(w) ? `${and} ${f(w)}` : x))
  return { title: cap(past(v)) + rest(past), doing: cap(ing(v)) + rest(ing), wants: `Wants to ${v}${m[2]}` }
}

/** a step's words from an action said as a command: say() with what it is on, and the rest */
export const words = (action: string, target = '', x: Partial<StepWords> = {}): StepWords => ({ ...say(action), target, ...x })

/** a test run's outcome from its output: "41 passed", "2 failed, 39 passed"; none where it says no counts */
export function testResult(output: string): string | undefined {
  const tail = output.slice(-4000)
  const num = (re: RegExp) => {
    const all = [...tail.matchAll(re)]
    return all.length ? Number(all.at(-1)![1]) : undefined
  }
  const passed = num(/(\d+)\s+(?:tests?\s+)?pass(?:ed|es|ing)?\b/gi)
  const failed = num(/(\d+)\s+(?:tests?\s+)?(?:fail(?:ed|s|ures?|ing)?|errors?)\b/gi)
  if (passed === undefined && failed === undefined) return undefined
  return [failed ? `${failed} failed` : '', passed !== undefined ? `${passed} passed` : ''].filter(Boolean).join(', ') || undefined
}

/* ---------- a turn's steps as rows ---------- */

/** which rows say most, first: changes and test runs before reading and searching */
const WEIGHT: Record<StepKind, number> = { edit: 0, run: 1, agent: 2, web: 3, other: 4, search: 5, read: 6 }

/** names, at most three, then how many more: "a.ts, b.ts, c.ts +2" */
const names = (xs: string[]) => xs.slice(0, 3).join(', ') + (xs.length > 3 ? ` +${xs.length - 3}` : '')

/** a step's own line: its words, and a test run's outcome */
export const stepText = (s: Pick<Step, 'title' | 'result'>) => (s.result ? `${s.title}: ${s.result}` : s.title)

/**
 * A turn's steps grouped into rows, in the order they first happened: the files it read in one row ("Read 3 files:
 * a.ts, b.ts, c.ts"), the files it changed in one ("Edited 2 files: app.ts, panel.tsx", lines added and removed), its
 * code searches in one; any other step a row of its own, the same words twice one row.
 */
export function rowsOf(steps: Step[]): StepRow[] {
  const rows: (StepRow & { group: Step[] })[] = []
  const by = new Map<string, StepRow & { group: Step[] }>()
  for (const s of steps) {
    const grouped = !s.unrun && ((s.kind === 'read' && s.target && s.tool !== 'WebFetch') || (s.kind === 'edit' && s.target) || (s.kind === 'search' && s.target))
    const key = grouped ? s.kind : `${s.kind}:${stepText(s)}`
    let r = by.get(key)
    if (!r) {
      r = { key, kind: s.kind, text: '', steps: [], group: [] }
      by.set(key, r)
      rows.push(r)
    }
    r.steps.push(s.id)
    r.group.push(s)
  }
  return rows.map(({ group, ...r }) => {
    const failed = group.filter((s) => s.failed).length || undefined
    if (group.length === 1 || !['read', 'edit', 'search'].includes(r.key)) return { ...r, text: stepText(group.at(-1)!), failed, ...lines(group) }
    // files by their whole path (two index.ts are two files), shown by their names
    const files = new Map(group.map((s) => [s.detail || s.target, s.target]))
    const targets = [...files.values()]
    if (r.key === 'search') return { ...r, text: `Searched for ${names([...new Set(targets)])}`, failed }
    if (targets.length === 1) return { ...r, text: group[0].title, failed, ...lines(group) }
    const what = `${r.key === 'read' ? 'Read' : 'Edited'} ${plural(targets.length, 'file')}: ${names(targets)}`
    return { ...r, text: what, failed, ...lines(group) }
  })
}

/** an edit row's lines added and removed, summed */
function lines(group: Step[]): Pick<StepRow, 'added' | 'removed'> {
  if (group[0].kind !== 'edit') return {}
  const added = group.reduce((n, s) => n + (s.added ?? 0), 0)
  const removed = group.reduce((n, s) => n + (s.removed ?? 0), 0)
  return added || removed ? { added, removed } : {}
}

/** the rows that say most, at most `max`, in the order they happened; and how many more there are */
export function glance(rows: StepRow[], max = 3): { rows: StepRow[]; more?: number } {
  if (rows.length <= max) return { rows }
  const order = new Map(rows.map((r, i) => [r, i]))
  const top = [...rows].sort((a, b) => (b.failed ? 1 : 0) - (a.failed ? 1 : 0) || WEIGHT[a.kind] - WEIGHT[b.kind] || order.get(a)! - order.get(b)!).slice(0, max)
  return { rows: top.sort((a, b) => order.get(a)! - order.get(b)!), more: rows.length - max }
}

/** "42s", "4m 12s" (or "4m"), "1h 3m" */
export function took(ms: number, seconds = true) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return seconds && s % 60 ? `${m}m ${s % 60}s` : `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export type JobCounts = Partial<Record<Job['kind'], number>>

export const countJobs = (jobs: Job[]): JobCounts => {
  const c: JobCounts = {}
  for (const j of jobs) c[j.kind] = (c[j.kind] ?? 0) + 1
  return c
}

/** "2 subagents working", "1 shell running", "1 subagent · 2 shells": headless agents it runs count as subagents too */
export function jobsWords(c: JobCounts) {
  const parts = [
    [(c.agent ?? 0) + (c.headless ?? 0), 'subagent'],
    [c.shell ?? 0, 'shell'],
    [c.monitor ?? 0, 'watcher'],
  ] as const
  const shown = parts.filter(([n]) => n)
  if (shown.length !== 1) return shown.map(([n, w]) => plural(n, w)).join(' · ')
  const [n, w] = shown[0]
  return `${plural(n, w)} ${w === 'subagent' ? 'working' : 'running'}`
}
