// The host's side of an MCP Apps view (spec 2026-01-26, "Communication Protocol"): JSON-RPC 2.0 over postMessage with
// the sandbox proxy, which passes the view's messages on. Pure: the plugin gives it a way to post, the call it shows
// and what the host can do (Host), so tests drive it with plain objects.

export const PROTOCOL = '2026-01-26'
const SUPPORTED = new Set(['2026-01-26', '2025-11-21'])

export type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: any; result?: any; error?: { code: number; message: string; data?: unknown } }
export type DisplayMode = 'inline' | 'fullscreen' | 'pip'

export type ViewCall = {
  tool: any
  args: Record<string, unknown>
  state: 'running' | 'done' | 'error' | 'cancelled'
  result?: any
  error?: string
  html: string
  csp?: Record<string, string[] | undefined>
  permissions?: Record<string, object>
}

export interface Host {
  /** a tools/call or resources/read the view asks of its server -> its result; throws { code, message } */
  server(method: 'tools/call' | 'resources/read', params: any): Promise<any>
  openLink(url: string): Promise<void>
  /** the view's words for the chat (ui/message): the host puts them in the message box for the person to send */
  message(text: string): Promise<void>
  /** the host shows the view in this mode now -> the mode it is in */
  setMode(mode: DisplayMode): DisplayMode
  resize(height: number | undefined, width: number | undefined): void
  context(): Record<string, unknown>
  log?(params: unknown): void
  /** the view asks to be closed */
  close?(): void
}

const err = (code: number, message: string) => ({ code, message })

export class Bridge {
  /** the view said ui/notifications/initialized: the host may now send it notifications (spec) */
  ready = false
  initialized = false
  inputSent = false
  resultSent = false
  mode: DisplayMode = 'inline'
  appModes: DisplayMode[] | null = null
  private n = 0
  private waiting = new Map<string | number, (m: Rpc) => void>()

  constructor(
    private post: (m: Rpc) => void,
    private call: ViewCall,
    private host: Host,
    private info = { name: 'Shepherdr', version: '1' },
  ) {}

  /** a message from the sandbox (the caller checked it came from the proxy's window) */
  async receive(m: Rpc) {
    if (!m || m.jsonrpc !== '2.0') return
    if (m.method === 'ui/notifications/sandbox-proxy-ready') return this.sendResource()
    if (m.method && m.id !== undefined && m.id !== null) {
      try {
        const result = await this.request(m.method, m.params ?? {})
        this.post({ jsonrpc: '2.0', id: m.id, result })
      } catch (e: any) {
        this.post({ jsonrpc: '2.0', id: m.id, error: err(typeof e?.code === 'number' ? e.code : -32000, String(e?.message ?? e)) })
      }
      return
    }
    if (m.method) return this.notification(m.method, m.params ?? {})
    if (m.id !== undefined && m.id !== null) {
      const w = this.waiting.get(m.id)
      this.waiting.delete(m.id)
      w?.(m)
    }
  }

  sendResource() {
    this.post({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-resource-ready', params: { html: this.call.html, csp: this.call.csp ?? {}, permissions: this.call.permissions ?? {} } })
  }

  capabilities() {
    return {
      openLinks: {},
      serverTools: {},
      serverResources: {},
      logging: {},
      message: { text: {} },
      sandbox: { csp: this.call.csp ?? {}, permissions: this.call.permissions ?? {} },
    }
  }

  private async request(method: string, p: any): Promise<unknown> {
    switch (method) {
      case 'ui/initialize': {
        const modes = p?.appCapabilities?.availableDisplayModes
        this.appModes = Array.isArray(modes) ? modes : null
        this.initialized = true
        return {
          protocolVersion: SUPPORTED.has(p?.protocolVersion) ? p.protocolVersion : PROTOCOL,
          hostCapabilities: this.capabilities(),
          hostInfo: this.info,
          hostContext: { ...this.host.context(), toolInfo: { tool: this.call.tool }, displayMode: this.mode },
        }
      }
      case 'ping':
        return {}
      case 'tools/call':
      case 'resources/read':
        return this.host.server(method, p)
      case 'ui/open-link': {
        const url = String(p?.url ?? '')
        if (!/^https?:\/\//i.test(url)) throw err(-32602, 'Invalid URL')
        await this.host.openLink(url)
        return {}
      }
      case 'ui/message': {
        const parts = Array.isArray(p?.content) ? p.content : [p?.content]
        const text = parts.filter((c: any) => c?.type === 'text' && typeof c.text === 'string').map((c: any) => c.text).join('\n\n').trim()
        if (!text) throw err(-32602, 'Invalid message format')
        await this.host.message(text)
        return {}
      }
      case 'ui/request-display-mode': {
        const want = p?.mode as DisplayMode
        // only a mode the view said it has, and the host has (inline, fullscreen); else the one it is in
        const can = (want === 'inline' || want === 'fullscreen') && (!this.appModes || this.appModes.includes(want))
        if (can && want !== this.mode) {
          this.mode = this.host.setMode(want)
          this.contextChanged({ displayMode: this.mode })
        }
        return { mode: this.mode }
      }
      // kept by the view's own words, not given to the agent: the host doesn't say it can (hostCapabilities)
      case 'ui/update-model-context':
        return {}
    }
    throw err(-32601, `Method not found: ${method}`)
  }

  private notification(method: string, p: any) {
    switch (method) {
      case 'ui/notifications/initialized':
        this.ready = true
        this.sendToolData()
        return
      case 'ui/notifications/size-changed':
        this.host.resize(typeof p?.height === 'number' ? p.height : undefined, typeof p?.width === 'number' ? p.width : undefined)
        return
      case 'notifications/message':
        this.host.log?.(p)
        return
      case 'ui/notifications/request-teardown':
        this.host.close?.()
        return
    }
  }

  /** the call's input, then its result once it has one (spec: tool-input first, at most once; tool-result after) */
  sendToolData() {
    if (!this.ready) return
    if (!this.inputSent) {
      this.inputSent = true
      this.post({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: this.call.args ?? {} } })
    }
    if (this.resultSent) return
    if (this.call.state === 'done' && this.call.result) {
      this.resultSent = true
      this.post({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: this.call.result })
    } else if (this.call.state === 'error') {
      this.resultSent = true
      this.post({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: this.call.error ?? 'The tool failed.' }], isError: true } })
    } else if (this.call.state === 'cancelled') {
      this.resultSent = true
      this.post({ jsonrpc: '2.0', method: 'ui/notifications/tool-cancelled', params: { reason: this.call.error ?? 'Cancelled' } })
    }
  }

  /** the call changed (it was running, now it has its result) */
  update(call: Partial<ViewCall>) {
    this.call = { ...this.call, ...call }
    this.sendToolData()
  }

  contextChanged(ctx: Record<string, unknown>) {
    if (this.ready) this.post({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: ctx })
  }

  /** before the view goes (spec: ui/resource-teardown, and wait a little for its answer) */
  teardown(reason = 'closed', wait = 500): Promise<void> {
    if (!this.ready) return Promise.resolve()
    const id = `host-${++this.n}`
    return new Promise((done) => {
      const t = setTimeout(() => {
        this.waiting.delete(id)
        done()
      }, wait)
      this.waiting.set(id, () => {
        clearTimeout(t)
        done()
      })
      this.post({ jsonrpc: '2.0', id, method: 'ui/resource-teardown', params: { reason } })
    })
  }
}
