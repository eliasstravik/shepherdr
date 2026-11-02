#!/usr/bin/env bun
// Product command in the contained namespace. The outer core child supplies its fixed authenticated identity.
import { pilotGatewayRequest } from './core-pilot-gateway.ts'
import { secretRun, secretEnv } from './core-secret.ts'
try {
  const args = process.argv.slice(2)
  if (args[0] === 'agent') args.shift()
  const cut = args.indexOf('--'), route = args[0] === 'secret' && args[1] === 'run' && cut >= 0 ? args.slice(0, cut) : args
  if (route.some(word => word === '--url' || word.startsWith('--url='))) throw Error('An isolated agent uses its fixed core mailbox route, not a web URL')
  if (args[0] === 'secret' && ['run', 'env'].includes(args[1])) {
    const command = cut >= 0 ? args.slice(cut + 1) : []
    if (args[1] === 'run' && !command.length) throw Error('Put the command after --: secret run NAME -- COMMAND')
    const option = args.findIndex((word, index) => index >= 2 && word.startsWith('--'))
    const words = args[1] === 'run' ? args.slice(2, cut) : args.slice(2, option < 0 ? args.length : option)
    const names = words.flatMap(word => word.split(',')).filter(Boolean)
    const answer = await pilotGatewayRequest<{ secrets: Record<string, string> }>('secret', { names })
    if (args[1] === 'run') process.exit(await secretRun(command, answer.secrets))
    const saved = secretEnv(args, answer.secrets); process.stdout.write(saved.out); process.exit(saved.code)
  }
  let stdin: string | undefined
  if (args[0] === 'heartbeat' && args[1] === 'set') {
    if (process.stdin.isTTY) throw Error('Give the checklist on stdin: heartbeat set < file')
    const parts: Buffer[] = []; let size = 0
    for await (const chunk of process.stdin) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 65536) throw Error('Keep the checklist under 64 KiB'); parts.push(bytes) }
    stdin = Buffer.concat(parts).toString('utf8')
  }
  const answer = await pilotGatewayRequest<{ out: string; code: number }>('cli', { args, ...(stdin === undefined ? {} : { stdin }) })
  process.stdout.write(answer.out); process.exitCode = answer.code
} catch (error) { console.error((error as Error).message); process.exitCode = 1 }
