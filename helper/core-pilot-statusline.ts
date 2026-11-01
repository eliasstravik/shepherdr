#!/usr/bin/env bun
// INSIDE the sandbox, as Claude's status-line command. Claude hands it usage after each message; only the host side
// decides what a reading is. Silent: a failed reading must never disturb the agent's screen.
import { pilotGatewayRequest } from './core-pilot-gateway.ts'
try {
  const parts: Buffer[] = []; let size = 0
  for await (const chunk of process.stdin) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 1_048_576) throw Error('Status line input too large'); parts.push(bytes) }
  const input = JSON.parse(Buffer.concat(parts).toString('utf8')) as { rate_limits?: unknown }
  if (input.rate_limits) await pilotGatewayRequest('usage', { rate_limits: input.rate_limits }, { timeout: 4000 })
} catch { /* The next message reports again. */ }
