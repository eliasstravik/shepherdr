import type { Chat } from '../../shared/types.ts'

/** Read the existing private chat stream in small batches, without replacing the screen's subscriptions.
 * Keep earlier chats subscribed: a peer may first send its cache and then its refreshed transcript.
 * Results live only for this open search. A timeout is a coverage gap, never a claim that a chat was empty. */
export function loadSearchChats(keys: string[], receive: (chat: Chat) => void, progress: (done: number, missing: string[], finished: boolean) => void) {
  const url = new URL('api/ws', location.href)
  url.protocol = url.protocol.replace('http', 'ws')
  const socket = new WebSocket(url)
  let stopped = false
  let complete = false
  let offset = 0
  let pending = new Set<string>()
  const subscribed = new Set<string>()
  const missing = new Set<string>()
  const received = new Set<string>()
  let timer: ReturnType<typeof setTimeout>
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const report = () => progress(received.size, [...missing], complete)
  const failed = () => {
    if (stopped) return
    stopped = true
    clearTimeout(timer)
    clearInterval(heartbeat)
    progress(received.size, keys, true)
    socket.close()
  }
  const batch = () => {
    if (stopped) return
    for (const key of pending) missing.add(key)
    pending = new Set(keys.slice(offset, offset + 6))
    for (const key of pending) subscribed.add(key)
    offset += pending.size
    complete = !pending.size
    report()
    if (complete) return
    socket.send(JSON.stringify({ type: 'watch', chats: [...subscribed], term: null, visible: false }))
    timer = setTimeout(batch, 5000)
  }
  timer = setTimeout(failed, 8000)
  socket.onopen = () => {
    clearTimeout(timer)
    heartbeat = setInterval(() => { if (!stopped) socket.send(JSON.stringify({ type: 'ping' })) }, 30_000)
    batch()
  }
  socket.onmessage = e => {
    if (stopped) return
    try {
      const msg = JSON.parse(e.data)
      if (msg.type !== 'chat' || !subscribed.has(msg.chat.key)) return
      received.add(msg.chat.key)
      missing.delete(msg.chat.key)
      receive(msg.chat)
      const wasPending = pending.delete(msg.chat.key)
      report()
      if (wasPending && !pending.size) { clearTimeout(timer); timer = setTimeout(batch, 0) }
    } catch { /* an invalid update cannot claim coverage */ }
  }
  socket.onerror = failed
  socket.onclose = failed
  return () => { stopped = true; clearTimeout(timer); clearInterval(heartbeat); socket.close() }
}
