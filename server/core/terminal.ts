import type { CoreSource } from './source.ts'

/** Browser socket owns one watch-only attach. Core sends every stream the same bytes, drawn for the terminal's own size,
 * and a full attach moves that size for the agent and every viewer. So a browser never says a size: it is told the
 * terminal's, before a first paint at that size, and again whenever something else moves it. Typed text alone needs a
 * full attach, at the size the terminal has already, so it moves nothing. Disconnect loses unacknowledged input; it is
 * never replayed. */
export function terminalBridge(source: CoreSource, chat: string, ws: { send(data: Uint8Array | string): void; close(): void; buffered(): number }) {
  type Stream = Awaited<ReturnType<typeof source.core.attach>>
  let ended = false, opened = false, pending = 0, last = 0, repainting = false, watches = 0
  let stream: Stream | undefined, typist: { stream: Stream; cols: number; rows: number } | undefined
  let shown: { cols: number; rows: number } | undefined, idle: ReturnType<typeof setTimeout> | undefined
  let chain = Promise.resolve()
  const agent = source.agents.get(chat), terminal = agent && source.agents.terminal(agent)
  const live = () => agent && source.agents.terminal(agent)
  const fail = () => { if (!ended) { finish(); ws.close() } }
  const valid = () => !ended && source.plugins?.has('terminal') !== false && agent && source.agents.get(chat)?.launch === agent.launch && live()?.pid === terminal?.pid
  const moved = () => { const now = live(); return !!now && !!shown && (now.cols !== shown.cols || now.rows !== shown.rows) }
  const unwatch = source.core.onChange(() => {
    if (ended || repainting || !moved()) return
    repainting = true
    chain = chain.then(() => { repainting = false; return moved() ? watch() : undefined }).catch(fail)
  })
  const stopTyping = () => { clearTimeout(idle); typist?.stream.close(); typist = undefined }
  function finish() { ended = true; unwatch(); stopTyping(); stream?.close() }
  async function watch() {
    const { address, cols, rows } = live()!, mine = ++watches
    stream?.close(); stream = undefined
    shown = { cols, rows }
    ws.send(JSON.stringify({ type: 'size', cols, rows }))
    const next = await source.core.attach(address, {
      data(bytes) { if (mine !== watches) return; if (!valid() || ws.buffered() > 1024 * 1024) return fail(); ws.send(bytes) },
      close() { if (mine === watches) fail() },
    }, cols, rows, { observe: true })
    if (ended || mine !== watches) { next.close(); return }
    stream = next
  }
  async function type(bytes: Buffer) {
    const { address, cols, rows } = live()!
    if (typist?.cols !== cols || typist.rows !== rows) {
      stopTyping()
      const mine: NonNullable<typeof typist> = { cols, rows, stream: await source.core.attach(address, { data() {}, close() { if (typist === mine) typist = undefined } }, cols, rows) }
      typist = mine
    }
    typist.stream.input(bytes)
    clearTimeout(idle); idle = setTimeout(stopTyping, 2000)
  }
  return {
    message(raw: string) {
      if (ended) return
      if (raw.length > 32_768 || pending >= 64) return fail()
      pending++
      chain = chain.then(async () => {
        if (!valid() || !terminal || terminal.state !== 'live') return fail()
        const message = JSON.parse(raw)
        if (!Number.isSafeInteger(message.id) || message.id <= last) return fail()
        last = message.id
        if (message.type === 'open' && !opened) { opened = true; await watch() }
        else if (!opened) return fail()
        else if (message.type === 'text' && typeof message.text === 'string') await type(Buffer.from(message.text))
        else if (message.type === 'keys' && Array.isArray(message.keys) && message.keys.length <= 32 && message.keys.every((key: unknown) => typeof key === 'string' && key.length <= 40)) {
          await source.core.call('terminal.keys', { terminal: terminal.address, keys: message.keys })
        } else if (message.type !== 'resize') return fail() // a tab from before this build still says its size: it moves nothing
        if (!ended) ws.send(JSON.stringify({ type: 'ack', id: message.id }))
      }).catch(fail).finally(() => { pending-- })
    },
    end() { if (!ended) finish() },
  }
}
