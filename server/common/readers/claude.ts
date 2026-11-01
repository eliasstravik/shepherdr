// Claude Code's log: ~/.claude/projects/<project>/<sessionId>.jsonl, one JSON object per line. Most lines are
// bookkeeping (mode, attachment, api-request, file-history...); the chat needs the human's prompts, the visible text
// of replies, AskUserQuestion and its answer, where a turn starts and ends, and its tool steps and background work (a
// subagent's own steps are in its own log, subagents/agent-<id>.jsonl beside the session's: read with `sub`).
import { basename, dirname, join } from 'node:path'
import { isCommand } from '../commands.ts'
import { testResult } from '../../../shared/activity.ts'
import { speedWord } from '../../../shared/models.ts'
import type { AgentRuntime } from '../../../shared/types.ts'
import { claudeStep, toolName } from './steps.ts'
import type { CliQuestionItem, LogEvent, Reader } from './types.ts'

type Json = any

// text Claude Code puts in a user line that the human did not type
const INJECTED =
  /^\s*(<(local-command-|system-reminder|bash-|task-notification|user-memory-input|user-prompt-submit-hook)|Caveat: The messages below|\[Request interrupted)/

// a reply's message id is on every line of it, so we join split lines by id; a few ids are plenty to remember
const KEEP_REPLIES = 20

interface FileState {
  session: boolean
  replies: Map<string, string[]>
  /** questions shown, and those still waiting for their answer */
  asked: Set<string>
  open: Set<string>
  /** the turn-end for the current turn was sent (end_turn and turn_duration both mark it; send one); the next turn's
   *  start is sent once, too */
  ended: boolean
  /** the last command run in Claude Code itself: /compact is written twice, before and after its summary */
  command?: { text: string; at: number }
  /** steps shown and not over yet, by tool call id: their tool and words (a background job takes them as its title) */
  steps: Map<string, { tool: string; title: string; test?: boolean; stopJob?: string }>
  seen: Set<string>
  /** the folder its background shells write their output to, learned from one */
  tasks?: string
}

/** steps remembered as not over: one cut off (Esc) never gets its result */
const KEEP_STEPS = 200

/** what background work that woke it says: each notice's task id, its output file, and whether it is over */
export function notices(text: string): { id: string; output?: string; over: boolean }[] {
  return text
    .split('<task-notification>')
    .slice(1)
    .flatMap((n) => {
      const body = n.split('</task-notification>')[0]
      const tag = (t: string) => new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(body)?.[1]?.trim()
      const id = tag('task-id')
      if (!id) return []
      const status = tag('status')
      // a subagent that stopped while work of its own still runs is woken again by it: not over
      const paused = /is waiting on its own background work$/.test(tag('summary') ?? '') || /^This agent stopped with background work of its own still running\b/.test(tag('note') ?? '')
      return [{ id, output: tag('output-file'), over: !!status && status !== 'running' && !paused }]
    })
}

const parseLine = (text: string): Json => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const timeOf = (l: Json) => Date.parse(l?.timestamp ?? '') || 0

/** a slash command the human typed comes wrapped in tags: show it as typed */
function slashCommand(t: string): string | undefined {
  const name = /<command-name>([^<]*)<\/command-name>/.exec(t)?.[1]
  if (!name) return undefined
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(t)?.[1] ?? ''
  return `${name.trim()} ${args.trim()}`.trim()
}

/** what a command run in Claude Code itself printed (/model: "Set model to …"), as plain text: its answer in the chat */
function commandOutput(t: string): string | undefined {
  const m = /<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>/.exec(t)
  if (!m) return undefined
  const out = m[2].replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\s+$/, '').replace(/^\s*\n/, '')
  if (!out.trim()) return ''
  // a drawing or table keeps its lines and columns
  return out.includes('\n') ? `\`\`\`\n${out}\n\`\`\`` : out.trim()
}

