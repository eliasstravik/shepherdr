// Runs one contained launch for core-pilot-mac-escape.test.ts, in its own process so its HOME is the scratch home and
// the test can SIGKILL it. Prepares through the real launcher and runs the real runtime, with a fake product backend.
import { preparePilotLaunch } from '../helper/core-pilot-launch.ts'
import type { PilotHome } from '../helper/core-pilot-home.ts'
import { runPilotRuntime } from '../helper/core-pilot-runtime.ts'
import { dirname } from 'node:path'
import { rmSync } from 'node:fs'
const input = JSON.parse(process.argv[2]!) as { parent: string; cwd: string; repo: string; writable: boolean; access: 'mac' | 'mac-ports'; kind: 'claude' | 'codex'; args: string[]; hosts: string[]; deadline?: number }
const prepared = preparePilotLaunch({ parent: input.parent, cwd: input.cwd, repo: input.repo, kind: input.kind, writable: input.writable, instructions: 'Use /run/shepherdr/bin/shepherdr.', privateRoots: [], settings: JSON.stringify({ hooks: {} }), access: input.access })
console.log(JSON.stringify({ prepared }))
const stop = new AbortController()
process.on('SIGTERM', () => stop.abort())
const gatewayRoot = dirname(prepared.paths.gateway)
const home: PilotHome = { ...prepared.paths, closeGateway: () => rmSync(gatewayRoot, { recursive: true, force: true }), discard: () => {} }
const code = await runPilotRuntime({ home, sandbox: prepared.sandbox, bwrap: prepared.bwrap, mac: prepared.mac, args: input.args, hosts: input.hosts, deadline: input.deadline, signal: stop.signal, backend: {
  cli: async () => ({ out: 'product command reached the gateway\n', code: 0 }), secret: async () => ({ secrets: {} }), hook: async () => ({}), lease: async () => {}, reserve: async () => {},
} })
console.log(JSON.stringify({ code }))
// No process.exit: like the real launcher, this must end by itself, with nothing left holding it open.
