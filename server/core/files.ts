import type { CoreSession } from './session.ts'

interface ExecResult { stdout: string; stderr: string; code?: number | null; timed_out: boolean; truncated: boolean }
export interface TextFile { text: string; first: number; last: number; lines: number }

/** All machine commands and file access travel through core, including on the main machine. */
export class CoreFiles {
  constructor(private readonly core: CoreSession, readonly route: (machine: string) => Promise<string | undefined>) {}
  async exec(machine: string, argv: string[], cwd?: string, input?: Uint8Array, timeout = 30) {
    const result = await this.core.call<ExecResult>('machine.exec', {
      argv, cwd, on: await this.route(machine), input: input && Buffer.from(input).toString('base64'), timeout,
    }, (timeout + 20) * 1000)
    const stdout = Buffer.from(result.stdout, 'base64'), stderr = Buffer.from(result.stderr, 'base64')
    if (result.timed_out || result.truncated || result.code !== 0) throw new Error(result.timed_out ? 'Command timed out' : result.truncated ? 'Command output exceeded the core limit' : stderr.toString('utf8').slice(0, 4000) || `Command exited with ${result.code}`)
    return stdout
  }
  async text(machine: string, path: string, offset = 1, limit = 256) {
    return this.core.call<TextFile>('file.read', { path, offset, limit, on: await this.route(machine) })
  }
  async write(machine: string, path: string, text: string) {
    await this.core.call('file.write', { path, data: Buffer.from(text).toString('base64'), on: await this.route(machine) })
  }
}
