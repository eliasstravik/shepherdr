// OUTSIDE containment, owned by one core terminal holder. This never starts a server on a network address.
import { pilotSandboxArgs, type PilotSandbox } from './core-pilot-sandbox.ts'
import { PilotRecords } from './core-pilot-records.ts'
import { PilotProxy, type PilotProxyBackend } from './core-pilot-proxy.ts'
import type { PilotHome } from './core-pilot-home.ts'
import { existsSync } from 'node:fs'

export interface PilotRuntime {
  home: PilotHome
  sandbox: PilotSandbox
  bwrap: string
  args: string[]
  hosts: string[]
  backend: PilotProxyBackend
  deadline?: number
  signal: AbortSignal
}

/** Native process, Unix proxy and capture DB have one owner; failure never launches an uncontained fallback. */
export async function runPilotRuntime(input: PilotRuntime): Promise<number> {
  if (process.platform !== 'linux') throw Error('Isolated Autopilot requires Linux namespaces')
  if (input.sandbox.state !== input.home.state || input.sandbox.control !== input.home.control || !input.bwrap.startsWith('/') || !Array.isArray(input.args) || input.args.length > 512 || input.args.some(word => typeof word !== 'string') || input.deadline !== undefined && !Number.isSafeInteger(input.deadline)) throw Error('Invalid isolated runtime launch')
  input.signal.throwIfAborted()
  if (input.deadline !== undefined && input.deadline <= Date.now()) throw Error('Autopilot runtime limit reached')
  const args = pilotSandboxArgs(input.sandbox)
  args.splice(args.indexOf('--chdir'), 0, '--ro-bind', input.home.gateway, '/run/shepherdr/gateway.sock')
  args.push(...input.args)
  const records = new PilotRecords(input.home.captures)
  const gateway = new PilotProxy(input.hosts, records, input.backend)
  const watching = new AbortController()
  let child: Bun.Subprocess<'inherit', 'inherit', 'inherit'> | undefined, exited = false, stopping = false, reason: Error | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let poll: ReturnType<typeof setInterval> | undefined, checking: Promise<void> | undefined
  const stop = (error: Error) => {
    if (stopping) return
    stopping = true; reason = error; watching.abort()
    if (child && !exited) kill()
  }
  // This detached process group belongs only to this runtime. Its bwrap monitor dying also kills its PID namespace.
  const kill = () => { if (!child || exited) return; try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error } }
  const aborted = () => stop(Error('The isolated runtime was stopped'))
  input.signal.addEventListener('abort', aborted, { once: true })
  try {
    // A confirmed private actor binding is required before opening the provider's connection or process.
    await input.backend.lease(AbortSignal.any([watching.signal, input.signal, AbortSignal.timeout(15_000)]))
    input.signal.throwIfAborted()
    await gateway.listen(input.home.gateway)
    if (input.deadline !== undefined && input.deadline <= Date.now()) throw Error('Autopilot runtime limit reached')
    input.signal.throwIfAborted()
    const command = [input.bwrap, ...args]
    if (input.deadline !== undefined) {
      if (!existsSync('/usr/bin/timeout')) throw Error('Install coreutils timeout for the independent runtime deadline')
      // The OS utility enforces the same deadline even if this wrapper is busy with filesystem capture.
      command.unshift('/usr/bin/timeout', '--foreground', '--signal=KILL', `${Math.max(0.001, (input.deadline - Date.now()) / 1000)}s`)
    }
    child = Bun.spawn(command, { detached: true, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } })
    const completion = child.exited.then(code => { exited = true; return code })
    if (input.deadline !== undefined) deadline = setTimeout(() => stop(Error('Autopilot runtime limit reached')), Math.max(1, input.deadline - Date.now()))
    poll = setInterval(() => {
      if (checking || stopping || exited) return
      checking = input.backend.lease(AbortSignal.any([watching.signal, AbortSignal.timeout(15_000)]))
        .catch(error => { if (!exited && !stopping) stop(error instanceof Error ? error : Error('Autopilot authority could not be verified')) })
        .finally(() => { checking = undefined })
    }, 5000)
    const code = await completion
    if (reason) throw reason
    if (input.deadline !== undefined && Date.now() >= input.deadline) throw Error('Autopilot runtime limit reached')
    return code
  } finally {
    input.signal.removeEventListener('abort', aborted)
    if (deadline) clearTimeout(deadline)
    if (poll) clearInterval(poll)
    watching.abort()
    // A spawn/listen/observation error must not strand an owned namespace or gateway.
    if (child && !exited) { kill(); await child.exited; exited = true }
    await gateway.close()
    records.close()
    input.home.closeGateway()
    // Keep provider history/captures for the native reader. The host provider home was never mounted.
  }
}
