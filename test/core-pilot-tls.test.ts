import { expect, test } from 'bun:test'
import { createServer } from 'node:net'
import { connect as tls } from 'node:tls'
import { PilotTlsGuard, pilotTlsName } from '../helper/core-pilot-tls.ts'
import { clientHello, tlsRecord } from './pilot-tls.ts'

test('TLS guard accepts fragmented SNI and refuses plaintext, mismatches, missing identity and ECH', async () => {
  const bytes = clientHello('api.openai.com'), handshake = bytes.subarray(5)
  const fragmented = Buffer.concat([tlsRecord(handshake.subarray(0, 3)), tlsRecord(handshake.subarray(3))])
  expect(pilotTlsName(fragmented)).toBe('api.openai.com')
  const guard = new PilotTlsGuard('api.openai.com'), output: Buffer[] = []
  guard.on('data', bytes => output.push(Buffer.from(bytes)))
  for (const byte of fragmented) guard.write(Buffer.from([byte]))
  await guard.ready
  expect(Buffer.concat(output)).toEqual(fragmented)
  guard.end()
  for (const bad of [Buffer.from('GET / HTTP/1.1\r\n'), clientHello('other.example.com'), clientHello('api.openai.com', Buffer.alloc(0), false), clientHello('api.openai.com', Buffer.from([0xfe, 0x0d, 0, 1, 0]))]) {
    const refused = new PilotTlsGuard('api.openai.com'); refused.on('error', () => {})
    const outcome = refused.ready.then(() => false, () => true)
    refused.end(bad); expect(await outcome).toBe(true)
  }
  expect(() => pilotTlsName(Buffer.alloc(100_000))).toThrow('bound')
})
test('a real native TLS client emits the supported ClientHello shape', async () => {
  let done!: (bytes: Buffer) => void, fail!: (error: Error) => void
  const hello = new Promise<Buffer>((resolve, reject) => { done = resolve; fail = reject })
  const timeout = setTimeout(() => fail(Error('Native ClientHello was not received')), 2000)
  const sockets: import('node:net').Socket[] = []
  const server = createServer(peer => {
    sockets.push(peer); const parts: Buffer[] = []
    peer.on('error', () => {})
    peer.on('data', bytes => { try { parts.push(Buffer.from(bytes)); const all = Buffer.concat(parts); if (pilotTlsName(all)) done(all) } catch (error) { fail(error as Error) } })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const client = tls({ host: '127.0.0.1', port: (server.address() as { port: number }).port, servername: 'api.openai.com' })
  client.on('error', fail)
  try { expect(pilotTlsName(await hello)).toBe('api.openai.com') }
  finally { clearTimeout(timeout); client.destroy(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
