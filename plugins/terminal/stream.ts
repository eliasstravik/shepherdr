/** Only mounted visible panels own a socket. Typed input is never buffered or replayed. */
const inputs = new Map<string, (message: { type: 'keys'; keys: string[] } | { type: 'text'; text: string }) => void>()
export function streamInput(chat: string, message: { type: 'keys'; keys: string[] } | { type: 'text'; text: string }) {
  inputs.get(chat)?.(message)
}
export function connectTerminal(chat: string, output: (bytes: Uint8Array, done: () => void) => void,
  reset: () => void, size: (cols: number, rows: number) => void, status: (text: string) => void) {
  let disposed = false, socket: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined
  let attempt = 0, queued = 0, serial = 0, acknowledged = 0, painting = 0, uncertain = false
  const send = (message: object) => {
    if (socket?.readyState !== WebSocket.OPEN) { status('Reconnecting… Input was not sent.'); return }
    if (socket.bufferedAmount > 64 * 1024 || serial - acknowledged >= 64) { status('Terminal is catching up. Input was not sent.'); return }
    socket.send(JSON.stringify({ ...message, id: ++serial }))
  }
  const input = (message: Parameters<typeof streamInput>[1]) => send(message)
  inputs.set(chat, input)
  const connect = () => {
    if (disposed) return
    const url = new URL('api/terminal', location.href)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.search = ''; url.searchParams.set('chat', chat)
    const ws = socket = new WebSocket(url); ws.binaryType = 'arraybuffer'
    const generation = ++painting
    ws.onopen = () => { serial = 0; acknowledged = 0; queued = 0; reset(); status(uncertain ? 'Reconnected. Last input may have arrived; check before typing it again.' : ''); send({ type: 'open' }); attempt = 0 }
    ws.onmessage = event => {
      if (socket !== ws || disposed) return
      if (typeof event.data === 'string') {
        try {
          const said = JSON.parse(event.data)
          if (said.type === 'ack' && Number.isSafeInteger(said.id)) acknowledged = Math.max(acknowledged, said.id)
          else if (said.type === 'size' && Number.isInteger(said.cols) && Number.isInteger(said.rows)) size(said.cols, said.rows)
        } catch { ws.close() }
      } else {
        const bytes = new Uint8Array(event.data)
        queued += bytes.length
        if (queued > 1024 * 1024) { ws.close(); return }
        output(bytes, () => { if (painting === generation) queued -= bytes.length })
      }
    }
    ws.onclose = () => {
      if (disposed || socket !== ws) return
      uncertain ||= serial > acknowledged
      status(uncertain ? 'Disconnected. Last input may have arrived; check before typing it again.' : 'Reconnecting…')
      retry = setTimeout(connect, Math.min(5000, 250 * 2 ** Math.min(attempt++, 5)))
    }
    ws.onerror = () => ws.close()
  }
  connect()
  return {
    close() { disposed = true; clearTimeout(retry); if (inputs.get(chat) === input) inputs.delete(chat); socket?.close() },
  }
}
