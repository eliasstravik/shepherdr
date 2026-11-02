// Codex's log: ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl, lines {timestamp, type, payload}. The chat
// reads response_item messages (user and assistant), the request_user_input tools, event_msg turn starts and ends, and
// its steps: each item it logs once over (event_msg item_completed: a command, a patch, a tool), and while one runs the
// call that runs it. Its subagents start and end there too (SubAgentActivity); their own steps are in their own log.
import { words } from '../../../shared/activity.ts'
import { speedWord } from '../../../shared/models.ts'
import { codexCall, codexItem } from './steps.ts'
import type { AgentRuntime } from '../../../shared/types.ts'
import type { CliQuestionItem, LogEvent, Reader } from './types.ts'

type Json = any

// text Codex puts in a user message that the human did not type (for logs without content_item_kinds)
const INJECTED =
  /^\s*(# AGENTS\.md instructions|<(environment_context|user_instructions|user_shell_command|turn_aborted|subagent_notification|skill|INSTRUCTIONS)\b)/

// Codex's question tools. The sync one answers through its output; the async one returns {"accepted":true} at once
// and the human answers later, so a question of it stays open until the human next types.
// No real request_user_input call was in the logs we learned from: its shape follows Codex's own schema,
// {questions: [{id, header, question, options: [{label, description}], isOther}]}. The async one was seen with
// {questions: [{title}]}, and Codex's AsyncUserInputQuestion also has options.
const QUESTION_TOOLS = new Set(['request_user_input', 'request_user_input_async'])

/** its calls that are no step: waiting, and talking to its subagents (their start and end are steps of their own) */
const NO_STEP = new Set(['sleep', 'wait', 'wait_agent', 'send_message', 'list_agents', 'followup_task', 'spawn_agent', 'close_agent', 'update_plan'])

interface FileState {
  session: boolean
  /** open questions: call id -> answered by the tool's output (sync) or by the human's next message (async) */
  open: Map<string, 'output' | 'next-user'>
  /** calls shown as a step while they run, not over yet */
  calls: Set<string>
  /** it logs its items once over: a call only stands in for them while it runs */
  items: boolean
}

const parseLine = (text: string): Json => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** a whole record of what runs: a model or effort left out, or 'default', is the CLI's own */
function settings(model: Json, effort: Json, at: number): AgentRuntime {
  const set = typeof effort === 'string' && effort && effort !== 'default'
  return {
    source: 'session', at,
    ...(typeof model === 'string' && model !== 'default' ? { model } : {}),
    ...(set ? { effort } : { effortDefault: true }),
  }
}

const parseArgs = (a: Json): Json => (typeof a === 'string' ? parseLine(a) : a)

/** the human's words in a user message: only items Codex marks as typed text */
function userText(p: Json): string {
  const items: Json[] = Array.isArray(p.content) ? p.content : []
  const kinds: Json[] | undefined = p.internal_chat_message_metadata_passthrough?.content_item_kinds
  return items
    .map((it, i) => {
      if (it?.type !== 'input_text' || typeof it.text !== 'string') return ''
      if (Array.isArray(kinds) && kinds.length === items.length) return kinds[i] === 'user.text' ? it.text.trim() : ''
      return INJECTED.test(it.text) ? '' : it.text.trim()
    })
    .filter(Boolean)
    .join('\n\n')
}

function assistantText(p: Json): string {
  const items: Json[] = Array.isArray(p.content) ? p.content : []
  return items
    .filter((it) => it?.type === 'output_text' && typeof it.text === 'string' && it.text.trim())
    .map((it) => it.text.trim())
    .join('\n\n')
}

function questionItems(args: Json): CliQuestionItem[] {
  const qs: Json[] = Array.isArray(args?.questions) ? args.questions : []
  return qs.map((q) => {
    const options = (Array.isArray(q?.options) ? q.options : []).map((o: Json) =>
      typeof o === 'string' ? { label: o } : { label: String(o?.label ?? ''), description: o?.description },
    )
    return {
      header: typeof q?.header === 'string' ? q.header : undefined,
      question: String(q?.question ?? q?.title ?? ''),
      options,
      multiSelect: !!(q?.multiSelect ?? q?.multi_select),
      // a question without choices is answered by typing; Codex adds "Other" unless told not to
      allowCustom: options.length === 0 || (q?.isOther ?? q?.is_other ?? true) !== false,
    }
  })
}

export class CodexReader implements Reader {
  cli = 'codex'
  private files = new Map<string, FileState>()

  reset(file: string) {
    this.files.delete(file)
  }

  private state(file: string): FileState {
    let s = this.files.get(file)
    if (!s) {
      s = { session: false, open: new Map(), calls: new Set(), items: false }
      this.files.set(file, s)
    }
    return s
  }

  parse(lines: { text: string; offset: number }[], file: string): LogEvent[] {
    const s = this.state(file)
    const out: LogEvent[] = []
    for (const { text, offset } of lines) {
      // skip token counts, reasoning and tool runs without parsing them
      if (!/"type":\s*"(thread_settings_applied|turn_context|session_meta|message|function_call|custom_tool_call|function_call_output|custom_tool_call_output|task_started|task_complete|turn_aborted|token_count|item_completed)"/.test(text))
        continue
      const l = parseLine(text)
      const p = l?.payload
      if (!p || typeof p !== 'object') continue
      const t = Date.parse(l.timestamp ?? '') || 0

      if (l.type === 'turn_context') {
        const effort = p.effort ?? p.reasoning_effort ?? p.collaboration_mode?.settings?.reasoning_effort
        out.push({ kind: 'runtime', file, replace: true, id: `runtime-${offset}`, at: t, runtime: settings(p.model, effort, t) })
      } else if (l.type === 'event_msg' && p.type === 'thread_settings_applied') {
        // written at each turn's start and at once on /fast or /model; a thread with no tier set runs on the normal one
        const set = p.thread_settings
        if (!set || typeof set !== 'object') continue
        out.push({ kind: 'runtime', file, replace: true, id: `runtime-${offset}`, at: t, runtime: { ...settings(set.model, set.reasoning_effort, t), speed: speedWord(set.service_tier) ?? 'normal' } })
      } else if (l.type === 'session_meta') {
        const id = p.id ?? p.session_id
        if (s.session || typeof id !== 'string') continue
        s.session = true
        out.push({ kind: 'session', file, id: `session-${id}`, at: Date.parse(p.timestamp ?? '') || t, sessionId: id })
      } else if (l.type === 'response_item') {
        if (p.type === 'message' && p.role === 'user') {
          const words = userText(p)
          if (!words) continue
          for (const [id, how] of s.open) {
            if (how !== 'next-user') continue
            s.open.delete(id)
            out.push({ kind: 'answered', id, at: t })
          }
          out.push({ kind: 'user', id: String(p.id ?? `u${offset}`), at: t, text: words })
        } else if (p.type === 'message' && p.role === 'assistant') {
          const words = assistantText(p)
          if (words) out.push({ kind: 'agent', id: String(p.id ?? `a${offset}`), at: t, text: words })
        } else if ((p.type === 'function_call' || p.type === 'custom_tool_call') && QUESTION_TOOLS.has(p.name)) {
          const id = String(p.call_id ?? p.id ?? `q${offset}`)
          if (s.open.has(id)) continue
          s.open.set(id, p.name === 'request_user_input_async' ? 'next-user' : 'output')
          const items = questionItems(parseArgs(p.arguments ?? p.input))
          out.push({ kind: 'question', id, at: t, tool: p.name, items })
        } else if ((p.type === 'function_call' || p.type === 'custom_tool_call') && !NO_STEP.has(p.name)) {
          const id = String(p.call_id ?? p.id ?? `c${offset}`)
          if (s.calls.has(id)) continue
          s.calls.add(id)
          const st = codexCall(String(p.name ?? ''), parseArgs(p.arguments ?? p.input) ?? p.input)
          const { step, ...said } = st
          out.push({ kind: 'step', id, at: t, step, tool: String(p.name ?? ''), ...said })
        } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
          const id = String(p.call_id ?? '')
          const refused = /Rejected\W{1,8}(The human declined|Shepherdr (closed|could not))/.test(JSON.stringify(p.output ?? ''))
          if (s.calls.delete(id)) out.push({ kind: 'step-end', id, at: t, out: { file, offset }, drop: s.items || undefined, ...(refused ? { refused: 'you' as const } : {}) })
          if (s.open.get(id) !== 'output') continue
          s.open.delete(id)
          out.push({ kind: 'answered', id, at: t })
        }
      } else if (l.type === 'event_msg' && p.type === 'item_completed') {
        const it = p.item
        if (it?.type === 'SubAgentActivity' && typeof it.agent_thread_id === 'string') {
          const title = String(it.agent_path ?? '').split('/').at(-1)?.replace(/_/g, ' ') || 'Subagent'
          if (it.kind === 'started') {
            out.push({ kind: 'step', id: String(it.id ?? it.agent_thread_id), at: t, step: 'agent', tool: 'spawn_agent', ...words(`Ask a subagent: ${title}`), end: t })
            out.push({ kind: 'job', id: it.agent_thread_id, at: t, job: 'agent', title, step: String(it.id ?? '') })
          } else if (it.kind === 'completed') out.push({ kind: 'job-end', id: it.agent_thread_id, at: t })
          continue
        }
        const st = codexItem(it)
        if (!st) continue
        s.items = true
        const end = typeof p.completed_at_ms === 'number' ? p.completed_at_ms : t
        const { step, ...said } = st
        out.push({ kind: 'step', id: String(it.id ?? `i${offset}`), at: typeof p.started_at_ms === 'number' ? p.started_at_ms : end, step, ...said, end, out: { file, offset } })
      } else if (l.type === 'event_msg' && p.type === 'token_count') {
        const tokens = p.info?.last_token_usage?.total_tokens
        if (typeof tokens === 'number' && tokens > 0) out.push({ kind: 'usage', id: `usage-${offset}`, at: t, tokens })
      } else if (l.type === 'event_msg' && p.type === 'task_started') {
        out.push({ kind: 'turn-start', id: `start-${p.turn_id ?? offset}`, at: t })
      } else if (l.type === 'event_msg' && (p.type === 'task_complete' || p.type === 'turn_aborted')) {
        const err = p.error
        if (err && typeof err === 'object') out.push({ kind: 'error', id: `error-${p.turn_id ?? offset}`, at: t, text: String(err.message ?? ''), code: typeof err.codex_error_info === 'string' ? err.codex_error_info : undefined })
        out.push({ kind: 'turn-end', id: `turn-${p.turn_id ?? offset}`, at: t, ...(p.type === 'turn_aborted' || err ? { aborted: true } : {}) })
      }
    }
    return out
  }
}
