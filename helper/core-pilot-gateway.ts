// INSIDE the sandbox. This socket is the only product-command route; no core credential is present here.
import { request } from 'node:http'
import { randomUUID } from 'node:crypto'
export type PilotGatewayAction = 'cli' | 'secret' | 'hook' | 'capture'
export interface PilotGatewayOptions { id?: string; timeout?: number; signal?: AbortSignal; socket?: string }
export function pilotGatewayRequest<T>(action: PilotGatewayAction, args: unknown, options: PilotGatewayOptions = {}): Promise<T> {
  const id = options.id ?? randomUUID(), body = Buffer.from(JSON.stringify({ id, action, args }))
  if (!/^[a-f0-9-]{36}$/.test(id) || body.length > 1_048_576) return Promise.reject(Error('Isolated command is too large or has an invalid identity'))
  return new Promise((resolve, reject) => {
    let finished = false
    const done = (error?: Error, value?: T) => { if (finished) return; finished = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort); if (error) reject(error); else resolve(value!) }
    const abort = () => { const error = Error('Isolated command was cancelled'); done(error); req.destroy(error) }
    const req = request({ socketPath: options.socket ?? '/run/shepherdr/gateway.sock', path: '/mail', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(body.length) } }, response => {
      const parts: Buffer[] = []; let size = 0
      response.on('data', chunk => {
        if (finished) return
        const bytes = Buffer.from(chunk); size += bytes.length
        if (size > 1_048_576) { done(Error('Isolated command response is too large')); req.destroy(); response.destroy(); return }
        parts.push(bytes)
      })
      response.on('error', error => done(error))
      response.on('aborted', () => done(Error('Isolated command response was interrupted')))
      response.on('end', () => {
        if (finished) return
        try {
          const answer = JSON.parse(Buffer.concat(parts).toString('utf8')) as { ok: boolean; value?: T; error?: string }
          if (response.statusCode !== 200 || answer.ok !== true) throw Error(typeof answer.error === 'string' ? answer.error.slice(0, 4000) : 'The isolated command was refused')
          done(undefined, answer.value)
        } catch (error) { done(error as Error) }
      })
    })
    const timer = setTimeout(() => { const error = Error(`Isolated request ${id} was not confirmed; check its outcome before retrying`); done(error); req.destroy(error) }, options.timeout ?? 110_000)
    req.on('error', error => done(error))
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) { abort(); return }
    req.end(body)
  })
}
