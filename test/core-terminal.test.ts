import { expect, test } from 'bun:test'
import { terminalBridge } from '../server/core/terminal.ts'
import type { CoreSource } from '../server/core/source.ts'

function setup() {
  const agent = { launch: 'one' }, term = { address: 'box/t1', pid: 123, state: 'live', cols: 200, rows: 120 }
  const input: string[] = [], calls: string[] = [], sent: unknown[] = []
  const sinks: { data(bytes: Buffer): void; close(reason: unknown): void }[] = []
  const changes = new Set<() => void>()
  let closed = 0, detach = 0, current = agent
  const source = { agents: { get: () => current, terminal: () => term }, core: {
    onChange(fn: () => void) { changes.add(fn); return () => { changes.delete(fn) } },
    attach: async (_terminal: string, sink: { data(bytes: Buffer): void; close(reason: unknown): void }, cols: number, rows: number, options?: { observe?: boolean }) => {
      const kind = options?.observe ? 'watch' : 'attach'
      calls.push(`${kind} ${cols} ${rows}`); sinks.push(sink); sink.data(Buffer.from(`paint ${cols}`))
      return { input: (bytes: Uint8Array) => input.push(Buffer.from(bytes).toString()), resize: (c: number, r: number) => calls.push(`resize ${c} ${r}`), close: () => { detach++; calls.push(`close ${kind}`) } }
    }, call: async (method: string) => { calls.push(method) },
  } } as unknown as CoreSource
  const bridge = terminalBridge(source, 'TASK-1/Agent', { send: data => sent.push(data), close: () => { closed++ }, buffered: () => 0 })
  const send = (message: object) => bridge.message(JSON.stringify(message))
  const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
  const said = () => sent.map(data => typeof data === 'string' ? data : Buffer.from(data as Uint8Array).toString())
  const move = (cols: number, rows: number) => { term.cols = cols; term.rows = rows; for (const fn of [...changes]) fn() }
  return { bridge, send, settle, input, calls, said, sinks, move, changes, replace: () => { current = { launch: 'two' } }, closed: () => closed, detach: () => detach }
}

test('a browser only watches, at the terminal\'s own size, told before the first paint', async () => {
  const x = setup()
  x.send({ type: 'open', id: 1 }); await x.settle()
  expect(x.calls).toEqual(['watch 200 120'])
  expect(x.said().slice(0, 3)).toEqual(['{"type":"size","cols":200,"rows":120}', 'paint 200', '{"type":"ack","id":1}'])
  x.bridge.end()
  expect(x.detach()).toBe(1); expect(x.changes.size).toBe(0)
})

test('a browser saying a size moves nothing: an old tab, a phone beside a desktop', async () => {
  const x = setup()
  x.send({ type: 'open', id: 1, cols: 80, rows: 24 }); await x.settle()
  x.send({ type: 'resize', id: 2, cols: 40, rows: 90 }); await x.settle()
  expect(x.calls).toEqual(['watch 200 120'])
  expect(x.said().at(-1)).toBe('{"type":"ack","id":2}')
  expect(x.closed()).toBe(0)
})

test('text goes in over a full attach at the size the terminal has, kept for the next key, keys by name', async () => {
  const x = setup()
  x.send({ type: 'open', id: 1 }); await x.settle()
  x.send({ type: 'text', id: 2, text: 'hello' }); await x.settle()
  x.send({ type: 'text', id: 3, text: ' you' }); await x.settle()
  x.send({ type: 'keys', id: 4, keys: ['enter'] }); await x.settle()
  expect(x.input).toEqual(['hello', ' you'])
  expect(x.calls).toEqual(['watch 200 120', 'attach 200 120', 'terminal.keys'])
  x.send({ type: 'text', id: 4, text: 'again' }); await x.settle()
  expect(x.input).toEqual(['hello', ' you']); expect(x.closed()).toBe(1)
  expect(x.detach()).toBe(2)
})

test('when something else moves the terminal, the view gets the new size and a fresh paint, and typing keeps to it', async () => {
  const x = setup()
  x.send({ type: 'open', id: 1 }); await x.settle()
  x.send({ type: 'text', id: 2, text: 'a' }); await x.settle()
  const old = x.sinks[0]
  x.move(150, 45); x.move(151, 45); await x.settle()
  expect(x.calls).toEqual(['watch 200 120', 'attach 200 120', 'close watch', 'watch 151 45'])
  expect(x.said().filter(s => s.includes('size')).at(-1)).toBe('{"type":"size","cols":151,"rows":45}')
  expect(x.said().at(-1)).toBe('paint 151')
  // the old stream's last bytes, drawn for the old size, stay away from the new paint, and its end ends nothing
  old.data(Buffer.from('stale')); old.close(null)
  expect(x.said()).not.toContain('stale'); expect(x.closed()).toBe(0)
  x.send({ type: 'text', id: 3, text: 'b' }); await x.settle()
  expect(x.calls.slice(-2)).toEqual(['close attach', 'attach 151 45'])
})

test('a change that keeps the size repaints nothing', async () => {
  const x = setup()
  x.send({ type: 'open', id: 1 }); await x.settle()
  x.move(200, 120); await x.settle()
  expect(x.calls).toEqual(['watch 200 120'])
})

test('a replaced launch cannot receive old browser input', async () => {
  const x = setup()
  x.send({ type: 'open', id: 1 }); await x.settle()
  x.replace(); x.send({ type: 'text', id: 2, text: 'do something' }); await x.settle()
  expect(x.input).toEqual([]); expect(x.closed()).toBe(1)
})

test('oversized input closes rather than buffering', async () => {
  const b = setup(); b.send({ type: 'text', id: 1, text: 'x'.repeat(33_000) }); await b.settle()
  expect(b.input).toEqual([]); expect(b.closed()).toBe(1)
})
