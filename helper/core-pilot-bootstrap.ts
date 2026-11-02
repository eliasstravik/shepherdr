// INSIDE the private namespaces. All network and product traffic exits only through the Unix gateway.
import { connect, createServer } from 'node:net'
import { PilotCapture, type PilotCaptureResult } from './core-pilot-capture.ts'
import { pilotGatewayRequest } from './core-pilot-gateway.ts'

const peers = new Set<import('node:net').Socket>()
const relay = createServer(socket => {
  if (peers.size >= 16) { socket.destroy(); return }
  const upstream = connect('/run/shepherdr/gateway.sock')
  peers.add(socket); peers.add(upstream)
  socket.on('close', () => { peers.delete(socket); upstream.destroy() })
  upstream.on('close', () => { peers.delete(upstream); socket.destroy() })
  socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy())
  socket.pipe(upstream).pipe(socket)
})
await new Promise<void>((resolve, reject) => { relay.once('error', reject); relay.listen(18765, '127.0.0.1', resolve) })
const [binary, ...args] = process.argv.slice(2)
const env = { ...process.env, HTTP_PROXY: 'http://127.0.0.1:18765', HTTPS_PROXY: 'http://127.0.0.1:18765', ALL_PROXY: 'http://127.0.0.1:18765',
  http_proxy: 'http://127.0.0.1:18765', https_proxy: 'http://127.0.0.1:18765', NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' }

const captures = new PilotCapture(process.env.HOME!, (packet, signal) => pilotGatewayRequest('capture', packet, { timeout: 2000, signal }))
const observing = new AbortController()
let current: Promise<PilotCaptureResult> | undefined, captureWarning = false
const capture = (signal: AbortSignal) => captures.poll(signal).then(result => {
  if (result.error && !captureWarning) { captureWarning = true; process.stderr.write(`Shepherdr: ${result.error}.\n`) }
  return result
})
const captureTimer = setInterval(() => {
  if (!current) current = capture(observing.signal).finally(() => { current = undefined })
}, 500)
const child = Bun.spawn([binary, ...args], { env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
const code = await child.exited
clearInterval(captureTimer)
// Cancel the current request as well as later batches; shutdown has one shared deadline.
const deadline = AbortSignal.timeout(10_000)
observing.abort()
await current
let checked = 0, complete = false
do {
  const result = await capture(deadline); checked += 32
  complete = result.complete && checked >= result.files
  if (!complete && !deadline.aborted) await Bun.sleep(20)
} while (!complete && !deadline.aborted)
if (!complete) process.stderr.write('Shepherdr: native transcript capture did not finish before exit.\n')
for (const socket of peers) socket.destroy()
relay.close()
process.exit(code)
