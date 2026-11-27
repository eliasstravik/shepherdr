import { expect, test } from 'bun:test'
import { Bridge, type Host, type Rpc, type ViewCall } from './bridge.ts'

function setup(call: Partial<ViewCall> = {}, host: Partial<Host> = {}) {
  const sent: Rpc[] = []
  const did: string[] = []
  const h: Host = {
    server: async (method, params) => ({ method, params }),
    openLink: async (url) => void did.push(`open ${url}`),
    message: async (text) => void did.push(`say ${text}`),
    setMode: (m) => m,
    resize: (h) => void did.push(`height ${h}`),
    context: () => ({ theme: 'dark', platform: 'web' }),
    ...host,
  }
  const b = new Bridge((m) => sent.push(m), { tool: { name: 'show' }, args: { board: 'q3' }, state: 'done', result: { content: [{ type: 'text', text: 'ok' }], structuredContent: { n: 1 } }, html: '<p>v</p>', csp: { connectDomains: ['https://api.example.com'] }, ...call }, h)
  return { b, sent, did }
}
const init = { jsonrpc: '2.0' as const, id: 1, method: 'ui/initialize', params: { protocolVersion: '2026-01-26', appCapabilities: { availableDisplayModes: ['inline'] }, appInfo: { name: 'v', version: '1' } } }

test('the sandbox gets the HTML and its CSP once it is ready', async () => {
  const { b, sent } = setup()
  await b.receive({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} })
  expect(sent[0]).toEqual({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-resource-ready', params: { html: '<p>v</p>', csp: { connectDomains: ['https://api.example.com'] }, permissions: {} } })
})

test('initialize answers with the host, then the input and the result follow initialized, in order', async () => {
  const { b, sent } = setup()
  await b.receive(init)
  const r = sent[0].result
  expect(sent[0].id).toBe(1)
  expect(r.protocolVersion).toBe('2026-01-26')
  expect(r.hostInfo.name).toBe('Shepherdr')
  expect(Object.keys(r.hostCapabilities).sort()).toEqual(['logging', 'message', 'openLinks', 'sandbox', 'serverResources', 'serverTools'])
  expect(r.hostContext).toMatchObject({ theme: 'dark', displayMode: 'inline', toolInfo: { tool: { name: 'show' } } })
  // nothing before initialized (spec)
  expect(sent.length).toBe(1)
  b.contextChanged({ theme: 'light' })
  expect(sent.length).toBe(1)
  await b.receive({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} })
  expect(sent.slice(1).map((m) => m.method)).toEqual(['ui/notifications/tool-input', 'ui/notifications/tool-result'])
  expect(sent[1].params).toEqual({ arguments: { board: 'q3' } })
  expect(sent[2].params.structuredContent).toEqual({ n: 1 })
  // at most once
  b.sendToolData()
  expect(sent.length).toBe(3)
})

test('a call still running sends its result when it comes; a failed one an error result', async () => {
  const { b, sent } = setup({ state: 'running', result: undefined })
  await b.receive(init)
  await b.receive({ jsonrpc: '2.0', method: 'ui/notifications/initialized' })
  expect(sent.map((m) => m.method).filter(Boolean)).toEqual(['ui/notifications/tool-input'])
  b.update({ state: 'error', error: 'boom' })
  expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: 'boom' }], isError: true } })
})

test("the view's requests: server calls, links, messages, display modes, unknown ones", async () => {
  let fail = false
  const { b, sent, did } = setup({}, {
    server: async (method, params) => {
      if (fail) throw { code: -32000, message: 'The person said no.' }
      return { method, params }
    },
  })
  await b.receive(init)
  await b.receive({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'refresh', arguments: {} } })
  expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 2, result: { method: 'tools/call', params: { name: 'refresh', arguments: {} } } })
  fail = true
  await b.receive({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'refresh' } })
  expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 3, error: { code: -32000, message: 'The person said no.' } })
  await b.receive({ jsonrpc: '2.0', id: 4, method: 'ui/open-link', params: { url: 'javascript:alert(1)' } })
  expect(sent.at(-1)!.error?.message).toBe('Invalid URL')
  await b.receive({ jsonrpc: '2.0', id: 5, method: 'ui/open-link', params: { url: 'https://example.com/a' } })
  await b.receive({ jsonrpc: '2.0', id: 6, method: 'ui/message', params: { role: 'user', content: [{ type: 'text', text: 'Run it on 10 rows' }] } })
  expect(did).toEqual(['open https://example.com/a', 'say Run it on 10 rows'])
  // the view said it has inline only: fullscreen isn't given, the mode it is in comes back
  await b.receive({ jsonrpc: '2.0', id: 7, method: 'ui/request-display-mode', params: { mode: 'fullscreen' } })
  expect(sent.at(-1)!.result).toEqual({ mode: 'inline' })
  await b.receive({ jsonrpc: '2.0', id: 8, method: 'ui/download-file', params: {} })
  expect(sent.at(-1)!.error?.code).toBe(-32601)
  await b.receive({ jsonrpc: '2.0', id: 9, method: 'ping' })
  expect(sent.at(-1)!.result).toEqual({})
  await b.receive({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 300, height: 420 } })
  expect(did.at(-1)).toBe('height 420')
})

test('fullscreen when the view has it: the host switches and tells the view', async () => {
  const modes: string[] = []
  const { b, sent } = setup({}, { setMode: (m) => (modes.push(m), m) })
  await b.receive({ ...init, params: { ...init.params, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] } } })
  await b.receive({ jsonrpc: '2.0', method: 'ui/notifications/initialized' })
  await b.receive({ jsonrpc: '2.0', id: 2, method: 'ui/request-display-mode', params: { mode: 'fullscreen' } })
  expect(modes).toEqual(['fullscreen'])
  expect(sent.some((m) => m.method === 'ui/notifications/host-context-changed' && m.params.displayMode === 'fullscreen')).toBe(true)
  expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 2, result: { mode: 'fullscreen' } })
})

test('teardown asks the view and waits for its answer', async () => {
  const { b, sent } = setup()
  await b.receive(init)
  await b.receive({ jsonrpc: '2.0', method: 'ui/notifications/initialized' })
  const gone = b.teardown('closed', 5000)
  const req = sent.at(-1)!
  expect(req.method).toBe('ui/resource-teardown')
  await b.receive({ jsonrpc: '2.0', id: req.id, result: {} })
  await gone
})
