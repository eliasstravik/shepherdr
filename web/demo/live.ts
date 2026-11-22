// For looking at a branch's app against a throwaway service on this machine (never the real one):
//   bun web/demo/live.ts <service port> <token file> [port]
// A page can't use the service on 127.0.0.1 by itself (it lets in only the tailnet's owner, or a local caller with
// the token and no browser origin): this stands between them on 127.0.0.1, adding the token. Development only.
import { readFileSync } from 'node:fs'

const [to, tokenFile, at = '7800'] = process.argv.slice(2)
if (!to || !tokenFile) throw new Error('usage: bun web/demo/live.ts <service port> <token file> [port]')
const token = readFileSync(tokenFile, 'utf8').trim()
const base = `127.0.0.1:${to}`

Bun.serve<{ url: string; up?: WebSocket; early: (string | Uint8Array)[]; proto?: string | null }, never>({
  hostname: '127.0.0.1',
  port: Number(at),
  idleTimeout: 180,
  async fetch(req, server) {
    const url = new URL(req.url)
    if (req.headers.get('upgrade') === 'websocket') {
      // a socket's sub-protocol (the desktop's "binary") is asked of the service and answered to the page
      const proto = req.headers.get('sec-websocket-protocol')
      return server.upgrade(req, { ...(proto ? { headers: { 'Sec-WebSocket-Protocol': proto.split(',')[0]!.trim() } } : {}), data: { url: `ws://${base}${url.pathname}${url.search}`, early: [], proto } }) ? undefined : new Response('no', { status: 400 })
    }
    const headers = new Headers(req.headers)
    for (const h of ['origin', 'host', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest']) headers.delete(h)
    headers.set('authorization', `Bearer ${token}`)
    const r = await fetch(`http://${base}${url.pathname}${url.search}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(), redirect: 'manual' })
    return new Response(r.body, { status: r.status, headers: r.headers })
  },
  websocket: {
    open(ws) {
      const up = new WebSocket(ws.data.url, { headers: { authorization: `Bearer ${token}`, host: base }, ...(ws.data.proto ? { protocols: ws.data.proto.split(',').map((x) => x.trim()) } : {}) } as never)
      up.binaryType = 'arraybuffer'
      ws.data.up = up
      up.onopen = () => { for (const m of ws.data.early) up.send(m); ws.data.early = [] }
      up.onmessage = (e) => ws.send(typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer))
      up.onclose = () => ws.close()
    },
    message(ws, m) {
      const up = ws.data.up
      const data = typeof m === 'string' ? m : new Uint8Array(m)
      if (up?.readyState === WebSocket.OPEN) up.send(data)
      else ws.data.early.push(data)
    },
    close(ws) {
      ws.data.up?.close()
    },
  },
})
console.log(`live on http://127.0.0.1:${at}/ -> ${base}`)