/** what Claude Code's own /model, /effort and /fast say they changed: they log no other record until its next reply */
function commandRuntime(said: string, at: number): AgentRuntime | undefined {
  // output of more lines than one comes in a code fence (commandOutput); one command can say two things
  const line = (re: RegExp) => re.exec(said.replace(/^```\n/, ''))?.[1]
  const model = line(/^Set model to `?([^`\n]+?)`?(?= and | for | with | \(|$)/m)
  const effort = line(/^(?:Set effort level to|Effort level set to) ([a-z]+)\b/m)
  const fast = line(/^Fast mode (ON|OFF)\b/m)
  if (!model && !effort && !fast) return undefined
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(fast ? { speed: fast === 'ON' ? 'fast' : 'normal' } : {}), source: 'session', at }
}

/** the human's words in one text, or '' when it is something Claude Code wrote */
function cleanText(t: string): string {
  const cmd = slashCommand(t)
  if (cmd !== undefined) return cmd
  if (INJECTED.test(t)) return ''
  return t
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    // a long paste is kept in tags (the terminal shows "[Pasted text #1]"): show what was pasted
    .replace(/<\/?pasted_content\b[^>]*>\n?/g, '')
    .trim()
}

/** the text of user content (a string or blocks), or '' when it holds tool results or only injected text */
function userContent(c: Json): string {
  if (typeof c === 'string') return cleanText(c)
  if (!Array.isArray(c) || c.some((b) => b?.type === 'tool_result')) return ''
  return c
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => cleanText(b.text))
    .filter(Boolean)
    .join('\n\n')
}

const interrupted = (c: Json) =>
  (typeof c === 'string' ? [c] : Array.isArray(c) ? c.map((b) => b?.text) : []).some(
    (t) => typeof t === 'string' && t.startsWith('[Request interrupted'),
  )

/** a line the human typed: not meta, not a subagent, not a summary, not something another part wrote */
function isHumanLine(l: Json): boolean {
  if (l.isMeta || l.isSidechain || l.isCompactSummary || l.isVisibleInTranscriptOnly) return false
  const kind = l.origin?.kind
  return !kind || kind === 'human'
}

function questionItems(input: Json): CliQuestionItem[] {
  const qs: Json[] = Array.isArray(input?.questions) ? input.questions : []
  return qs.map((q) => ({
    header: typeof q?.header === 'string' ? q.header : undefined,
    question: String(q?.question ?? ''),
    options: (Array.isArray(q?.options) ? q.options : []).map((o: Json) =>
      typeof o === 'string' ? { label: o } : { label: String(o?.label ?? ''), description: o?.description },
    ),
    multiSelect: !!q?.multiSelect,
    // Claude Code always offers "Other" with a typed answer
    allowCustom: true,
  }))
}

export class ClaudeReader implements Reader {
  cli = 'claude'
  private files = new Map<string, FileState>()

  /** sub: a subagent's own log, whose lines are all its own (sidechain): only its steps are read */
  constructor(private sub = false) {}

  reset(file: string) {
    this.files.delete(file)
  }

  private state(file: string): FileState {
    let s = this.files.get(file)
    if (!s) {
      s = { session: false, replies: new Map(), asked: new Set(), open: new Set(), ended: true, steps: new Map(), seen: new Set() }
      this.files.set(file, s)
    }
    return s
  }

  parse(lines: { text: string; offset: number }[], file: string): LogEvent[] {
    const s = this.state(file)
    const out: LogEvent[] = []
    // where each reply sits in `out`, so a later line of the same reply updates it instead of adding another
    const at = new Map<string, number>()
    const turnEnd = (id: string, t: number) => {
      if (s.ended) return
      s.ended = true
      out.push({ kind: 'turn-end', id, at: t })
    }
    const turnStart = (id: string, t: number) => {
      if (!s.ended) return
      s.ended = false
      out.push({ kind: 'turn-start', id, at: t })
    }

    // a command written again soon after is the same one
    const once = (cmd: string, at: number) => {
      const again = s.command?.text === cmd && Math.abs(at - s.command.at) < 120_000
      s.command = { text: cmd, at }
      return !again
    }

    for (const { text, offset } of lines) {
      // skip the big bookkeeping lines without parsing them
      if (s.session && !/"type":\s*"(user|assistant|system|queued_command)"/.test(text)) continue
      const l = parseLine(text)
      if (!l || typeof l !== 'object') continue
      const t = timeOf(l)

      if (!s.session && typeof l.sessionId === 'string' && t) {
        s.session = true
        out.push({ kind: 'session', file, id: `session-${l.sessionId}`, at: t, sessionId: l.sessionId })
      }

      if (this.sub) {
        if (l.type === 'user' || l.type === 'assistant') this.steps(l, s, out, t, file, offset)
        continue
      }

      if (l.type === 'assistant' && !l.isSidechain && !l.isApiErrorMessage && typeof l.message?.model === 'string' && !l.message.model.startsWith('<')) {
        const speed = speedWord(l.message.usage?.speed)
        out.push({ kind: 'runtime', file, id: `runtime-${offset}`, at: t, runtime: {
          model: l.message.model, source: 'session', at: t,
          ...(typeof l.effort === 'string' && l.effort ? { effort: l.effort } : {}),
          ...(speed ? { speed } : {}),
        } })
      }
      if (l.type === 'user') {
        const c = l.message?.content
        // answers to our questions come back as tool results
        if (Array.isArray(c)) {
          for (const b of c) {
            if (b?.type === 'tool_result' && s.open.has(b.tool_use_id)) {
              s.open.delete(b.tool_use_id)
              out.push({ kind: 'answered', id: b.tool_use_id, at: t })
            }
          }
        }
        if (!l.isSidechain) this.steps(l, s, out, t, file, offset)
        // background work that is over says so in the notice that wakes it
        if (!l.isSidechain && l.origin?.kind === 'task-notification') this.over(typeof c === 'string' ? c : '', s, out, t)
        // a background job (a subagent, a shell) that finished wakes the agent into a turn of its own
        if (!l.isSidechain && l.origin?.kind === 'task-notification') turnStart(`start-${l.uuid ?? offset}`, t)
        if (!isHumanLine(l)) continue
        // the human pressed Esc: the turn is over
        if (interrupted(c)) turnEnd(`turn-${l.uuid ?? offset}`, t)
        const said = typeof c === 'string' ? commandOutput(c) : undefined
        if (said !== undefined) {
          if (said) out.push({ kind: 'agent', id: String(l.uuid ?? `o${offset}`), at: t, text: said })
          const runtime = said ? commandRuntime(said, t) : undefined
          if (runtime) out.push({ kind: 'runtime', file, id: `runtime-${offset}`, at: t, runtime })
          continue
        }
        const words = userContent(c)
        if (!words) continue
        // a command Claude Code runs itself (/clear, /model) is no turn; one that prompts the model (a skill's) starts
        // its turn with the reply
        // (/compact is written as typed first, then again in tags under its summary)
        if (typeof c === 'string' && (slashCommand(c) || isCommand(c))) {
          if (!once(words, t)) continue
        } else turnStart(`start-${l.uuid ?? offset}`, t)
        out.push({ kind: 'user', id: String(l.uuid ?? `u${offset}`), at: t, text: words })
      } else if (l.type === 'attachment' && l.attachment?.type === 'queued_command') {
        // a prompt typed while the agent was busy and taken in mid-turn: it never shows up as a user line
        const a = l.attachment
        if (!l.isSidechain && a.commandMode === 'task-notification' && typeof a.prompt === 'string') this.over(a.prompt, s, out, Date.parse(a.timestamp ?? '') || t)
        if (l.isSidechain || a.commandMode !== 'prompt' || (a.origin?.kind && a.origin.kind !== 'human')) continue
        const words = userContent(a.prompt)
        if (words) out.push({ kind: 'user', id: String(l.uuid), at: Date.parse(a.timestamp ?? '') || t, text: words })
      } else if (l.type === 'assistant') {
        if (l.isSidechain) continue
        const m = l.message ?? {}
        const id = String(m.id ?? l.uuid)
        const blocks: Json[] = Array.isArray(m.content) ? m.content : []
        if (!s.replies.has(id)) turnStart(`start-${id}`, t)
        const texts = blocks
          .filter((b) => b?.type === 'text' && typeof b.text === 'string' && b.text.trim())
          .map((b) => b.text.trim())
        if (texts.length) {
          const all = [...(s.replies.get(id) ?? []), ...texts]
          s.replies.set(id, all)
          const ev: LogEvent = { kind: 'agent', id, at: t, text: all.join('\n\n') }
          const i = at.get(id)
          if (i === undefined) {
            at.set(id, out.length)
            out.push(ev)
          } else out[i] = ev
        } else if (!s.replies.has(id)) s.replies.set(id, [])
        if (s.replies.size > KEEP_REPLIES) s.replies.delete(s.replies.keys().next().value!)

        // what the call used; the split lines of one reply repeat it, and the later line replaces the earlier
        const u = m.usage
        if (u && typeof u === 'object') {
          const tokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0)
          if (tokens) out.push({ kind: 'usage', id: `usage-${id}`, at: t, tokens })
        }
        this.steps(l, s, out, t, file, offset)
        for (const b of blocks) {
          if (b?.type !== 'tool_use' || b.name !== 'AskUserQuestion' || s.asked.has(b.id)) continue
          s.asked.add(b.id)
          s.open.add(b.id)
          out.push({ kind: 'question', id: String(b.id), at: t, tool: 'AskUserQuestion', items: questionItems(b.input) })
        }
        // the reply's text line carries the final stop reason; turn_duration (below) covers replies without text
        if (m.stop_reason === 'end_turn' && texts.length) turnEnd(`turn-${id}`, t)
        // the API failed for good (Claude Code retried it already): the turn is over
        if (l.isApiErrorMessage) {
          out.push({ kind: 'error', id: `error-${l.uuid ?? id}`, at: t, text: texts.join('\n'), code: typeof l.error === 'string' ? l.error : undefined, status: typeof l.apiErrorStatus === 'number' ? l.apiErrorStatus : undefined })
          turnEnd(`turn-${id}`, t)
        }
      } else if (l.type === 'system' && l.subtype === 'turn_duration') {
        turnEnd(`turn-${l.uuid}`, t)
      } else if (l.type === 'system' && l.subtype === 'local_command' && typeof l.content === 'string' && !l.isSidechain) {
        // a command Claude Code ran itself, as typed, and what it printed
        const cmd = slashCommand(l.content)
        const said = cmd === undefined ? commandOutput(l.content) : undefined
        if (cmd && once(cmd, t)) out.push({ kind: 'user', id: String(l.uuid ?? `u${offset}`), at: t, text: cmd })
        else if (said) {
          out.push({ kind: 'agent', id: String(l.uuid ?? `o${offset}`), at: t, text: said })
          const runtime = commandRuntime(said, t)
          if (runtime) out.push({ kind: 'runtime', file, id: `runtime-${offset}`, at: t, runtime })
        }
      }
    }
    return out
  }

  /** a line's tool calls as steps, and the results that end them; a result that says work went on in the background
   *  starts a job: a shell (its output file), a subagent (its own log), a monitor */
  private steps(l: Json, s: FileState, out: LogEvent[], t: number, file: string, offset: number) {
    const blocks: Json[] = Array.isArray(l.message?.content) ? l.message.content : []
    for (const b of blocks) {
      if (l.type === 'assistant' && b?.type === 'tool_use' && typeof b.id === 'string' && !s.seen.has(b.id)) {
        const st = claudeStep(String(b.name ?? ''), b.input)
        if (!st) continue
        s.seen.add(b.id)
        s.steps.set(b.id, { tool: String(b.name), title: st.doing, test: st.test,
          ...(b.name === 'TaskStop' && typeof b.input?.task_id === 'string' ? { stopJob: b.input.task_id } : {}) })
        if (s.steps.size > KEEP_STEPS) s.steps.delete(s.steps.keys().next().value!)
        if (s.seen.size > KEEP_STEPS * 5) s.seen.delete(s.seen.values().next().value!)
        const { step, ...said } = st
        out.push({ kind: 'step', id: b.id, at: t, step, tool: toolName(String(b.name)), ...said })
      } else if (l.type === 'user' && b?.type === 'tool_result' && s.steps.has(b.tool_use_id)) {
        const st = s.steps.get(b.tool_use_id)!
        s.steps.delete(b.tool_use_id)
        const said = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x: Json) => x?.text ?? '').join('\n') : ''
        const result = st.test ? testResult(said) : undefined
        const refused = said.startsWith("The user doesn't want to proceed") || /^(The human declined|Shepherdr (closed|could not))/.test(said) ? 'you' as const : b.is_error === true && /^Permission [^\n]* denied\b/.test(said) ? 'cli' as const : undefined
        out.push({ kind: 'step-end', id: b.tool_use_id, at: t, failed: b.is_error === true || undefined, out: { file, offset }, ...(result ? { result } : {}), ...(refused ? { refused } : {}) })
        if (this.sub) continue
        const r = l.toolUseResult
        if (!r || typeof r !== 'object') continue
        if (st.stopJob && !b.is_error && r.task_id === st.stopJob && typeof r.message === 'string') {
          const success = `Successfully stopped task: ${st.stopJob}`
          if (r.message === success || r.message.startsWith(success + ' ')) out.push({ kind: 'job-end', id: st.stopJob, at: t })
        }
        if (typeof r.backgroundTaskId === 'string') {
          const output = /Output is being written to: (\S+\.output)/.exec(said)?.[1]
          if (output) s.tasks = dirname(output)
          out.push({ kind: 'job', id: r.backgroundTaskId, at: t, job: 'shell', title: st.title, step: b.tool_use_id, output })
        } else if (r.isAsync && typeof r.agentId === 'string') {
          const log = join(dirname(file), basename(file, '.jsonl'), 'subagents', `agent-${r.agentId}.jsonl`)
          out.push({ kind: 'job', id: r.agentId, at: t, job: 'agent', title: String(r.description ?? st.title), step: b.tool_use_id, log })
        } else if (st.tool === 'Monitor' && typeof r.taskId === 'string') {
          out.push({ kind: 'job', id: r.taskId, at: t, job: 'monitor', title: st.title, step: b.tool_use_id, output: s.tasks && join(s.tasks, `${r.taskId}.output`) })
        }
      }
    }
  }

  /** the notices of background work that woke it: each one that is over ends its job */
  private over(text: string, s: FileState, out: LogEvent[], t: number) {
    for (const n of notices(text)) {
      if (n.output?.endsWith('.output') && !s.tasks) s.tasks = dirname(n.output)
      if (n.over) out.push({ kind: 'job-end', id: n.id, at: t })
    }
  }
}
