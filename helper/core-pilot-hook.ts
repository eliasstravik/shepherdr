#!/usr/bin/env bun
import { pilotGatewayRequest } from './core-pilot-gateway.ts'
let permission = false
try {
  const parts: Buffer[] = []; let size = 0
  for await (const chunk of process.stdin) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 1_048_576) throw Error('Hook input too large'); parts.push(bytes) }
  const input = JSON.parse(Buffer.concat(parts).toString('utf8'))
  permission = input.hook_event_name === 'PermissionRequest'
  const { allow, ...reply } = await pilotGatewayRequest<{ allow?: boolean }>('hook', input, { timeout: permission ? 3_500_000 : 4000 })
  if (permission) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: allow === true ? 'allow' : 'deny', ...reply } } }))
} catch {
  if (permission) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Approval could not be verified; ask again after reconnecting.' } } }))
}
