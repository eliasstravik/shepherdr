import type { Action, Snapshot, SettingSection } from '../../shared/types.ts'
import type { PluginEntry } from '../../scripts/build-plugins.ts'
import type { PluginContext, ServerPlugin } from '../plugin-api.ts'
import type { CoreStore } from './store.ts'

const NAME = /^[a-z][a-z0-9-]{0,63}$/
const METHOD = /^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/
type Host = { store: CoreStore; snapshot(): Snapshot; on(event: 'snapshot', fn: () => void): () => void }
type Loaded = { methods: Map<string, (input: unknown) => unknown | Promise<unknown>>; cleanup: (() => void)[] }
type StateEdit = { before?: string; value?: string; dirty: boolean }

/** Per-server extension lifetime. No import here reads ~/.shepherdr or legacy plugins. */
export class CorePlugins {
  private loaded = new Map<string, Loaded>()
  private failed: Record<string, string> = {}
  private catalog: PluginEntry[] = []
  private stopped = false
  private configured = false
  private pendingState = new Map<string, StateEdit>()
  private pendingBytes = 0
  constructor(private host: Host, private paused = false) {}
  activate() {
    if (this.stopped) throw Error('Plugins are stopping')
    this.host.store.db.transaction(() => {
      for (const [id, edit] of this.pendingState) {
        const at = id.indexOf('\0'), kind = `plugin:${id.slice(0, at)}`, key = id.slice(at + 1)
        if (JSON.stringify(this.host.store.get(kind, key)) !== edit.before) throw Error('Plugin state changed during startup; the previous plugin is still running. Retry the change.')
      }
      for (const [id, edit] of this.pendingState) if (edit.dirty) {
        const at = id.indexOf('\0'), kind = `plugin:${id.slice(0, at)}`, key = id.slice(at + 1)
        if (edit.value === undefined) this.host.store.delete(kind, key)
        else this.host.store.set(kind, key, JSON.parse(edit.value))
      }
    })()
    this.pendingState.clear(); this.pendingBytes = 0; this.paused = false
  }
  private staged(name: string, key: string) {
    const id = `${name}\0${key}`
    let edit = this.pendingState.get(id)
    if (!edit) {
      const before = JSON.stringify(this.host.store.get(`plugin:${name}`, key))
      if (this.pendingState.size >= 1000 || this.pendingBytes + (before?.length || 0) * 2 > 16_777_216) throw Error('Plugin startup state exceeds its 16 MiB or 1000-key limit')
      edit = { before, value: before, dirty: false }; this.pendingState.set(id, edit); this.pendingBytes += (before?.length || 0) * 2
    }
    return edit
  }
  async start(catalog: PluginEntry[], loaders: [string, () => Promise<ServerPlugin>][]) {
    const publish = !this.paused
    this.paused = true
    this.catalog = catalog
    this.configured = true
    for (const [name, load] of loaders) {
      if (this.stopped) return
      const entry = catalog.find(item => item.name === name && item.on)
      if (!entry || !NAME.test(name)) continue
      const lifetime: Loaded = { methods: new Map(), cleanup: [] }
      this.loaded.set(name, lifetime)
      const active = () => { if (this.stopped || this.loaded.get(name) !== lifetime) throw Error(`Plugin ${name} is stopped`) }
      const keyOf = (key: string) => { active(); if (typeof key !== 'string' || !key || key.length > 256) throw Error('Invalid plugin state key'); return key }
      let deadline: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([(async () => {
        const plugin = await load()
        active()
        if (plugin.name !== name || entry.from === 'user' && plugin.api !== 2) throw Error('This plugin needs the Shepherdr 2.1 API (api: 2). See docs/plugins.md.')
        const context: PluginContext = {
          api: 2, name,
          snapshot: () => { active(); return structuredClone(this.host.snapshot()) },
          state: {
            get: <T>(key: string) => {
              keyOf(key)
              if (!this.paused) return this.host.store.get<T>(`plugin:${name}`, key)
              const value = this.staged(name, key).value
              return value === undefined ? undefined : JSON.parse(value) as T
            },
            set: (key, value) => {
              keyOf(key); const json = JSON.stringify(value)
              if (json === undefined || Buffer.byteLength(json) > 1_048_576) throw Error('Plugin state must be JSON, at most 1 MiB')
              if (!this.paused) { this.host.store.set(`plugin:${name}`, key, JSON.parse(json)); return }
              const edit = this.staged(name, key), bytes = this.pendingBytes - (edit.value?.length || 0) + json.length
              if (bytes > 16_777_216) throw Error('Plugin startup state exceeds 16 MiB')
              this.pendingBytes = bytes; edit.value = json; edit.dirty = true
            },
            delete: key => {
              keyOf(key)
              if (!this.paused) { this.host.store.delete(`plugin:${name}`, key); return }
              const edit = this.staged(name, key); this.pendingBytes -= edit.value?.length || 0; edit.value = undefined; edit.dirty = true
            },
          },
          onChange: fn => {
            active()
            const off = this.host.on('snapshot', () => { if (this.paused) return; try { active(); void Promise.resolve(fn()).catch(error => this.fail(name, error)) } catch (error) { this.fail(name, error) } })
            lifetime.cleanup.push(off); return off
          },
          handle: (method, fn) => { active(); if (!METHOD.test(method) || typeof fn !== 'function' || lifetime.methods.has(method)) throw Error('Invalid or duplicate plugin method'); lifetime.methods.set(method, fn) },
        }
        const cleanup = await plugin.setup?.(context)
        if (typeof cleanup === 'function') lifetime.cleanup.push(cleanup)
        if (this.stopped || this.loaded.get(name) !== lifetime) this.dispose(lifetime)
        })(), new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(Error('Plugin startup exceeded 5 seconds')), 5000) })])
      } catch (error) { this.fail(name, error) }
      finally { clearTimeout(deadline) }
    }
    if (publish && !this.stopped) this.activate()
  }
  private dispose(lifetime: Loaded) { for (const cleanup of lifetime.cleanup.splice(0).reverse()) try { cleanup() } catch { /* the rest must still stop */ } }
  private fail(name: string, error: unknown) {
    this.failed[name] = String(error instanceof Error ? error.message : error).slice(0, 1000)
    const lifetime = this.loaded.get(name); this.loaded.delete(name)
    for (const [id, edit] of this.pendingState) if (id.startsWith(`${name}\0`)) { this.pendingBytes -= (edit.before?.length || 0) + (edit.value?.length || 0); this.pendingState.delete(id) }
    if (lifetime) this.dispose(lifetime)
  }
  async act(action: Extract<Action, { type: 'plugin' }>) {
    if (this.stopped || this.paused) throw Error('Plugins are stopping or have not been activated')
    const method = this.loaded.get(action.plugin)?.methods.get(action.method)
    if (!method) throw Error(this.failed[action.plugin] ? `Plugin ${action.plugin} is unavailable: ${this.failed[action.plugin]}` : 'No such enabled plugin method')
    if (!action.cid) throw Error('Plugin actions need a unique command id; keep it when retrying')
    const input = JSON.stringify(action.input ?? null)
    if (Buffer.byteLength(input) > 65_536) throw Error('Plugin input exceeds 64 KiB')
    return this.host.store.command(action.cid, action, async () => {
      const result = await method(JSON.parse(input))
      const json = JSON.stringify(result ?? null)
      if (Buffer.byteLength(json) > 1_048_576) throw Error('Plugin result exceeds 1 MiB')
      return JSON.parse(json)
    })
  }
  entries() { return this.catalog }
  errors() { return { ...this.failed } }
  has(name: string) { return !this.configured || this.catalog.some(item => item.name === name && item.on) }
  section(updates?: { updating: boolean; error?: string; off: string[] }): SettingSection {
    return {
      name: 'Plugins',
      about: 'Built in, and your own from ~/.shepherdr/plugins (one with a built-in name replaces it). Shepherdr rebuilds with a change in seconds.',
      rows: this.catalog.map((item, index) => {
        const warning = this.failed[item.name] || item.broken || (index === 0 && updates?.error ? `Plugin update failed; the previous build is still running:\n${updates.error}` : undefined)
        return {
          key: `plugin.${item.name}`, label: item.name,
          value: updates ? updates.off.includes(item.name) ? 'off' : 'on' : item.on ? 'on' : 'off',
          ...(updates ? { options: ['on', 'off'] } : {}), group: item.from === 'user' ? 'Yours' : 'Built in',
          ...(updates?.updating ? { hint: 'Rebuilding' } : {}),
          ...(warning ? { warn: `${item.kept ? 'Its last good version runs:\n' : ''}${warning}` } : {}),
        }
      }),
    }
  }
  stop() { this.stopped = true; for (const lifetime of this.loaded.values()) this.dispose(lifetime); this.loaded.clear(); this.pendingState.clear(); this.pendingBytes = 0 }
}
