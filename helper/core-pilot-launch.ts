#!/usr/bin/env bun
// Invoked by documented core machine.exec (prepare) or a core-owned terminal (run), never a network worker.
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { lstatSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { preparePilotHome, type PilotHome } from './core-pilot-home.ts'
import { pilotNativeWorkspace } from './core-pilot-native.ts'
import { pilotSandboxArgs, type PilotSandbox } from './core-pilot-sandbox.ts'
import { pilotCoreBackend } from './core-pilot-backend.ts'
import { runPilotRuntime } from './core-pilot-runtime.ts'
import { readCredential } from '../server/core/home.ts'
import type { MailCredential } from '../server/core/envelope.ts'
import type { CoreEndpoint } from '../server/core/client.ts'

export interface PilotPrepared {
  paths: Pick<PilotHome, 'root' | 'state' | 'control' | 'captures' | 'gateway'>
  sandbox: PilotSandbox
  bwrap: string
}
export interface PilotPrepare {
  parent: string; cwd: string; repo: string; kind: 'claude' | 'codex'; writable: boolean; instructions: string
  privateRoots: string[]
  settings: string
}
export interface PilotLaunch extends PilotPrepared { credential: string; args: string[]; hosts: string[]; deadline?: number }

export function discardPilotPrepared(prepared: PilotPrepared, parent: string) {
  const root = prepared.paths.root, gateway = dirname(prepared.paths.gateway)
  if (dirname(root) !== resolve(parent) || !/^pilot-/.test(root.split('/').at(-1)!) || prepared.paths.state !== join(root, 'home') || prepared.paths.control !== join(root, 'control') || prepared.paths.captures !== join(root, 'captures') || !/^shep-pilot-gw-/.test(gateway.split('/').at(-1)!)) throw Error('Invalid private runtime cleanup')
  for (const path of [parent, root, gateway]) {
    const stat = lstatSync(path)
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid() || realpathSync(path) !== resolve(path)) throw Error('Runtime cleanup needs private owned real directories')
  }
  rmSync(gateway, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true })
}

export function preparePilotLaunch(input: PilotPrepare): PilotPrepared {
  if (process.platform !== 'linux') throw Error('Isolated Autopilot requires Linux namespaces; no unrestricted fallback was started')
  if (!input || typeof input.parent !== 'string' || typeof input.cwd !== 'string' || typeof input.repo !== 'string' || typeof input.instructions !== 'string' || typeof input.settings !== 'string' || Buffer.byteLength(input.settings) > 128 * 1024 || typeof input.writable !== 'boolean' || !Array.isArray(input.privateRoots) || input.privateRoots.some(path => typeof path !== 'string')) throw Error('Invalid contained launch preparation')
  JSON.parse(input.settings)
  const bwrap = Bun.which('bwrap'), binary = Bun.which(input.kind)
  if (!bwrap || !binary) throw Error('Install bubblewrap and the selected native CLI before isolated Autopilot')
  const home = preparePilotHome(input.parent, realpathSync(homedir()), join(import.meta.dir, '..'), input.kind, input.instructions)
  try {
    writeFileSync(join(home.control, 'settings.json'), input.settings, { mode: 0o600, flag: 'wx' })
    const protectedRoots = ['.shepherdr', '.shepherdr-legacy', '.codex', '.claude', '.ssh', '.local/share/shepherdr-agents'].map(path => join(homedir(), path))
    const sandbox: PilotSandbox = { cwd: input.cwd, repo: input.repo, home: realpathSync(homedir()), state: home.state, control: home.control, binary: realpathSync(binary), bun: realpathSync(process.execPath), kind: input.kind, writable: input.writable,
      privateRoots: [...input.privateRoots, ...protectedRoots, home.root] }
    pilotSandboxArgs(sandbox) // Refuse unsafe mounts before the app records or launches this runtime.
    pilotNativeWorkspace(home, input.cwd, input.kind)
    const { root, state, control, captures, gateway } = home
    return { paths: { root, state, control, captures, gateway }, sandbox, bwrap: realpathSync(bwrap) }
  } catch (error) { home.discard(); throw error }
}

export async function launchPilot(path: string, signal: AbortSignal) {
  const input = readCredential<PilotLaunch>(path)
  const gatewayRoot = dirname(input.paths.gateway), stat = lstatSync(gatewayRoot)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid() || realpathSync(gatewayRoot) !== resolve(gatewayRoot) || !/^shep-pilot-gw-/.test(gatewayRoot.split('/').at(-1)!)) throw Error('Invalid private gateway directory')
  const credential = readCredential<{ mail: MailCredential; socket?: string; endpoint?: CoreEndpoint }>(input.credential)
  const endpoint = credential.endpoint ?? credential.socket
  if (!endpoint) throw Error('Missing private core endpoint')
  const home: PilotHome = { ...input.paths, closeGateway: () => rmSync(gatewayRoot, { recursive: true, force: true }), discard: () => { throw Error('A launched runtime keeps its native history') } }
  return runPilotRuntime({ home, sandbox: input.sandbox, bwrap: input.bwrap, args: input.args, hosts: input.hosts, deadline: input.deadline, signal,
    backend: pilotCoreBackend(endpoint, credential.mail, input.sandbox.cwd) })
}

if (import.meta.main) {
  try {
    if (process.argv[2] === 'prepare' || process.argv[2] === 'discard') {
      const chunks: Buffer[] = []; let size = 0
      for await (const part of process.stdin) { const bytes = Buffer.from(part); size += bytes.length; if (size > 3 * 1024 * 1024) throw Error('Contained preparation input is too large'); chunks.push(bytes) }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (process.argv[2] === 'discard') discardPilotPrepared(input.prepared, input.parent)
      else console.log(JSON.stringify(preparePilotLaunch(input)))
    } else {
      const stop = new AbortController()
      for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => stop.abort())
      process.exitCode = await launchPilot(process.argv[2], stop.signal)
    }
  } catch (error) { console.error((error as Error).message); process.exitCode = 1 }
}
