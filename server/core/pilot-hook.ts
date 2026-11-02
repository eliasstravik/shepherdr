import { posix } from 'node:path'
import { toolHash } from './envelope.ts'
import type { AgentHook, AgentKind } from './model.ts'

const EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd', 'PermissionRequest', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'SubagentStart', 'SubagentStop'])

/** Map an inside-provider path to the private capture tree; never treat it as a host source path. */
export function pilotHook(input: unknown, id: string, kind: AgentKind, home: string, captures: string, now = Date.now()): AgentHook {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid contained hook')
  const value = input as Record<string, unknown>
  if (typeof value.hook_event_name !== 'string' || !EVENTS.has(value.hook_event_name) || !/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid contained hook event')
  const text = (key: string, max: number) => typeof value[key] === 'string' ? (value[key] as string).slice(0, max) : undefined
  let transcript: string | undefined
  if (value.transcript_path !== undefined && value.transcript_path !== '') {
    const path = value.transcript_path
    if (typeof path !== 'string' || path.length > 4096 || /[\\\x00-\x1f\x7f]/.test(path) || !posix.isAbsolute(path) || posix.normalize(path) !== path) throw Error('Invalid contained transcript path')
    const relative = posix.relative(home, path), prefix = kind === 'claude' ? '.claude/projects/' : '.codex/sessions/'
    if (!relative.startsWith(prefix) || !relative.endsWith('.jsonl') || relative.length > 2048 || relative.split('/').length > 64) throw Error('Contained transcript is outside its provider history')
    transcript = posix.join(captures, relative)
  }
  return { id, event: value.hook_event_name, at: now, session: text('session_id', 128), transcript, agent: text('agent_id', 128), model: text('model', 128), tool: text('tool_name', 128), mode: text('permission_mode', 32),
    use: text('tool_use_id', 128), turn: text('turn_id', 128) ?? text('prompt_id', 128), input: value.tool_input === undefined ? text('tool_hash', 24) : toolHash(value.tool_input) }
}
