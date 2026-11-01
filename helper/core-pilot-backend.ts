// OUTSIDE containment. This closure owns the credential and cwd; neither comes from gateway input.
import { randomUUID } from 'node:crypto'
import { coreRequest } from '../server/core/request.ts'
import type { CoreEndpoint } from '../server/core/client.ts'
import { toolHash, type MailCredential } from '../server/core/envelope.ts'
import type { PilotProxyBackend } from './core-pilot-proxy.ts'

type Request = typeof coreRequest
export function pilotCoreBackend(endpoint: CoreEndpoint, credential: MailCredential, cwd: string, request: Request = coreRequest): PilotProxyBackend {
  const call = (action: string, args: unknown, id: string, signal: AbortSignal, timeout = 110_000) => request(endpoint, credential, action, args, { id, signal, timeout })
  return {
    cli: (args, stdin, id, signal) => call('cli', { args, cwd, ...(stdin === undefined ? {} : { stdin }) }, id, signal),
    secret: (names, id, signal) => call('secret', { names }, id, signal, 60_000),
    hook: async (input, id, signal) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid native hook')
      const raw = input as Record<string, unknown>, fields: Record<string, unknown> = {}
      for (const [key, max] of [['hook_event_name', 64], ['session_id', 128], ['transcript_path', 4096], ['agent_id', 128], ['model', 128], ['tool_name', 128], ['permission_mode', 32], ['tool_use_id', 128], ['turn_id', 128], ['prompt_id', 128]] as const) {
        if (raw[key] === undefined) continue
        if (typeof raw[key] !== 'string' || (raw[key] as string).length > max) throw Error('Native hook metadata is invalid or too large')
        fields[key] = raw[key]
      }
      if (fields.hook_event_name === 'PermissionRequest') fields.tool_input = raw.tool_input
      else if (raw.tool_input !== undefined) fields.tool_hash = toolHash(raw.tool_input)
      // Ordinary PostToolUse hooks can contain megabytes of results: none belong in core's bounded mailbox.
      // Oversize permission input is refused whole rather than presenting a misleading truncated approval.
      if (Buffer.byteLength(JSON.stringify(fields)) > 64 * 1024) throw Error('Native permission input exceeds the mailbox limit')
      if (fields.hook_event_name === 'PermissionRequest' && (JSON.stringify(fields.tool_input, null, 2)?.length ?? 0) > 16_000) throw Error('Native permission input is too large to show in full; review it in Terminal')
      try { return await call('pilot', { op: 'hook', input: fields }, id, signal, fields.hook_event_name === 'PermissionRequest' ? 3_500_000 : 4000) }
      catch (error) {
        if (signal.aborted) {
          // A cancelled mailbox wait cannot by itself retract a published permission request.
          // The server records this deny tombstone even if cancellation arrives before the hook.
          try { await call('pilot', { op: 'cancel', id }, randomUUID(), AbortSignal.timeout(3000), 3000) } catch { /* expiry/run cleanup also deny; never invent an approval */ }
        }
        throw error
      }
    },
    lease: async signal => { await call('pilot', { op: 'lease' }, randomUUID(), signal, 15_000) },
    reserve: (bytes, signal) => call('pilot', { op: 'traffic', bytes }, randomUUID(), signal, 15_000) as Promise<{ left?: number }>,
  }
}
