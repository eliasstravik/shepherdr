import { expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pilotGatewayRequest } from '../helper/core-pilot-gateway.ts'

test('contained command client preserves request identity and bounds responses and uncertain timeouts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-gateway-')), socket = join(root, 'gateway.sock')
  const received: unknown[] = []
  const server = createServer(async (req, res) => {
    const parts: Buffer[] = []; for await (const part of req) parts.push(Buffer.from(part))
    const body = JSON.parse(Buffer.concat(parts).toString())
    received.push(body)
    if (body.args.mode === 'large') { res.end('x'.repeat(1_048_577)); return }
    if (body.args.mode === 'wait') return
    if (body.args.mode === 'deny') { res.statusCode = 403; res.end(JSON.stringify({ ok: false, error: 'run stopped' })); return }
    res.end(JSON.stringify({ ok: true, value: 'accepted' }))
  })
  try {
    await new Promise<void>(resolve => server.listen(socket, resolve))
    const id = 'c5bf4193-011a-4696-bbad-95afee2a65c5'
    expect(await pilotGatewayRequest('cli', { mode: 'ok' }, { id, socket })).toBe('accepted')
    expect(received[0]).toEqual({ id, action: 'cli', args: { mode: 'ok' } })
    await expect(pilotGatewayRequest('cli', { mode: 'deny' }, { socket })).rejects.toThrow('run stopped')
    await expect(pilotGatewayRequest('cli', { mode: 'large' }, { socket })).rejects.toThrow('too large')
    await expect(pilotGatewayRequest('cli', { mode: 'wait' }, { socket, timeout: 10 })).rejects.toThrow('not confirmed')
    const abort = new AbortController(); abort.abort()
    await expect(pilotGatewayRequest('cli', {}, { socket, signal: abort.signal })).rejects.toThrow('cancelled')
    await expect(pilotGatewayRequest('cli', { value: 'x'.repeat(1_048_576) }, { socket })).rejects.toThrow('too large')
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }) }
})
