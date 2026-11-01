#!/usr/bin/env bun
import { secretRun, secretEnv } from './core-secret.ts'
import { readCredential } from '../server/core/home.ts'
import { coreRequest } from '../server/core/request.ts'
import { CoreError, type CoreEndpoint } from '../server/core/client.ts'
import type { MailCredential } from '../server/core/envelope.ts'

// Codex sets this for its sandbox, also on a command it runs outside. Inside, waiting out the retries would only hang.
const sandboxed = process.env.CODEX_SANDBOX_NETWORK_DISABLED === '1'
const SANDBOXED = 'Codex\'s sandbox keeps this command from reaching Shepherdr. Run it again with sandbox_permissions "require_escalated": Shepherdr allows that without a card. If Codex refuses, tell the human this machine needs one setting: Codex must trust this folder with its approval policy on-request, or have sandbox_workspace_write.network_access = true.'

try {
  const path = process.env.SHEPHERDR_CORE_CREDENTIAL
  if (!path) throw new Error('No authenticated core session. Run this command from its owning Shepherdr agent.')
  const credential = readCredential<{ mail: MailCredential; socket?: string; endpoint?: CoreEndpoint }>(path)
  const args = process.argv.slice(2)
  if (args[0] === 'agent') args.shift()
  const routeWords = args[0] === 'secret' && args[1] === 'run' && args.indexOf('--') >= 0 ? args.slice(0, args.indexOf('--')) : args
  if (routeWords.some(word => word === '--url' || word.startsWith('--url='))) throw new Error('Core agents use their owning core mailbox, not a web URL')
  if (args[0] === 'secret' && (args[1] === 'run' || args[1] === 'env')) {
    const cut = args.indexOf('--')
    const command = cut >= 0 ? args.slice(cut + 1) : []
    if (args[1] === 'run' && !command.length) throw new Error('Put the command after --: secret run NAME -- COMMAND')
    const words = args[1] === 'run' ? args.slice(2, cut) : args.slice(2, args.findIndex((word, index) => index >= 2 && word.startsWith('--')) < 0 ? args.length : args.findIndex((word, index) => index >= 2 && word.startsWith('--')))
    const names = words.flatMap(word => word.split(',')).filter(Boolean)
    const result = await coreRequest(credential.endpoint ?? credential.socket ?? (() => { throw new Error('Missing core endpoint') })(), credential.mail, 'secret', { names }, { timeout: 60_000, once: sandboxed }) as { secrets: Record<string, string> }
    if (args[1] === 'run') process.exit(await secretRun(command, result.secrets))
    const saved = secretEnv(args, result.secrets)
    process.stdout.write(saved.out); process.exit(saved.code)
  }
  let stdin: string | undefined
  if (args[0] === 'heartbeat' && args[1] === 'set') {
    if (process.stdin.isTTY) throw new Error('Give the whole checklist on stdin: heartbeat set < file')
    const chunks: Buffer[] = []; let size = 0
    for await (const chunk of process.stdin) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 64 * 1024) throw new Error('Keep the heartbeat checklist under 64 KiB'); chunks.push(bytes) }
    stdin = Buffer.concat(chunks).toString('utf8')
  }
  const result = await coreRequest(credential.endpoint ?? credential.socket ?? (() => { throw new Error('Missing core endpoint') })(), credential.mail, 'cli', { args, cwd: process.cwd(), ...(stdin !== undefined ? { stdin } : {}) }, {
    timeout: args[0] === 'merge' || args[0] === 'checks' || args[0] === 'artifact' ? 110_000 : 60_000,
    once: sandboxed,
  }) as { out: string; code: number }
  process.stdout.write(result.out)
  process.exitCode = result.code
} catch (error) { console.error(sandboxed && error instanceof CoreError && ['unavailable', 'disconnected', 'closed'].includes(error.kind) ? SANDBOXED : (error as Error).message); process.exitCode = 1 }
