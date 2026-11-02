import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, createServer, type Socket, type NetConnectOpts } from 'node:net'
import { lookup } from 'node:dns/promises'
import { PilotProxy, type PilotProxyBackend } from '../helper/core-pilot-proxy.ts'
import { PilotRecords } from '../helper/core-pilot-records.ts'
import { clientHello } from './pilot-tls.ts'
import { pilotGatewayRequest } from '../helper/core-pilot-gateway.ts'

async function fixture(run: (root: string, records: PilotRecords) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-proxy-')), home = join(root, 'captures')
  mkdirSync(home, { mode: 0o700 }); const records = new PilotRecords(home)
  try { await run(root, records) } finally { records.close(); rmSync(root, { recursive: true, force: true }) }
}
function backend(patch: Partial<PilotProxyBackend> = {}): PilotProxyBackend {
  return { cli: async () => ({ out: 'OK', code: 0 }), secret: async () => ({ secrets: {} }), hook: async () => ({}), lease: async () => {}, reserve: async () => {}, ...patch }
}
async function tunnel(socket: string, host: string, after?: (socket: Socket, response: string) => void, head = Buffer.alloc(0)) {
  return new Promise<string>((done, fail) => {
    const client = connect(socket), parts: Buffer[] = []
    const timer = setTimeout(() => { client.destroy(); fail(Error('Tunnel check timed out')) }, 3000)
    client.on('error', error => { clearTimeout(timer); fail(error) })
    client.on('close', () => { clearTimeout(timer); done(Buffer.concat(parts).toString()) })
    let called = false
    client.on('data', part => {
      parts.push(Buffer.from(part))
      const response = Buffer.concat(parts).toString()
      if (!called && response.includes('\r\n\r\n')) { called = true; if (after) after(client, response); else client.end() }
    })
    client.on('connect', () => client.write(Buffer.concat([Buffer.from(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`), head])))
  })
}
test('Unix gateway fixes backend fields and accepts only scoped commands, secrets, hooks and capture bytes', async () => fixture(async (root, records) => {
  const calls: unknown[] = [], socket = join(root, 'gateway.sock')
  const proxy = new PilotProxy(['api.openai.com'], records, backend({ cli: async (args, stdin, id) => { calls.push({ args, stdin, id }); return { out: 'scoped', code: 0 } } }))
  try {
    await proxy.listen(socket)
    const id = '34da2965-a060-4f0e-a301-6048313333b5'
    expect(await pilotGatewayRequest('cli', { args: ['show'], chat: 'forged', cwd: '/etc', grant: 'forged' }, { id, socket })).toEqual({ out: 'scoped', code: 0 })
    expect(calls).toEqual([{ args: ['show'], stdin: undefined, id }])
    await expect(pilotGatewayRequest('secret', { names: ['NAME=value'] }, { socket })).rejects.toThrow('secret names')
    expect(await pilotGatewayRequest('capture', { file: '.codex/sessions/2026/session.jsonl', identity: '1:2:0', offset: 0, reset: true, data: Buffer.from('native\n').toString('base64') }, { socket })).toEqual({ offset: 7 })
    expect(readFileSync(records.path('.codex/sessions/2026/session.jsonl'), 'utf8')).toBe('native\n')
  } finally { await proxy.close() }
}))
test('CONNECT refuses an unapproved hostname and a mixed public/private DNS answer before TCP', async () => fixture(async (root, records) => {
  let tcp = 0, leases = 0
  const socket = join(root, 'gateway.sock')
  const dns = (async () => [{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }]) as unknown as typeof lookup
  const tcpFactory = ((_options: NetConnectOpts) => { tcp++; throw Error('must not connect') })
  const proxy = new PilotProxy(['api.openai.com'], records, backend({ lease: async () => { leases++ } }), dns, tcpFactory)
  try {
    await proxy.listen(socket)
    expect(await tunnel(socket, 'not-allowed.example.com')).toContain('403 Forbidden')
    expect(leases).toBe(0)
    expect(await tunnel(socket, 'api.openai.com')).toContain('403 Forbidden')
    expect(leases).toBe(1); expect(tcp).toBe(0)
  } finally { await proxy.close() }
}))
test('tunnel bytes reserve shared allowance in both directions before reaching either peer', async () => fixture(async (root, records) => {
  const socket = join(root, 'gateway.sock'), charges: number[] = [], received: Buffer[] = []
  const hello = clientHello('api.openai.com'), payload = Buffer.concat([hello, Buffer.from('PAYLOAD')])
  const upstream = createServer(peer => peer.on('data', bytes => {
    expect(charges.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(bytes.length)
    received.push(Buffer.from(bytes)); if (Buffer.concat(received).length === payload.length) peer.end('REPLY')
  }))
  await new Promise<void>(done => upstream.listen(0, '127.0.0.1', done))
  const port = (upstream.address() as { port: number }).port
  const dns = (async () => [{ address: '1.1.1.1', family: 4 }]) as unknown as typeof lookup
  const tcp = ((options: NetConnectOpts) => connect({ ...options, host: '127.0.0.1', port }))
  const proxy = new PilotProxy(['api.openai.com'], records, backend({ reserve: async bytes => { charges.push(bytes) } }), dns, tcp)
  try {
    await proxy.listen(socket)
    const response = await tunnel(socket, 'api.openai.com', (client, header) => { expect(header).toContain('200 Connection Established'); client.write('PAYLOAD') }, hello)
    expect(response).toContain('REPLY'); expect(Buffer.concat(received)).toEqual(payload)
    expect(charges.reduce((a, b) => a + b, 0)).toBe(payload.length + 5)
  } finally { await proxy.close(); await new Promise<void>(done => upstream.close(() => done())) }
}))

test('quota refusal closes a tunnel before unreserved incoming bytes reach the contained client', async () => fixture(async (root, records) => {
  const socket = join(root, 'gateway.sock'), received: Buffer[] = []
  const upstream = createServer(peer => peer.on('data', bytes => { received.push(Buffer.from(bytes)); peer.end('REPLY') }))
  await new Promise<void>(done => upstream.listen(0, '127.0.0.1', done))
  const port = (upstream.address() as { port: number }).port
  const dns = async () => [{ address: '1.1.1.1', family: 4 }]
  const tcp = (options: NetConnectOpts) => connect({ ...options, host: '127.0.0.1', port })
  const payload = Buffer.concat([clientHello('api.openai.com'), Buffer.from('PAYLOAD')])
  let used = 0
  const proxy = new PilotProxy(['api.openai.com'], records, backend({ reserve: async bytes => { if (used + bytes > payload.length + 2) throw Error('allowance reached'); used += bytes } }), dns, tcp)
  try {
    await proxy.listen(socket)
    const response = await tunnel(socket, 'api.openai.com', client => client.write(payload))
    expect(Buffer.concat(received)).toEqual(payload); expect(used).toBe(payload.length)
    expect(response).not.toContain('REPLY')
    expect(response.match(/HTTP\/1.1/g)?.length).toBe(1)
  } finally { await proxy.close(); await new Promise<void>(done => upstream.close(() => done())) }
}))

test('gateway shutdown aborts pending product requests', async () => fixture(async (root, records) => {
  const socket = join(root, 'gateway.sock'); let arrived!: () => void
  const started = new Promise<void>(done => { arrived = done })
  const proxy = new PilotProxy([], records, backend({ cli: (_args, _stdin, _id, signal) => new Promise((_done, fail) => { arrived(); signal.addEventListener('abort', () => fail(Error('stopping')), { once: true }) }) }))
  await proxy.listen(socket)
  const pending = pilotGatewayRequest('cli', { args: ['show'] }, { socket }).then(() => undefined, error => error)
  await started; await proxy.close()
  expect(await pending).toBeInstanceOf(Error)
}))

test('an allowed CONNECT cannot forward plaintext or a different TLS server name to a shared address', async () => fixture(async (root, records) => {
  const socket = join(root, 'gateway.sock'), received: Buffer[] = []
  const peers = new Set<Socket>()
  const upstream = createServer(peer => { peers.add(peer); peer.on('close', () => peers.delete(peer)); peer.on('data', bytes => received.push(Buffer.from(bytes))) })
  await new Promise<void>(done => upstream.listen(0, '127.0.0.1', done))
  const port = (upstream.address() as { port: number }).port
  const dns = async () => [{ address: '1.1.1.1', family: 4 }]
  const tcp = (options: NetConnectOpts) => connect({ ...options, host: '127.0.0.1', port })
  let used = 0
  const proxy = new PilotProxy(['api.openai.com'], records, backend({ reserve: async bytes => { used += bytes } }), dns, tcp)
  try {
    await proxy.listen(socket)
    for (const data of [Buffer.from('GET / HTTP/1.1\r\n'), clientHello('different.example.com')]) {
      await tunnel(socket, 'api.openai.com', client => client.write(data))
    }
    expect(received).toEqual([]); expect(used).toBe(0)
  } finally { await proxy.close(); for (const peer of peers) peer.destroy(); await new Promise<void>(done => upstream.close(() => done())) }
}))
