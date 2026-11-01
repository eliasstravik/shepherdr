import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { defaultHome } from './home.ts'

export interface CoreConfig { home: string; port: number; binary: string; session: string; socket: string; plugins?: boolean; chosenCore?: boolean }

export function coreConfig(args: string[]): CoreConfig {
  const options = new Map<string, string>()
  for (let index = 0; index < args.length; index++) {
    const option = args[index]
    if (option === '--foreground' || option === '--no-plugin-updates') continue
    if (!['--home', '--port', '--core-bin', '--core-session', '--core-socket'].includes(option) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Unknown or incomplete option: ${option}`)
    options.set(option, args[++index])
  }
  const home = resolve(options.get('--home') || defaultHome())
  const port = Number(options.get('--port') || process.env.SHEPHERDR_PORT || 7787)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535')
  const session = options.get('--core-session') || process.env.HC_SESSION || 'shepherdr'
  if (!/^[a-zA-Z0-9_-]{1,24}$/.test(session)) throw new Error('Invalid core session')
  const runtime = process.env.XDG_RUNTIME_DIR || (process.getuid && existsSync(`/run/user/${process.getuid()}`) ? `/run/user/${process.getuid()}` : join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'herdr-core', session))
  const socket = resolve(options.get('--core-socket') || process.env.HC_SOCKET || join(runtime, 'herdr-core', `${session}.sock`))
  // State-directory fallback stores the socket directly there, without an extra herdr-core component.
  const fallback = !process.env.XDG_RUNTIME_DIR && !(process.getuid && existsSync(`/run/user/${process.getuid()}`))
  const endpoint = !options.has('--core-socket') && !process.env.HC_SOCKET && fallback ? join(runtime, `${session}.sock`) : socket
  if (Buffer.byteLength(endpoint) > 100) throw new Error('Core socket path is too long; use --core-socket in a private directory')
  return { home, port, binary: options.get('--core-bin') || process.env.SHEPHERDR_CORE_BIN || 'hc', session, socket: endpoint, plugins: !args.includes('--no-plugin-updates'), chosenCore: options.has('--core-session') || options.has('--core-socket') }
}

/** Never propagate the launching agent's credentials, routing or child-session markers into a new server/core. */
export function coreEnvironment(config: CoreConfig): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^(SHEPHERDR_|AGENT_BROWSER_|CLAUDE_CODE_|HC_)/.test(key) || ['CLAUDECODE', 'ELEVENLABS_API_KEY'].includes(key)) delete env[key]
  return { ...env, SHEPHERDR_HOME: config.home, SHEPHERDR_PORT: String(config.port), HC_SESSION: config.session, HC_SOCKET: config.socket }
}
