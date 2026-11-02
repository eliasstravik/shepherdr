import type { Snapshot } from '../shared/types.ts'

/** 2.1 server extensions. Plugins are trusted local code, not a sandbox. */
export interface PluginContext {
  readonly api: 2
  readonly name: string
  snapshot(): Snapshot
  /** Private, namespaced JSON state in this installation. No live legacy files. */
  state: { get<T>(key: string): T | undefined; set(key: string, value: unknown): void; delete(key: string): void }
  /** Called for product changes. Return the unsubscribe function to dispose early. */
  onChange(fn: () => void | Promise<void>): () => void
  /** Register a method called by act({ type: 'plugin', plugin, method, input, cid }). */
  handle(method: string, fn: (input: unknown) => unknown | Promise<unknown>): void
}

export interface ServerPlugin {
  name: string
  /** what it adds on the server, in one line */
  about: string
  api?: 2
  setup?(context: PluginContext): void | (() => void) | Promise<void | (() => void)>
}

export const definePlugin = (p: ServerPlugin) => p
