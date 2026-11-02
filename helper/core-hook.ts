#!/usr/bin/env bun
// Per-launch hooks for core agents. No HTTP, caller-selected chat authority, or screen scraping.
import { appendFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { readCredential } from '../server/core/home.ts'
import { coreRequest } from '../server/core/request.ts'
import type { CoreEndpoint } from '../server/core/client.ts'
import { toolHash, type MailCredential } from '../server/core/envelope.ts'
import type { AgentHook } from '../server/core/model.ts'
import type { PermissionAnswer } from '../server/core/native-asks.ts'

const credentialFile = process.env.SHEPHERDR_CORE_CREDENTIAL
const hookFile = process.env.SHEPHERDR_CORE_HOOK_FILE
let permission = false
try {
  const raw = await Bun.stdin.text()
  if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('Hook input too large')
  const input = JSON.parse(raw)
  permission = input.hook_event_name === 'PermissionRequest'
  if (!credentialFile || !hookFile || typeof input.hook_event_name !== 'string') throw new Error('Missing launch identity')
  const credential = readCredential<{ mail: MailCredential; socket?: string; endpoint?: CoreEndpoint }>(credentialFile)
  const cut = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : undefined
  const event: AgentHook = {
    id: randomUUID(), event: input.hook_event_name, at: Date.now(), session: cut(input.session_id, 128),
    transcript: cut(input.transcript_path, 4096), agent: cut(input.agent_id, 128), model: cut(input.model, 128), tool: cut(input.tool_name, 128), mode: cut(input.permission_mode, 32),
    use: cut(input.tool_use_id, 128), turn: cut(input.turn_id ?? input.prompt_id, 128), ...(input.tool_input === undefined ? {} : { input: toolHash(input.tool_input) }),
  }
  appendFileSync(hookFile, JSON.stringify(event) + '\n', { mode: 0o600 })
  if (permission) {
    const endpoint = credential.endpoint ?? credential.socket ?? (() => { throw new Error('Missing core endpoint') })()
    // The CLI stops this hook when its own prompt is declined or interrupted: the card goes with it.
    const stopped = (signal: string) => { void coreRequest(endpoint, credential.mail, 'permission', { cancel: event.id, gone: signal === 'SIGHUP' }, { timeout: 4000 }).catch(() => {}).finally(() => process.exit(0)) }
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(signal, stopped)
    const answer = await coreRequest(endpoint, credential.mail, 'permission', {
      id: event.id, tool: event.tool, input: input.tool_input, suggestions: input.permission_suggestions, session: event.session, agent: event.agent, turn: event.turn, at: event.at,
    }, { id: event.id, timeout: 3_500_000 }) as PermissionAnswer
    const { allow, ...reply } = answer
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: {
      behavior: allow === true ? 'allow' : 'deny', ...(allow === true ? {} : { message: 'The human declined this request.' }), ...reply,
    } } }))
  }
} catch {
  if (permission) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Shepherdr could not verify approval. Ask again after it reconnects.' } } }))
  // Ordinary observation hooks never block the agent. Permission transport failures always deny.
}
